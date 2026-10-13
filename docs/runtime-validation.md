# Validation status and user-run acceptance

## Executed locally (pre-public candidate, 2026-10-10)

The first free public release is 1.0.0. The checks below exercised the fixed
runtime before the public version and documentation were prepared. Its original
1.1.0 candidate and evidence remain preserved. The new package record lives in
`.release/1.0.0/release-checklist.md`; it records checks run against the new ZIP.

| Area | Evidence | Result |
| --- | --- | --- |
| Contract | `tests/schema_spec.lua`, `tests/session_spec.lua`, `web/tests/games.test.ts` registry cases | pass |
| Session race | `session_spec` case 4: completion, cancel and deadline in one turn → one result, one focus release | pass |
| Ownership | `session_spec` cases 2, 3, 18 | pass |
| Readiness | `session_spec` case 5 (no ready → `ui_startup_timeout`, focus never taken); case 15 practice idle | pass |
| Stale messages | `session_spec` case 6 (old generation, old sid, other protocol, early complete) | pass |
| Mechanics | `web/tests/games.test.ts`: boundaries, failure rules, autorepeat, scripted solves for every preset | pass |
| Generation | `web/tests/generation.test.ts`: seeds 0–99 × 4 presets for circuit, trace, pattern, pulse, signal, wave, timing, sequence; determinism per seed; zero fallbacks used | pass |
| Timing | Same judged outcome at 30, 60 and 144 FPS with ±25% frame jitter (timing, pressure, trace); stall pauses simulation; input after the deadline never counts | pass |
| Composition | `tests/sequence_spec.lua`: stop, continue (required/optional), retry, exhausted retries, step timeout, overall deadline, cancel between steps, step error | pass |
| Security | `tests/attempts_spec.lua`: wrong player, finish without start, replay, duplicate, concurrent finalisation, expiry, malformed, contradictory, implausible duration, spam, bucket change, reconnect with reused id, owner stop, owner-limited cancel, sequence shape | pass |
| Cleanup | `session_spec` case 17: 50 open/close cycles → no active session, no focus, no frame loop | pass |
| Protocol | `web/tests/protocol.test.ts`: message parsing, bounds, prefs and locale sanitising, keymap | pass |
| Types/build | `bun run check` 0 errors, `bun run build` clean; bundle contains no playground, localhost or CDN | pass |
| Static | `luac -p` on every Lua file; staged `validate-resource.ps1` passes (retained lua54 and guarded offline os.clock fallback warnings); `audit-nui-ui.ps1` 0 errors (1 false positive: the tokens file's `:focus { outline: none }` reset) | pass |
| Local gates | `scripts/check.ps1`: six Lua suites, 133 UI tests, 151083 assertions, `svelte-check` 0 errors/0 warnings, fresh production build | pass |
| Mash regression | `web/tests/prepare.test.ts`: unreachable derived budgets, invalid explicit budgets and oversized valid QTE defaults | pass |
| Optional presentation | `tests/presentation_spec.lua` uses the installed canonical Lua adapter; 12 browser-loader fixtures cover absence, late start/restart, stale readiness, bounded missing assets, stop/pagehide, quick restart, late aborted responses and once-only initialization | pass |
| Accent browser review | Compiled UI plus installed canonical assets: mint/lavender/blue, simulated Apply/Discard, stop/start; compact Trace Sweep and focused Circuit Routing at four resolutions across three lab backgrounds (24 captures), plus 2.5x zoom | reviewed |
| Mining integration | `cortex-mining` removes both blanket duration vetoes; 34 domain/server/client scenarios, 12 Lua parses and static resource gate; instant forged extraction/assay reports rejected, valid fast assay accepted | pass |
| Release package | Free 1.0.0 build, staged gate and extraction/hash verification are recorded in `.release/1.0.0/release-checklist.md`; earlier 1.1.0 evidence is preserved | see checklist |
| Prior visual review | The 2026-10-05 record covers every game at 1920×1080 and four resolutions over three backgrounds. It predates the optional accent adapter | historical |

Browser captures validate layout and computed colours only; settings snapshots and lab backgrounds
are simulated. Captures are downsampled. Native CEF, actual settings persistence and all of the
following checks remain unexecuted in FiveM.

## Not yet executed: in-game checks for the server owner

Setup: `ensure cortex-lib` (optional), `ensure cortex-minigames`, copy
`examples/cortex-minigames-demo` into resources and `ensure cortex-minigames-demo`. For dev commands
add `setr cortex_minigames_dev 1` (remove afterwards). Watch F8 for CEF errors throughout.

1. **Every game, every input.** `/minigame <id> <preset>` for all twelve games and `qte`. Keyboard,
   then mouse (focused games show a cursor), then a controller: D-pad, A/B/X/Y, LB/RB, left stick
   (Signal Lock, Wave Match, Trace Path, Pin & Tension lift) and RT (Pressure). Confirm hint glyphs
   switch between keyboard and pad. If a pad button or axis does nothing, note which: the control ids
   in `Config.Pad` (notably RT = 229 and the stick axes 218/219) are the least certain values.
2. **Input suppression.** While a game is open: no walking, camera, attacking, phone, chat or pause
   menu from keyboard or pad.
   Trace Sweep (`trace`, compact) shows the cursor in `auto` mode: one mouse sweep with no button
   must complete it at 30 and 144+ FPS and at two mouse DPI settings; a straight horizontal swipe
   and the mirrored arc must not; a pause mid-sweep then continuing must complete. Keys (lower:
   `S`, `A`, `W`) and the left stick rotated along the arc must also complete it. Mash: tap, hold
   (one tap only), stop until the meter drains, recover to completion; pad `A` and a mouse press on
   the keycap both tap. After it closes (success, fail, Escape, pad B, timeout): all controls
   return immediately and no key is stuck.
3. **Escape and focus.** Escape and Backspace always leave. Open a phone or cortex-lib settings,
   then run `/minigame`: expect `rejected/focus_unavailable`, and the other UI keeps its focus.
4. **Context.** `/demo_signal`, walk 5 m away → `left_area`; enter a vehicle → `context_check`; die
   during a game → `player_died`; unload the character (Qbox) → `logged_out`.
5. **Restarts.** During a game: `restart cortex-minigames-demo` → session ends `caller_stopped`,
   focus released. `restart cortex-minigames` → focus released, the demo's watchdog-backed commands
   report `cancelled/resource_stopping`; a bare `Play` caller does not resume (documented).
   Restart `cortex-lib` → the Minigames settings tab reappears.
   In Cortex Settings, Preview a non-mint accent, Apply it, then Preview another and Discard:
   the minigame follows each profile. Stop the library: mint fallback. Start it again: saved accent.
   Also start `cortex-minigames` without the library and confirm normal standalone play.
6. **Blur and stalls.** Alt-tab out mid-hold (Pressure) and back: nothing stuck. Force a hitch
   (heavy load) during a timed game: either the game continues correctly or ends `hard_deadline`.
7. **Frame rates.** Play Timing Check hard/expert with the FPS capped at 30, 60 and 144: judged
   timing should feel identical.
8. **Server attempts.** `/demo_attempt` at the demo's `BREAKER` coordinates (edit them): success
   notifies; failure reports the reason; walking away cancels. `minigame_attempt <id> timing` from
   the console. With two clients, start attempts on both at once: results never cross; completing
   with another player's attempt id (e.g. via a test client event) is rejected in the server log
   when `Config.Debug = true`.
9. **Visual.** 1280×720, 1920×1080, 2560×1440 and an ultrawide; UI size 0.75 and 1.5
   (`/mgprefs scale`); bright daytime sky and a dark interior; a long localized title.
10. **Accessibility.** `/mgprefs motion reduced`: no entry rise, no cue wipe, mechanics unchanged.
    `/mgprefs mute on`: silent, every state still readable.
11. **Performance.** `resmon` with no game open (expect no frame loop; report the figure), then
    during Pressure and Trace Path (frame-bound suppression runs only while open). CEF: no
    minigame input or stall messages while idle. The optional canonical presentation
    adapter has a five-second readiness recovery timer; it does not run a frame loop. While playing,
    pad input and axes are sent only as needed. Run 20 open/close cycles and compare
    CEF memory before and after. Report hardware, resolution, sample length and figures; no budget is
    claimed from source inspection.

12. **Mining consumer.** Restart `cortex-mining` after updating the provider. Complete an assay in
    less than 2.5 seconds: one sorted-item debit and one delivery. Finish the full iron pipeline and
    verify the $484 entitlement. Range, missing tool, expired lease and replay checks must still
    reject invalid work. Send the game/result, inventory changes and any server/F8 error on failure.
