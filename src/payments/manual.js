// Manual payments: the order is saved as "awaiting payment" and the buyer
// sees your instructions (invoice, cash on pickup...).
// You mark it paid in /admin/orders once the money arrives.
const config = require('../config');

module.exports = {
  name: 'manual',
  label: 'Pay by invoice',
  buttonText: 'Place order',
  note: config.manualPaymentInstructions,
  ready: () => true,
  async start() { return { instructions: config.manualPaymentInstructions }; },
  async confirm() { return null; },
  async webhook() { return { ignored: true }; },
};
