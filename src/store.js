// Storage. Postgres when DATABASE_URL is set (Railway), otherwise JSON files
// in .data/ so the store runs on your computer with zero setup.
//
//  - orders: their own table
//  - docs:   small JSON documents by collection + id (users, sessions, products, resets)
//  - files:  uploaded images
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const newOrderId = () => `${config.orderPrefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const newKey = () => crypto.randomBytes(16).toString('base64url');
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

function fileStore() {
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', '.data');
  const filesDir = path.join(dir, 'files');
  fs.mkdirSync(filesDir, { recursive: true });
  const ordersFile = path.join(dir, 'orders.json'), docsFile = path.join(dir, 'docs.json');
  const read = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
  const write = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 2)); fs.renameSync(f + '.tmp', f); };
  const readOrders = () => read(ordersFile, []);
  const readDocs = () => read(docsFile, {});
  return {
    kind: 'files in .data/',
    async init() {},
    async createOrder(order) {
      const all = readOrders();
      const row = { id: newOrderId(), key: newKey(), created_at: new Date().toISOString(), user_id: null, tax: 0, meta: {}, ...order };
      all.push(row); write(ordersFile, all); return row;
    },
    async getOrder(id) { return readOrders().find((o) => o.id === id) || null; },
    async ordersWithStatus(status) { return readOrders().filter((o) => o.status === status); },
    async listOrders() { return readOrders().reverse().slice(0, 500); },
    async allOrders() { return readOrders().reverse(); },
    async listOrdersByUser(userId) { return readOrders().filter((o) => o.user_id === userId).reverse(); },
    async deleteOrder(id) { write(ordersFile, readOrders().filter((o) => o.id !== id)); },
    async updateOrder(id, patch) {
      const all = readOrders(); const o = all.find((x) => x.id === id); if (!o) return null;
      Object.assign(o, patch, patch.meta ? { meta: { ...o.meta, ...patch.meta } } : {}); write(ordersFile, all); return o;
    },
    // Change status only if the order is currently in one of `from`. Returns null otherwise,
    // so a payment confirmed twice (webhook + return page) is only processed once.
    async transition(id, from, status, meta = {}) {
      const all = readOrders(); const o = all.find((x) => x.id === id);
      if (!o || !from.includes(o.status)) return null;
      o.status = status; o.meta = { ...o.meta, ...meta }; write(ordersFile, all); return o;
    },
    async getDoc(col, id) { const d = readDocs(); return (d[col] && d[col][id]) || null; },
    async putDoc(col, id, data) { const d = readDocs(); (d[col] = d[col] || {})[id] = data; write(docsFile, d); return data; },
    async delDoc(col, id) { const d = readDocs(); if (d[col]) delete d[col][id]; write(docsFile, d); },
    async listDocs(col) { const d = readDocs(); return Object.values(d[col] || {}); },
    async putFile(id, type, buf) { fs.writeFileSync(path.join(filesDir, id), buf); fs.writeFileSync(path.join(filesDir, id + '.type'), type); },
    async delFile(id) { if (!/^[\w-]+$/.test(id)) return; for (const f of [id, id + '.type']) { try { fs.unlinkSync(path.join(filesDir, f)); } catch {} } },
    async getFile(id) {
      const f = path.join(filesDir, id);
      if (!/^[\w-]+$/.test(id) || !fs.existsSync(f)) return null;
      return { type: fs.readFileSync(f + '.type', 'utf8'), data: fs.readFileSync(f) };
    },
  };
}

function pgStore(url) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, ssl: /railway\.internal|localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  return {
    kind: 'Postgres',
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id TEXT PRIMARY KEY, key TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), status TEXT NOT NULL,
          email TEXT NOT NULL, customer JSONB NOT NULL, items JSONB NOT NULL,
          subtotal INTEGER NOT NULL, shipping INTEGER NOT NULL DEFAULT 0, tax INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL,
          user_id TEXT, meta JSONB NOT NULL DEFAULT '{}'::jsonb)`);
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax INTEGER NOT NULL DEFAULT 0');
      await pool.query('CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status)');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS docs (
          col TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (col, id))`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS files (
          id TEXT PRIMARY KEY, type TEXT NOT NULL, data BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    },
    async createOrder(o) {
      const { rows } = await pool.query(
        `INSERT INTO orders (id, key, status, email, customer, items, subtotal, shipping, tax, total, user_id, meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [newOrderId(), newKey(), o.status, o.email, o.customer, JSON.stringify(o.items), o.subtotal, o.shipping || 0, o.tax || 0, o.total, o.user_id || null, o.meta || {}]);
      return rows[0];
    },
    async getOrder(id) { const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]); return rows[0] || null; },
    async listOrders() { const { rows } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500'); return rows; },
    async allOrders() { const { rows } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC'); return rows; },
    async ordersWithStatus(status) { const { rows } = await pool.query('SELECT * FROM orders WHERE status = $1 ORDER BY created_at', [status]); return rows; },
    async listOrdersByUser(userId) { const { rows } = await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200', [userId]); return rows; },
    async deleteOrder(id) { await pool.query('DELETE FROM orders WHERE id = $1', [id]); },
    async updateOrder(id, patch) {
      const { rows } = await pool.query(
        `UPDATE orders SET status = COALESCE($2, status), meta = meta || $3::jsonb WHERE id = $1 RETURNING *`,
        [id, patch.status || null, JSON.stringify(patch.meta || {})]);
      return rows[0] || null;
    },
    async transition(id, from, status, meta = {}) {
      const { rows } = await pool.query('UPDATE orders SET status = $2, meta = meta || $3::jsonb WHERE id = $1 AND status = ANY($4::text[]) RETURNING *', [id, status, JSON.stringify(meta), from]);
      return rows[0] || null;
    },
    async getDoc(col, id) { const { rows } = await pool.query('SELECT data FROM docs WHERE col = $1 AND id = $2', [col, id]); return rows[0] ? parse(rows[0].data) : null; },
    async putDoc(col, id, data) {
      await pool.query(`INSERT INTO docs (col, id, data, updated_at) VALUES ($1,$2,$3,now())
        ON CONFLICT (col, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [col, id, JSON.stringify(data)]);
      return data;
    },
    async delDoc(col, id) { await pool.query('DELETE FROM docs WHERE col = $1 AND id = $2', [col, id]); },
    async listDocs(col) { const { rows } = await pool.query('SELECT data FROM docs WHERE col = $1 ORDER BY id', [col]); return rows.map((r) => parse(r.data)); },
    async putFile(id, type, buf) { await pool.query('INSERT INTO files (id, type, data) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING', [id, type, buf]); },
    async delFile(id) { await pool.query('DELETE FROM files WHERE id = $1', [id]); },
    async getFile(id) { const { rows } = await pool.query('SELECT type, data FROM files WHERE id = $1', [id]); return rows[0] || null; },
  };
}

module.exports = process.env.DATABASE_URL ? pgStore(process.env.DATABASE_URL) : fileStore();
