import { Router } from 'express';
import { PasswordReset, Session, User } from '../models/index.js';
import { endSession, requireAuth, startSession } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimit.js';
import { email, password, phone, validate, z } from '../middleware/validate.js';
import { env } from '../config/env.js';
import { hashPassword, randomToken, sha256, signToken, verifyPassword } from '../utils/crypto.js';
import { ApiError, badRequest, conflict, unauthorized } from '../utils/errors.js';
import { created, ok } from '../utils/http.js';
import { referralCode as makeReferralCode } from '../utils/ids.js';
import { emailLayout, escapeHtml } from '../utils/emailLayout.js';
import { serializeUser } from '../serializers/user.js';
import { grantPoints } from '../services/loyaltyService.js';
import { notifyUser, sendEmail } from '../services/notificationService.js';
import { getRestaurant } from '../services/restaurantService.js';
import { audit } from '../services/auditService.js';

export const basePath = '/auth';
const router = Router();

const optionalPhone = z.union([phone, z.literal('').transform(() => undefined)]).optional();

const registerBody = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(80),
  email,
  phone: optionalPhone,
  password,
  referralCode: z.string().trim().toUpperCase().max(24).optional(),
  marketingOptIn: z.boolean().default(false),
  locale: z.enum(['en', 'bn']).default('en'),
});
const loginBody = z.object({ email, password: z.string().min(1, 'Enter your password').max(128), remember: z.boolean().default(false) });

let dummyHash;
const getDummyHash = () => (dummyHash ??= hashPassword('not-a-real-password-just-timing'));

async function createCustomer(data) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await User.create({ ...data, referralCode: makeReferralCode() });
    } catch (err) {
      if (!(err?.code === 11000 && err.keyPattern?.referralCode)) throw err;
    }
  }
  throw new ApiError(500, 'INTERNAL', 'Could not create the account. Please try again.');
}

router.post('/register', limiter({ windowMs: 15 * 60_000, limit: 20, message: 'Too many sign-up attempts. Please try again in a few minutes.' }), validate({ body: registerBody }), async (req, res) => {
  const input = req.valid.body;
  if (await User.exists({ email: input.email })) throw conflict('An account with that email already exists. Try signing in instead.', 'EMAIL_TAKEN');

  let referredBy;
  if (input.referralCode) {
    const referrer = await User.findOne({ referralCode: input.referralCode, status: 'active' }).select('_id');
    if (referrer) referredBy = referrer._id;
  }
  const user = await createCustomer({
    name: input.name,
    email: input.email,
    phone: input.phone,
    passwordHash: await hashPassword(input.password),
    marketingOptIn: input.marketingOptIn,
    notificationPrefs: { promotions: input.marketingOptIn },
    locale: input.locale,
    referredBy,
  });

  const restaurant = await getRestaurant();
  if (restaurant.loyalty.signupBonus > 0) {
    await grantPoints({ userId: user._id, points: restaurant.loyalty.signupBonus, type: 'bonus', note: 'Welcome bonus' }).catch(() => {});
  }
  await startSession(req, res, user, { remember: true });
  notifyUser(user._id, {
    type: 'system',
    title: 'Welcome to ÉLAN',
    body: `Your account is ready and ${restaurant.loyalty.signupBonus} welcome points are in your rewards wallet.`,
    link: '/account/rewards',
    email: {
      subject: 'Welcome to ÉLAN',
      html: emailLayout({
        title: `Welcome, ${input.name.split(' ')[0]}`,
        preheader: 'Your ÉLAN account is ready.',
        bodyHtml: `<p style="margin:0">Your account is ready, and ${restaurant.loyalty.signupBonus} welcome points are waiting in your rewards wallet. Order for delivery or collection, or keep a table by the window.</p>`,
        cta: { label: 'See the menu', url: `${env.PUBLIC_CLIENT_URL}/menu` },
      }),
    },
  }).catch(() => {});
  const fresh = await User.findById(user._id);
  return created(res, { user: serializeUser(fresh) });
});

router.post(
  '/login',
  limiter({ windowMs: 15 * 60_000, limit: 30, keyGenerator: (req) => `${req.ip}|${String(req.body?.email ?? '').toLowerCase().slice(0, 160)}`, message: 'Too many sign-in attempts. Please wait a few minutes.' }),
  validate({ body: loginBody }),
  async (req, res) => {
    const input = req.valid.body;
    const user = await User.findOne({ email: input.email }).select('+passwordHash');
    if (!user || !user.passwordHash || user.status !== 'active') {
      await verifyPassword(input.password, await getDummyHash()); // same work either way, so timing does not reveal accounts
      throw unauthorized('That email and password do not match.');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
      throw new ApiError(429, 'ACCOUNT_LOCKED', `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or reset your password.`);
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      const after = await User.findOneAndUpdate({ _id: user._id }, { $inc: { failedLogins: 1 } }, { new: true }).select('failedLogins');
      if (after && after.failedLogins >= 5) await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: new Date(Date.now() + 15 * 60_000) } });
      throw unauthorized('That email and password do not match.');
    }
    await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await startSession(req, res, user, { remember: input.remember });
    return ok(res, { user: serializeUser(user) });
  },
);

router.post('/logout', async (req, res) => {
  await endSession(req, res);
  ok(res, { loggedOut: true });
});

// 200 even when signed out, so the site can ask "who am I?" on every page load without error noise.
router.get('/me', (req, res) => ok(res, { user: req.user ? serializeUser(req.user) : null }));

// Short-lived token for the realtime connection. Guests connect without one.
router.get('/socket-token', (req, res) => {
  if (!req.user) return ok(res, { token: null });
  const token = signToken({ typ: 'socket', sub: String(req.user._id), role: req.user.role, name: req.user.name }, env.SOCKET_TOKEN_SECRET, 600);
  return ok(res, { token });
});

router.post(
  '/forgot-password',
  limiter({ windowMs: 15 * 60_000, limit: 8, message: 'Too many reset requests. Please wait a few minutes.' }),
  validate({ body: z.object({ email }) }),
  async (req, res) => {
    const user = await User.findOne({ email: req.valid.body.email, status: 'active' }).select('email name');
    let demoResetUrl;
    if (user) {
      const token = randomToken(32);
      await PasswordReset.deleteMany({ user: user._id, usedAt: null });
      await PasswordReset.create({ user: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60_000) });
      const url = `${env.PUBLIC_CLIENT_URL}/reset-password?token=${token}`;
      await sendEmail({
        to: user.email,
        subject: 'Reset your ÉLAN password',
        html: emailLayout({
          title: 'Choose a new password',
          preheader: 'This link works for one hour.',
          bodyHtml: `<p style="margin:0">Hello ${escapeHtml(user.name.split(' ')[0])}, someone asked to reset the password for this account. If that was you, use the button below within an hour. If not, you can ignore this email.</p>`,
          cta: { label: 'Choose a new password', url },
        }),
        text: `Choose a new password within an hour: ${url}`,
      });
      // Demo deployments without an email server would otherwise make this flow impossible to try.
      if (env.demoMode && !env.smtpConfigured) demoResetUrl = url;
    }
    // Same answer whether or not the account exists.
    return ok(res, { sent: true, ...(demoResetUrl ? { demoResetUrl } : {}) });
  },
);

router.post(
  '/reset-password',
  limiter({ windowMs: 15 * 60_000, limit: 15 }),
  validate({ body: z.object({ token: z.string().min(20).max(128), password }) }),
  async (req, res) => {
    const { token, password: next } = req.valid.body;
    const reset = await PasswordReset.findOne({ tokenHash: sha256(token), usedAt: null, expiresAt: { $gt: new Date() } });
    const invalid = () => badRequest('This reset link has expired or was already used. Request a new one.');
    if (!reset) throw invalid();
    const claimed = await PasswordReset.findOneAndUpdate({ _id: reset._id, usedAt: null }, { $set: { usedAt: new Date() } });
    if (!claimed) throw invalid();
    await User.updateOne({ _id: reset.user }, { $set: { passwordHash: await hashPassword(next), failedLogins: 0, lockedUntil: null } });
    await Session.deleteMany({ user: reset.user });
    await audit({ id: reset.user, name: 'Account owner', role: 'customer', ip: req.ip }, 'auth.password_reset', { type: 'user', id: reset.user }, 'Password reset with an emailed link');
    return ok(res, { reset: true });
  },
);

router.post(
  '/change-password',
  requireAuth,
  limiter({ windowMs: 15 * 60_000, limit: 10 }),
  validate({ body: z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }) }),
  async (req, res) => {
    const { currentPassword, newPassword } = req.valid.body;
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!user?.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) throw unauthorized('Your current password is not right.');
    user.passwordHash = await hashPassword(newPassword);
    await user.save();
    await Session.deleteMany({ user: user._id, _id: { $ne: req.session._id } }); // sign out every other device
    return ok(res, { changed: true });
  },
);

export default router;
