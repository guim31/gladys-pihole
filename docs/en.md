# Pi-hole

Follow and control the ad blocking of your [Pi-hole](https://pi-hole.net) from
Gladys, over your local network: pause it for five minutes from the dashboard
when a website breaks, see what it blocked over the last 24 hours, and know
when it stops answering or when an update is out.

> **Developed without the hardware: feedback welcome.** This integration was
> built and tested against the answers documented by Pi-hole (the OpenAPI
> specification of Pi-hole v6), not against a real server. If something does
> not work as described, please say so on the
> [Gladys forum](https://community.gladysassistant.com) or in the
> [issues](https://github.com/guim31/gladys-pihole/issues).

## What you need

- Gladys Assistant 5.1.0 or later (5.2.0 or later for the _Pause…_ button of
  the widget).
- **Pi-hole v6** or later, reachable from Gladys. Pi-hole v5 is not supported:
  it is detected and reported in the Configuration screen.
- An **app password** of your Pi-hole (recommended), or its web interface
  password, or nothing if your Pi-hole has no password.

To create an app password, open the Pi-hole web interface: **Settings** →
**Web interface / API**, switch the page to **Expert** mode (top right), then
**Configure app password** → **Enable new app password**. Copy the password
shown: Pi-hole shows it only once. An app password also works when two-factor
authentication is on, which the web interface password does not.

## Set up

1. Install the integration from the Gladys catalog.
2. In **Configuration**, enter the **Address** of your Pi-hole (for example
   `192.168.1.2`, or `https://192.168.1.2` for HTTPS), its **App password**,
   and optionally a **Name**. Two or three Pi-hole servers? Fill in the
   _Second Pi-hole_ and _Third Pi-hole_ sections too.
3. Save, then click **Test the connection**: the message under the button says,
   for each server, whether it answers, its version and the state of its
   blocking.
4. Open the **Discover** tab: one device per Pi-hole. Click **Add**, pick a
   room, save.

Options:

- **Accept self-signed certificates**: Pi-hole v6 serves HTTPS with a
  certificate it signed itself. Tick it to use an `https://` address; leave it
  off for `http://` addresses.
- **Refresh interval**: how often the servers are read, from 15 seconds to 5
  minutes (1 minute by default).
- **Turning the blocking switch off**: what the switch of the device does when
  you turn it off: pause the blocking for 5 minutes (default), 15, 30 or 60
  minutes, or disable it until you turn it back on.
- **Language of the feature names**: English, French, German or Spanish. The
  names are given when a device is added (French by default).

## The device of each Pi-hole

| Feature                | What it is                                                            |
| ---------------------- | --------------------------------------------------------------------- |
| Ad blocking            | Switch: on, the Pi-hole blocks; off, it lets everything through       |
| DNS queries (24 h)     | Queries received over the last 24 hours                               |
| Blocked queries (24 h) | Queries blocked over the last 24 hours                                |
| Share blocked (24 h)   | Share of the queries blocked, in %, rounded                           |
| Active clients (24 h)  | Devices that used the Pi-hole over the last 24 hours                  |
| Domains on blocklists  | Domains on the blocklists of the Pi-hole                              |
| Updates available      | Number of Pi-hole parts with a newer version (0 when all are current) |

The figures are those of the Pi-hole home page: a rolling window of the last
24 hours, not the calendar day. The badge of the device shows **Local** when
the Pi-hole answers and **Unreachable** when it does not.

## Dashboard

Add the **Pi-hole** widget to a dashboard. By default it shows all your
servers together; choose one in its settings to show only that one. Pausing a
single Pi-hole out of two changes nothing: your devices then ask the other one.

The widget shows the queries, the blocked queries and the share blocked over
the last 24 hours, the state of each server (blocking, paused with the minutes
left, disabled, unreachable), the active clients, the domains on the
blocklists and the available updates. Its buttons:

- **Pause 5 min** and **Pause 30 min**: pause the blocking right away;
- **Pause…**: opens a small form to type the duration in minutes (Gladys 5.2.0
  or later; an older Gladys answers that it needs an update);
- **Resume**: turns the blocking back on. It shows a check mark while the
  blocking is on everywhere.

## Scenes

### Triggers

- **Pi-hole blocking paused**: the blocking was turned off, from Gladys or
  from elsewhere (the Pi-hole interface, the `pihole disable` command, another
  tool). Filter by Pi-hole and by origin (_From Gladys_ or _Outside Gladys_).
  The actions can read the name of the Pi-hole and the length of the pause in
  minutes (`duration_minutes`, 0 when it has no end).
- **Pi-hole blocking resumed**: the blocking is on again. The origin tells
  whether the pause ended on its own (_End of the pause_), from Gladys or from
  elsewhere; `paused_minutes` says how long it lasted.
- **Pi-hole update available**: a new version of Pi-hole is out (core, FTL,
  web interface, or the Docker image when Pi-hole runs in Docker). Announced
  once per version, even across restarts. `updates` lists the new versions,
  for example `Core v6.1.2, FTL v6.3`.
- **Pi-hole no longer answers**: a Pi-hole did not answer two reads in a row
  (the second one 15 seconds after the first). The DNS of your home may be
  down. `error` says why, in the language of the configuration.
- **Pi-hole answers again**: it is back; `down_minutes` says after how long.

A refused password does not count as "no longer answers": the Configuration
screen reports it.

### Actions

- **Pause Pi-hole blocking**: pauses the blocking on one Pi-hole, or on all of
  them when the field is left empty, for a number of minutes (5 by default,
  0 until resumed, one day at most). The following actions can read how many
  servers were paused.
- **Resume Pi-hole blocking**: turns the blocking back on, on one Pi-hole or
  all of them.

The _Ad blocking_ switch can also be used with the standard Gladys action that
controls a device.

### Scene ideas

- **Safety net**: a scene every evening at 20:00 with _Resume Pi-hole
  blocking_, so a switch turned off "until turned back on" never stays off
  all night.
- **DNS alert**: _Pi-hole no longer answers_ → send a message "Pi-hole
  {{triggerEvent.data.server}} does not answer: {{triggerEvent.data.error}}".
  And _Pi-hole answers again_ → "back after
  {{triggerEvent.data.down_minutes}} min".
- **Who paused the blocking?**: _Pi-hole blocking paused_ with the origin
  _Outside Gladys_ → send a message with the length of the pause.

## Troubleshooting

- **"password refused"**: check the app password. Creating a new app password
  in Pi-hole replaces the old one: copy the new one into Gladys.
- **"two-factor authentication is on"**: the web interface password needs a
  code from your phone; use an app password instead.
- **"certificate refused"**: you entered an `https://` address; tick _Accept
  self-signed certificates_, or use the `http://` address.
- **"the address redirects"**: your Pi-hole sends HTTP visitors to HTTPS; enter
  the `https://` address and tick _Accept self-signed certificates_.
- **"no free API session"**: Pi-hole accepts a limited number of API sessions
  at once (16 by default). The integration keeps a single one per server and
  closes it when it stops; other tools may hold the rest. Pi-hole frees
  unused sessions after 30 minutes.
- **"Pi-hole v5 is not supported"**: update Pi-hole to version 6
  (`pihole -up`).
- **"does not answer"**: check that `http://<address>/admin` opens from a
  computer on the network of Gladys. Names ending in `.local` usually do not
  work inside the integration: use the IP address.
- The integration logs what it does: open the integration logs from the Gladys
  interface. It never logs your password.

## Limits

- Pi-hole v6 only. One integration handles up to three Pi-hole servers.
- The integration reads each server once per refresh interval (two small
  requests, plus the version check once an hour) and keeps one API session
  per server: no quota of Pi-hole is at risk.
- The figures cover the last 24 hours as Pi-hole counts them; they are not
  reset at midnight.
- The share blocked is rounded in the device (Gladys has no decimal
  percentage sensor); the widget shows one decimal.
- The integration does not manage the blocklists, the allowed or denied
  domains, nor the clients of Pi-hole: use the Pi-hole interface for that.
- Developed without a real Pi-hole: what was not checked on a real server is
  listed in the [README](https://github.com/guim31/gladys-pihole#readme).

This integration is not affiliated with Pi-hole LLC.
