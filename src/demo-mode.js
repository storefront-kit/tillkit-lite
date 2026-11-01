// Demo mode (DEMO=on): a public copy of the store anyone can click through.
//  - A banner on every page says nothing is for sale and no money moves.
//  - Card payments are simulated (and any add-on methods, through the add-on's own demo module). The demo
//    never talks to Stripe and never sends email, whatever keys are in the environment.
//  - "Open the admin" signs a visitor into a shared demo admin. They can look at everything,
//    but saving is off, except on orders they placed themselves.
//  - Visitors only ever see the sample orders and their own, never other visitors' orders.
//  - Stock doesn't move for visitors, so the shelves never empty.
//  - Optional: DEMO_BUY_URL (https) adds a link to buy the template to the banner; DEMO_BUY_TEXT sets its words.
//  - Visitors can preview every theme and color preset (?theme=…&palette=…, remembered in a cookie),
//    for their own browser only; the store's settings never change.
// With DEMO unset none of this runs. Don't turn it on for a real store.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('./config');

const ON = !!config.demo;
const COOKIE = 'sf_demo';
const LOOK_COOKIE = 'sf_look';
const DEMO_EMAIL = 'demo-admin@demo.invalid';
const SAMPLE_INVOICE = path.join(__dirname, '..', 'docs', 'sample-supplier-invoice.pdf');
const ORDER = '([A-Z0-9]{1,6}-[A-F0-9]{8})';
const VISITOR_ORDER_HOURS = 48;
// State base rates only (no city or county tax), so the demo shows tax without claiming local accuracy.
const SAMPLE_RATES = { WA: 6.5, CA: 7.25, TX: 6.25, NY: 4, FL: 6, IL: 6.25, PA: 6, NJ: 6.625, MA: 6.25, OH: 5.75 };

// Set before the payment modules load, so they pick these up.
if (ON) {
  if (/^sk_live_/.test(process.env.STRIPE_SECRET_KEY || '')) { console.error('DEMO=on will not start with a live Stripe key. Remove DEMO or the key.'); process.exit(1); }
  for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY']) delete process.env[k];
  config.tax.provider = 'table';
  if (!Object.keys(config.tax.rates || {}).length) config.tax.rates = { ...SAMPLE_RATES };
}
// An add-on can bring its own simulated payments and sample data in a src/demo-<name>.js file.
let packDemo = null;
if (ON) { const extra = fs.readdirSync(__dirname).find((f) => /^demo-.+\.js$/.test(f) && f !== 'demo-mode.js'); if (extra) packDemo = require(`./${extra}`); }

const als = new AsyncLocalStorage();
const here = () => als.getStore() || null;
const cookieOf = (req, name) => { const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`)); return m ? m[1] : ''; };

// Each browser gets an anonymous visitor id (cookie), and every request runs with it in context.
function wrap(handler) {
  if (!ON) return handler;
  return (req, res) => {
    // Let several Set-Cookie headers stack instead of the last one replacing the others.
    const setHeader = res.setHeader.bind(res);
    res.setHeader = (k, v) => { const prev = String(k).toLowerCase() === 'set-cookie' && res.getHeader('Set-Cookie'); return setHeader(k, prev ? [].concat(prev, v) : v); };
    let visitor = cookieOf(req, COOKIE);
    if (!/^[a-f0-9]{32}$/.test(visitor)) {
      visitor = crypto.randomBytes(16).toString('hex');
      res.setHeader('Set-Cookie', `${COOKIE}=${visitor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    }
    return als.run({ visitor, owner: false }, () => handler(req, res));
  };
}

// The owner sees everything; everyone else sees the sample orders plus their own.
function visible(o) {
  const c = here();
  if (!c || c.owner) return true;
  const m = (o && o.meta) || {};
  return !!(m.demoSeed || (c.visitor && m.demoVisitor === c.visitor));
}

if (ON) {
  const store = require('./store');
  for (const fn of ['listOrders', 'allOrders', 'ordersWithStatus', 'listOrdersByUser']) {
    const orig = store[fn];
    store[fn] = async (...a) => (await orig.apply(store, a)).filter(visible);
  }
  const create = store.createOrder;
  store.createOrder = (o) => { const c = here(); return create.call(store, { ...o, meta: { ...(o.meta || {}), ...(c && !c.owner ? { demoVisitor: c.visitor } : {}) } }); };
  // Visitors' orders don't move stock (background jobs have no visitor, so they don't either).
  const products = require('./products');
  for (const fn of ['reserve', 'release']) {
    const orig = products[fn];
    products[fn] = async (...a) => { const c = here(); return c && c.owner ? orig.apply(products, a) : undefined; };
  }
}


// Answered before sessions are loaded (an add-on's stand-in services, if any).
const early = async (req, res, p) => !!(ON && packDemo && (await packDemo.early(req, res, p)));

// ---- simulated card checkout (stands in for Stripe) ----
const card = {
  name: 'demo', label: 'Card (simulated)',
  ready: () => true,
  async start(order) { return { redirect: `/demo/card/${order.id}?k=${order.key}` }; },
  async confirm() { return null; },
};

// ---- pages ----
function shell(ctx, title, body, status = 200) {
  const views = require('./views');
  return [status, views.page(ctx, () => views.layout({ title, body: `<section class="wrap section narrow demo-page">${body}</section>`, noindex: true }))];
}
function locked(ctx, back) {
  return shell(ctx, 'Switched off in the demo', `
    <h1 class="page-title">That’s switched off in the demo</h1>
    <p class="lead">You can open every page of the admin, but saving is off so the store looks the same for everyone. On orders you placed yourself, you can record payments and change the status.</p>
    <p><a class="btn btn-primary" href="${back}">Go back</a></p>`, 403);
}
function intro(ctx) {
  return shell(ctx, 'Try the admin', `
    <p class="eyebrow">Demo</p>
    <h1 class="page-title">Try the admin</h1>
    <p class="lead">This is the side of the store the owner sees: orders and payments, settings, inventory, reordering and finance reports.</p>
    <ul class="demo-list">
      <li>Look at every page. Saving is off, so nothing you click changes the store for anyone else.</li>
      <li>Orders you placed in this browser show up next to the sample orders, and you can mark them paid or shipped.</li>
      <li>Other visitors never see your orders, and you never see theirs.</li>
    </ul>
    <form method="post" action="/demo/admin"><button class="btn btn-primary" type="submit">Open the demo admin</button></form>`);
}
function cardPage(ctx, order) {
  const views = require('./views');
  const total = config.money(order.total);
  return shell(ctx, 'Card payment', `
    <p class="eyebrow">Order ${views.esc(order.id)}</p>
    <h1 class="page-title">Card payment</h1>
    <p class="demo-callout">In your store, this step is Stripe Checkout: Stripe’s own secure page, where buyers type a card or use Apple Pay or Google Pay. The demo charges nothing.</p>
    <div class="panel demo-card">
      <div class="demo-card-total"><span>Total</span><strong>${views.esc(total)}</strong></div>
      <label class="field"><span>Card number</span><input value="4242 4242 4242 4242" disabled></label>
      <div class="demo-card-row"><label class="field"><span>Expiry</span><input value="12 / 34" disabled></label><label class="field"><span>CVC</span><input value="123" disabled></label></div>
      <form method="post" action="/demo/card/${views.esc(order.id)}?k=${views.esc(order.key)}"><button class="btn btn-primary btn-block" type="submit">Pay ${views.esc(total)} (simulated)</button></form>
      <p class="small muted"><a href="/checkout?canceled=1">Cancel and go back</a></p>
    </div>`);
}

async function demoUser() {
  const auth = require('./auth');
  let u = (await auth.getUser(DEMO_EMAIL)) || (await auth.createUser({ email: DEMO_EMAIL, password: crypto.randomBytes(24).toString('hex'), name: 'Demo admin', role: 'admin' })) || (await auth.getUser(DEMO_EMAIL));
  if (!u.demo || u.role !== 'admin') { u.demo = true; u.role = 'admin'; await require('./auth').saveUser(u); }
  return u;
}

// Theme and color preview for visitors: ?theme=bold&palette=forest (either one), kept in a cookie.
// ?theme= with no value goes back to the store's own look. Only names from the lists are accepted.
function previewLook(req, res, ctx, url) {
  const { THEMES, PALETTES, look } = config;
  const known = (list, name) => (Object.prototype.hasOwnProperty.call(list, name) ? name : '');
  const asked = req.method === 'GET' && (url.searchParams.has('theme') || url.searchParams.has('palette'));
  const saved = cookieOf(req, LOOK_COOKIE).split('.');
  const t = known(THEMES, asked ? url.searchParams.get('theme') : saved[0]);
  const pal = known(PALETTES, asked ? url.searchParams.get('palette') : saved[1]);
  if (asked) res.setHeader('Set-Cookie', `${LOOK_COOKIE}=${t || pal ? `${t}.${pal}` : ''}; Path=/; SameSite=Lax; Max-Age=${t || pal ? 30 * 86400 : 0}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  if (t || pal) ctx.look = look(t || config.themeName, pal);
  // The switcher re-opens the same page, so it carries the page's other query parameters (an order's key).
  const keep = [...url.searchParams].filter(([k]) => k !== 'theme' && k !== 'palette');
  ctx.lookOptions = { themes: Object.keys(THEMES), palettes: Object.keys(PALETTES), keep };
}

// Runs after the session is loaded and before every other route. Returns true if it answered.
async function handle(req, res, ctx, h) {
  if (!ON) return false;
  previewLook(req, res, ctx, h.url);
  const H = require('./http'), store = require('./store'), orders = require('./orders');
  const c = here() || {};
  const u = ctx.user;
  if (u && u.role === 'admin' && !u.demo) c.owner = true;
  const demoAdmin = !!(u && u.demo);
  const { p, url } = h;
  const reply = ([status, html]) => { H.send(res, status, html, undefined, { 'Cache-Control': 'no-store' }); return true; };
  const keyed = async (id) => { const o = await store.getOrder(id); return o && url.searchParams.get('k') === o.key ? o : null; };
  let m;

  if (p === '/demo/admin') {
    if (req.method === 'POST') { await auth().startSession(res, await demoUser()); H.redirect(res, '/admin/orders'); return true; }
    if (u && u.role === 'admin') { H.redirect(res, '/admin/orders'); return true; }
    return reply(intro(ctx));
  }
  if (packDemo && (await packDemo.handle(req, res, ctx, h, { reply, shell, keyed, als }))) return true;
  if ((m = p.match(new RegExp(`^/demo/card/${ORDER}$`)))) {
    const order = await keyed(m[1]);
    if (!order) return reply(shell(ctx, 'Not found', '<h1 class="page-title">Order not found</h1>', 404));
    const back = `/order/${order.id}?k=${order.key}&placed=1`;
    if (order.status !== 'pending_payment') { H.redirect(res, back); return true; }
    if (req.method === 'POST') { await orders.markPaid(order, { ref: 'demo_' + crypto.randomBytes(6).toString('hex'), amount: order.total, base: h.base, method: 'card' }); H.redirect(res, back); return true; }
    return reply(cardPage(ctx, order));
  }
  if (p === '/demo/inventory-sample' && req.method === 'POST' && fs.existsSync(path.join(__dirname, 'inventory.js'))) {
    if (!(u && u.role === 'admin')) { H.redirect(res, '/demo/admin'); return true; }
    const f = await H.readForm(req);
    if (!auth().csrfOk(ctx, f)) { H.send(res, 403, 'This form expired. Go back, reload the page and try again.', 'text/plain'); return true; }
    const importers = require('./importers'), inventory = require('./inventory'), V = require('./views-inventory'), views = require('./views');
    const read = importers.readUpload(fs.readFileSync(SAMPLE_INVOICE), 'sample-supplier-invoice.pdf');
    const catalog = await require('./products').listAll();
    const draft = inventory.draftFromUpload(inventory.linesFrom(read, catalog), { fileName: 'sample-supplier-invoice.pdf' });
    H.send(res, 200, views.page(ctx, () => V.reviewPage({ draft, catalog })), undefined, { 'Cache-Control': 'no-store' });
    return true;
  }

  if (!demoAdmin) return false;
  // The demo admin is shared, so it only ever sees sample orders and this browser's own.
  if ((m = p.match(new RegExp(`^/(?:admin/)?orders?/${ORDER}(?:/|$)`)))) {
    const o = await store.getOrder(m[1]);
    if (o && !visible(o)) return reply(shell(ctx, 'Not found', '<h1 class="page-title">Order not found</h1>', 404));
  }
  if (p === '/account' && req.method === 'GET') { H.redirect(res, '/admin/orders'); return true; }
  const back = H.safeNext(String(req.headers.referer || '').replace(/^https?:\/\/[^/]+/, '')) || '/admin';
  if (p === '/admin/users' || p.startsWith('/admin/files/')) return reply(locked(ctx, '/admin'));
  if (req.method === 'POST' && (p.startsWith('/admin') || p.startsWith('/account'))) {
    if ((m = p.match(new RegExp(`^/admin/orders/${ORDER}(?:/payment|/refund)?$`)))) {
      const o = await store.getOrder(m[1]);
      if (o && o.meta && o.meta.demoVisitor && o.meta.demoVisitor === c.visitor) return false;
    }
    return reply(locked(ctx, back));
  }
  return false;
}
const auth = () => require('./auth');

// ---- sample data, added once when the demo starts ----
const PEOPLE = [
  ['Maya Chen', 'maya@example.com', '1201 3rd Ave', 'Seattle', 'WA', '98101', 'invoice', [['soy-candle-12-oz', 2], ['bud-vase-default', 1]], 'shipped', 980],
  ['Jordan Ellis', 'jordan@example.com', '500 Congress Ave', 'Austin', 'TX', '78701', 'card', [['wool-throw-default', 1]], 'shipped', 1425],
  ['Nora Diaz', 'nora@example.com', '220 S Spring St', 'Los Angeles', 'CA', '90012', 'card', [['stoneware-mug-sand', 2], ['canvas-tote-default', 1]], 'shipped', 760],
  ['Priya Nair', 'priya@example.com', '1600 Larimer St', 'Denver', 'CO', '80202', 'invoice', [['linen-tea-towels-default', 2], ['dot-grid-notebook-default', 1]], 'paid', null],
  ['Leo Martin', 'leo@example.com', '900 NW Lovejoy St', 'Portland', 'OR', '97209', 'invoice', [['stoneware-mug-slate', 4]], 'paid', null],
  ['Sam Okafor', 'sam@example.com', '75 Court St', 'Brooklyn', 'NY', '11201', 'card', [['soy-candle-8-oz', 2]], 'paid', null],
  ['Ana Ruiz', 'ana@example.com', '1102 A St', 'Tacoma', 'WA', '98402', 'invoice', [['soy-candle-8-oz', 3]], 'pending_payment', null],
];
async function seed() {
  if (!ON) return;
  const store = require('./store'), products = require('./products'), orders = require('./orders'), settings = require('./settings');
  const s = await settings.get();
  if (!s.demoSeeded) await settings.set({ demoSeeded: true, invoice: true, proofUploads: false, monthlyEmail: false, ...(packDemo && packDemo.SEED_SETTINGS) });
  if ((await store.allOrders()).some((o) => o.meta && o.meta.demoSeed)) return;
  let tax = null; try { tax = require('./tax'); } catch {}
  const { LABELS } = require('./payments/methods');
  for (const [i, [name, email, address1, city, state, zip, wanted, lines, status, postage]] of PEOPLE.entries()) {
    const pick = (packDemo && packDemo.SEED_METHODS[i]) || wanted; // an add-on can show off its own methods
    const method = LABELS[pick] ? pick : wanted;
    const items = [];
    for (const [id, qty] of lines) {
      const f = await products.findVariant(id);
      if (!f) continue;
      items.push({ id: f.variant.id, label: f.variant.label === 'Default' ? f.product.name : `${f.product.name}, ${f.variant.label}`, price: f.variant.price, qty, sku: f.variant.sku || '', cost: f.variant.cost ?? null });
    }
    if (!items.length) continue;
    const subtotal = items.reduce((a, x) => a + x.price * x.qty, 0), shipping = config.shippingFor(subtotal);
    const address = { address1, city, state, zip, country: 'US' };
    const tq = tax ? await tax.quote({ items, shipping, address }) : { tax: 0 };
    const now = new Date();
    let order = await store.createOrder({
      status: 'pending_payment', email, customer: { name, address1, address2: '', city, state, zip, country: 'US', phone: '' },
      items, subtotal, shipping, tax: tq.tax || 0, total: subtotal + shipping + (tq.tax || 0),
      meta: { demoSeed: true, payment: { method }, provider: method, tax: { source: tq.source, rate: tq.rate, label: tq.label || config.tax.label },
        placedAt: now.toISOString(), ...(status === 'pending_payment' ? { holdUntil: new Date(now.getTime() + 30 * 864e5).toISOString() } : {}) },
    });
    if (status === 'pending_payment') continue;
    order = (await orders.markPaid(order, { ref: `sample-${i + 1}`, amount: order.total, base: '', method })) || order;
    if (status === 'shipped') await store.updateOrder(order.id, { status: 'shipped', meta: { tracking: `1Z84Y2730392${String(4410 + i)}`, postage, shippedAt: now.toISOString() } });
  }
  console.log('demo: added sample orders and payment settings');
}

// Visitors' orders are deleted after two days so the demo doesn't fill up.
async function sweep() {
  const store = require('./store');
  const cutoff = Date.now() - VISITOR_ORDER_HOURS * 3600e3;
  let n = 0;
  for (const o of await store.allOrders()) if (o.meta && o.meta.demoVisitor && Date.parse(o.created_at) < cutoff) { await store.deleteOrder(o.id); n++; }
  if (n) console.log(`demo: removed ${n} visitor order(s) older than ${VISITOR_ORDER_HOURS} hours`);
}
function init({ jobs }) { if (ON) jobs.register('demo: remove old visitor orders', 3600e3, sweep); }

module.exports = { on: ON, wrap, early, handle, seed, sweep, init, card, visible, SAMPLE_RATES };
