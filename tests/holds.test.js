// Unpaid-order holds: reminders while waiting, cancel + restock when time runs out.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'store-holds-'));
process.env.DATABASE_URL = ''; process.env.PUBLIC_URL = 'https://shop.example';

const store = require('../src/store');
const products = require('../src/products');
const settings = require('../src/settings');
const holds = require('../src/holds');
const { PRODUCTS } = require('../src/demo');

test('reminds, then cancels and restocks when the hold runs out', async () => {
  await products.seed(PRODUCTS);
  await settings.set({ reminderHours: 24 });
  const items = [{ id: 'bud-vase-default', label: 'Ceramic bud vase', price: 3600, qty: 2, sku: '', cost: null }];
  const t0 = Date.parse('2026-11-02T12:00:00Z');
  await products.reserve(items);
  assert.equal((await products.get('bud-vase')).variants[0].stock, 7);
  const o = await store.createOrder({ status: 'pending_payment', email: 'a@b.co', customer: { name: 'A' }, items, subtotal: 7200, shipping: 0, tax: 0, total: 7200,
    meta: { payment: { method: 'invoice' }, placedAt: new Date(t0).toISOString(), holdUntil: new Date(t0 + 72 * 3600e3).toISOString() } });

  assert.deepEqual(await holds.tick(t0 + 3600e3), { cancelled: 0, reminded: 0 }, 'too early for a reminder');
  assert.deepEqual(await holds.tick(t0 + 25 * 3600e3), { cancelled: 0, reminded: 1 });
  assert.equal((await store.getOrder(o.id)).meta.reminders, 1);
  assert.deepEqual(await holds.tick(t0 + 26 * 3600e3), { cancelled: 0, reminded: 0 }, 'not again until 24h later');
  assert.deepEqual(await holds.tick(t0 + 73 * 3600e3), { cancelled: 1, reminded: 0 });
  const after = await store.getOrder(o.id);
  assert.equal(after.status, 'cancelled'); assert.match(after.meta.cancelReason, /72 hours/);
  assert.equal((await products.get('bud-vase')).variants[0].stock, 9, 'stock returned');
  assert.deepEqual(await holds.tick(t0 + 80 * 3600e3), { cancelled: 0, reminded: 0 }, 'nothing left to do');
});
