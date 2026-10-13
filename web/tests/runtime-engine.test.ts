import { describe, expect, test } from 'bun:test';
import { Engine, MAX_CATCHUP_MS, STEP_MS } from '../src/core/engine';
import type { GameDef } from '../src/core/game';

interface Probe { maxStepT: number; steps: number[]; done: boolean }

/** A stub game that succeeds once a fixed step reaches `successAt` ms of simulation time. */
function probe(successAt: number | null): GameDef<any, Probe> {
  return {
    id: 'probe', version: 1, name: 'probe', inputs: ['keyboard'], presentation: 'compact', params: {}, presets: {} as never,
    metrics: {}, hints: [], tutorial: '', minDurationMs: 0, defaultTimeoutMs: () => 1000, check: () => null,
    create: () => ({ maxStepT: 0, steps: [], done: false }),
    step(s, dt, t) {
      s.steps.push(dt);
      s.maxStepT = Math.max(s.maxStepT, t);
      if (successAt !== null && t >= successAt) s.done = true;
    },
    outcome: (s) => (s.done ? { status: 'success', reason: 'completed' } : null),
    report: () => ({ score: 100, mistakes: 0, metrics: {} }),
  };
}

const TIMEOUTS = [1000, 1001, 2000, 3460, 5475, 6027, 7444, 180000];

function run(engine: Engine<Probe>, frameMs = 16): ReturnType<Engine<Probe>['advance']> {
  engine.start(0);
  let outcome = null;
  for (let f = frameMs; !outcome && f < engine.timeoutMs + 2000; f += frameMs) outcome = engine.advance(f);
  return outcome;
}

describe('engine deadline', () => {
  for (const timeout of TIMEOUTS) {
    test(`timeout ${timeout}: no step runs past the deadline`, () => {
      const engine = new Engine(probe(null), {}, 0, timeout);
      expect(run(engine)).toEqual({ status: 'timeout', reason: 'time_expired' });
      expect(engine.state.maxStepT).toBeLessThanOrEqual(timeout);
      expect(engine.simT).toBe(timeout);
      for (const dt of engine.state.steps) expect(dt).toBeLessThanOrEqual(STEP_MS + 1e-9);
    });

    test(`timeout ${timeout}: a success the step crossing the deadline would produce late is a timeout`, () => {
      // Success only becomes true strictly after the deadline: before the clamp it landed up to 8.33ms late.
      const engine = new Engine(probe(timeout + 0.001), {}, 0, timeout);
      expect(run(engine)).toEqual({ status: 'timeout', reason: 'time_expired' });
      expect(engine.simT).toBeLessThanOrEqual(timeout);
    });

    test(`timeout ${timeout}: success at or before the deadline still counts`, () => {
      const engine = new Engine(probe(timeout), {}, 0, timeout);
      expect(run(engine, 7)).toEqual({ status: 'success', reason: 'completed' });
      expect(engine.simT).toBeLessThanOrEqual(timeout);
    });
  }

  test('a stall pauses the clock and accumulates stalledMs', () => {
    const engine = new Engine(probe(null), {}, 0, 5000);
    engine.start(0);
    engine.advance(16);
    const before = engine.simT;
    engine.advance(1016);
    const first = engine.stalledMs;
    expect(first).toBeCloseTo(1016 - before - MAX_CATCHUP_MS, 6);
    engine.advance(1032);
    expect(engine.stalledMs).toBe(first); // an ordinary frame adds nothing
    engine.advance(2032);
    expect(engine.stalledMs).toBeGreaterThan(first + 600);
  });
});
