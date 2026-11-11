import mongoose from 'mongoose';

export const { Schema } = mongoose;
export const ObjectId = Schema.Types.ObjectId;
export const Mixed = Schema.Types.Mixed;

/**
 * Every schema gets timestamps and a JSON shape with `id` (string) instead of `_id`/`__v`.
 * Extra `hidden` paths are stripped from JSON output (for example password hashes).
 */
export function baseSchema(definition, { hidden = [], ...options } = {}) {
  const schema = new Schema(definition, { timestamps: true, ...options });
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform(_doc, ret) {
      ret.id = String(ret._id);
      delete ret._id;
      for (const path of hidden) delete ret[path];
      return ret;
    },
  });
  schema.set('toObject', { virtuals: true, versionKey: false });
  return schema;
}

/** Registers a model once (safe with hot reload and tests). */
export function defineModel(name, schema) {
  return mongoose.models[name] || mongoose.model(name, schema);
}
