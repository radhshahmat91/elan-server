import { baseSchema, defineModel, ObjectId } from './_base.js';
import { INGREDIENT_UNITS, STOCK_TXN_TYPES } from './constants.js';

const supplierSchema = baseSchema({
  name: { type: String, required: true, maxlength: 100 },
  contactName: { type: String, maxlength: 80 },
  phone: { type: String, maxlength: 24 },
  email: { type: String, maxlength: 160 },
  address: { type: String, maxlength: 200 },
  notes: { type: String, maxlength: 300 },
  active: { type: Boolean, default: true },
});
export const Supplier = defineModel('Supplier', supplierSchema);

const ingredientSchema = baseSchema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  sku: { type: String, unique: true, sparse: true },
  unit: { type: String, enum: INGREDIENT_UNITS, default: 'kg' },
  stock: { type: Number, default: 0 }, // current balance in `unit`
  lowStockThreshold: { type: Number, default: 0 },
  costPerUnit: { type: Number, default: 0 }, // whole BDT per unit
  supplier: { type: ObjectId, ref: 'Supplier', default: null },
  nearestExpiry: { type: Date, default: null },
  active: { type: Boolean, default: true },
});
ingredientSchema.index({ active: 1, name: 1 });
export const Ingredient = defineModel('Ingredient', ingredientSchema);

const stockTransactionSchema = baseSchema({
  ingredient: { type: ObjectId, ref: 'Ingredient', required: true, index: true },
  type: { type: String, enum: STOCK_TXN_TYPES, required: true },
  quantity: { type: Number, required: true }, // signed: stock-in > 0, usage/waste < 0
  balanceAfter: { type: Number, required: true },
  reason: { type: String, maxlength: 200 },
  order: { type: ObjectId, ref: 'Order' },
  supplier: { type: ObjectId, ref: 'Supplier' },
  unitCost: { type: Number },
  by: { id: ObjectId, name: String },
  isDemo: { type: Boolean, default: false },
});
stockTransactionSchema.index({ ingredient: 1, createdAt: -1 });
export const StockTransaction = defineModel('StockTransaction', stockTransactionSchema);
