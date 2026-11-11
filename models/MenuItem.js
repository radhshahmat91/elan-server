import { baseSchema, defineModel, Schema, ObjectId } from './_base.js';
import { ALLERGENS, DIETARY_TAGS } from './constants.js';

const imageSchema = new Schema(
  {
    url: { type: String, required: true },
    alt: { type: String, maxlength: 200 },
    altBn: { type: String, maxlength: 240 },
    publicId: String, // Cloudinary id when uploaded through the admin
  },
  { _id: false },
);

// Generative art used when a dish has no photograph (see client/components/art/DishArt.tsx).
const artSchema = new Schema(
  { motif: String, palette: [String], seed: Number },
  { _id: false },
);

// Ingredient usage per portion; drives stock deduction when an order reaches "preparing".
const recipeSchema = new Schema(
  {
    ingredient: { type: ObjectId, ref: 'Ingredient', required: true },
    quantity: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const menuItemSchema = baseSchema({
  name: { type: String, required: true, trim: true, maxlength: 90 },
  nameBn: { type: String, trim: true, maxlength: 120 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  sku: { type: String, unique: true, sparse: true, trim: true },
  category: { type: ObjectId, ref: 'Category', required: true, index: true },
  description: { type: String, required: true, maxlength: 500 },
  descriptionBn: { type: String, maxlength: 700 },

  // Money is stored as whole BDT (integers).
  price: { type: Number, required: true, min: 0 },
  salePrice: { type: Number, min: 0, default: null },

  images: [imageSchema],
  art: artSchema,

  optionGroups: [{ type: ObjectId, ref: 'AddOn' }],

  tags: [{ type: String, enum: DIETARY_TAGS }],
  allergens: [{ type: String, enum: ALLERGENS }], // only verified claims
  spiceLevel: { type: Number, min: 0, max: 3, default: 0 },
  portion: { type: String, maxlength: 60 },
  portionBn: { type: String, maxlength: 80 },
  calories: { type: Number, min: 0 },
  ingredients: [String],
  ingredientsBn: [String],
  prepMinutes: { type: Number, default: 15, min: 1 },

  available: { type: Boolean, default: true },
  featured: { type: Boolean, default: false },
  newArrival: { type: Boolean, default: false },
  archived: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 },

  // Denormalised counters (kept up to date by orders and reviews).
  rating: {
    avg: { type: Number, default: 0, min: 0, max: 5 },
    count: { type: Number, default: 0, min: 0 },
  },
  soldCount: { type: Number, default: 0, min: 0 },
  viewCount: { type: Number, default: 0, min: 0 },

  recipe: [recipeSchema],
});

menuItemSchema.index({ category: 1, archived: 1, available: 1 });
menuItemSchema.index({ featured: 1, archived: 1 });
menuItemSchema.index({ soldCount: -1 });
menuItemSchema.index({ price: 1 });

export const MenuItem = defineModel('MenuItem', menuItemSchema);
