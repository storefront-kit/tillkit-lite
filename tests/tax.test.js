// Sales tax (src/tax.js): the rate table, Stripe Tax through a fake Stripe
// server, falling back when Stripe fails, caching, and recording paid sales.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'store-tax-'));
process.env.DATA_DIR = DATA;
process.env.DATABASE_URL = '';
process.env.STRIPE_SECRET_KEY = '';

const config = require('../src/config');
const store = require('../src/store');
const tax = require('../src/tax');

// Fake Stripe: answers whatever `reply` says and keeps every request.
let calls = [], reply = null;
const stripe = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const form = new URLSearchParams(body);
    calls.push({ method: req.method, url: req.url, form, headers: req.headers });
    const [status, data] = reply ? reply(req.url, form) : [404, {}];
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data));
  });
});
const stripeOk = (url, form) => {
  if (url === '/v1/tax/calculations') {
    // 8% on items, shipping taxed in NY only
    let items = 0; for (let i = 0; form.has(`line_items[${i}][amount]`); i++) items += Number(form.get(`line_items[${i}][amount]`));
    const ship = Number(form.get('shipping_cost[amount]') || 0), shipTax = form.get('customer_details[address][state]') === 'NY' ? Math.round(ship * 0.08) : 0;
    return [200, { id: `taxcalc_${calls.length}`, object: 'tax.calculation', tax_amount_exclusive: Math.round(items * 0.08) + shipTax, shipping_cost: { amount: ship, amount_tax: shipTax } }];
  }
  if (url === '/v1/tax/transactions/create_from_calculation') return [200, { id: `tax_${form.get('reference')}`, object: 'tax.transaction' }];
  return [404, { error: { message: 'no such route' } }];
};

const TABLE = { provider: 'table', rates: { CA: 7.25, Washington: 10.25, OR: 0, 'CA-ON': 13 }, shippingTaxable: ['WA', 'CA-ON'], label: 'Sales tax' };
const items = [{ id: 'mug-blue', label: 'Mug, Blue', price: 1000, qty: 2 }];
const ca = { address1: '1 Main St', city: 'Los Angeles', state: 'CA', zip: '90001', country: 'US' };
const wa = { address1: '2 Pine St', city: 'Seattle', state: 'wa', zip: '98101', country: 'US' };

before(async () => { await new Promise((r) => stripe.listen(0, '127.0.0.1', r)); process.env.STRIPE_API_BASE = `http://127.0.0.1:${stripe.address().port}`; });
after(() => { stripe.close(); fs.rmSync(DATA, { recursive: true, force: true }); });
beforeEach(() => { calls = []; reply = stripeOk; tax.clearCache(); process.env.STRIPE_SECRET_KEY = ''; config.tax = { ...TABLE }; });

test('rounding is half up, per order', () => {
  assert.equal(tax.percentOf(200, 7.25), 15, '14.5¢ rounds up');
  assert.equal(tax.percentOf(2000, 7.25), 145);
  assert.equal(tax.percentOf(2600, 10.25), 267, '266.5¢ rounds up');
  assert.equal(tax.percentOf(1999, 8.875), 177, '177.41¢');
  assert.equal(tax.percentOf(0, 9), 0);
});

test('rate table: only the ship-to state, shipping only where it is taxed', async () => {
  let q = await tax.quote({ items, shipping: 600, address: ca });
  assert.deepEqual([q.tax, q.rate, q.source, q.label], [145, 0.0725, 'table', 'Sales tax'], 'CA: shipping not taxed');
  q = await tax.quote({ items, shipping: 600, address: wa });
  assert.deepEqual([q.tax, q.rate, q.taxable], [267, 0.1025, 2600], 'WA (configured as "Washington"): shipping taxed');
  q = await tax.quote({ items, shipping: 600, address: { ...ca, state: 'California' } });
  assert.equal(q.tax, 145, 'state typed out in full');
  q = await tax.quote({ items, shipping: 600, address: { ...ca, state: 'calif.' } });
  assert.equal(q.tax, 145);
  q = await tax.quote({ items, shipping: 600, address: { ...ca, state: 'NV' } });
  assert.deepEqual([q.tax, q.source], [0, 'table'], 'not registered in NV: no tax');
  q = await tax.quote({ items, shipping: 600, address: { ...ca, state: 'OR' } });
  assert.equal(q.tax, 0);
  q = await tax.quote({ items, shipping: 1000, address: { address1: '1 King St', city: 'Toronto', state: 'ON', zip: 'M5H', country: 'CA' } });
  assert.equal(q.tax, 390, 'another country uses a country-state key: 13% of 20.00 + 10.00');
  q = await tax.quote({ items, shipping: 600, address: { ...ca, country: 'MX', state: 'CA' } });
  assert.equal(q.tax, 0, 'a CA in another country is not California');
});

test('off, empty and odd input never throw', async () => {
  config.tax = { ...TABLE, provider: 'off' };
  assert.deepEqual(await tax.quote({ items, shipping: 600, address: ca }), { tax: 0, rate: 0, source: 'none', label: 'Sales tax' });
  config.tax = { provider: 'table', rates: {} };
  assert.equal((await tax.quote({ items, shipping: 600, address: ca })).source, 'none', 'no rates: no tax');
  config.tax = { ...TABLE };
  assert.equal((await tax.quote({ items: [], shipping: 600, address: ca })).tax, 0);
  assert.equal((await tax.quote()).tax, 0);
  assert.equal((await tax.quote({ items, shipping: 600 })).tax, 0, 'no address');
  assert.equal((await tax.quote({ items: [{ id: 'x', price: 'abc', qty: 1 }], address: ca })).tax, 0);
  config.tax = undefined;
  assert.equal((await tax.quote({ items, address: ca })).source, 'none', 'no tax section at all');
});

test('Stripe Tax: request fields, the tax from tax_amount_exclusive, and a 10-minute cache', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_tax';
  config.tax = { ...TABLE, provider: 'auto' };
  const two = [...items, { id: 'tote', label: 'Tote', price: 3000, qty: 1 }];
  const q = await tax.quote({ items: two, shipping: 600, address: { ...ca, state: 'New York', city: 'Albany', zip: '12207' } });
  assert.deepEqual([q.tax, q.source, q.calcId], [Math.round(5000 * 0.08) + 48, 'stripe', 'taxcalc_1']);
  assert.equal(q.rate, Number((448 / 5600).toFixed(6)), 'effective rate over items and taxed shipping');
  assert.equal(calls.length, 1);
  const { form, headers, method } = calls[0];
  assert.equal(method, 'POST');
  assert.equal(headers.authorization, 'Bearer sk_test_tax');
  assert.match(headers['content-type'], /x-www-form-urlencoded/);
  assert.equal(form.get('currency'), config.currency);
  assert.equal(form.get('customer_details[address][line1]'), '1 Main St');
  assert.equal(form.get('customer_details[address][city]'), 'Albany');
  assert.equal(form.get('customer_details[address][state]'), 'NY');
  assert.equal(form.get('customer_details[address][postal_code]'), '12207');
  assert.equal(form.get('customer_details[address][country]'), 'US');
  assert.equal(form.get('customer_details[address_source]'), 'shipping');
  assert.deepEqual([form.get('line_items[0][amount]'), form.get('line_items[0][reference]'), form.get('line_items[0][tax_behavior]')], ['2000', 'mug-blue', 'exclusive']);
  assert.deepEqual([form.get('line_items[1][amount]'), form.get('line_items[1][reference]')], ['3000', 'tote']);
  assert.equal(form.get('shipping_cost[amount]'), '600');

  const again = await tax.quote({ items: two, shipping: 600, address: { ...ca, state: 'ny', city: 'Albany', zip: '12207' } });
  assert.equal(again.calcId, 'taxcalc_1'); assert.equal(calls.length, 1, 'same cart and address: cached');
  await tax.quote({ items: two, shipping: 600, address: ca });
  assert.equal(calls.length, 2, 'another address asks Stripe again');
  await tax.quote({ items: [{ ...items[0], qty: 3 }], shipping: 600, address: ca });
  assert.equal(calls.length, 3, 'another cart asks Stripe again');
  assert.equal(tax.describe(), 'Stripe Tax');

  // the same option twice still gets unique references
  calls = []; await tax.quote({ items: [items[0], items[0]], shipping: 0, address: wa });
  assert.deepEqual([calls[0].form.get('line_items[0][reference]'), calls[0].form.get('line_items[1][reference]')], ['mug-blue', 'mug-blue#2']);
  assert.equal(calls[0].form.has('shipping_cost[amount]'), false, 'free shipping: no shipping line');
});

test('Stripe errors fall back to the table, log once, and pause Stripe for a bit', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_tax';
  config.tax = { ...TABLE, provider: 'stripe' };
  reply = () => [500, { error: { message: 'Stripe is having a moment' } }];
  const warns = []; const orig = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  try {
    const q = await tax.quote({ items, shipping: 600, address: ca });
    assert.deepEqual([q.tax, q.source, q.calcId], [145, 'table', undefined]);
    const q2 = await tax.quote({ items, shipping: 600, address: wa });
    assert.equal(q2.tax, 267);
    assert.equal(calls.length, 1, 'paused after a failure: no second call');
    assert.equal(warns.filter((w) => /Stripe Tax isn't answering/.test(w)).length, 1, 'logged once');
    assert.match(tax.describe(), /Stripe Tax isn’t answering \(Stripe 500: Stripe is having a moment\): using your rates: CA 7\.25%/);
  } finally { console.warn = orig; }

  // a timeout or unreachable Stripe behaves the same
  tax.clearCache(); process.env.STRIPE_API_BASE_SAVED = process.env.STRIPE_API_BASE; process.env.STRIPE_API_BASE = 'http://127.0.0.1:1';
  console.warn = () => {};
  try { assert.equal((await tax.quote({ items, shipping: 0, address: ca })).source, 'table'); }
  finally { console.warn = orig; process.env.STRIPE_API_BASE = process.env.STRIPE_API_BASE_SAVED; }

  // 'stripe' without a key: table, and admin is told why
  tax.clearCache(); process.env.STRIPE_SECRET_KEY = ''; console.warn = () => {};
  try { assert.equal((await tax.quote({ items, shipping: 0, address: ca })).tax, 145); } finally { console.warn = orig; }
  assert.equal(calls.length, 1);
  assert.match(tax.describe(), /STRIPE_SECRET_KEY isn’t set/);
  // 'auto' without a key just uses the table
  config.tax = { ...TABLE, provider: 'auto' };
  assert.match(tax.describe(), /^Your rates: CA 7\.25%/);
  assert.equal((await tax.quote({ items, shipping: 0, address: ca })).source, 'table');
});

test('a bad address from one customer does not pause Stripe for everyone', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_tax';
  config.tax = { ...TABLE, provider: 'auto' };
  let n = 0;
  reply = (url, form) => (n++ === 0 ? [400, { error: { code: 'customer_tax_location_invalid', message: 'We could not determine the customer’s tax location' } }] : stripeOk(url, form));
  const orig = console.warn; console.warn = () => {};
  try {
    assert.equal((await tax.quote({ items, shipping: 0, address: { ...ca, zip: '00000' } })).source, 'table');
    assert.equal((await tax.quote({ items, shipping: 0, address: ca })).source, 'stripe');
  } finally { console.warn = orig; }
});

test('record(): a paid Stripe-taxed order becomes a Stripe Tax transaction, once', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_tax';
  config.tax = { ...TABLE, provider: 'auto' };
  const q = await tax.quote({ items, shipping: 600, address: ca });
  const order = await store.createOrder({ status: 'paid', email: 'a@example.com', customer: { name: 'A', ...ca }, items, subtotal: 2000, shipping: 600, tax: q.tax, total: 2600 + q.tax, meta: { tax: { source: 'stripe', rate: q.rate, label: 'Sales tax', calcId: q.calcId } } });
  calls = [];
  assert.equal(await tax.record(order), `tax_${order.id}`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/v1/tax/transactions/create_from_calculation');
  assert.equal(calls[0].form.get('calculation'), q.calcId);
  assert.equal(calls[0].form.get('reference'), order.id);
  assert.ok(calls[0].headers['idempotency-key']);
  const saved = await store.getOrder(order.id);
  assert.equal(saved.meta.tax.transactionId, `tax_${order.id}`);
  assert.equal(saved.meta.tax.calcId, q.calcId, 'keeps the rest of meta.tax');
  assert.equal(await tax.record(saved), null, 'already recorded');
  assert.equal(calls.length, 1);

  // table-taxed orders and orders without tax are left alone
  const t = await store.createOrder({ status: 'paid', email: 'b@example.com', customer: ca, items, subtotal: 2000, shipping: 0, tax: 145, total: 2145, meta: { tax: { source: 'table', rate: 0.0725 } } });
  assert.equal(await tax.record(t), null);
  assert.equal(await tax.record({ id: 'X', meta: {} }), null);
  assert.equal(await tax.record(null), null);
  assert.equal(calls.length, 1);
});

test('record(): an expired calculation is redone if the tax still matches; failures are saved, never thrown', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_tax';
  config.tax = { ...TABLE, provider: 'auto' };
  const mk = (taxAmt) => store.createOrder({ status: 'paid', email: 'c@example.com', customer: { name: 'C', ...ca }, items, subtotal: 2000, shipping: 600, tax: taxAmt, total: 2600 + taxAmt, meta: { tax: { source: 'stripe', calcId: 'taxcalc_old' } } });
  reply = (url, form) => (url.endsWith('create_from_calculation') && form.get('calculation') === 'taxcalc_old' ? [400, { error: { message: 'This calculation has expired' } }] : stripeOk(url, form));
  const errs = []; const orig = console.error; console.error = (...a) => errs.push(a.join(' '));
  try {
    const good = await mk(160);
    assert.equal(await tax.record(good), `tax_${good.id}`);
    assert.equal(calls.filter((c) => c.url === '/v1/tax/calculations').length, 1, 'asked Stripe again');
    const bad = await mk(999);
    assert.equal(await tax.record(bad), null);
    const saved = await store.getOrder(bad.id);
    assert.equal(saved.meta.tax.transactionId, undefined);
    assert.match(saved.meta.tax.recordError, /not the 999 charged/);
    assert.equal(errs.length, 1);
    reply = () => [503, { error: { message: 'down' } }];
    const down = await mk(160);
    assert.equal(await tax.record(down), null);
    assert.match((await store.getOrder(down.id)).meta.tax.recordError, /Stripe 503/);
  } finally { console.error = orig; }
});

test('describe() for admin', () => {
  config.tax = { ...TABLE, provider: 'off' };
  assert.equal(tax.describe(), 'Off');
  config.tax = { provider: 'table', rates: {} };
  assert.match(tax.describe(), /no rates set in store\.config\.js/i);
  config.tax = { provider: 'table', rates: { CA: 7.25, NY: 8.875, TX: 8.25, FL: 7, IL: 10.25, NJ: 6.625, PA: 6, OH: 7.25 } };
  assert.match(tax.describe(), /and 2 more$/);
});
