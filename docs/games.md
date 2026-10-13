# Game catalog and tuning

The tables below match the included `shared/catalog.json` and the `ListGames()` export.
Default timeouts are budgets, not measured completion times. Calibrate through playtesting.

## Tuning guide

- Start from a preset and override only what the fiction needs (`params = { channels = 1 }`). Presets map to concrete parameters; there is no global multiplier and no hidden mid-attempt adaptation.
- Routine actions: `timing` or a one-prompt `qte` on `easy` or `normal`. Meaningful tasks: a focused game or a two-to-three-step sequence. Do not make every job a sequence.
- A contradictory configuration (too short a timeout, a window below input precision, an impossible band) is rejected before focus with `invalid_params`, and `error.message` names the rule.
- A fixed `seed` reproduces the logical challenge exactly (RNG version 1). Use it to reproduce reports; never treat it as proof.
- Accessibility preferences change presentation and controls only. Reduced motion removes decoration but never slows judged motion.

Shared controls: `Esc`/`Backspace` (pad `B`) always cancels. Glyphs follow the last device used. Letter keys can be rebound (`/mgprefs key <action> <KeyCode>` or Cortex Settings); arrows, `Enter` and `Esc` stay as fallbacks.

Scoring shares one grade scale: success grades `perfect` at score 95 or more with no mistakes, `good` at 75 or more, otherwise `pass`.

## Timing Check (`timing`)

**Stop a travelling marker inside a lit window. Linear and circular are two presentations of one mechanic.** Presentation: compact.

**Controls.** Keyboard `Space`/`Enter`, mouse click on the surface, pad `A`.

**Rules.** The marker position is analytic in time, so a press is judged at its own event timestamp. The window is always reachable and never starts under the marker. Reversals (hard, expert) are telegraphed: the direction chevron turns sand 380 ms before the flip. Autorepeat never counts. A miss consumes one of `mistakes`; exceeding them fails (`missed` with no budget, `mistakes_exhausted` otherwise). Multi-round play is `rounds`; presses in the gap between rounds are ignored. A configuration whose window passes in under 70 ms is rejected (`window_too_fast`).

**Scoring.** Score = mean per-round accuracy (1 at the window centre, 0 at the edge, 0 for a miss) x 100. Perfect = every round inside the inner notch.

| Param | Range | easy | normal | hard | expert |
| --- | --- | --- | --- | --- | --- |
| `variant` | linear / circular | linear | linear | circular | circular |
| `rounds` | 1–5 | 1 | 1 | 2 | 3 |
| `cyclesPerSec` | 0.2–3 | 0.45 | 0.65 | 0.8 | 1.05 |
| `window` | 0.04–0.4 | 0.22 | 0.15 | 0.11 | 0.08 |
| `perfect` | 0–0.6 | 0.35 | 0.3 | 0.25 | 0.2 |
| `reversals` | true / false | false | false | true | true |
| `mistakes` | 0–3 | 1 | 0 | 0 | 0 |
| `roundGapMs` | 200–1500 | 500 | 450 | 400 | 350 |
| default timeout | | 7444 ms | 6027 ms | 8300 ms | 9264 ms |

Metrics: `rounds`, `hits`, `perfects`, `accuracy`, `meanOffset`. Minimum plausible success: 120 ms.

## Sequence Recall (`sequence`)

**Watch a short sequence of symbols light up, then reproduce it.** Presentation: compact.

**Controls.** Keyboard `WASD`/arrows (plus `Q`/`E` for the extended set), mouse click on a pad, pad D-pad (plus `LB`/`RB`).

**Rules.** Preview, ready, input and result are separate phases, labelled Watch / Your turn / Repeat. Symbols carry arrow shapes and key labels, never colour alone. Input during the preview is counted as `previewPresses` but costs nothing. Input arms only after the ready phase and after every key is released, so the key that was down at the transition cannot answer step one. Interference adds hollow decoy flashes in the gaps (never on the next real symbol). A wrong symbol costs a mistake and the step must be repeated. No triple repeats are generated.

**Scoring.** Score = completion x (85% accuracy + 15% speed). Accuracy = correct / (correct + mistakes); speed gives full marks at 400 ms per step or faster, none at 2 s. Speed is the only secondary factor.

| Param | Range | easy | normal | hard | expert |
| --- | --- | --- | --- | --- | --- |
| `length` | 3–10 | 4 | 5 | 6 | 8 |
| `symbols` | directions / extended | directions | directions | extended | extended |
| `previewMs` | 250–1500 | 900 | 700 | 560 | 460 |
| `mistakes` | 0–3 | 2 | 1 | 1 | 0 |
| `interference` | true / false | false | false | true | true |
| default timeout | | 12650 ms | 14050 ms | 15410 ms | 18730 ms |

Metrics: `length`, `correct`, `previewPresses`, `meanResponseMs`. Minimum plausible success: 600 ms.

## Pressure Control (`pressure`)

**Hold to raise pressure against constant decay and keep the needle in a moving safe band until the work meter fills.** Presentation: compact.

**Controls.** Keyboard hold `Space`, mouse hold on the gauge, pad hold `A` or squeeze `RT` (analog).

**Rules.** Pressure has inertia (acceleration and damping). Useful work accrues only inside the band. Outside, stress builds after `graceMs`, twice as fast at overpressure (the hatched zone); inside, stress drains slowly. The initial climb is never punished: stress only counts after the first entry. Full stress fails with `overstressed`. Waiting out the clock is never success. Physics run at a fixed 120 Hz with bounded catch-up. Configurations where the band moves faster than the needle can follow, or pressure cannot be built, are rejected.

**Scoring.** Score = work done x (70% time-in-band ratio + 30% (1 - peak stress)). `mistakes` counts band excursions.

| Param | Range | easy | normal | hard | expert |
| --- | --- | --- | --- | --- | --- |
| `rise` | 0.6–4 | 1.7 | 1.8 | 2 | 2.2 |
| `decay` | 0.2–2 | 0.8 | 0.85 | 0.9 | 1 |
| `damping` | 1–8 | 3 | 3 | 2.6 | 2.4 |
| `bandWidth` | 0.08–0.4 | 0.28 | 0.22 | 0.16 | 0.12 |
| `bandMotion` | 0–0.3 | 0.05 | 0.1 | 0.16 | 0.2 |
| `bandPeriodMs` | 2000–12000 | 7000 | 6000 | 5200 | 4600 |
| `workMs` | 2000–15000 | 4000 | 5500 | 7000 | 8000 |
| `stressMs` | 500–5000 | 3000 | 2200 | 1600 | 1200 |
| `graceMs` | 0–800 | 500 | 350 | 250 | 150 |
| default timeout | | 12959 ms | 16125 ms | 18942 ms | 20850 ms |

Metrics: `inBandRatio`, `maxStress`, `excursions`, `workDone`. Minimum plausible success: 1500 ms.

## Signal Lock (`signal_lock`)

**Search a band with coarse tuning, correct with fine tuning, and hold within tolerance until the channel locks.** Presentation: focused.

**Controls.** Keyboard `A`/`D` coarse, `Q`/`E` fine, `F` next channel, `W`/`S` polarisation (expert). Mouse drag across the scope (coarse), wheel (fine), click channel tabs. Pad left stick or D-pad coarse, `LB`/`RB` fine, `X` channel.

**Rules.** Signal bars rise as the tuner nears the target; the meter is nonlinear and never prints the target value. A lock needs the error inside `tolerance` for `dwellMs`. Leaving tolerance after 120 ms of dwell counts as a lock break. Drift (hard, expert) moves the target slowly and boundedly; expert adds a second axis. Switching channels keeps every tuner position; locked channels stay locked and the next unlocked channel is selected automatically. Tolerances below input precision and drift faster than fine tuning are rejected. This is a scanner, not a rotating ring.

**Scoring.** Score = completion x (60% stability + 40% lock accuracy). Stability = locks / (locks + breaks); accuracy = 1 - mean(error at lock / tolerance).

| Param | Range | easy | normal | hard | expert |
| --- | --- | --- | --- | --- | --- |
| `channels` | 1–3 | 1 | 2 | 2 | 3 |
| `tolerance` | 0.005–0.05 | 0.022 | 0.016 | 0.012 | 0.01 |
| `dwellMs` | 300–2500 | 600 | 700 | 850 | 900 |
| `coarseSpeed` | 0.12–0.6 | 0.3 | 0.3 | 0.32 | 0.34 |
| `fineSpeed` | 0.01–0.08 | 0.045 | 0.04 | 0.035 | 0.03 |
| `drift` | 0–0.03 | 0 | 0 | 0.01 | 0.01 |
| `secondAxis` | true / false | false | false | false | true |
| `searchWidth` | 0.06–0.3 | 0.22 | 0.18 | 0.14 | 0.12 |
| default timeout | | 9600 ms | 15400 ms | 15700 ms | 30700 ms |

Metrics: `channels`, `channelsLocked`, `alignmentError`, `lockBreaks`, `stability`. Minimum plausible success: 800 ms.

## Circuit Routing (`circuit_route`)

**Rotate parts so power runs from the source to every terminal without reaching a hazard, then test.** Presentation: focused.

**Controls.** Keyboard `WASD` select, `E`/`R` rotate clockwise, `Q` anticlockwise, `Space` test. Mouse click rotates, right-click rotates back, Test button. Pad D-pad, `RB`/`Y` and `LB`, `A`.

**Rules.** Boards are generated as a solved layout (the union of spanning-tree paths from the source to each terminal), validated, then scrambled. Hazards and distractors only fill cells the solution never uses, so every board is solvable by construction and never handed over already solved. Power flows only on Test, never while editing. A failed test consumes one of `tests` and shows which terminals lit and whether a hazard shorted; editing clears the overlay. Generation is bounded (24 attempts) with a verified fallback board, which the 400 tested seed/preset combinations never needed.

**Scoring.** Score = 60% efficiency + 40% test economy. Efficiency = baseline / rotations used, where the baseline is the minimum rotations from the scrambled layout to the generated solution (either direction; equivalent orientations of symmetric pieces count once). Test economy = 1 - (tests used - 1) / budget.

| Param | Range | easy | normal | hard | expert |
| --- | --- | --- | --- | --- | --- |
| `cols` | 4–7 | 4 | 5 | 6 | 7 |
| `rows` | 3–6 | 3 | 4 | 4 | 5 |
| `terminals` | 1–3 | 1 | 2 | 2 | 3 |
| `distractors` | 0–1 | 0.3 | 0.4 | 0.6 | 0.7 |
| `hazards` | 0–3 | 0 | 1 | 2 | 3 |
| `tests` | 1–5 | 4 | 3 | 2 | 2 |
| default timeout | | 19800 ms | 27000 ms | 30600 ms | 40500 ms |

Metrics: `testsUsed`, `rotations`, `baselineRotations`, `efficiency`, `fallback`. Minimum plausible success: 1200 ms.

## Pin & Tension (`pin_tension`)

**Hold tension in the working band, find the binding pin, lift it to its sweet spot and set it.** Presentation: focused.

**Controls.** Keyboard `A`/`D` pin, `W`/`S` lift, `Q`/`E` tension, `Space` set. Mouse click a pin, wheel lifts, drag the tension bar, Set button. Pad D-pad left/right, D-pad up/down or left stick, `LB`/`RB`, `A`.

**Rules.** Learnable rules: only the binding pin resists (pins bind in a fixed order per lock); the Feel readout says Loose, Binding, Slack or Too stiff, and the Resist meter peaks at the sweet spot, so audio is never needed. Set pins stay set while tension stays at or above the band's floor; slack for 450 ms drops the most recently set pin. Tension above the band builds stress; full stress fails with `tool_broke` (a reason only; the caller decides about inventory). A wrong set costs a mistake and some stress.

**Scoring.** Score = completion x (50% mistake economy + 30% (1 - peak stress) + 20% (1 - drops / pins)). Perfect also requires no drops.

| Param | Range | easy | normal | hard | expert |
| --- | --- | --- | --- | --- | --- |
| `pins` | 3–6 | 3 | 4 | 5 | 6 |
| `liftTolerance` | 0.04–0.25 | 0.12 | 0.09 | 0.07 | 0.055 |
| `tensionWindow` | 0.1–0.4 | 0.32 | 0.26 | 0.2 | 0.16 |
| `stressRate` | 0.2–2 | 0.5 | 0.7 | 0.9 | 1.1 |
| `recovery` | 0.05–0.6 | 0.3 | 0.22 | 0.16 | 0.12 |
| `setMistakes` | 0–6 | 4 | 3 | 2 | 1 |
| `tensionSpeed` | 0.2–0.9 | 0.5 | 0.5 | 0.45 | 0.4 |
| `liftSpeed` | 0.3–1.2 | 0.6 | 0.6 | 0.55 | 0.5 |
| default timeout | | 19500 ms | 24000 ms | 28500 ms | 33000 ms |

Metrics: `pins`, `pinsSet`, `drops`, `maxStress`. Minimum plausible success: 560 ms.

## Wave Match (`wave_match`)

**Adjust frequency, amplitude and phase until your solid trace sits on the dashed target, and hold it.** Presentation: focused.

**Controls.** Keyboard `W`/`S` control, `A`/`D` adjust, `Q`/`E` fine. Mouse drag a slider (rate-limited to key speed), wheel for fine. Pad D-pad up/down, left stick or D-pad left/right, `LB`/`RB`.

**Rules.** Target and player traces differ in stroke (dashed paper against solid mint), not only colour. Easy adjusts one axis, normal two, hard and expert all three; fixed axes show as Fixed. Error is the RMS difference sampled across the trace, so phase wraparound is fair: a phase and the same phase plus a full turn draw the same curve. Success = error under `tolerance` for `dwellMs`. The Match meter is nonlinear. Players start at least four tolerances away. This tests parameter matching; Signal Lock tests search and acquisition.

**Scoring.** Score = 50% final accuracy + 30% time + 20% / (1 + breaks).

| Param | Range | easy | normal | hard | expert |
| --- | --- | --- | --- | --- | --- |
| `axes` | 1–3 | 1 | 2 | 3 | 3 |
| `tolerance` | 0.03–0.2 | 0.11 | 0.09 | 0.075 | 0.055 |
| `dwellMs` | 300–2500 | 600 | 700 | 800 | 1000 |
| `adjustSpeed` | 0.15–0.8 | 0.35 | 0.35 | 0.32 | 0.3 |
| default timeout | | 10600 ms | 15700 ms | 20800 ms | 21000 ms |

Metrics: `axes`, `finalError`, `breaks`. Minimum plausible success: 280 ms.

## Trace Path (`trace_path`)

**Guide a probe down a corridor through ordered checkpoints.** Presentation: focused.

**Controls.** Keyboard `WASD`/arrows (diagonals normalised), pad left stick (analog), mouse: press on the probe and drag; the probe chases the pointer at 1.5x key speed.

**Rules.** Every movement is validated as a swept segment sampled at a third of the corridor width, so jumping across a bend registers contact. Grabbing only works near the probe; releasing or losing pointer capture leaves the probe where it is. Contact consumes tolerance: exceeding `maxContacts` entries or `contactBudgetMs` outside fails with `boundary_contact`. Checkpoints must be reached in order. Paths are generated with bounded turning, stay on the board, and keep non-adjacent sections at least three corridor widths apart; bounded retries with a verified fallback path.

**Scoring.** Score = completion x (50% (1 - mean deviation) + 30% (1 - contact time / budget) + 20% (1 - contacts / (max + 1))).

| Param | Range | easy | normal | hard | expert |
| --- | --- | --- | --- | --- | --- |
| `segments` | 3–10 | 4 | 6 | 7 | 9 |
| `corridor` | 0.025–0.09 | 0.075 | 0.06 | 0.047 | 0.036 |
| `checkpoints` | 2–6 | 2 | 3 | 4 | 5 |
| `contactBudgetMs` | 150–2000 | 1400 | 1000 | 700 | 450 |
| `maxContacts` | 1–6 | 5 | 4 | 3 | 2 |
| `speed` | 0.2–0.8 | 0.42 | 0.42 | 0.4 | 0.38 |
| default timeout | | 12495 ms | 13695 ms | 14600 ms | 16137 ms |

Metrics: `checkpoints`, `reached`, `contacts`, `contactMs`, `deviation`, `fallback`. Minimum plausible success: 700 ms.

## Pattern Rebuild (`pattern_rebuild`)

**Memorise where each piece sits and which way it faces, then rebuild the layout and submit.** Presentation: focused.

**Controls.** Keyboard `WASD` cell, `Q`/`E` choose piece, `R` rotate, `Space` place or lift, `F` submit. Mouse click a tray piece then a cell, drag from tray to cell, right-click rotates, Submit button. Pad D-pad, `LB`/`RB`, `Y`, `A`, `X`.

**Rules.** Pieces are polyomino glyphs. Each is unique, none has rotational symmetry, and none is a rotation of another (tested), so every target has exactly one correct placement and orientation. Input during the preview is ignored. A failed submission marks the correct cells with a check and consumes one of `submissions`. Spatial arrangement is the whole task; there is no order to remember.

**Scoring.** Score = (1 - failed submissions / (budget + 1)) x (80% + 20% time).

| Param | Range | easy | normal | hard | expert |
| --- | --- | --- | --- | --- | --- |
| `size` | 3–5 | 3 | 4 | 4 | 5 |
| `pieces` | 2–7 | 3 | 4 | 5 | 6 |
| `previewMs` | 1000–8000 | 4000 | 3500 | 3500 | 3200 |
| `rotation` | true / false | false | false | true | true |
| `submissions` | 1–4 | 3 | 2 | 2 | 1 |
| default timeout | | 22000 ms | 25500 ms | 37000 ms | 42200 ms |

Metrics: `pieces`, `submissions`, `correctCells`, `moves`. Minimum plausible success: 1200 ms.

## Pulse Sync (`pulse_sync`)

**Commit when every lane's pulse sits inside its bracket on the shared marker.** Presentation: focused.

**Controls.** Keyboard `W`/`S` lane, `F` park or unpark, `Space` sync. Mouse click a lane to park it, Sync button. Pad D-pad, `X`, `A`.

**Rules.** Lane periods differ. Phases are constructed so all pulses cross the marker together 1.8 to 3.6 s into each round, so a natural alignment always exists within the budget. Parking freezes a lane and spends a shared allowance (per parked lane per millisecond); it lets a skilled player align sooner, but gives up the guaranteed natural alignment for that round. A mistimed sync costs a mistake. Windows that pass in under 90 ms are rejected.

**Scoring.** Score = completion x (60% (1 - mean phase error) + 40% clean syncs / rounds).

| Param | Range | easy | normal | hard | expert |
| --- | --- | --- | --- | --- | --- |
| `tracks` | 2–4 | 2 | 3 | 3 | 4 |
| `periodMin` | 700–3000 | 1400 | 1200 | 1000 | 900 |
| `periodMax` | 900–4500 | 2200 | 2200 | 2000 | 1900 |
| `window` | 0.05–0.25 | 0.18 | 0.14 | 0.11 | 0.105 |
| `rounds` | 1–3 | 1 | 1 | 2 | 2 |
| `parkMs` | 0–8000 | 4000 | 3500 | 3000 | 2500 |
| `mistakes` | 0–3 | 2 | 1 | 1 | 0 |
| default timeout | | 10000 ms | 10000 ms | 17200 ms | 16800 ms |

Metrics: `rounds`, `cleanSyncs`, `phaseError`, `parkUsedMs`. Minimum plausible success: 450 ms.

## Mash (`mash`)

**Tap one key as fast as you can to fill a meter against constant decay.** Presentation: compact.

**Controls.** Keyboard `Space`/`Enter` and pad `A` for the default action; configured actions use their matching key and pad glyph. Mouse press on the keycap.

**Rules.** The meter drains at `decay` per second and each accepted tap adds `gain`. Holding the key is one tap (autorepeat and a second press without a release never count), and taps closer than `1000 / maxRate` ms are ignored. The cap limits accepted input rate; it does not prove human input. Waiting never helps; the attempt only times out. Presets and default budgets use a sustained 7 taps per second. Configurations whose break-even rate (`decay / gain`) exceeds 70% of either that rate or `maxRate` are rejected (`mash_rate_unreachable`), as are budgets below 1.3 times the estimated fill time at 7 taps per second plus 500 ms. The keycap sits inside a thick accent ring (the meter) and presses on every tap; the fill prints as a number.

**Scoring.** Success scores from 40% to 100% according to completion time: full marks at the estimated 10 taps per second pace (or half the budget, whichever is sooner), falling to 40% at the deadline. A failed attempt scores half its peak fill. `mistakes` is always 0.

| Param | Range | easy | normal | hard | expert |
| --- | --- | --- | --- | --- | --- |
| `action` | primary / alt / next / prev / rotate | primary | primary | primary | primary |
| `gain` | 0.02–0.3 | 0.1 | 0.1 | 0.09 | 0.1 |
| `decay` | 0.05–1 | 0.2 | 0.3 | 0.36 | 0.48 |
| `maxRate` | 6–20 | 14 | 16 | 18 | 20 |
| default timeout | | 8000 ms | 9250 ms | 12259 ms | 14364 ms |

Metrics: `taps`, `ignored`, `peak`, `rate`. Minimum plausible success: 120 ms.

## Trace Sweep (`trace`)

**Turn a virtual knob along a half ring in one sweep: lower 3 -> 6 -> 9 o'clock, upper 3 -> 12 -> 9.** Presentation: compact.

**Controls.** Mouse: just move it (no button); the cursor is shown in `auto` mode because this game declares `cursor`. Keyboard `WASD`/arrows draw in a direction (lower: down, left, up). Pad: left stick or D-pad, same idea: rotate the stick along the arc.

**Rules.** The same model as cortex-lib's native mouse trace. The knob sits on the ring at 3 o'clock; every motion delta is added to it and projected back onto the ring, so tangential motion turns it and radial motion does nothing. The knob radius is 90 CSS px divided by `sensitivity` (pixels, not `--u`, because a mouse moves the pointer in pixels at every resolution). Deltas more than ~75 degrees off the tangent are ignored, sub-steps that would cross the centre are ignored, and large deltas are sub-stepped, so a straight swipe in any direction stalls by ~151 degrees and a teleporting pointer cannot jump. The knob may slide back at most `tolerance` of a half turn below its best position: wobble never resets and jiggling nets zero. Pauses cost nothing; after 1.5 s idle the knob eases back at 0.35 of the sweep per second. A sweep completes at 96% (173 degrees). With `sweeps` above 1 the knob resets after each sweep, input pauses 350 ms, and each sweep's direction is fixed or seeded (`random`).

**Scoring.** Score = sweep completion x (75% (1 - time / budget) + 25% (1 - backtrack / half turn)). `mistakes` is always 0.

| Param | Range | easy | normal | hard | expert |
| --- | --- | --- | --- | --- | --- |
| `direction` | upper / lower / random | upper | random | random | random |
| `sweeps` | 1–3 | 1 | 1 | 2 | 3 |
| `tolerance` | 0.08–0.4 | 0.2 | 0.15 | 0.12 | 0.1 |
| `sensitivity` | 0.25–4 | 1.3 | 1 | 1 | 0.85 |
| default timeout | | 7000 ms | 7000 ms | 10000 ms | 13000 ms |

Metrics: `sweeps`, `travel`, `backtrack`, `eases`. Minimum plausible success: 150 ms.

## Quick Time (QTE) (`qte`)

**A bounded chain of prompts built from allowlisted primitives.** Presentation: compact.

**Controls.** Any QTE action: `up`, `down`, `left`, `right`, `primary`, `alt`, `prev`, `next`, `rotate`. Keycaps show the current device's glyph; the mouse can press or hold a keycap.

**Rules.** Each prompt has a lead (input ignored, never charged), then its window. `press`: one rising edge. `hold`: hold for `durationMs`; `earlyRelease = 'fail'` fails, `'restart'` costs a mistake and re-arms. `release`: hold, then release while the sweep is inside the target zone. `alternate`: alternate two actions `count` times; repeats do not advance. `chord`: 2 or 3 actions pressed inside the window within `toleranceMs` of each other (keys held from the lead do not count). `react`: wait for the cue after a random delay; early input costs a mistake and re-arms. `tap`: `count` taps, where taps closer than 80 ms are ignored (bounded, not a mash). A failed prompt costs a mistake and is retried while mistakes remain.

**Scoring.** Score = completion x mean prompt quality x (1 - 0.2 x mistakes). Quality falls from 1 as the window is used up (reaction time for `react`, zone centring for `release`).

| Param | Range | easy | normal | hard | expert |
| --- | --- | --- | --- | --- | --- |
| `prompts` | list ≤ 8 | 1 prompt | 1 prompt | 2 prompts | 3 prompts |
| `mistakes` | 0–3 | 1 | 0 | 0 | 0 |
| `leadMs` | 250–1500 | 700 | 600 | 500 | 450 |
| default timeout | | 6620 ms | 3460 ms | 5670 ms | 11130 ms |

Metrics: `prompts`, `completed`, `meanReactionMs`. Minimum plausible success: 150 ms.
