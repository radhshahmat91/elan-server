// Hand-written sample copy for the demo history: reviews, chat threads, contact messages, notes and guests.
// Everything here is fictional and is stored with isDemo: true, so --reset removes it again.

export const GUESTS = [
  { name: 'Anika Rahman', phone: '+8801810000101', email: 'anika@elan.demo' },
  { name: 'Shakib Khan', phone: '+8801810000102' },
  { name: 'Lubna Akter', phone: '+8801810000103', email: 'lubna@elan.demo' },
  { name: 'Tanvir Islam', phone: '+8801810000104' },
  { name: 'Ruma Das', phone: '+8801810000105', email: 'ruma@elan.demo' },
  { name: 'Kamal Hossain', phone: '+8801810000106' },
  { name: 'Mim Sarker', phone: '+8801810000107', email: 'mim@elan.demo' },
  { name: 'Asif Mahmud', phone: '+8801810000108' },
  { name: 'Priya Sen', phone: '+8801810000109', email: 'priya@elan.demo' },
  { name: 'Jubayer Alam', phone: '+8801810000110' },
  { name: 'Fariha Noor', phone: '+8801810000111', email: 'fariha@elan.demo' },
  { name: 'Salman Rafi', phone: '+8801810000112' },
];

export const ITEM_NOTES = [
  'No coriander, please.',
  'Extra crispy, please.',
  'Allergic to peanuts. Thank you.',
  'Less salt, please.',
  'Sauce on the side.',
  'Cut it in half for sharing.',
  'Please keep it mild for a child.',
];

export const ORDER_NOTES = [
  'Please call when you reach the gate.',
  'Leave it with the guard if I do not answer.',
  'No cutlery needed, thank you.',
  'Please ring the bell once, the baby is asleep.',
  'Second floor, the door with the green mat.',
];

// ------------------------------------------------------------------------------------------------ reviews
// Whole-visit reviews, by star rating.
export const VISIT_REVIEWS = {
  5: [
    { title: 'Worth every taka', body: 'Ordered for four on a Friday and everything arrived hot and properly packed. The ilish was the best I have had outside my mother\'s kitchen.' },
    { title: 'Candlelit and calm', body: 'We booked the window table for our anniversary. The staff noticed, brought something small for dessert and did not make a fuss about it. We will be back.' },
    { title: 'Delivery done right', body: 'The rider called before arriving, the food was still steaming, and the sauces came in separate pots. That is rare in Dhaka.' },
    { title: 'Brunch that earns the drive', body: 'The french toast alone is worth the trip. Good coffee, nobody hurries you, and the room is lovely at noon.' },
    { title: 'You can tell they care', body: 'Portions are generous, the seasoning is confident, and the Bengali touches on a European menu actually work.' },
    { title: 'Our new regular', body: 'Third order this month and not a miss. The packaging is neat and the notes I add are always followed.' },
  ],
  4: [
    { title: 'Very good, a little slow', body: 'The food was excellent. Delivery took about ten minutes longer than the estimate, but the rider apologised and everything was still warm.' },
    { title: 'Lovely evening', body: 'Great food and a calm room. The terrace is warm before sunset, so I would book after six.' },
    { title: 'A strong menu', body: 'Everything we tried was good and two dishes were great. I would like a few more vegetarian mains.' },
    { title: 'Fair for Gulshan', body: 'Portions are fair and nothing felt rushed. We would order again.' },
  ],
  3: [
    { title: 'Good food, bumpy service', body: 'The mains were lovely, but our starters arrived after them and nobody said anything until we asked.' },
    { title: 'Decent', body: 'Tasty overall, though the biryani was milder than the spice level I picked. The packaging was fine.' },
  ],
  2: [
    { title: 'Lukewarm on arrival', body: 'The flavours are good, but everything was lukewarm after a long ride. The team refunded part of it quickly, which I appreciated.' },
  ],
  1: [
    { title: 'Items missing', body: 'Two dishes were missing from the bag and the phone line was busy. The manager wrote back the next morning and put it right.' },
  ],
};

// Dish-specific reviews, then generic ones for any dish.
export const ITEM_REVIEWS = {
  'ilish-bhapa': [
    { rating: 5, title: 'Mustard done properly', body: 'Steamed in banana leaf with real mustard heat and soft rice on the side. It tastes like a Sunday at home.' },
    { rating: 4, title: 'Bony, as hilsa should be', body: 'Beautifully cooked and seasoned. A warning for newcomers: it is a bony fish, so take your time.' },
  ],
  'grass-fed-ribeye': [
    { rating: 5, title: 'Cooked exactly as asked', body: 'Medium rare means medium rare here. A proper crust from the charcoal, and the peppercorn sauce is worth the extra.' },
    { rating: 3, title: 'Great steak, bare plate', body: 'The meat was excellent but the plate felt expensive without a side. Order the truffle mash.' },
  ],
  'dhakaiya-kacchi-biryani': [
    { rating: 5, title: 'A proper kacchi', body: 'Long fragrant rice, mutton that falls off the bone, and the borhani cut the richness. Hot really is hot.' },
    { rating: 4, title: 'Rich and generous', body: 'It could feed two with a starter. I would ask for a little less ghee next time.' },
  ],
  'dark-chocolate-fondant': [
    { rating: 5, title: 'Molten on cue', body: 'I broke it open and the centre ran out the way it should. Gone in four minutes.' },
  ],
  'burrata-roasted-tomato': [
    { rating: 5, title: 'Simple and perfect', body: 'Cold burrata, warm tomatoes and a lot of basil oil. We ordered a second one for the table.' },
  ],
  'brioche-french-toast': [
    { rating: 5, title: 'Breakfast for dessert lovers', body: 'A crisp edge, a custardy middle and mascarpone melting on top. Share it or do not; we will not judge.' },
    { rating: 4, title: 'Sweet, but lovely', body: 'Quite sweet, so I added the smoked salmon. Excellent either way.' },
  ],
  'wild-mushroom-risotto': [{ rating: 4, title: 'Earthy and comforting', body: 'Properly creamy rice with good mushrooms. A touch more salt would have made it sing.' }],
  'tiger-prawn-linguine': [{ rating: 4, title: 'Fresh prawns, gentle chilli', body: 'The prawns were sweet and perfectly cooked. I picked hot and it tasted medium, so ask for extra.' }],
  'mango-lassi': [{ rating: 5, title: 'The right amount of sweet', body: 'Thick, cold and tastes of mango rather than syrup.' }],
  'masala-chai': [{ rating: 5, title: 'A proper cup', body: 'Strong, spiced and not too sweet. Better than most chai places.' }],
  'orange-zest-cold-brew': [{ rating: 4, title: 'Bright and clean', body: 'Smooth, with a fresh orange note. Very good with the almond croissant.' }],
  'cardamom-panna-cotta': [{ rating: 5, title: 'Delicate', body: 'Wobbly, fragrant and not heavy. A good ending after the biryani.' }],
  'seared-scallops-cauliflower': [{ rating: 5, title: 'Restaurant quality', body: 'Caramelised outside, sweet inside, and the purée was silky.' }],
  'slow-braised-lamb-shank': [{ rating: 5, title: 'Falls off the bone', body: 'Cooked for hours and it shows. Scoop up the sauce with rice.' }],
  'mushroom-wellington': [{ rating: 4, title: 'A vegetarian main with occasion', body: 'Crisp pastry and a deep mushroom filling. The gravy could be a little hotter.' }],
};

export const GENERIC_ITEM_REVIEWS = {
  5: [
    { title: 'Excellent', body: 'Fresh, well seasoned and exactly as described. I would order it again tomorrow.' },
    { title: 'Everything I hoped for', body: 'Beautifully made, with a clear idea behind it. Hot, generous and on time.' },
  ],
  4: [
    { title: 'Very good', body: 'Well made and generous. Small things kept it from five stars, but I would happily order it again.' },
  ],
  3: [{ title: 'Good, not memorable', body: 'Nicely cooked, but I expected a little more from the price.' }],
};

// A spam review that the moderator rejected, so the moderation queue has all three states.
export const SPAM_REVIEW = { rating: 1, title: 'Cheap deals here', body: 'Skip this place and see cheap-food-offers.example for much better prices on everything.' };

export const REVIEW_REPLIES = {
  low: 'Thank you for telling us, and I am sorry the evening did not go as it should have. We have talked it through with the team. Message us the next time you order and we will look after you.',
  high: 'Thank you, that means a great deal to the whole kitchen. We hope to see you again soon.',
  by: { low: 'Chef Tahmina', high: 'Team ÉLAN' },
};

// ------------------------------------------------------------------------------------------------ chat
export const CHATS = [
  {
    key: 'late', customer: 'rahim', subject: 'My order is taking long', status: 'open', assignedTo: 'manager', startedMinutesAgo: 95, isLastFromCustomer: true,
    lines: [
      { from: 'customer', after: 0, body: 'Hi, my order has been preparing for 35 minutes. Is everything okay?' },
      { from: 'bot', after: 0, body: 'ACK' },
      { from: 'staff', after: 6, body: 'Hello Rahim, sorry for the wait. The kitchen has a large table tonight. Your order is on the pass now and the rider leaves in a few minutes.' },
      { from: 'customer', after: 14, body: 'Thank you. Could you also add napkins and extra chilli oil?' },
    ],
  },
  {
    key: 'allergy', customer: 'nusrat', subject: 'A question about nuts', status: 'closed', assignedTo: 'manager', startedMinutesAgo: 60 * 30, isLastFromCustomer: false,
    lines: [
      { from: 'customer', after: 0, body: 'Is there any nut in the steamed hilsa? My daughter has a nut allergy.' },
      { from: 'bot', after: 0, body: 'ACK' },
      { from: 'staff', after: 9, body: 'No, the steamed hilsa has no nuts in it. We do cook in a single kitchen, though, so I cannot rule out a trace entirely. If you put the allergy in the order note, the chef will take extra care.' },
      { from: 'customer', after: 12, body: 'Thank you, I will put it in the note and order.' },
    ],
  },
  {
    key: 'birthday', customer: 'sadia', subject: 'Birthday dinner for ten', status: 'open', assignedTo: 'manager', startedMinutesAgo: 60 * 5, isLastFromCustomer: false,
    lines: [
      { from: 'customer', after: 0, body: 'Hi! I am planning a birthday dinner for ten in a couple of weeks. Can we use the Garden Room?' },
      { from: 'bot', after: 0, body: 'ACK' },
      { from: 'staff', after: 20, body: 'Hello Sadia, yes, the Garden Room seats up to twelve with a set menu. What time were you thinking of? I can hold it for you while you decide.' },
    ],
  },
];

// ------------------------------------------------------------------------------------------------ contact form
export const CONTACTS = [
  { name: 'Lamia Chowdhury', email: 'lamia.c@elan.demo', phone: '+8801910000201', subject: 'Private dinner for twelve', message: 'We would like to host a fortieth birthday dinner for twelve on a Saturday in December. Could you send the set menu options and a price per head?', status: 'new', daysAgo: 0 },
  { name: 'Zubair Anwar', email: 'zubair@elan.demo', phone: '', subject: 'Lunch orders for our office', message: 'We are an office of thirty in Gulshan and would like to order lunch on Thursdays. Do you take standing orders, and is there a corporate rate?', status: 'new', daysAgo: 1 },
  { name: 'Daniel Foster', email: 'daniel@elan.demo', phone: '', subject: 'Feature for a city magazine', message: 'I write about restaurants for a city magazine and would like to visit and speak with the chef. Who is the best person to talk to about dates?', status: 'read', daysAgo: 3, note: 'Forwarded to the owner. Waiting for her dates.' },
  { name: 'Shafiqul Alam', email: 'shafiqul@elan.demo', phone: '+8801910000204', subject: 'Allergy question before booking', message: 'My son has a sesame allergy. Which dishes are safe, and can the kitchen avoid cross-contact?', status: 'replied', daysAgo: 6, note: 'Replied with the verified allergen list and a note about the shared kitchen.' },
  { name: 'Rumana Haque', email: 'rumana@elan.demo', phone: '', subject: 'Left a scarf on Friday', message: 'I think I left a grey wool scarf on the back of a chair at the window table on Friday evening. Has anyone found it?', status: 'archived', daysAgo: 12, note: 'Found and collected on Sunday.' },
];

// ------------------------------------------------------------------------------------------------ reservations
export const OCCASIONS = ['Birthday', 'Anniversary', 'Business dinner', 'Date night', 'Family gathering', 'Graduation dinner'];
export const REQUESTS = [
  'A quiet corner if possible.',
  'One guest uses a wheelchair, so we need room to move.',
  'A high chair for a toddler, please.',
  'One guest has a nut allergy.',
  'We will bring a small cake. Please keep it in the fridge until dessert.',
  'Three of us are vegetarian.',
  'Window seat if one is free.',
];

// ------------------------------------------------------------------------------------------------ audit trail
// Written as: actor key, action, entity type, summary. Times are spread over the last weeks.
export const AUDIT = [
  { by: 'owner', action: 'settings.update', type: 'restaurant', summary: 'Changed the delivery fee and the free-delivery threshold', daysAgo: 41 },
  { by: 'manager', action: 'menu.create', type: 'menu_item', summary: 'Added Mushroom Wellington to Mains', daysAgo: 33 },
  { by: 'manager', action: 'coupon.create', type: 'coupon', summary: 'Created coupon BRUNCH100', daysAgo: 29 },
  { by: 'manager', action: 'menu.update', type: 'menu_item', summary: 'Put Almond Croissant on sale: ৳380 to ৳320', daysAgo: 24 },
  { by: 'owner', action: 'staff.create', type: 'user', summary: 'Invited Rakib Chowdhury as a rider', daysAgo: 20 },
  { by: 'manager', action: 'inventory.adjust', type: 'ingredient', summary: 'Wrote off 1.5 kg of wild mushrooms as waste', daysAgo: 16 },
  { by: 'manager', action: 'loyalty.adjust', type: 'user', summary: 'Added 100 goodwill points after a late delivery', daysAgo: 14 },
  { by: 'manager', action: 'review.moderate', type: 'review', summary: 'Rejected a review that advertised another business', daysAgo: 11 },
  { by: 'manager', action: 'payment.refund', type: 'order', summary: 'Partial refund of ৳300 for a lukewarm order', daysAgo: 9 },
  { by: 'owner', action: 'menu.update', type: 'menu_item', summary: 'Set Ilish Bhapa as the chef\'s special', daysAgo: 6 },
  { by: 'manager', action: 'reservation.status', type: 'reservation', summary: 'Marked a reservation as a no-show', daysAgo: 4 },
  { by: 'manager', action: 'analytics.export', type: 'orders', summary: 'Exported orders as CSV', daysAgo: 2 },
];
