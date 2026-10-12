# Pi-hole v6 answers used by the tests

- The files at this level are built from the examples of the Pi-hole v6
  OpenAPI specification (`src/api/docs/content/specs/` in pi-hole/FTL), with
  invented session ids and realistic counts.
- `real/` holds answers of a real Pi-hole (Docker image `pihole/pihole`
  2026.09.0: Core v6.4.3, FTL v6.7.1, Web v6.6), recorded on 12/10/2026 from
  the integration's locked container. Session ids and CSRF tokens are
  replaced; the commit hashes are the public ones of that release.
