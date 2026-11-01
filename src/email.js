// Order and account emails through Resend (resend.com). Optional: without
// RESEND_API_KEY the store works normally and just logs that it skipped the email.
const config = require('./config');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enabled = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

async function send({ to, subject, html, replyTo }) {
  if (!enabled()) { console.log(`email skipped (RESEND_API_KEY / EMAIL_FROM not set): "${subject}" to ${to}`); return false; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html, reply_to: replyTo || config.contactEmail || undefined }),
    });
    if (!res.ok) { console.error('email failed', res.status, await res.text().catch(() => '')); return false; }
    return true;
  } catch (err) { console.error('email failed', err.message); return false; }
}

const shell = (title, body) => `<!doctype html><html><body style="margin:0;background:#f4f4f2;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;padding:28px">
<tr><td style="font-size:18px;font-weight:600;padding-bottom:18px">${esc(config.name)}</td></tr>
<tr><td><h1 style="font-size:22px;margin:0 0 12px">${esc(title)}</h1>${body}</td></tr>
<tr><td style="padding-top:24px;font-size:12px;color:#777">${esc(config.name)}${config.contactEmail ? ` · <a href="mailto:${esc(config.contactEmail)}" style="color:#777">${esc(config.contactEmail)}</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;

const btn = (href, text) => `<p style="margin:20px 0"><a href="${esc(href)}" style="background:${esc(config.colors.accent)};color:${esc(config.colors.accentText)};text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block">${esc(text)}</a></p>`;

function itemsTable(o) {
  const row = (l, r, b) => `<tr><td style="padding:6px 0;${b ? 'font-weight:600;border-top:1px solid #eee' : ''}">${l}</td><td align="right" style="padding:6px 0;${b ? 'font-weight:600;border-top:1px solid #eee' : ''}">${r}</td></tr>`;
  return `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:12px 0">
    ${o.items.map((i) => row(`${i.qty} × ${esc(i.label)}`, config.money(i.price * i.qty))).join('')}
    ${row('Shipping', o.shipping ? config.money(o.shipping) : 'Free', true)}
    ${o.tax ? row(esc((o.meta && o.meta.tax && o.meta.tax.label) || 'Sales tax'), config.money(o.tax)) : ''}
    ${row('Total', config.money(o.total), true)}</table>`;
}
const address = (c) => [c.name, c.address1, c.address2, `${c.city}, ${c.state} ${c.zip}`, c.country].filter(Boolean).map(esc).join('<br>');
const orderLink = (o, base) => `${base}/order/${o.id}?k=${o.key}`;

module.exports = {
  enabled, send, shell, btn, esc, itemsTable,
  orderReceived(o, base, { paid, instructions }) {
    const title = paid ? `Thanks! Order ${o.id} is confirmed` : `We got your order ${o.id}`;
    const lead = paid
      ? `<p>Your payment went through. We'll email you again when it ships.</p>`
      : `<p>Your order is saved and waiting for payment.</p>${instructions ? `<p style="background:#f6f6f3;padding:12px;border-radius:8px">${esc(instructions).replace(/\n/g, '<br>')}</p>` : ''}`;
    return send({ to: o.email, subject: title, html: shell(title, `${lead}${itemsTable(o)}<p style="font-size:14px"><strong>Shipping to</strong><br>${address(o.customer)}</p>${btn(orderLink(o, base), 'View your order')}`) });
  },
  newOrderAlert(o, base, { paid }) {
    if (!config.notifyEmail) return false;
    const title = `${paid ? 'Paid order' : 'New order (awaiting payment)'} ${o.id}: ${config.money(o.total)}`;
    return send({ to: config.notifyEmail, subject: title, html: shell(title, `<p>${esc(o.customer.name)} · ${esc(o.email)}</p>${itemsTable(o)}${btn(`${base}/admin/orders#${o.id}`, 'Open in admin')}`) });
  },
  shipped(o, base) {
    const t = o.meta && o.meta.tracking;
    const title = `Order ${o.id} is on its way`;
    return send({ to: o.email, subject: title, html: shell(title, `<p>Your order has shipped.</p>${t ? `<p><strong>Tracking:</strong> ${/^https:\/\//.test(t) ? `<a href="${esc(t)}">${esc(t)}</a>` : esc(t)}</p>` : ''}${itemsTable(o)}${btn(orderLink(o, base), 'View your order')}`) });
  },
  paymentReminder(o, base, { hoursLeft, instructions }) {
    const title = `Reminder: order ${o.id} is waiting for payment`;
    return send({ to: o.email, subject: title, html: shell(title, `<p>We're holding your items${hoursLeft ? ` for about ${hoursLeft} more hour${hoursLeft === 1 ? '' : 's'}` : ''}. After that the order is cancelled and the items go back on sale.</p>${instructions ? `<p style="background:#f6f6f3;padding:12px;border-radius:8px">${esc(instructions).replace(/\n/g, '<br>')}</p>` : ''}${itemsTable(o)}${btn(orderLink(o, base), 'View your order')}`) });
  },
  orderCancelled(o, base, reason) {
    const title = `Order ${o.id} was cancelled`;
    return send({ to: o.email, subject: title, html: shell(title, `<p>${esc(reason || 'We didn’t receive payment in time, so the order was cancelled and nothing will ship.')}</p><p>If you already paid, reply to this email and we'll sort it out right away.</p>${itemsTable(o)}`) });
  },
  proofAlert(o, base) {
    if (!config.notifyEmail) return false;
    const title = `Payment proof uploaded for ${o.id}`;
    return send({ to: config.notifyEmail, subject: title, html: shell(title, `<p>${esc(o.customer.name)} uploaded a payment screenshot for ${config.money(o.total)}. Check it against your account before marking the order paid.</p>${btn(`${base}/admin/orders#${o.id}`, 'Open in admin')}`) });
  },
  passwordReset(user, link) {
    const title = 'Reset your password';
    return send({ to: user.email, subject: title, html: shell(title, `<p>Someone asked to reset the password for this account. If it was you, use the button below within one hour.</p>${btn(link, 'Choose a new password')}<p style="font-size:13px;color:#777">If you didn't ask for this, ignore this email; your password stays the same.</p>`) });
  },
};
