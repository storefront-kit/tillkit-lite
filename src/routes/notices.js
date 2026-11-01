// Admin notices: "a new Tillkit version is out" and "your sales tax rates don't update themselves".
// Nothing here is shown to customers.
//
// Update check: once a day the store reads a small public file (https://tillkit.shop/version.json)
// and compares it with the version in package.json. It sends nothing about the store.
// Turn it off with UPDATE_CHECK=off. Public demo copies (DEMO=on) never check.
'use strict';
const config = require('../config');
const { esc } = require('../views');

const VERSION = require('../../package.json').version;
const CHECK_URL = process.env.UPDATE_CHECK_URL || 'https://tillkit.shop/version.json';
const DAY = 24 * 60 * 60e3;
const state = { latest: null, checkedAt: 0, startedAt: Date.now() };

// "1.10.0" > "1.9.2". Anything that isn't a plain x.y.z counts as 0.0.0.
function parse(v) { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim()); return m ? m.slice(1).map(Number) : [0, 0, 0]; }
function newer(a, b) { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; }

// Only links to Tillkit's own sites are shown.
const safeUrl = (u, fallback) => (/^https:\/\/(github\.com\/storefront-kit\/|tillkit\.shop\/)/.test(String(u || '')) ? String(u) : fallback);

async function check({ force = false, fetchImpl = fetch } = {}) {
  if (!force) {
    if (Date.now() - state.startedAt < 90e3) return 'waiting'; // let the store finish starting first
    if (Date.now() - state.checkedAt < DAY) return 'recent';
  }
  state.checkedAt = Date.now();
  const res = await fetchImpl(CHECK_URL, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`version check returned ${res.status}`);
  const data = await res.json();
  const entry = data && data[config.edition === 'lite' ? 'lite' : 'full'];
  state.latest = entry && newer(entry.version, VERSION) ? entry : null;
  return state.latest ? `update ${entry.version}` : 'up to date';
}

function updateNotice() {
  const u = state.latest;
  if (!u) return '';
  const howto = safeUrl(u.howto, 'https://tillkit.shop/');
  return `<div class="alert notice-update"><strong>Tillkit ${esc(u.version)} is available.</strong> You have ${esc(VERSION)}.${u.notes ? ` ${esc(String(u.notes).slice(0, 300))}` : ''} <a href="${esc(howto)}">How to update</a></div>`;
}

// Shown on Settings when tax comes from the rate table in store.config.js instead of Stripe Tax.
function taxNotice(active) {
  if (active !== 'settings') return '';
  let tax; try { tax = require('../tax'); } catch { return ''; }
  const d = tax.describe();
  if (d === 'Stripe Tax' || d === 'Off') return '';
  return `<div class="alert notice-tax"><strong>Your sales tax rates don't update themselves.</strong> The store is using the rates in store.config.js, so when a state or city changes its rate you have to change it there. Stripe Tax keeps rates current for you: turn it on in your Stripe dashboard and leave <code>tax.provider</code> as <code>'auto'</code> (or set it to <code>'stripe'</code>).</div>`;
}

module.exports = {
  handle: () => false,
  init({ jobs, views }) {
    if (views.registerAdminNotice) { views.registerAdminNotice(() => updateNotice()); views.registerAdminNotice((active) => taxNotice(active)); }
    if (config.demo || /^(0|false|no|off)$/i.test(process.env.UPDATE_CHECK || '')) return;
    jobs.register('updates: check for a new Tillkit version', 60 * 60e3, () => check());
  },
  // For tests.
  _test: { check, newer, state, updateNotice, taxNotice, VERSION },
};
