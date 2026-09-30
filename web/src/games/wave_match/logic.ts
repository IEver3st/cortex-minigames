// Wave Match: adjust amplitude, frequency and phase until the player's trace sits on the target.
// Error is sampled across the whole trace, so phase wraparound is fair by construction: φ and
// φ + 2π draw the same curve and score the same. This game tests parameter matching, not search.

import { clamp, defineGame } from '../../core/game';
import { toScore } from '../../core/result';
import type { Rng } from '../../core/rng';

export type WaveParams = {
  axes: number;
  tolerance: number;
  dwellMs: number;
  adjustSpeed: number;
};

export const AXES = ['frequency', 'amplitude', 'phase'] as const;
export type Axis = (typeof AXES)[number];
export const SAMPLES = 96;

export type WaveState = {
  p: WaveParams;
  target: [number, number, number]; // normalised controls 0..1 for frequency, amplitude, phase
  controls: [number, number, number];
  adjustable: Axis[];
  selected: number; // index into adjustable
  error: number;
  dwell: number;
  breaks: number;
  done: boolean;
  wheel: number;
};

/** Normalised control → curve parameters. Frequency 1–4 cycles, amplitude 0.25–1, phase 0–2π. */
export const curve = (c: readonly number[]) => ({ f: 1 + c[0] * 3, a: 0.25 + c[1] * 0.75, phi: c[2] * Math.PI * 2 });

export function sample(c: readonly number[], x: number): number {
  const { f, a, phi } = curve(c);
  return a * Math.sin(2 * Math.PI * f * x + phi);
}

/** RMS difference across the trace, normalised so an unrelated wave scores about 1. */
export function waveError(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const x = i / (SAMPLES - 1);
    const d = sample(a, x) - sample(b, x);
    sum += d * d;
  }
  return Math.sqrt(sum / SAMPLES) / 0.7;
}

/** Convergence meter, 0..1. Deliberately nonlinear so it guides without revealing values. */
export const convergence = (s: WaveState): number => clamp(1 - s.error / (s.p.tolerance * 7));

function pickStart(target: [number, number, number], adjustable: Axis[], p: WaveParams, rng: Rng): [number, number, number] {
  let controls: [number, number, number] = [...target];
  for (let tries = 0; tries < 40; tries++) {
    controls = [...target];
    for (const axis of adjustable) controls[AXES.indexOf(axis)] = rng.range(0.05, 0.95);
    if (waveError(controls, target) > p.tolerance * 4) return controls;
  }
  // Deterministic far start if random draws keep landing near the target.
  for (const axis of adjustable) {
    const i = AXES.indexOf(axis);
    controls[i] = axis === 'phase' ? (target[i] + 0.5) % 1 : target[i] > 0.5 ? 0.05 : 0.95;
  }
  return controls;
}

export const waveMatch = defineGame<WaveParams, WaveState>({
  id: 'wave_match',
  version: 1,
  name: 'Wave Match',
  inputs: ['keyboard', 'mouse', 'controller'],
  presentation: 'focused',
  params: {
    axes: { type: 'int', min: 1, max: 3 },
    tolerance: { type: 'number', min: 0.03, max: 0.2 },
    dwellMs: { type: 'int', min: 300, max: 2500 },
    adjustSpeed: { type: 'number', min: 0.15, max: 0.8 },
  },
  presets: {
    easy: { axes: 1, tolerance: 0.11, dwellMs: 600, adjustSpeed: 0.35 },
    normal: { axes: 2, tolerance: 0.09, dwellMs: 700, adjustSpeed: 0.35 },
    hard: { axes: 3, tolerance: 0.075, dwellMs: 800, adjustSpeed: 0.32 },
    expert: { axes: 3, tolerance: 0.055, dwellMs: 1000, adjustSpeed: 0.3 },
  },
  metrics: { axes: 'number', finalError: 'number', breaks: 'number' },
  hints: [
    { actions: ['up', 'down'], label: 'Control' },
    { actions: ['left', 'right'], label: 'Adjust' },
    { actions: ['prev', 'next'], label: 'Fine' },
  ],
  tutorial: 'Match your solid trace to the dashed target. Pick a control, adjust it, and hold the match until it confirms.',
  minDurationMs: 800,
  defaultTimeoutMs: (p) => Math.round(5000 + p.axes * 5000 + p.dwellMs),
  check(p, timeoutMs) {
    // Fine adjustment is a sixth of coarse; one short tap must not overshoot the tolerance band.
    if ((p.adjustSpeed / 6) * 0.035 * 3 > p.tolerance) return 'tolerance_below_precision';
    if (timeoutMs < p.axes * 2000 + p.dwellMs) return 'time_budget_too_short';
    return null;
  },
  create(p, rng) {
    const target: [number, number, number] = [rng.range(0.1, 0.9), rng.range(0.2, 0.9), rng.next()];
    const adjustable = (['frequency', 'amplitude', 'phase'] as Axis[]).slice(0, p.axes);
    const controls = pickStart(target, adjustable, p, rng);
    return { p, target, controls, adjustable, selected: 0, error: waveError(controls, target), dwell: 0, breaks: 0, done: false, wheel: 0 };
  },
  step(s, dt, _t, input) {
    const seconds = dt / 1000;
    const axis = s.adjustable[s.selected];
    const i = AXES.indexOf(axis);
    const held = input.held;
    let coarse = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    if (coarse === 0) coarse = input.axes.lx;
    const fine = (held.has('next') ? 1 : 0) - (held.has('prev') ? 1 : 0);
    const delta = (coarse + fine / 6) * s.p.adjustSpeed * seconds + s.wheel;
    s.wheel = 0;
    if (delta !== 0) {
      const value = s.controls[i] + delta;
      s.controls[i] = axis === 'phase' ? ((value % 1) + 1) % 1 : clamp(value);
    }
    s.error = waveError(s.controls, s.target);
    if (s.error <= s.p.tolerance) {
      s.dwell += dt;
      if (s.dwell >= s.p.dwellMs) s.done = true;
    } else {
      if (s.dwell > 150) s.breaks++;
      s.dwell = 0;
    }
  },
  press(s, action) {
    const count = s.adjustable.length;
    if (action === 'down') s.selected = (s.selected + 1) % count;
    else if (action === 'up') s.selected = (s.selected + count - 1) % count;
  },
  pointer(s, event) {
    if (event.kind === 'set' && event.control >= 0 && event.control < s.adjustable.length) {
      s.selected = event.control;
      const axis = s.adjustable[event.control];
      const i = AXES.indexOf(axis);
      // Sliders move no faster than the keys: a pointer jump is clamped to one step of travel.
      const current = s.controls[i];
      const wanted = clamp(event.value);
      const limited = current + clamp(wanted - current, -0.04, 0.04);
      s.controls[i] = axis === 'phase' ? ((limited % 1) + 1) % 1 : clamp(limited);
    } else if (event.kind === 'wheel') {
      if (event.control !== undefined && event.control >= 0 && event.control < s.adjustable.length) s.selected = event.control;
      s.wheel += event.dir * (s.p.adjustSpeed / 6) * 0.1;
    }
  },
  outcome(s) {
    return s.done ? { status: 'success', reason: 'completed' } : null;
  },
  report(s, _o, t, timeoutMs) {
    const finalRatio = clamp(s.error / s.p.tolerance);
    const timeFactor = clamp(1 - t / (timeoutMs * 0.8));
    return {
      score: s.done ? toScore(0.5 * (1 - finalRatio) + 0.3 * timeFactor + 0.2 / (1 + s.breaks)) : toScore(convergence(s) * 0.4),
      mistakes: s.breaks,
      metrics: { axes: s.adjustable.length, finalError: finalRatio, breaks: s.breaks },
    };
  },
});
