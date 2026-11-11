// Branded HTML wrapper for every transactional email. Inline styles only (email clients ignore stylesheets).
import { env } from '../config/env.js';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export { escapeHtml };

/**
 * @param {{ title: string, preheader?: string, bodyHtml: string, cta?: { label: string, url: string }, footnote?: string, footerHtml?: string }} options
 * bodyHtml and footerHtml are trusted HTML you built with escapeHtml() around user-provided values.
 */
export function emailLayout({ title, preheader = '', bodyHtml, cta, footnote, footerHtml }) {
  const button = cta
    ? `<p style="margin:28px 0 8px"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#c9a45c;color:#1a1208;text-decoration:none;font-weight:600;padding:13px 26px;border-radius:2px">${escapeHtml(cta.label)}</a></p>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#150e10;font-family:Helvetica,Arial,sans-serif;color:#f1e6d6">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#150e10"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
    <tr><td style="padding:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:30px;letter-spacing:2px;color:#c9a45c">ÉLAN</td></tr>
    <tr><td style="background:#1e1517;border:1px solid #3a2c2f;padding:32px 28px">
      <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:26px;line-height:1.2;color:#f1e6d6">${escapeHtml(title)}</h1>
      <div style="font-size:15px;line-height:1.65;color:#d8c9b8">${bodyHtml}</div>
      ${button}
    </td></tr>
    <tr><td style="padding:20px 4px 0;font-size:12px;line-height:1.6;color:#85746a">${footnote ? `${escapeHtml(footnote)}<br>` : ''}${footerHtml ? `${footerHtml}<br>` : ''}ÉLAN, Dhaka. You are receiving this because of something you did on our website: an order, a booking, a message or a sign-up. ${escapeHtml(env.PUBLIC_CLIENT_URL)}</td></tr>
  </table>
</td></tr></table></body></html>`;
}
