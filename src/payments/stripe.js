// Stripe Checkout. No Stripe library needed: two API calls and a webhook check.
//   1. start():   create a Checkout Session for the order, send the buyer to Stripe.
//   2. confirm(): when the buyer comes back, ask Stripe whether it was paid.
//   3. webhook(): Stripe tells us directly (works even if the buyer closes the tab).
const crypto = require('crypto');
const config = require('../config');

const API = (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '');
const KEY = () => process.env.STRIPE_SECRET_KEY || '';

// Stripe's API takes nested form fields: a[b][0][c]=value
function encode(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') encode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}

async function call(method, path, body) {
  if (!KEY()) throw new Error('STRIPE_SECRET_KEY is not set');
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
    body: body ? encode(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${(data.error && data.error.message) || 'request failed'}`);
  return data;
}

async function start(order, { baseUrl }) {
  const items = order.items.map((i) => ({
    quantity: i.qty,
    price_data: { currency: config.currency, unit_amount: i.price, product_data: { name: i.label } },
  }));
  const body = {
    mode: 'payment',
    line_items: items,
    customer_email: order.email,
    client_reference_id: order.id,
    metadata: { order_id: order.id },
    payment_intent_data: { metadata: { order_id: order.id }, description: `Order ${order.id}` },
    success_url: `${baseUrl}/order/${order.id}?k=${order.key}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/checkout?canceled=${order.id}`,
    shipping_options: [{ shipping_rate_data: { type: 'fixed_amount', display_name: config.shipping.label || 'Shipping', fixed_amount: { amount: order.shipping, currency: config.currency } } }],
  };
  // Sales tax is worked out by the store (src/tax.js) before payment, so it's charged as its own line.
  if (order.tax > 0) items.push({ quantity: 1, price_data: { currency: config.currency, unit_amount: order.tax, product_data: { name: (order.meta.tax && order.meta.tax.label) || 'Sales tax' } } });
  const session = await call('POST', '/v1/checkout/sessions', body);
  return { redirect: session.url, ref: session.id };
}

// Buyer is back from Stripe. Double-check with Stripe instead of trusting the URL.
async function confirm(order, query) {
  const id = query.get('session_id');
  if (!id || !/^cs_[\w]+$/.test(id)) return null;
  const s = await call('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`);
  if (s.metadata && s.metadata.order_id !== order.id) return null;
  return s.payment_status === 'paid' ? { paid: true, ref: s.payment_intent || s.id, amount: s.amount_total } : null;
}

// Check the Stripe-Signature header: HMAC-SHA256 of "timestamp.rawBody".
function verify(raw, header, secret, toleranceSec = 300) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((kv) => kv.split('=')).filter((a) => a.length === 2 && a[0] === 't'));
  const sigs = String(header).split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return sigs.some((s) => s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)));
}

async function webhook(raw, headers) {
  if (!verify(raw, headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) return { error: 'bad signature' };
  const evt = JSON.parse(raw);
  const s = evt.data && evt.data.object;
  const orderId = s && ((s.metadata && s.metadata.order_id) || s.client_reference_id);
  if (!orderId) return { ignored: true };
  if (evt.type === 'checkout.session.completed' && s.payment_status === 'paid') return { orderId, event: 'paid', ref: s.payment_intent || s.id, amount: s.amount_total };
  if (evt.type === 'checkout.session.async_payment_succeeded') return { orderId, event: 'paid', ref: s.payment_intent || s.id, amount: s.amount_total };
  if (evt.type === 'checkout.session.expired' || evt.type === 'checkout.session.async_payment_failed') return { orderId, event: 'failed' };
  return { ignored: true };
}

module.exports = {
  name: 'stripe',
  label: 'Card payment',
  buttonText: 'Continue to payment',
  note: 'You will enter your card on Stripe’s secure checkout page.',
  ready: () => !!KEY(),
  start, confirm, webhook, verify,
};
