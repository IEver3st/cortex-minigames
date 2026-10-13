# Changelog

## 1.1.0 - 2026-10-12

### Added

- Update check: on start the server asks GitHub once for the latest Cortex Minigames release and
  prints `Update available: <version>` with the download link when it is newer, or
  `Version <x> is up to date`. A failed check prints one line and changes nothing. Turn it off with
  `set cortex_minigames_version_check 0`.
- Releases are now published at https://github.com/IEver3st/cortex-minigames/releases.

## 1.0.0 - 2026-10-11

First free public release of Cortex Minigames. The package includes all twelve games and QTEs,
readable Lua, a compiled UI, configuration, locales and integration examples.
Free use and local modification on servers you own or administer are permitted under the proprietary
licence; redistribution and resale are prohibited. See [LICENSE](LICENSE).

### Included

- Timing Check, Sequence Recall, Pressure Control, Signal Lock, Circuit Routing, Pin & Tension,
  Wave Match, Trace Path, Pattern Rebuild, Pulse Sync, Mash and Trace Sweep. Each game has four
  presets, seeded generation and its own scoring and failure rules.
- QTE primitives: press, hold, release, alternate, chord, react and rate-capped tap.
- Linear sequences with stop, continue and retry policies, bounded retries and an overall deadline.
- Client exports: `Play`, `Begin`, `PlaySequence`, `Cancel`, `IsBusy`, `ListGames`, `GetVersion`;
  watchdog helper `@cortex-minigames/caller.lua` for provider-stop handling.
- Server-issued attempts with connection and owner binding, expiry, replay protection, rate limits
  and atomic delivery. Successful reports must meet the catalog minimum on both the reported
  duration and the server clock; compositions sum their successful steps' minimums.
- Svelte 5 UI with keyboard, mouse and controller paths; reduced motion, mute, size and key
  preferences through `/mgprefs` or optional Cortex Settings. Compatible `cortex-lib` presentation
  adapters supply the shared accent, with a local mint fallback.
- Declarative parameter validation, generated game catalog, locale files and a copyable demo.
  Contradictory or unreachable settings report useful validation errors.

### Installation and validation

- No required framework, database or `cortex-lib` dependency. Install the included production UI
  without frontend build tools. See [README](README.md) for startup order and caller integration.
- This is the first public version; no migration from an earlier public release is required.
- Native CEF, controller delivery, focus and restart behavior, two-client isolation and performance
  require server-owner acceptance. See [docs/release.md](docs/release.md).
