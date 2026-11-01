// Admin notices: the daily update check and the rate-table reminder. No network: fetch is faked.
const test = require('node:test');
const assert = require('node:assert');
const { _test: n } = require('../src/routes/notices');
const config = require('../src/config');

const fakeFetch = (body, status = 200) => async () => ({ ok: status === 200, status, json: async () => body });
const edition = config.edition === 'lite' ? 'lite' : 'full';

test('version comparison', () => {
  assert.equal(n.newer('1.1.0', '1.0.0'), true);
  assert.equal(n.newer('1.10.0', '1.9.9'), true);
  assert.equal(n.newer('1.0.0', '1.0.0'), false);
  assert.equal(n.newer('0.9.0', '1.0.0'), false);
  assert.equal(n.newer('nonsense', '1.0.0'), false);
});

test('a newer version for this edition shows a notice; the same version shows none', async () => {
  const r = await n.check({ force: true, fetchImpl: fakeFetch({ [edition]: { version: '99.0.0', notes: 'New things.', howto: 'https://github.com/storefront-kit/tillkit-lite#updating' } }) });
  assert.equal(r, 'update 99.0.0');
  const html = n.updateNotice();
  assert.match(html, /Tillkit 99\.0\.0 is available/);
  assert.match(html, new RegExp(`You have ${n.VERSION.replace(/\./g, '\\.')}`));
  assert.match(html, /href="https:\/\/github\.com\/storefront-kit\/tillkit-lite#updating"/);
  assert.equal(await n.check({ force: true, fetchImpl: fakeFetch({ [edition]: { version: n.VERSION } }) }), 'up to date');
  assert.equal(n.updateNotice(), '');
});

test('the other edition\'s version is ignored', async () => {
  const other = edition === 'lite' ? 'full' : 'lite';
  assert.equal(await n.check({ force: true, fetchImpl: fakeFetch({ [other]: { version: '99.0.0' } }) }), 'up to date');
});

test('fetched text is escaped and outside links are replaced', async () => {
  await n.check({ force: true, fetchImpl: fakeFetch({ [edition]: { version: '99.0.0', notes: '<script>alert(1)</script>', howto: 'https://evil.example/' } }) });
  const html = n.updateNotice();
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /evil\.example/);
  assert.match(html, /href="https:\/\/tillkit\.shop\/"/);
  n.state.latest = null;
});

test('a failed check throws (the job runner logs it) and keeps no stale notice', async () => {
  await assert.rejects(n.check({ force: true, fetchImpl: fakeFetch({}, 500) }));
  assert.equal(n.updateNotice(), '');
});

test('no check right after start or twice in a day', async () => {
  n.state.startedAt = Date.now(); n.state.checkedAt = 0;
  assert.equal(await n.check({ fetchImpl: fakeFetch({}) }), 'waiting');
  n.state.startedAt = 0; n.state.checkedAt = Date.now();
  assert.equal(await n.check({ fetchImpl: fakeFetch({}) }), 'recent');
});

test('the rate-table reminder only appears on Settings', () => {
  assert.equal(n.taxNotice('orders'), '');
  const onSettings = n.taxNotice('settings');
  // Tests run without Stripe keys, so tax comes from the rate table (or is off).
  if (onSettings) assert.match(onSettings, /don't update themselves/);
});
