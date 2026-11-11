import { Router } from 'express';
import { Faq } from '../models/index.js';
import { requirePermission } from '../middleware/auth.js';
import { dateKey, objectId, timeHm, validate, z } from '../middleware/validate.js';
import { ok } from '../utils/http.js';
import { audit } from '../services/auditService.js';
import { getRestaurant, invalidateRestaurantCache, publicRestaurant } from '../services/restaurantService.js';
import { Restaurant } from '../models/index.js';

export const basePath = '/restaurant';
const router = Router();

router.get('/', async (_req, res) => ok(res, await publicRestaurant()));

router.get('/faqs', async (_req, res) => {
  const rows = await Faq.find({ active: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
  ok(res, rows.map((f) => ({ id: String(f._id), category: f.category, question: f.question, questionBn: f.questionBn || undefined, answer: f.answer, answerBn: f.answerBn || undefined })));
});

// Admin settings -----------------------------------------------------------------------------------

const money = z.number().int().min(0).max(100000);
const settingsBody = z
  .object({
    tagline: z.string().trim().max(120),
    taglineBn: z.string().trim().max(160),
    description: z.string().trim().max(800),
    descriptionBn: z.string().trim().max(1000),
    address: z.object({ line1: z.string().trim().max(120), area: z.string().trim().max(80), city: z.string().trim().max(60), postcode: z.string().trim().max(12), country: z.string().trim().max(60), mapUrl: z.string().trim().url().max(300).or(z.literal('')) }).partial(),
    phone: z.string().trim().max(30),
    email: z.string().trim().email().max(160),
    social: z.object({ instagram: z.string().trim().url().or(z.literal('')), facebook: z.string().trim().url().or(z.literal('')), youtube: z.string().trim().url().or(z.literal('')) }).partial(),
    hours: z.array(z.object({ day: z.number().int().min(0).max(6), open: timeHm, close: timeHm, closed: z.boolean() })).length(7),
    closedDates: z.array(z.object({ date: dateKey, reason: z.string().trim().max(80).optional() })).max(60),
    acceptingOrders: z.boolean(),
    acceptingReservations: z.boolean(),
    taxLabel: z.string().trim().max(20),
    taxRate: z.number().min(0).max(0.5),
    serviceChargeRate: z.number().min(0).max(0.3),
    delivery: z.object({ baseFee: money, freeOver: money, minOrder: money, radiusKm: z.number().min(0).max(100), etaMinutes: z.number().int().min(5).max(240), areas: z.array(z.string().trim().min(2).max(60)).max(60) }).partial(),
    pickup: z.object({ etaMinutes: z.number().int().min(5).max(240) }),
    dineIn: z.object({ etaMinutes: z.number().int().min(5).max(240) }),
    loyalty: z.object({ earnPerTaka: z.number().min(0).max(5), pointValue: z.number().min(0.01).max(10), minRedeem: z.number().int().min(0).max(100000), signupBonus: z.number().int().min(0).max(10000), referralBonus: z.number().int().min(0).max(10000), birthdayBonus: z.number().int().min(0).max(10000) }).partial(),
    reservation: z
      .object({ maxGuests: z.number().int().min(1).max(40), advanceDays: z.number().int().min(1).max(365), minLeadMinutes: z.number().int().min(0).max(1440), cancelBeforeHours: z.number().int().min(0).max(72), autoConfirm: z.boolean(), seatingDurationMin: z.number().int().min(30).max(300), seatings: z.array(timeHm).min(1).max(12) })
      .partial(),
    autoDisableOutOfStock: z.boolean(),
    chef: z.object({ name: z.string().trim().max(80), title: z.string().trim().max(80), titleBn: z.string().trim().max(100), bio: z.string().trim().max(700), bioBn: z.string().trim().max(900) }).partial(),
    chefsSpecial: objectId.nullable(),
  })
  .partial();

router.get('/settings', requirePermission('settings:read'), async (_req, res) => {
  const doc = await getRestaurant({ fresh: true });
  // eslint-disable-next-line no-unused-vars
  const { _id, __v, ...rest } = doc;
  ok(res, { id: String(_id), ...rest });
});

router.put('/settings', requirePermission('settings:update'), validate({ body: settingsBody }), async (req, res) => {
  const input = req.valid.body;
  const set = {};
  // Nested objects are merged key by key so a partial form never wipes sibling settings.
  for (const [key, value] of Object.entries(input)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [inner, innerValue] of Object.entries(value)) set[`${key}.${inner}`] = innerValue;
    } else {
      set[key] = value;
    }
  }
  if (!Object.keys(set).length) return ok(res, await publicRestaurant());
  await Restaurant.updateOne({ key: 'main' }, { $set: set });
  invalidateRestaurantCache();
  await audit(req, 'settings.update', { type: 'restaurant', id: 'main' }, `Updated settings: ${Object.keys(input).join(', ')}`);
  return ok(res, await publicRestaurant());
});

export default router;
