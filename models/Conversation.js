import { baseSchema, defineModel, ObjectId } from './_base.js';

const conversationSchema = baseSchema({
  user: { type: ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
  subject: { type: String, maxlength: 120 },
  assignedTo: { type: ObjectId, ref: 'User', default: null },
  lastMessageAt: { type: Date, default: Date.now },
  lastMessagePreview: { type: String, maxlength: 160 },
  unreadForStaff: { type: Number, default: 0 },
  unreadForCustomer: { type: Number, default: 0 },
  isDemo: { type: Boolean, default: false },
});

conversationSchema.index({ status: 1, lastMessageAt: -1 });

export const Conversation = defineModel('Conversation', conversationSchema);

const messageSchema = baseSchema({
  conversation: { type: ObjectId, ref: 'Conversation', required: true, index: true },
  sender: { type: ObjectId, ref: 'User', default: null },
  senderRole: { type: String, enum: ['customer', 'staff', 'bot'], required: true },
  senderName: { type: String, maxlength: 80 },
  body: { type: String, required: true, maxlength: 2000 },
  readAt: { type: Date, default: null },
});

messageSchema.index({ conversation: 1, createdAt: 1 });

export const Message = defineModel('Message', messageSchema);
