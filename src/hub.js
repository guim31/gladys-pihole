// -----------------------------------------------------------------------------
// The Pi-hole hub: one record per configured server, read on a timer of the
// container (the interval chosen in the configuration), its states published
// to Gladys when they change, its scene events fired on transitions, and the
// blocking commands of the switch, the widget and the scene actions.
//
// Gladys never polls these devices (should_poll: false): the configurable
// interval goes up to 5 minutes, beyond the fixed list of the core scheduler,
// and the scene events must fire even for a server whose device was not added.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { buildDevice, deviceIds, featureValues, serverName, slotOf } from './devices.js';
import { ERROR_KINDS, PiholeClient } from './pihole/client.js';
import { describeUpdates, parseBlocking, parseSummary, parseVersions } from './pihole/model.js';
import { ACTION_TEXT, CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, labelled, pick } from './texts.js';

const logger = createLogger({ name: 'pihole-hub' });

export const WIDGET_KEY = 'pihole';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  PAUSED: 'blocking_paused',
  RESUMED: 'blocking_resumed',
  UPDATE: 'update_available',
  UNREACHABLE: 'server_unreachable',
  RECOVERED: 'server_recovered',
});

// Who changed the blocking state (`origin` filter and variable of the triggers).
export const ORIGINS = Object.freeze({
  GLADYS: 'gladys', // the switch, the widget or a scene action
  PIHOLE: 'pihole', // anything else: the Pi-hole interface, `pihole disable`, another tool
  TIMER: 'timer', // the end of a pause
});

export const HUB_TIMINGS = {
  // Versions change at most daily (the Pi-hole update checker runs once a day).
  versionsMs: 60 * 60_000,
  // A server that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before a server counts as down (scene event).
  downAfterFailures: 2,
  // A blocking change seen this long after a Gladys command is Gladys' own.
  ownChangeMs: 30_000,
  // Read again this long after a pause ends, to publish the resume promptly.
  pauseEndSlackMs: 2_000,
};

// Longest pause accepted from a scene or the widget: one day.
export const MAX_PAUSE_MINUTES = 1440;
export const DEFAULT_PAUSE_MINUTES = 5;
const MAX_STATES_PER_REQUEST = 100;

/** Minutes of a pause typed in a scene or a form: a number, or a string ("5", "2,5"). */
export function parseMinutes(raw, fallback = DEFAULT_PAUSE_MINUTES) {
  const number =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim().replace(',', '.'))
        : NaN;
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }
  return Math.min(MAX_PAUSE_MINUTES, Math.round(number));
}

const signature = (server, config) =>
  JSON.stringify([server.url, server.password, config.allowSelfSigned]);

export class PiholeHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/pihole/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** @type {Map<number, object>} server records, by slot */
    this.records = new Map();
    /** Last value published per feature external id. */
    this.published = new Map();
    this.transports = new Map();
    this.connection = null;
    this.saved = { announcedUpdates: {} };
    this.pollTimer = null;
    this.stopped = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      announcedUpdates:
        saved.announcedUpdates && typeof saved.announcedUpdates === 'object'
          ? saved.announcedUpdates
          : {},
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.transports.clear();
    this.connection = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    this.config = config;
    const wanted = new Map(config.servers.map((server) => [server.slot, server]));
    for (const [slot, record] of this.records) {
      const server = wanted.get(slot);
      if (!server || record.signature !== signature(server, config)) {
        this.dropRecord(record);
        this.records.delete(slot);
      }
    }
    for (const server of config.servers) {
      const record = this.records.get(server.slot);
      if (record) {
        record.server = server; // a new name: same session
      } else {
        this.records.set(server.slot, this.newRecord(server, config));
      }
    }
    await this.publishDevices();
    await this.pollAll({ versions: true });
    this.schedulePoll();
  }

  newRecord(server, config) {
    return {
      server,
      signature: signature(server, config),
      client: new PiholeClient({
        url: server.url,
        password: server.password,
        insecure: config.allowSelfSigned,
        request: this.request,
      }),
      snapshot: { reachable: null, blocking: null, timer: null, summary: null, versions: null },
      error: null,
      failures: 0,
      down: false,
      downSince: null,
      pausedAt: null,
      pauseEndsAt: null,
      ownChangeUntil: 0,
      versionsAt: 0,
      polling: null,
      retryTimer: null,
      pauseTimer: null,
    };
  }

  dropRecord(record) {
    clearTimeout(record.retryTimer);
    clearTimeout(record.pauseTimer);
    for (const { externalId } of featureValues(this.gladys, record.server.slot, {})) {
      this.published.delete(externalId);
    }
    record.client.logout().catch(() => {});
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await Promise.all(
      [...this.records.values()].map(async (record) => {
        clearTimeout(record.retryTimer);
        clearTimeout(record.pauseTimer);
        await record.client.logout();
      }),
    );
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || this.records.size === 0) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
      } catch (err) {
        logger.error('Poll failed', err);
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  // --- Devices -----------------------------------------------------------------

  async publishDevices() {
    const devices = [...this.records.values()].map((record) =>
      buildDevice(this.gladys, record.server, this.config.language),
    );
    // Even an empty list: the Discovery tab then shows no stale server.
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** "Search" in the Discovery tab: publish the devices again, read the servers. */
  async rediscover() {
    await this.publishDevices();
    await this.pollAll({ versions: true });
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const slot = slotOf(this.gladys, device.external_id);
    const record = slot === null ? null : this.records.get(slot);
    if (!record) {
      return;
    }
    await this.publishStates(record, { force: true });
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Reading the servers -------------------------------------------------------

  async pollAll({ versions = false } = {}) {
    const records = [...this.records.values()];
    const changes = await Promise.all(records.map((record) => this.poll(record, { versions })));
    await this.afterChanges(changes.some(Boolean));
  }

  /** Gladys asks for a refresh (onPoll): read that server now. */
  async pollDevice(device) {
    const slot = slotOf(this.gladys, device.external_id);
    const record = slot === null ? null : this.records.get(slot);
    if (record) {
      await this.afterChanges(await this.poll(record, { versions: false }));
    }
  }

  /**
   * Read one server and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll(record, { versions }) {
    record.polling ??= this.read(record, { versions }).finally(() => {
      record.polling = null;
    });
    return record.polling;
  }

  async read(record, { versions }) {
    const due = versions || this.now() - record.versionsAt >= this.timings.versionsMs;
    try {
      const [blocking, summary, versionInfo] = await Promise.all([
        record.client.getBlocking(),
        record.client.getSummary(),
        due ? record.client.getVersions().catch((err) => err) : null,
      ]);
      let versionsSnapshot = record.snapshot.versions;
      if (versionInfo && !(versionInfo instanceof Error)) {
        versionsSnapshot = parseVersions(versionInfo);
        record.versionsAt = this.now();
      } else if (versionInfo instanceof Error) {
        logger.warn(`${this.label(record)}: version check failed: ${versionInfo.message}`);
      }
      return await this.applySuccess(record, {
        ...parseBlocking(blocking),
        summary: parseSummary(summary),
        versions: versionsSnapshot,
      });
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.applyFailure(record, err);
    }
  }

  label(record) {
    return `Pi-hole ${record.server.slot} (${serverName(record.server)})`;
  }

  async applySuccess(record, next, { origin } = {}) {
    let widgetChanged = record.snapshot.reachable !== true || record.error !== null;
    if (record.down) {
      const downMinutes = Math.round((this.now() - record.downSince) / 60_000);
      logger.info(`${this.label(record)} answers again after ${downMinutes} min`);
      await this.fire(TRIGGERS.RECOVERED, record, { down_minutes: downMinutes });
    }
    record.failures = 0;
    record.down = false;
    record.downSince = null;
    record.error = null;

    const previous = record.snapshot;
    widgetChanged ||= previous.blocking !== next.blocking;
    await this.blockingTransition(record, previous, next, origin);
    await this.updateTransition(record, previous.versions, next.versions);
    widgetChanged ||=
      (previous.versions?.updates.length ?? 0) !== (next.versions?.updates.length ?? 0);

    record.snapshot = { reachable: true, ...next };
    this.schedulePauseEnd(record);
    await this.publishStates(record);
    return widgetChanged;
  }

  async applyFailure(record, err) {
    const wasError = record.error?.kind;
    record.error = { kind: err.kind, message: err.message };
    record.snapshot = { ...record.snapshot, reachable: false };
    if (wasError !== err.kind) {
      logger.warn(`${this.label(record)}: ${err.message}`);
    }
    // Only silence counts as down: a refused password is a configuration
    // problem, reported by the connection status.
    if (err.kind !== ERROR_KINDS.UNREACHABLE) {
      record.failures = 0;
      return wasError !== err.kind;
    }
    record.failures += 1;
    if (record.failures === 1) {
      record.downSince = this.now();
      this.scheduleRetry(record);
    }
    if (!record.down && record.failures >= this.timings.downAfterFailures) {
      record.down = true;
      await this.fire(TRIGGERS.UNREACHABLE, record, {
        error: pick(ERROR_TEXT[err.kind], this.config.language),
      });
    }
    return wasError !== err.kind;
  }

  scheduleRetry(record) {
    clearTimeout(record.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.retryTimer = setTimeout(() => {
      this.poll(record, { versions: false })
        .then((changed) => this.afterChanges(changed))
        .catch((err) => logger.error('Retry failed', err));
    }, this.timings.retryMs);
    record.retryTimer.unref?.();
  }

  /** A pause ends on its own: read the server right after, not at the next interval. */
  schedulePauseEnd(record) {
    clearTimeout(record.pauseTimer);
    const { blocking, timer } = record.snapshot;
    if (!this.timersEnabled || this.stopped || blocking !== 'disabled' || !timer) {
      return;
    }
    const delay = timer * 1000 + this.timings.pauseEndSlackMs;
    if (delay >= this.config.pollIntervalMs) {
      return; // the regular poll comes first
    }
    record.pauseTimer = setTimeout(() => {
      this.poll(record, { versions: false })
        .then((changed) => this.afterChanges(changed))
        .catch((err) => logger.error('Pause end check failed', err));
    }, delay);
    record.pauseTimer.unref?.();
  }

  async blockingTransition(record, previous, next, origin) {
    const now = this.now();
    if (next.blocking === 'disabled') {
      record.pauseEndsAt = next.timer ? now + next.timer * 1000 : null;
    }
    const before = previous.blocking;
    if (!['enabled', 'disabled'].includes(before) || before === next.blocking) {
      return;
    }
    const own = origin === ORIGINS.GLADYS || now < record.ownChangeUntil;
    if (next.blocking === 'disabled') {
      record.pausedAt = now;
      await this.fire(TRIGGERS.PAUSED, record, {
        origin: own ? ORIGINS.GLADYS : ORIGINS.PIHOLE,
        duration_minutes: next.timer ? Math.ceil(next.timer / 60) : 0,
      });
    } else if (next.blocking === 'enabled') {
      const timerEnded =
        record.pauseEndsAt !== null && now >= record.pauseEndsAt - this.timings.pauseEndSlackMs;
      await this.fire(TRIGGERS.RESUMED, record, {
        origin: own ? ORIGINS.GLADYS : timerEnded ? ORIGINS.TIMER : ORIGINS.PIHOLE,
        paused_minutes: record.pausedAt === null ? 0 : Math.round((now - record.pausedAt) / 60_000),
      });
      record.pausedAt = null;
      record.pauseEndsAt = null;
    }
  }

  /** Announce each new set of available updates once, across restarts. */
  async updateTransition(record, previous, next) {
    if (!next) {
      return;
    }
    const slot = String(record.server.slot);
    const announced = this.saved.announcedUpdates;
    if (next.updates.length === 0) {
      if (announced[slot]) {
        delete announced[slot];
        this.store.save(this.saved);
      }
      return;
    }
    const key = describeUpdates(next.updates);
    if (announced[slot] === key) {
      return;
    }
    announced[slot] = key;
    this.store.save(this.saved);
    logger.info(`${this.label(record)}: update available (${key})`);
    await this.fire(TRIGGERS.UPDATE, record, { count: next.updates.length, updates: key });
  }

  async fire(key, record, data) {
    try {
      await this.gladys.publishSceneEvent(key, {
        device: deviceIds(this.gladys, record.server.slot).device,
        server: serverName(record.server),
        ...data,
      });
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  async publishStates(record, { force = false } = {}) {
    const states = [];
    for (const { externalId, value } of featureValues(
      this.gladys,
      record.server.slot,
      record.snapshot,
    )) {
      if (value === null || (!force && this.published.get(externalId) === value)) {
        continue;
      }
      states.push({ device_feature_external_id: externalId, state: value });
    }
    for (let at = 0; at < states.length; at += MAX_STATES_PER_REQUEST) {
      const batch = states.slice(at, at + MAX_STATES_PER_REQUEST);
      try {
        await this.gladys.publishStates(batch);
        for (const state of batch) {
          this.published.set(state.device_feature_external_id, state.state);
        }
      } catch (err) {
        logger.warn(`States of ${this.label(record)} refused: ${err.message}`);
      }
    }
  }

  async afterChanges(widgetChanged) {
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async publishTransports() {
    const entries = [];
    for (const record of this.records.values()) {
      if (record.snapshot.reachable === null) {
        continue;
      }
      const externalId = deviceIds(this.gladys, record.server.slot).device;
      const transport = record.snapshot.reachable
        ? DEVICE_TRANSPORTS.LOCAL
        : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
    } catch (err) {
      logger.warn(`Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name: connected when every server answers. */
  connectionStatus() {
    const { servers, invalidSlots } = this.config;
    if (servers.length === 0) {
      return {
        connected: false,
        message: invalidSlots.length ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noServer,
      };
    }
    const failing = [...this.records.values()].filter((record) => record.error);
    if (failing.length === 0 && invalidSlots.length === 0) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noServer)) {
      const parts = failing.map((record) =>
        labelled(
          serverName(record.server),
          pick(ERROR_TEXT[record.error.kind], language),
          language,
        ),
      );
      if (invalidSlots.length) {
        parts.push(pick(CONNECTION_TEXT.invalidUrl, language));
      }
      message[language] = parts.join(' · ').slice(0, 200);
    }
    // Connected while one server of several still answers.
    return { connected: failing.length < this.records.size, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
    } catch (err) {
      logger.warn(`Connection status refused: ${err.message}`);
    }
  }

  // --- Commands --------------------------------------------------------------------------

  /**
   * The servers a command targets: one device, or every configured server.
   * @param {string|null|undefined} deviceExternalId
   */
  targets(deviceExternalId) {
    if (this.records.size === 0) {
      throw new Error(pick(ACTION_TEXT.noServer, this.config?.language));
    }
    if (!deviceExternalId) {
      return [...this.records.values()];
    }
    const slot = slotOf(this.gladys, deviceExternalId);
    const record = slot === null ? null : this.records.get(slot);
    if (!record) {
      throw new Error(pick(ACTION_TEXT.unknownServer, this.config.language));
    }
    return [record];
  }

  /**
   * Pause the blocking (`minutes` 0: until resumed) or resume it, on the
   * targeted servers. Resolves with the number of servers that accepted.
   */
  async setBlocking(deviceExternalId, enabled, minutes = 0) {
    const records = this.targets(deviceExternalId);
    const seconds = enabled ? null : minutes > 0 ? minutes * 60 : null;
    const results = await Promise.all(
      records.map(async (record) => {
        try {
          const answer = await record.client.setBlocking(enabled, seconds);
          record.ownChangeUntil = this.now() + this.timings.ownChangeMs;
          // The answer carries the new state: publish it without waiting.
          const { reachable: _reachable, ...known } = record.snapshot;
          await this.applySuccess(
            record,
            { ...known, ...parseBlocking(answer) },
            { origin: ORIGINS.GLADYS },
          );
          logger.info(
            `${this.label(record)}: blocking ${enabled ? 'resumed' : minutes ? `paused for ${minutes} min` : 'disabled'}`,
          );
          return true;
        } catch (err) {
          if (!err.kind) {
            throw err;
          }
          logger.warn(`${this.label(record)}: command failed: ${err.message}`);
          await this.applyFailure(record, err);
          return false;
        }
      }),
    );
    await this.afterChanges(true);
    const done = results.filter(Boolean).length;
    if (done === 0) {
      const [record] = records;
      throw new Error(
        records.length === 1 && record.error
          ? labelled(
              serverName(record.server),
              pick(ERROR_TEXT[record.error.kind], this.config.language),
              this.config.language,
            )
          : pick(ACTION_TEXT.failed, this.config.language),
      );
    }
    return done;
  }

  pause(deviceExternalId, minutes) {
    return this.setBlocking(deviceExternalId, false, minutes);
  }

  resume(deviceExternalId) {
    return this.setBlocking(deviceExternalId, true);
  }

  /** The blocking switch of a device. */
  async setValue(device, feature, value) {
    const slot = slotOf(this.gladys, device.external_id);
    if (slot === null || feature.external_id !== deviceIds(this.gladys, slot).feature('blocking')) {
      throw new Error(`Feature ${feature.external_id} cannot be controlled`);
    }
    if (Number(value) === 1) {
      await this.resume(device.external_id);
    } else {
      await this.pause(device.external_id, this.config.switchOffMinutes);
    }
  }

  // --- Reports -------------------------------------------------------------------------------

  /** "Test the connection": read every server now, one line each. */
  async testConnection() {
    await this.pollAll({ versions: true });
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (this.records.size === 0) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      const lines = [...this.records.values()].map((record) => {
        const name = serverName(record.server);
        if (record.error) {
          return labelled(name, pick(ERROR_TEXT[record.error.kind], language), language);
        }
        const { blocking, timer, versions } = record.snapshot;
        const parts = [text.ok];
        if (versions?.version) {
          parts.push(versions.version);
        }
        parts.push(
          blocking === 'enabled' ? text.on : timer ? text.paused(Math.ceil(timer / 60)) : text.off,
        );
        if (versions?.updates.length) {
          parts.push(text.updates(versions.updates.length));
        }
        return labelled(name, parts.join(', '), language);
      });
      // Addresses that could not be read are not records: say it too.
      if (this.config.invalidSlots.length) {
        lines.push(pick(CONNECTION_TEXT.invalidUrl, language));
      }
      message[language] = lines.join('\n');
    }
    return message;
  }

  /** What the widget shows, for one server or all of them. */
  view(deviceExternalId) {
    if (!deviceExternalId) {
      return [...this.records.values()];
    }
    const slot = slotOf(this.gladys, deviceExternalId);
    const record = slot === null ? null : this.records.get(slot);
    return record ? [record] : [];
  }
}
