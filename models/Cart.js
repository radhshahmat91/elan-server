import { baseSchema, defineModel, Schema, ObjectId } from './_base.js';

const selectionSchema = new Schema(
  { group: { type: String, required: true }, choices: [{ type: String }] },
  { _id: false },
);

const cartItemSchema = new Schema(
  {
    menuItem: { type: ObjectId, ref: 'MenuItem', required: true },
    quantity: { type: Number, required: true, min: 1, max: 20 },
    selections: [selectionSchema],
    note: { type: String, maxlength: 200 },
  },
  { _id: false },
);

// Signed-in customers keep their cart on the server. Guests keep it in the browser.
// Prices are never stored here; they are recalculated by the server on every quote.
const cartSchema = baseSchema({
  user: { type: ObjectId, ref: 'User', required: true, unique: true },
  items: { type: [cartItemSchema], default: [] },
});

export const Cart = defineModel('Cart', cartSchema);
