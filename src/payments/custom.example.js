// ─────────────────────────────────────────────────────────────────────────
//  TEMPLATE FOR ANY OTHER PAYMENT PROCESSOR
//  Use this to connect a processor that isn't Stripe: a specialist merchant
//  account, a regional gateway, a specialist processor, and so on.
//
//  1. Copy this file to src/payments/custom.js
//  2. Fill in the three functions using your processor's API docs
//     (or paste their docs into Claude Code with the prompt in GUIDE.md).
//  3. In Railway Variables set PAYMENT_PROVIDER=custom plus whatever keys
//     your processor gives you (e.g. CUSTOM_API_KEY).
//
//  The store handles everything else: pricing, stock, the order record,
//  emails, and status changes. Your code only talks to the processor.
// ─────────────────────────────────────────────────────────────────────────

module.exports = {
  name: 'custom',
  label: 'Card payment',
  buttonText: 'Continue to payment',
  note: 'You will finish paying on our payment partner’s secure page.',

  // Return false if a required key is missing, so checkout shows a clear error.
  ready: () => !!process.env.CUSTOM_API_KEY,

  // Called right after the order is saved.
  // order: { id, key, email, customer, items: [{ label, price, qty }], subtotal, shipping, total }
  //        Amounts are in cents (2500 = $25.00).
  // Return ONE of:
  //   { redirect: 'https://processor.example/pay/abc' }  send the buyer to a hosted payment page
  //   { instructions: 'Text shown on the order page' }    e.g. wire details
  // Send the buyer back to:  `${baseUrl}/order/${order.id}?k=${order.key}`
  async start(order, { baseUrl }) {
    throw new Error('custom payment provider not written yet');
  },

  // Called when the buyer lands back on the order page. Ask the processor
  // whether this order is paid. Return { paid: true, ref: 'their-transaction-id' } or null.
  // `query` is the URL's search params (URLSearchParams).
  async confirm(order, query) {
    return null;
  },

  // Called when the processor POSTs to /webhooks/custom.
  // raw: the request body as a string. headers: lower-cased header names.
  // ALWAYS verify the signature your processor documents before trusting it.
  // Return { orderId, event: 'paid' | 'failed', ref } , { ignored: true } or { error: 'reason' }.
  async webhook(raw, headers) {
    return { ignored: true };
  },
};
