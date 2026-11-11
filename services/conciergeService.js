// The Concierge: a rule-based assistant. It is NOT a language model and says so.
// It matches the guest's words against three sources and states nothing from anywhere else:
//   1. live restaurant data (hours, delivery, reservations, loyalty, payments)
//   2. the live menu (dietary tags, categories, budget, popularity)
//   3. the approved FAQ written by the team
// Everything below the "pure" line is deterministic and unit tested.
import { Category, Faq, MenuItem } from '../models/index.js';
import { serializeMenuItem } from '../serializers/menu.js';
import { escapeRegex } from '../utils/http.js';
import { bdt } from '../utils/format.js';
import { computeOpenState, getRestaurant } from './restaurantService.js';

// bdt() rounds to whole taka; a loyalty point can be worth a fraction of one.
const taka = (n) => (Number.isInteger(n) ? bdt(n) : `৳${n}`);

// ---------------------------------------------------------------------------------------------- pure

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const toAsciiDigits = (s) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

export const normalize = (text) =>
  toAsciiDigits(String(text ?? ''))
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{M}\p{N}৳'\s.,-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'are', 'can', 'what', 'how', 'does', 'have', 'with', 'this', 'that', 'from', 'about', 'there', 'any', 'get', 'will', 'would', 'could', 'please', 'tell', 'want', 'need', 'like', 'much', 'many', 'much']);

export const tokenize = (text) => (normalize(text).match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).filter((t) => t.length >= 3 && !STOP.has(t));

/** "under 800", "below ৳1,000", "less than 500 taka", "৮০০ টাকার নিচে" -> a whole-taka ceiling, or null. */
export function parseBudget(text) {
  const t = normalize(text).replace(/(\d),(\d{3})/g, '$1$2');
  const before = t.match(/(?:under|below|less than|within|max(?:imum)?|up ?to|cheaper than|budget(?: of)?|<)\s*(?:৳|tk\.?|bdt|taka)?\s*(\d{2,6})/);
  if (before) return Number(before[1]);
  const after = t.match(/(\d{2,6})\s*(?:৳|tk\.?|bdt|taka)?\s*(?:or less|or under|max|এর নিচে|টাকার নিচে|টাকার মধ্যে|টাকার কম)/);
  if (after) return Number(after[1]);
  const bn = t.match(/(?:বাজেট|সর্বোচ্চ)\s*(\d{2,6})/);
  return bn ? Number(bn[1]) : null;
}

const TAGS = [
  ['vegan', /\bvegan\b|ভেগান/],
  ['vegetarian', /\bvegetarian\b|\bveggie\b|\bveg\b|নিরামিষ|ভেজ/],
  ['gluten-free', /gluten/],
  ['dairy-free', /dairy[- ]?free|lactose|দুগ্ধমুক্ত/],
  ['nut-free', /nut[- ]?free|nut allerg/],
  ['spicy', /\bspicy\b|\bhot\b|\bchilli\b|\bchili\b|ঝাল/],
  ['chef-pick', /chef'?s? (?:pick|special|choice)|signature|শেফ/],
  ['new', /\bnew\b|latest|নতুন/],
];

const CATEGORIES = [
  ['breakfast', /breakfast|brunch|ব্রেকফাস্ট/],
  ['starters', /starter|appetis|appetiz|small plate|স্টার্টার/],
  ['mains', /\bmains?\b|entree|main course|মেইন|মূল পদ/],
  ['desserts', /dessert|sweet|cake|pudding|ice ?cream|মিষ্টি|ডেজার্ট/],
  ['drinks', /\bdrinks?\b|beverage|juice|coffee|\btea\b|cocktail|mocktail|lassi|পানীয়|ড্রিংক|(?:^|\s)চা(?=$|[\s.,-])|কফি/],
];

/** Pure. What the guest asked the menu for. `popular` and `recommend` pick by sales rather than by filter. */
export function detectMenuFilters(message) {
  const t = normalize(message);
  const tags = TAGS.filter(([, re]) => re.test(t)).map(([tag]) => tag);
  // "vegan" implies vegetarian-friendly search for the vegan tag only; keep exactly what was asked.
  const category = CATEGORIES.find(([, re]) => re.test(t))?.[0] ?? null;
  const maxPrice = parseBudget(message);
  const popular = /popular|best[- ]?sell|most (?:ordered|loved)|favou?rite|top (?:dish|pick)|জনপ্রিয়/.test(t);
  const recommend = /recommend|suggest|what should|what's good|whats good|surprise me|সাজেস্ট|রেকমেন্ড/.test(t);
  const any = tags.length > 0 || Boolean(category) || maxPrice != null || popular || recommend;
  return { tags, category, maxPrice, popular, recommend, any };
}

const RULES = [
  ['greeting', /^(?:hi|hello|hey|salam|assalamu alaikum|assalamualaikum|good (?:morning|afternoon|evening)|হ্যালো|হাই|সালাম|আসসালামু আলাইকুম|নমস্কার)[\s!.,]*$/],
  ['thanks', /^(?:thanks|thank you|thx|ty|cheers|ধন্যবাদ|শুক্রিয়া)[\s!.,]*$/],
  ['track', /track|where(?:'s| is) my (?:order|food)|order status|ট্র্যাক|অর্ডার.*কোথায়/],
  ['reservation', /reserv|book(?:ing)?(?: a)? table|table for|রিজার্ভ|টেবিল/],
  ['hours', /\bopen\b|opening|hours|closing|\bclose\b|what time|কখন|খোলা|বন্ধ|সময়/],
  ['delivery', /deliver|delivery|shipping|minimum order|free delivery|areas?\b|ডেলিভারি|এলাকা/],
  ['payment', /\bpay\b|payment|bkash|nagad|\bcard\b|\bcash\b|\bcod\b|পেমেন্ট|বিকাশ|নগদ|কার্ড/],
  ['loyalty', /points?\b|loyalty|reward|tier|membership|পয়েন্ট|লয়্যালটি/],
  ['contact', /contact|phone|call you|email|address|where are you|location|directions|find you|ঠিকানা|ফোন|যোগাযোগ/],
];

/** Pure. Names the first rule that matches, or 'menu' / 'none'. */
export function detectIntent(message) {
  const t = normalize(message);
  if (!t) return { intent: 'none', filters: detectMenuFilters('') };
  const filters = detectMenuFilters(message);
  for (const [intent, re] of RULES) {
    if (!re.test(t)) continue;
    // "what vegetarian dishes do you deliver?" is a menu question that happens to mention delivery.
    if (filters.any && !['greeting', 'thanks', 'track', 'reservation'].includes(intent) && (filters.tags.length || filters.category || filters.popular || filters.recommend)) continue;
    return { intent, filters };
  }
  return { intent: filters.any ? 'menu' : 'none', filters };
}

/** Pure. How well an FAQ answers the message: 2 per keyword hit, 1 per shared word in the question. */
export function scoreFaq(message, faq) {
  const msg = normalize(message);
  const words = new Set(tokenize(message));
  if (words.size === 0) return 0;
  let score = 0;
  for (const raw of [...(faq.keywords ?? []), ...(faq.keywordsBn ?? [])]) {
    const k = normalize(raw);
    if (!k) continue;
    if (k.includes(' ') ? msg.includes(k) : words.has(k)) score += 2;
  }
  for (const w of new Set([...tokenize(faq.question ?? ''), ...tokenize(faq.questionBn ?? '')])) if (words.has(w)) score += 1;
  return score;
}

export function bestFaq(message, faqs) {
  let best = null;
  for (const faq of faqs) {
    const score = scoreFaq(message, faq);
    if (score > (best?.score ?? 0)) best = { faq, score };
  }
  return best;
}

export const FAQ_STRONG = 4;
export const FAQ_WEAK = 2;

// ---------------------------------------------------------------------------------------------- copy

const COPY = {
  en: {
    greeting: 'Hello, welcome to ÉLAN. I can tell you about tonight\'s menu, our hours, delivery, reservations and rewards. What would you like to know?',
    thanks: 'You are very welcome. Is there anything else I can help with?',
    fallback: 'I am not sure I understood that. I can help with the menu (try "vegetarian dishes under 800"), opening hours, delivery, reservations, rewards, and payments. For anything else, the team is a message away.',
    how: { live: 'Answered from our live restaurant settings.', menu: 'Answered from our live menu.', faq: 'Answered from our approved FAQ.', rules: 'I match your words against our menu, hours and FAQ. I am a rule-based assistant, not an AI, so I only say what the restaurant has published.' },
    suggestions: ['Vegetarian dishes', 'What is popular?', 'Are you open now?', 'Delivery fee', 'Book a table'],
    allergy: 'Dietary tags are our kitchen\'s own labels. If you have a serious allergy, please check the dish page and tell us before ordering.',
    open: (r, s) => `${r.openNow ? 'We are open right now.' : 'We are closed right now.'} ${s}`,
    today: (h) => (h && !h.closed ? `Today we serve from ${h.open} to ${h.close}.` : 'We are closed today.'),
    week: (rows) => `Our weekly hours: ${rows}.`,
    delivery: (d, r) => `Delivery in Dhaka costs ${bdt(d.baseFee)} and is free over ${bdt(d.freeOver)}. The minimum order is ${bdt(d.minOrder)} and it usually takes about ${d.etaMinutes} minutes. Pickup is ready in about ${r.pickup?.etaMinutes ?? 25} minutes. We deliver to ${d.areas.join(', ')}.`,
    reservation: (c) => `You can book a table for up to ${c.maxGuests} guests, up to ${c.advanceDays} days ahead. ${c.autoConfirm ? 'Bookings are confirmed instantly.' : 'We confirm each booking shortly after you send it.'} You can change or cancel online until ${c.cancelBeforeHours} hours before.`,
    loyalty: (l) => `Every ${bdt(Math.round(1 / l.earnPerTaka))} you spend earns 1 point, and tiers earn faster. You get ${l.signupBonus} points for joining. From ${l.minRedeem} points you can spend them at checkout, each point worth ${taka(l.pointValue)}.`,
    payment: 'You can pay cash on delivery or at the table, or online with card, bKash or Nagad. In this build online payments run on a demonstration gateway, so no real money moves.',
    track: 'You can follow any order live with its tracking link, or look it up with your order number and phone.',
    contact: (r) => `You will find us at ${[r.address?.line1, r.address?.area, r.address?.city].filter(Boolean).join(', ')}. Phone: ${r.phone}.`,
    menuHeadline: (n, what) => `Here ${n === 1 ? 'is' : 'are'} ${n} ${what} from the menu:`,
    menuNone: 'I could not find a dish that matches all of that right now. Try loosening one of the filters.',
    describe: { dishes: 'dishes', under: (n) => `under ${bdt(n)}`, popular: 'most-ordered', recommend: 'good', chefPick: 'chef-pick', new: 'new' },
    links: { menu: 'See the full menu', reserve: 'Book a table', track: 'Track an order', rewards: 'Your rewards', contact: 'Contact us', hours: 'Visit and hours' },
  },
  bn: {
    greeting: 'আসসালামু আলাইকুম, ÉLAN-এ স্বাগতম। আজকের মেনু, খোলার সময়, ডেলিভারি, রিজার্ভেশন বা পুরস্কার পয়েন্ট নিয়ে জানতে পারেন। কী জানতে চান?',
    thanks: 'আপনাকেও ধন্যবাদ। আর কিছু জানতে চান?',
    fallback: 'কথাটা ঠিক বুঝতে পারিনি। আমি মেনু ("৮০০ টাকার নিচে নিরামিষ খাবার" লিখে দেখুন), খোলার সময়, ডেলিভারি, রিজার্ভেশন, পয়েন্ট আর পেমেন্ট নিয়ে সাহায্য করতে পারি। অন্য কিছুর জন্য আমাদের টিমকে বার্তা পাঠান।',
    how: { live: 'রেস্টুরেন্টের সর্বশেষ সেটিংস থেকে উত্তর।', menu: 'আমাদের সর্বশেষ মেনু থেকে উত্তর।', faq: 'আমাদের অনুমোদিত প্রশ্নোত্তর থেকে উত্তর।', rules: 'আমি আপনার শব্দের সঙ্গে আমাদের মেনু, সময়সূচি ও প্রশ্নোত্তর মিলিয়ে দেখি। আমি নিয়মভিত্তিক সহকারী, এআই নই, তাই রেস্টুরেন্ট যা প্রকাশ করেছে শুধু তা-ই বলি।' },
    suggestions: ['নিরামিষ খাবার', 'কোনটা জনপ্রিয়?', 'এখন কি খোলা?', 'ডেলিভারি চার্জ', 'টেবিল বুক'],
    allergy: 'খাবারের ট্যাগ আমাদের রান্নাঘরের নিজস্ব চিহ্ন। গুরুতর অ্যালার্জি থাকলে খাবারের পাতা দেখে নিন এবং অর্ডারের আগে আমাদের জানান।',
    open: (r, s) => `${r.openNow ? 'আমরা এখন খোলা আছি।' : 'আমরা এখন বন্ধ।'} ${s}`,
    today: (h) => (h && !h.closed ? `আজ আমরা ${h.open} থেকে ${h.close} পর্যন্ত খোলা।` : 'আজ আমরা বন্ধ।'),
    week: (rows) => `সাপ্তাহিক সময়সূচি: ${rows}।`,
    delivery: (d, r) => `ঢাকার ভেতরে ডেলিভারি চার্জ ${bdt(d.baseFee)}, ${bdt(d.freeOver)}-এর বেশি অর্ডারে বিনামূল্যে। ন্যূনতম অর্ডার ${bdt(d.minOrder)}, সাধারণত প্রায় ${d.etaMinutes} মিনিট লাগে। পিকআপ প্রস্তুত হয় প্রায় ${r.pickup?.etaMinutes ?? 25} মিনিটে। আমরা পৌঁছাই: ${d.areas.join(', ')}।`,
    reservation: (c) => `সর্বোচ্চ ${c.maxGuests} জনের জন্য, ${c.advanceDays} দিন আগে পর্যন্ত টেবিল বুক করা যায়। ${c.autoConfirm ? 'বুকিং সঙ্গে সঙ্গে নিশ্চিত হয়।' : 'বুকিং পাঠানোর কিছুক্ষণের মধ্যে আমরা নিশ্চিত করি।'} ${c.cancelBeforeHours} ঘণ্টা আগে পর্যন্ত অনলাইনে বদলানো বা বাতিল করা যায়।`,
    loyalty: (l) => `প্রতি ${bdt(Math.round(1 / l.earnPerTaka))} খরচে ১ পয়েন্ট, উচ্চ স্তরে আরও দ্রুত। যোগ দিলেই ${l.signupBonus} পয়েন্ট। ${l.minRedeem} পয়েন্ট থেকে চেকআউটে খরচ করা যায়, প্রতি পয়েন্টের মূল্য ${taka(l.pointValue)}।`,
    payment: 'ডেলিভারির সময় বা টেবিলে নগদে, কিংবা অনলাইনে কার্ড, বিকাশ বা নগদে দেওয়া যায়। এই সংস্করণে অনলাইন পেমেন্ট একটি ডেমো গেটওয়েতে চলে, তাই আসল টাকা কাটা হয় না।',
    track: 'ট্র্যাকিং লিংকে যেকোনো অর্ডার লাইভ দেখা যায়, অথবা অর্ডার নম্বর আর ফোন নম্বর দিয়ে খুঁজে নিন।',
    contact: (r) => `আমাদের ঠিকানা: ${[r.address?.line1, r.address?.area, r.address?.city].filter(Boolean).join(', ')}। ফোন: ${r.phone}।`,
    menuHeadline: (n, what) => `মেনু থেকে ${n}টি ${what} এখানে:`,
    menuNone: 'এই শর্তগুলো মিলিয়ে এখন কোনো খাবার পেলাম না। একটি ফিল্টার কমিয়ে চেষ্টা করুন।',
    describe: { dishes: 'খাবার', under: (n) => `${bdt(n)}-এর নিচে`, popular: 'সবচেয়ে বেশি অর্ডার হওয়া', recommend: 'ভালো', chefPick: 'শেফের পছন্দের', new: 'নতুন' },
    links: { menu: 'পুরো মেনু দেখুন', reserve: 'টেবিল বুক করুন', track: 'অর্ডার ট্র্যাক করুন', rewards: 'আপনার পুরস্কার', contact: 'যোগাযোগ', hours: 'ঠিকানা ও সময়' },
  },
};

const DAY_NAMES = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], bn: ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহ', 'শুক্র', 'শনি'] };

/** Pure. "Mon to Thu 12:00-23:00, Fri to Sat 12:00-23:30, Sun 12:00-22:30" from the hours table. */
export function summariseHours(hours, locale = 'en') {
  const names = DAY_NAMES[locale] ?? DAY_NAMES.en;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const rows = order.map((d) => (hours ?? []).find((h) => h.day === d)).filter(Boolean);
  const groups = [];
  for (const row of rows) {
    const label = row.closed ? (locale === 'bn' ? 'বন্ধ' : 'closed') : `${row.open}-${row.close}`;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.days.push(row.day);
    else groups.push({ label, days: [row.day] });
  }
  return groups.map((g) => `${g.days.length > 1 ? `${names[g.days[0]]}${locale === 'bn' ? ' থেকে ' : ' to '}${names[g.days[g.days.length - 1]]}` : names[g.days[0]]} ${g.label}`).join(', ');
}

/** Pure. "vegetarian, under ৳800 dishes" style description for the headline above menu results. */
export function describeFilters(filters, locale = 'en') {
  const c = COPY[locale] ?? COPY.en;
  const bits = [];
  if (filters.popular) bits.push(c.describe.popular);
  else if (filters.recommend && !filters.tags.length && !filters.category) bits.push(c.describe.recommend);
  for (const tag of filters.tags) bits.push(tag === 'chef-pick' ? c.describe.chefPick : tag === 'new' ? c.describe.new : tag.replace('-', ' '));
  const noun = filters.category ?? c.describe.dishes;
  const price = filters.maxPrice != null ? ` ${c.describe.under(filters.maxPrice)}` : '';
  return `${bits.length ? `${bits.join(', ')} ` : ''}${noun}${price}`.trim();
}

// ------------------------------------------------------------------------------------------ data-backed

const LIST_POPULATE = [
  { path: 'optionGroups', select: 'key isRequired minSelect active' },
  { path: 'category', select: 'name nameBn slug' },
];

async function categoryIdFor(key) {
  const re = { breakfast: /breakfast|brunch/i, starters: /starter|appeti|small/i, mains: /main|entr/i, desserts: /dessert|sweet/i, drinks: /drink|beverage/i }[key];
  if (!re) return null;
  const cats = await Category.find({ active: true }).select('name slug').lean();
  return cats.find((c) => re.test(c.name) || re.test(c.slug))?._id ?? null;
}

async function findMenu(filters, limit = 4) {
  const query = { archived: false, available: true };
  const tags = [...filters.tags];
  if (filters.category) {
    const id = await categoryIdFor(filters.category);
    if (id) query.category = id;
  }
  if (tags.length) query.tags = { $all: tags };
  if (filters.maxPrice != null) query.price = { $lte: filters.maxPrice };
  const sort = filters.popular || filters.recommend || !tags.length ? { soldCount: -1, featured: -1, name: 1 } : { featured: -1, soldCount: -1, name: 1 };
  const rows = await MenuItem.find(query).sort(sort).limit(limit).populate(LIST_POPULATE).lean();
  return rows.map((r) => serializeMenuItem(r));
}

async function searchByWords(message, limit = 4) {
  const words = [...new Set(tokenize(message))].filter((w) => w.length >= 4).slice(0, 4);
  if (words.length === 0) return [];
  const re = new RegExp(words.map(escapeRegex).join('|'), 'i');
  const rows = await MenuItem.find({ archived: false, available: true, $or: [{ name: re }, { nameBn: re }, { ingredients: re }, { description: re }] })
    .sort({ soldCount: -1 })
    .limit(limit)
    .populate(LIST_POPULATE)
    .lean();
  return rows.map((r) => serializeMenuItem(r));
}

const needsAllergyNote = (filters) => filters.tags.some((t) => ['vegan', 'vegetarian', 'gluten-free', 'dairy-free', 'nut-free'].includes(t));

/** The only entry point the route uses. Always resolves to { answer, items?, links?, suggestions?, how }. */
export async function answer(message, locale = 'en') {
  const lang = locale === 'bn' ? 'bn' : 'en';
  const c = COPY[lang];
  const reply = (fields) => ({ suggestions: c.suggestions, ...fields });
  const { intent, filters } = detectIntent(message);

  if (intent === 'greeting') return reply({ answer: c.greeting, how: c.how.rules });
  if (intent === 'thanks') return reply({ answer: c.thanks, how: c.how.rules });

  const faqs = await Faq.find({ active: true }).lean();
  const faq = bestFaq(message, faqs);
  const faqText = (f) => (lang === 'bn' && f.answerBn ? f.answerBn : f.answer);

  // A strong FAQ match wins over the generic rules, unless the guest is clearly asking the menu for something.
  if (faq && faq.score >= FAQ_STRONG && !(filters.tags.length || filters.category || filters.maxPrice != null || filters.popular)) {
    return reply({ answer: faqText(faq.faq), how: c.how.faq, links: [{ label: c.links.contact, href: '/contact' }] });
  }

  if (['hours', 'delivery', 'reservation', 'loyalty', 'payment', 'contact'].includes(intent)) {
    const restaurant = await getRestaurant();
    const state = computeOpenState(restaurant);
    switch (intent) {
      case 'hours':
        return reply({ answer: c.open(state, `${c.today(state.todayHours)} ${c.week(summariseHours(restaurant.hours, lang))}`), how: c.how.live, links: [{ label: c.links.hours, href: '/contact' }] });
      case 'delivery':
        return reply({ answer: c.delivery(restaurant.delivery, restaurant), how: c.how.live, links: [{ label: c.links.menu, href: '/menu' }] });
      case 'reservation':
        return reply({ answer: c.reservation(restaurant.reservation), how: c.how.live, links: [{ label: c.links.reserve, href: '/reservation' }] });
      case 'loyalty':
        return reply({ answer: c.loyalty(restaurant.loyalty), how: c.how.live, links: [{ label: c.links.rewards, href: '/account/rewards' }] });
      case 'payment':
        return reply({ answer: c.payment, how: c.how.live });
      default:
        return reply({ answer: c.contact(restaurant), how: c.how.live, links: [{ label: c.links.contact, href: '/contact' }] });
    }
  }
  if (intent === 'track') return reply({ answer: c.track, how: c.how.live, links: [{ label: c.links.track, href: '/track-order' }] });

  if (intent === 'menu') {
    const items = await findMenu(filters);
    if (items.length === 0) return reply({ answer: c.menuNone, how: c.how.menu, links: [{ label: c.links.menu, href: '/menu' }] });
    const note = needsAllergyNote(filters) ? `\n\n${c.allergy}` : '';
    return reply({ answer: `${c.menuHeadline(items.length, describeFilters(filters, lang))}${note}`, items, how: c.how.menu, links: [{ label: c.links.menu, href: '/menu' }] });
  }

  if (faq && faq.score >= FAQ_WEAK) return reply({ answer: faqText(faq.faq), how: c.how.faq, links: [{ label: c.links.contact, href: '/contact' }] });

  const byWord = await searchByWords(message);
  if (byWord.length) return reply({ answer: c.menuHeadline(byWord.length, lang === 'bn' ? 'খাবার' : 'dishes that mention that'), items: byWord, how: c.how.menu, links: [{ label: c.links.menu, href: '/menu' }] });

  return reply({ answer: c.fallback, how: c.how.rules, links: [{ label: c.links.contact, href: '/contact' }] });
}
