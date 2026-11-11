// Accounts: the real owner account (production safe) and the labelled demo accounts (guarded).
import { Address, User } from '../models/index.js';
import { env } from '../config/env.js';
import { email as emailRule, password as passwordRule } from '../middleware/validate.js';
import { hashPassword } from '../utils/crypto.js';
import { createRandom } from './random.js';

/** Published on purpose: the demo accounts exist so reviewers can sign in. Never enable them on a real restaurant. */
export const DEMO_PASSWORD = 'Elan@Demo2026';
const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DAY = 86_400_000;

// ----------------------------------------------------------------------------------------------------------------
// The owner. This is the only account a production deployment needs.
// ----------------------------------------------------------------------------------------------------------------

/**
 * Creates the owner account from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME. Idempotent: an existing owner is left alone,
 * and an existing non-owner account is never promoted silently.
 */
export async function seedAdmin({ email = env.ADMIN_EMAIL, password = env.ADMIN_PASSWORD, name = env.ADMIN_NAME, log = () => {} } = {}) {
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (and optionally ADMIN_NAME) to create the owner account.');
  const mail = emailRule.safeParse(email);
  if (!mail.success) throw new Error(`ADMIN_EMAIL is not a valid email address: ${mail.error.issues[0].message}`);
  const rule = passwordRule.safeParse(password);
  if (!rule.success) throw new Error(`ADMIN_PASSWORD is too weak: ${rule.error.issues[0].message}.`);
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters for the owner account.');
  if (password === DEMO_PASSWORD) throw new Error('ADMIN_PASSWORD must not be the published demo password.');

  const existing = await User.findOne({ email: mail.data }).select('role status').lean();
  if (existing) {
    if (existing.role === 'owner') {
      log(`Owner ${mail.data} already exists. Nothing changed.`);
      return { created: false, id: String(existing._id) };
    }
    throw new Error(`${mail.data} is already registered as a ${existing.role}. Use a different ADMIN_EMAIL, or change that account's role by hand.`);
  }
  const rand = createRandom(Date.now() % 2_147_483_647);
  const user = await User.create({
    name: String(name || 'Owner').trim().slice(0, 80),
    email: mail.data,
    passwordHash: await hashPassword(password),
    role: 'owner',
    status: 'active',
    locale: 'en',
    referralCode: `ELAN-${rand.code(REFERRAL_ALPHABET, 6)}`,
    isDemo: false,
  });
  log(`Owner account created for ${mail.data}.`);
  return { created: true, id: String(user._id) };
}

// ----------------------------------------------------------------------------------------------------------------
// Demo accounts
// ----------------------------------------------------------------------------------------------------------------

export const DEMO_STAFF = [
  { key: 'owner', name: 'Ayesha Karim', email: 'owner@elan.demo', phone: '+8801700000001', role: 'owner' },
  { key: 'manager', name: 'Nabil Hasan', email: 'manager@elan.demo', phone: '+8801700000002', role: 'manager' },
  { key: 'chef', name: 'Tahmina Rahman', email: 'chef@elan.demo', phone: '+8801700000003', role: 'chef' },
  { key: 'rider', name: 'Sabbir Ahmed', email: 'rider@elan.demo', phone: '+8801700000004', role: 'delivery' },
  { key: 'rider2', name: 'Rakib Chowdhury', email: 'rider2@elan.demo', phone: '+8801700000005', role: 'delivery' },
];

// weight: how often this guest orders. joined: days before the seed run that the account was created.
export const DEMO_CUSTOMERS = [
  {
    key: 'rahim', name: 'Rahim Uddin', email: 'rahim@elan.demo', phone: '+8801710000011', locale: 'en', weight: 6, joined: 80, marketing: true,
    addresses: [
      { label: 'Home', line1: 'House 21, Road 11', area: 'Gulshan', postcode: '1212', notes: 'Ring the bell twice. Guard has a spare key.' },
      { label: 'Office', line1: 'Level 5, Navana Tower, 45 Kemal Ataturk Avenue', area: 'Banani', postcode: '1213' },
    ],
  },
  {
    key: 'nusrat', name: 'Nusrat Jahan', email: 'nusrat@elan.demo', phone: '+8801710000012', locale: 'bn', weight: 5, joined: 70, marketing: true,
    addresses: [{ label: 'Home', line1: 'Flat 6B, House 8, Road 3', area: 'Dhanmondi', postcode: '1205', notes: 'Lift is on the left of the lobby.' }],
  },
  {
    key: 'farhan', name: 'Farhan Ahmed', email: 'farhan@elan.demo', phone: '+8801710000013', locale: 'en', weight: 4, joined: 62, marketing: false,
    addresses: [{ label: 'Home', line1: 'House 40, Road 2, Sector 4', area: 'Uttara', postcode: '1230' }],
  },
  {
    key: 'tasnim', name: 'Tasnim Chowdhury', email: 'tasnim@elan.demo', phone: '+8801710000014', locale: 'en', weight: 3, joined: 52, marketing: true, referredBy: 'rahim',
    addresses: [{ label: 'Home', line1: 'House 12, Road 17', area: 'Baridhara', postcode: '1212' }],
  },
  {
    key: 'mehedi', name: 'Mehedi Hasan', email: 'mehedi@elan.demo', phone: '+8801710000015', locale: 'bn', weight: 3, joined: 40, marketing: false,
    addresses: [{ label: 'Home', line1: 'Flat 3A, Block C, Road 9', area: 'Bashundhara R/A', postcode: '1229' }],
  },
  {
    key: 'sadia', name: 'Sadia Islam', email: 'sadia@elan.demo', phone: '+8801710000016', locale: 'en', weight: 3, joined: 33, marketing: true,
    addresses: [{ label: 'Home', line1: 'House 7, Road 5', area: 'Niketan', postcode: '1212' }],
  },
  {
    key: 'imtiaz', name: 'Imtiaz Karim', email: 'imtiaz@elan.demo', phone: '+8801710000017', locale: 'en', weight: 2, joined: 21, marketing: false,
    addresses: [{ label: 'Home', line1: 'Flat 9C, Mohakhali DOHS', area: 'Mohakhali', postcode: '1206' }],
  },
  // Joined a few days ago and has not ordered yet: shows the first-order offer working.
  {
    key: 'maliha', name: 'Maliha Sultana', email: 'maliha@elan.demo', phone: '+8801710000018', locale: 'en', weight: 0, joined: 3, marketing: true,
    addresses: [{ label: 'Home', line1: 'House 33, Road 14', area: 'Gulshan', postcode: '1212' }],
  },
];

/**
 * Creates the demo staff and customers that do not exist yet (matched by email) and returns every one of them.
 * Customers start with no points; the history step writes their wallet from the orders it generates.
 */
export async function seedDemoAccounts({ now = new Date(), log = () => {} } = {}) {
  const everyone = [...DEMO_STAFF, ...DEMO_CUSTOMERS];
  const present = await User.find({ email: { $in: everyone.map((p) => p.email) } }).select('email').lean();
  const have = new Set(present.map((u) => u.email));
  const passwordHash = await hashPassword(DEMO_PASSWORD); // one salted hash is enough for published demo logins
  const rand = createRandom(7_042_026);

  const fresh = everyone.filter((p) => !have.has(p.email));
  if (fresh.length) {
    const rows = fresh.map((p) => {
      const joinedAt = new Date(now.getTime() - (p.joined ?? 120) * DAY);
      return {
        name: p.name,
        email: p.email,
        phone: p.phone,
        passwordHash,
        role: p.role ?? 'customer',
        status: 'active',
        locale: p.locale ?? 'en',
        marketingOptIn: Boolean(p.marketing),
        notificationPrefs: { orderUpdates: true, reservationUpdates: true, promotions: Boolean(p.marketing) },
        referralCode: `ELAN-${rand.code(REFERRAL_ALPHABET, 6)}`,
        loyalty: { points: 0, lifetime: 0, tier: 'initie' },
        lastLoginAt: new Date(now.getTime() - rand.int(1, 6) * DAY),
        isDemo: true,
        createdAt: joinedAt,
        updatedAt: joinedAt,
      };
    });
    await User.insertMany(rows, { ordered: false });
  }

  const users = await User.find({ email: { $in: everyone.map((p) => p.email) } }).lean();
  const byEmail = new Map(users.map((u) => [u.email, u]));
  const staff = new Map(DEMO_STAFF.map((p) => [p.key, byEmail.get(p.email)]));
  const customers = new Map(DEMO_CUSTOMERS.map((p) => [p.key, byEmail.get(p.email)]));

  // Referral link, then saved addresses, for the customers created in this run only.
  const freshEmails = new Set(fresh.map((p) => p.email));
  for (const profile of DEMO_CUSTOMERS) {
    if (!freshEmails.has(profile.email)) continue;
    const user = customers.get(profile.key);
    if (profile.referredBy) await User.updateOne({ _id: user._id }, { $set: { referredBy: customers.get(profile.referredBy)._id } });
    await Address.insertMany(
      profile.addresses.map((a, index) => ({ user: user._id, recipient: profile.name, phone: profile.phone, city: 'Dhaka', isDefault: index === 0, ...a })),
    );
  }
  log(fresh.length ? `Demo accounts created: ${fresh.length} (password ${DEMO_PASSWORD}).` : 'Demo accounts already exist.');
  return { staff, customers, created: fresh.length };
}
