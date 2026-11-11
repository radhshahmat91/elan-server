// Recurring sweep: cancel online orders whose payment window closed (releases coupon and points).
import { sweepUnpaidOrders } from '../services/orderService.js';
import { logger } from '../utils/logger.js';

export default async function register({ scheduleEvery }) {
  scheduleEvery('order-sweep', 60_000, async () => {
    const cancelled = await sweepUnpaidOrders();
    if (cancelled) logger.info(`cancelled ${cancelled} unpaid order(s) after the payment window closed`);
  });
}
