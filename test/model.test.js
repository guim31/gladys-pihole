// -----------------------------------------------------------------------------
// Reading the Pi-hole v6 answers (examples of the FTL OpenAPI specification).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions,
  describeUpdates,
  parseBlocking,
  parseSummary,
  parseVersions,
} from '../src/pihole/model.js';
import { fixture } from './helpers/fakePihole.js';

test('blocking state and pause timer', () => {
  assert.deepEqual(parseBlocking(fixture('blocking-enabled')), {
    blocking: 'enabled',
    timer: null,
  });
  assert.deepEqual(parseBlocking(fixture('blocking-paused')), {
    blocking: 'disabled',
    timer: 287.4,
  });
  assert.deepEqual(parseBlocking(fixture('blocking-disabled')), {
    blocking: 'disabled',
    timer: null,
  });
  assert.deepEqual(parseBlocking({ blocking: 'failed' }), { blocking: 'failed', timer: null });
  assert.deepEqual(parseBlocking({}), { blocking: 'unknown', timer: null });
  assert.deepEqual(parseBlocking({ blocking: 'disabled', timer: 0 }), {
    blocking: 'disabled',
    timer: null,
  });
});

test('summary of the last 24 hours', () => {
  assert.deepEqual(parseSummary(fixture('stats-summary')), {
    queries: 7497,
    blocked: 3465,
    percentBlocked: 46.218487,
    domainsBlocked: 104756,
    activeClients: 10,
    gravityUpdatedAt: 1725194639,
  });
});

test('summary without a percentage, or empty', () => {
  const summary = parseSummary({ queries: { total: 200, blocked: 50 } });
  assert.equal(summary.percentBlocked, 25);
  assert.equal(summary.domainsBlocked, null);
  const empty = parseSummary({});
  assert.equal(empty.queries, null);
  assert.equal(empty.percentBlocked, null);
  assert.equal(parseSummary({ queries: { total: 0, blocked: 0 } }).percentBlocked, null);
  // A count is never negative nor decimal.
  assert.equal(parseSummary({ queries: { total: -3.4 } }).queries, 0);
});

test('version comparison', () => {
  assert.equal(compareVersions('v6.1', 'v6.1.2'), -1);
  assert.equal(compareVersions('v6.10', 'v6.9'), 1);
  assert.equal(compareVersions('v6.1.0', 'v6.1'), 0);
  assert.equal(compareVersions('2025.08.0', '2025.10.1'), -1);
  assert.equal(compareVersions('6.2', 'v6.2'), 0);
});

test('no update when every component is current', () => {
  assert.deepEqual(parseVersions(fixture('version-current')), {
    version: 'v6.1',
    docker: false,
    updates: [],
  });
});

test('updates of the components on the master branch', () => {
  const { updates } = parseVersions(fixture('version-updates'));
  assert.deepEqual(updates, [
    { key: 'core', name: 'Core', local: 'v6.1', remote: 'v6.1.2' },
    { key: 'ftl', name: 'FTL', local: 'v6.2', remote: 'v6.3' },
  ]);
  assert.equal(describeUpdates(updates), 'Core v6.1.2, FTL v6.3');
});

test('in Docker, only the image tag counts', () => {
  const versions = parseVersions(fixture('version-docker'));
  assert.equal(versions.docker, true);
  assert.deepEqual(versions.updates, [
    { key: 'docker', name: 'Docker', local: '2025.08.0', remote: '2025.10.1' },
  ]);
});

test('on a development branch, a different commit is an update', () => {
  const { updates } = parseVersions(fixture('version-dev-branch'));
  assert.deepEqual(
    updates.map((update) => update.key),
    ['ftl', 'web'],
  );
});

test('unknown latest versions are no update', () => {
  const data = fixture('version-updates');
  data.version.core.remote.version = null;
  data.version.ftl.remote = null;
  assert.deepEqual(parseVersions(data).updates, []);
  assert.deepEqual(parseVersions({}), { version: null, docker: false, updates: [] });
});

test('answers of a real Pi-hole 6.4 (Docker)', () => {
  const versions = parseVersions(fixture('real/version-docker'));
  assert.deepEqual(versions, { version: 'v6.4.3', docker: true, updates: [] });
  assert.deepEqual(parseBlocking(fixture('real/blocking-paused')), {
    blocking: 'disabled',
    timer: 56.99999999999996,
  });
  const summary = parseSummary(fixture('real/stats-summary-empty'));
  assert.equal(summary.queries, 0);
  assert.equal(summary.percentBlocked, 0);
  assert.equal(summary.domainsBlocked, 72526);
  assert.equal(fixture('real/auth-login').session.validity, 1800);
  assert.equal(fixture('real/auth-wrong-password').session.valid, false);
});
