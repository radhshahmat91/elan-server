// Invoices. The model is built by a pure function (tested); rendering to PDF is a thin layer over pdfkit.
//
// PDF limitation, documented in docs/known-limitations.md: the built-in PDF fonts cover Latin text only, so the taka
// sign is printed as "BDT" and names in other scripts (for example Bengali) are replaced by "?". Names on screen are unaffected.
import { humanStatus } from '../utils/format.js';

export const INVOICE_STATUSES = ['placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'];

const METHOD = { cod: 'Cash', card: 'Card', bkash: 'bKash', nagad: 'Nagad' };
const PAYMENT = { unpaid: 'unpaid', cash_due: 'cash due on receipt', pending: 'payment pending', paid: 'paid', failed: 'payment failed', refunded: 'refunded', partially_refunded: 'partly refunded' };

/** Pure. Keeps only what the built-in PDF fonts can draw. */
export const latin = (text) => String(text ?? '').replace(/[^\x20-\x7E -ÿ]/g, '?');

export const money = (n) => `BDT ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

/** Pure. Compares phone numbers by their last ten digits, so +880 1700-000000 equals 01700000000. */
export function samePhone(a, b) {
  const digits = (v) => String(v ?? '').replace(/\D/g, '').slice(-10);
  const x = digits(a);
  return x.length >= 7 && x === digits(b);
}

/** Pure. Everything the PDF prints, in order. */
export function buildInvoiceModel(order, restaurant) {
  const t = order.totals ?? {};
  const address = order.address ?? {};
  const customerLines =
    order.fulfillment === 'delivery'
      ? [address.recipient, address.line1, [address.area, address.city].filter(Boolean).join(', ')].filter(Boolean)
      : order.fulfillment === 'dine_in'
        ? [`Dine-in${order.tableNumber ? `, table ${order.tableNumber}` : ''}`]
        : ['Pickup at the restaurant'];

  const totals = [{ label: 'Subtotal', amount: t.subtotal ?? 0 }];
  if (t.discount) totals.push({ label: `Coupon${order.coupon?.code ? ` ${order.coupon.code}` : ''}`, amount: -t.discount });
  if (t.loyaltyDiscount) totals.push({ label: `Points${order.loyaltyRedeemed?.points ? ` (${order.loyaltyRedeemed.points})` : ''}`, amount: -t.loyaltyDiscount });
  if (t.deliveryFee) totals.push({ label: 'Delivery', amount: t.deliveryFee });
  if (t.serviceCharge) totals.push({ label: 'Service charge', amount: t.serviceCharge });
  if (t.tax) totals.push({ label: restaurant.taxLabel || 'VAT', amount: t.tax });
  totals.push({ label: 'Total', amount: t.total ?? 0, strong: true });

  const method = METHOD[order.payment?.method] ?? 'Payment';
  return {
    number: order.orderNumber,
    date: order.placedAt ?? order.createdAt,
    status: humanStatus(order.status),
    payment: `${method}, ${PAYMENT[order.payment?.status] ?? order.payment?.status ?? ''}`.trim().replace(/,$/, ''),
    sandbox: order.payment?.provider === 'sandbox',
    refunded: order.payment?.refundedTotal ?? 0,
    seller: { name: restaurant.name || 'ÉLAN', lines: [restaurant.address?.line1, [restaurant.address?.area, restaurant.address?.city].filter(Boolean).join(', ')].filter(Boolean), phone: restaurant.phone, email: restaurant.email },
    customer: { name: order.customer?.name, phone: order.customer?.phone, email: order.customer?.email, lines: customerLines },
    lines: (order.items ?? []).map((i) => ({
      name: i.name,
      options: (i.options ?? []).map((o) => o.choiceName).filter(Boolean).join(', ') || undefined,
      note: i.note || undefined,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      total: i.lineTotal,
    })),
    totals,
    notes: order.notes || undefined,
  };
}

/** Renders the model to a PDF buffer. pdfkit is loaded on demand so the rest of the server never pays for it. */
export async function renderInvoicePdf(model) {
  const { default: PDFDocument } = await import('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Invoice ${model.number}`, Author: model.seller.name, Subject: 'Order invoice' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const finished = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const GOLD = '#8a6d2f';
  const INK = '#1d1416';
  const MUTED = '#6b5d57';
  const left = 48;
  const right = 547;
  const col = { qty: 350, unit: 408, total: 480 };
  const when = new Date(model.date).toISOString().slice(0, 10);

  doc.font('Times-Bold').fontSize(30).fillColor(GOLD).text(latin(model.seller.name), left, 48, { characterSpacing: 2 });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  for (const line of [...model.seller.lines, model.seller.phone, model.seller.email].filter(Boolean)) doc.text(latin(line));

  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('Invoice', 380, 52, { width: right - 380, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  doc.text(`No. ${latin(model.number)}`, 380, 76, { width: right - 380, align: 'right' });
  doc.text(`Date ${when}`, { width: right - 380, align: 'right' });
  doc.text(`Order ${latin(model.status)}`, { width: right - 380, align: 'right' });

  doc.moveTo(left, 128).lineTo(right, 128).lineWidth(0.6).strokeColor('#d9cfc4').stroke();

  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('BILLED TO', left, 142, { characterSpacing: 1 });
  doc.font('Helvetica').fontSize(10).fillColor(INK).text(latin(model.customer.name), left, 156);
  doc.fontSize(9).fillColor(MUTED);
  for (const line of [...model.customer.lines, model.customer.phone, model.customer.email].filter(Boolean)) doc.text(latin(line));

  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('PAYMENT', 380, 142, { characterSpacing: 1 });
  doc.font('Helvetica').fontSize(10).fillColor(INK).text(latin(model.payment), 380, 156, { width: right - 380 });

  let y = Math.max(doc.y, 215) + 14;
  const header = () => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
    doc.text('ITEM', left, y, { characterSpacing: 1 });
    doc.text('QTY', col.qty, y, { width: 40, align: 'right' });
    doc.text('PRICE', col.unit, y, { width: 64, align: 'right' });
    doc.text('TOTAL', col.total, y, { width: right - col.total, align: 'right' });
    y += 14;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor('#d9cfc4').stroke();
    y += 8;
  };
  header();

  for (const line of model.lines) {
    const detail = [line.options, line.note ? `Note: ${line.note}` : null].filter(Boolean).join('  |  ');
    const need = detail ? 38 : 24;
    if (y + need > 740) {
      doc.addPage();
      y = 56;
      header();
    }
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(latin(line.name), left, y, { width: 290 });
    doc.text(String(line.quantity), col.qty, y, { width: 40, align: 'right' });
    doc.text(money(line.unitPrice), col.unit, y, { width: 64, align: 'right' });
    doc.text(money(line.total), col.total, y, { width: right - col.total, align: 'right' });
    y += 15;
    if (detail) {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(latin(detail), left + 6, y, { width: 290 });
      y += 13;
    }
    y += 4;
  }

  if (y + model.totals.length * 18 + 80 > 780) {
    doc.addPage();
    y = 56;
  }
  y += 6;
  doc.moveTo(330, y).lineTo(right, y).lineWidth(0.5).strokeColor('#d9cfc4').stroke();
  y += 10;
  for (const row of model.totals) {
    doc.font(row.strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(row.strong ? 12 : 10).fillColor(row.strong ? INK : MUTED);
    doc.text(latin(row.label), 340, y, { width: 120 });
    doc.text(row.amount < 0 ? `- ${money(-row.amount)}` : money(row.amount), 440, y, { width: right - 440, align: 'right' });
    y += row.strong ? 22 : 17;
  }
  if (model.refunded > 0) {
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Refunded', 340, y, { width: 120 });
    doc.text(`- ${money(model.refunded)}`, 440, y, { width: right - 440, align: 'right' });
    y += 17;
  }

  y += 14;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  if (model.notes) doc.text(`Order note: ${latin(model.notes)}`, left, y, { width: 300 });
  doc.text('Thank you for dining with us.', left, 760, { width: 300 });
  if (model.sandbox) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#a23b2a').text('Demonstration payment: this order was paid through the ÉLAN sandbox gateway. No real money moved.', left, 776, { width: right - left });
  }
  doc.end();
  return finished;
}
