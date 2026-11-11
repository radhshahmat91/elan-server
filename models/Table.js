import { baseSchema, defineModel } from './_base.js';
import { TABLE_SECTIONS } from './constants.js';

const tableSchema = baseSchema({
  number: { type: String, required: true, unique: true, trim: true, maxlength: 12 }, // printed on the QR card
  name: { type: String, maxlength: 40 },
  capacity: { type: Number, required: true, min: 1, max: 40 },
  section: { type: String, enum: TABLE_SECTIONS, default: 'indoor' },
  active: { type: Boolean, default: true },
  qrToken: { type: String }, // stable random value embedded in the QR link to deter guessing
});

export const Table = defineModel('Table', tableSchema);
