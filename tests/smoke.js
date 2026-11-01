// End-to-end check of the main flows against a throwaway copy of the store.
// Uses a fake Stripe server, so no keys or internet needed.  Run: npm test
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const assert = require('assert');

const PORT = 3999, STRIPE_PORT = 3998, SECRET = 'whsec_test_123';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'store-test-'));
const BASE = `http://127.0.0.1:${PORT}`;
let lastSessionBody = null, paidFor = null;

// Fake Stripe
const stripe = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
      lastSessionBody = new URLSearchParams(body);
      return res.end(JSON.stringify({ id: 'cs_test_abc', url: 'https://checkout.stripe.test/pay/cs_test_abc' }));
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/checkout/sessions/cs_test_abc')) {
      return res.end(JSON.stringify({ id: 'cs_test_abc', payment_status: 'paid', payment_intent: 'pi_test', amount_total: 0, metadata: { order_id: paidFor } }));
    }
    res.statusCode = 404; res.end('{}');
  });
});

const jar = {};
async function req(method, url, { form, json, headers = {}, raw, who = 'anon', redirect = 'manual' } = {}) {
  const h = { ...headers };
  if (jar[who]) h.Cookie = jar[who];
  let body;
  if (form) { body = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
  if (json) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
  if (raw !== undefined) body = raw;
  const res = await fetch(BASE + url, { method, headers: h, body, redirect });
  const sc = res.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
  const text = await res.text();
  return { status: res.status, text, location: res.headers.get('location'), type: res.headers.get('content-type') };
}
const csrfOf = (html) => (/name="csrf" value="([^"]+)"/.exec(html) || [])[1];
const docs = () => JSON.parse(fs.readFileSync(path.join(DATA, 'docs.json'), 'utf8'));
const orders = () => JSON.parse(fs.readFileSync(path.join(DATA, 'orders.json'), 'utf8'));
const stockOf = (slug, id) => docs().products[slug].variants.find((v) => v.id === id).stock;
const sign = (payload) => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${crypto.createHmac('sha256', SECRET).update(`${t}.${payload}`).digest('hex')}`; };
const address = { email: 'buyer@example.com', name: 'Ada Buyer', address1: '1 Main St', city: 'Portland', state: 'OR', zip: '97201', country: 'US' };

let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }

(async () => {
  await new Promise((r) => stripe.listen(STRIPE_PORT, r));
  const app = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, PORT, DATA_DIR: DATA, DATABASE_URL: '', ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: 'correct-horse-battery', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_API_BASE: `http://127.0.0.1:${STRIPE_PORT}`, PAYMENT_PROVIDER: 'stripe', RESEND_API_KEY: '', COMING_SOON: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; app.stdout.on('data', (d) => { log += d; }); app.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 50 && !log.includes('running on port'); i++) await new Promise((r) => setTimeout(r, 100));
  if (!log.includes('running on port')) { console.error(log); process.exit(1); }

  try {
    console.log('Storefront');
    await step('home, shop, product, about and policy pages render', async () => {
      for (const u of ['/', '/shop', '/shop?c=Kitchen', '/product/stoneware-mug', '/about', '/policies/terms', '/policies/privacy', '/cart', '/checkout', '/login', '/register', '/forgot']) {
        const r = await req('GET', u); assert.strictEqual(r.status, 200, `${u} → ${r.status}`);
      }
      const p = await req('GET', '/product/stoneware-mug');
      assert.match(p.text, /application\/ld\+json/); assert.match(p.text, /Stoneware mug/);
      assert.strictEqual((await req('GET', '/nope')).status, 404);
    });
    await step('sitemap and robots', async () => {
      assert.match((await req('GET', '/sitemap.xml')).text, /\/product\/stoneware-mug/);
      assert.match((await req('GET', '/robots.txt')).text, /Disallow: \/admin/);
    });

    console.log('Checkout');
    await step('rejects sold-out and over-stock carts', async () => {
      let r = await req('POST', '/checkout', { form: { ...address, items: JSON.stringify([{ id: 'brass-bookmark-default', qty: 1 }]) } });
      assert.strictEqual(r.status, 400); assert.match(r.text, /just sold out/);
      r = await req('POST', '/checkout', { form: { ...address, items: JSON.stringify([{ id: 'dot-grid-notebook-default', qty: 5 }]) } });
      assert.strictEqual(r.status, 400); assert.match(r.text, /Only 4/);
      r = await req('POST', '/checkout', { form: { ...address, items: '[{"id":"made-up","qty":1}]' } });
      assert.strictEqual(r.status, 400);
    });
    let o1;
    await step('Stripe: creates a session with server-side prices and reserves stock', async () => {
      const r = await req('POST', '/checkout', { form: { ...address, items: JSON.stringify([{ id: 'stoneware-mug-sand', qty: 2, price: 1 }]) } });
      assert.strictEqual(r.status, 303); assert.match(r.location, /^https:\/\/checkout\.stripe\.test/);
      assert.strictEqual(lastSessionBody.get('line_items[0][price_data][unit_amount]'), '2800');
      assert.strictEqual(lastSessionBody.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'), '600');
      o1 = orders().at(-1); assert.strictEqual(o1.status, 'pending_payment'); assert.strictEqual(o1.total, 6200);
      assert.strictEqual(stockOf('stoneware-mug', 'stoneware-mug-sand'), 22);
    });
    await step('Stripe webhook: rejects a bad signature, accepts a good one and marks paid', async () => {
      const evt = JSON.stringify({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', metadata: { order_id: o1.id }, payment_intent: 'pi_1', amount_total: 6200 } } });
      assert.strictEqual((await req('POST', '/webhooks/stripe', { raw: evt, headers: { 'Stripe-Signature': 't=1,v1=deadbeef' } })).status, 400);
      assert.strictEqual((await req('POST', '/webhooks/stripe', { raw: evt, headers: { 'Stripe-Signature': sign(evt) } })).status, 200);
      assert.strictEqual(orders().find((o) => o.id === o1.id).status, 'paid');
      assert.strictEqual((await req('POST', '/webhooks/stripe', { raw: evt, headers: { 'Stripe-Signature': sign(evt) } })).status, 200, 'duplicate delivery is fine');
    });
    await step('order page needs its key', async () => {
      assert.strictEqual((await req('GET', `/order/${o1.id}`)).status, 404);
      const r = await req('GET', `/order/${o1.id}?k=${o1.key}`); assert.strictEqual(r.status, 200); assert.match(r.text, /Thank you, Ada/);
    });
    await step('expired session cancels the order and returns stock', async () => {
      await req('POST', '/checkout', { form: { ...address, items: JSON.stringify([{ id: 'stoneware-mug-sand', qty: 3 }]) } });
      const o2 = orders().at(-1); assert.strictEqual(stockOf('stoneware-mug', 'stoneware-mug-sand'), 19);
      const evt = JSON.stringify({ type: 'checkout.session.expired', data: { object: { metadata: { order_id: o2.id } } } });
      await req('POST', '/webhooks/stripe', { raw: evt, headers: { 'Stripe-Signature': sign(evt) } });
      assert.strictEqual(orders().find((o) => o.id === o2.id).status, 'cancelled');
      assert.strictEqual(stockOf('stoneware-mug', 'stoneware-mug-sand'), 22);
      await req('POST', '/webhooks/stripe', { raw: evt, headers: { 'Stripe-Signature': sign(evt) } }); // Stripe can resend events
      assert.strictEqual(stockOf('stoneware-mug', 'stoneware-mug-sand'), 22, 'stock returned only once');
    });
    await step('returning from Stripe confirms payment even without a webhook', async () => {
      await req('POST', '/checkout', { form: { ...address, items: JSON.stringify([{ id: 'soy-candle-12-oz', qty: 3 }]) } });
      const o3 = orders().at(-1); paidFor = o3.id;
      assert.strictEqual(o3.shipping, 0, 'free shipping over $75');
      const r = await req('GET', `/order/${o3.id}?k=${o3.key}&session_id=cs_test_abc`);
      assert.match(r.text, /Thank you/); assert.strictEqual(orders().find((o) => o.id === o3.id).status, 'paid');
    });
    await step('blocks cross-site form posts', async () => {
      const r = await req('POST', '/checkout', { form: address, headers: { Origin: 'https://evil.example' } });
      assert.strictEqual(r.status, 403);
    });

    console.log('Accounts');
    await step('register, see account, wrong password rejected', async () => {
      const r = await req('POST', '/register', { who: 'c', form: { name: 'Cy Customer', email: 'cy@example.com', password: 'longenough123' } });
      assert.strictEqual(r.status, 303);
      assert.match((await req('GET', '/account', { who: 'c' })).text, /Hi, Cy/);
      assert.strictEqual((await req('POST', '/login', { form: { email: 'cy@example.com', password: 'nope' } })).status, 400);
      assert.strictEqual((await req('GET', '/admin', { who: 'c' })).status, 403);
    });

    console.log('Admin');
    let csrf;
    await step('admin signs in', async () => {
      const r = await req('POST', '/login', { who: 'a', form: { email: 'owner@example.com', password: 'correct-horse-battery' } });
      assert.strictEqual(r.location, '/admin');
      csrf = csrfOf((await req('GET', '/admin/products/new', { who: 'a' })).text); assert.ok(csrf);
    });
    let imgUrl;
    await step('uploads a photo (rejects non-images)', async () => {
      const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
      let r = await req('POST', '/admin/upload', { who: 'a', json: { csrf, data: `data:image/png;base64,${png.toString('base64')}` } });
      assert.strictEqual(r.status, 200); imgUrl = JSON.parse(r.text).url;
      const img = await req('GET', imgUrl); assert.strictEqual(img.type, 'image/png');
      r = await req('POST', '/admin/upload', { who: 'a', json: { csrf, data: `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}` } });
      assert.strictEqual(r.status, 400);
      r = await req('POST', '/admin/upload', { who: 'a', json: { csrf: 'wrong', data: 'x' } });
      assert.strictEqual(r.status, 403);
    });
    await step('adds a product that shows up in the shop', async () => {
      const f = new URLSearchParams({ csrf, name: 'Test Lamp', category: 'Lighting', summary: 'Bright.', description: 'Line one\n\n- a\n- b', optionName: 'Finish', image: imgUrl, active: 'yes', featured: 'no', sort: '0' });
      for (const [l, p, s] of [['Black', '89', '3'], ['White', '89', '']]) { f.append('var_id', ''); f.append('var_label', l); f.append('var_price', p); f.append('var_compare', ''); f.append('var_sku', ''); f.append('var_stock', s); f.append('var_active', 'yes'); }
      const r = await req('POST', '/admin/products/new', { who: 'a', raw: f.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      assert.strictEqual(r.status, 200); assert.match(r.text, /Test Lamp added/);
      assert.match((await req('GET', '/shop?c=Lighting')).text, /Test Lamp/);
      const bad = await req('POST', '/admin/products/new', { who: 'a', form: { csrf, name: 'No price' } });
      assert.strictEqual(bad.status, 400);
    });
    await step('marks an order shipped with tracking', async () => {
      const r = await req('POST', `/admin/orders/${o1.id}`, { who: 'a', form: { csrf, status: 'shipped', tracking: '1Z999' } });
      assert.strictEqual(r.status, 303);
      const o = orders().find((x) => x.id === o1.id); assert.strictEqual(o.status, 'shipped'); assert.strictEqual(o.meta.tracking, '1Z999');
      assert.match((await req('GET', '/admin/orders', { who: 'a' })).text, /1Z999/);
    });
    await step('rejects admin posts without a valid CSRF token', async () => {
      assert.strictEqual((await req('POST', `/admin/orders/${o1.id}`, { who: 'a', form: { csrf: 'x', status: 'cancelled' } })).status, 403);
    });

    console.log(`\nAll ${passed} checks passed.`);
  } catch (err) {
    console.error('\nFAILED:', err.message, '\n--- server log ---\n' + log);
    process.exitCode = 1;
  } finally {
    app.kill(); stripe.close(); fs.rmSync(DATA, { recursive: true, force: true });
  }
})();
