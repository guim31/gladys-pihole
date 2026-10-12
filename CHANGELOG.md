# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One Gladys device per Pi-hole v6 server (up to three): an ad blocking switch,
  the DNS queries, blocked queries and share blocked over the last 24 hours,
  the active clients, the domains on the blocklists and the number of updates
  available.
- Turning the blocking switch off disables the blocking until it is turned
  back on, or pauses it for 5 to 60 minutes, as chosen in the configuration.
- A "Pi-hole" dashboard widget: the 24 h figures of every server or of one,
  the state of each server, and Pause 5 min, Pause 30 min, Pause… (a typed
  duration, Gladys 5.2.0 or later) and Resume buttons.
- Scene triggers: blocking paused (with its length, and whether it came from
  Gladys or from elsewhere), blocking resumed (end of the pause, Gladys or
  elsewhere), update available (once per version), Pi-hole no longer answers,
  Pi-hole answers again.
- Scene actions: pause the blocking for a number of minutes on one Pi-hole or
  all of them, and resume it.
- A "Test the connection" button, and a connection status naming the server
  and the problem (password refused, two-factor authentication, certificate,
  Pi-hole v5 not supported…).
- App passwords, the web interface password or no password; HTTPS with
  self-signed certificates on request.
- Interface texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-pihole/commits/main
