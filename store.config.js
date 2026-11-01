// ─────────────────────────────────────────────────────────────────────────
//  YOUR STORE SETTINGS
//  This is the one file you edit to make the store yours. Change a value,
//  save, and push to GitHub; Railway redeploys in about a minute.
//  Secrets (passwords, API keys) never go here. They go in Railway's
//  Variables tab. See .env.example for the list.
// ─────────────────────────────────────────────────────────────────────────
module.exports = {
  // ── Basics ─────────────────────────────────────────────────────────────
  name: 'Northbound Goods',
  tagline: 'Small-batch goods for everyday use.',
  // Short description used by Google and when links are shared.
  description: 'Small-batch home goods, made in small runs and shipped from Portland.',
  // Path to your logo (put the file in /public and use /static/your-file.svg).
  // Leave null to show your store name as text.
  logo: null,
  contactEmail: 'hello@example.com',
  // Letters at the start of every order number, e.g. NB-3F9A1C22.
  orderPrefix: 'NB',

  // ── Look and feel ──────────────────────────────────────────────────────
  // Pick a starting theme:
  //   'clean'      light and modern          'midnight'   dark, with sky blue
  // Tillkit Full adds five more themes: https://tillkit.shop
  theme: 'clean',
  // Optional color preset for buttons and highlights. Each one has a shade
  // for light themes and one for dark themes, so it suits any theme:
  // 'ink', 'cobalt', 'forest', 'terracotta', 'plum', 'ocean', 'rose' or 'gold'.
  // null keeps the theme's own colors.
  palette: null,
  // Override any color yourself. An accent set here wins over the palette.
  colors: {
    // accent: '#1F5EFF',   // buttons, links, highlights
    // bg: '#FAFAF8',       // page background
    // text: '#17181A',
  },
  // Google Fonts names. Leave null to use the theme's fonts.
  fonts: { heading: null, body: null },

  // ── Homepage ───────────────────────────────────────────────────────────
  announcement: 'Free shipping on US orders over $75',   // '' to hide the top bar
  hero: {
    heading: 'Made slowly. Built to last.',
    text: 'Stoneware, linen and paper goods from small workshops, in limited runs.',
    button: 'Shop the collection',
    image: '/static/demo/hero.svg',                        // null for a text-only hero
  },
  // Three short selling points shown under the products. [] to hide.
  highlights: [
    { title: 'Small batches', text: 'Every run is under 200 pieces, so things sell out. When they do, they come back.' },
    { title: 'Ships in 1–2 days', text: 'Packed by hand in recycled materials and shipped from Portland, Oregon.' },
    { title: '30-day returns', text: 'Not right? Send it back unused within 30 days for a full refund.' },
  ],
  // Your story, for the About page. Leave a blank line between paragraphs.
  // The first paragraph also appears on the homepage.
  about: `We started Northbound Goods in a one-car garage with a kiln and a sewing machine. Today we work with six small workshops across the Pacific Northwest.

Everything we sell is something we use at home. If it doesn't hold up to daily use in our own kitchen, it doesn't go in the shop.`,
  social: { instagram: '', tiktok: '', facebook: '', x: '' },     // full URLs

  // ── Money and shipping ─────────────────────────────────────────────────
  currency: 'usd',          // three-letter code Stripe supports, lowercase
  locale: 'en-US',          // how prices are formatted
  shipping: {
    flatRate: 6.00,         // charged per order
    freeOver: 75.00,        // free shipping at or above this subtotal; null to turn off
    countries: ['US'],      // two-letter codes you ship to
    label: 'Standard shipping (3–5 business days)',
  },
  // ── Sales tax ──────────────────────────────────────────────────────────
  // Tax is worked out at checkout for every payment method.
  //   'auto'   Stripe Tax when STRIPE_SECRET_KEY is set and Stripe Tax is turned on
  //            in your Stripe dashboard; otherwise the rates below
  //   'stripe' always Stripe Tax (most accurate: exact state, county and city rates)
  //   'table'  only the rates below
  //   'off'    no sales tax
  // Only list states where you're registered to collect tax. This is not tax
  // advice: ask an accountant where you need to register.
  tax: {
    provider: 'auto',
    rates: {
      // WA: 10.25,   // percent; two-letter state code (or the full name)
      // 'CA-ON': 13, // outside the US: country-province
    },
    shippingTaxable: [],   // states where shipping is taxed, e.g. ['WA']
    label: 'Sales tax',
  },

  // ── Checkout ───────────────────────────────────────────────────────────
  // What buyers see when PAYMENT_PROVIDER is 'manual' (no card payments yet,
  // or you'd rather invoice customers yourself).
  manualPaymentInstructions: 'We will email you an invoice within one business day. Your order ships once it is paid.',

  // ── Your policy pages ──────────────────────────────────────────────────
  // These fill the blanks in /policies/*. The policy text is a starting
  // template, not legal advice. Have a lawyer review it before you launch.
  policies: {
    legalName: '[Your Company LLC]',
    state: '[State]',
    processingDays: '1–2 business days',
    returnDays: 30,
    damageClaimDays: 7,
    effectiveDate: '[Month Day, Year]',
  },

};
