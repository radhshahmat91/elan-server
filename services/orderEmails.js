// Customer-facing wording for each order status: the in-app text and the branded email.
import { emailLayout, escapeHtml } from '../utils/emailLayout.js';
import { bdt } from '../utils/format.js';
import { env } from '../config/env.js';

const COPY = {
  placed: () => ['We have your order', 'Thank you. The kitchen will confirm your order in a moment.'],
  confirmed: () => ['Your order is confirmed', 'The kitchen has accepted your order and will start cooking shortly.'],
  ready: (o) =>
    o.fulfillment === 'delivery'
      ? ['Packed and waiting for a rider', 'Your order is ready. A rider will collect it any minute now.']
      : o.fulfillment === 'pickup'
        ? ['Ready for collection', 'Your order is hot and waiting at the counter. Quote your order number.']
        : ['Coming to your table', 'Your order is ready and on its way to your table.'],
  out_for_delivery: () => ['On its way', 'A rider has picked up your order and is heading to you.'],
  delivered: (o) => (o.fulfillment === 'delivery' ? ['Delivered. Enjoy.', 'Your order has arrived. We would love to hear how it was.'] : ['Enjoy your meal', 'Thank you for choosing ÉLAN. We would love to hear how it was.']),
  cancelled: () => ['Your order was cancelled', 'This order has been cancelled. Any points or paid amount are being returned.'],
  rejected: () => ['We could not accept your order', 'The kitchen could not take this order. Any points or paid amount are being returned.'],
};

export const NOTIFIED_STATUSES = Object.keys(COPY);

export function trackUrl(order) {
  return `${env.PUBLIC_CLIENT_URL}/track-order/${order.publicId}`;
}

export function buildOrderEmail(order, status) {
  const make = COPY[status];
  if (!make) return null;
  const [title, line] = make(order);
  const rows = order.items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0;border-bottom:1px dotted #4a3a3d">${escapeHtml(i.name)} <span style="color:#85746a">x ${i.quantity}</span></td><td align="right" style="padding:6px 0;border-bottom:1px dotted #4a3a3d">${bdt(i.lineTotal)}</td></tr>`,
    )
    .join('');
  const payment =
    order.payment.status === 'paid'
      ? 'Paid online (sandbox payment)'
      : order.payment.method === 'cod'
        ? 'Pay on delivery or at the counter'
        : 'Awaiting payment';
  const bodyHtml = `
    <p style="margin:0 0 14px">${escapeHtml(line)}</p>
    <p style="margin:0 0 6px;color:#bba99a">Order ${escapeHtml(order.orderNumber)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:8px 0 12px">${rows}
      <tr><td style="padding:10px 0 0;font-weight:600">Total</td><td align="right" style="padding:10px 0 0;font-weight:600">${bdt(order.totals.total)}</td></tr>
    </table>
    <p style="margin:0;color:#bba99a;font-size:13px">${escapeHtml(payment)}</p>`;
  return {
    title,
    line,
    subject: `${title} (${order.orderNumber})`,
    html: emailLayout({ title, preheader: line, bodyHtml, cta: { label: 'Track order', url: trackUrl(order) } }),
    text: `${title}\n${line}\nOrder ${order.orderNumber}, total ${bdt(order.totals.total)}\nTrack: ${trackUrl(order)}`,
  };
}
