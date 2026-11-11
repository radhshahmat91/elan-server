import { baseSchema, defineModel, Schema, ObjectId, Mixed } from './_base.js';
import { NOTIFICATION_TYPES } from './constants.js';

const notificationSchema = baseSchema({
  user: { type: ObjectId, ref: 'User', index: true }, // recipient (audience 'user')
  audience: { type: String, enum: ['user', 'staff'], default: 'user' },
  roles: [{ type: String }], // staff notifications: which roles should see it
  type: { type: String, enum: NOTIFICATION_TYPES, required: true },
  title: { type: String, required: true, maxlength: 120 },
  body: { type: String, maxlength: 400 },
  link: { type: String, maxlength: 200 },
  data: { type: Mixed },
  readAt: { type: Date, default: null },
  readBy: [{ type: ObjectId, ref: 'User' }], // staff notifications are read per person
  email: {
    status: { type: String, enum: ['none', 'queued', 'sent', 'failed'], default: 'none' },
    error: String,
  },
  isDemo: { type: Boolean, default: false },
});

notificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ audience: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 }); // keep 90 days

export const Notification = defineModel('Notification', notificationSchema);
