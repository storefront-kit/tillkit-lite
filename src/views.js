// Every page. Plain template strings, no framework.
// render(ctx, name, args) sets the signed-in user and CSRF token for the page.
const config = require('./config');

let CTX = { user: null, csrf: '' };
function render(ctx, name, args) { CTX = ctx || { user: null, csrf: '' }; try { return VIEWS[name](args || {}); } finally { CTX = { user: null, csrf: '' }; } }
const csrfField = () => `<input type="hidden" name="csrf" value="${esc(CTX.csrf)}">`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = config.money;
const V = (process.env.RAILWAY_GIT_COMMIT_SHA || String(Date.now())).slice(0, 8);
const R = config.restricted;

// Plain text → paragraphs; lines starting with "- " become a bullet list.
function prose(text) {
  return String(text || '').trim().split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${esc(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(esc).join('<br>')}</p>`;
  }).join('');
}

// The theme, colors and fonts for this page: the store's own, or in demo mode a visitor's preview.
const T = () => CTX.look || config;
const fontsHref = (t = T()) => {
  const fam = [...new Set([t.fonts.heading, t.fonts.body])].map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`).join('&');
  return `https://fonts.googleapis.com/css2?${fam}&display=swap`;
};
const themeCss = (t = T()) => { const C = t.colors; return `:root{--bg:${C.bg};--surface:${C.surface};--text:${C.text};--muted:${C.muted};--line:${C.line};--accent:${C.accent};--accent-text:${C.accentText};--sale:${C.sale};--sale-text:${C.saleText || '#fff'};--focus:${C.focus};--radius:${t.radius};--font-head:'${t.fonts.heading}',system-ui,sans-serif;--font-body:'${t.fonts.body}',system-ui,sans-serif;--head-weight:${t.headingWeight}${t.headingCase && t.headingCase !== 'none' ? `;--head-case:${t.headingCase}` : ''}}`.replace(/[<>]/g, ''); };
const favicon = (t = T()) => config.logo || `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${t.colors.accent}"/><text x="32" y="43" font-family="system-ui,sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="${t.colors.accentText}">${esc(config.name.trim()[0] || 'S')}</text></svg>`)}`;
const abs = (u) => (u && u.startsWith('/') && config.publicUrl ? config.publicUrl + u : u);
const brand = () => (config.logo ? `<img src="${esc(config.logo)}" alt="${esc(config.name)}" class="logo-img">` : `<span class="wordmark">${esc(config.name)}</span>`);
const SOCIAL = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', x: 'X' };

// Demo mode (DEMO=on) only: a strip on every page saying nothing is for sale.
function demoBar() {
  if (!config.demo) return '';
  const u = CTX.user;
  const [text, href, link] = u && u.demo ? ['Demo admin: look at everything. Saving is off, except on orders you placed yourself.', '/', 'Back to the store']
    : u && u.role === 'admin' ? ['Demo store. You’re signed in as the owner, so your changes are real and every visitor sees them.', '/admin', 'Admin']
      : ['Demo store: nothing here is for sale and no money moves. Use made-up details at checkout.', '/demo/admin', 'Try the admin'];
  // DEMO_BUY_URL: a link to buy the template, for visitors and the demo admin (not the real owner).
  const buy = config.demoBuy && !(u && u.role === 'admin' && !u.demo) ? ` · <a href="${esc(config.demoBuy.url)}" class="demo-buy">${esc(config.demoBuy.text)} →</a>` : '';
  return `<div class="demo-bar" role="note">${esc(text)} <a href="${href}">${esc(link)} →</a>${buy}</div>`;
}
// Demo mode only: lets visitors preview every theme and color preset (see src/demo-mode.js).
function demoLook() {
  if (!config.demo || !CTX.lookOptions) return '';
  const { themes, palettes, keep = [] } = CTX.lookOptions, t = T();
  const opts = (list, on, none) => `${none ? `<option value="">${esc(none)}</option>` : ''}${list.map((n) => `<option value="${esc(n)}"${n === on ? ' selected' : ''}>${esc(n[0].toUpperCase() + n.slice(1))}</option>`).join('')}`;
  return `<form class="demo-look" method="get">${keep.map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}<span>Preview a look</span><label><span class="sr-only">Theme</span><select name="theme">${opts(themes, t.themeName)}</select></label><label><span class="sr-only">Color preset</span><select name="palette">${opts(palettes, t.paletteName || '', 'Theme colors')}</select></label><button class="btn btn-ghost" type="submit">Apply</button></form>`;
}

function layout({ title, body, description = '', image = '', active = '', jsonld = null, noindex = false, bare = false }) {
  const fullTitle = title ? `${title} · ${config.name}` : `${config.name}${config.tagline ? ` · ${config.tagline}` : ''}`;
  const desc = description || config.description;
  const u = CTX.user;
  const nav = (href, label, key) => `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;
  const social = Object.entries(config.social || {}).filter(([, v]) => /^https:\/\//.test(v || '')).map(([k, v]) => `<a href="${esc(v)}" rel="noopener">${SOCIAL[k] || esc(k)}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:title" content="${esc(title || config.name)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:site_name" content="${esc(config.name)}">
${image ? `<meta property="og:image" content="${esc(abs(image))}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<link rel="icon" href="${esc(favicon())}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fontsHref()}">
<style>${themeCss()}</style>
<link rel="stylesheet" href="/static/site.css?v=${V}">
${STYLES.map((h) => `<link rel="stylesheet" href="${esc(h)}?v=${V}">`).join('')}
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body class="theme-${T().themeName}" data-currency="${esc(config.currency)}" data-locale="${esc(config.locale)}">
<a class="skip" href="#main">Skip to content</a>
${bare ? '' : `${demoBar()}${demoLook()}${config.announcement ? `<div class="announce">${esc(config.announcement)}</div>` : ''}
<header class="site-header">
  <div class="wrap header-row">
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav" data-menu><span></span><span></span><span class="sr-only">Menu</span></button>
    <a class="brand" href="/">${brand()}</a>
    <nav id="site-nav" class="site-nav" aria-label="Main">
      ${nav('/shop', 'Shop', 'shop')}${nav('/about', 'About', 'about')}
      ${u && u.role === 'admin' ? nav('/admin', 'Admin', 'admin') : ''}
      ${u ? nav('/account', 'Account', 'account') : nav('/login', 'Sign in', 'login')}
    </nav>
    <a class="cart-link" href="/cart" aria-label="Cart"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 7a3 3 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><span class="cart-count" data-cart-count>0</span></a>
  </div>
</header>`}
<main id="main">${body}</main>
${bare ? '' : `<footer class="site-footer">
  <div class="wrap footer-grid">
    <div><a class="brand" href="/">${brand()}</a>${config.tagline ? `<p class="muted">${esc(config.tagline)}</p>` : ''}</div>
    <nav aria-label="Shop"><h2>Shop</h2><a href="/shop">All products</a><a href="/about">About us</a>${config.contactEmail ? `<a href="mailto:${esc(config.contactEmail)}">Contact</a>` : ''}</nav>
    <nav aria-label="Policies"><h2>Policies</h2><a href="/policies/shipping">Shipping</a><a href="/policies/returns">Returns</a><a href="/policies/terms">Terms</a><a href="/policies/privacy">Privacy</a></nav>
    ${social ? `<nav aria-label="Social"><h2>Follow</h2>${social}</nav>` : ''}
  </div>
  <div class="wrap footer-base">${R.enabled && R.notice ? `<p class="notice">${esc(R.notice)}</p>` : ''}<p>© ${new Date().getFullYear()} ${esc(config.name)}</p>${config.edition === 'lite' ? '<p class="powered">Powered by <a href="https://tillkit.shop/?ref=lite">Tillkit</a></p>' : ''}</div>
</footer>
${R.enabled ? `<div class="age-gate" data-age-gate hidden role="dialog" aria-modal="true" aria-labelledby="age-title"><div class="age-card">${brand()}<h2 id="age-title">Are you ${esc(R.minAge)} or older?</h2><p>${esc(R.gateText)}</p><div class="row"><button class="btn btn-primary" data-age-yes>Yes, enter</button><a class="btn btn-ghost" href="https://www.google.com">No, leave</a></div></div></div>` : ''}`}
<div class="toast" data-toast role="status" aria-live="polite" hidden></div>
<script src="/static/site.js?v=${V}" defer></script>
${active === 'admin' ? `<script src="/static/admin.js?v=${V}" defer></script>` : ''}
</body>
</html>`;
}

// ── Storefront ───────────────────────────────────────────────────────────
const liveVariants = (p) => p.variants.filter((v) => v.active);
const minVariant = (p) => liveVariants(p).reduce((a, b) => (b.price < a.price ? b : a), liveVariants(p)[0]);
const soldOut = (p) => liveVariants(p).every((v) => v.stock !== null && v.stock !== undefined && v.stock !== '' && Number(v.stock) <= 0);
const placeholder = (name) => `<div class="ph" aria-hidden="true">${esc(String(name || '?').trim()[0] || '?')}</div>`;
const img = (src, alt, cls = '', lazy = true) => (src ? `<img src="${esc(src)}" alt="${esc(alt)}" class="${cls}"${lazy ? ' loading="lazy"' : ''} decoding="async">` : placeholder(alt));

function priceTag(p) {
  const v = minVariant(p); if (!v) return '';
  const multiple = new Set(liveVariants(p).map((x) => x.price)).size > 1;
  return `<span class="price">${multiple ? 'From ' : ''}${money(v.price)}</span>${v.compareAt ? ` <s class="was">${money(v.compareAt)}</s>` : ''}`;
}

function card(p) {
  const v = minVariant(p);
  return `<a class="card" href="/product/${esc(p.slug)}">
    <div class="card-img">${img(p.images[0], p.name)}${p.images[1] ? img(p.images[1], '', 'alt-img') : ''}
      ${soldOut(p) ? '<span class="badge">Sold out</span>' : v && v.compareAt ? '<span class="badge sale">Sale</span>' : ''}</div>
    <div class="card-body"><h3>${esc(p.name)}</h3><p>${priceTag(p)}</p></div>
  </a>`;
}
const grid = (list) => (list.length ? `<div class="grid">${list.map(card).join('')}</div>` : '<p class="empty-note">No products here yet. Add some in <a href="/admin">Admin</a>.</p>');

function home({ products }) {
  const featured = products.filter((p) => p.featured);
  const show = (featured.length ? featured : products).slice(0, 8);
  const h = config.hero;
  return layout({
    image: h.image || (show[0] && show[0].images[0]) || '',
    body: `
<section class="hero ${h.image ? '' : 'hero-text-only'}">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <h1>${esc(h.heading || config.name)}</h1>
      ${h.text ? `<p class="lead">${esc(h.text)}</p>` : ''}
      <a class="btn btn-primary btn-lg" href="/shop">${esc(h.button || 'Shop now')}</a>
    </div>
    ${h.image ? `<div class="hero-img">${img(h.image, '', '', false)}</div>` : ''}
  </div>
</section>
<section class="wrap section">
  <div class="section-head"><h2>${featured.length ? 'Featured' : 'Shop'}</h2><a href="/shop">View all</a></div>
  ${grid(show)}
</section>
${config.highlights.length ? `<section class="wrap section highlights">${config.highlights.map((x) => `<div><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p></div>`).join('')}</section>` : ''}
${config.about ? `<section class="wrap section about-teaser"><div><h2>About ${esc(config.name)}</h2>${prose(config.about.split(/\n\s*\n/)[0])}<a class="text-link" href="/about">Read our story</a></div></section>` : ''}`,
  });
}

function shop({ products, categories, cat }) {
  const list = cat ? products.filter((p) => p.category === cat) : products;
  const chip = (c, label) => `<a class="chip" href="/shop${c ? `?c=${encodeURIComponent(c)}` : ''}"${(cat || '') === c ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  return layout({
    title: cat || 'Shop', active: 'shop', description: cat ? `${cat} from ${config.name}` : '',
    body: `<section class="wrap section">
  <h1 class="page-title">${esc(cat || 'All products')}</h1>
  ${categories.length > 1 ? `<nav class="chips" aria-label="Categories">${chip('', 'All')}${categories.map((c) => chip(c, c)).join('')}</nav>` : ''}
  ${grid(list)}
</section>`,
  });
}

function product({ p, related }) {
  const vs = liveVariants(p);
  const first = vs.find((v) => !(v.stock !== null && v.stock !== undefined && v.stock !== '' && Number(v.stock) <= 0)) || vs[0];
  const stockNote = (v) => (v.stock === null || v.stock === undefined || v.stock === '' ? '' : Number(v.stock) <= 0 ? 'Sold out' : Number(v.stock) <= 5 ? `Only ${Number(v.stock)} left` : '');
  const single = vs.length === 1;
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.summary || String(p.description || '').slice(0, 300),
    image: p.images.map(abs), sku: first.sku || undefined, brand: { '@type': 'Brand', name: config.name },
    offers: vs.map((v) => ({ '@type': 'Offer', price: (v.price / 100).toFixed(2), priceCurrency: config.currency.toUpperCase(), sku: v.sku || undefined, availability: `https://schema.org/${stockNote(v) === 'Sold out' ? 'OutOfStock' : 'InStock'}`, url: abs(`/product/${p.slug}`) })),
  };
  return layout({
    title: p.name, description: p.summary || String(p.description || '').slice(0, 160), image: p.images[0] || '', jsonld,
    body: `<section class="wrap product">
  <div class="gallery" data-gallery>
    <div class="gallery-main">${img(p.images[0], p.name, '', false)}</div>
    ${p.images.length > 1 ? `<div class="thumbs">${p.images.map((src, i) => `<button type="button" class="thumb" data-src="${esc(src)}" aria-label="Show image ${i + 1}"${i === 0 ? ' aria-current="true"' : ''}>${img(src, '')}</button>`).join('')}</div>` : ''}
  </div>
  <div class="buy">
    ${p.category ? `<a class="eyebrow" href="/shop?c=${encodeURIComponent(p.category)}">${esc(p.category)}</a>` : ''}
    <h1>${esc(p.name)}</h1>
    <p class="buy-price"><span data-price>${money(first.price)}</span> <s class="was" data-was${first.compareAt ? '' : ' hidden'}>${first.compareAt ? money(first.compareAt) : ''}</s></p>
    ${p.summary ? `<p class="lead">${esc(p.summary)}</p>` : ''}
    <form class="buy-form" data-add-form data-name="${esc(p.name)}" data-image="${esc(p.images[0] || '')}">
      ${single ? `<input type="hidden" name="variant" value="${esc(first.id)}" data-price="${first.price}" data-compare="${first.compareAt || ''}" data-label="${esc(first.label)}" data-stock="${esc(stockNote(first))}"${stockNote(first) === 'Sold out' ? ' data-soldout' : ''}>`
      : `<fieldset class="options"><legend>${esc(p.optionName || 'Option')}</legend>${vs.map((v) => { const n = stockNote(v); return `<label class="opt${n === 'Sold out' ? ' is-out' : ''}"><input type="radio" name="variant" value="${esc(v.id)}" data-price="${v.price}" data-compare="${v.compareAt || ''}" data-label="${esc(v.label)}" data-stock="${esc(n)}"${n === 'Sold out' ? ' data-soldout' : ''}${v.id === first.id ? ' checked' : ''}><span>${esc(v.label)}</span></label>`; }).join('')}</fieldset>`}
      <p class="stock-note" data-stock-note>${esc(stockNote(first))}</p>
      <div class="buy-row">
        <label class="qty"><span class="sr-only">Quantity</span><button type="button" data-step="-1" aria-label="Less">−</button><input name="qty" type="number" min="1" max="20" value="1" inputmode="numeric"><button type="button" data-step="1" aria-label="More">+</button></label>
        <button class="btn btn-primary btn-lg" type="submit" data-add-btn${stockNote(first) === 'Sold out' ? ' disabled' : ''}>${stockNote(first) === 'Sold out' ? 'Sold out' : 'Add to cart'}</button>
      </div>
    </form>
    ${p.description ? `<div class="prose">${prose(p.description)}</div>` : ''}
    <ul class="assure"><li>${config.shipping.freeOverCents !== null ? `Free shipping over ${money(config.shipping.freeOverCents)}` : config.shipping.flatRateCents ? `${money(config.shipping.flatRateCents)} flat-rate shipping` : 'Free shipping'}</li><li>Ships in ${esc(config.policies.processingDays)}</li><li><a href="/policies/returns">${esc(config.policies.returnDays)}-day returns</a></li></ul>
  </div>
</section>
${related.length ? `<section class="wrap section"><div class="section-head"><h2>You may also like</h2></div>${grid(related)}</section>` : ''}`,
  });
}

function cart() {
  return layout({
    title: 'Cart', noindex: true,
    body: `<section class="wrap section narrow">
  <h1 class="page-title">Your cart</h1>
  <div data-cart data-free-over="${config.shipping.freeOverCents ?? ''}" data-flat="${config.shipping.flatRateCents}" data-currency="${esc(config.currency)}" data-locale="${esc(config.locale)}"><p class="muted">Loading…</p></div>
  <template data-empty-tpl><div class="empty"><p>Your cart is empty.</p><a class="btn btn-primary" href="/shop">Start shopping</a></div></template>
</section>`,
  });
}

function field(name, label, values, { type = 'text', required = true, auto = '', wide = false, opts = null } = {}) {
  const v = esc(values[name] || '');
  const input = opts ? `<select id="f-${name}" name="${name}"${required ? ' required' : ''}>${opts.map((o) => `<option${o === values[name] ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`
    : `<input id="f-${name}" name="${name}" type="${type}" value="${v}"${required ? ' required' : ''}${auto ? ` autocomplete="${auto}"` : ''}>`;
  return `<div class="field${wide ? ' wide' : ''}"><label for="f-${name}">${esc(label)}${required ? '' : ' <span class="muted">(optional)</span>'}</label>${input}</div>`;
}

function checkout({ error = '', values = {}, methods = [], labels = {}, hints = {}, buttons = {}, canceled = '' } = {}) {
  const countries = config.shipping.countries;
  return layout({
    title: 'Checkout', noindex: true,
    body: `<section class="wrap section checkout" data-checkout data-free-over="${config.shipping.freeOverCents ?? ''}" data-flat="${config.shipping.flatRateCents}" data-currency="${esc(config.currency)}" data-locale="${esc(config.locale)}">
  <h1 class="page-title">Checkout</h1>
  ${canceled ? `<div class="alert">Payment was canceled, so you weren't charged. Your cart is still here when you're ready.</div>` : ''}
  ${error ? `<div class="error" role="alert">${esc(error)}</div>` : ''}
  <div class="checkout-grid">
    <form method="post" action="/checkout" class="checkout-form">
      <input type="hidden" name="items" data-items-field value="${esc(values.items || '')}">
      <fieldset><legend>Contact</legend>
        <div class="fields">${field('email', 'Email', values, { type: 'email', auto: 'email', wide: true })}</div>
        ${CTX.user ? '' : '<p class="muted small">Have an account? <a href="/login?next=/checkout">Sign in</a> to see this order in your account later.</p>'}
      </fieldset>
      <fieldset><legend>Shipping address</legend>
        <div class="fields">
          ${field('name', 'Full name', values, { auto: 'name', wide: true })}
          ${field('address1', 'Address', values, { auto: 'address-line1', wide: true })}
          ${field('address2', 'Apartment, suite, etc.', values, { required: false, auto: 'address-line2', wide: true })}
          ${field('city', 'City', values, { auto: 'address-level2' })}
          ${field('state', 'State / region', values, { auto: 'address-level1' })}
          ${field('zip', 'ZIP / postal code', values, { auto: 'postal-code' })}
          ${countries.length > 1 ? field('country', 'Country', values, { opts: countries }) : `<input type="hidden" name="country" value="${esc(countries[0])}">`}
          ${field('phone', 'Phone', values, { type: 'tel', required: false, auto: 'tel' })}
        </div>
      </fieldset>
      ${R.enabled && R.attestations.length ? `<fieldset class="attest"><legend>Before you order</legend>${R.attestations.map((a, i) => `<label class="check"><input type="checkbox" name="attest_${i}" value="yes" required${values[`attest_${i}`] === 'yes' ? ' checked' : ''}><span>${esc(a)}</span></label>`).join('')}<p class="muted small">We record the time, IP address and browser with your order.</p></fieldset>` : ''}
      <fieldset class="pay-methods"><legend>Payment</legend>
        ${methods.map((m, i) => `<label class="pay-method"><input type="radio" name="method" value="${esc(m)}"${buttons[m] ? ` data-button="${esc(buttons[m])}"` : ''} required${(values.method ? values.method === m : i === 0) ? ' checked' : ''}><span class="pm-body"><span class="pm-name">${esc(labels[m] || m)}</span><span class="pm-hint">${esc(hints[m] || '')}</span></span></label>`).join('')}
      </fieldset>
      <div class="pay-box">
        <button class="btn btn-primary btn-lg btn-block" type="submit" data-pay-btn>Place order</button>
        <p class="muted small">By placing your order you agree to our <a href="/policies/terms">terms</a> and <a href="/policies/privacy">privacy policy</a>.</p>
      </div>
    </form>
    <aside class="summary" data-summary data-tax-label="${esc(config.tax.label || 'Sales tax')}" aria-label="Order summary"></aside>
  </div>
</section>`,
  });
}

const STATUS = { pending_payment: 'Awaiting payment', paid: 'Paid', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded' };
const statusLabel = (s) => STATUS[s] || String(s || '').replace(/_/g, ' ');

function orderTable(o) {
  return `<table class="table"><tbody>${o.items.map((i) => `<tr><th scope="row">${i.qty} × ${esc(i.label)}</th><td>${money(i.price * i.qty)}</td></tr>`).join('')}</tbody>
  <tfoot><tr><th>Subtotal</th><td>${money(o.subtotal)}</td></tr><tr><th>Shipping</th><td>${o.shipping ? money(o.shipping) : 'Free'}</td></tr>${o.tax ? `<tr><th>${esc((o.meta && o.meta.tax && o.meta.tax.label) || 'Sales tax')}</th><td>${money(o.tax)}</td></tr>` : ''}<tr class="total"><th>Total</th><td>${money(o.total)}</td></tr></tfoot></table>`;
}
const addressBlock = (c) => [c.name, c.address1, c.address2, `${c.city}, ${c.state} ${c.zip}`, c.country].filter(Boolean).map(esc).join('<br>');

function order({ order: o, justPlaced = false, instructionsHtml = '', paid: paidAmt = 0, balance = 0, canProof = false, proofs = 0, methodLabel = '', ownPage = false }) {
  const paid = o.status !== 'pending_payment' && o.status !== 'cancelled';
  const pending = o.status === 'pending_payment';
  const m = o.meta || {};
  const method = (m.payment && m.payment.method) || '';
  const until = m.holdUntil ? new Date(m.holdUntil) : null;
  const head = o.status === 'cancelled' ? 'This order was cancelled' : paid ? `Thank you, ${esc(o.customer.name.split(' ')[0])}!` : 'Order received';
  const hold = pending && until && method !== 'card' ? `<p class="hold-note">We’re holding your items until <strong>${esc(until.toLocaleString(config.locale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</strong>. If payment hasn’t arrived by then, the order is cancelled.</p>` : '';
  const part = pending && paidAmt > 0 ? `<div class="alert">We’ve received ${money(paidAmt)}. <strong>${money(balance)} is still due.</strong></div>` : '';
  const proof = canProof ? `<div class="proof-box" data-proof data-url="/order/${esc(o.id)}/proof?k=${esc(o.key)}">
      <h2 class="h3">Already paid?</h2>
      <p class="muted small">Upload a screenshot of your payment so we can match it faster.${proofs ? ` You’ve sent ${proofs} so far.` : ''}</p>
      <label class="btn btn-ghost upload-btn">Upload screenshot<input type="file" accept="image/jpeg,image/png,image/webp" data-proof-input hidden></label>
      <p class="small" data-proof-status role="status"></p>
    </div>` : '';
  const msg = o.status === 'cancelled' ? `<p class="lead">${esc(m.cancelReason ? `Cancelled: ${m.cancelReason}.` : '')} Nothing will ship. If you already paid, reply to your order email and we'll sort it out.</p>`
    : paid ? `<p class="lead">Your order is confirmed. ${o.status === 'shipped' ? 'It has shipped.' : "We'll email you when it ships."}</p>`
    : `<p class="lead">Your order is saved and waiting for payment${methodLabel ? ` by ${esc(methodLabel)}` : ''}.</p>${part}${instructionsHtml}${config.demo && method !== 'card' && !ownPage ? '<p class="demo-callout">Demo store: don’t send money. In a real store, the owner marks the order paid once the money arrives. <a href="/demo/admin">Open the demo admin</a> and try it on this order.</p>' : ''}${hold}${proof}${method === 'card' && !justPlaced ? '<p class="muted">If you just paid, give it a moment and refresh. We confirm with the payment processor before marking it paid.</p>' : ''}`;
  return layout({
    title: `Order ${o.id}`, noindex: true,
    body: `<section class="wrap section narrow" data-order-page${paid || justPlaced || ownPage ? ' data-clear-cart' : ''}>
  <p class="eyebrow">Order ${esc(o.id)} · ${esc(statusLabel(o.status))}</p>
  <h1 class="page-title">${head}</h1>
  ${msg}
  ${m.tracking ? `<p><strong>Tracking:</strong> ${/^https:\/\//.test(m.tracking) ? `<a href="${esc(m.tracking)}">${esc(m.tracking)}</a>` : esc(m.tracking)}</p>` : ''}
  ${orderTable(o)}
  <div class="two-col"><div><h2 class="h3">Shipping to</h2><p>${addressBlock(o.customer)}</p></div><div><h2 class="h3">Confirmation sent to</h2><p>${esc(o.email)}</p></div></div>
  <p><a class="btn btn-ghost" href="/shop">Keep shopping</a></p>
</section>`,
  });
}

function about() {
  return layout({
    title: 'About', active: 'about',
    body: `<section class="wrap section narrow"><h1 class="page-title">About ${esc(config.name)}</h1><div class="prose">${prose(config.about)}</div>
  ${config.contactEmail ? `<h2 class="h3">Get in touch</h2><p><a href="mailto:${esc(config.contactEmail)}">${esc(config.contactEmail)}</a></p>` : ''}</section>`,
  });
}

// ── Accounts ─────────────────────────────────────────────────────────────
const errorList = (errors) => (errors && errors.length ? `<div class="error" role="alert">${errors.length === 1 ? esc(errors[0]) : `<ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`}</div>` : '');
const authPage = (title, inner) => layout({ title, noindex: true, active: 'login', body: `<section class="wrap section auth"><div class="auth-card"><h1 class="page-title">${esc(title)}</h1>${inner}</div></section>` });

function login({ error = '', values = {}, next = '' } = {}) {
  return authPage('Sign in', `${error ? errorList([error]) : ''}
  <form method="post" action="/login" class="stack">
    <input type="hidden" name="next" value="${esc(next)}">
    ${field('email', 'Email', values, { type: 'email', auto: 'email', wide: true })}
    <div class="field wide"><label for="f-password">Password</label><input id="f-password" name="password" type="password" required autocomplete="current-password"></div>
    <button class="btn btn-primary btn-block" type="submit">Sign in</button>
  </form>
  <p class="muted small"><a href="/forgot">Forgot your password?</a> · New here? <a href="/register${next ? `?next=${encodeURIComponent(next)}` : ''}">Create an account</a></p>`);
}

function register({ errors = [], values = {}, next = '' } = {}) {
  return authPage('Create an account', `${errorList(errors)}
  <form method="post" action="/register" class="stack">
    <input type="hidden" name="next" value="${esc(next)}">
    ${field('name', 'Name', values, { auto: 'name', wide: true })}
    ${field('email', 'Email', values, { type: 'email', auto: 'email', wide: true })}
    <div class="field wide"><label for="f-password">Password <span class="muted">(10+ characters)</span></label><input id="f-password" name="password" type="password" required minlength="10" autocomplete="new-password"></div>
    ${R.enabled ? `<label class="check"><input type="checkbox" name="agree" value="yes" required><span>I am ${esc(R.minAge)} or older and agree to the <a href="/policies/terms">terms</a>.</span></label>` : ''}
    <button class="btn btn-primary btn-block" type="submit">Create account</button>
  </form>
  <p class="muted small">Already have one? <a href="/login">Sign in</a></p>`);
}

function forgot({ sent = false, emailOn = true } = {}) {
  return authPage('Reset your password', sent
    ? `<p>If an account exists for that email, a reset link is on its way. It works for one hour.</p><p><a href="/login">Back to sign in</a></p>`
    : emailOn ? `<p class="muted">Enter your account email and we'll send you a link to choose a new password.</p>
  <form method="post" action="/forgot" class="stack"><div class="field wide"><label for="f-email">Email</label><input id="f-email" name="email" type="email" required autocomplete="email"></div><button class="btn btn-primary btn-block" type="submit">Send reset link</button></form>`
      : `<p>Password reset emails aren't set up for this store yet. Email ${config.contactEmail ? `<a href="mailto:${esc(config.contactEmail)}">${esc(config.contactEmail)}</a>` : 'the store owner'} for help.</p>`);
}

function reset({ token = '', valid = true, errors = [] } = {}) {
  return authPage('Choose a new password', !valid ? `<p>This reset link has expired or was already used.</p><p><a href="/forgot">Send a new link</a></p>`
    : `${errorList(errors)}<form method="post" action="/reset" class="stack"><input type="hidden" name="t" value="${esc(token)}"><div class="field wide"><label for="f-password">New password <span class="muted">(10+ characters)</span></label><input id="f-password" name="password" type="password" required minlength="10" autocomplete="new-password"></div><button class="btn btn-primary btn-block" type="submit">Save password</button></form>`);
}

function account({ orders = [], msg = '', errors = [] } = {}) {
  const u = CTX.user;
  return layout({
    title: 'Your account', noindex: true, active: 'account',
    body: `<section class="wrap section narrow">
  <h1 class="page-title">Hi, ${esc((u.name || 'there').split(' ')[0])}</h1>
  ${msg ? `<div class="alert">${esc(msg)}</div>` : ''}${errorList(errors)}
  <h2 class="h3">Your orders</h2>
  ${orders.length ? `<table class="table orders"><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Total</th></tr></thead><tbody>${orders.map((o) => `<tr><td><a href="/order/${esc(o.id)}?k=${esc(o.key)}">${esc(o.id)}</a></td><td>${new Date(o.created_at).toLocaleDateString(config.locale)}</td><td>${esc(statusLabel(o.status))}</td><td>${money(o.total)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No orders yet.</p>'}
  <details class="panel"><summary>Change password</summary>
    <form method="post" action="/account/password" class="stack">${csrfField()}
      <div class="field wide"><label for="f-cur">Current password</label><input id="f-cur" name="current" type="password" required autocomplete="current-password"></div>
      <div class="field wide"><label for="f-new">New password</label><input id="f-new" name="password" type="password" required minlength="10" autocomplete="new-password"></div>
      <button class="btn btn-primary" type="submit">Update password</button>
    </form>
  </details>
  <form method="post" action="/logout">${csrfField()}<button class="btn btn-ghost" type="submit">Sign out</button></form>
</section>`,
  });
}

// ── Admin ────────────────────────────────────────────────────────────────
// Extra stylesheets from feature modules: registerStyle('/static/finance.css').
const STYLES = [];
function registerStyle(href) { if (!STYLES.includes(href)) STYLES.push(href); }

// Admin tabs. Feature modules add their own with registerAdminTab().
const ADMIN_TABS = [
  { key: 'products', href: '/admin/products', label: 'Products', order: 10 },
  { key: 'orders', href: '/admin/orders', label: 'Orders', order: 20 },
  { key: 'users', href: '/admin/users', label: 'Customers', order: 60 },
  { key: 'settings', href: '/admin/settings', label: 'Settings', order: 90 },
];
function registerAdminTab(tab) { if (!ADMIN_TABS.some((t) => t.key === tab.key)) ADMIN_TABS.push(tab); }
// Notices shown at the top of admin pages (see src/routes/notices.js). Each returns HTML or ''.
const ADMIN_NOTICES = [];
function registerAdminNotice(fn) { ADMIN_NOTICES.push(fn); }
const adminNotices = (active) => ADMIN_NOTICES.map((fn) => { try { return fn(active) || ''; } catch { return ''; } }).join('');
function adminShell(active, title, inner) {
  const tab = (t) => `<a href="${t.href}"${active === t.key ? ' aria-current="page"' : ''}>${esc(t.label)}</a>`;
  const tabs = [...ADMIN_TABS].sort((a, b) => a.order - b.order).map(tab).join('');
  return layout({ title, noindex: true, active: 'admin', body: `<section class="wrap section admin"><nav class="admin-nav" aria-label="Admin">${tabs}<a href="/" class="muted">View store ↗</a></nav>${adminNotices(active)}${inner}</section>` });
}

function adminProducts({ products, msg = '' }) {
  return adminShell('products', 'Products', `
  <div class="section-head"><h1 class="page-title">Products</h1><a class="btn btn-primary" href="/admin/products/new">Add product</a></div>
  ${msg ? `<div class="alert">${esc(msg)}</div>` : ''}
  ${products.length ? `<table class="table admin-table"><thead><tr><th></th><th>Product</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead><tbody>
  ${products.map((p) => { const vs = p.variants; const tracked = vs.filter((v) => v.stock !== null && v.stock !== undefined && v.stock !== ''); return `<tr>
    <td class="thumb-cell">${img(p.images[0], '')}</td>
    <td><a href="/admin/products/${esc(p.slug)}"><strong>${esc(p.name)}</strong></a><br><span class="muted small">${esc(p.category || 'No category')} · ${vs.length} option${vs.length === 1 ? '' : 's'}</span></td>
    <td>${vs.length ? money(Math.min(...vs.map((v) => v.price))) : '—'}</td>
    <td>${tracked.length ? tracked.reduce((s, v) => s + Number(v.stock), 0) : '<span class="muted">Not tracked</span>'}</td>
    <td>${p.active ? (p.featured ? 'Live · Featured' : 'Live') : '<span class="muted">Hidden</span>'}</td></tr>`; }).join('')}
  </tbody></table>` : '<p class="muted">No products yet.</p>'}`);
}

function variantRow(v = {}) {
  const cents = (c) => (c ? (c / 100).toFixed(2) : '');
  return `<div class="var-row" data-row>
    <input type="hidden" name="var_id" value="${esc(v.id || '')}">
    <label><span>Name</span><input name="var_label" value="${esc(v.label || '')}" placeholder="Default"></label>
    <label><span>Price</span><input name="var_price" value="${cents(v.price)}" inputmode="decimal" placeholder="24.00"></label>
    <label><span>Was <em>(optional)</em></span><input name="var_compare" value="${cents(v.compareAt)}" inputmode="decimal"></label>
    <label><span>SKU</span><input name="var_sku" value="${esc(v.sku || '')}"></label>
    <label><span>Stock</span><input name="var_stock" value="${v.stock ?? ''}" inputmode="numeric" placeholder="Blank = unlimited"></label>
    <label><span>Cost <em>(each)</em></span><input name="var_cost" value="${cents(v.cost)}" inputmode="decimal" placeholder="Optional"></label>
    <label><span>Show</span><select name="var_active"><option value="yes">Yes</option><option value="no"${v.active === false ? ' selected' : ''}>No</option></select></label>
    <button type="button" class="link-btn" data-remove-row>Remove</button>
  </div>`;
}
const imageRow = (src) => `<li class="img-row" data-row><img src="${esc(src)}" alt=""><input type="hidden" name="image" value="${esc(src)}"><div class="img-actions"><button type="button" class="link-btn" data-img-first>Make main</button><button type="button" class="link-btn" data-remove-row>Remove</button></div></li>`;

function adminProductForm({ p = null, isNew = true, errors = [] } = {}) {
  const x = p || { name: '', slug: '', images: [], variants: [{}], category: '', summary: '', description: '', optionName: 'Size', active: true, featured: false, sort: 0 };
  return adminShell('products', isNew ? 'Add product' : `Edit ${x.name}`, `
  <p><a href="/admin/products">← All products</a></p>
  <h1 class="page-title">${isNew ? 'Add a product' : esc(x.name)}</h1>
  ${errorList(errors)}
  <form method="post" action="${isNew ? '/admin/products/new' : `/admin/products/${esc(x.slug)}`}" class="admin-form" data-admin-form>${csrfField()}
    <fieldset><legend>Basics</legend><div class="fields">
      <div class="field wide"><label for="f-name">Name</label><input id="f-name" name="name" value="${esc(x.name)}" required></div>
      ${isNew ? `<div class="field"><label for="f-slug">Web address <span class="muted">(optional)</span></label><input id="f-slug" name="slug" value="${esc(x.slug)}" placeholder="made from the name"></div>` : `<div class="field"><label>Web address</label><p class="muted">/product/${esc(x.slug)}</p></div>`}
      <div class="field"><label for="f-category">Category <span class="muted">(optional)</span></label><input id="f-category" name="category" value="${esc(x.category)}" placeholder="e.g. Kitchen"></div>
      <div class="field wide"><label for="f-summary">One-line summary <span class="muted">(shown under the price)</span></label><input id="f-summary" name="summary" value="${esc(x.summary)}" maxlength="200"></div>
      <div class="field wide"><label for="f-desc">Description <span class="muted">(blank line = new paragraph; start lines with "- " for bullets)</span></label><textarea id="f-desc" name="description" rows="8">${esc(x.description)}</textarea></div>
    </div></fieldset>
    <fieldset><legend>Photos</legend>
      <ul class="img-list" data-rows="image">${x.images.map(imageRow).join('')}</ul>
      <div class="upload-row">
        <label class="btn btn-ghost upload-btn">Upload photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple data-upload hidden></label>
        <span class="muted small" data-upload-status>JPG, PNG or WebP. Big photos are resized automatically.</span>
      </div>
      <div class="field wide"><label for="f-imgurl">Or add an image link</label><div class="inline"><input id="f-imgurl" type="url" placeholder="https://…" data-img-url><button type="button" class="btn btn-ghost" data-img-add>Add</button></div></div>
      <template data-tpl="image">${imageRow('__SRC__')}</template>
    </fieldset>
    <fieldset><legend>Options and prices</legend>
      <div class="field"><label for="f-optname">Option label <span class="muted">(e.g. Size, Color)</span></label><input id="f-optname" name="optionName" value="${esc(x.optionName || 'Option')}"></div>
      <div data-rows="variant">${(x.variants.length ? x.variants : [{}]).map(variantRow).join('')}</div>
      <template data-tpl="variant">${variantRow()}</template>
      <button type="button" class="btn btn-ghost" data-add-row="variant">Add option</button>
    </fieldset>
    <fieldset><legend>Visibility</legend><div class="fields">
      <div class="field"><label for="f-active">Status</label><select id="f-active" name="active"><option value="yes">Live in the store</option><option value="no"${x.active ? '' : ' selected'}>Hidden</option></select></div>
      <div class="field"><label for="f-featured">Homepage</label><select id="f-featured" name="featured"><option value="no">Not featured</option><option value="yes"${x.featured ? ' selected' : ''}>Featured on homepage</option></select></div>
      <div class="field"><label for="f-sort">Sort order <span class="muted">(lower shows first)</span></label><input id="f-sort" name="sort" type="number" value="${esc(x.sort || 0)}"></div>
    </div></fieldset>
    <div class="row"><button class="btn btn-primary btn-lg" type="submit">${isNew ? 'Add product' : 'Save changes'}</button>${isNew ? '' : `<a class="btn btn-ghost" href="/product/${esc(x.slug)}" target="_blank">View in store ↗</a>`}</div>
  </form>
  ${isNew ? '' : `<form method="post" action="/admin/products/${esc(x.slug)}/delete" class="danger-zone" data-confirm="Delete ${esc(x.name)}? This can't be undone. Past orders keep their details.">${csrfField()}<button class="link-btn danger" type="submit">Delete this product</button></form>`}`);
}

const dollars = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2));
function adminOrders({ orders, filter = '', labels = {} }) {
  const list = filter ? orders.filter((o) => o.status === filter) : orders;
  const tab = (s, label) => `<a class="chip" href="/admin/orders${s ? `?s=${s}` : ''}"${filter === s ? ' aria-current="page"' : ''}>${label} <span class="muted">${s ? orders.filter((o) => o.status === s).length : orders.length}</span></a>`;
  const when = (iso) => new Date(iso).toLocaleString(config.locale, { dateStyle: 'medium', timeStyle: 'short' });
  return adminShell('orders', 'Orders', `
  <h1 class="page-title">Orders</h1>
  <nav class="chips">${tab('', 'All')}${tab('pending_payment', 'Awaiting payment')}${tab('paid', 'To ship')}${tab('shipped', 'Shipped')}${tab('cancelled', 'Cancelled')}${tab('refunded', 'Refunded')}</nav>
  ${list.length ? list.map((o) => {
    const m = o.meta || {}; const method = (m.payment && m.payment.method) || m.provider || '';
    const pays = m.payments || []; const paidAmt = pays.reduce((a, x) => a + x.amount, 0);
    const refunds = m.refunds || []; const refunded = refunds.reduce((a, x) => a + x.amount, 0);
    return `<details class="order-card" id="${esc(o.id)}">
    <summary><span><strong>${esc(o.id)}</strong> · ${esc(o.customer.name)}</span><span class="muted">${when(o.created_at)} · ${esc(labels[method] || method || '—')}</span><span class="status s-${esc(o.status)}">${esc(statusLabel(o.status))}</span><span>${money(o.total)}</span></summary>
    <div class="order-detail">
      <div>
        ${orderTable(o)}
        <h3 class="h3">Money</h3>
        <ul class="ledger">
          ${pays.map((x) => `<li><span>Received ${esc(when(x.at))} · ${esc(labels[x.method] || x.method)}${x.ref ? ` · <span class="mono">${esc(x.ref)}</span>` : ''}</span><b>${money(x.amount)}</b></li>`).join('')}
          ${m.paidAt && !pays.length ? `<li><span>Paid ${esc(when(m.paidAt))}${m.paymentRef ? ` · <span class="mono">${esc(m.paymentRef)}</span>` : ''}</span><b>${money(m.amountPaid || o.total)}</b></li>` : ''}
          ${refunds.map((x) => `<li class="neg"><span>Refunded ${esc(when(x.at))}${x.note ? ` · ${esc(x.note)}` : ''}</span><b>−${money(x.amount)}</b></li>`).join('')}
          ${o.status === 'pending_payment' ? `<li><span>Still due</span><b>${money(Math.max(0, o.total - paidAmt))}</b></li>` : ''}
          ${m.postage ? `<li class="muted"><span>Postage paid (your cost)</span><b>${money(m.postage)}</b></li>` : ''}
        </ul>
        ${(m.proofs || []).length ? `<p><strong>Payment screenshots</strong></p><div class="proof-thumbs">${m.proofs.map((x) => `<a href="/admin/files/${esc(x.file)}" target="_blank" rel="noopener"><img src="/admin/files/${esc(x.file)}" alt="Payment screenshot uploaded ${esc(when(x.at))}"></a>`).join('')}</div>` : ''}
      </div>
      <div>
        <p><strong>Ship to</strong><br>${addressBlock(o.customer)}${o.customer.phone ? `<br>${esc(o.customer.phone)}` : ''}</p>
        <p><strong>Email</strong><br><a href="mailto:${esc(o.email)}">${esc(o.email)}</a></p>
        ${m.holdUntil && o.status === 'pending_payment' ? `<p class="muted small">Held until ${esc(when(m.holdUntil))}${m.reminders ? ` · ${m.reminders} reminder${m.reminders === 1 ? '' : 's'} sent` : ''}</p>` : ''}
        ${m.cancelReason && o.status === 'cancelled' ? `<p class="muted small">Cancelled: ${esc(m.cancelReason)}</p>` : ''}
        ${m.tax && m.tax.source && m.tax.source !== 'none' ? `<p class="muted small">Tax: ${esc(m.tax.source === 'stripe' ? 'Stripe Tax' : 'your rate table')}${m.tax.rate ? ` · ${(m.tax.rate * 100).toFixed(3).replace(/\.?0+$/, '')}%` : ''}${m.tax.transactionId ? ` · recorded ${esc(m.tax.transactionId)}` : ''}</p>` : ''}
        ${m.attestation ? `<p class="muted small">Confirmed at checkout ${esc(m.attestation.at)} from ${esc(m.attestation.ip)}:<br>${(m.attestation.statements || []).map((x) => `✓ ${esc(x)}`).join('<br>')}</p>` : ''}
        <form method="post" action="/admin/orders/${esc(o.id)}" class="stack">${csrfField()}
          <div class="field"><label>Status</label><select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${o.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label>Tracking number or link</label><input name="tracking" value="${esc(m.tracking || '')}"></div>
          <div class="field"><label>Postage you paid${config.edition === 'lite' ? '' : ' <span class="muted">(for profit and margin reports)</span>'}</label><input name="postage" inputmode="decimal" value="${dollars(m.postage)}" placeholder="e.g. 7.45"></div>
          <button class="btn btn-primary" type="submit">Save</button>
          <p class="muted small">“Paid” records the amount still due and emails a receipt. “Shipped” emails the customer the tracking. Cancelling an unpaid order puts its stock back.</p>
        </form>
        ${o.status === 'pending_payment' ? `<details class="panel"><summary>Record a payment</summary>
          <form method="post" action="/admin/orders/${esc(o.id)}/payment" class="stack">${csrfField()}
            <div class="fields"><div class="field"><label>Amount</label><input name="amount" inputmode="decimal" required placeholder="${dollars(Math.max(0, o.total - paidAmt))}"></div>
            <div class="field"><label>Method</label><select name="method">${Object.entries(labels).map(([k, v]) => `<option value="${esc(k)}"${k === method ? ' selected' : ''}>${esc(v)}</option>`).join('')}<option value="other">Other</option></select></div>
            <div class="field wide"><label>Reference <span class="muted">(optional)</span></label><input name="ref" placeholder="Transaction ID, note…"></div></div>
            <button class="btn btn-ghost" type="submit">Record payment</button>
            <p class="muted small">When payments cover the total, the order turns Paid and the customer gets a receipt.</p>
          </form></details>` : ''}
        ${['paid', 'shipped', 'delivered', 'refunded'].includes(o.status) ? `<details class="panel"><summary>Record a refund${refunded ? ` (${money(refunded)} so far)` : ''}</summary>
          <form method="post" action="/admin/orders/${esc(o.id)}/refund" class="stack">${csrfField()}
            <div class="fields"><div class="field"><label>Amount refunded</label><input name="amount" inputmode="decimal" required></div><div class="field"><label>Note <span class="muted">(optional)</span></label><input name="note"></div></div>
            <button class="btn btn-ghost" type="submit">Record refund</button>
            <p class="muted small">Send the money back in Stripe, your wallet or bank first; this records it for your reports. A full refund sets the order to Refunded.</p>
          </form></details>` : ''}
      </div>
    </div></details>`; }).join('') : '<p class="muted">No orders here yet.</p>'}`);
}

function adminSettings({ values: v = {}, status = [], msg = '', errors = [], manualExtras = false, extraSettings = () => '' } = {}) {
  const txt = (k, label, hint = '', ph = '') => `<div class="field"><label for="s-${k}">${label}${hint ? ` <span class="muted">${hint}</span>` : ''}</label><input id="s-${k}" name="${k}" value="${esc(v[k] || '')}" placeholder="${esc(ph)}"></div>`;
  const chk = (k, label) => `<label class="check"><input type="checkbox" name="${k}" value="yes"${v[k] ? ' checked' : ''}><span>${label}</span></label>`;
  const num = (k, label, hint) => `<div class="field"><label for="s-${k}">${label} <span class="muted">${hint}</span></label><input id="s-${k}" name="${k}" type="number" min="0" value="${esc(v[k] ?? '')}"></div>`;
  const st = (label, text) => `<li><span>${label}</span><b>${esc(text)}</b></li>`;
  return adminShell('settings', 'Settings', `
  <h1 class="page-title">Settings</h1>
  ${msg ? `<div class="alert">${esc(msg)}</div>` : ''}${errorList(errors)}
  <div class="panel"><strong>Connected services</strong> <span class="muted small">(set with Railway Variables; see the guide)</span>
    <ul class="ledger">${status.map(([label, text]) => st(esc(label), text)).join('')}</ul></div>
  <form method="post" action="/admin/settings" class="admin-form">${csrfField()}
    ${extraSettings(v, { txt, chk, esc })}
    <fieldset><legend>Other ways to pay</legend>
      ${chk('invoice', 'Offer “Pay by invoice” (you bill the customer yourself)')}
      ${manualExtras ? chk('proofUploads', 'Let customers upload a screenshot of their payment') : ''}
    </fieldset>
    <fieldset><legend>Unpaid orders</legend>
      <div class="fields">${num('holdHours', 'Hold items for', '(hours; 0 = never cancel)')}${num('reminderHours', 'Send a reminder every', '(hours; 0 = no reminders)')}</div>
    </fieldset>
    <fieldset><legend>Reports and alerts</legend>
      ${config.edition === 'lite' ? '' : chk('monthlyEmail', 'Email me last month’s sales and profit summary on the 1st')}
      <div class="fields">${num('lowStockAt', 'Low-stock alert at', '(units left)')}</div>
    </fieldset>
    <button class="btn btn-primary btn-lg" type="submit">Save settings</button>
  </form>`);
}

function adminUsers({ users }) {
  return adminShell('users', 'Customers', `
  <h1 class="page-title">Customer accounts</h1>
  <p class="muted">Guests who check out without an account appear under Orders only.</p>
  <table class="table admin-table"><thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Role</th></tr></thead><tbody>
  ${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${new Date(u.createdAt).toLocaleDateString(config.locale)}</td><td>
    ${u.email === CTX.user.email ? 'Admin (you)' : `<form method="post" action="/admin/users/role" class="inline">${csrfField()}<input type="hidden" name="email" value="${esc(u.email)}"><select name="role"><option value="customer">Customer</option><option value="admin"${u.role === 'admin' ? ' selected' : ''}>Admin</option></select><button class="link-btn" type="submit">Save</button></form>`}</td></tr>`).join('')}
  </tbody></table>`);
}

function policy({ title, html }) { return layout({ title, body: `<section class="wrap section narrow"><h1 class="page-title">${esc(title)}</h1><div class="prose">${html}</div></section>` }); }
function notFound() { return layout({ title: 'Not found', noindex: true, body: '<section class="wrap section narrow"><h1 class="page-title">We couldn’t find that page</h1><p><a class="btn btn-primary" href="/shop">Go to the shop</a></p></section>' }); }
function comingSoon() { return layout({ bare: true, noindex: true, body: `<section class="coming-soon"><div>${brand()}<h1>Opening soon</h1>${config.tagline ? `<p class="lead">${esc(config.tagline)}</p>` : ''}${config.contactEmail ? `<p><a href="mailto:${esc(config.contactEmail)}">${esc(config.contactEmail)}</a></p>` : ''}</div></section>` }); }

const VIEWS = { home, shop, product, cart, checkout, order, about, login, register, forgot, reset, account, adminProducts, adminProductForm, adminOrders, adminSettings, adminUsers, policy, notFound, comingSoon };
// For feature modules (src/routes/*): build a page with the signed-in user and CSRF token set.
//   views.page(ctx, () => views.adminShell('finance', 'Finance', html))
function page(ctx, fn) { CTX = ctx || { user: null, csrf: '' }; try { return fn(); } finally { CTX = { user: null, csrf: '' }; } }
module.exports = { render, page, esc, money, STATUS, statusLabel, layout, adminShell, registerAdminTab, registerAdminNotice, registerStyle, csrfField, errorList, field, prose, img, orderTable, addressBlock, themeCss, fontsHref };
