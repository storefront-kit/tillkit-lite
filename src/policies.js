// Policy pages at /policies/<name>. Starting templates only, not legal advice.
// The [bracketed] values come from `policies` in store.config.js. Edit the
// wording freely, then have a lawyer review it before you launch.
const config = require('./config');

const P = config.policies;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = esc(config.name), legal = esc(P.legalName), email = esc(config.contactEmail || '[email]');
const R = config.restricted;
const effective = `<p class="muted">Effective ${esc(P.effectiveDate)}</p>`;

module.exports = {
  shipping: {
    title: 'Shipping policy',
    html: `${effective}
<p>Orders are processed within ${esc(P.processingDays)} after payment clears. You'll get an email with tracking when your order ships.</p>
<h2>Where we ship</h2><p>We currently ship to: ${esc(config.shipping.countries.join(', '))}.${R.enabled && R.blockedRegions.length ? ` We do not ship to: ${esc(R.blockedRegions.join(', '))}.` : ''}</p>
<h2>Cost</h2><p>${config.shipping.flatRateCents ? `Shipping is ${config.money(config.shipping.flatRateCents)} per order` : 'Shipping is free'}${config.shipping.freeOverCents !== null ? `, and free on orders of ${config.money(config.shipping.freeOverCents)} or more` : ''}.</p>
<h2>Lost or damaged packages</h2><p>If your package arrives damaged, email ${email} within ${esc(P.damageClaimDays)} days of delivery with your order number and a photo. If tracking shows delivered but you can't find it, contact us and we'll help file a claim with the carrier.</p>`,
  },
  returns: {
    title: 'Returns and refunds',
    html: `${effective}
<p>You can return unused items in their original condition within ${esc(P.returnDays)} days of delivery for a refund to your original payment method.</p>
<h2>How to start a return</h2><p>Email ${email} with your order number. We'll reply with return instructions. Return shipping is paid by the buyer unless the item arrived damaged or we sent the wrong item.</p>
<h2>Refunds</h2><p>Refunds are issued within 5 business days of the return arriving. Your bank may take a few more days to post it. Original shipping charges are not refundable.</p>
${R.enabled ? '<h2>Exceptions</h2><p>[List any items that cannot be returned once opened, if that applies to what you sell.]</p>' : ''}`,
  },
  terms: {
    title: 'Terms of sale',
    html: `${effective}
<p>These terms apply to purchases from ${store}, operated by ${legal} (“we”, “us”). By placing an order you agree to them.</p>
<h2>Orders and pricing</h2><p>All prices are in ${esc(config.currency.toUpperCase())}. We may cancel an order if a product is out of stock, a price was listed in error, or we suspect fraud; if we do, we'll refund any payment in full.</p>
${R.enabled ? `<h2>Eligibility</h2><p>You must be at least ${esc(R.minAge)} years old to purchase. By placing an order you confirm each statement you checked at checkout. We record the time, IP address and browser of every order for verification. You are responsible for knowing whether products are legal where you live; we may refuse orders to any location.</p>` : ''}
<h2>Accounts</h2><p>You're responsible for keeping your password private and for activity under your account.</p>
<h2>Limitation of liability</h2><p>To the extent the law allows, our liability for any claim related to a purchase is limited to the amount you paid for that order.</p>
<h2>Governing law</h2><p>These terms are governed by the laws of ${esc(P.state)}.</p>
<h2>Contact</h2><p>${email}</p>`,
  },
  privacy: {
    title: 'Privacy policy',
    html: `${effective}
<p>This policy explains what ${legal} collects through ${store} and how it is used.</p>
<h2>What we collect</h2><ul><li>Order details: name, email, shipping address, items and amounts.</li><li>Account details if you create one: name, email and a securely hashed password.</li><li>Technical details with each order: time, IP address and browser type, used to prevent fraud${R.enabled ? ' and record your checkout confirmations' : ''}.</li></ul>
<p>Card details are entered on our payment processor's page and never reach our servers.</p>
<h2>How we use it</h2><p>To fulfil and support your order, send order and shipping emails, prevent fraud, and meet legal obligations. We don't sell your personal information.</p>
<h2>Who we share it with</h2><p>Only the services needed to run the store: our payment processor, hosting provider, email provider and shipping carriers.</p>
<h2>Cookies</h2><p>We use one cookie to keep you signed in. Your cart is stored in your own browser.</p>
<h2>Your choices</h2><p>Email ${email} to access, correct or delete your information.</p>`,
  },
};
