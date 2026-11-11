import { baseSchema, defineModel, ObjectId, Mixed } from './_base.js';
import { CONTACT_STATUSES, GALLERY_CATEGORIES } from './constants.js';

// Who did what. Written for every sensitive administrative action.
const auditSchema = baseSchema(
  {
    actor: { id: ObjectId, name: String, role: String },
    action: { type: String, required: true, index: true }, // 'menu.update', 'order.status', 'staff.role' ...
    entity: { type: { type: String }, id: String },
    summary: { type: String, maxlength: 300 },
    meta: { type: Mixed }, // safe metadata only: never passwords, tokens or card data
    ip: { type: String, maxlength: 64 },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: 'at', updatedAt: false } },
);
auditSchema.index({ at: -1 });
auditSchema.index({ 'actor.id': 1, at: -1 });
export const AuditLog = defineModel('AuditLog', auditSchema);

const subscriberSchema = baseSchema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 160 },
  status: { type: String, enum: ['subscribed', 'unsubscribed'], default: 'subscribed' },
  consent: { type: Boolean, required: true },
  consentAt: { type: Date, default: Date.now },
  locale: { type: String, enum: ['en', 'bn'], default: 'en' },
  unsubscribeToken: { type: String, required: true, unique: true },
  unsubscribedAt: Date,
  isDemo: { type: Boolean, default: false },
});
export const Subscriber = defineModel('Subscriber', subscriberSchema);

const contactSchema = baseSchema({
  name: { type: String, required: true, maxlength: 80 },
  email: { type: String, required: true, lowercase: true, maxlength: 160 },
  phone: { type: String, maxlength: 24 },
  subject: { type: String, maxlength: 120 },
  message: { type: String, required: true, maxlength: 2000 },
  status: { type: String, enum: CONTACT_STATUSES, default: 'new', index: true },
  note: { type: String, maxlength: 400 },
  isDemo: { type: Boolean, default: false },
});
contactSchema.index({ createdAt: -1 });
export const ContactMessage = defineModel('ContactMessage', contactSchema);

// Approved answers the Concierge assistant may give. Nothing outside this content (and live
// restaurant data such as hours and delivery fees) is ever stated by the assistant.
const faqSchema = baseSchema({
  category: { type: String, default: 'general' },
  question: { type: String, required: true, maxlength: 200 },
  questionBn: { type: String, maxlength: 260 },
  answer: { type: String, required: true, maxlength: 800 },
  answerBn: { type: String, maxlength: 1000 },
  keywords: [{ type: String }],
  keywordsBn: [{ type: String }],
  sortOrder: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
});
export const Faq = defineModel('Faq', faqSchema);

// Gallery tiles: either a photograph URL or generative art ('art' is rendered by the client).
const gallerySchema = baseSchema({
  title: { type: String, required: true, maxlength: 80 },
  titleBn: { type: String, maxlength: 100 },
  alt: { type: String, required: true, maxlength: 200 },
  altBn: { type: String, maxlength: 240 },
  category: { type: String, enum: GALLERY_CATEGORIES, required: true, index: true },
  url: { type: String },
  publicId: { type: String },
  art: { scene: String, motif: String, palette: [String], seed: Number },
  sortOrder: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
});
export const GalleryItem = defineModel('GalleryItem', gallerySchema);
