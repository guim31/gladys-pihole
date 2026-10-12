// -----------------------------------------------------------------------------
// The Pi-hole v6 client against the in-memory Pi-hole: sessions, errors, the
// v5 detection, the blocking command.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, PiholeClient } from '../src/pihole/client.js';
import { FakePihole } from './helpers/fakePihole.js';

const URL = 'http://192.0.2.10';

function setup(serverOptions = {}, clientOptions = {}) {
  const server = new FakePihole(serverOptions);
  const client = new PiholeClient({
    url: URL,
    password: 'secret',
    request: (url, options) => server.handle(url, options),
    ...clientOptions,
  });
  return { server, client };
}

const rejectsWith = (promise, kind) =>
  assert.rejects(promise, (err) => {
    assert.equal(err.kind, kind);
    return true;
  });

test('logs in once and reuses the session', async () => {
  const { server, client } = setup();
  await client.getSummary();
  await client.getBlocking();
  await client.getVersions();
  assert.equal(server.logins, 1);
  assert.equal(server.sessions.size, 1);
  const calls = server.requests.filter((r) => r.path !== '/api/auth');
  assert.equal(calls.length, 3);
  assert.deepEqual(server.requests[0], {
    method: 'POST',
    path: '/api/auth',
    body: { password: 'secret' },
    insecure: false,
  });
});

test('concurrent calls share one login', async () => {
  const { server, client } = setup();
  await Promise.all([client.getSummary(), client.getBlocking(), client.getVersions()]);
  assert.equal(server.logins, 1);
});

test('logs in again when the session expired (401), once', async () => {
  const { server, client } = setup();
  await client.getSummary();
  server.expireSessions();
  const summary = await client.getSummary();
  assert.equal(summary.queries.total, 7497);
  assert.equal(server.logins, 2);
});

test('a Pi-hole without password answers without login', async () => {
  const { server, client } = setup({ password: '' }, { password: '' });
  await client.getSummary();
  assert.equal(server.logins, 0);
});

test('a password set on the client and none on the Pi-hole still works', async () => {
  const { client } = setup({ password: '' });
  await client.getSummary();
  assert.equal(client.sid, null);
});

test('no password configured on a protected Pi-hole: auth error', async () => {
  const { client } = setup({}, { password: '' });
  await rejectsWith(client.getSummary(), ERROR_KINDS.AUTH);
});

test('a wrong password is an auth error', async () => {
  const { client } = setup({ password: 'other' });
  await rejectsWith(client.getSummary(), ERROR_KINDS.AUTH);
});

test('two-factor authentication: the web password needs a code, an app password does not', async () => {
  const web = setup({ totp: true });
  await rejectsWith(web.client.getSummary(), ERROR_KINDS.TOTP);
  const app = setup({ totp: true, appPassword: 'app-password' }, { password: 'app-password' });
  await app.client.getSummary();
});

test('no free session: seats error', async () => {
  const { client } = setup({ maxSessions: 0 });
  await rejectsWith(client.getSummary(), ERROR_KINDS.SEATS);
});

test('a Pi-hole v5 is detected and refused', async () => {
  const { client } = setup({ kind: 'v5' });
  await rejectsWith(client.getSummary(), ERROR_KINDS.V5);
});

test('something else at the address: not a Pi-hole', async () => {
  const { client } = setup({ kind: 'other' });
  await rejectsWith(client.getSummary(), ERROR_KINDS.NOT_PIHOLE);
});

test('a server error is an HTTP error', async () => {
  const { server, client } = setup();
  await client.getSummary();
  server.failNext = 500;
  await rejectsWith(client.getSummary(), ERROR_KINDS.HTTP);
});

test('network errors: unreachable, certificate refused, redirect', async () => {
  const failing = (code) =>
    new PiholeClient({
      url: URL,
      request: async () => {
        const error = new Error(code);
        error.code = code;
        throw error;
      },
    });
  await rejectsWith(failing('ECONNREFUSED').getSummary(), ERROR_KINDS.UNREACHABLE);
  await rejectsWith(failing('ETIMEDOUT').getSummary(), ERROR_KINDS.UNREACHABLE);
  await rejectsWith(failing('DEPTH_ZERO_SELF_SIGNED_CERT').getSummary(), ERROR_KINDS.TLS);
  const redirected = new PiholeClient({
    url: URL,
    request: async () => ({ status: 308, headers: { location: 'https://192.0.2.10/' }, body: '' }),
  });
  await assert.rejects(redirected.getSummary(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.REDIRECT);
    assert.equal(err.location, 'https://192.0.2.10/');
    return true;
  });
});

test('the self-signed option reaches the transport', async () => {
  const { server, client } = setup({}, { insecure: true });
  await client.getSummary();
  assert.ok(server.requests.every((r) => r.insecure === true));
});

test('the password never appears in an error message', async () => {
  const { client } = setup({ password: 'other' }, { password: 'my-very-secret' });
  await assert.rejects(client.getSummary(), (err) => {
    assert.doesNotMatch(err.message, /my-very-secret/);
    return true;
  });
});

test('pause with a timer, then resume (the timer cancelled)', async () => {
  const { server, client } = setup();
  const paused = await client.setBlocking(false, 300);
  assert.equal(paused.blocking, 'disabled');
  assert.ok(paused.timer > 299);
  assert.deepEqual(server.requests.at(-1).body, { blocking: false, timer: 300 });
  const resumed = await client.setBlocking(true);
  assert.equal(resumed.blocking, 'enabled');
  assert.deepEqual(server.requests.at(-1).body, { blocking: true, timer: null });
});

test('logout deletes the session and frees the seat', async () => {
  const { server, client } = setup();
  await client.getSummary();
  assert.equal(server.sessions.size, 1);
  await client.logout();
  assert.equal(server.sessions.size, 0);
  const last = server.requests.at(-1);
  assert.equal(last.method, 'DELETE');
  assert.equal(last.path, '/api/auth');
  // Nothing to delete without a session, and a dead server is ignored.
  await client.logout();
  server.online = false;
  await client.getSummary().catch(() => {});
  await client.logout();
});
