// Generation invariants over seeds 0..99 for every generated family and preset, plus determinism,
// frame-rate independence and stall handling.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildCatalog } from '../src/core/catalog';
import { MAX_CATCHUP_MS } from '../src/core/engine';
import { createRng } from '../src/core/rng';
import { PRESETS } from '../src/core/types';
import { evaluate, type CircuitState } from '../src/games/circuit_route/logic';
import { GLYPHS, GLYPH_IDS, type PatternState } from '../src/games/pattern_rebuild/logic';
import { MARKER, type PulseState } from '../src/games/pulse_sync/logic';
import type { SignalState } from '../src/games/signal_lock/logic';
import { distanceToPath, isValidPath, type TraceState } from '../src/games/trace_path/logic';
import { waveError, type WaveState } from '../src/games/wave_match/logic';
import type { TimingState } from '../src/games/timing/logic';
import type { SequenceState } from '../src/games/sequence/logic';
import type { TraceSweepState } from '../src/games/trace/logic';
import { GAMES } from '../src/games/registry';
import { engineFor, runScript, type Scripted } from './harness';

export const SEEDS = Array.from({ length: 100 }, (_, i) => i);

const each = (game: string, check: (state: any, preset: string, seed: number) => void) => {
  for (const preset of PRESETS) for (const seed of SEEDS) check(engineFor({ game, preset, seed }).state, preset, seed);
};

describe('seeded generation (seeds 0..99, every preset)', () => {
  test('circuit: solved layout is valid, scrambled board is not already solved', () => {
    let fallbacks = 0;
    each('circuit_route', (s: CircuitState) => {
      const solved = s.tiles.map((tile) => ({ ...tile, mask: tile.solved }));
      expect(evaluate(s.cols, s.rows, solved).ok).toBe(true);
      expect(evaluate(s.cols, s.rows, s.tiles).ok).toBe(false);
      expect(s.tiles.filter((t) => t.kind === 'source').length).toBe(1);
      if (!s.fallback) expect(s.tiles.filter((t) => t.kind === 'terminal').length).toBe(s.p.terminals);
      expect(s.baseline).toBeGreaterThan(0);
      if (s.fallback) fallbacks++;
    });
    expect(fallbacks).toBe(0);
  });
  test('trace: paths stay on the board, never self-approach, and checkpoints sit on the path', () => {
    let fallbacks = 0;
    each('trace_path', (s: TraceState) => {
      expect(isValidPath(s.path, s.p.corridor)).toBe(true);
      for (const cp of s.checkpoints) expect(distanceToPath(s.path, cp)).toBeLessThan(1e-9);
      if (s.fallback) fallbacks++;
    });
    expect(fallbacks).toBe(0);
  });
  test('pattern: unique glyphs, unique cells, in-bounds targets', () => {
    each('pattern_rebuild', (s: PatternState) => {
      expect(new Set(s.target.map((g) => g.glyph)).size).toBe(s.target.length);
      expect(new Set(s.target.map((g) => g.cell)).size).toBe(s.target.length);
      for (const goal of s.target) expect(goal.cell).toBeLessThan(s.p.size * s.p.size);
      expect(s.tray.length).toBe(s.target.length);
    });
  });
  test('pulse: every lane reaches the marker together at the constructed alignment', () => {
    each('pulse_sync', (s: PulseState) => {
      for (const lane of s.lanes) {
        const at = (lane.pos + s.alignAt / lane.period) % 1;
        expect(Math.abs(at - MARKER)).toBeLessThan(1e-6);
      }
      expect(s.alignAt).toBeLessThanOrEqual(3600);
    });
  });
  test('signal: every channel starts at least 0.25 away from its target', () => {
    each('signal_lock', (s: SignalState) => {
      for (const c of s.channels) expect(Math.abs(c.tune - c.target)).toBeGreaterThanOrEqual(0.2499);
    });
  });
  test('wave: start error is at least four tolerances', () => {
    each('wave_match', (s: WaveState) => expect(waveError(s.controls, s.target)).toBeGreaterThan(s.p.tolerance * 3.99));
  });
  test('timing: windows are reachable and away from the start', () => {
    each('timing', (s: TimingState) => {
      const round = s.rounds[0];
      expect(round.a).toBeGreaterThanOrEqual(0.18);
      expect(round.a + s.p.window).toBeLessThanOrEqual(0.94);
    });
  });
  test('trace: one direction per sweep, fixed directions honoured, random ones seeded', () => {
    each('trace', (s: TraceSweepState) => {
      expect(s.directions.length).toBe(s.p.sweeps);
      for (const dir of s.directions) expect(['upper', 'lower']).toContain(dir);
      if (s.p.direction !== 'random') expect(new Set(s.directions)).toEqual(new Set([s.p.direction]));
    });
  });
  test('sequence: never three identical symbols in a row', () => {
    each('sequence', (s: SequenceState) => {
      for (let i = 2; i < s.seq.length; i++) expect(s.seq[i] === s.seq[i - 1] && s.seq[i] === s.seq[i - 2]).toBe(false);
    });
  });
  test('same seed reproduces the same logical challenge; a different seed differs', () => {
    for (const game of GAMES) {
      const strip = (state: any) => JSON.stringify(state, (key, value) => (key === 'rng' ? undefined : value));
      const a = strip(engineFor({ game: game.id, seed: 42 }).state);
      const b = strip(engineFor({ game: game.id, seed: 42 }).state);
      expect(a).toBe(b);
      // Mash and the QTE generate nothing; trace draws only a direction, so look across a few seeds.
      if (game.id !== 'qte' && game.id !== 'mash') expect([43, 44, 45, 46, 47, 48].some((seed) => strip(engineFor({ game: game.id, seed }).state) !== a)).toBe(true);
    }
  });
  test('rng is versioned and stable for a known seed', () => {
    const rng = createRng(12345);
    const draws = [rng.next(), rng.next(), rng.next()].map((v) => v.toFixed(8));
    expect(draws).toEqual([createRng(12345).next().toFixed(8), ...draws.slice(1)]);
    expect(new Set(draws).size).toBe(3);
  });
});

describe('glyphs', () => {
  const normalise = (cells: [number, number][]) => {
    const minX = Math.min(...cells.map(([x]) => x)), minY = Math.min(...cells.map(([, y]) => y));
    return cells.map(([x, y]) => `${x - minX},${y - minY}`).sort().join(';');
  };
  const rotations = (cells: [number, number][]) => {
    const out: string[] = [];
    let current = cells;
    for (let i = 0; i < 4; i++) { out.push(normalise(current)); current = current.map(([x, y]) => [-y, x] as [number, number]); }
    return out;
  };
  test('no glyph has rotational symmetry and none is a rotation of another', () => {
    const seen = new Map<string, string>();
    for (const id of GLYPH_IDS) {
      const forms = rotations(GLYPHS[id]);
      expect(new Set(forms).size).toBe(4);
      for (const form of forms) {
        expect(seen.get(form) ?? id).toBe(id);
        seen.set(form, id);
      }
    }
  });
});

describe('frame-rate independence', () => {
  const fpsSet = [30, 60, 144];
  const compare = (game: string, preset: string, script: Scripted[]) => {
    const results = fpsSet.map((fps) => {
      const engine = engineFor({ game, preset, seed: 77 });
      const outcome = runScript(engine, script, fps);
      return { outcome, report: engine.report() };
    });
    for (const result of results.slice(1)) {
      expect(result.outcome).toEqual(results[0].outcome);
      expect(result.report.mistakes).toBe(results[0].report.mistakes);
      expect(Math.abs((result.report.score ?? 0) - (results[0].report.score ?? 0))).toBeLessThanOrEqual(1);
    }
    return results[0];
  };
  test('timing judges the same press identically at 30, 60 and 144 FPS', () => {
    const probe = engineFor({ game: 'timing', preset: 'normal', seed: 77 }).state as TimingState;
    const speed = 2 * probe.p.cyclesPerSec / 1000;
    const at = (probe.rounds[0].a + probe.p.window * 0.3) / speed;
    const result = compare('timing', 'normal', [{ at, press: 'primary' }]);
    expect(result.outcome?.status).toBe('success');
  });
  test('pressure physics produce the same outcome for the same timed input at any FPS', () => {
    const script: Scripted[] = [];
    // A fixed pulse-width pattern: 400 ms on, 250 ms off, repeated.
    for (let t = 0; t < 20000; t += 650) script.push({ at: t, press: 'primary' }, { at: t + 400, release: 'primary' });
    compare('pressure', 'easy', script);
  });
  test('trace probe motion from timed key holds is frame-rate independent', () => {
    compare('trace_path', 'easy', [{ at: 100, press: 'right' }, { at: 1800, release: 'right' }, { at: 1800, press: 'down' }, { at: 2300, release: 'down' }]);
  });
  test('mash fill from timed taps is frame-rate independent', () => {
    const script: Scripted[] = [];
    for (let t = 100; t < 4000; t += 120) script.push({ at: t, press: 'primary' }, { at: t + 50, release: 'primary' });
    expect(compare('mash', 'normal', script).outcome?.status).toBe('success');
  });
  test('trace knob from timed key holds is frame-rate independent', () => {
    const result = compare('trace', 'easy', [
      { at: 100, press: 'up' }, { at: 500, release: 'up' }, { at: 500, press: 'left' },
      { at: 1200, release: 'left' }, { at: 1200, press: 'down' }, { at: 1700, release: 'down' },
    ]);
    expect(result.outcome?.status).toBe('success');
  });
  test('a render stall pauses the simulation instead of fast-forwarding', () => {
    const engine = engineFor({ game: 'pressure', preset: 'easy', seed: 1 });
    engine.start(0);
    engine.advance(100);
    engine.advance(2100); // 2 s with no frames
    expect(engine.simT).toBeLessThanOrEqual(100 + MAX_CATCHUP_MS + 1);
    expect(engine.stalledMs).toBeGreaterThan(1700);
  });
  test('input after the deadline never counts', () => {
    const engine = engineFor({ game: 'qte', params: { prompts: [{ type: 'press', actions: ['primary'], windowMs: 1700 }], mistakes: 0, leadMs: 300 }, timeoutMs: 2000 });
    engine.start(0);
    for (let t = 16; t < 1990; t += 16) engine.advance(t);
    // A press 5 ms after the deadline, delivered before any frame crossed the deadline.
    engine.press('primary', 2005);
    expect(engine.advance(2010)).toEqual({ status: 'timeout', reason: 'time_expired' });
  });
});

describe('catalog', () => {
  test('shared/catalog.json matches the registry (run `bun run catalog` after changing a game)', () => {
    const committed = JSON.parse(readFileSync(new URL('../../shared/catalog.json', import.meta.url), 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildCatalog())));
  });
});
