// Shared enums. The client mirrors these in client/lib/constants.ts.
export { ROLES, STAFF_ROLES } from '../utils/permissions.js';

export const USER_STATUSES = ['active', 'suspended', 'deleted'];

export const FULFILLMENT = ['delivery', 'pickup', 'dine_in'];

// card, bkash and nagad are all served by the sandbox payment provider in this build.
export const PAYMENT_METHODS = ['cod', 'card', 'bkash', 'nagad'];
export const PAYMENT_STATUSES = ['unpaid', 'cash_due', 'pending', 'paid', 'failed', 'refunded', 'partially_refunded'];

// pending_payment -> placed -> confirmed -> preparing -> ready -> out_for_delivery -> delivered
// cancelled / rejected can end the flow early (see services/orderService.js for the allowed transitions).
export const ORDER_STATUSES = [
  'pending_payment', 'placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled', 'rejected',
];
export const ACTIVE_ORDER_STATUSES = ['placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery'];
export const FINAL_ORDER_STATUSES = ['delivered', 'cancelled', 'rejected'];

export const RESERVATION_STATUSES = ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'];
export const TABLE_SECTIONS = ['indoor', 'outdoor', 'window', 'private'];
export const SEATING_PREFERENCES = ['any', ...TABLE_SECTIONS];

export const DIETARY_TAGS = [
  'vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'nut-free', 'spicy', 'chef-pick', 'signature', 'new',
];
export const ALLERGENS = ['gluten', 'dairy', 'egg', 'nuts', 'peanuts', 'shellfish', 'fish', 'soy', 'sesame', 'mustard'];

export const COUPON_TYPES = ['percent', 'fixed', 'free_delivery'];
export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'];
export const LOYALTY_TYPES = ['earn', 'redeem', 'adjust', 'bonus', 'referral', 'birthday', 'refund'];
export const NOTIFICATION_TYPES = ['order', 'reservation', 'promo', 'system', 'chat', 'stock', 'review'];
export const STOCK_TXN_TYPES = ['in', 'out', 'adjust', 'waste', 'order'];
export const INGREDIENT_UNITS = ['g', 'kg', 'ml', 'l', 'pcs'];
export const GALLERY_CATEGORIES = ['food', 'restaurant', 'kitchen', 'events'];
export const CONTACT_STATUSES = ['new', 'read', 'replied', 'archived'];

// Default loyalty tiers (editable in Restaurant.loyalty.tiers).
export const DEFAULT_TIERS = [
  { key: 'initie', name: 'Initié', min: 0, multiplier: 1 },
  { key: 'habitue', name: 'Habitué', min: 1000, multiplier: 1.25 },
  { key: 'elite', name: 'Élite', min: 3000, multiplier: 1.5 },
];

// Art motifs understood by the client's generative <DishArt/> component.
export const ART_MOTIFS = [
  'french-toast', 'shakshuka', 'parfait', 'croissant', 'burrata', 'risotto', 'burger', 'linguine', 'soup',
  'scallops', 'ribeye', 'lamb', 'hilsa', 'biryani', 'wellington', 'fondant', 'pannacotta', 'tiramisu', 'tart',
  'spritz', 'coldbrew', 'chai', 'lassi', 'tonic', 'soda', 'espresso',
];
