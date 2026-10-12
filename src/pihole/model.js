// -----------------------------------------------------------------------------
// Reading the Pi-hole v6 answers into the plain values the integration uses.
// Pure functions, tested against the examples of the FTL OpenAPI
// specification (test/fixtures/pihole/).
// -----------------------------------------------------------------------------

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const count = (value) => {
  const number = finite(value);
  return number === null ? null : Math.max(0, Math.round(number));
};

/**
 * GET /api/dns/blocking → `{ blocking, timer }`.
 * `blocking` is 'enabled', 'disabled', 'failed' or 'unknown'; `timer` the
 * seconds left before the opposite state comes back, null when permanent.
 */
export function parseBlocking(data) {
  const blocking = ['enabled', 'disabled', 'failed', 'unknown'].includes(data?.blocking)
    ? data.blocking
    : 'unknown';
  const timer = finite(data?.timer);
  return { blocking, timer: timer !== null && timer > 0 ? timer : null };
}

/**
 * GET /api/stats/summary. The counters cover the queries FTL keeps in memory:
 * the last 24 hours (a rolling window, not the calendar day).
 */
export function parseSummary(data) {
  const total = count(data?.queries?.total);
  const blocked = count(data?.queries?.blocked);
  const percent = finite(data?.queries?.percent_blocked);
  return {
    queries: total,
    blocked,
    percentBlocked:
      percent !== null
        ? Math.min(100, Math.max(0, percent))
        : total
          ? (100 * (blocked ?? 0)) / total
          : null,
    domainsBlocked: count(data?.gravity?.domains_being_blocked),
    activeClients: count(data?.clients?.active),
    gravityUpdatedAt: finite(data?.gravity?.last_update) || null,
  };
}

/**
 * Compare two versions such as `v6.1.2`, `6.2` or the Docker tag `2025.10.1`:
 * -1, 0 or 1. A part that is not a number (a suffix) counts as 0.
 */
export function compareVersions(a, b) {
  const parts = (version) =>
    String(version)
      .replace(/^v/i, '')
      .split(/[.-]/)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : 0));
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) {
      return difference > 0 ? 1 : -1;
    }
  }
  return 0;
}

const COMPONENTS = [
  { key: 'core', name: 'Core' },
  { key: 'ftl', name: 'FTL' },
  { key: 'web', name: 'Web' },
];

/**
 * GET /api/info/version → the installed version and the available updates,
 * following the rules of the Pi-hole web interface footer:
 * - in Docker, only the image tag counts (components are updated by pulling
 *   a new image);
 * - on the `master` branch, a component is behind when its version is lower
 *   than the latest release;
 * - on another branch (beta testers), when its commit differs from the
 *   branch head;
 * - an unknown latest version (no check yet, custom branch) is no update.
 * @returns {{ version: string|null, docker: boolean, updates: Array<{ key: string, name: string, local: string, remote: string }> }}
 */
export function parseVersions(data) {
  const info = data?.version ?? {};
  const docker = typeof info.docker?.local === 'string' && info.docker.local !== '';
  const updates = [];
  if (docker) {
    const { local, remote } = info.docker;
    if (typeof remote === 'string' && remote && compareVersions(local, remote) < 0) {
      updates.push({ key: 'docker', name: 'Docker', local, remote });
    }
  } else {
    for (const { key, name } of COMPONENTS) {
      const local = info[key]?.local;
      const remote = info[key]?.remote;
      if (!local || typeof local.version !== 'string' || !remote) {
        continue;
      }
      const behind =
        local.branch === 'master'
          ? typeof remote.version === 'string' &&
            remote.version !== '' &&
            compareVersions(local.version, remote.version) < 0
          : typeof remote.hash === 'string' &&
            remote.hash !== '' &&
            typeof local.hash === 'string' &&
            local.hash !== remote.hash;
      if (behind) {
        updates.push({
          key,
          name,
          local: local.version,
          remote: local.branch === 'master' ? remote.version : remote.hash,
        });
      }
    }
  }
  const core = info.core?.local?.version;
  return {
    version: typeof core === 'string' && core ? core : null,
    docker,
    updates,
  };
}

/** "Core v6.1.2, FTL v6.3": what an update list reads like. */
export const describeUpdates = (updates) =>
  updates.map(({ name, remote }) => `${name} ${remote}`).join(', ');
