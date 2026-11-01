// Accounts and sessions.
// Passwords: scrypt with a per-user salt. Sessions: random token in an
// HttpOnly cookie; only its SHA-256 hash is stored. Forms carry a CSRF
// token derived from the session.
const crypto = require('crypto');
const store = require('./store');

const COOKIE = 'sf_sid';
const SESSION_DAYS = 30;
const SECURE = process.env.NODE_ENV === 'production';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
function checkPassword(pw, stored) {
  const [alg, s, k] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const key = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(k, 'base64');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}

async function getUser(email) { return store.getDoc('users', normEmail(email)); }
async function saveUser(u) { return store.putDoc('users', u.email, u); }

async function createUser({ email, password, name, role = 'customer' }) {
  const e = normEmail(email);
  if (await getUser(e)) return null;
  const u = { id: 'U' + crypto.randomBytes(6).toString('hex'), email: e, name: String(name || '').trim().slice(0, 120), role, pw: hashPassword(password), createdAt: new Date().toISOString() };
  await saveUser(u);
  return u;
}

// Admin account from env on startup, so there's always a way in.
async function ensureAdmin() {
  const email = normEmail(process.env.ADMIN_EMAIL), pw = process.env.ADMIN_PASSWORD;
  if (!email || !pw) return;
  const u = await getUser(email);
  if (!u) { await createUser({ email, password: pw, name: 'Admin', role: 'admin' }); console.log('created admin account'); }
  else if (u.role !== 'admin') { u.role = 'admin'; await saveUser(u); }
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
const cookieAttrs = (maxAge) => `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE ? '; Secure' : ''}`;

async function startSession(res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  await store.putDoc('sessions', sha(token), { email: user.email, exp: Date.now() + SESSION_DAYS * 864e5 });
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieAttrs(SESSION_DAYS * 86400)}`);
}
async function endSession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) await store.delDoc('sessions', sha(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs(0)}`);
}

// Who is making this request? Returns { user, csrf } (user may be null).
async function load(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return { user: null, csrf: '' };
  const s = await store.getDoc('sessions', sha(token));
  if (!s || s.exp < Date.now()) return { user: null, csrf: '' };
  const user = await getUser(s.email);
  return { user, csrf: user ? sha('csrf:' + token).slice(0, 32) : '' };
}
const csrfOk = (ctx, form) => !!ctx.csrf && form.get('csrf') === ctx.csrf;

// Reject cross-site form posts outright.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

// Simple in-memory brake on password guessing.
const attempts = new Map();
function tooManyAttempts(key) {
  const now = Date.now(), win = 15 * 60e3;
  const a = (attempts.get(key) || []).filter((t) => now - t < win);
  attempts.set(key, a);
  return a.length >= 8;
}
const noteFailure = (key) => attempts.set(key, [...(attempts.get(key) || []), Date.now()]);

// Password reset: a one-hour, single-use link. Only the token's hash is stored.
async function createReset(email) {
  const user = await getUser(email); if (!user) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  await store.putDoc('resets', sha(token), { email: user.email, exp: Date.now() + 60 * 60e3 });
  return { user, token };
}
async function checkReset(token) {
  if (!token) return null;
  const r = await store.getDoc('resets', sha(String(token)));
  return r && r.exp > Date.now() ? r : null;
}
async function useReset(token, password) {
  const r = await checkReset(token); if (!r) return null;
  const user = await getUser(r.email); if (!user) return null;
  user.pw = hashPassword(password); await saveUser(user);
  await store.delDoc('resets', sha(String(token)));
  return user;
}

module.exports = { createReset, checkReset, useReset, createUser, getUser, saveUser, ensureAdmin, startSession, endSession, load, csrfOk, sameOrigin, tooManyAttempts, noteFailure, checkPassword, hashPassword, validEmail, normEmail };
