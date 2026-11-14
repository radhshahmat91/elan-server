import { baseSchema, defineModel, Schema, ObjectId } from './_base.js';
import { DEFAULT_TIERS } from './constants.js';

const hoursSchema = new Schema(
  {
    day: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
    open: { type: String, default: '12:00' }, // 'HH:mm', restaurant time
    close: { type: String, default: '23:00' },
    closed: { type: Boolean, default: false },
  },
  { _id: false },
);

const tierSchema = new Schema(
  { key: String, name: String, min: Number, multiplier: Number },
  { _id: false },
);

// A single document (key: 'main') holds brand, hours and every business rule the server reads.
const restaurantSchema = baseSchema({
  key: { type: String, default: 'main', unique: true },
  name: { type: String, default: 'ÉLAN' },
  tagline: String,
  description: String,
  address: {
    line1: String,
    area: String,
    city: String,
    postcode: String,
    country: { type: String, default: 'Bangladesh' },
    mapUrl: String,
  },
  geo: { lat: Number, lng: Number },
  phone: String,
  email: String,
  social: { instagram: String, facebook: String, youtube: String },
  hours: [hoursSchema],
  closedDates: [{ date: String, reason: String, _id: false }], // 'YYYY-MM-DD'

  acceptingOrders: { type: Boolean, default: true },
  acceptingReservations: { type: Boolean, default: true },

  currency: { type: String, default: 'BDT' },
  currencySymbol: { type: String, default: '৳' },
  taxLabel: { type: String, default: 'VAT' },
  taxRate: { type: Number, default: 0.05, min: 0, max: 0.5 },
  serviceChargeRate: { type: Number, default: 0.1, min: 0, max: 0.3 }, // dine-in only

  delivery: {
    baseFee: { type: Number, default: 120 },
    freeOver: { type: Number, default: 3000 },
    minOrder: { type: Number, default: 600 },
    radiusKm: { type: Number, default: 10 },
    etaMinutes: { type: Number, default: 45 },
    areas: [String],
  },
  pickup: { etaMinutes: { type: Number, default: 25 } },
  dineIn: { etaMinutes: { type: Number, default: 20 } },

  loyalty: {
    earnPerTaka: { type: Number, default: 0.1 }, // 1 point per ৳10
    pointValue: { type: Number, default: 0.5 }, // each point is worth ৳0.5 at checkout
    minRedeem: { type: Number, default: 100 },
    signupBonus: { type: Number, default: 50 },
    referralBonus: { type: Number, default: 150 },
    birthdayBonus: { type: Number, default: 200 },
    tiers: { type: [tierSchema], default: DEFAULT_TIERS },
  },

  reservation: {
    maxGuests: { type: Number, default: 12 },
    advanceDays: { type: Number, default: 60 },
    minLeadMinutes: { type: Number, default: 60 },
    cancelBeforeHours: { type: Number, default: 4 },
    autoConfirm: { type: Boolean, default: true },
    seatingDurationMin: { type: Number, default: 90 },
    seatings: { type: [String], default: ['12:00', '13:30', '15:00', '18:00', '19:30', '21:00'] },
  },

  autoDisableOutOfStock: { type: Boolean, default: false },

  chef: { name: String, title: String, bio: String },
  chefsSpecial: { type: ObjectId, ref: 'MenuItem' },
});

export const Restaurant = defineModel('Restaurant', restaurantSchema);
