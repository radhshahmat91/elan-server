// Small formatting helpers for messages, logs and emails.

/** ৳1,450 style amount (whole BDT). */
export const bdt = (amount) => `৳${Math.round(Number(amount) || 0).toLocaleString('en-US')}`;

export const firstName = (name = '') => String(name).trim().split(/\s+/)[0] ?? '';

/** a***@example.com, for logs that must not hold a full address. */
export function maskEmail(email = '') {
  const [user = '', domain = ''] = String(email).split('@');
  return `${user.slice(0, 1)}***@${domain}`;
}

export const humanStatus = (status) => String(status ?? '').replace(/_/g, ' ');

/** Escapes a value for CSV output and neutralises spreadsheet formula injection. */
export function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
