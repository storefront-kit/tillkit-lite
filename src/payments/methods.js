// The payment choices a buyer sees at checkout, and the instructions for each.
//   card    → Stripe Checkout (when STRIPE_SECRET_KEY is set), or a custom processor
//   invoice → you bill the customer yourself; the order is held until you mark it paid
// More methods can be added as plugins: each file in src/payments/extra/ exports one
// method (or a list of them) shaped like this:
//   { id, label, hint,
//     manual: true,                      // paid by hand: order held, buyer may upload a screenshot
//     available(settings) → bool,        // offer it at checkout?
//     instructions(order, { settings, amount, ref, base }) → { title, lines, link?, linkText? },
//     afterCheckout?(order, form) → url, // send the buyer somewhere after the order is placed
//     status?() → [label, text],         // a line under Admin → Settings → Connected services
//     settings?: { html(values, { txt, chk, esc }), save(form) → { patch, error? } } }
const fs = require('fs');
const path = require('path');
const config = require('../config');
const settings = require('../settings');
const stripe = require('./stripe');

const EXTRA_DIR = path.join(__dirname, 'extra');
const EXTRAS = (fs.existsSync(EXTRA_DIR) ? fs.readdirSync(EXTRA_DIR).filter((f) => f.endsWith('.js')).sort() : [])
  .flatMap((f) => {
    try { return [].concat(require(path.join(EXTRA_DIR, f))); }
    catch (err) { console.error(`payment method ${f} failed to load:`, err.message); return []; }
  })
  .filter((m) => m && m.id && typeof m.available === 'function' && typeof m.instructions === 'function');

const LABELS = { card: 'Card', ...Object.fromEntries(EXTRAS.map((m) => [m.id, m.label || m.id])), invoice: 'Pay by invoice' };
const HINTS = {
  card: 'Pay securely on the next page. Apple Pay and Google Pay work where your device supports them.',
  ...Object.fromEntries(EXTRAS.map((m) => [m.id, m.hint || ''])),
  invoice: 'We’ll email you an invoice. Your order ships once it’s paid.',
};
// Checkout button text when a method is picked (default: "Place order").
const BUTTONS = { card: 'Continue to payment', ...Object.fromEntries(EXTRAS.filter((m) => m.button).map((m) => [m.id, m.button])) };
const OWN_PAGE = EXTRAS.filter((m) => m.afterCheckout).map((m) => m.id);
const MANUAL = [...EXTRAS.filter((m) => m.manual).map((m) => m.id), 'invoice'];
const extra = (id) => EXTRAS.find((m) => m.id === id) || null;

let custom = null;
const customMod = () => { if (custom === null) { try { custom = require('./custom'); } catch { custom = false; } } return custom || null; };

// The card processor: Stripe unless PAYMENT_PROVIDER=custom and src/payments/custom.js exists.
function cardProvider() {
  if (config.demo) return require('../demo-mode').card;
  if (config.payments.provider === 'custom' && customMod()) return customMod();
  return stripe;
}

async function available() {
  const s = await settings.get();
  const out = [];
  if (cardProvider().ready()) out.push('card');
  for (const m of EXTRAS) { try { if (await m.available(s)) out.push(m.id); } catch (err) { console.error(`payment method ${m.id}:`, err.message); } }
  // Invoice is offered when switched on, when PAYMENT_PROVIDER=manual, or when nothing else is set up.
  if (s.invoice || (process.env.PAYMENT_PROVIDER || '').toLowerCase() === 'manual' || !out.length) out.push('invoice');
  return out;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// What the buyer must do to pay, as plain lines (for emails) and a link if there is one.
async function instructions(order, base) {
  const s = await settings.get();
  const m = (order.meta && order.meta.payment && order.meta.payment.method) || order.meta.provider || 'invoice';
  if (m === 'invoice') return { method: m, title: 'Payment', lines: [config.manualPaymentInstructions || 'We’ll email you an invoice. Your order ships once it’s paid.'] };
  const x = extra(m);
  if (x) return { method: m, ...(await x.instructions(order, { settings: s, amount: config.money(order.total), ref: order.id, base: base || config.publicUrl || '' })) };
  return { method: m, title: 'Payment', lines: [] };
}
const instructionsText = (ins) => [ins.title, ...ins.lines, ins.link ? `${ins.linkText || 'Pay here'}: ${ins.link}` : ''].filter(Boolean).join('\n');
const instructionsHtml = (ins) => `<div class="pay-steps"><h2 class="h3">${esc(ins.title)}</h2>${ins.lines.map((l) => `<p>${esc(l)}</p>`).join('')}${ins.link ? `<p><a class="btn btn-primary" href="${esc(ins.link)}" rel="noopener">${esc(ins.linkText || 'Pay now')}</a></p>` : ''}</div>`;

// Where to send the buyer right after checkout, if a method has its own payment page.
const afterCheckout = (order, form) => { const x = extra(order.meta.payment && order.meta.payment.method); return x && x.afterCheckout ? x.afterCheckout(order, form) : null; };
// Lines for Admin → Settings → Connected services, and the methods' own settings.
const statusLines = () => EXTRAS.filter((m) => m.status).map((m) => m.status()).filter(Boolean);
const settingsHtml = (values, helpers) => EXTRAS.filter((m) => m.settings && m.settings.html).map((m) => m.settings.html(values, helpers)).join('');
function settingsSave(form) {
  const patch = {}; const errors = [];
  for (const m of EXTRAS) if (m.settings && m.settings.save) { const r = m.settings.save(form) || {}; Object.assign(patch, r.patch || {}); if (r.error) errors.push(r.error); }
  return { patch, errors };
}
const hasManualExtras = () => EXTRAS.some((m) => m.manual);

module.exports = { MANUAL, LABELS, HINTS, BUTTONS, OWN_PAGE, EXTRAS, available, cardProvider, instructions, instructionsText, instructionsHtml, afterCheckout, statusLines, settingsHtml, settingsSave, hasManualExtras };
