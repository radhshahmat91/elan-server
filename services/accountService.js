// Staff and customer account administration: who may change whom, one-time setup links, and the permission matrix shown to owners.
import { PasswordReset, Session, User } from '../models/index.js';
import { env } from '../config/env.js';
import { ROLE_PERMISSIONS, STAFF_ROLES, can } from '../utils/permissions.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { emailLayout, escapeHtml } from '../utils/emailLayout.js';
import { forbidden } from '../utils/errors.js';
import { firstName } from '../utils/format.js';
import { sendEmail } from './notificationService.js';

/** Roles an owner may hand out. There is exactly one kind of owner: whoever the deployment was seeded with. */
export const ASSIGNABLE_STAFF_ROLES = Object.freeze(['manager', 'chef', 'delivery']);

/**
 * Pure. Throws 403 when `actor` may not change `target`. Owners are never editable through the API, and nobody
 * edits their own role or status (that is how an owner would lock themselves out).
 */
export function assertStaffEditable(actor, target) {
  if (!target || !STAFF_ROLES.includes(target.role)) throw forbidden('That account is not a staff account.', 'NOT_STAFF');
  if (target.role === 'owner') throw forbidden('The owner account cannot be changed from here.', 'OWNER_PROTECTED');
  if (String(actor?._id ?? actor?.id) === String(target._id ?? target.id)) throw forbidden('You cannot change your own role or status.', 'SELF_CHANGE');
}

/** Customers are changed through their own routes; staff accounts must never be reachable through them. */
export function assertCustomer(target) {
  if (!target || target.role !== 'customer') throw forbidden('That account is a staff account. Manage it from the Staff page.', 'NOT_CUSTOMER');
}

export const revokeSessions = (userId) => Session.deleteMany({ user: userId });

/**
 * Creates a single-use link that lets the person choose their password, and emails it when email is configured.
 * The link is also returned so an owner without an email server can hand it over in person; it is never logged.
 */
export async function issueSetupLink(user, { hours = 24, reason = 'setup' } = {}) {
  const token = randomToken(32);
  await PasswordReset.deleteMany({ user: user._id, usedAt: null });
  await PasswordReset.create({ user: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3_600_000) });
  const url = `${env.PUBLIC_CLIENT_URL}/reset-password?token=${token}`;
  const first = escapeHtml(firstName(user.name));
  const intro =
    reason === 'setup'
      ? `Hello ${first}, an account has been created for you on the ÉLAN team. Choose a password to sign in. This link works once and expires in ${hours} hours.`
      : `Hello ${first}, a manager asked for your password to be reset. Choose a new one below. This link works once and expires in ${hours} hours.`;
  await sendEmail({
    to: user.email,
    subject: reason === 'setup' ? 'Your ÉLAN team account' : 'Reset your ÉLAN password',
    html: emailLayout({ title: reason === 'setup' ? 'Welcome to the team' : 'Choose a new password', preheader: `This link works for ${hours} hours.`, bodyHtml: `<p style="margin:0">${intro}</p>`, cta: { label: 'Choose a password', url } }),
    text: `${intro.replace(/<[^>]+>/g, '')}\n${url}`,
  });
  return { url, expiresAt: new Date(Date.now() + hours * 3_600_000) };
}

/**
 * Human readable permission catalogue. The matrix on the Roles page is computed from the real rules, never typed by hand.
 * `also` lists other permissions that grant the same ability (routes accept any of them), so the matrix matches what actually works.
 */
export const PERMISSION_CATALOGUE = Object.freeze([
  { permission: 'orders:read', label: 'See all orders' },
  { permission: 'orders:update', label: 'Change any order status and cancel orders' },
  { permission: 'orders:progress', also: ['orders:update'], label: 'Move orders through the kitchen stages' },
  { permission: 'orders:assign', label: 'Assign a rider to an order' },
  { permission: 'payments:refund', label: 'Refund payments' },
  { permission: 'menu:update', label: 'Edit dishes, categories and add-ons' },
  { permission: 'menu:availability', label: 'Mark dishes sold out or back on' },
  { permission: 'reservations:update', label: 'Manage reservations' },
  { permission: 'tables:update', label: 'Manage tables and QR codes' },
  { permission: 'customers:read', label: 'See customers and their history' },
  { permission: 'loyalty:adjust', label: 'Adjust loyalty points' },
  { permission: 'inventory:update', label: 'Manage ingredients and suppliers' },
  { permission: 'inventory:adjust', label: 'Record stock received, used or wasted' },
  { permission: 'coupons:update', label: 'Create and edit coupons' },
  { permission: 'reviews:moderate', label: 'Approve, reply to and remove reviews' },
  { permission: 'analytics:read', label: 'See sales and customer analytics' },
  { permission: 'content:update', label: 'Edit gallery and FAQs' },
  { permission: 'messages:read', label: 'Read and answer guest messages' },
  { permission: 'kitchen:view', label: 'Use the kitchen display' },
  { permission: 'deliveries:update', label: 'Use the rider screen to collect and deliver orders' },
  { permission: 'staff:read', label: 'See the team list' },
  { permission: 'staff:update', label: 'Create staff accounts and change roles' },
  { permission: 'audit:read', label: 'Read the audit log' },
  { permission: 'settings:update', label: 'Change restaurant settings' },
]);

export const ROLE_DESCRIPTIONS = Object.freeze({
  owner: { label: 'Owner', summary: 'Full control, including settings and the team.' },
  manager: { label: 'Manager', summary: 'Runs the floor: orders, menu, reservations, customers, stock and content.' },
  chef: { label: 'Chef', summary: 'Works the kitchen display and marks dishes sold out.' },
  delivery: { label: 'Rider', summary: 'Sees and delivers the orders assigned to them.' },
});

export function permissionMatrix() {
  const roles = ['owner', 'manager', 'chef', 'delivery'];
  return {
    roles: roles.map((key) => ({ key, ...ROLE_DESCRIPTIONS[key], grants: ROLE_PERMISSIONS[key] })),
    rows: PERMISSION_CATALOGUE.map(({ permission, label, also = [] }) => ({
      permission,
      label,
      roles: Object.fromEntries(roles.map((role) => [role, [permission, ...also].some((p) => can(role, p))])),
    })),
  };
}

export const countByRole = async () => {
  const rows = await User.aggregate([{ $match: { status: { $ne: 'deleted' } } }, { $group: { _id: '$role', n: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
};
