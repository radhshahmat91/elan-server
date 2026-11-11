import { baseSchema, defineModel, ObjectId } from './_base.js';

// Opaque session tokens: the browser holds the random token, the database holds only its SHA-256.
const sessionSchema = baseSchema(
  {
    user: { type: ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: Date.now },
    userAgent: { type: String, maxlength: 300 },
    ip: { type: String, maxlength: 64 },
  },
  { hidden: ['tokenHash'] },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL: Mongo deletes expired sessions

export const Session = defineModel('Session', sessionSchema);

const resetSchema = baseSchema({
  user: { type: ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date },
});
resetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordReset = defineModel('PasswordReset', resetSchema);
