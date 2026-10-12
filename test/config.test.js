import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hostOf, normalizeConfig, parseServerUrl } from '../src/config.js';

test('server addresses: bare host, URL copied from the browser, port, HTTPS', () => {
  assert.equal(parseServerUrl('192.0.2.10'), 'http://192.0.2.10');
  assert.equal(parseServerUrl(' http://192.0.2.10/admin/ '), 'http://192.0.2.10');
  assert.equal(parseServerUrl('https://pi.hole/admin/login'), 'https://pi.hole');
  assert.equal(parseServerUrl('pi.hole:8080'), 'http://pi.hole:8080');
  assert.equal(parseServerUrl('HTTPS://198.51.100.20:8443'), 'https://198.51.100.20:8443');
  assert.equal(parseServerUrl('[2001:db8::1]'), 'http://[2001:db8::1]');
  assert.equal(hostOf('https://pi.hole:8443'), 'pi.hole:8443');
});

test('unusable addresses are refused', () => {
  for (const raw of ['', '   ', 'ftp://192.0.2.10', 'http://', 'http://user:pass@192.0.2.10', 42]) {
    assert.equal(parseServerUrl(raw), null, String(raw));
  }
});

test('defaults: no server, one minute, a 5-minute pause, French', () => {
  assert.deepEqual(normalizeConfig(), {
    servers: [],
    invalidSlots: [],
    allowSelfSigned: false,
    pollIntervalMs: 60_000,
    switchOffMinutes: 5,
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), normalizeConfig());
  assert.deepEqual(normalizeConfig(null), normalizeConfig());
});

test('servers by slot, with name, password kept as typed, invalid slots reported', () => {
  const config = normalizeConfig({
    server_1_url: '192.0.2.10',
    server_1_password: ' pass with spaces ',
    server_1_name: '  Living room  ',
    server_2_url: 'not a url at all',
    server_3_url: 'https://198.51.100.20',
    allow_self_signed: true,
    poll_interval: '300',
    switch_off_minutes: '30',
    language: 'de',
  });
  assert.deepEqual(config.servers, [
    { slot: 1, url: 'http://192.0.2.10', password: ' pass with spaces ', name: 'Living room' },
    { slot: 3, url: 'https://198.51.100.20', password: '', name: null },
  ]);
  assert.deepEqual(config.invalidSlots, [2]);
  assert.equal(config.allowSelfSigned, true);
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.switchOffMinutes, 30);
  assert.equal(config.language, 'de');
});

test('values outside the lists fall back to the defaults', () => {
  const config = normalizeConfig({ poll_interval: '7', switch_off_minutes: 12, language: 'it' });
  assert.equal(config.pollIntervalMs, 60_000);
  assert.equal(config.switchOffMinutes, 5);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ poll_interval: 30 }).pollIntervalMs, 30_000);
});
