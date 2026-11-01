// Demo products, added the first time the store starts with no products.
// `cost` is what one unit costs you (cents), used for profit in Admin → Finance.
// Delete them in /admin once you've added your own, or set SEED_DEMO=false
// in Railway before your first deploy to start empty.
const v = (slug, label, price, extra = {}) => ({ id: `${slug}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, label, price, compareAt: null, sku: '', stock: null, active: true, ...extra });
const img = (n) => `/static/demo/${n}.svg`;

const PRODUCTS = [
  {
    slug: 'stoneware-mug', name: 'Stoneware mug', category: 'Kitchen', featured: true, sort: 1, optionName: 'Glaze',
    images: [img('mug-sand'), img('mug-slate')],
    summary: 'A heavy, hand-thrown 12 oz mug with a thumb rest that actually fits a thumb.',
    description: 'Thrown on the wheel in small batches, so no two are quite the same.\n\n- Holds 12 oz\n- Dishwasher and microwave safe\n- Made in Portland, Oregon',
    variants: [v('stoneware-mug', 'Sand', 2800, { sku: 'MUG-SND', cost: 1050, stock: 24 }), v('stoneware-mug', 'Slate', 2800, { sku: 'MUG-SLT', cost: 1050, stock: 18 })],
  },
  {
    slug: 'soy-candle', name: 'Cedar & smoke candle', category: 'Home', featured: true, sort: 2, optionName: 'Size',
    images: [img('candle'), img('candle-alt')],
    summary: 'Cedar, vetiver and a little woodsmoke, poured in a reusable glass jar.',
    description: 'Poured by hand from coconut-soy wax with a cotton wick.\n\n- 8 oz burns about 45 hours\n- 12 oz burns about 70 hours',
    variants: [v('soy-candle', '8 oz', 2200, { sku: 'CND-08', cost: 780 }), v('soy-candle', '12 oz', 3000, { sku: 'CND-12', cost: 1040 })],
  },
  {
    slug: 'bud-vase', name: 'Ceramic bud vase', category: 'Home', featured: true, sort: 3, optionName: 'Option',
    images: [img('vase')],
    summary: 'A small matte vase for a single stem or a few sprigs from the yard.',
    description: 'Glazed inside so it holds water; left raw outside for a soft, chalky finish. About 5 inches tall.',
    variants: [v('bud-vase', 'Default', 3600, { sku: 'VSE-01', cost: 1320, stock: 9 })],
  },
  {
    slug: 'wool-throw', name: 'Wool throw', category: 'Home', featured: true, sort: 4, optionName: 'Option',
    images: [img('throw')],
    summary: 'Woven from undyed lambswool. Warm without being heavy.',
    description: 'Finished with a hand-knotted fringe. 50 × 60 in.\n\nDry clean, or hand wash cold and lay flat.',
    variants: [v('wool-throw', 'Default', 12000, { compareAt: 14500, sku: 'THR-01', cost: 5400, stock: 6 })],
  },
  {
    slug: 'linen-tea-towels', name: 'Linen tea towels, set of 3', category: 'Kitchen', sort: 5, optionName: 'Option',
    images: [img('towels')],
    summary: 'Stonewashed linen that dries glasses without lint and gets softer every wash.',
    description: 'Three 18 × 28 in towels with a woven stripe and a hanging loop.',
    variants: [v('linen-tea-towels', 'Default', 2400, { compareAt: 3200, sku: 'TWL-3', cost: 920 })],
  },
  {
    slug: 'canvas-tote', name: 'Market tote', category: 'Accessories', sort: 6, optionName: 'Option',
    images: [img('tote')],
    summary: 'Heavy cotton canvas with handles long enough for your shoulder.',
    description: '- 16 × 15 × 5 in\n- Inside pocket for keys\n- Machine wash cold',
    variants: [v('canvas-tote', 'Default', 3800, { sku: 'TOT-01', cost: 1380 })],
  },
  {
    slug: 'dot-grid-notebook', name: 'Dot-grid notebook', category: 'Paper', sort: 7, optionName: 'Option',
    images: [img('notebook')],
    summary: '160 pages of thick, fountain-pen-friendly paper that lies flat.',
    description: 'Cloth cover, sewn binding, numbered pages and an elastic closure. A5.',
    variants: [v('dot-grid-notebook', 'Default', 1600, { sku: 'NBK-A5', cost: 540, stock: 4 })],
  },
  {
    slug: 'brass-bookmark', name: 'Brass bookmark', category: 'Paper', sort: 8, optionName: 'Option',
    images: [img('bookmark')],
    summary: 'Solid brass with a leather tassel. It will outlast the book.',
    description: 'Develops a warm patina with use. Polish with a soft cloth if you prefer it bright.',
    variants: [v('brass-bookmark', 'Default', 1200, { sku: 'BKM-01', cost: 380, stock: 0 })],
  },
].map((p) => ({ active: true, ...p }));

module.exports = { PRODUCTS };
