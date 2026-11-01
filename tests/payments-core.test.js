// Checkout payment choices, invoice holds, partial payments, refunds.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'store-core-'));
let app, log = '';
const jar = {};
async function req(method, url, { form, json, who = 'anon', headers = {} } = {}) {
  const h = { ...headers }; if (jar[who]) h.Cookie = jar[who];
  let body;
  if (form) { body = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
  if (json) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
  const res = await fetch(BASE + url, { method, headers: h, body, redirect: 'manual' });
  const sc = res.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
  return { status: res.status, text: await res.text(), location: res.headers.get('location'), type: res.headers.get('content-type') };
}
const orders = () => JSON.parse(fs.readFileSync(path.join(DATA, 'orders.json'), 'utf8'));
const docs = () => JSON.parse(fs.readFileSync(path.join(DATA, 'docs.json'), 'utf8'));
const csrfOf = (html) => (/name="csrf" value="([^"]+)"/.exec(html) || [])[1];
const addr = { email: 'zoe@example.com', name: 'Zoe Park', address1: '9 Elm St', city: 'Salem', state: 'OR', zip: '97301', country: 'US' };
let csrf;

before(async () => {
  app = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, PORT, DATA_DIR: DATA, DATABASE_URL: '', ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: 'correct-horse-battery', STRIPE_SECRET_KEY: '', PAYMENT_PROVIDER: '', JOBS: 'off', PUBLIC_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', (d) => { log += d; }); app.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 60 && !log.includes('running on port'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes('running on port'), log);
  await req('POST', '/login', { who: 'a', form: { email: 'owner@example.com', password: 'correct-horse-battery' } });
  csrf = csrfOf((await req('GET', '/admin/settings', { who: 'a' })).text);
});
after(() => { app.kill(); fs.rmSync(DATA, { recursive: true, force: true }); });

test('with nothing set up, checkout offers pay by invoice', async () => {
  const r = await req('GET', '/checkout');
  assert.match(r.text, /value="invoice"/);
});

test('a product cost entered in admin is snapshotted on the order line', async () => {
  const p = docs().products['canvas-tote'];
  const f = new URLSearchParams({ csrf, name: p.name, category: p.category, summary: p.summary, description: p.description, optionName: 'Option', active: 'yes', featured: 'no', sort: '6' });
  for (const im of p.images) f.append('image', im);
  const v = p.variants[0];
  for (const [k, val] of [['var_id', v.id], ['var_label', v.label], ['var_price', '38.00'], ['var_compare', ''], ['var_sku', v.sku], ['var_stock', '10'], ['var_cost', '11.50'], ['var_active', 'yes']]) f.append(k, val);
  const raw = await fetch(BASE + '/admin/products/canvas-tote', { method: 'POST', headers: { Cookie: jar.a, 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() });
  assert.equal(raw.status, 200);
  assert.equal(docs().products['canvas-tote'].variants[0].cost, 1150);
});

let held;
test('invoice order: held, instructions shown, cart cleared, no screenshot upload', async () => {
  const r = await req('POST', '/checkout', { form: { ...addr, method: 'invoice', items: JSON.stringify([{ id: 'canvas-tote-default', qty: 2 }]) } });
  assert.equal(r.status, 303); assert.match(r.location, /\/order\/NB-[A-F0-9]{8}\?k=.+&placed=1/);
  held = orders().at(-1);
  assert.equal(held.meta.payment.method, 'invoice');
  assert.equal(held.items[0].cost, 1150);
  assert.ok(Date.parse(held.meta.holdUntil) - Date.now() > 71 * 3600e3);
  assert.equal(docs().products['canvas-tote'].variants[0].stock, 8);
  const page = await req('GET', r.location);
  assert.match(page.text, /holding your items until/); assert.match(page.text, /data-clear-cart/);
  assert.doesNotMatch(page.text, /data-proof/, 'no screenshot upload for invoices');
});

test('partial payment, then the rest: order becomes paid', async () => {
  await req('POST', `/admin/orders/${held.id}/payment`, { who: 'a', form: { csrf, amount: '40', method: 'check', ref: 'CHK-1' } });
  let o = orders().find((x) => x.id === held.id);
  assert.equal(o.status, 'pending_payment'); assert.equal(o.meta.payments.length, 1);
  assert.match((await req('GET', `/order/${o.id}?k=${o.key}`)).text, /is still due/);
  await req('POST', `/admin/orders/${held.id}/payment`, { who: 'a', form: { csrf, amount: String((o.total - 4000) / 100), method: 'check', ref: 'CHK-2' } });
  o = orders().find((x) => x.id === held.id);
  assert.equal(o.status, 'paid');
});

test('refunds are recorded and a full refund sets Refunded', async () => {
  const o = orders().find((x) => x.id === held.id);
  await req('POST', `/admin/orders/${o.id}/refund`, { who: 'a', form: { csrf, amount: '10', note: 'damaged' } });
  assert.equal(orders().find((x) => x.id === o.id).status, 'paid');
  await req('POST', `/admin/orders/${o.id}/refund`, { who: 'a', form: { csrf, amount: String((o.total - 1000) / 100) } });
  assert.equal(orders().find((x) => x.id === o.id).status, 'refunded');
});

test('marking a pay-by-hand order paid records the balance', async () => {
  await req('POST', '/checkout', { form: { ...addr, method: 'invoice', items: JSON.stringify([{ id: 'bud-vase-default', qty: 1 }]) } });
  const o = orders().at(-1);
  await req('POST', `/admin/orders/${o.id}`, { who: 'a', form: { csrf, status: 'paid', tracking: '', postage: '4.10' } });
  const after = orders().find((x) => x.id === o.id);
  assert.equal(after.status, 'paid'); assert.equal(after.meta.payments[0].amount, o.total); assert.equal(after.meta.postage, 410);
});

test('live checkout quote returns shipping and tax for an address', async () => {
  const r = JSON.parse((await req('POST', '/checkout/quote', { json: { items: [{ id: 'bud-vase-default', qty: 1 }], state: 'OR', zip: '97301', country: 'US' } })).text);
  assert.equal(r.subtotal, 3600); assert.equal(r.shipping, 600); assert.equal(r.total, 4200 + r.tax); assert.equal(r.taxReady, true);
});
