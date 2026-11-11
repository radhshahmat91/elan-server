// The single Restaurant document: brand copy, opening hours and every business rule the server reads.
// All contact details are fictional. Replace them in Admin > Settings after deployment.
import { DEFAULT_TIERS } from '../../models/constants.js';

const hours = [
  { day: 0, open: '12:00', close: '22:30', closed: false }, // Sunday
  { day: 1, open: '12:00', close: '23:00', closed: false },
  { day: 2, open: '12:00', close: '23:00', closed: false },
  { day: 3, open: '12:00', close: '23:00', closed: false },
  { day: 4, open: '12:00', close: '23:00', closed: false },
  { day: 5, open: '12:00', close: '23:30', closed: false }, // Friday
  { day: 6, open: '12:00', close: '23:30', closed: false }, // Saturday
];

export function restaurantData() {
  return {
    key: 'main',
    name: 'ÉLAN',
    tagline: 'Candlelit dinners with Bengali instincts.',
    taglineBn: 'মোমবাতির আলোয় ডিনার, বাঙালি মেজাজে।',
    description:
      'ÉLAN is a small modern European dining room in Gulshan where the pantry is Bengali: hilsa, mustard, saffron, burnt chilli and the first rice of the season. Everything is cooked to order, for the table, for delivery or for collection.',
    descriptionBn:
      'গুলশানের ছোট্ট এই ডাইনিং রুমে রান্না আধুনিক ইউরোপীয়, কিন্তু ভাঁড়ার বাঙালি: ইলিশ, সরিষা, জাফরান, পোড়া মরিচ আর নতুন ধানের চাল। সবকিছু অর্ডার পেলে রান্না হয়, টেবিলের জন্য, ডেলিভারির জন্য কিংবা নিয়ে যাওয়ার জন্য।',
    address: {
      line1: 'House 14, Road 27',
      area: 'Gulshan 1',
      city: 'Dhaka',
      postcode: '1212',
      country: 'Bangladesh',
      mapUrl: 'https://www.openstreetmap.org/?mlat=23.7925&mlon=90.4078#map=16/23.7925/90.4078',
    },
    geo: { lat: 23.7925, lng: 90.4078 },
    phone: '+880 1700-000000',
    email: 'hello@elan.example',
    social: { instagram: 'https://www.instagram.com/', facebook: 'https://www.facebook.com/', youtube: 'https://www.youtube.com/' },
    hours,
    closedDates: [],
    acceptingOrders: true,
    acceptingReservations: true,
    currency: 'BDT',
    currencySymbol: '৳',
    taxLabel: 'VAT',
    taxRate: 0.05,
    serviceChargeRate: 0.1,
    delivery: {
      baseFee: 120,
      freeOver: 3000,
      minOrder: 600,
      radiusKm: 10,
      etaMinutes: 45,
      areas: ['Gulshan', 'Banani', 'Baridhara', 'Badda', 'Mohakhali', 'Tejgaon', 'Niketan', 'Dhanmondi', 'Uttara', 'Bashundhara R/A', 'Mirpur DOHS', 'Motijheel'],
    },
    pickup: { etaMinutes: 25 },
    dineIn: { etaMinutes: 20 },
    loyalty: {
      earnPerTaka: 0.1,
      pointValue: 0.5,
      minRedeem: 100,
      signupBonus: 50,
      referralBonus: 150,
      birthdayBonus: 200,
      tiers: DEFAULT_TIERS,
    },
    reservation: {
      maxGuests: 12,
      advanceDays: 60,
      minLeadMinutes: 60,
      cancelBeforeHours: 4,
      autoConfirm: true,
      seatingDurationMin: 90,
      seatings: ['12:00', '13:30', '15:00', '18:00', '19:30', '21:00'],
    },
    autoDisableOutOfStock: false,
    chef: {
      name: 'Tahmina Rahman',
      title: 'Head chef',
      titleBn: 'হেড শেফ',
      bio: 'Tahmina trained in Dhaka and Lyon and cooks the way her grandmother salted fish: early, quietly and without measuring. The menu changes with the river, the market and her mood on Thursday.',
      bioBn:
        'তাহমিনা ঢাকা আর লিঁয়ঁতে রান্না শিখেছেন। তিনি রাঁধেন সেভাবেই, যেভাবে তাঁর দিদিমা মাছে নুন মাখাতেন: আগেভাগে, চুপচাপ আর মাপ ছাড়া। নদী, বাজার আর বৃহস্পতিবারের মেজাজ মিলিয়ে মেনু বদলায়।',
    },
  };
}
