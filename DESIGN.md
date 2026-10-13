# Design brief

Follows `../../[cortex-test]/CORTEX-DESIGN.md`. Tokens: `web/src/cortex.css`, a verbatim copy of
`cortex-design/tokens.css`.

1. **Surface and situation.** An interaction surface that opens on demand while the player is on
   foot performing an in-world task (repairing, tuning, picking). Never while driving or aiming.
2. **Primary verb.** Act precisely on one mechanic, now.
3. **Input.** Keyboard for every game, mouse where it fits, controller through native polling.
   While open, the surface owns input: game controls are suppressed frame by frame and released the
   moment the session ends. Escape (pad B) always leaves.
4. **Scene budget.** Quick checks sit lower-centre (`compact`, 480u wide, 150u above the bottom);
   spatial puzzles sit centred (`focused`, 660u). No backdrop, blur or dimming: most of the scene
   stays visible. Nothing covers the minimap or the top-left notification area.
5. **What appears when.** Everything appears only while a session is open: ready cue or first-use
   practice card → mechanic, clock, hints → outcome banner (≤ 1.5 s, interruptible) → gone. Mistake
   counter only after the first mistake. Round, lane and attempt pips only when there is more than
   one. The eyebrow only when a custom title or a sequence step needs context.
6. **Anchors.** Screen-centred archetypes; no native element to align with, so no runtime geometry
   is needed. Scale follows `--u` (shorter viewport side) times the player's size preference.
7. **Signature.** Keycaps that follow the last device, the two-part slip tag for the outcome
   (`CLEAR | 92`), paper-flip selection, and a mint "live" element in every mechanic (the marker,
   needle, probe, player trace, powered wire).
8. **Rejected defaults.**
   - A giant rounded modal over a dimmed screen → a slim slip that opens only as big as the mechanic.
   - The same ring or progress bar reskinned ten times → a distinct silhouette per game: bar or ring,
     gauge with moving band, tuning scope, wiring grid, pin columns, oscilloscope, corridor board,
     tile board, stacked lanes, keycap prompt.
   - Tutorial paragraphs during play → one sentence, only on first use, before the clock starts.
9. **States.** Resting, selected (paper flip), focused (mint edge), live (mint), pressed (keycap
   inverts), disabled/fixed (dim), caution (sand), critical (soft red). Empty tray, practice,
   ready, mistake, success, failure, timeout, cancellation, initialization error, reduced motion.

## Decisions worth knowing

- **Slip, not frameless.** The Cortex rule reserves `--slip` for things that open. A minigame opens
  and takes input, so it uses one; focused games use `--slip-deep` because busy scenes bled through
  the lighter fill in review.
- **Mint means yours.** The thing the player controls is mint. Targets are paper, hazards and
  failures soft red, caution sand. The accent never marks decoration.
- **No colour-only information.** Every state also has a word, glyph, stroke style or shape:
  decoys are hollow, target waves are dashed, lit terminals get a check, parked lanes are hatched,
  mistakes show ✕ with a count, meters print a number.
- **Nothing thin.** Rules, tracks and strokes are 3u or more; SVG strokes are sized in viewBox units
  that stay above 3u at the smallest supported scale.
- **Motion.** Entry rises 6u over 260 ms. The ready cue wipes an accent bar. No loops. Reduced
  motion (player preference or the system setting) removes decoration but never slows judged motion.
- **Audio is supplementary.** Short synthesised cues, no files, capped by the player's volume and
  mute. Every cue has a visual twin.
- **Dev playground** uses plain `px` because it is a developer tool that never ships; it is excluded
  from production builds.

## Review record

Reviewed in the browser lab at 1280×720, 1920×1080, 2560×1440 and 3440×1440 over dark, bright and
street scenes (see the report for screenshots). Defects found and fixed in review: circuit tiles
inheriting the wire stroke, the eyebrow repeating the title, pin labels hidden under pins, a
meaningless score on failure banners, and busy scenes bleeding through focused games.

In-game rendering, focus behaviour, controller delivery and restart behaviour are user-verified:
see [docs/runtime-validation.md](docs/runtime-validation.md).
