// -----------------------------------------------------------------------------
// In-memory Pi-hole v6 servers behind the `request` seam of the client
// (src/pihole/http.js). Answers are built from the examples of the FTL
// OpenAPI specification (test/fixtures/pihole/), with the behaviors that
// matter: password and sessions (sid, 401 when expired, seat limit), the
// blocking state with its timer, a v5 server, a server that does not answer.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/pihole/${name}.json`, import.meta.url), 'utf8'));

const json = (status, body) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

let sessionCounter = 0;

export class FakePihole {
  /**
   * @param {object} [options]
   * @param {string} [options.password] '' for a Pi-hole without password
   * @param {boolean} [options.totp] two-factor authentication on (the web password then needs a code)
   * @param {string} [options.appPassword] accepted without code
   * @param {string} [options.versions] fixture name of /api/info/version
   * @param {'v6'|'v5'|'other'} [options.kind]
   * @param {number} [options.maxSessions]
   * @param {() => number} [options.now] clock for the blocking timer
   */
  constructor({
    password = 'secret',
    totp = false,
    appPassword = null,
    versions = 'version-current',
    kind = 'v6',
    maxSessions = 16,
    now = () => Date.now(),
  } = {}) {
    this.password = password;
    this.totp = totp;
    this.appPassword = appPassword;
    this.kind = kind;
    this.maxSessions = maxSessions;
    this.now = now;
    this.sessions = new Set();
    this.online = true;
    this.summary = fixture('stats-summary');
    this.versions = fixture(versions);
    this.blocking = true;
    this.timerEnd = null; // blocking flips back at this instant
    this.requests = [];
    this.logins = 0;
    this.failNext = null; // e.g. 500
  }

  /** Blocking changed from elsewhere (the Pi-hole interface). */
  setBlocking(enabled, seconds = null) {
    this.blocking = enabled;
    this.timerEnd = seconds ? this.now() + seconds * 1000 : null;
  }

  expireSessions() {
    this.sessions.clear();
  }

  currentBlocking() {
    if (this.timerEnd !== null && this.now() >= this.timerEnd) {
      this.blocking = !this.blocking;
      this.timerEnd = null;
    }
    return {
      blocking: this.blocking ? 'enabled' : 'disabled',
      timer: this.timerEnd === null ? null : Math.round((this.timerEnd - this.now()) / 100) / 10,
      took: 0.001,
    };
  }

  authorized(headers) {
    return !this.password || this.sessions.has(headers['X-FTL-SID']);
  }

  /** The `request` function given to the client. */
  handle(url, { method = 'GET', headers = {}, json: body, insecure } = {}) {
    const { pathname, search } = new URL(url);
    this.requests.push({ method, path: pathname + search, body, insecure });
    if (!this.online) {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    if (this.failNext) {
      const status = this.failNext;
      this.failNext = null;
      return { status, headers: {}, body: '' };
    }
    if (this.kind === 'v5') {
      if (pathname === '/admin/api.php' && search === '?version') {
        return json(200, { version: 3 });
      }
      return { status: 404, headers: { 'content-type': 'text/html' }, body: '<h1>404</h1>' };
    }
    if (this.kind === 'other') {
      return { status: 404, headers: { 'content-type': 'text/html' }, body: 'Not Found' };
    }

    if (pathname === '/api/auth') {
      return this.auth(method, headers, body);
    }
    if (!this.authorized(headers)) {
      return json(401, fixture('unauthorized'));
    }
    if (pathname === '/api/stats/summary' && method === 'GET') {
      return json(200, this.summary);
    }
    if (pathname === '/api/info/version' && method === 'GET') {
      return json(200, this.versions);
    }
    if (pathname === '/api/dns/blocking') {
      if (method === 'POST') {
        if (typeof body?.blocking !== 'boolean') {
          return json(400, {
            error: { key: 'body_error', message: 'No "blocking" boolean in body data', hint: null },
          });
        }
        this.setBlocking(body.blocking, body.timer ?? null);
      }
      return json(200, this.currentBlocking());
    }
    return json(404, { error: { key: 'not_found', message: 'Not found', hint: null } });
  }

  auth(method, headers, body) {
    if (method === 'DELETE') {
      const sid = headers['X-FTL-SID'];
      if (!this.sessions.has(sid)) {
        return json(404, { took: 0.001 });
      }
      this.sessions.delete(sid);
      return { status: 204, headers: {}, body: '' };
    }
    if (method !== 'POST') {
      return json(200, fixture('auth-no-password'));
    }
    this.logins += 1;
    if (!this.password) {
      return json(200, fixture('auth-no-password'));
    }
    const typed = body?.password;
    const isApp = this.appPassword !== null && typed === this.appPassword;
    if (!isApp && typed !== this.password) {
      return json(401, fixture('auth-wrong-password'));
    }
    if (!isApp && this.totp) {
      return json(400, fixture('auth-totp-missing'));
    }
    if (this.sessions.size >= this.maxSessions) {
      return json(429, fixture('auth-no-seats'));
    }
    sessionCounter += 1;
    const sid = `sid-${sessionCounter}`;
    this.sessions.add(sid);
    const answer = fixture('auth-login');
    answer.session.sid = sid;
    return json(200, answer);
  }
}

/**
 * A network of fake servers, by base URL: the `request` seam of the hub.
 * An address without a server does not answer.
 */
export function createNetwork(servers = {}) {
  const byOrigin = new Map(Object.entries(servers));
  return {
    servers: byOrigin,
    async request(url, options) {
      const server = byOrigin.get(new URL(url).origin);
      if (!server) {
        const error = new Error('connect EHOSTUNREACH');
        error.code = 'EHOSTUNREACH';
        throw error;
      }
      return server.handle(url, options);
    },
  };
}
