// The web server: storefront, checkout, accounts and core admin. Extra
// features live in src/routes/ and plug in below.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const demo = require('./demo-mode'); // does nothing unless DEMO=on; loads first so it can set up the demo's payment settings
const views = require('./views');
const policies = require('./policies');
const store = require('./store');
const products = require('./products');
const auth = require('./auth');
const email = require('./email');
const orders = require('./orders');
const settings = require('./settings');
const jobs = require('./jobs');
const H = require('./http');
const payments = require('./payments');
const methods = require('./payments/methods');
const holds = require('./holds');
let tax;
try { tax = require('./tax'); } catch (err) { if (err.code !== 'MODULE_NOT_FOUND') throw err; tax = { quote: async () => ({ tax: 0, rate: 0, source: 'none', label: 'Sales tax' }), record: async () => {}, describe: () => 'Off' }; }
if (tax.record) orders.onPaid((o) => tax.record(o));

const { send, redirect, json } = H;
const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain', '.pdf': 'application/pdf' };
const STATUSES = Object.keys(views.STATUS);
const ORDER_ID = /^\/order\/([A-Z0-9]{1,6}-[A-F0-9]{8})$/;
const ADMIN_ORDER = /^\/admin\/orders\/([A-Z0-9]{1,6}-[A-F0-9]{8})(\/payment|\/refund)?$/;

// Feature modules: every file in src/routes/ (see CLAUDE.md).
const ROUTES_DIR = path.join(__dirname, 'routes');
const ROUTES = (fs.existsSync(ROUTES_DIR) ? fs.readdirSync(ROUTES_DIR) : []).filter((f) => f.endsWith('.js')).sort().map((f) => {
  try { return Object.assign(require(path.join(ROUTES_DIR, f)), { _name: f }); } catch (err) { console.error(`feature ${f} failed to load:`, err.message); return null; }
}).filter(Boolean);
for (const r of ROUTES) { try { if (r.init) r.init({ jobs, views }); } catch (err) { console.error(`feature ${r._name} failed to start:`, err.message); } }

function serveStatic(res, rel) {
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', { 'Cache-Control': 'public, max-age=31536000, immutable' });
  return true;
}

// ── Orders ───────────────────────────────────────────────────────────────
// Rebuild the cart from live products so prices and stock can't be tampered with.
async function priceItems(raw) {
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw; } catch { return { error: 'bad' }; }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 50) return { error: 'bad' };
  const items = [];
  for (const it of parsed) {
    const found = await products.findVariant(String(it && it.id));
    const qty = Math.floor(Number(it && it.qty));
    if (!found || !found.product.active || !found.variant.active || !(qty >= 1 && qty <= 20)) return { error: 'bad' };
    const { stock } = found.variant;
    const label = found.variant.label === 'Default' ? found.product.name : `${found.product.name}, ${found.variant.label}`;
    if (products.tracked(found.variant) && qty > Number(stock)) return { error: 'stock', label, stock: Number(stock) };
    const cost = found.variant.cost === undefined || found.variant.cost === null ? null : Number(found.variant.cost);
    items.push({ id: found.variant.id, label, price: found.variant.price, qty, sku: found.variant.sku || '', cost });
  }
  return { items };
}

const addressOf = (form) => ({ address1: String(form.address1 || '').trim(), city: String(form.city || '').trim(), state: String(form.state || '').trim().toUpperCase(), zip: String(form.zip || '').trim(), country: String(form.country || config.shipping.countries[0]).toUpperCase() });

async function checkoutPage(ctx, args) {
  return views.render(ctx, 'checkout', { methods: await methods.available(), labels: methods.LABELS, hints: methods.HINTS, buttons: methods.BUTTONS, taxNote: tax.describe ? tax.describe() : '', ...args });
}

async function handleCheckout(req, res, ctx) {
  const form = Object.fromEntries(await H.readForm(req));
  const avail = await methods.available();
  const method = avail.includes(form.method) ? form.method : avail.length === 1 ? avail[0] : '';
  const again = async (error, status = 400) => send(res, status, await checkoutPage(ctx, { error, values: form }));
  const priced = await priceItems(form.items);
  const required = ['email', 'name', 'address1', 'city', 'state', 'zip'];
  const address = addressOf(form);
  const R = config.restricted;
  if (priced.error === 'stock') return again(priced.stock === 0 ? `${priced.label} just sold out. Remove it from your cart to continue.` : `Only ${priced.stock} of ${priced.label} left. Lower the quantity in your cart to continue.`);
  if (priced.error) return again('Your cart is empty or has an item we no longer sell. Go back to the shop and add it again.');
  if (required.some((k) => !String(form[k] || '').trim())) return again('Fill in every required field to place your order.');
  if (!auth.validEmail(String(form.email).trim().toLowerCase())) return again('Enter a valid email address.');
  if (!config.shipping.countries.includes(address.country)) return again(`Sorry, we only ship to ${config.shipping.countries.join(', ')}.`);
  if (R.enabled && R.blockedRegions.includes(address.state)) return again(`Sorry, we can't ship to ${address.state}.`);
  if (R.enabled && R.attestations.some((_, i) => form[`attest_${i}`] !== 'yes')) return again('Tick every box under “Before you order” to continue.');
  if (!method) return again('Choose how you’d like to pay.');
  const card = methods.cardProvider();
  if (method === 'card' && !card.ready()) { console.error(`checkout blocked: card provider "${card.name}" is missing its keys`); return again('Card payments are temporarily unavailable. Please choose another way to pay.', 503); }

  const { items } = priced;
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const shipping = config.shippingFor(subtotal);
  const tq = await tax.quote({ items, shipping, address });
  const s = await settings.get();
  const t = (k, n = 200) => String(form[k] || '').trim().slice(0, n);
  const now = new Date();
  const holdHours = method === 'card' ? 25 : Number(s.holdHours) || 0; // card checkouts expire on Stripe's side after 24h
  const order = await store.createOrder({
    status: 'pending_payment',
    user_id: ctx.user ? ctx.user.id : null,
    email: t('email').toLowerCase(),
    customer: { name: t('name'), address1: address.address1.slice(0, 200), address2: t('address2'), city: address.city.slice(0, 200), state: t('state'), zip: t('zip', 20), country: address.country, phone: t('phone', 40) },
    items, subtotal, shipping, tax: tq.tax || 0, total: subtotal + shipping + (tq.tax || 0),
    meta: {
      payment: { method, ...(form.network ? { network: t('network', 40) } : {}) },
      provider: method === 'card' ? card.name : method,
      tax: { source: tq.source, rate: tq.rate, label: tq.label || config.tax.label, ...(tq.taxable !== undefined ? { taxable: tq.taxable } : {}), ...(tq.calcId ? { calcId: tq.calcId } : {}) },
      ...(holdHours ? { holdUntil: new Date(now.getTime() + holdHours * 3600e3).toISOString() } : {}),
      placedAt: now.toISOString(), ip: H.ipOf(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      ...(R.enabled ? { attestation: { at: now.toISOString(), ip: H.ipOf(req), statements: R.attestations, minAge: R.minAge } } : {}),
    },
  });
  await products.reserve(items);
  console.log(`order ${order.id} placed: ${items.length} line(s), ${config.money(order.total)} by ${method}`);

  const base = H.baseUrl(req);
  if (method === 'card') {
    let result;
    try { result = await card.start(order, { baseUrl: base }); }
    catch (err) {
      console.error(`payment start failed for ${order.id}:`, err.message);
      await orders.markFailed(order, 'card checkout could not start');
      return again('We couldn’t start the payment. Nothing was charged. Please try again in a minute.', 502);
    }
    if (result.ref) await store.updateOrder(order.id, { meta: { paymentRef: result.ref } });
    if (result.redirect) return redirect(res, result.redirect);
  }
  const ins = await methods.instructions(order, base);
  email.orderReceived(order, base, { paid: false, instructions: methods.instructionsText(ins) });
  email.newOrderAlert(order, base, { paid: false });
  const next = methods.afterCheckout(order, form); // a method with its own payment page
  if (next) return redirect(res, next);
  redirect(res, `/order/${order.id}?k=${order.key}&placed=1`);
}

// Live total at checkout (shipping + tax for the address typed so far).
async function handleQuote(req, res) {
  let body; try { body = JSON.parse(await H.readText(req, 32 * 1024)); } catch { return json(res, 400, { error: 'bad' }); }
  const priced = await priceItems(body.items);
  if (priced.error) return json(res, 200, { error: priced.error });
  const subtotal = priced.items.reduce((s, i) => s + i.price * i.qty, 0);
  const shipping = config.shippingFor(subtotal);
  const address = addressOf(body);
  const ready = address.state && address.zip.length >= 3;
  const tq = ready ? await tax.quote({ items: priced.items, shipping, address }) : { tax: 0, source: 'none' };
  json(res, 200, { subtotal, shipping, tax: tq.tax || 0, total: subtotal + shipping + (tq.tax || 0), taxReady: !!ready, label: tq.label || config.tax.label });
}

async function handleWebhook(req, res, name) {
  const provider = payments.providers[name];
  if (!provider) return false;
  const raw = (await H.readBody(req, 1024 * 1024)).toString('utf8');
  let r;
  try { r = await provider.webhook(raw, req.headers); } catch (err) { console.error('webhook error', err.message); return send(res, 400, 'bad request', 'text/plain'); }
  if (r.error) { console.warn(`webhook ${name} rejected: ${r.error}`); return send(res, 400, r.error, 'text/plain'); }
  if (r.orderId) {
    const order = await store.getOrder(r.orderId);
    if (order && r.event === 'paid') await orders.markPaid(order, { ref: r.ref, amount: r.amount, base: H.baseUrl(req), method: 'card' });
    if (order && r.event === 'failed') await orders.markFailed(order, 'card payment not completed');
  }
  json(res, 200, { received: true });
}

// ── Images: product photos are public; payment proofs (p_ ids) are admin-only ──
const SNIFF = [['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff], ['image/png', (b) => b.slice(0, 4).toString('hex') === '89504e47'], ['image/webp', (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP']];
function imageFrom(dataUrl) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  const kind = SNIFF.find(([, test]) => test(buf));
  return kind ? { type: kind[0], buf } : null;
}
async function readImageJson(req) {
  try { return JSON.parse(await H.readText(req, 8 * 1024 * 1024)); } catch (err) { return { _error: err.status === 413 ? 'That photo is too large (8 MB max).' : 'Bad upload.', _status: err.status || 400 }; }
}

async function handleUpload(req, res, ctx) {
  const body = await readImageJson(req);
  if (body._error) return json(res, body._status, { error: body._error });
  if (!ctx.csrf || body.csrf !== ctx.csrf) return json(res, 403, { error: 'Your session expired. Reload the page.' });
  const im = imageFrom(body.data);
  if (!im) return json(res, 400, { error: 'Only JPG, PNG and WebP photos are supported.' });
  const id = crypto.randomBytes(9).toString('base64url');
  await store.putFile(id, im.type, im.buf);
  json(res, 200, { url: `/img/${id}` });
}

async function handleProof(req, res, ctx, order, base) {
  const s = await settings.get();
  if (!s.proofUploads || order.status !== 'pending_payment' || !methods.MANUAL.includes(order.meta.payment && order.meta.payment.method)) return json(res, 400, { error: 'Uploads aren’t open for this order.' });
  const proofs = order.meta.proofs || [];
  if (proofs.length >= 5) return json(res, 400, { error: 'You’ve already sent 5 screenshots. Reply to your order email if you need to send more.' });
  const body = await readImageJson(req);
  if (body._error) return json(res, body._status, { error: body._error });
  const im = imageFrom(body.data);
  if (!im) return json(res, 400, { error: 'Send a JPG, PNG or WebP screenshot.' });
  const id = `p_${crypto.randomBytes(9).toString('base64url')}`;
  await store.putFile(id, im.type, im.buf);
  await store.updateOrder(order.id, { meta: { proofs: [...proofs, { file: id, at: new Date().toISOString() }] } });
  email.proofAlert(order, base);
  json(res, 200, { ok: true });
}

// ── Accounts ─────────────────────────────────────────────────────────────
async function handleLogin(req, res, ctx) {
  const f = await H.readForm(req); const email_ = auth.normEmail(f.get('email')); const next = H.safeNext(f.get('next'));
  const key = `${H.ipOf(req)}|${email_}`;
  if (auth.tooManyAttempts(key)) return send(res, 429, views.render(ctx, 'login', { error: 'Too many attempts. Wait 15 minutes and try again.', values: { email: email_ }, next }));
  const user = await auth.getUser(email_);
  if (!user || !auth.checkPassword(String(f.get('password') || ''), user.pw)) {
    auth.noteFailure(key);
    return send(res, 400, views.render(ctx, 'login', { error: "That email and password don't match an account.", values: { email: email_ }, next }));
  }
  await auth.startSession(res, user);
  redirect(res, next || (user.role === 'admin' ? '/admin' : '/account'));
}

async function handleRegister(req, res, ctx) {
  const f = await H.readForm(req); const values = Object.fromEntries(f); const next = H.safeNext(f.get('next'));
  const email_ = auth.normEmail(f.get('email')), pw = String(f.get('password') || '');
  const errors = [];
  if (!String(f.get('name') || '').trim()) errors.push('Enter your name.');
  if (!auth.validEmail(email_)) errors.push('Enter a valid email address.');
  if (pw.length < 10) errors.push('Use a password with at least 10 characters.');
  if (config.restricted.enabled && f.get('agree') !== 'yes') errors.push(`Confirm you are ${config.restricted.minAge} or older and agree to the terms.`);
  if (auth.tooManyAttempts(`reg|${H.ipOf(req)}`)) errors.push('Too many sign-ups from this connection. Try again later.');
  if (errors.length) return send(res, 400, views.render(ctx, 'register', { errors, values, next }));
  const user = await auth.createUser({ email: email_, password: pw, name: f.get('name') });
  auth.noteFailure(`reg|${H.ipOf(req)}`);
  if (!user) return send(res, 400, views.render(ctx, 'register', { errors: ['An account with that email already exists. Sign in instead.'], values, next }));
  await auth.startSession(res, user);
  redirect(res, next || '/account');
}

async function handleForgot(req, res, ctx) {
  const f = await H.readForm(req); const key = `forgot|${H.ipOf(req)}`;
  if (!auth.tooManyAttempts(key) && email.enabled()) {
    auth.noteFailure(key);
    const r = await auth.createReset(f.get('email'));
    if (r) await email.passwordReset(r.user, `${H.baseUrl(req)}/reset?t=${r.token}`);
  }
  send(res, 200, views.render(ctx, 'forgot', { sent: true }));
}

async function handleReset(req, res, ctx) {
  const f = await H.readForm(req); const token = String(f.get('t') || ''), pw = String(f.get('password') || '');
  if (!(await auth.checkReset(token))) return send(res, 400, views.render(ctx, 'reset', { valid: false }));
  if (pw.length < 10) return send(res, 400, views.render(ctx, 'reset', { token, errors: ['Use a password with at least 10 characters.'] }));
  const user = await auth.useReset(token, pw);
  await auth.startSession(res, user);
  redirect(res, '/account');
}

// ── Admin: orders and settings ───────────────────────────────────────────
const cents = (v) => { const s = String(v || '').replace(/[$,\s]/g, ''); if (s === '') return null; const n = Math.round(Number(s) * 100); return Number.isFinite(n) ? n : NaN; };

async function handleAdminOrder(req, res, ctx, f, id, action) {
  const order = await store.getOrder(id); if (!order) return send(res, 404, views.render(ctx, 'notFound'), undefined);
  const back = () => redirect(res, `/admin/orders#${order.id}`);
  const base = H.baseUrl(req);
  if (action === '/payment') {
    const amount = cents(f.get('amount'));
    if (!(amount > 0)) return back();
    await orders.recordPayment(order, { amount, method: String(f.get('method') || 'other').slice(0, 20), ref: String(f.get('ref') || '').trim().slice(0, 120), note: 'recorded by admin', base });
    return back();
  }
  if (action === '/refund') {
    const amount = cents(f.get('amount'));
    if (!(amount > 0)) return back();
    const refunds = [...(order.meta.refunds || []), { amount, at: new Date().toISOString(), note: String(f.get('note') || '').trim().slice(0, 200) }];
    const refunded = refunds.reduce((s, r) => s + r.amount, 0);
    await store.updateOrder(order.id, { ...(refunded >= order.total ? { status: 'refunded' } : {}), meta: { refunds } });
    return back();
  }
  const status = f.get('status'); const tracking = String(f.get('tracking') || '').trim().slice(0, 300);
  const postage = cents(f.get('postage'));
  if (!STATUSES.includes(status)) return back();
  if (status === 'cancelled' && order.status === 'pending_payment') await products.release(order.items);
  if (order.status === 'cancelled' && status !== 'cancelled') await products.reserve(order.items);
  const meta = { tracking, ...(postage === null ? { postage: null } : Number.isFinite(postage) && postage >= 0 ? { postage } : {}) };
  if (status === 'shipped' && order.status !== 'shipped') meta.shippedAt = new Date().toISOString();
  if (status === 'paid' && order.status === 'pending_payment') {
    // Paid by hand (invoice, cash…): record the outstanding balance as a payment, then mark paid.
    const due = orders.balance(order);
    const after = due > 0 ? await orders.recordPayment(order, { amount: due, method: (order.meta.payment && order.meta.payment.method) || 'other', note: 'marked paid by admin', base }) : await orders.markPaid(order, { base, ref: 'marked paid by admin' });
    await store.updateOrder(order.id, { meta });
    if (after.status !== 'paid') await orders.markPaid(after, { base, ref: 'marked paid by admin' });
    return back();
  }
  const updated = await store.updateOrder(order.id, { status, meta });
  if (status === 'shipped' && order.status !== 'shipped') email.shipped(updated, base);
  return back();
}

async function handleSettings(req, res, ctx, f) {
  const patch = {};
  for (const k of ['invoice', 'monthlyEmail']) patch[k] = f.get(k) === 'yes';
  if (methods.hasManualExtras()) patch.proofUploads = f.get('proofUploads') === 'yes';
  for (const [k, max] of [['holdHours', 24 * 30], ['reminderHours', 24 * 7], ['lowStockAt', 1000]]) { const n = Math.floor(Number(f.get(k))); patch[k] = Number.isFinite(n) && n >= 0 ? Math.min(n, max) : settings.DEFAULTS[k]; }
  const extra = methods.settingsSave(f); // settings for payment methods added in src/payments/extra/
  Object.assign(patch, extra.patch);
  if (extra.errors.length) return send(res, 400, await settingsPage(ctx, { errors: extra.errors, values: patch }));
  await settings.set(patch);
  send(res, 200, await settingsPage(ctx, { msg: 'Settings saved.' }));
}
async function settingsPage(ctx, args = {}) {
  const card = methods.cardProvider();
  return views.render(ctx, 'adminSettings', {
    values: args.values || (await settings.get()), manualExtras: methods.hasManualExtras(), extraSettings: methods.settingsHtml, status: [
      ['Card payments', card.ready() ? `${card.name === 'stripe' ? 'Stripe' : card.name === 'demo' ? 'Simulated (demo)' : 'Custom processor'} connected` : 'Not set up (add STRIPE_SECRET_KEY in Railway)'],
      ...methods.statusLines(),
      ['Emails', email.enabled() ? 'On' : 'Off (add RESEND_API_KEY and EMAIL_FROM)'],
      ['Sales tax', tax.describe ? tax.describe() : 'Off'],
    ], ...args,
  });
}

// ── Router ───────────────────────────────────────────────────────────────
const server = http.createServer(demo.wrap(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.replace(/\/+$/, '') || '/';
    let m;
    if (p.startsWith('/static/') && serveStatic(res, p.slice(8))) return;
    if ((m = p.match(/^\/img\/([\w-]{6,40})$/))) {
      const f = !m[1].startsWith('p_') && (await store.getFile(m[1]));
      return f && /^image\//.test(f.type) ? send(res, 200, f.data, f.type, { 'Cache-Control': 'public, max-age=31536000, immutable' }) : send(res, 404, 'Not found', 'text/plain');
    }
    if (p === '/healthz') return send(res, 200, 'ok', 'text/plain');
    if (await demo.early(req, res, p)) return;
    if (p === '/robots.txt') return send(res, 200, `User-agent: *\nDisallow: /admin\nDisallow: /account\nDisallow: /checkout\nDisallow: /order\nDisallow: /cart\n${config.publicUrl ? `Sitemap: ${config.publicUrl}/sitemap.xml\n` : ''}`, 'text/plain');
    if ((m = p.match(/^\/webhooks\/(\w+)$/)) && req.method === 'POST' && payments.providers[m[1]]) return await handleWebhook(req, res, m[1]);

    const ctx = await auth.load(req);
    const page = (name, args, status = 200, extra) => send(res, status, views.render(ctx, name, args), undefined, extra);
    const isAdmin = !!(ctx.user && ctx.user.role === 'admin');
    const nostore = { 'Cache-Control': 'no-store' };
    const h = { p, url, isAdmin, base: H.baseUrl(req) };

    if (config.comingSoon && !isAdmin && !/^\/(login|admin)(\/|$)/.test(p) && !p.startsWith('/webhooks/')) {
      return req.method === 'GET' || req.method === 'HEAD' ? page('comingSoon') : redirect(res, '/');
    }

    // Cross-site form posts are refused for everything below, feature modules included.
    if (req.method === 'POST' && !auth.sameOrigin(req)) return send(res, 403, 'Forbidden', 'text/plain');
    if (await demo.handle(req, res, ctx, h)) return;
    // Feature modules get the first look at every request.
    for (const r of ROUTES) { if (r.handle && (await r.handle(req, res, ctx, h))) return; }

    if (req.method === 'POST') {
      if (!auth.sameOrigin(req)) return send(res, 403, 'Forbidden', 'text/plain');
      if (p === '/checkout') return await handleCheckout(req, res, ctx);
      if (p === '/checkout/quote') return await handleQuote(req, res);
      if (p === '/login') return await handleLogin(req, res, ctx);
      if (p === '/register') return await handleRegister(req, res, ctx);
      if (p === '/forgot') return await handleForgot(req, res, ctx);
      if (p === '/reset') return await handleReset(req, res, ctx);
      if ((m = p.match(/^\/order\/([A-Z0-9]{1,6}-[A-F0-9]{8})\/proof$/))) {
        const order = await store.getOrder(m[1]);
        if (!order || !(url.searchParams.get('k') === order.key || isAdmin || (ctx.user && order.user_id === ctx.user.id))) return json(res, 404, { error: 'Not found' });
        return await handleProof(req, res, ctx, order, h.base);
      }
      if (!ctx.user) return redirect(res, '/login');
      if (p === '/admin/upload') return isAdmin ? await handleUpload(req, res, ctx) : json(res, 403, { error: 'Admins only.' });
      const f = await H.readForm(req);
      if (!auth.csrfOk(ctx, f)) return send(res, 403, 'This form expired. Go back, reload the page and try again.', 'text/plain');
      if (p === '/logout') { await auth.endSession(req, res); return redirect(res, '/'); }
      if (p === '/account/password') {
        const list = await store.listOrdersByUser(ctx.user.id); const pw = String(f.get('password') || '');
        if (!auth.checkPassword(String(f.get('current') || ''), ctx.user.pw)) return page('account', { orders: list, errors: ['Your current password is incorrect.'] }, 400);
        if (pw.length < 10) return page('account', { orders: list, errors: ['Use a new password with at least 10 characters.'] }, 400);
        ctx.user.pw = auth.hashPassword(pw); await auth.saveUser(ctx.user);
        return page('account', { orders: list, msg: 'Password updated.' });
      }
      if (!isAdmin) return send(res, 403, 'Admins only.', 'text/plain');
      if ((m = p.match(/^\/admin\/products\/([a-z0-9-]+)\/delete$/))) {
        const prod = await products.get(m[1]); if (prod) await products.remove(prod.slug);
        return page('adminProducts', { products: await products.listAll(), msg: prod ? `${prod.name} deleted.` : '' });
      }
      if (p === '/admin/products/new' || (m = p.match(/^\/admin\/products\/([a-z0-9-]+)$/))) {
        const existing = m ? await products.get(m[1]) : null;
        if (m && !existing) return page('notFound', {}, 404);
        const { product, errors } = products.fromForm(f, existing);
        if (!errors.length) { const r = await products.save(product, { isNew: !existing }); errors.push(...r.errors); }
        if (errors.length) return page('adminProductForm', { p: product, isNew: !existing, errors }, 400);
        return page('adminProducts', { products: await products.listAll(), msg: `${product.name} ${existing ? 'saved' : 'added'}.` });
      }
      if ((m = p.match(ADMIN_ORDER))) return await handleAdminOrder(req, res, ctx, f, m[1], m[2] || '');
      if (p === '/admin/settings') return await handleSettings(req, res, ctx, f);
      if (p === '/admin/users/role') {
        const u = await auth.getUser(f.get('email')); const role = f.get('role');
        if (u && u.email !== ctx.user.email && (role === 'admin' || role === 'customer')) { u.role = role; await auth.saveUser(u); }
        return redirect(res, '/admin/users');
      }
      return send(res, 404, 'Not found', 'text/plain');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');

    if (p === '/') return page('home', { products: await products.listActive() });
    if (p === '/shop') return page('shop', { products: await products.listActive(), categories: await products.categories(), cat: url.searchParams.get('c') || '' });
    if (p === '/about') return page('about');
    if (p === '/cart') return page('cart');
    if (p === '/checkout') return send(res, 200, await checkoutPage(ctx, { canceled: url.searchParams.get('canceled') || '', values: ctx.user ? { name: ctx.user.name, email: ctx.user.email } : {} }));
    if (p === '/login') return ctx.user ? redirect(res, '/account') : page('login', { next: H.safeNext(url.searchParams.get('next')) });
    if (p === '/register') return ctx.user ? redirect(res, '/account') : page('register', { next: H.safeNext(url.searchParams.get('next')) });
    if (p === '/forgot') return page('forgot', { emailOn: email.enabled() });
    if (p === '/reset') { const t = url.searchParams.get('t') || ''; return page('reset', { token: t, valid: !!(await auth.checkReset(t)) }, 200, nostore); }
    if (p === '/account') return ctx.user ? page('account', { orders: await store.listOrdersByUser(ctx.user.id) }, 200, nostore) : redirect(res, '/login?next=/account');
    if (p === '/sitemap.xml') {
      const base = H.baseUrl(req); const list = await products.listActive();
      const urls = ['/', '/shop', '/about', ...Object.keys(policies).map((k) => `/policies/${k}`), ...list.map((x) => `/product/${x.slug}`)];
      return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${views.esc(base + u)}</loc></url>`).join('')}</urlset>`, 'application/xml');
    }

    if ((m = p.match(/^\/product\/([a-z0-9-]+)$/))) {
      const prod = await products.get(m[1]);
      if (!prod || !(products.isLive(prod) || (isAdmin && prod.variants.length))) return page('notFound', {}, 404);
      const live = (await products.listActive()).filter((x) => x.slug !== prod.slug);
      const related = [...live.filter((x) => prod.category && x.category === prod.category), ...live.filter((x) => !prod.category || x.category !== prod.category)].slice(0, 4);
      return page('product', { p: prod, related });
    }
    if ((m = p.match(/^\/policies\/([a-z-]+)$/)) && policies[m[1]]) return page('policy', policies[m[1]]);
    if ((m = p.match(ORDER_ID))) {
      let order = await store.getOrder(m[1]);
      const allowed = order && (url.searchParams.get('k') === order.key || isAdmin || (ctx.user && order.user_id === ctx.user.id));
      if (!allowed) return page('notFound', {}, 404);
      if (order.status === 'pending_payment' && order.meta.payment && order.meta.payment.method === 'card') {
        const provider = methods.cardProvider();
        try { const r = await provider.confirm(order, url.searchParams); if (r && r.paid) order = await orders.markPaid(order, { ref: r.ref, amount: r.amount, base: h.base, method: 'card' }); }
        catch (err) { console.error(`confirm failed for ${order.id}:`, err.message); }
      }
      const s = await settings.get();
      const pending = order.status === 'pending_payment';
      const method = (order.meta.payment && order.meta.payment.method) || order.meta.provider || 'invoice';
      const ins = pending ? await methods.instructions(order, h.base) : null;
      return page('order', {
        order, justPlaced: url.searchParams.has('placed'), instructionsHtml: ins ? methods.instructionsHtml(ins) : '',
        paid: orders.paidSoFar(order), balance: orders.balance(order),
        canProof: pending && s.proofUploads && methods.MANUAL.includes(method) && method !== 'invoice' && (order.meta.proofs || []).length < 5,
        proofs: (order.meta.proofs || []).length, methodLabel: methods.LABELS[method] || method, ownPage: methods.OWN_PAGE.includes(method),
      }, 200, nostore);
    }

    if (p === '/admin' || p.startsWith('/admin/')) {
      if (!ctx.user) return redirect(res, `/login?next=${encodeURIComponent(p)}`);
      if (!isAdmin) return send(res, 403, 'Admins only.', 'text/plain');
      if (p === '/admin' || p === '/admin/products') return page('adminProducts', { products: await products.listAll() }, 200, nostore);
      if (p === '/admin/products/new') return page('adminProductForm', { isNew: true }, 200, nostore);
      if ((m = p.match(/^\/admin\/products\/([a-z0-9-]+)$/))) {
        const prod = await products.get(m[1]);
        return prod ? page('adminProductForm', { p: prod, isNew: false }, 200, nostore) : page('notFound', {}, 404);
      }
      if (p === '/admin/orders') return page('adminOrders', { orders: await store.listOrders(), filter: url.searchParams.get('s') || '', labels: methods.LABELS }, 200, nostore);
      if (p === '/admin/settings') return send(res, 200, await settingsPage(ctx), undefined, nostore);
      if ((m = p.match(/^\/admin\/files\/(p_[\w-]{6,40})$/))) {
        const f = await store.getFile(m[1]);
        return f ? send(res, 200, f.data, f.type, { 'Cache-Control': 'private, no-store' }) : page('notFound', {}, 404);
      }
      if (p === '/admin/users') return page('adminUsers', { users: (await store.listDocs('users')).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) }, 200, nostore);
    }
    page('notFound', {}, 404);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, err.status || 500, err.status === 413 ? 'That was too large.' : 'Something went wrong on our end. Try again in a minute.', 'text/plain');
  }
}));

holds.init({ jobs });
demo.init({ jobs });

(async () => {
  await store.init();
  if (config.seedDemo && (await products.listAll()).length === 0) { await products.seed(require('./demo').PRODUCTS); console.log('added demo products (set SEED_DEMO=false to skip)'); }
  await auth.ensureAdmin();
  await demo.seed();
  server.listen(config.port, '0.0.0.0', async () => {
    const avail = await methods.available();
    console.log(`${config.name} running on port ${config.port}`);
    console.log(`  storage: ${store.kind} · payments: ${avail.join(', ')} · emails: ${email.enabled() ? 'on' : 'off'} · tax: ${tax.describe ? tax.describe() : 'off'}${config.comingSoon ? ' · COMING SOON mode' : ''}${demo.on ? ' · DEMO mode (simulated payments, no emails)' : ''}`);
    if (ROUTES.length) console.log(`  features: ${ROUTES.map((r) => r._name.replace(/\.js$/, '')).join(', ')}`);
    if (!process.env.ADMIN_EMAIL) console.log('  no ADMIN_EMAIL/ADMIN_PASSWORD set, so there is no admin account yet');
    jobs.start();
  });
})().catch((err) => { console.error('startup failed:', err.message); process.exit(1); });

module.exports = { server, priceItems };
