// Themes and color presets: every theme, and every theme with every preset, meets WCAG AA contrast;
// the original three themes render exactly as they always have.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { THEMES, PALETTES, look, luminance, edition } = require('../src/config');
const EXPECTED_THEMES = ['clean', 'midnight'];

const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// [foreground, background, minimum]. 4.5:1 for text (WCAG AA); 3:1 for buttons and focus rings.
const PAIRS = [
  ['text', 'bg', 4.5], ['text', 'surface', 4.5],
  ['muted', 'bg', 4.5], ['muted', 'surface', 4.5],
  ['accentText', 'accent', 4.5],
  ['saleText', 'sale', 4.5],
  ['sale', 'bg', 4.5], ['sale', 'surface', 4.5], // "Only 3 left" is set in the sale color
  ['accent', 'bg', 3], ['accent', 'surface', 3],
  ['focus', 'bg', 3], ['focus', 'surface', 3],
];
// color-mix(in srgb, a p%, b), as site.css uses for notices (.alert: 10% accent on surface).
const mix = (a, b, p) => { const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16); return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) * p + ch(b, i) * (1 - p)).toString(16).padStart(2, '0')).join('')}`; };
function failures(label, c) {
  const out = [];
  for (const [fg, bg, min] of PAIRS) {
    assert.ok(luminance(c[fg]) !== null && luminance(c[bg]) !== null, `${label}: ${fg} or ${bg} is not a #hex color`);
    const r = ratio(c[fg], c[bg]);
    if (r < min) out.push(`${label}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min}:1`);
  }
  const alert = ratio(c.text, mix(c.accent, c.surface, 0.1));
  if (alert < 4.5) out.push(`${label}: text on the accent-tinted notice is ${alert.toFixed(2)}:1, needs 4.5:1`);
  return out;
}

test('the edition has its themes and eight color presets, each complete', () => {
  assert.deepEqual(Object.keys(THEMES), EXPECTED_THEMES);
  assert.deepEqual(Object.keys(PALETTES), ['ink', 'cobalt', 'forest', 'terracotta', 'plum', 'ocean', 'rose', 'gold']);
  for (const [name, t] of Object.entries(THEMES)) {
    for (const k of ['bg', 'surface', 'text', 'muted', 'line', 'accent', 'accentText', 'sale', 'saleText', 'focus']) assert.ok(luminance(t.colors[k]) !== null, `${name}.colors.${k}`);
    assert.ok(t.fonts.heading && t.fonts.body, `${name} fonts`);
    assert.match(t.radius, /^\d+px$/); assert.ok([400, 500, 600, 700].includes(t.headingWeight), `${name} headingWeight`);
  }
  for (const [name, p] of Object.entries(PALETTES)) for (const v of ['light', 'dark']) assert.ok(luminance(p[v].accent) !== null && luminance(p[v].accentText) !== null, `${name}.${v}`);
});

test('every theme meets WCAG AA contrast', () => {
  const bad = Object.keys(THEMES).flatMap((name) => failures(name, look(name).colors));
  assert.deepEqual(bad, []);
});

test('every theme with every color preset meets WCAG AA contrast', () => {
  const bad = [];
  let n = 0;
  for (const name of Object.keys(THEMES)) {
    for (const pal of Object.keys(PALETTES)) {
      const l = look(name, pal);
      assert.equal(l.paletteName, pal);
      bad.push(...failures(`${name} + ${pal}`, l.colors)); n++;
    }
  }
  assert.equal(n, EXPECTED_THEMES.length * 8);
  assert.deepEqual(bad, []);
});

test('presets use their dark shade on dark backgrounds, and an explicit accent always wins', () => {
  assert.equal(look('midnight', 'forest').colors.accent, PALETTES.forest.dark.accent);
  assert.equal(look('midnight', 'cobalt').colors.accentText, PALETTES.cobalt.dark.accentText);
  assert.equal(look('clean', 'forest').colors.accent, PALETTES.forest.light.accent);
  assert.equal(look('clean', 'forest').colors.focus, PALETTES.forest.light.accent);
  assert.equal(look('clean', 'forest', { bg: '#111111' }).colors.accent, PALETTES.forest.dark.accent, 'follows an owner-set dark bg');
  const own = look('clean', 'plum', { accent: '#123456' });
  assert.equal(own.colors.accent, '#123456'); assert.equal(own.colors.accentText, THEMES.clean.colors.accentText); assert.equal(own.paletteName, null);
  assert.equal(look('clean', 'plum', { sale: '#000000' }).colors.sale, '#000000');
});

test('unknown names fall back safely', () => {
  assert.equal(look('nope').themeName, 'clean');
  assert.deepEqual(look('midnight', 'nope').colors, THEMES.midnight.colors);
  for (const name of ['constructor', '__proto__', 'toString']) {
    assert.equal(look(name, name).themeName, 'clean'); assert.equal(look(name, name).paletteName, null);
  }
});

test('the original themes render exactly as before', () => {
  const { themeCss, fontsHref } = require('../src/views');
  const expected = {
    clean: [":root{--bg:#FAFAF8;--surface:#FFFFFF;--text:#17181A;--muted:#62666D;--line:#E4E4DF;--accent:#17181A;--accent-text:#FFFFFF;--sale:#C2410C;--sale-text:#FFFFFF;--focus:#2563EB;--radius:10px;--font-head:'Inter Tight',system-ui,sans-serif;--font-body:'Inter',system-ui,sans-serif;--head-weight:600}",
      'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap'],
    warm: [":root{--bg:#F5EFE6;--surface:#FFFCF7;--text:#2B2420;--muted:#76695F;--line:#E3D8CA;--accent:#A9512B;--accent-text:#FFFFFF;--sale:#A9512B;--sale-text:#FFFFFF;--focus:#A9512B;--radius:4px;--font-head:'Fraunces',system-ui,sans-serif;--font-body:'DM Sans',system-ui,sans-serif;--head-weight:500}",
      'https://fonts.googleapis.com/css2?family=Fraunces:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap'],
    midnight: [":root{--bg:#0D1015;--surface:#151922;--text:#ECEFF4;--muted:#99A2B2;--line:#262C37;--accent:#8BD3FF;--accent-text:#0D1015;--sale:#FFB86B;--sale-text:#0D1015;--focus:#8BD3FF;--radius:14px;--font-head:'Space Grotesk',system-ui,sans-serif;--font-body:'Inter',system-ui,sans-serif;--head-weight:600}",
      'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap'],
  };
  for (const [name, [css, href]] of Object.entries(expected)) {
    if (!THEMES[name]) continue; // Lite ships two of these
    assert.equal(themeCss(look(name)), css, name);
    assert.equal(fontsHref(look(name)), href, name);
  }
  // Color and font overrides layer on top exactly as they did.
  assert.equal(themeCss(look('clean', null, { accent: '#1F5EFF', bg: '#FFFDF8' }, { heading: 'Lora' })),
    ":root{--bg:#FFFDF8;--surface:#FFFFFF;--text:#17181A;--muted:#62666D;--line:#E4E4DF;--accent:#1F5EFF;--accent-text:#FFFFFF;--sale:#C2410C;--sale-text:#FFFFFF;--focus:#2563EB;--radius:10px;--font-head:'Lora',system-ui,sans-serif;--font-body:'Inter',system-ui,sans-serif;--head-weight:600}");
  for (const [name, t] of Object.entries(THEMES)) if (t.headingCase === 'uppercase') assert.match(themeCss(look(name)), /;--head-case:uppercase\}$/, name);
});

test('THEME and PALETTE environment variables are read', () => {
  const run = (env) => spawnSync(process.execPath, ['-e', "const c = require('./src/config'); console.log(JSON.stringify({ theme: c.themeName, palette: c.paletteName }))"],
    { cwd: path.join(__dirname, '..'), env: { ...process.env, THEME: '', PALETTE: '', ...env }, encoding: 'utf8' });
  assert.equal(JSON.parse(run({ THEME: 'midnight' }).stdout).theme, 'midnight');
  const r = run({ THEME: 'midnight', PALETTE: 'nope' });
  assert.match(r.stderr, /unknown palette "nope"/);
  assert.equal(JSON.parse(r.stdout).palette, null);
});
