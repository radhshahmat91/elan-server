// Email delivery job. With SMTP configured it sends through nodemailer; without it the message is logged
// (recipient masked) so a demo deployment never silently pretends to have emailed anyone.
import { Notification } from '../models/index.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { maskEmail } from '../utils/format.js';

let transport = null;

async function getTransport() {
  if (transport) return transport;
  const nodemailer = (await import('nodemailer')).default;
  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE === 'true',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transport;
}

async function markNotification(id, status, error) {
  if (!id) return;
  await Notification.updateOne({ _id: id }, { $set: { 'email.status': status, ...(error ? { 'email.error': String(error).slice(0, 200) } : {}) } }).catch(() => {});
}

export async function deliverEmail({ to, subject, html, text, notificationId }) {
  if (!env.smtpConfigured) {
    logger.info(`email not sent (SMTP not configured): "${subject}" to ${maskEmail(to)}`);
    await markNotification(notificationId, 'none');
    return { sent: false };
  }
  try {
    const mailer = await getTransport();
    await mailer.sendMail({ from: env.EMAIL_FROM, to, subject, html, text: text ?? subject });
    await markNotification(notificationId, 'sent');
    return { sent: true };
  } catch (err) {
    await markNotification(notificationId, 'failed', err.message);
    throw err; // the queue retries with backoff
  }
}

export default async function register({ registerHandler }) {
  registerHandler('email', deliverEmail);
}
