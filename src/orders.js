// Order state changes in one place, so every payment method (Stripe, an add-on method,
// an invoice paid by hand, a payment typed in by the admin) follows the same rules.
//
//   pending_payment ──(paid in full)──> paid ──> shipped ──> delivered
//          │                              └──> refunded (money returned in the processor)
//          └──(expired / hold ran out / cancelled)──> cancelled (stock goes back)
const store = require('./store');
const products = require('./products');
const email = require('./email');

const paidHooks = [];
// Run after an order becomes paid (e.g. record the sale with Stripe Tax). Errors are logged, never thrown.
const onPaid = (fn) => paidHooks.push(fn);

const paidSoFar = (o) => ((o.meta && o.meta.payments) || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
const balance = (o) => Math.max(0, o.total - paidSoFar(o));

// Mark an order paid. Safe to call twice (webhook + return page): only the first call does anything.
async function markPaid(order, { ref = '', amount, base, method } = {}) {
  const from = ['pending_payment', 'cancelled'];
  if (!from.includes(order.status)) return order;
  const meta = { paidAt: new Date().toISOString(), paymentRef: ref, ...(method ? { paidWith: method } : {}), ...(amount ? { amountPaid: amount } : {}) };
  const o = await store.transition(order.id, from, 'paid', meta);
  if (!o) return (await store.getOrder(order.id)) || order; // already processed elsewhere
  if (order.status === 'cancelled') await products.reserve(order.items);
  if (amount && amount < o.total) console.warn(`order ${o.id}: paid ${amount} but total is ${o.total}`);
  console.log(`order ${o.id} paid${method ? ` (${method})` : ''}`);
  if (base) { email.orderReceived(o, base, { paid: true }); email.newOrderAlert(o, base, { paid: true }); }
  for (const fn of paidHooks) { try { await fn(o); } catch (err) { console.error(`after-paid step failed for ${o.id}:`, err.message); } }
  return o;
}

// Record money received (a confirmed payment or an admin entry). Marks paid once the total is covered.
// `key` makes it idempotent: the same transaction is never counted twice.
async function recordPayment(order, { amount, method, ref = '', key, note = '', base }) {
  const fresh = (await store.getOrder(order.id)) || order;
  const payments = [...((fresh.meta && fresh.meta.payments) || [])];
  if (key && payments.some((p) => p.key === key)) return fresh;
  payments.push({ amount: Math.round(amount), method, ref, key: key || '', note, at: new Date().toISOString() });
  let o = await store.updateOrder(order.id, { meta: { payments } });
  if (paidSoFar(o) >= o.total) o = await markPaid(o, { ref, amount: paidSoFar(o), base, method });
  return o;
}

// Payment never arrived (expired checkout, hold ran out): cancel and put the stock back.
async function markFailed(order, reason = 'payment not completed') {
  const o = await store.transition(order.id, ['pending_payment'], 'cancelled', { cancelledAt: new Date().toISOString(), cancelReason: reason });
  if (!o) return order;
  await products.release(o.items);
  console.log(`order ${o.id} cancelled (${reason})`);
  return o;
}

module.exports = { onPaid, markPaid, markFailed, recordPayment, paidSoFar, balance };
