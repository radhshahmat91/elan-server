import { baseSchema, defineModel, ObjectId } from './_base.js';

const categorySchema = baseSchema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  description: { type: String, maxlength: 300 },
  parent: { type: ObjectId, ref: 'Category', default: null, index: true }, // null = top level
  sortOrder: { type: Number, default: 0 },
  image: { url: String, alt: String },
  art: { motif: String, palette: [String] }, // fallback art for category tiles
  active: { type: Boolean, default: true },
});

categorySchema.index({ parent: 1, sortOrder: 1 });

export const Category = defineModel('Category', categorySchema);
