// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake Pi-hole servers on a fake
// network, a temporary /data and a manual clock, with the integration wired
// on top through registerHandlers. No timer runs: the tests read the servers
// with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakePihole, createNetwork } from './fakePihole.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const URL_1 = 'http://192.0.2.10';
export const URL_2 = 'https://198.51.100.20';

/** A manual clock, shared by the hub and the fake servers. */
export function createClock(start = Date.UTC(2026, 9, 12, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {Record<string, FakePihole>} [options.servers] by base URL
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  clock = createClock(),
  servers,
  config = { server_1_url: URL_1, server_1_password: 'secret', server_1_name: 'Pi-hole' },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-pihole-')),
  timings = {},
} = {}) {
  const network = createNetwork(servers ?? { [URL_1]: new FakePihole({ now: clock.now }) });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers: false,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, network, app, hub: app.hub, clock, dataDir };
}

/** External id of the device of a configuration slot. */
export const deviceId = (gladys, slot = 1) => gladys.externalIds('pihole', String(slot)).device;
export const featureId = (gladys, key, slot = 1) =>
  gladys.externalIds('pihole', String(slot)).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { FakePihole };
