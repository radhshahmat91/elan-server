import { baseSchema, defineModel, ObjectId } from './_base.js';

const addressSchema = baseSchema({
  user: { type: ObjectId, ref: 'User', required: true, index: true },
  label: { type: String, default: 'Home', maxlength: 30 },
  recipient: { type: String, maxlength: 80 },
  phone: { type: String, maxlength: 24 },
  line1: { type: String, required: true, maxlength: 160 },
  area: { type: String, required: true, maxlength: 80 },
  city: { type: String, default: 'Dhaka', maxlength: 60 },
  postcode: { type: String, maxlength: 12 },
  notes: { type: String, maxlength: 200 },
  isDefault: { type: Boolean, default: false },
});

export const Address = defineModel('Address', addressSchema);
