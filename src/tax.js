// Sales tax, worked out at checkout before payment (for every payment method).
//
// Two sources, chosen by store.config.js → tax.provider:
//   - Stripe Tax: exact state, county and city rates. Used when provider is
//     'stripe', or 'auto' with STRIPE_SECRET_KEY set. Turn on Stripe Tax and add
//     your registrations in the Stripe dashboard first.
//   - Your rate table: tax.rates in store.config.js (percent by two-letter
//     state). Used when Stripe isn't set up, and whenever Stripe doesn't answer.
// Only the ship-to state's rate applies (you collect where you're registered).
//
// quote() never throws. All amounts are cents.
const config = require('./config');
const store = require('./store');

const API = () => (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '');
const KEY = () => process.env.STRIPE_SECRET_KEY || '';
const CACHE_MS = 10 * 60e3;   // reuse a Stripe answer for the same cart and address for 10 minutes
const PAUSE_MS = 2 * 60e3;    // Stripe down or slow: use the table for 2 minutes before trying again
const SETUP_PAUSE_MS = 30 * 60e3; // Stripe said no (Stripe Tax not turned on, bad key): wait longer
const TIMEOUT_MS = 6000;      // never hold up checkout for long

const up = (s) => String(s ?? '').trim().toUpperCase();
const warned = new Set();
const homeCountry = () => up((config.shipping && config.shipping.countries && config.shipping.countries[0]) || 'US');
// A key from store.config.js: "CA" or "California" (your home country), or "CA-ON" (country-state).
function normKey(k) {
  const s = up(k), m = /^([A-Z]{2})-(.+)$/.exec(s);
  return m ? `${m[1]}-${normState(m[2], m[1])}` : normState(s, homeCountry());
}
function settings() {
  const t = config.tax || {};
  const rates = {};
  for (const [k, v] of Object.entries(t.rates || {})) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0 && n < 100) rates[normKey(k)] = n;
    else if (!warned.has(k)) { warned.add(k); console.warn(`store.config.js → tax.rates.${k}: "${v}" isn't a percent like 7.25, so it's ignored.`); }
  }
  return {
    provider: String(t.provider || 'auto').toLowerCase(),
    rates,
    shippingTaxable: (t.shippingTaxable || []).map(normKey),
    label: t.label || 'Sales tax',
  };
}

// "California", "calif." or "ca" → "CA" (US only; other countries are left as typed).
const US = { ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', 'DISTRICT OF COLUMBIA': 'DC', 'WASHINGTON DC': 'DC', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY', 'PUERTO RICO': 'PR', GUAM: 'GU', 'VIRGIN ISLANDS': 'VI', 'US VIRGIN ISLANDS': 'VI', 'AMERICAN SAMOA': 'AS', 'NORTHERN MARIANA ISLANDS': 'MP', CALIF: 'CA', MASS: 'MA', PENN: 'PA', WASH: 'WA' };
function normState(state, country) {
  const s = up(state).replace(/\./g, '').replace(/\s+/g, ' ');
  const c = up(country) || homeCountry();
  return c === 'US' && US[s] ? US[s] : s;
}

// The table's rate for a ship-to address, in percent, or null if you don't collect there.
// Keys are state codes ("CA"), or country-state for other countries ("CA-ON").
function rateFor(state, country) {
  const { rates } = settings();
  const c = up(country) || homeCountry(), s = normState(state, c);
  if (!s) return null;
  if (rates[`${c}-${s}`] !== undefined) return rates[`${c}-${s}`];
  if (c === homeCountry() && rates[s] !== undefined) return rates[s];
  return null;
}
const shippingTaxedIn = (state, country) => {
  const c = up(country) || homeCountry(), s = normState(state, c), list = settings().shippingTaxable;
  return list.includes(`${c}-${s}`) || (c === homeCountry() && list.includes(s));
};

// percent of an amount in cents, rounded half up (7.25% of $2.00 = 14.5¢ → 15¢)
function percentOf(cents, pct) {
  const micro = Math.round(Number(pct) * 10000); // 7.25% → 72500 millionths
  return Math.floor((Math.round(cents) * micro + 500000) / 1000000);
}
const n0 = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : 0; };
const lineAmount = (i) => Math.round(n0(i.price) * n0(i.qty));
const itemsTotal = (items) => (items || []).reduce((s, i) => s + lineAmount(i), 0);
const round6 = (x) => Math.round(x * 1e6) / 1e6;

function tableQuote({ items, shipping = 0, address = {} }) {
  const s = settings();
  if (!Object.keys(s.rates).length) return { tax: 0, rate: 0, source: 'none', label: s.label };
  const pct = rateFor(address.state, address.country);
  if (pct === null || pct === 0) return { tax: 0, rate: 0, source: 'table', label: s.label, taxable: 0, shippingTaxed: false };
  const ship = Math.round(n0(shipping));
  const shippingTaxed = shippingTaxedIn(address.state, address.country) && ship > 0;
  const taxable = itemsTotal(items) + (shippingTaxed ? ship : 0);
  return { tax: percentOf(taxable, pct), rate: round6(pct / 100), source: 'table', label: s.label, taxable, shippingTaxed };
}

// ── Stripe Tax ─────────────────────────────────────────────────────────────
async function call(path, params, headers = {}) {
  const res = await fetch(API() + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20', ...headers },
    body: params.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Stripe ${res.status}: ${(data.error && data.error.message) || 'request failed'}`), { code: data.error && data.error.code, status: res.status });
  return data;
}

async function stripeQuote({ items, shipping = 0, address = {} }) {
  const country = up(address.country) || homeCountry();
  const p = new URLSearchParams();
  p.set('currency', config.currency || 'usd');
  const addr = { line1: address.address1, city: address.city, state: normState(address.state, country), postal_code: address.zip, country };
  for (const [k, v] of Object.entries(addr)) if (String(v || '').trim()) p.set(`customer_details[address][${k}]`, String(v).trim());
  p.set('customer_details[address_source]', 'shipping');
  const seen = new Map();
  (items || []).forEach((it, i) => {
    let ref = String(it.id || `line-${i + 1}`).slice(0, 190);
    const n = (seen.get(ref) || 0) + 1; seen.set(ref, n);
    if (n > 1) ref += `#${n}`; // references must be unique within a calculation
    p.set(`line_items[${i}][amount]`, String(lineAmount(it)));
    p.set(`line_items[${i}][quantity]`, String(Math.max(1, Math.floor(n0(it.qty)))));
    p.set(`line_items[${i}][reference]`, ref);
    p.set(`line_items[${i}][tax_behavior]`, 'exclusive');
  });
  const ship = Math.round(n0(shipping));
  if (ship > 0) { p.set('shipping_cost[amount]', String(ship)); p.set('shipping_cost[tax_behavior]', 'exclusive'); }
  const data = await call('/v1/tax/calculations', p);
  const tax = Number(data.tax_amount_exclusive);
  if (!Number.isInteger(tax) || tax < 0) throw new Error('Stripe Tax answered without a tax amount');
  const shippingTaxed = !!(data.shipping_cost && Number(data.shipping_cost.amount_tax) > 0);
  const taxable = tax ? itemsTotal(items) + (shippingTaxed ? ship : 0) : 0;
  return { tax, rate: taxable ? round6(tax / taxable) : 0, source: 'stripe', calcId: data.id, label: settings().label, taxable, shippingTaxed };
}

// Stripe's answer is reused for the same cart and address for a few minutes,
// so the live checkout total and the placed order don't each call Stripe.
const cache = new Map();
const cacheKey = ({ items, shipping, address = {} }) => {
  const country = up(address.country) || homeCountry();
  return JSON.stringify([config.currency, (items || []).map((i) => [i.id, i.price, i.qty]), shipping || 0,
    up(address.address1), up(address.city), normState(address.state, country), up(address.zip), country]);
};
function remember(key, result, now) {
  cache.set(key, { at: now, result });
  if (cache.size > 500) for (const [k, v] of cache) { if (cache.size <= 400) break; if (now - v.at > CACHE_MS || cache.size > 450) cache.delete(k); }
}

let pausedUntil = 0, problem = null; // problem: { message, at } while Stripe isn't answering
function noteProblem(err, now) {
  if (!problem) console.warn(`Stripe Tax isn't answering (${err.message}). Using your rate table from store.config.js until it does.`);
  problem = { message: err.message, at: new Date(now).toISOString() };
}
const wantsStripe = (s = settings()) => s.provider === 'stripe' || (s.provider === 'auto' && !!KEY());

async function quote({ items = [], shipping = 0, address = {} } = {}) {
  const s = settings();
  try {
    if (s.provider === 'off' || !items.length) return { tax: 0, rate: 0, source: 'none', label: s.label };
    if (wantsStripe(s)) {
      const now = Date.now();
      if (!KEY()) noteProblem(new Error('tax.provider is "stripe" but STRIPE_SECRET_KEY isn’t set'), now);
      else if (now >= pausedUntil) {
        const key = cacheKey({ items, shipping, address });
        const hit = cache.get(key);
        if (hit && now - hit.at < CACHE_MS) return { ...hit.result };
        try {
          const r = await stripeQuote({ items, shipping, address });
          if (problem) { console.log('Stripe Tax is answering again.'); problem = null; }
          remember(key, r, now);
          return { ...r };
        } catch (err) {
          noteProblem(err, now);
          // a bad address is the customer's typo, not Stripe being down: keep asking Stripe for everyone else
          if (err.code !== 'customer_tax_location_invalid') pausedUntil = now + (err.status >= 400 && err.status < 500 && err.status !== 429 ? SETUP_PAUSE_MS : PAUSE_MS);
        }
      }
    }
    return tableQuote({ items, shipping, address });
  } catch (err) {
    console.error('sales tax quote failed:', err.message);
    return { tax: 0, rate: 0, source: 'none', label: s.label };
  }
}

// After an order taxed by Stripe is paid, record the sale with Stripe Tax so it
// shows in Stripe's tax reports and filings. Saves the id in order.meta.tax.transactionId.
// Never throws; returns the transaction id or null.
async function record(order) {
  try {
    const t = (order && order.meta && order.meta.tax) || {};
    if (t.source !== 'stripe' || !t.calcId || t.transactionId || !KEY()) return null;
    const create = (calcId) => call('/v1/tax/transactions/create_from_calculation', new URLSearchParams({ calculation: calcId, reference: order.id }), { 'Idempotency-Key': `tax-${order.id}-${calcId}` });
    let txn;
    try { txn = await create(t.calcId); }
    catch (err) {
      // A calculation backs one sale and expires after 90 days. Ask again for this order;
      // only record it if Stripe still comes to the tax the customer paid.
      if (!err.status || err.status >= 500) throw err; // network trouble or Stripe down: try again later
      const fresh = await stripeQuote({ items: order.items, shipping: order.shipping, address: { ...(order.customer || {}) } });
      if (fresh.tax !== Number(order.tax || 0)) throw new Error(`${err.message}; a new calculation came to ${fresh.tax}, not the ${order.tax} charged`);
      txn = await create(fresh.calcId);
    }
    const latest = (await store.getOrder(order.id)) || order;
    const { recordError, ...keep } = (latest.meta && latest.meta.tax) || t;
    await store.updateOrder(order.id, { meta: { tax: { ...keep, transactionId: txn.id } } });
    return txn.id;
  } catch (err) {
    console.error(`Stripe Tax: couldn't record the sale for order ${order && order.id}: ${err.message}`);
    try {
      const latest = order && (await store.getOrder(order.id));
      if (latest) await store.updateOrder(order.id, { meta: { tax: { ...((latest.meta && latest.meta.tax) || {}), recordError: String(err.message).slice(0, 200) } } });
    } catch {}
    return null;
  }
}

// One line for admin (Settings and Finance). Not for customers.
function describe() {
  const s = settings();
  if (s.provider === 'off') return 'Off';
  const list = Object.entries(s.rates).filter(([, v]) => v > 0);
  const table = list.length
    ? `your rates: ${list.slice(0, 6).map(([k, v]) => `${k} ${v}%`).join(', ')}${list.length > 6 ? ` and ${list.length - 6} more` : ''}`
    : 'no rates set in store.config.js, so no tax is added';
  if (s.provider === 'stripe' && !KEY()) return `Stripe Tax chosen, but STRIPE_SECRET_KEY isn’t set: using ${table}`;
  if (wantsStripe(s)) return problem ? `Stripe Tax isn’t answering (${problem.message}): using ${table}` : 'Stripe Tax';
  return table.charAt(0).toUpperCase() + table.slice(1);
}

module.exports = { quote, record, describe, normState, rateFor, percentOf, tableQuote, clearCache: () => { cache.clear(); pausedUntil = 0; problem = null; } };
