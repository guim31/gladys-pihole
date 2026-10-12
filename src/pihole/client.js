// -----------------------------------------------------------------------------
// Pi-hole v6 REST API client (the API FTL serves under /api since Pi-hole 6.0,
// documented by each server on /api/docs).
//
// Authentication: POST /api/auth with the web interface password or, better,
// an application password (Settings → Web interface / API), answers a session
// id (`sid`) sent back in the X-FTL-SID header. A session lasts 30 minutes by
// default and each request extends it; the number of sessions is limited
// (`webserver.api.max_sessions`, 16 by default), so the client keeps ONE
// session per server, logs in again only on a 401, and deletes it on stop.
// A Pi-hole without password answers without a session.
//
// Pi-hole v5 (admin/api.php) is end of life and not supported: it is detected
// and reported as such.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // wrong or missing password
  TOTP: 'totp', // two-factor authentication on: an application password is needed
  SEATS: 'seats', // every API session is taken
  RATE_LIMIT: 'rate_limit', // too many login attempts
  V5: 'v5', // Pi-hole v5: not supported
  NOT_PIHOLE: 'not_pihole', // something answers, not a Pi-hole v6 API
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  HTTP: 'http', // any other HTTP error
});

export class PiholeError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status, location }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'PiholeError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function networkError(err) {
  if (TLS_CODES.has(err.code)) {
    return new PiholeError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
  }
  return new PiholeError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
}

function parseJson(response) {
  try {
    return JSON.parse(response.body);
  } catch {
    return undefined;
  }
}

export class PiholeClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port]`
   * @param {string} [options.password] web or application password, '' for none
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, password = '', insecure = false, request = httpRequest, timeoutMs = 10_000 }) {
    this.url = url;
    this.password = password;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.sid = null;
    this.loggedIn = false;
    this.loggingIn = null;
  }

  // --- Transport ---------------------------------------------------------------

  async send(method, path, { json, sid } = {}) {
    let response;
    try {
      response = await this.request(`${this.url}${path}`, {
        method,
        json,
        headers: sid ? { 'X-FTL-SID': sid } : {},
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      throw networkError(err);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers?.location;
      throw new PiholeError(ERROR_KINDS.REDIRECT, `Redirected to ${location ?? '?'}`, {
        status: response.status,
        location,
      });
    }
    return { status: response.status, data: parseJson(response) };
  }

  // --- Session -----------------------------------------------------------------

  /** Opens a session (one at a time, shared by concurrent callers). */
  login() {
    this.loggingIn ??= this.doLogin().finally(() => {
      this.loggingIn = null;
    });
    return this.loggingIn;
  }

  async doLogin() {
    this.sid = null;
    this.loggedIn = false;
    const { status, data } = await this.send('POST', '/api/auth', {
      json: { password: this.password },
    });
    if (status === 200 && data?.session?.valid === true) {
      this.sid = typeof data.session.sid === 'string' ? data.session.sid : null;
      this.loggedIn = true;
      return;
    }
    if (status === 401) {
      throw new PiholeError(ERROR_KINDS.AUTH, 'Password refused', { status });
    }
    if (status === 400 && /2FA/i.test(data?.error?.message ?? '')) {
      throw new PiholeError(ERROR_KINDS.TOTP, 'Two-factor authentication is enabled', { status });
    }
    if (status === 429) {
      throw data?.error?.key === 'api_seats_exceeded'
        ? new PiholeError(ERROR_KINDS.SEATS, 'API seats exceeded', { status })
        : new PiholeError(ERROR_KINDS.RATE_LIMIT, 'Too many login attempts', { status });
    }
    if (status === 404) {
      throw await this.notV6();
    }
    if (status === 200) {
      // 200 without a valid session: not the Pi-hole v6 answer.
      throw new PiholeError(ERROR_KINDS.NOT_PIHOLE, 'Unexpected answer to /api/auth', { status });
    }
    throw new PiholeError(ERROR_KINDS.HTTP, `Login failed with HTTP ${status}`, { status });
  }

  /** /api does not exist: a Pi-hole v5, or something else. */
  async notV6() {
    try {
      const { status, data } = await this.send('GET', '/admin/api.php?version');
      if (status === 200 && data && typeof data.version === 'number') {
        return new PiholeError(ERROR_KINDS.V5, 'Pi-hole v5 (admin/api.php) is not supported');
      }
    } catch {
      // Fall through: whatever answered is not a Pi-hole.
    }
    return new PiholeError(ERROR_KINDS.NOT_PIHOLE, 'No Pi-hole v6 API at this address', {
      status: 404,
    });
  }

  /** Deletes the session, so it does not hold one of the server's seats. */
  async logout() {
    const sid = this.sid;
    this.sid = null;
    this.loggedIn = false;
    if (!sid) {
      return;
    }
    try {
      await this.send('DELETE', '/api/auth', { sid });
    } catch {
      // The server is gone or the session expired: nothing left to free.
    }
  }

  // --- Authenticated calls -----------------------------------------------------

  /**
   * A call to the API, logging in first when a password is set, and once more
   * when the session expired (401).
   */
  async api(method, path, json) {
    if (this.password && !this.loggedIn) {
      await this.login();
    }
    let response = await this.send(method, path, { json, sid: this.sid });
    if (response.status === 401) {
      if (!this.password) {
        throw new PiholeError(ERROR_KINDS.AUTH, 'This Pi-hole requires a password', {
          status: 401,
        });
      }
      await this.login();
      response = await this.send(method, path, { json, sid: this.sid });
      if (response.status === 401) {
        throw new PiholeError(ERROR_KINDS.AUTH, 'Session refused', { status: 401 });
      }
    }
    if (response.status === 404) {
      throw await this.notV6();
    }
    if (response.status !== 200) {
      throw new PiholeError(
        ERROR_KINDS.HTTP,
        `${method} ${path} failed with HTTP ${response.status}`,
        {
          status: response.status,
        },
      );
    }
    if (!response.data || typeof response.data !== 'object') {
      throw new PiholeError(ERROR_KINDS.NOT_PIHOLE, `${path} did not answer JSON`);
    }
    return response.data;
  }

  getSummary() {
    return this.api('GET', '/api/stats/summary');
  }

  getBlocking() {
    return this.api('GET', '/api/dns/blocking');
  }

  /**
   * @param {boolean} enabled
   * @param {number|null} [timerSeconds] back to the opposite state after this
   *   delay; null for a permanent change (also cancels a running timer)
   */
  setBlocking(enabled, timerSeconds = null) {
    return this.api('POST', '/api/dns/blocking', {
      blocking: enabled,
      timer: timerSeconds && timerSeconds > 0 ? timerSeconds : null,
    });
  }

  getVersions() {
    return this.api('GET', '/api/info/version');
  }
}
