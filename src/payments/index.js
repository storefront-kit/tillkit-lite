// Payment processors that talk back to the store through webhooks
// (POST /webhooks/<name>). The choices buyers see at checkout are in methods.js.
const fs = require('fs');
const path = require('path');

const providers = { stripe: require('./stripe'), manual: require('./manual') };
if (fs.existsSync(path.join(__dirname, 'custom.js'))) providers.custom = require('./custom');

module.exports = { providers };
