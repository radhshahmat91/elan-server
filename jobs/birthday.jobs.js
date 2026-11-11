// Recurring: give birthday points to guests whose birthday is today. Runs hourly; the service makes repeats harmless.
import { grantBirthdayBonuses } from '../services/birthdayService.js';
import { logger } from '../utils/logger.js';

export default async function register({ scheduleEvery }) {
  scheduleEvery('birthday-bonus', 60 * 60_000, async () => {
    const granted = await grantBirthdayBonuses();
    if (granted) logger.info(`granted ${granted} birthday bonus(es)`);
  });
}
