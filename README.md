# Pi-hole for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
follows and controls [Pi-hole](https://pi-hole.net), the network-wide ad
blocker, through the REST API of Pi-hole v6, over the local network. No cloud,
no account.

> **Developed without the hardware: feedback welcome.** The integration is
> built and tested against the answers documented by Pi-hole (the examples of
> the Pi-hole v6 OpenAPI specification), not against a running Pi-hole. Please
> report what works and what does not in the
> [issues](https://github.com/guim31/gladys-pihole/issues).

## Features

- **One device per Pi-hole** (up to three servers, each with its own address
  and password): the **ad blocking switch** (off: until turned back on, or a
  pause of 5 to 60 minutes, as configured), the DNS queries, blocked queries
  and share blocked over the last 24 hours, the active clients, the domains on
  the blocklists, and the number of **updates available**.
- **Dashboard widget** "Pi-hole": the 24 h figures of every server (or one),
  the state of each server (blocking, paused with the minutes left, disabled,
  unreachable), the clients, the blocklist size and the available updates, and
  four direct buttons: **Pause 5 min**, **Pause 30 min**, **Pause…** (a
  duration typed in a form, Gladys 5.2.0 or later) and **Resume**.
- **Scene triggers**: _Pi-hole blocking paused_ (with the length of the pause,
  and whether it came from Gladys or from elsewhere: the Pi-hole interface,
  `pihole disable`…), _Pi-hole blocking resumed_ (by the end of the pause,
  Gladys or elsewhere), _Pi-hole update available_ (once per version, across
  restarts), _Pi-hole no longer answers_ and _Pi-hole answers again_.
- **Scene actions**: _Pause Pi-hole blocking_ (one server or all of them, for a
  number of minutes) and _Resume Pi-hole blocking_.
- A **Test the connection** button in the Configuration screen, and a
  connection status that names the server and the problem (password refused,
  two-factor authentication, certificate, Pi-hole v5…).
- A **transport badge** per device: local, or unreachable.
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
  The _Pause…_ button of the widget needs **5.2.0** (forms behind widget
  buttons); on 5.1, it answers that Gladys needs an update.
- **Pi-hole v6** or later (February 2025). Pi-hole v5 and its
  `admin/api.php` API are end of life and not supported: they are detected and
  reported.
- An **app password** of the Pi-hole (recommended: Pi-hole web interface →
  Settings → Web interface / API → Expert mode → Configure app password), or
  the web interface password, or none for a Pi-hole without password. The
  web password does not work when two-factor authentication is on; an app
  password does.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-pihole`
   (or install **Pi-hole** from the catalog once it is listed).
2. In **Configuration**, enter the address of your Pi-hole (`192.168.1.2`,
   `https://192.168.1.2`, `pi.hole:8080`…), its app password and a name; up to
   two more servers below. Tick _Accept self-signed certificates_ for an
   `https://` address. Save, then click **Test the connection**.
3. Open the **Discover** tab and add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- `POST /api/auth` with the password opens **one session per server**; its id
  travels in the `X-FTL-SID` header. Each request extends the session (30
  minutes by default); a `401` logs in again once; the session is deleted
  (`DELETE /api/auth`) when the server is removed from the configuration, its
  password changes, or the integration stops — Pi-hole accepts a limited
  number of sessions at once (16 by default). A Pi-hole without password is
  read without session.
- Every refresh interval (15 s to 5 min, 1 min by default), each server is read
  with `GET /api/dns/blocking` (state and seconds left in a pause) and
  `GET /api/stats/summary` (the rolling 24 hours FTL keeps in memory);
  `GET /api/info/version` once an hour, read with the rules of the Pi-hole web
  interface footer (in Docker only the image tag counts; on `master` a lower
  version than the latest release, on another branch a different commit). The
  devices are published with `should_poll: false`: the interval is beyond the
  list of the Gladys scheduler, and the scene events must fire even for a
  server whose device was not added.
- Only the values that changed are sent to Gladys, and all of them again when
  a device is added (Gladys drops the states of a feature it does not know
  yet) or when Gladys reconnects.
- A pause is `POST /api/dns/blocking` `{ "blocking": false, "timer": seconds }`;
  resume is `{ "blocking": true, "timer": null }`, which also cancels a running
  pause. The answer carries the new state, published at once. When a pause ends
  before the next read, the server is read right after its end.
- A blocking change seen within 30 s of a Gladys command is Gladys' own; any
  other is "outside Gladys", or "end of the pause" when it happens at the time
  the pause was due to end.
- A server is "down" after two failed reads in a row (the second one 15 s
  after the first), counting only silence (refused connection, timeout): a
  refused password is a configuration problem, shown in the connection status.
- `/data/pihole-state.json` remembers the updates already announced, so a
  restart does not announce them again. Nothing else is stored; passwords stay
  in the Gladys configuration and never reach the logs.
- HTTP(S) runs on `node:http` / `node:https`: `fetch` cannot accept a
  self-signed certificate for one server only. Certificates are checked unless
  the user ticks the option.

## Not verified on a real Pi-hole

Developed without a Pi-hole at hand: the tests run against an in-memory Pi-hole
built from the examples of the OpenAPI specification. To check on a real
server:

- the exact answer of `POST /api/auth` with an app password, and with the web
  password when two-factor authentication is on (expected: `400` "No 2FA token
  found in JSON payload");
- that an app password session may change the blocking with
  `webserver.api.app_sudo` left off (the default);
- the `timer` value of `GET /api/dns/blocking` during a pause (remaining
  seconds, decimal);
- the answer of a Pi-hole v5 to `POST /api/auth` (expected: `404`, then
  `admin/api.php?version` answering `{"version": 3}`);
- `/api/info/version` in Docker, where `docker.local` holds the image tag;
- whether some installations redirect HTTP to HTTPS (handled as an error asking
  for the `https://` address).

## Limitations

- Pi-hole v6 only; three servers at most per Gladys.
- The figures are the rolling 24 hours of Pi-hole, not the calendar day.
- The share blocked is rounded in the device (Gladys has no decimal percentage
  sensor); the widget shows one decimal.
- No management of blocklists, allowed or denied domains, groups or clients:
  that stays in the Pi-hole interface.
- Names ending in `.local` do not resolve inside the integration container:
  use IP addresses or names your DNS resolves.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory Pi-hole (`test/helpers/fakePihole.js`) built from the examples
of the FTL OpenAPI specification (`test/fixtures/pihole/`). See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [Pi-hole](https://pi-hole.net): the OpenAPI specification of the v6 API
  (`src/api/docs/content/specs/` in [pi-hole/FTL](https://github.com/pi-hole/FTL),
  EUPL-1.2), whose examples shaped the test fixtures, and the update rules of
  the [web interface](https://github.com/pi-hole/web) footer, re-implemented
  here. The logo on the cover comes from
  [pi-hole/graphics](https://github.com/pi-hole/graphics) (MIT).
- [python-hole](https://github.com/home-assistant-ecosystem/python-hole) by
  Fabian Affolter and contributors (MIT) and Home Assistant's
  [`pi_hole`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/pi_hole)
  integration (Apache-2.0): the session handling and the choice of sensors.
- [AdGuard Home for Gladys](https://github.com/cicoub13/gladys-adguard-home) by
  cicoub13 (Apache-2.0): the idea of the pause buttons and of the 24 h
  sensors; no code was copied.
- The architecture and the conformity tests follow
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Pi-hole LLC.
"Pi-hole" and the Pi-hole logo are registered trademarks of Pi-hole LLC.

## License

Apache-2.0
