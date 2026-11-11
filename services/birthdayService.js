// Birthday bonus: once a year, on the guest's birthday (restaurant time), a signed-in customer receives the points set in
// the loyalty settings. Birthdays are stored as UTC midnight of the date the guest entered, so month and day are read in UTC.
import { User } from '../models/index.js';
import { localParts } from '../utils/dates.js';
import { logger } from '../utils/logger.js';
import { grantPoints } from './loyaltyService.js';
import { notifyUser } from './notificationService.js';
import { getRestaurant } from './restaurantService.js';

const isLeap = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Pure. The month/day pairs that count as "today" for birthdays (29 February is celebrated on the 28th in other years). */
export function birthdayMatches({ year, month, day }) {
  const matches = [[month, day]];
  if (month === 2 && day === 28 && !isLeap(year)) matches.push([2, 29]);
  return matches;
}

/** Grants today's birthday bonuses. Safe to run every hour and from several servers: the year flag is flipped atomically first. */
export async function grantBirthdayBonuses(now = new Date()) {
  const restaurant = await getRestaurant();
  const bonus = restaurant.loyalty?.birthdayBonus ?? 0;
  if (!(bonus > 0)) return 0;
  const today = localParts(now);
  const clauses = birthdayMatches(today).map(([month, day]) => ({ $and: [{ $eq: [{ $month: '$birthday' }, month] }, { $eq: [{ $dayOfMonth: '$birthday' }, day] }] }));
  const candidates = await User.find({
    role: 'customer',
    status: 'active',
    birthday: { $ne: null },
    birthdayBonusYear: { $ne: today.year },
    $expr: { $or: clauses },
  }).select('_id name').lean();

  let granted = 0;
  for (const person of candidates) {
    // Only the process that flips the flag may grant, so two servers never both pay out.
    const claimed = await User.findOneAndUpdate({ _id: person._id, birthdayBonusYear: { $ne: today.year } }, { $set: { birthdayBonusYear: today.year } }).select('_id');
    if (!claimed) continue;
    try {
      await grantPoints({ userId: person._id, points: bonus, type: 'birthday', note: 'Happy birthday from ÉLAN' });
      await notifyUser(person._id, { type: 'system', title: 'Happy birthday from ÉLAN', body: `${bonus} points are in your rewards wallet, with our compliments.`, link: '/account/rewards' });
      granted += 1;
    } catch (err) {
      // Release the claim so the next run can try again.
      await User.updateOne({ _id: person._id, birthdayBonusYear: today.year }, { $unset: { birthdayBonusYear: '' } });
      logger.warn('Could not grant a birthday bonus', { user: String(person._id), message: err.message });
    }
  }
  return granted;
}
