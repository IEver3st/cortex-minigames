# Development

Source checkouts only; the customer build ships `web/dist` and none of the tooling below.

```powershell
cd web; bun install --frozen-lockfile; bun run dev   # playground at http://localhost:5173
.\scripts\check.ps1                                    # Lua syntax + specs, UI tests, type check, build
```

Release builds come from the fivem-release builder, configured by `release.config.json`, and land in
`.release/<version>/`. `scripts/package.ps1` makes an unescrowed zip under `artifacts/` for
internal use only.

The playground runs the production session, engine and views with a mocked Lua bridge: pick a game,
preset and parameters (invalid configurations show their error before launch), fix a seed, switch
scale, motion, audio and scene, simulate caller cancel, death, hard deadline, resource restart,
dropped `ready` and rejected reports, run the example compositions, and copy the equivalent Lua call.

Design brief and review: [DESIGN.md](../DESIGN.md). User-run acceptance:
[runtime-validation.md](runtime-validation.md).

# Adding a game

A game owns its mechanics; the engine and session runtime own time, input, focus and lifecycle.
Adding one never touches `client/session.lua`, the bridge or the engine.

1. **Logic** — `web/src/games/<id>/logic.ts` exporting `defineGame<Params, State>({ … })`:
   - `id`, `version`, `name`, `inputs` (only modes you actually implement), `presentation`.
   - `params` schema (`int`, `number`, `bool`, `enum`), `presets` for all four difficulties with
     concrete values, `defaultTimeoutMs(p)`.
   - `metrics` allowlist, `hints` (abstract actions + short labels), one-sentence `tutorial`,
     `minDurationMs` (the fastest plausible legitimate success; the server uses it).
   - `check(p, timeoutMs)`: return an error code for contradictions (budget too short, target below
     input precision, unreachable states). Runs before focus.
   - `create(p, rng, timeoutMs)`: all randomness from `rng` (seeded, versioned). Bounded retries
     plus a verified fallback for anything generated.
   - `step(s, dt, t, input)` for continuous mechanics (fixed 120 Hz; never count frames),
     `press`/`release` for edges (they arrive with exact timestamps; autorepeat is already filtered),
     `pointer` for mouse gestures translated by the view.
   - `outcome(s, t)` → `{ status, reason }` from the closed reason list, or `null`.
   - `report(s, outcome, t, timeoutMs)` → `{ score 0..100, mistakes, metrics, perfect? }`.
2. **Register** it in `web/src/games/registry.ts` (one import, one entry).
3. **View** — `web/src/games/<id>/View.svelte`, registered in `web/src/games/views.ts`. Build a
   render model with `$derived.by(() => { … session.view.s … })`; use tokens and `--u` only; SVG for
   the mechanic, DOM for status. Mouse input calls `session.tap`, `session.hold` or
   `session.pointer`. Give it its own silhouette; do not reuse another game's geometry.
4. **New reason?** Add it to `REASONS` in `web/src/core/types.ts` and a player-facing line in
   `web/src/shell/labels.ts`.
5. **Catalog** — `bun run build` (or `bun run catalog`) regenerates `shared/catalog.json`. The UI
   test suite fails if the committed catalog drifts.
6. **Tests** — in `web/tests/games.test.ts`: every preset validates; known fixtures hit the success
   and failure boundaries; a scripted player finishes every preset. In `generation.test.ts`: seeds
   0..99 per preset satisfy the generator's invariants, and the same seed reproduces the challenge.
   Continuous mechanics get a 30/60/144 FPS equivalence case.
7. **Docs** — regenerate the tables (`bun run scripts/emit-game-tables.ts > tables.tmp && python
   scripts/write-games-doc.py tables.tmp`) and add the game's prose in `write-games-doc.py`.
8. **Review** — run it in the playground at 1280×720, 1920×1080, 2560×1440 and ultrawide over the
   dark, bright and street scenes, then run the `CORTEX-DESIGN.md` checklist.

Run `scripts/check.ps1` before handing it over.
