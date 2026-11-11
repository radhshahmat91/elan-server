import { baseSchema, defineModel, Schema, ObjectId } from './_base.js';
import { RESERVATION_STATUSES, SEATING_PREFERENCES } from './constants.js';

const historySchema = new Schema(
  {
    status: { type: String, enum: RESERVATION_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    by: { id: ObjectId, name: String, role: String },
    note: { type: String, maxlength: 300 },
  },
  { _id: false },
);

const reservationSchema = baseSchema({
  code: { type: String, required: true, unique: true }, // RV-XXXXXX
  publicId: { type: String, required: true, unique: true }, // unguessable manage link
  user: { type: ObjectId, ref: 'User', default: null, index: true },
  guestName: { type: String, required: true, maxlength: 80 },
  phone: { type: String, required: true, maxlength: 24 },
  email: { type: String, lowercase: true, maxlength: 160 },

  date: { type: String, required: true, index: true }, // 'YYYY-MM-DD' restaurant time
  seating: { type: String, required: true }, // 'HH:mm', one of Restaurant.reservation.seatings
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  guests: { type: Number, required: true, min: 1, max: 40 },
  table: { type: ObjectId, ref: 'Table', required: true },
  seatingPreference: { type: String, enum: SEATING_PREFERENCES, default: 'any' },
  occasion: { type: String, maxlength: 60 },
  specialRequests: { type: String, maxlength: 500 },

  status: { type: String, enum: RESERVATION_STATUSES, default: 'pending', index: true },
  history: [historySchema],

  // True while the booking occupies its table. The partial unique index below makes double booking
  // impossible even when two requests arrive at the same moment.
  holdsTable: { type: Boolean, default: true },
  isDemo: { type: Boolean, default: false },
});

reservationSchema.index(
  { table: 1, date: 1, seating: 1 },
  { unique: true, partialFilterExpression: { holdsTable: true } },
);
reservationSchema.index({ date: 1, status: 1 });

export const Reservation = defineModel('Reservation', reservationSchema);
