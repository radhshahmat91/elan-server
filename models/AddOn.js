import { baseSchema, defineModel, Schema } from './_base.js';

const choiceSchema = new Schema(
  {
    key: { type: String, required: true }, // stable id inside the group, e.g. 'truffle-mayo'
    name: { type: String, required: true, maxlength: 80 },
    nameBn: { type: String, maxlength: 100 },
    priceDelta: { type: Number, default: 0 }, // whole BDT added per unit; may be 0
    isDefault: { type: Boolean, default: false },
    available: { type: Boolean, default: true },
  },
  { _id: false },
);

// A reusable modifier group ("Cooking level", "Sauces", "Size"). Menu items reference groups by id;
// carts and orders reference them by `key` and the choice `key`.
const addOnSchema = baseSchema({
  key: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, maxlength: 80 },
  nameBn: { type: String, maxlength: 100 },
  helper: { type: String, maxlength: 160 },
  helperBn: { type: String, maxlength: 200 },
  isRequired: { type: Boolean, default: false },
  minSelect: { type: Number, default: 0, min: 0 },
  maxSelect: { type: Number, default: 1, min: 1 },
  choices: { type: [choiceSchema], default: [] },
  active: { type: Boolean, default: true },
});

export const AddOn = defineModel('AddOn', addOnSchema);
