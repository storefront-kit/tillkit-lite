// Unpaid orders: stock is held until meta.holdUntil (Admin → Settings → hold hours,
// 72 by default). While waiting, the buyer gets a reminder every few hours; when
// the hold runs out the order is cancelled, stock goes back, and the buyer is told.
const config = require('./config');
const store = require('./store');
const settings = require('./settings');
const orders = require('./orders');
const email = require('./email');
const methods = require('./payments/methods');

async function tick(now = Date.now()) {
  const s = await settings.get();
  const base = config.publicUrl;
  const pending = store.ordersWithStatus ? await store.ordersWithStatus('pending_payment') : (await store.listOrders()).filter((o) => o.status === 'pending_payment');
  let cancelled = 0, reminded = 0;
  for (const o of pending) {
    const m = o.meta || {};
    if (!m.holdUntil) continue;
    const until = Date.parse(m.holdUntil);
    const method = (m.payment && m.payment.method) || '';
    if (now >= until) {
      const hours = Math.round((until - Date.parse(m.placedAt || o.created_at)) / 3600e3);
      const done = await orders.markFailed(o, `not paid within ${hours} hours`);
      if (done.status === 'cancelled' && method !== 'card' && base) email.orderCancelled(done, base, `We didn’t receive payment within ${hours} hours, so order ${o.id} was cancelled and the items went back on sale.`);
      cancelled++;
      continue;
    }
    const every = Number(s.reminderHours) || 0;
    if (!every || method === 'card' || !base) continue;
    const last = Date.parse(m.lastReminder || m.placedAt || o.created_at);
    const hoursLeft = Math.floor((until - now) / 3600e3);
    if (now - last >= every * 3600e3 && hoursLeft >= 1) {
      const ins = await methods.instructions(o, base);
      await email.paymentReminder(o, base, { hoursLeft, instructions: methods.instructionsText(ins) });
      await store.updateOrder(o.id, { meta: { lastReminder: new Date(now).toISOString(), reminders: (m.reminders || 0) + 1 } });
      reminded++;
    }
  }
  if (cancelled || reminded) console.log(`holds: ${cancelled} cancelled, ${reminded} reminded`);
  return { cancelled, reminded };
}

module.exports = { tick, init({ jobs }) { jobs.register('unpaid-order holds', 10 * 60e3, () => tick()); } };
