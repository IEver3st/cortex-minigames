# Changelog

## Unreleased

- Two games: **Mash** (`mash`, tap to fill against decay, rate-capped) and **Trace Sweep**
  (`trace`, one mouse sweep along a half ring using cortex-lib's virtual-knob model; keys and stick
  draw the same arc).
- Catalog games may declare `cursor`; in `auto` input mode Lua then shows the NUI cursor for them
  even in a compact slip.

## 1.0.0 — 2026-09-29

First release.

- Ten minigames (Timing Check, Sequence Recall, Pressure Control, Signal Lock, Circuit Routing,
  Pin & Tension, Wave Match, Trace Path, Pattern Rebuild, Pulse Sync) with four calibrated presets
  each, seeded generation (RNG v1) and per-game scoring.
- Composable QTE primitives: press, hold, release, alternate, chord, react, tap.
- Sequences with stop/continue/retry policies, bounded retries and one overall deadline.
- Client API v1: `Play`, `Begin`, `PlaySequence`, `Cancel`, `IsBusy`, `ListGames`, `GetVersion`;
  caller watchdog helper `@cortex-minigames/caller.lua`.
- Server-issued attempts: `StartAttempt`, `CancelAttempt`, `GetAttempt`, with connection binding,
  expiry, replay protection, rate limits and atomic owner-only delivery.
- Svelte 5 NUI in the Cortex design language; keyboard, mouse and controller; reduced motion, mute,
  size and key rebinding through Cortex Settings (cortex-lib 2.2.x, optional) or `/mgprefs`.
- Developer playground, locale files, and a copyable demo resource.
