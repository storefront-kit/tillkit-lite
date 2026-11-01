// Small HTTP helpers shared by the server and the feature modules in src/routes/.
const config = require('./config');

const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY' };

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  const cache = type.startsWith('text/html') ? { 'Cache-Control': 'no-cache' } : {};
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...cache, ...extra });
  res.end(body);
}
const redirect = (res, to) => send(res, 303, '', 'text/plain', { Location: to });
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json', { 'Cache-Control': 'no-store' });
const csv = (res, filename, rows) => {
  const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) || /^[=+\-@\t\r]/.test(s) ? `"${(/^[=+\-@\t\r]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
  send(res, 200, rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n', 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="${String(filename).replace(/[^\w.-]/g, '_')}"`, 'Cache-Control': 'no-store' });
};
const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)[\w\-/?=&.%]*$/.test(n) ? n : '');
const ipOf = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const baseUrl = (req) => config.publicUrl || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const readText = async (req, limit) => (await readBody(req, limit)).toString('utf8');
const readForm = async (req, limit) => new URLSearchParams(await readText(req, limit));

module.exports = { send, redirect, json, csv, safeNext, ipOf, baseUrl, readBody, readText, readForm, SECURITY_HEADERS };
