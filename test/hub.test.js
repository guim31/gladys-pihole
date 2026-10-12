// -----------------------------------------------------------------------------
// The hub, end to end: the SDK's fake Gladys on one side, in-memory Pi-hole
// servers on the other, a manual clock. Devices, states, transitions and
// their scene events, commands, sessions, reconfiguration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORIGINS, TRIGGERS, WIDGET_KEY, parseMinutes } from '../src/hub.js';
import { Store } from '../src/store.js';
import {
  FakePihole,
  URL_1,
  URL_2,
  createAll,
  createClock,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

const TWO_SERVERS = {
  server_1_url: URL_1,
  server_1_password: 'secret',
  server_1_name: 'Primary',
  server_2_url: URL_2,
  server_2_password: 'secret',
  server_2_name: 'Secondary',
};

async function world(t, options = {}) {
  const clock = options.clock ?? createClock();
  const servers = options.servers ?? { [URL_1]: new FakePihole({ now: clock.now }) };
  const result = await createWorld({ ...options, clock, servers });
  t.after(() => result.app.stop());
  return { ...result, server: servers[URL_1], servers };
}

const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);

test('one device per configured server, with its states, status and transport', async (t) => {
  const w = await world(t);
  const [device] = w.fake.discoveredDevices;
  assert.equal(device.name, 'Pi-hole');
  assert.equal(device.external_id, deviceId(w.gladys));
  assert.equal(device.should_poll, false);
  assert.equal(device.poll_frequency, undefined);
  assert.deepEqual(device.params, [{ name: 'PIHOLE_URL', value: URL_1 }]);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'blocking')), 1);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'queries_24h')), 7497);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'blocked_24h')), 3465);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'blocked_percent_24h')), 46);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'active_clients_24h')), 10);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'blocklist_domains')), 104756);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'updates_available')), 0);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.deepEqual(w.fake.transports, [
    { device_external_id: deviceId(w.gladys), transport: 'local' },
  ]);
});

test('a server without name is named after its address', async (t) => {
  const w = await world(t, { config: { server_1_url: URL_1, server_1_password: 'secret' } });
  assert.equal(w.fake.discoveredDevices[0].name, 'Pi-hole 192.0.2.10');
});

test('only the changes are published, everything again when a device is added', async (t) => {
  const w = await world(t);
  const before = w.fake.states.length;
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, before, 'nothing changed, nothing sent');

  w.server.summary.queries.total += 10;
  w.server.summary.queries.blocked += 2;
  await w.hub.pollAll();
  assert.deepEqual(
    w.fake.states.slice(before).map((state) => state.device_feature_external_id),
    [featureId(w.gladys, 'queries_24h'), featureId(w.gladys, 'blocked_24h')],
  );

  const sent = w.fake.states.length;
  const refreshes = w.fake.widgetRefreshes.length;
  await createAll(w);
  assert.equal(w.fake.states.length - sent, 7, 'every feature again');
  assert.equal(w.fake.widgetRefreshes.length, refreshes + 1);
  assert.equal(w.fake.widgetRefreshes.at(-1), WIDGET_KEY);
});

test('the switch pauses the blocking (or for the configured time) and resumes it', async (t) => {
  const w = await world(t, {
    config: { server_1_url: URL_1, server_1_password: 'secret', switch_off_minutes: '15' },
  });
  await createAll(w);
  const [device] = w.fake.devices;
  const feature = device.features.find((f) => f.external_id.endsWith(':blocking'));

  assert.equal((await w.fake.setValue(device, feature, 0)).success, true);
  assert.deepEqual(w.server.requests.at(-1).body, { blocking: false, timer: 900 });
  assert.equal(w.fake.lastState(feature.external_id), 0);
  assert.deepEqual(events(w, TRIGGERS.PAUSED).at(-1).data, {
    device: device.external_id,
    server: 'Pi-hole 192.0.2.10',
    origin: ORIGINS.GLADYS,
    duration_minutes: 15,
  });

  assert.equal((await w.fake.setValue(device, feature, 1)).success, true);
  assert.deepEqual(w.server.requests.at(-1).body, { blocking: true, timer: null });
  assert.equal(w.fake.lastState(feature.external_id), 1);
  assert.equal(events(w, TRIGGERS.RESUMED).at(-1).data.origin, ORIGINS.GLADYS);

  // A read-only feature cannot be controlled.
  const counter = device.features.find((f) => f.external_id.endsWith(':queries_24h'));
  assert.equal((await w.fake.setValue(device, counter, 1)).success, false);
});

test('the switch turned off without a configured time: until turned back on', async (t) => {
  const w = await world(t);
  await createAll(w);
  const [device] = w.fake.devices;
  const feature = device.features.find((f) => f.external_id.endsWith(':blocking'));
  await w.fake.setValue(device, feature, 0);
  assert.deepEqual(w.server.requests.at(-1).body, { blocking: false, timer: null });
  assert.equal(events(w, TRIGGERS.PAUSED).at(-1).data.duration_minutes, 0);
});

test('a pause made in the Pi-hole interface is seen, and its automatic end', async (t) => {
  const w = await world(t);
  w.clock.advance(60_000);
  w.server.setBlocking(false, 300);
  await w.hub.pollAll();
  assert.deepEqual(events(w, TRIGGERS.PAUSED).at(-1).data, {
    device: deviceId(w.gladys),
    server: 'Pi-hole',
    origin: ORIGINS.PIHOLE,
    duration_minutes: 5,
  });
  assert.equal(w.fake.lastState(featureId(w.gladys, 'blocking')), 0);

  w.clock.advance(301_000);
  await w.hub.pollAll();
  assert.deepEqual(events(w, TRIGGERS.RESUMED).at(-1).data, {
    device: deviceId(w.gladys),
    server: 'Pi-hole',
    origin: ORIGINS.TIMER,
    paused_minutes: 5,
  });
  assert.equal(w.fake.lastState(featureId(w.gladys, 'blocking')), 1);
});

test('blocking turned back on outside Gladys before the end of the pause', async (t) => {
  const w = await world(t);
  w.server.setBlocking(false, 1800);
  await w.hub.pollAll();
  w.clock.advance(120_000);
  w.server.setBlocking(true);
  await w.hub.pollAll();
  assert.deepEqual(
    events(w, TRIGGERS.RESUMED).map((event) => [event.data.origin, event.data.paused_minutes]),
    [[ORIGINS.PIHOLE, 2]],
  );
});

test('a Pi-hole already paused at start fires nothing', async (t) => {
  const clock = createClock();
  const server = new FakePihole({ now: clock.now });
  server.setBlocking(false);
  const w = await world(t, { clock, servers: { [URL_1]: server } });
  assert.deepEqual(w.fake.sceneEvents, []);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'blocking')), 0);
  // Turned on later: paused for an unknown time.
  server.setBlocking(true);
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.RESUMED)[0].data.paused_minutes, 0);
});

test('a server that stops answering: down after two reads, once, then back', async (t) => {
  const w = await world(t);
  w.server.online = false;
  await w.hub.pollAll();
  assert.deepEqual(events(w, TRIGGERS.UNREACHABLE), [], 'one failure is a blip');
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /^Pi-hole : ne répond pas$/);

  w.clock.advance(15_000);
  await w.hub.pollAll();
  w.clock.advance(60_000);
  await w.hub.pollAll();
  assert.deepEqual(
    events(w, TRIGGERS.UNREACHABLE).map((event) => event.data),
    [{ device: deviceId(w.gladys), server: 'Pi-hole', error: 'does not answer' }],
  );

  w.server.online = true;
  await w.hub.pollAll();
  assert.deepEqual(
    events(w, TRIGGERS.RECOVERED).map((event) => event.data),
    [{ device: deviceId(w.gladys), server: 'Pi-hole', down_minutes: 1 }],
  );
  assert.equal(w.fake.transports.at(-1).transport, 'local');
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a refused password is reported, not counted as an outage', async (t) => {
  const w = await world(t, {
    config: { server_1_url: URL_1, server_1_password: 'wrong', language: 'de' },
  });
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(w.fake.connectionStatus.message.en, 'Pi-hole 192.0.2.10: password refused');
  assert.equal(w.fake.connectionStatus.message.de, 'Pi-hole 192.0.2.10: Passwort abgelehnt');
  // No state is invented for an unread server.
  assert.equal(w.fake.lastState(featureId(w.gladys, 'blocking')), undefined);
});

test('an update is announced once, across restarts, and again for a newer version', async (t) => {
  const clock = createClock();
  const server = new FakePihole({ now: clock.now, versions: 'version-updates' });
  const w = await world(t, { clock, servers: { [URL_1]: server } });
  assert.deepEqual(
    events(w, TRIGGERS.UPDATE).map((event) => event.data),
    [
      {
        device: deviceId(w.gladys),
        server: 'Pi-hole',
        count: 2,
        updates: 'Core v6.1.2, FTL v6.3',
      },
    ],
  );
  assert.equal(w.fake.lastState(featureId(w.gladys, 'updates_available')), 2);
  await w.hub.rediscover();
  assert.equal(events(w, TRIGGERS.UPDATE).length, 1);

  // A restart with the same /data: nothing new to announce.
  await w.app.stop();
  const again = await createWorld({ clock, servers: { [URL_1]: server }, dataDir: w.dataDir });
  t.after(() => again.app.stop());
  assert.equal(events(again, TRIGGERS.UPDATE).length, 0);

  // A newer release: announced.
  server.versions.version.ftl.remote.version = 'v6.4';
  await again.hub.rediscover();
  assert.equal(events(again, TRIGGERS.UPDATE).at(-1).data.updates, 'Core v6.1.2, FTL v6.4');

  // Updated, then a new update later: announced again.
  server.versions = structuredClone(
    (await import('./helpers/fakePihole.js')).fixture('version-current'),
  );
  await again.hub.rediscover();
  assert.equal(again.fake.lastState(featureId(again.gladys, 'updates_available')), 0);
  server.versions.version.core.remote.version = 'v6.1.2';
  server.versions.version.core.remote.hash = 'ffffffff';
  await again.hub.rediscover();
  assert.equal(events(again, TRIGGERS.UPDATE).at(-1).data.updates, 'Core v6.1.2');
});

test('the versions are read once an hour, and a failure there does not stop the poll', async (t) => {
  const w = await world(t);
  const versionReads = () =>
    w.server.requests.filter((request) => request.path === '/api/info/version').length;
  assert.equal(versionReads(), 1);
  await w.hub.pollAll();
  assert.equal(versionReads(), 1);
  w.clock.advance(60 * 60_000);
  await w.hub.pollAll();
  assert.equal(versionReads(), 2);

  const original = w.server.handle.bind(w.server);
  w.server.handle = (url, options) =>
    url.endsWith('/api/info/version')
      ? { status: 500, headers: {}, body: '' }
      : original(url, options);
  w.clock.advance(60 * 60_000);
  w.server.summary.clients.active = 11;
  await w.hub.pollAll();
  assert.equal(w.fake.lastState(featureId(w.gladys, 'active_clients_24h')), 11);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'updates_available')), 0, 'kept');
});

test('scene actions pause and resume every server, or one', async (t) => {
  const clock = createClock();
  const servers = {
    [URL_1]: new FakePihole({ now: clock.now }),
    [URL_2]: new FakePihole({ now: clock.now }),
  };
  const w = await world(t, { clock, servers, config: TWO_SERVERS });

  let ack = await w.fake.sceneAction('pause_blocking', { minutes: 10 });
  assert.deepEqual(ack.data.outputs, { servers: 2, minutes: 10 });
  for (const server of Object.values(servers)) {
    assert.deepEqual(server.requests.at(-1).body, { blocking: false, timer: 600 });
  }
  assert.deepEqual(
    events(w, TRIGGERS.PAUSED).map((event) => event.data.server),
    ['Primary', 'Secondary'],
  );

  ack = await w.fake.sceneAction('resume_blocking', { device: deviceId(w.gladys, 2) });
  assert.deepEqual(ack.data.outputs, { servers: 1 });
  assert.equal(servers[URL_2].blocking, true);
  assert.equal(servers[URL_1].blocking, false);

  // Defaults applied by Gladys, or a variable typed as text.
  ack = await w.fake.sceneAction('pause_blocking', {
    device: deviceId(w.gladys, 1),
    minutes: '2,5',
  });
  assert.deepEqual(ack.data.outputs, { servers: 1, minutes: 3 });
  ack = await w.fake.sceneAction('pause_blocking', { minutes: 0 });
  assert.deepEqual(ack.data.outputs, { servers: 2, minutes: 0 });
  assert.deepEqual(servers[URL_1].requests.at(-1).body, { blocking: false, timer: null });

  // One server down: the other one is paused, the action succeeds.
  servers[URL_2].online = false;
  ack = await w.fake.sceneAction('pause_blocking', {});
  assert.deepEqual(ack.data.outputs, { servers: 1, minutes: 5 });

  // All down: the action fails with a reason.
  servers[URL_1].online = false;
  ack = await w.fake.sceneAction('resume_blocking', {});
  assert.equal(ack.success, false);
  assert.equal(ack.error, 'No Pi-hole accepted the command.');
  ack = await w.fake.sceneAction('resume_blocking', { device: deviceId(w.gladys, 1) });
  assert.equal(ack.error, 'Primary: does not answer');

  // A device no longer configured.
  ack = await w.fake.sceneAction('resume_blocking', { device: deviceId(w.gladys, 3) });
  assert.equal(ack.error, 'This Pi-hole is no longer in the configuration.');
});

test('the scene action errors follow the configured language', async (t) => {
  const w = await world(t, { config: { language: 'fr' } });
  const ack = await w.fake.sceneAction('pause_blocking', {});
  assert.equal(ack.error, "Aucun Pi-hole n'est configuré.");
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /Saisissez l'adresse/);
});

test('reconfiguring keeps the session of an unchanged server and frees the others', async (t) => {
  const clock = createClock();
  const servers = {
    [URL_1]: new FakePihole({ now: clock.now }),
    [URL_2]: new FakePihole({ now: clock.now }),
  };
  const w = await world(t, { clock, servers, config: TWO_SERVERS });
  assert.equal(servers[URL_1].sessions.size, 1);
  assert.equal(servers[URL_2].sessions.size, 1);

  // Server 1 renamed (same session), server 2 removed (session deleted).
  await w.fake.configUpdated({ ...TWO_SERVERS, server_1_name: 'Main', server_2_url: '' });
  assert.equal(servers[URL_1].logins, 1);
  assert.equal(servers[URL_1].sessions.size, 1);
  assert.equal(servers[URL_2].sessions.size, 0);
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Main'],
  );

  // A new password: a new session, the old one deleted.
  servers[URL_1].password = 'changed';
  await w.fake.configUpdated({ ...TWO_SERVERS, server_1_password: 'changed', server_2_url: '' });
  assert.equal(servers[URL_1].logins, 2);
  assert.equal(servers[URL_1].sessions.size, 1);

  // Stopping deletes the last session.
  await w.app.stop();
  assert.equal(servers[URL_1].sessions.size, 0);
});

test('the features follow the configured language', async (t) => {
  const w = await world(t, {
    config: { server_1_url: URL_1, server_1_password: 'secret', language: 'es' },
  });
  const names = w.fake.discoveredDevices[0].features.map((feature) => feature.name);
  assert.equal(names[0], 'Bloqueo de anuncios');
});

test('a reconnection to Gladys sends everything again', async (t) => {
  const w = await world(t);
  const sent = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  assert.equal(w.fake.states.length - sent, 7);
  assert.equal(w.fake.connectionStatuses.length, 2);
});

test('Gladys polling a device reads that server', async (t) => {
  const w = await world(t);
  w.server.summary.queries.total = 8000;
  const ack = await w.fake.poll(w.fake.discoveredDevices[0]);
  assert.equal(ack.success, true);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'queries_24h')), 8000);
});

test('"Test the connection" reports each server in every language', async (t) => {
  const clock = createClock();
  const servers = {
    [URL_1]: new FakePihole({ now: clock.now, versions: 'version-updates' }),
    [URL_2]: new FakePihole({ now: clock.now, kind: 'v5' }),
  };
  const w = await world(t, {
    clock,
    servers,
    config: { ...TWO_SERVERS, server_3_url: 'http://' },
  });
  servers[URL_1].setBlocking(false, 240);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(
    ack.data.message.en,
    'Primary: OK, v6.1, paused, 4 min left, 2 update(s) available\n' +
      'Secondary: Pi-hole v5 is not supported: update to Pi-hole v6\n' +
      'Address not understood, e.g. http://192.168.1.2',
  );
  assert.match(ack.data.message.fr, /^Primary : OK, v6\.1, en pause, encore 4 min/);
});

test('pause durations typed in a scene', () => {
  assert.equal(parseMinutes(10), 10);
  assert.equal(parseMinutes('15'), 15);
  assert.equal(parseMinutes(' 2,5 '), 3);
  assert.equal(parseMinutes(0), 0);
  assert.equal(parseMinutes(99999), 1440);
  assert.equal(parseMinutes(-1), 5);
  assert.equal(parseMinutes('soon'), 5);
  assert.equal(parseMinutes(undefined), 5);
  assert.equal(parseMinutes(null, 30), 30);
});

test('the store survives a corrupt file', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'gladys-pihole-store-'));
  writeFileSync(join(dir, 'pihole-state.json'), '{not json');
  assert.deepEqual(await new Store(dir).load(), {});
});

test('a server removed while it is being read publishes nothing and keeps no session', async (t) => {
  const w = await world(t);
  const sent = w.fake.states.length;
  w.server.expireSessions();
  w.server.summary.queries.total = 9000;
  const reading = w.hub.pollAll();
  await w.fake.configUpdated({ server_1_url: '' });
  await reading;
  assert.equal(w.fake.states.length, sent);
  assert.equal(w.server.sessions.size, 0);
});
