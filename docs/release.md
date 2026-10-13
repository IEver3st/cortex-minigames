# Cortex Minigames 1.0.0

First free public release, dated 2026-10-11. Download the archive from the official Cortex
Minigames release post. The package contains plaintext Lua, compiled UI assets, configuration, locales,
documentation and a separate demo resource. The build variant named `open` identifies the plaintext
archive. The proprietary licence permits free use and local modification on servers you own or
administer; redistribution and resale are prohibited. See [LICENSE](../LICENSE).

## Release notes

Twelve games and composable QTEs share one result contract. Callers can start a single game or a
bounded sequence with stop, continue or retry policies. Server-issued attempts bind the interaction
to one player connection and owning resource, expire on the server clock, and deliver once.

Keyboard, mouse and controller paths are implemented. Players can change volume, motion, size and
keys with `/mgprefs`. `cortex-lib` is optional: compatible installations add Cortex Settings and a
shared accent; standalone installations keep the local theme. See [games.md](games.md) for every
game, preset, parameter and metric, and [CHANGELOG](../CHANGELOG.md) for the full feature list.

## Install and integrate

1. Extract the archive's `cortex-minigames` folder into your resources without renaming it. The
   included `web/dist/index.html` and assets are required. No SQL or frontend build step is needed.
2. Start optional `cortex-lib` first, then `cortex-minigames`, then each calling resource. Declare
   `dependency 'cortex-minigames'` in caller manifests. Back up custom configuration and locales
   before replacing a prior development copy.
3. Follow the [README](../README.md) examples for local APIs and server attempts. Copy
   `examples/cortex-minigames-demo` outside the provider folder if you want the separate demo.
   Enable OneSync for its server-side proximity checks. Leave `cortex_minigames_dev` unset on a
   production server.

Local results come from the player's client. For anything that changes money, items or permanent
state, issue an attempt from an authorized server flow, revalidate player and target state in the
completion callback, and commit idempotently using `info.attemptId`. Fail pending work closed when
the provider stops. Coarse success minimums apply to both reported duration and server elapsed time;
compositions require the successful steps' combined minimum. These checks do not prove human play.
Read [security.md](security.md) before connecting rewards.

## Native acceptance still pending

Offline Lua/UI tests and browser reviews validate their respective code and layout paths. Native
CEF, actual controller delivery, restart behavior, multiplayer and performance must be checked on
the target server before publication. Use the exact archive intended for release.

1. **Clean install and input.** Start the provider without `cortex-lib`, then the separate demo.
   Temporarily set `setr cortex_minigames_dev 1` and use `/minigame <id> <preset>` for all twelve
   games plus `qte`. Check keyboard, mouse and controller, both presentation modes, bright and dark
   scenes, and your supported resolutions/scales. Escape, pad B, failure and timeout must return
   controls immediately. Restore the production convar afterwards.
2. **Integration and lifecycle.** With a compatible library, check accent Preview, Apply and
   Discard. During play, restart callers, then the provider, and verify cleanup. Restart optional
   `cortex-lib`, then `cortex-minigames`, then callers after updates. Test server-issued attempts on
   two clients at once: results must stay with their player and owner, and duplicate or foreign
   reports must not reward. Check that the caller watchdog fails stopped work closed.
3. **Stalls and performance.** Test blur and a render stall, then repeat twenty open/close cycles.
   Record idle and active `resmon` readings and CEF memory with hardware, resolution and sample
   length. Check F8 and server logs for errors. No performance figure is claimed from offline tests.

For failures, report the resource version, game/preset, input device, reproduction steps and exact
server or F8 error. Send screenshots for layout/focus issues and measured samples for performance.
Use the [GSD Modifications Discord](https://discord.gg/Atwt5nxaCV). Keep credentials and private player data out
of public reports.
