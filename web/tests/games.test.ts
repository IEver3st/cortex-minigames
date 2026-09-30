// Mechanics fixtures: known inputs produce known outcomes, and a competent scripted player can
// finish every preset. Bots read hidden state; they prove solvability, not difficulty.

import { describe, expect, test } from 'bun:test';
import { gradeFor } from '../src/core/result';
import { prepare } from '../src/core/prepare';
import { GAMES } from '../src/games/registry';
import { PRESETS, type Action } from '../src/core/types';
import { position, type TimingState } from '../src/games/timing/logic';
import { phase, type SequenceState } from '../src/games/sequence/logic';
import { bandCenter, type PressureState } from '../src/games/pressure/logic';
import { targetAt, type SignalState } from '../src/games/signal_lock/logic';
import type { CircuitState } from '../src/games/circuit_route/logic';
import type { PinState } from '../src/games/pin_tension/logic';
import { AXES, type WaveState } from '../src/games/wave_match/logic';
import type { TraceState } from '../src/games/trace_path/logic';
import type { PatternState } from '../src/games/pattern_rebuild/logic';
import { inWindow, type PulseState } from '../src/games/pulse_sync/logic';
import { breakEvenRate, type MashState } from '../src/games/mash/logic';
import { COMPLETE, GAP_MS, progress, type TraceSweepState } from '../src/games/trace/logic';
import { engineFor, runPolicy, runScript, type Scripted } from './harness';

describe('registry', () => {
  test('twelve catalog games plus the QTE module, unique ids', () => {
    expect(GAMES.length).toBe(13);
    expect(new Set(GAMES.map((g) => g.id)).size).toBe(13);
  });
  test('every preset of every game passes its own schema and contradiction checks', () => {
    for (const game of GAMES) for (const preset of PRESETS) {
      const result = prepare({ game: game.id, preset });
      expect({ game: game.id, preset, ok: result.ok, error: result.ok ? null : result.error }).toEqual({ game: game.id, preset, ok: true, error: null });
    }
  });
  test('unknown params, bad types and contradictions are rejected before play', () => {
    expect(prepare({ game: 'nope' })).toMatchObject({ ok: false, error: { reason: 'unknown_game' } });
    expect(prepare({ game: 'timing', params: { speed: 2 } })).toMatchObject({ ok: false, error: { reason: 'invalid_params', field: 'speed' } });
    expect(prepare({ game: 'timing', params: { rounds: 1.5 } })).toMatchObject({ ok: false, error: { reason: 'invalid_params' } });
    expect(prepare({ game: 'timing', params: { window: 0.04, cyclesPerSec: 3 } })).toMatchObject({ ok: false, error: { message: 'window_too_fast' } });
    expect(prepare({ game: 'pulse_sync', params: { periodMin: 2000, periodMax: 1000 } })).toMatchObject({ ok: false, error: { message: 'period_range_inverted' } });
    expect(prepare({ game: 'timing', timeoutMs: 10 })).toMatchObject({ ok: false, error: { field: 'timeoutMs' } });
    expect(prepare({ game: 'timing', seed: -1 })).toMatchObject({ ok: false, error: { field: 'seed' } });
    expect(prepare({ game: 'qte', params: { prompts: [{ type: 'press', actions: ['cancel'], windowMs: 900 }] } })).toMatchObject({ ok: false });
    expect(prepare({ game: 'qte', params: { prompts: [{ type: 'press', actions: ['primary'], windowMs: 900, run: 'os.exit()' }] } })).toMatchObject({ ok: false });
  });
});

describe('grades', () => {
  test('grade never contradicts status', () => {
    expect(gradeFor('failed', { score: 99, mistakes: 0 })).toBe('fail');
    expect(gradeFor('timeout', { score: 99, mistakes: 0 })).toBe('fail');
    expect(gradeFor('cancelled', { score: 99, mistakes: 0 })).toBeNull();
    expect(gradeFor('success', { score: 99, mistakes: 1 })).toBe('good');
    expect(gradeFor('success', { score: 96, mistakes: 0 })).toBe('perfect');
    expect(gradeFor('success', { score: 40, mistakes: 0 })).toBe('pass');
  });
});

describe('timing', () => {
  const spec = { game: 'timing', preset: 'normal', seed: 7 };
  const centerTime = (s: TimingState) => {
    const round = s.rounds[0];
    const speed = 2 * s.p.cyclesPerSec / 1000;
    return (round.a + s.p.window / 2) / speed;
  };
  test('press at the window centre is a perfect hit', () => {
    const engine = engineFor(spec);
    const outcome = runScript(engine, [{ at: centerTime(engine.state), press: 'primary' }], 60);
    expect(outcome).toEqual({ status: 'success', reason: 'completed' });
    const report = engine.report();
    expect(report.metrics.perfects).toBe(1);
    expect(report.score).toBeGreaterThanOrEqual(99);
  });
  test('press just outside the window misses', () => {
    const engine = engineFor(spec);
    const s = engine.state as TimingState;
    const speed = 2 * s.p.cyclesPerSec / 1000;
    const outcome = runScript(engine, [{ at: (s.rounds[0].a - 0.01) / speed, press: 'primary' }], 60);
    expect(outcome).toEqual({ status: 'failed', reason: 'missed' });
  });
  test('window edges are inclusive boundaries', () => {
    const engine = engineFor(spec);
    const s = engine.state as TimingState;
    const speed = 2 * s.p.cyclesPerSec / 1000;
    expect(runScript(engine, [{ at: (s.rounds[0].a + 0.0005) / speed, press: 'primary' }], 60)?.status).toBe('success');
  });
  test('autorepeat (press without release) is ignored', () => {
    const engine = engineFor({ ...spec, params: { mistakes: 1, rounds: 2 } });
    const s = engine.state as TimingState;
    const speed = 2 * s.p.cyclesPerSec / 1000;
    const miss = (s.rounds[0].a - 0.05) / speed;
    runScript(engine, [{ at: miss, press: 'primary' }, { at: miss + 30, press: 'primary' }, { at: miss + 60, press: 'primary' }], 60, miss + 200);
    expect(s.misses).toBe(1);
  });
  test('circular variant with telegraphed reversals stays winnable', () => {
    for (let seed = 0; seed < 20; seed++) {
      const engine = engineFor({ game: 'timing', preset: 'expert', seed });
      const outcome = runPolicy(engine, (state: TimingState, t) => {
        const round = state.rounds[state.current];
        if (!round || round.judged || t < round.start) return [];
        const pos = position(state, t + 8);
        const center = round.a + state.p.window / 2;
        const d = Math.min(Math.abs(pos - center), 1 - Math.abs(pos - center));
        return d < state.p.window * 0.25 ? { tap: ['primary'] } : [];
      }, 144);
      expect(outcome?.status).toBe('success');
    }
  });
});

describe('sequence', () => {
  test('preview input is ignored, ready key is debounced, correct replay succeeds', () => {
    const engine = engineFor({ game: 'sequence', preset: 'normal', seed: 3 });
    const s = engine.state as SequenceState;
    const script: any[] = [{ at: 400, press: 'up' }, { at: 450, release: 'up' }];
    // Key held across the ready transition must be released before input arms.
    script.push({ at: s.readyEnd - 50, press: s.seq[0] }, { at: s.readyEnd + 100, release: s.seq[0] });
    let t = s.readyEnd + 300;
    for (const symbol of s.seq) { script.push({ at: t, press: symbol }, { at: t + 60, release: symbol }); t += 220; }
    const outcome = runScript(engine, script, 60);
    expect(outcome).toEqual({ status: 'success', reason: 'completed' });
    expect(s.previewPresses).toBe(1);
    expect(s.mistakes).toBe(0);
  });
  test('wrong symbols consume the mistake budget, then fail', () => {
    const engine = engineFor({ game: 'sequence', preset: 'normal', seed: 3 });
    const s = engine.state as SequenceState;
    const wrong = (['up', 'right', 'down', 'left'] as Action[]).find((a) => a !== s.seq[0])!;
    let t = s.readyEnd + 200;
    const script: any[] = [];
    for (let i = 0; i < 3; i++) { script.push({ at: t, press: wrong }, { at: t + 50, release: wrong }); t += 200; }
    expect(runScript(engine, script, 60)).toEqual({ status: 'failed', reason: 'mistakes_exhausted' });
    expect(s.mistakes).toBe(2);
  });
  test('phases progress preview → ready → input', () => {
    const engine = engineFor({ game: 'sequence', preset: 'easy', seed: 1 });
    const s = engine.state as SequenceState;
    expect(phase(s, 10)).toBe('preview');
    expect(phase(s, s.previewEnd + 1)).toBe('ready');
  });
});

describe('continuous games are solvable by a competent player', () => {
  test('pressure: feathering the input inside the band completes the work', () => {
    for (const preset of PRESETS) {
      const engine = engineFor({ game: 'pressure', preset, seed: 11 });
      const outcome = runPolicy(engine, (s: PressureState, t) => (s.pressure + s.velocity * 0.18 < bandCenter(s, t + 150) ? ['primary'] : []));
      expect({ preset, outcome }).toEqual({ preset, outcome: { status: 'success', reason: 'completed' } });
    }
  });
  test('pressure: holding flat out overpressures and fails with stress', () => {
    const engine = engineFor({ game: 'pressure', preset: 'normal', seed: 11 });
    expect(runPolicy(engine, () => ['primary'])).toEqual({ status: 'failed', reason: 'overstressed' });
  });
  test('pressure: doing nothing times out without stress (never entered the band)', () => {
    const engine = engineFor({ game: 'pressure', preset: 'normal', seed: 11 });
    expect(runPolicy(engine, () => [])).toEqual({ status: 'timeout', reason: 'time_expired' });
    expect((engine.state as PressureState).stress).toBe(0);
  });
  test('signal lock: coarse then fine tuning locks every channel', () => {
    for (const preset of PRESETS) {
      const engine = engineFor({ game: 'signal_lock', preset, seed: 5 });
      const outcome = runPolicy(engine, (s: SignalState, t) => {
        const c = s.channels[s.active];
        const held: Action[] = [];
        const diff = targetAt(s, c, t + 50) - c.tune;
        if (Math.abs(diff) > 0.03) held.push(diff > 0 ? 'right' : 'left');
        else if (Math.abs(diff) > s.p.tolerance * 0.3) held.push(diff > 0 ? 'next' : 'prev');
        if (s.p.secondAxis) {
          const d2 = c.target2 - c.tune2;
          if (Math.abs(d2) > s.p.tolerance * 0.5) held.push(d2 > 0 ? 'up' : 'down');
        }
        return held;
      });
      expect({ preset, outcome }).toEqual({ preset, outcome: { status: 'success', reason: 'completed' } });
    }
  });
  test('wave match: adjusting each control toward the target confirms the match', () => {
    for (const preset of PRESETS) {
      const engine = engineFor({ game: 'wave_match', preset, seed: 9 });
      const outcome = runPolicy(engine, (s: WaveState) => {
        for (let k = 0; k < s.adjustable.length; k++) {
          const i = AXES.indexOf(s.adjustable[k]);
          let diff = s.target[i] - s.controls[i];
          if (s.adjustable[k] === 'phase') diff = ((diff + 1.5) % 1) - 0.5;
          if (Math.abs(diff) > 0.002) {
            if (s.selected !== k) return { tap: [k > s.selected ? 'down' : 'up'] };
            return [Math.abs(diff) > 0.02 ? (diff > 0 ? 'right' : 'left') : diff > 0 ? 'next' : 'prev'];
          }
        }
        return [];
      });
      expect({ preset, outcome }).toEqual({ preset, outcome: { status: 'success', reason: 'completed' } });
    }
  });
  test('trace path: following the centre line reaches every checkpoint with no contact', () => {
    for (const preset of PRESETS) {
      const engine = engineFor({ game: 'trace_path', preset, seed: 4 });
      const outcome = runPolicy(engine, (s: TraceState) => {
        const goal = s.checkpoints[s.reached] ?? s.path[s.path.length - 1];
        // Aim at the next vertex that lies before the next checkpoint along the path.
        let aim = goal;
        let best = Infinity;
        for (let i = 1; i < s.path.length; i++) {
          const v = s.path[i];
          const d = Math.hypot(v.x - s.probe.x, v.y - s.probe.y);
          if (d > s.p.corridor * 0.5 && d < best && s.lengths[i] >= projected(s)) { best = d; aim = v; }
        }
        return { pointer: [{ kind: 'target', x: aim.x, y: aim.y, grab: true }] };
      });
      expect({ preset, outcome, contacts: (engine.state as TraceState).contacts }).toEqual({ preset, outcome: { status: 'success', reason: 'completed' }, contacts: 0 });
    }
  });
  test('trace path: cutting across a bend is caught by swept validation', () => {
    const engine = engineFor({ game: 'trace_path', preset: 'normal', seed: 4 });
    const s = engine.state as TraceState;
    const end = s.path[s.path.length - 1];
    runPolicy(engine, () => ({ pointer: [{ kind: 'target', x: end.x, y: end.y, grab: true }] }), 60, 6000);
    expect(s.contacts).toBeGreaterThan(0);
    expect(engine.outcome?.status).not.toBe('success');
  });
  test('pulse sync: committing at a natural alignment succeeds; early commits cost mistakes', () => {
    for (const preset of PRESETS) {
      const engine = engineFor({ game: 'pulse_sync', preset, seed: 2 });
      const outcome = runPolicy(engine, (s: PulseState) => (s.lanes.every((lane) => inWindow(s, lane)) ? { tap: ['primary'] } : []), 144);
      expect({ preset, outcome }).toEqual({ preset, outcome: { status: 'success', reason: 'completed' } });
    }
    const engine = engineFor({ game: 'pulse_sync', preset: 'normal', seed: 2 });
    const s = engine.state as PulseState;
    runScript(engine, [{ at: 100, press: 'primary' }], 60, 200);
    expect(s.mistakes).toBe(1);
  });
});

function projected(s: TraceState): number {
  let best = Infinity, along = 0;
  for (let i = 0; i < s.path.length - 1; i++) {
    const a = s.path[i], b = s.path[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((s.probe.x - a.x) * dx + (s.probe.y - a.y) * dy) / len2));
    const d = Math.hypot(s.probe.x - (a.x + t * dx), s.probe.y - (a.y + t * dy));
    if (d < best) { best = d; along = s.lengths[i] + t * Math.sqrt(len2); }
  }
  return along;
}

describe('discrete puzzles', () => {
  test('circuit: rotating every part to its solved orientation then testing succeeds', () => {
    for (const preset of PRESETS) {
      const engine = engineFor({ game: 'circuit_route', preset, seed: 21 });
      const s = engine.state as CircuitState;
      const outcome = runPolicy(engine, (state: CircuitState) => {
        const index = state.tiles.findIndex((tile) => !tile.fixed && tile.mask !== tile.solved);
        if (index >= 0) return { pointer: [{ kind: 'cell', index, button: 0 }] };
        return { tap: ['primary'] };
      });
      expect({ preset, outcome }).toEqual({ preset, outcome: { status: 'success', reason: 'completed' } });
      expect(s.testsUsed).toBe(1);
    }
  });
  test('circuit: failed tests consume the budget and fail', () => {
    const engine = engineFor({ game: 'circuit_route', preset: 'hard', seed: 21 });
    expect(runPolicy(engine, () => ({ tap: ['primary'] }))).toEqual({ status: 'failed', reason: 'tests_exhausted' });
  });
  test('pin & tension: correct tension, binding order and lift sets every pin', () => {
    for (const preset of PRESETS) {
      const engine = engineFor({ game: 'pin_tension', preset, seed: 6 });
      const outcome = runPolicy(engine, (s: PinState) => {
        const mid = (s.lo + s.hi) / 2;
        const held: Action[] = [];
        if (Math.abs(s.tension - mid) > s.p.tensionWindow * 0.2) held.push(s.tension < mid ? 'next' : 'prev');
        const want = s.order[s.bound];
        if (want === undefined) return held;
        if (s.selected !== want) return { hold: held, tap: [want > s.selected ? 'right' : 'left'] };
        const pin = s.pins[want];
        const diff = pin.sweet - pin.lift;
        if (Math.abs(diff) > s.p.liftTolerance * 0.4) { held.push(diff > 0 ? 'up' : 'down'); return held; }
        if (held.length) return held;
        return { tap: ['primary'] };
      });
      const s = engine.state as PinState;
      expect({ preset, outcome, mistakes: s.mistakes }).toEqual({ preset, outcome: { status: 'success', reason: 'completed' }, mistakes: 0 });
    }
  });
  test('pin & tension: over-tension breaks the tool; slack drops set pins', () => {
    const over = engineFor({ game: 'pin_tension', preset: 'normal', seed: 6 });
    expect(runPolicy(over, () => ['next'])).toEqual({ status: 'failed', reason: 'tool_broke' });
    const slack = engineFor({ game: 'pin_tension', preset: 'easy', seed: 6 });
    const s = slack.state as PinState;
    s.tension = (s.lo + s.hi) / 2;
    s.pins[s.order[0]].set = true; s.bound = 1;
    runPolicy(slack, () => ['prev'], 60, 2500);
    expect(s.drops).toBeGreaterThanOrEqual(1);
  });
  test('pattern: placing each piece with the revealed orientation solves on the first submission', () => {
    for (const preset of PRESETS) {
      const engine = engineFor({ game: 'pattern_rebuild', preset, seed: 13 });
      const outcome = runPolicy(engine, (s: PatternState, t) => {
        if (t < s.previewEnd + 50) return [];
        for (const goal of s.target) {
          const placed = s.board[goal.cell];
          if (!placed) {
            const index = s.tray.findIndex((piece) => piece.glyph === goal.glyph);
            if (index < 0) { // wrong piece sitting there is impossible here, but lift anything misplaced
              return [];
            }
            if (s.selected !== index) return { pointer: [{ kind: 'tray', index }] };
            return { pointer: [{ kind: 'cell', index: goal.cell, button: 0 }] };
          }
          if (s.p.rotation && placed.rotation !== goal.rotation) return { pointer: [{ kind: 'cell', index: goal.cell, button: 2 }] };
        }
        return { pointer: [{ kind: 'select', index: -1 }] };
      });
      expect({ preset, outcome, subs: (engine.state as PatternState).submissionsUsed }).toEqual({ preset, outcome: { status: 'success', reason: 'completed' }, subs: 1 });
    }
  });
  test('pattern: input during the preview is ignored', () => {
    const engine = engineFor({ game: 'pattern_rebuild', preset: 'normal', seed: 13 });
    runScript(engine, [{ at: 300, press: 'primary' }, { at: 400, release: 'primary' }], 60, 800);
    expect((engine.state as PatternState).moves).toBe(0);
  });
});

describe('qte primitives', () => {
  const run = (prompt: object, script: any[], extra: object = {}) => {
    const engine = engineFor({ game: 'qte', params: { prompts: [prompt], mistakes: 0, leadMs: 500, ...extra } });
    return { outcome: runScript(engine, script, 60), engine };
  };
  test('press inside the window succeeds; lead presses are ignored', () => {
    expect(run({ type: 'press', actions: ['primary'], windowMs: 800 }, [
      { at: 200, press: 'primary' }, { at: 250, release: 'primary' }, { at: 700, press: 'primary' },
    ]).outcome).toEqual({ status: 'success', reason: 'completed' });
  });
  test('press window expiry fails', () => {
    expect(run({ type: 'press', actions: ['primary'], windowMs: 800 }, []).outcome).toEqual({ status: 'failed', reason: 'missed' });
  });
  test('hold for the duration succeeds; early release fails', () => {
    expect(run({ type: 'hold', actions: ['alt'], windowMs: 800, durationMs: 700 }, [{ at: 600, press: 'alt' }]).outcome?.status).toBe('success');
    expect(run({ type: 'hold', actions: ['alt'], windowMs: 800, durationMs: 700 }, [{ at: 600, press: 'alt' }, { at: 900, release: 'alt' }]).outcome)
      .toEqual({ status: 'failed', reason: 'early_release' });
  });
  test('release inside the target succeeds, outside fails', () => {
    const prompt = { type: 'release', actions: ['primary'], windowMs: 900, durationMs: 1000, targetStart: 0.5, targetWidth: 0.2 };
    expect(run(prompt, [{ at: 600, press: 'primary' }, { at: 600 + 600, release: 'primary' }]).outcome?.status).toBe('success');
    expect(run(prompt, [{ at: 600, press: 'primary' }, { at: 600 + 300, release: 'primary' }]).outcome?.status).toBe('failed');
  });
  test('alternate counts only changes of key', () => {
    const script: any[] = [];
    let t = 600;
    for (let i = 0; i < 6; i++) { const a = i % 2 ? 'right' : 'left'; script.push({ at: t, press: a }, { at: t + 40, release: a }); t += 120; }
    expect(run({ type: 'alternate', actions: ['left', 'right'], windowMs: 2000, count: 6 }, script).outcome?.status).toBe('success');
    const repeats: any[] = [];
    t = 600;
    for (let i = 0; i < 10; i++) { repeats.push({ at: t, press: 'left' }, { at: t + 40, release: 'left' }); t += 120; }
    expect(run({ type: 'alternate', actions: ['left', 'right'], windowMs: 2000, count: 6 }, repeats).outcome?.status).toBe('failed');
  });
  test('chord within tolerance succeeds; keys held from the lead do not count', () => {
    expect(run({ type: 'chord', actions: ['prev', 'next'], windowMs: 1000, toleranceMs: 150 }, [{ at: 600, press: 'prev' }, { at: 680, press: 'next' }]).outcome?.status).toBe('success');
    expect(run({ type: 'chord', actions: ['prev', 'next'], windowMs: 1000, toleranceMs: 150 }, [{ at: 600, press: 'prev' }, { at: 900, press: 'next' }]).outcome?.status).toBe('failed');
    expect(run({ type: 'chord', actions: ['prev', 'next'], windowMs: 1000, toleranceMs: 150 }, [{ at: 100, press: 'prev' }, { at: 700, press: 'next' }]).outcome?.status).toBe('failed');
  });
  test('react: early input costs a mistake; response after the cue succeeds', () => {
    const early = engineFor({ game: 'qte', params: { prompts: [{ type: 'react', actions: ['primary'], windowMs: 700, minDelayMs: 1000, maxDelayMs: 1000 }], mistakes: 1, leadMs: 500 } });
    runScript(early, [{ at: 800, press: 'primary' }], 60, 1400);
    expect(early.state.mistakes).toBe(1);
    expect(early.outcome).toBeNull();
    const ok = run({ type: 'react', actions: ['primary'], windowMs: 700, minDelayMs: 1000, maxDelayMs: 1000 }, [{ at: 1500 + 200, press: 'primary' }]);
    expect(ok.outcome?.status).toBe('success');
    expect(ok.engine.report().metrics.meanReactionMs).toBe(200);
  });
  test('tap ignores taps faster than the rate cap', () => {
    const script: any[] = [];
    for (let i = 0; i < 10; i++) script.push({ at: 600 + i * 30, press: 'primary' }, { at: 610 + i * 30, release: 'primary' });
    const { engine } = run({ type: 'tap', actions: ['primary'], windowMs: 1500, count: 6 }, script);
    expect(engine.state.run.progress).toBeLessThan(6);
  });
});

describe('mash', () => {
  const taps = (every: number, until: number, from = 100): Scripted[] => {
    const out: Scripted[] = [];
    for (let t = from; t < until; t += every) out.push({ at: t, press: 'primary' }, { at: t + every / 2, release: 'primary' });
    return out;
  };
  test('a steady human rate fills the meter on every preset', () => {
    for (const preset of PRESETS) {
      const engine = engineFor({ game: 'mash', preset, seed: 1 });
      const rate = (engine.state as MashState).p.maxRate * 0.75;
      const outcome = runScript(engine, taps(1000 / rate, engine.timeoutMs), 60);
      expect({ preset, outcome }).toEqual({ preset, outcome: { status: 'success', reason: 'completed' } });
    }
  });
  test('tapping below the break-even rate drains to a timeout', () => {
    const engine = engineFor({ game: 'mash', preset: 'normal', seed: 1 });
    const slow = 1000 / (breakEvenRate((engine.state as MashState).p) * 0.6);
    expect(runScript(engine, taps(slow, engine.timeoutMs), 60)).toEqual({ status: 'timeout', reason: 'time_expired' });
  });
  test('holding the key is one tap; taps above the rate cap are ignored', () => {
    const held = engineFor({ game: 'mash', preset: 'easy', seed: 1 });
    runScript(held, [{ at: 100, press: 'primary' }, { at: 150, press: 'primary' }, { at: 200, press: 'primary' }], 60, 400);
    expect((held.state as MashState).taps).toBe(1);
    const fast = engineFor({ game: 'mash', preset: 'normal', seed: 1 });
    runScript(fast, taps(20, 1100), 144, 1100);
    const s = fast.state as MashState;
    expect(s.ignored).toBeGreaterThan(0);
    expect(s.taps).toBeLessThanOrEqual(s.p.maxRate + 1);
  });
  test('other actions never fill the meter; an unreachable rate is rejected', () => {
    const engine = engineFor({ game: 'mash', preset: 'easy', seed: 1 });
    runScript(engine, [{ at: 100, press: 'alt' }, { at: 150, release: 'alt' }], 60, 300);
    expect((engine.state as MashState).taps).toBe(0);
    expect(prepare({ game: 'mash', params: { gain: 0.02, decay: 1, maxRate: 6 } })).toMatchObject({ ok: false, error: { message: 'mash_rate_unreachable' } });
  });
});

describe('trace sweep', () => {
  /** Drag deltas along a semicircle of `radius` px from its rightmost point. */
  const arc = (dir: 'upper' | 'lower', radius: number, samples: number, opts: { wrong?: boolean; wobble?: number } = {}) => {
    const sign = (dir === 'upper' ? -1 : 1) * (opts.wrong ? -1 : 1);
    const out: { dx: number; dy: number }[] = [];
    let px = 0, py = 0;
    for (let i = 1; i <= samples; i++) {
      const a = (Math.PI * i) / samples;
      const r = radius * (1 + (opts.wobble ?? 0) * Math.sin(i * 0.5));
      const x = -radius + r * Math.cos(a), y = sign * r * Math.sin(a);
      out.push({ dx: x - px, dy: y - py });
      px = x; py = y;
    }
    return out;
  };
  const drive = (engine: ReturnType<typeof engineFor>, moves: { dx: number; dy: number }[], t0: number, dt = 16) => {
    let t = t0;
    for (const move of moves) { t += dt; engine.pointer({ kind: 'drag', ...move }, t); engine.advance(t); }
    return t;
  };
  test('one mouse sweep per round completes every preset, in each round direction', () => {
    for (const preset of PRESETS) {
      const engine = engineFor({ game: 'trace', preset, seed: 5 });
      const s = engine.state as TraceSweepState;
      engine.start(0);
      let t = 0;
      for (let round = 0; round < s.p.sweeps; round++) {
        t = drive(engine, arc(s.directions[round], 150, 40), t) + GAP_MS + 20;
        engine.advance(t);
      }
      expect({ preset, outcome: engine.outcome }).toEqual({ preset, outcome: { status: 'success', reason: 'completed' } });
    }
  });
  test('a small wobbly sweep completes; a pause mid-sweep costs nothing', () => {
    const wobbly = engineFor({ game: 'trace', preset: 'normal', params: { direction: 'lower' }, seed: 5 });
    wobbly.start(0);
    drive(wobbly, arc('lower', 100, 50, { wobble: 0.25 }), 0);
    expect(wobbly.outcome?.status).toBe('success');
    const paused = engineFor({ game: 'trace', preset: 'normal', params: { direction: 'upper' }, seed: 5 });
    paused.start(0);
    const moves = arc('upper', 150, 40);
    let t = drive(paused, moves.slice(0, 20), 0);
    const mid = progress(paused.state as TraceSweepState);
    t += 1000;
    paused.advance(t);
    expect(progress(paused.state as TraceSweepState)).toBe(mid);
    drive(paused, moves.slice(20), t);
    expect(paused.outcome?.status).toBe('success');
  });
  test('straight swipes, the mirrored arc and a teleporting pointer never complete', () => {
    for (const [dx, dy] of [[-15, 0], [15, 0], [0, 15], [0, -15], [-10, 10], [-14.5, 3.5]]) {
      for (const dir of ['upper', 'lower'] as const) {
        const engine = engineFor({ game: 'trace', preset: 'normal', params: { direction: dir }, seed: 5 });
        engine.start(0);
        drive(engine, Array.from({ length: 200 }, () => ({ dx, dy })), 0);
        expect({ dx, dy, dir, outcome: engine.outcome, short: progress(engine.state as TraceSweepState) < COMPLETE })
          .toEqual({ dx, dy, dir, outcome: null, short: true });
      }
    }
    const mirrored = engineFor({ game: 'trace', preset: 'normal', params: { direction: 'lower' }, seed: 5 });
    mirrored.start(0);
    drive(mirrored, arc('lower', 150, 40, { wrong: true }), 0);
    expect(mirrored.outcome).toBeNull();
    const jump = engineFor({ game: 'trace', preset: 'normal', params: { direction: 'lower' }, seed: 5 });
    jump.start(0);
    drive(jump, [{ dx: -5000, dy: 40 }], 0);
    expect(progress(jump.state as TraceSweepState)).toBeLessThan(0.1);
  });
  test('keys draw the same arc: down, left, up completes a lower sweep; the stick rotates it', () => {
    const keys = engineFor({ game: 'trace', preset: 'normal', params: { direction: 'lower' }, seed: 5 });
    expect(runScript(keys, [
      { at: 100, press: 'down' }, { at: 500, release: 'down' }, { at: 500, press: 'left' },
      { at: 1200, release: 'left' }, { at: 1200, press: 'up' }, { at: 1700, release: 'up' },
    ], 60, 2500)).toEqual({ status: 'success', reason: 'completed' });
    const stick = engineFor({ game: 'trace', preset: 'normal', params: { direction: 'upper' }, seed: 5 });
    const script: Scripted[] = [];
    for (let i = 0; i <= 30; i++) {
      const a = (Math.PI * i) / 30; // tangent of the upper arc: up, then left, then down
      script.push({ at: 100 + i * 50, axes: { lx: -Math.sin(a), ly: -Math.cos(a), rt: 0 } });
    }
    script.push({ at: 100 + 31 * 50, axes: { lx: 0, ly: 0, rt: 0 } });
    expect(runScript(stick, script, 60, 3000)).toEqual({ status: 'success', reason: 'completed' });
  });
  test('holding one direction alone stalls short of the goal', () => {
    for (const key of ['down', 'left', 'up', 'right'] as const) {
      const engine = engineFor({ game: 'trace', preset: 'normal', params: { direction: 'lower' }, seed: 5 });
      expect(runScript(engine, [{ at: 100, press: key }], 60, 4000)).toBeNull();
    }
  });
});
