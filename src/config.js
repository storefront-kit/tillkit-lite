// Loads store.config.js, fills in defaults, applies the theme and color preset,
// and reads environment variables. Everything else imports settings from here.
const path = require('path');

// Which edition this is: 'full' or 'lite'. The Tillkit build sets it; Lite has two themes and no restricted mode.
const EDITION = 'lite';

// Themes: colors, Google Fonts names, corner radius and heading style.
// Extra touches for each theme are in public/site.css under .theme-<name>.
const THEMES = {
  clean: {
    colors: { bg: '#FAFAF8', surface: '#FFFFFF', text: '#17181A', muted: '#62666D', line: '#E4E4DF', accent: '#17181A', accentText: '#FFFFFF', sale: '#C2410C', saleText: '#FFFFFF', focus: '#2563EB' },
    fonts: { heading: 'Inter Tight', body: 'Inter' },
    radius: '10px', headingWeight: 600, headingCase: 'none',
  },
  midnight: {
    colors: { bg: '#0D1015', surface: '#151922', text: '#ECEFF4', muted: '#99A2B2', line: '#262C37', accent: '#8BD3FF', accentText: '#0D1015', sale: '#FFB86B', saleText: '#0D1015', focus: '#8BD3FF' },
    fonts: { heading: 'Space Grotesk', body: 'Inter' },
    radius: '14px', headingWeight: 600, headingCase: 'none',
  },
};

// Accent color presets: palette: 'forest' in store.config.js (or PALETTE=forest to preview).
// Each has a shade for light themes and one for dark themes, so it works with every theme.
// It sets the button, link-highlight and focus color; colors.accent in store.config.js still wins.
const PALETTES = {
  ink: { light: { accent: '#1C1C1E', accentText: '#FFFFFF' }, dark: { accent: '#F2F2F0', accentText: '#141416' } },
  cobalt: { light: { accent: '#1D4ED8', accentText: '#FFFFFF' }, dark: { accent: '#93B4FF', accentText: '#0B1430' } },
  forest: { light: { accent: '#1F6B43', accentText: '#FFFFFF' }, dark: { accent: '#86D3A4', accentText: '#0B2416' } },
  terracotta: { light: { accent: '#B04A28', accentText: '#FFFFFF' }, dark: { accent: '#F2A07E', accentText: '#2A1209' } },
  plum: { light: { accent: '#76306A', accentText: '#FFFFFF' }, dark: { accent: '#DDA8D6', accentText: '#2A0F26' } },
  ocean: { light: { accent: '#0B6A80', accentText: '#FFFFFF' }, dark: { accent: '#74D0E0', accentText: '#06222A' } },
  rose: { light: { accent: '#B4285B', accentText: '#FFFFFF' }, dark: { accent: '#F5A3BF', accentText: '#2E0E1B' } },
  gold: { light: { accent: '#8A6A12', accentText: '#FFFFFF' }, dark: { accent: '#E3BE6C', accentText: '#241A05' } },
};

// Relative luminance of a #rgb or #rrggbb color (0 = black, 1 = white); null if it isn't one.
function luminance(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// A theme plus an optional color preset and the owner's own colors and fonts, resolved to what the
// pages use. The preset picks its dark-theme shade when the page background is dark (luminance
// under 0.18, where a color stands out more against white than against black).
const has = (list, name) => typeof name === 'string' && Object.prototype.hasOwnProperty.call(list, name);
function look(themeName, paletteName, colors = {}, fonts = {}) {
  const name = has(THEMES, themeName) ? themeName : 'clean';
  const theme = THEMES[name];
  const bg = luminance(colors.bg) === null ? theme.colors.bg : colors.bg;
  const preset = has(PALETTES, paletteName) && !colors.accent ? PALETTES[paletteName][luminance(bg) < 0.18 ? 'dark' : 'light'] : null;
  return {
    themeName: name,
    paletteName: preset ? paletteName : null,
    colors: { ...theme.colors, ...(preset ? { accent: preset.accent, accentText: preset.accentText, focus: preset.accent } : {}), ...colors },
    fonts: { heading: fonts.heading || theme.fonts.heading, body: fonts.body || theme.fonts.body },
    radius: theme.radius, headingWeight: theme.headingWeight, headingCase: theme.headingCase,
  };
}

let user;
try { user = { ...require(path.join(__dirname, '..', 'store.config.js')) }; }
catch (err) { console.error('\nCould not read store.config.js. Check for a missing comma or quote near:\n', err.message, '\n'); throw err; }
if (process.env.THEME) user.theme = process.env.THEME; // quick way to preview another theme
if (process.env.PALETTE) user.palette = process.env.PALETTE; // and another color preset

if (user.theme && !has(THEMES, user.theme)) console.warn(`store.config.js: unknown theme "${user.theme}", using "clean". Options: ${Object.keys(THEMES).join(', ')}`);
if (user.palette && !has(PALETTES, user.palette)) console.warn(`store.config.js: unknown palette "${user.palette}", using the theme's own colors. Options: ${Object.keys(PALETTES).join(', ')}`);
const theme = look(user.theme, user.palette, user.colors || {}, user.fonts || {});

const restricted = { enabled: false, minAge: 21, gateText: '', attestations: [], blockedRegions: [], notice: '', ...(user.restricted || {}) };
if (EDITION === 'lite' && restricted.enabled) { console.warn('store.config.js: restricted mode is part of Tillkit Full (https://tillkit.shop). It stays off in Tillkit Lite.'); restricted.enabled = false; }
restricted.blockedRegions = (restricted.blockedRegions || []).map((s) => String(s).trim().toUpperCase()).filter(Boolean);

const env = process.env;
// Dates the server prints (order times, holds) use the store's time zone, not the host's (often UTC).
if (!env.TZ) env.TZ = env.STORE_TZ || 'America/Los_Angeles';
const provider = (env.PAYMENT_PROVIDER || (env.STRIPE_SECRET_KEY ? 'stripe' : 'manual')).toLowerCase();

const config = {
  name: user.name || 'My Store',
  tagline: user.tagline || '',
  description: user.description || user.tagline || '',
  logo: user.logo || null,
  contactEmail: env.CONTACT_EMAIL || user.contactEmail || '',
  orderPrefix: String(user.orderPrefix || 'OR').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'OR',
  themeName: theme.themeName,
  paletteName: theme.paletteName,
  colors: theme.colors,
  fonts: theme.fonts,
  radius: theme.radius, headingWeight: theme.headingWeight, headingCase: theme.headingCase,
  announcement: user.announcement || '',
  hero: { heading: '', text: '', button: 'Shop now', image: null, ...(user.hero || {}) },
  highlights: Array.isArray(user.highlights) ? user.highlights : [],
  about: user.about || '',
  social: user.social || {},
  currency: String(user.currency || 'usd').toLowerCase(),
  locale: user.locale || 'en-US',
  shipping: {
    flatRate: 0, freeOver: null, countries: ['US'], label: 'Shipping', ...(user.shipping || {}),
  },
  tax: { provider: 'auto', rates: {}, shippingTaxable: [], label: 'Sales tax', ...(user.tax || {}) },
  manualPaymentInstructions: user.manualPaymentInstructions || '',
  policies: { legalName: '[Your Company LLC]', state: '[State]', processingDays: '1–2 business days', returnDays: 30, damageClaimDays: 7, effectiveDate: '[Date]', ...(user.policies || {}) },
  restricted,

  // From environment variables (Railway → your service → Variables).
  port: Number(env.PORT) || 3000,
  publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
  production: env.NODE_ENV === 'production',
  comingSoon: /^(1|true|yes|on)$/i.test(env.COMING_SOON || ''),
  demo: /^(1|true|yes|on)$/i.test(env.DEMO || ''), // public demo copy; see src/demo-mode.js
  // Demo mode only: an optional link in the demo banner to where the template is sold (https only).
  demoBuy: /^https:\/\//.test(env.DEMO_BUY_URL || '') ? { url: env.DEMO_BUY_URL, text: env.DEMO_BUY_TEXT || 'Get this template' } : null,
  seedDemo: !/^(0|false|no|off)$/i.test(env.SEED_DEMO || ''),
  payments: { provider },
  notifyEmail: env.NOTIFY_EMAIL || env.ADMIN_EMAIL || '',
};

// Money is stored in cents everywhere. These turn config dollars into cents.
config.shipping.flatRateCents = Math.round(Number(config.shipping.flatRate || 0) * 100);
config.shipping.freeOverCents = config.shipping.freeOver == null || config.shipping.freeOver === '' ? null : Math.round(Number(config.shipping.freeOver) * 100);
config.shipping.countries = (config.shipping.countries || ['US']).map((c) => String(c).toUpperCase());

const fmt = new Intl.NumberFormat(config.locale, { style: 'currency', currency: config.currency.toUpperCase() });
config.money = (cents) => fmt.format((Number(cents) || 0) / 100);
config.shippingFor = (subtotalCents) => (config.shipping.freeOverCents !== null && subtotalCents >= config.shipping.freeOverCents ? 0 : config.shipping.flatRateCents);

module.exports = config;
module.exports.THEMES = THEMES;
module.exports.edition = EDITION;
module.exports.PALETTES = PALETTES;
module.exports.look = look;
module.exports.luminance = luminance;
