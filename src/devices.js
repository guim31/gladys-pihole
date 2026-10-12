// -----------------------------------------------------------------------------
// One Gladys device per Pi-hole server.
//
// Identity: the configuration slot (1 to 3), not the address: switching a
// slot from an IP to a host name, or from HTTP to HTTPS, keeps the device and
// its history. Pi-hole exposes no stable instance id to use instead.
//
// Features (category/type couples of the core table, see
// test/gladys-rules.test.js):
//   - blocking: switch/binary, writable — 1 blocking on, 0 off (a pause of
//     the configured length, or until turned back on);
//   - queries, blocked queries, blocked share, active clients: the rolling
//     24 hours FTL keeps in memory, counter-sensor/integer (the share is
//     rounded: Gladys has no decimal percentage sensor; the widget shows the
//     decimal);
//   - domains on the blocklists: counter-sensor/integer;
//   - updates available: counter-sensor/integer, the number of Pi-hole
//     components behind their latest release (Gladys has no yes/no "update"
//     couple; a count reads well and a scene can test "> 0").
//
// The devices are published with should_poll: false: the integration reads
// the servers on its own timer (src/hub.js), at the interval chosen in the
// configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { hostOf } from './config.js';

export const DEVICE_TYPE = 'pihole';
export const URL_PARAM = 'PIHOLE_URL';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  BLOCKING: 'blocking',
  QUERIES: 'queries_24h',
  BLOCKED: 'blocked_24h',
  BLOCKED_PERCENT: 'blocked_percent_24h',
  CLIENTS: 'active_clients_24h',
  DOMAINS: 'blocklist_domains',
  UPDATES: 'updates_available',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.BLOCKING]: 'Ad blocking',
    [FEATURE_KEYS.QUERIES]: 'DNS queries (24 h)',
    [FEATURE_KEYS.BLOCKED]: 'Blocked queries (24 h)',
    [FEATURE_KEYS.BLOCKED_PERCENT]: 'Share blocked (24 h)',
    [FEATURE_KEYS.CLIENTS]: 'Active clients (24 h)',
    [FEATURE_KEYS.DOMAINS]: 'Domains on blocklists',
    [FEATURE_KEYS.UPDATES]: 'Updates available',
  },
  fr: {
    [FEATURE_KEYS.BLOCKING]: 'Blocage des publicités',
    [FEATURE_KEYS.QUERIES]: 'Requêtes DNS (24 h)',
    [FEATURE_KEYS.BLOCKED]: 'Requêtes bloquées (24 h)',
    [FEATURE_KEYS.BLOCKED_PERCENT]: 'Part bloquée (24 h)',
    [FEATURE_KEYS.CLIENTS]: 'Clients actifs (24 h)',
    [FEATURE_KEYS.DOMAINS]: 'Domaines en liste de blocage',
    [FEATURE_KEYS.UPDATES]: 'Mises à jour disponibles',
  },
  de: {
    [FEATURE_KEYS.BLOCKING]: 'Werbeblocker',
    [FEATURE_KEYS.QUERIES]: 'DNS-Anfragen (24 h)',
    [FEATURE_KEYS.BLOCKED]: 'Blockierte Anfragen (24 h)',
    [FEATURE_KEYS.BLOCKED_PERCENT]: 'Anteil blockiert (24 h)',
    [FEATURE_KEYS.CLIENTS]: 'Aktive Clients (24 h)',
    [FEATURE_KEYS.DOMAINS]: 'Domains auf Sperrlisten',
    [FEATURE_KEYS.UPDATES]: 'Verfügbare Updates',
  },
  es: {
    [FEATURE_KEYS.BLOCKING]: 'Bloqueo de anuncios',
    [FEATURE_KEYS.QUERIES]: 'Consultas DNS (24 h)',
    [FEATURE_KEYS.BLOCKED]: 'Consultas bloqueadas (24 h)',
    [FEATURE_KEYS.BLOCKED_PERCENT]: 'Proporción bloqueada (24 h)',
    [FEATURE_KEYS.CLIENTS]: 'Clientes activos (24 h)',
    [FEATURE_KEYS.DOMAINS]: 'Dominios en listas de bloqueo',
    [FEATURE_KEYS.UPDATES]: 'Actualizaciones disponibles',
  },
};

// Display bounds (the core never applies them on write).
const COUNTER_MAX = 1_000_000_000;

const counter = (key, value, extra = {}) => ({
  key,
  definition: {
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: COUNTER_MAX,
    ...extra,
  },
  value,
});

// Order = display order in Gladys.
const FEATURES = [
  {
    key: FEATURE_KEYS.BLOCKING,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      min: 0,
      max: 1,
    },
    // 'failed' and 'unknown' (FTL starting) publish nothing.
    value: (snapshot) =>
      snapshot.blocking === 'enabled' ? 1 : snapshot.blocking === 'disabled' ? 0 : null,
  },
  counter(FEATURE_KEYS.QUERIES, (snapshot) => snapshot.summary?.queries ?? null),
  counter(FEATURE_KEYS.BLOCKED, (snapshot) => snapshot.summary?.blocked ?? null),
  counter(
    FEATURE_KEYS.BLOCKED_PERCENT,
    (snapshot) => {
      const percent = snapshot.summary?.percentBlocked;
      return typeof percent === 'number' ? Math.round(percent) : null;
    },
    { unit: DEVICE_FEATURE_UNITS.PERCENT, max: 100 },
  ),
  counter(FEATURE_KEYS.CLIENTS, (snapshot) => snapshot.summary?.activeClients ?? null),
  counter(FEATURE_KEYS.DOMAINS, (snapshot) => snapshot.summary?.domainsBlocked ?? null),
  counter(
    FEATURE_KEYS.UPDATES,
    (snapshot) => (snapshot.versions ? snapshot.versions.updates.length : null),
    // Core, FTL and web interface; or the Docker image.
    { max: 3 },
  ),
];

/** External ids of a server's device and features. */
export const deviceIds = (gladys, slot) => gladys.externalIds(DEVICE_TYPE, String(slot));

/** The slot of a device external id, null when it is not one of ours. */
export function slotOf(gladys, externalId) {
  for (const slot of [1, 2, 3]) {
    if (deviceIds(gladys, slot).device === externalId) {
      return slot;
    }
  }
  return null;
}

/** The name shown for a server: the one typed in the configuration, else its address. */
export const serverName = (server) => server.name ?? `Pi-hole ${hostOf(server.url)}`;

/**
 * The discovery payload of a server.
 * @param {object} gladys SDK client
 * @param {{ slot: number, url: string, name: string|null }} server
 * @param {string} language feature names language
 */
export function buildDevice(gladys, server, language = 'en') {
  const ids = deviceIds(gladys, server.slot);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: serverName(server),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: URL_PARAM, value: server.url }],
    features: FEATURES.map(({ key, definition }) => ({
      ...definition,
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The value of every feature for a server snapshot (null: nothing to publish).
 * @returns {Array<{ key: string, externalId: string, value: number|null }>}
 */
export function featureValues(gladys, slot, snapshot) {
  const ids = deviceIds(gladys, slot);
  return FEATURES.map(({ key, value }) => ({
    key,
    externalId: ids.feature(key),
    value: value(snapshot),
  }));
}
