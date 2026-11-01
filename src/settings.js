// Store settings the owner changes in Admin → Settings (no redeploy needed).
// Kept in the database. Secrets and payout details never go here: API keys
// and receiving details stay in environment variables.
const store = require('./store');

const DEFAULTS = {
  // Payment methods added in src/payments/extra/ keep their own settings here too.
  invoice: false,       // offer "pay by invoice" (you send a bill yourself)
  proofUploads: true,   // let customers upload a screenshot of their payment (pay-by-hand methods)
  holdHours: 72,        // unpaid orders keep their stock this long, then cancel (0 = never)
  reminderHours: 24,    // send a payment reminder this often while unpaid (0 = never)
  monthlyEmail: false,  // email last month's finance summary on the 1st
  lowStockAt: 3,        // low-stock alert threshold
};

let cache = null;
async function get() {
  if (!cache) cache = { ...DEFAULTS, ...((await store.getDoc('settings', 'store')) || {}) };
  return cache;
}
async function set(patch) {
  const next = { ...(await get()), ...patch };
  await store.putDoc('settings', 'store', next); cache = next;
  return next;
}
module.exports = { get, set, DEFAULTS, reset: () => { cache = null; } };
