// Tables, FAQ, gallery and coupons. The FAQ deliberately avoids anything the live settings already answer
// (hours, delivery fees, reservation limits, loyalty rates), so it can never contradict them after an edit.
const DAY = 86_400_000;

export const TABLES = [
  { number: '1', capacity: 2, section: 'indoor' },
  { number: '2', capacity: 2, section: 'indoor' },
  { number: '3', capacity: 4, section: 'indoor' },
  { number: '4', capacity: 4, section: 'indoor' },
  { number: '5', capacity: 4, section: 'indoor' },
  { number: '6', capacity: 6, section: 'indoor' },
  { number: '7', capacity: 2, section: 'window' },
  { number: '8', capacity: 2, section: 'window' },
  { number: '9', capacity: 4, section: 'window' },
  { number: '10', capacity: 4, section: 'outdoor' },
  { number: '11', capacity: 4, section: 'outdoor' },
  { number: '12', capacity: 6, section: 'outdoor' },
  { number: '13', name: 'Arch Room', capacity: 8, section: 'private' },
  { number: '14', name: 'Garden Room', capacity: 12, section: 'private' },
];

const faq = (category, question, answer, keywords, sortOrder) => ({ category, question, answer, keywords, sortOrder });

export const FAQS = [
  faq('dining', 'Is your food halal?', 'Yes. All our meat is halal, and we do not serve alcohol.', ['halal', 'pork', 'haram'], 1),
  faq('dining', 'Do you serve alcohol?', 'No. Our bar makes alcohol-free drinks in house: spritzes, tonics, sodas, cold brew and chai.', ['alcohol', 'wine', 'beer', 'cocktail', 'drinks bar'], 2),
  faq('dining', 'Is there parking?', 'There is a small valet area at the front door. The road gets busy after 8 pm, so a ride-share to the door is often easiest.', ['parking', 'valet', 'car'], 3),
  faq('dining', 'Is there a dress code?', 'No dress code. Smart casual feels at home here, and so does whatever you wore to work.', ['dress', 'code', 'wear', 'attire'], 4),
  faq('dining', 'Are children welcome?', 'Very much. We have high chairs, and the kitchen will happily make a smaller, milder portion of most dishes. Just ask.', ['children', 'kids', 'child', 'baby', 'high chair', 'family'], 5),
  faq('dining', 'Is the restaurant step-free?', 'The entrance and the ground-floor washroom are step-free. Tell us when you book and we will give you a table with room to move.', ['accessible', 'accessibility', 'wheelchair', 'step', 'disabled', 'ramp'], 6),
  faq('dining', 'Can I host a private event?', 'The Arch Room seats 8 and the Garden Room up to 12, with a set menu. Send us the date and number of guests from the contact page and we will reply within a working day.', ['private', 'event', 'party', 'birthday', 'celebration', 'corporate', 'room'], 7),
  faq('dining', 'What if I am late for my reservation?', 'We hold your table for 15 minutes after your seating time. If you will be later than that, please call us.', ['late', 'delay', 'running late', 'hold', 'on time'], 8),
  faq('dietary', 'Do you have vegetarian or vegan dishes?', 'Yes. Use the Vegetarian and Vegan filters on the menu. Every dish page lists its tags and the allergens our kitchen has verified.', ['vegetarian', 'vegan', 'plant', 'meatless', 'veg'], 9),
  faq('dietary', 'I have a food allergy. What should I do?', 'Tell us when you order (use the note box) and again at the table. Dish pages list verified allergens, but we cook in one shared kitchen, so we cannot promise there will be no traces.', ['allergy', 'allergic', 'allergen', 'gluten', 'nut', 'peanut', 'celiac', 'intolerance'], 10),
  faq('dietary', 'Can I change a dish?', 'Choose from the options on each dish page. For anything else, add a note at checkout and the kitchen will tell you what is possible.', ['change', 'modify', 'substitute', 'without', 'swap', 'remove'], 11),
  faq('ordering', 'How do I track my order?', 'Open the tracking link shown after checkout. You can also go to Track order and enter your order number and phone number.', ['track', 'tracking', 'status', 'follow', 'where is my order'], 12),
  faq('ordering', 'Can I change or cancel an order?', 'You can cancel it yourself until the kitchen accepts it. After that, call us and we will see what we can do.', ['cancel', 'cancellation', 'edit order', 'change order', 'refund'], 13),
  faq('ordering', 'Can I order for a later time?', 'Not yet: an order starts when you place it. For a planned meal, reserve a table instead.', ['later', 'schedule', 'scheduled', 'in advance', 'pre-order', 'preorder'], 14),
  faq('ordering', 'Can I order from my table?', 'Yes. Scan the QR code on your table and order from your phone. There is nothing to install.', ['qr', 'scan', 'table order', 'order from table', 'dine in'], 15),
  faq('ordering', 'Something is wrong with my order. What now?', 'Message us from the contact page or the chat within 24 hours, with your order number. We will make it right with a remake or a refund.', ['wrong', 'missing', 'cold', 'problem', 'complaint', 'issue', 'damaged'], 16),
  faq('payments', 'Is paying online safe?', 'Card, bKash and Nagad payments happen on the payment provider\'s own page. We never see or store your card or wallet details. In this demo build the provider is a sandbox, so no real money moves.', ['safe', 'secure', 'security', 'online payment', 'card details'], 17),
  faq('rewards', 'Do my points expire?', 'Points do not expire while your account is active.', ['expire', 'expiry', 'expiration', 'points last', 'valid'], 18),
  faq('rewards', 'How does referring a friend work?', 'Share the referral code on your Rewards page. When a friend signs up with it and their first order is delivered, you earn bonus points.', ['refer', 'referral', 'friend', 'invite', 'code'], 19),
];

export const GALLERY = [
  { title: 'Ilish bhapa', alt: 'A steamed hilsa steak in mustard on a banana leaf', category: 'food', art: { motif: 'hilsa', seed: 131 } },
  { title: 'Ribeye off the charcoal', alt: 'A thick ribeye steak, sliced, on a wooden board', category: 'food', art: { motif: 'ribeye', seed: 113 } },
  { title: 'Burrata and tomato', alt: 'Burrata on roasted tomatoes with basil oil', category: 'food', art: { motif: 'burrata', seed: 53 } },
  { title: 'Chocolate fondant', alt: 'A chocolate pudding broken open, molten in the middle', category: 'food', art: { motif: 'fondant', seed: 163 } },
  { title: 'Kacchi biryani', alt: 'A plate of kacchi biryani with saffron rice', category: 'food', art: { motif: 'biryani', seed: 149 } },
  { title: 'The dining room', alt: 'The main dining room lit by low lamps', category: 'restaurant', art: { scene: 'dining-room', seed: 5 } },
  { title: 'The terrace at dusk', alt: 'The outdoor terrace as the light goes', category: 'restaurant', art: { scene: 'terrace', seed: 9 } },
  { title: 'A table set for two', alt: 'A window table set for two', category: 'restaurant', art: { scene: 'table-set', seed: 14 } },
  { title: 'The street outside', alt: 'The restaurant entrance on a Dhaka evening', category: 'restaurant', art: { scene: 'evening-street', seed: 21 } },
  { title: 'The pass', alt: 'Plates waiting at the pass of the kitchen', category: 'kitchen', art: { scene: 'kitchen-pass', seed: 27 } },
  { title: 'Chef Tahmina at work', alt: 'A chef\'s hands finishing a plate', category: 'kitchen', art: { scene: 'chef-hands', seed: 33 } },
  { title: 'The bread oven', alt: 'Loaves coming out of the wood-fired oven', category: 'kitchen', art: { scene: 'bread-oven', seed: 39 } },
  { title: 'Spices from Chawkbazar', alt: 'Sacks of whole spices at an Old Dhaka market', category: 'kitchen', art: { scene: 'market-spices', seed: 45 } },
  { title: 'The Arch Room', alt: 'The private room, set for eight', category: 'events', art: { scene: 'private-room', seed: 51 } },
  { title: 'The drinks bar', alt: 'The bar, with tonics and spritzes lined up', category: 'events', art: { scene: 'bar', seed: 57 } },
];

/** Coupons are built relative to "now" so the demo never ships with every offer already expired. */
export function couponData(now = new Date()) {
  const inDays = (n) => new Date(now.getTime() + n * DAY);
  return [
    {
      code: 'WELCOME10', type: 'percent', value: 10, maxDiscount: 300, minOrder: 800, firstOrderOnly: true, perUserLimit: 1, usageLimit: null,
      startsAt: null, expiresAt: inDays(120), appliesTo: [], active: true, showOnSite: true,
      description: '10% off your first order, up to ৳300.', headline: '10% off your first order', terms: 'Orders from ৳800. One use per guest. New accounts only.',
    },
    {
      code: 'FREESHIP', type: 'free_delivery', value: 0, maxDiscount: null, minOrder: 1500, firstOrderOnly: false, perUserLimit: 3, usageLimit: 500,
      startsAt: null, expiresAt: inDays(45), appliesTo: ['delivery'], active: true, showOnSite: true,
      description: 'Free delivery on orders from ৳1,500.', headline: 'Free delivery from ৳1,500', terms: 'Delivery orders only. Three uses per guest.',
    },
    {
      code: 'TABLE15', type: 'percent', value: 15, maxDiscount: 500, minOrder: 1500, firstOrderOnly: false, perUserLimit: 2, usageLimit: 300,
      startsAt: null, expiresAt: inDays(30), appliesTo: ['dine_in'], active: true, showOnSite: true,
      description: '15% off when you order from your table, up to ৳500.', headline: '15% off at the table', terms: 'Scan the QR code on your table. Orders from ৳1,500.',
    },
    {
      code: 'BRUNCH100', type: 'fixed', value: 100, maxDiscount: null, minOrder: 600, firstOrderOnly: false, perUserLimit: 5, usageLimit: null,
      startsAt: null, expiresAt: inDays(90), appliesTo: [], active: true, showOnSite: false,
      description: '৳100 off any order from ৳600.',
    },
    {
      code: 'EID2026', type: 'percent', value: 20, maxDiscount: 600, minOrder: 1200, firstOrderOnly: false, perUserLimit: 1, usageLimit: 200, usedCount: 200,
      startsAt: inDays(-150), expiresAt: inDays(-120), appliesTo: [], active: false, showOnSite: false,
      description: 'Festival offer. Ended.',
    },
  ];
}
