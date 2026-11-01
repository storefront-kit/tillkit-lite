// Products: read/write in the store, a small in-memory cache, stock
// reservation, and validation of the admin form.
const store = require('./store');

let cache = null;
async function all() {
  if (!cache) cache = (await store.listDocs('products')).sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name));
  return cache;
}
const invalidate = () => { cache = null; };

const isLive = (p) => p.active && p.variants.some((v) => v.active);
async function listActive() { return (await all()).filter(isLive); }
async function listAll() { return all(); }
async function get(slug) { return (await all()).find((p) => p.slug === slug) || null; }
async function categories() { return [...new Set((await listActive()).map((p) => p.category).filter(Boolean))].sort(); }

async function findVariant(variantId) {
  for (const p of await all()) {
    const v = p.variants.find((x) => x.id === variantId);
    if (v) return { product: p, variant: v };
  }
  return null;
}

const tracked = (v) => v.stock !== null && v.stock !== undefined && v.stock !== '';

// Take stock when an order is placed (only for options with tracked stock).
// Pass sign = +1 to put it back (cancelled or expired orders).
async function adjustStock(items, sign = -1) {
  const touched = new Map();
  for (const it of items) {
    const f = await findVariant(it.id); if (!f || !tracked(f.variant)) continue;
    const p = touched.get(f.product.slug) || JSON.parse(JSON.stringify(f.product));
    const v = p.variants.find((x) => x.id === it.id);
    v.stock = Math.max(0, Number(v.stock) + sign * it.qty);
    touched.set(p.slug, p);
  }
  for (const p of touched.values()) await store.putDoc('products', p.slug, p);
  if (touched.size) invalidate();
}
const reserve = (items) => adjustStock(items, -1);
const release = (items) => adjustStock(items, +1);

async function remove(slug) { await store.delDoc('products', slug); invalidate(); }

async function seed(list) {
  for (const p of list) await store.putDoc('products', p.slug, { ...p, createdAt: new Date().toISOString() });
  invalidate();
}

const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60);
const clean = (s, n = 300) => String(s || '').trim().slice(0, n);
const okImage = (u) => /^\/img\/[\w-]+$/.test(u) || /^\/static\/[\w\-./]+$/.test(u) || /^https:\/\/[^\s"'<>]+$/i.test(u);
const cents = (raw) => { const s = String(raw || '').replace(/[$,\s]/g, ''); return s === '' ? null : Math.round(Number(s) * 100); };

// Turn the admin form into a product, or return a list of problems.
function fromForm(form, existing) {
  const errors = [];
  const one = (k, n) => clean(form.get(k), n);
  const many = (k) => form.getAll(k).map((x) => String(x));
  const name = one('name', 120);
  if (!name) errors.push('Give the product a name.');
  let slug = existing ? existing.slug : (slugify(one('slug')) || slugify(name));
  if (!existing && slug === 'new') slug = 'new-product';
  if (!slug) errors.push('The web address can only use letters, numbers and dashes.');

  const images = many('image').map((u) => clean(u, 500)).filter(Boolean);
  const bad = images.filter((u) => !okImage(u));
  if (bad.length) errors.push('Image links must be uploads or start with https://');

  const ids = many('var_id'), labels = many('var_label'), prices = many('var_price'), compares = many('var_compare'),
    skus = many('var_sku'), stocks = many('var_stock'), costs = many('var_cost'), actives = many('var_active');
  const variants = []; const usedIds = new Set();
  labels.forEach((labelRaw, i) => {
    const label = clean(labelRaw, 80); const price = cents(prices[i]);
    if (!label && price === null) return; // empty row
    const name_ = label || 'Default';
    if (!(price > 0)) { errors.push(`Enter a price for "${name_}", like 24.00.`); return; }
    const compareAt = cents(compares[i]);
    if (compareAt !== null && !(compareAt > price)) { errors.push(`The "was" price for "${name_}" must be higher than its price, or blank.`); return; }
    const stockRaw = String(stocks[i] || '').trim();
    const stock = stockRaw === '' ? null : Math.floor(Number(stockRaw));
    if (stockRaw !== '' && !(stock >= 0)) { errors.push(`Stock for "${name_}" must be a whole number, or blank to not track it.`); return; }
    let id = clean(ids[i], 80) || `${slug}-${slugify(name_)}`;
    while (usedIds.has(id)) id += '-x';
    usedIds.add(id);
    const cost = cents(costs[i]);
    if (cost !== null && !(cost >= 0)) { errors.push(`Cost for "${name_}" must be a number, or blank.`); return; }
    variants.push({ id, label: name_, price, compareAt, sku: clean(skus[i], 60), stock, cost, active: actives[i] !== 'no' });
  });
  if (!variants.length) errors.push('Add at least one option with a price. If the product has no sizes or colors, call the option "Default".');

  const product = {
    ...(existing || { createdAt: new Date().toISOString() }),
    slug, name, images, variants,
    category: one('category', 60),
    summary: one('summary', 200),
    description: clean(form.get('description'), 8000),
    optionName: one('optionName', 40) || 'Option',
    featured: form.get('featured') === 'yes',
    active: form.get('active') !== 'no',
    sort: Number(form.get('sort')) || 0,
    updatedAt: new Date().toISOString(),
  };
  return { product, errors };
}

async function save(product, { isNew }) {
  if (isNew && (await store.getDoc('products', product.slug))) return { errors: [`Another product already uses the web address "${product.slug}". Pick a different one.`] };
  await store.putDoc('products', product.slug, product); invalidate();
  return { errors: [] };
}

module.exports = { listActive, listAll, get, categories, findVariant, reserve, release, remove, seed, fromForm, save, tracked, isLive };
