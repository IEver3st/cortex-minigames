// Pressure Control: input pushes pressure up against constant decay, with inertia. Useful work
// only accrues inside a moving safe band; outside it, stress builds after a short grace period.
// Success requires enough work, never just surviving until a timer ends.

import { clamp, defineGame } from '../../core/game';
import { toScore } from '../../core/result';

export type PressureParams = {
  rise: number; // acceleration at full input, pressure units / s²
  decay: number; // constant downward acceleration, units / s²
  damping: number; // velocity damping, 1 / s
  bandWidth: number;
  bandMotion: number; // amplitude of band centre travel
  bandPeriodMs: number;
  workMs: number; // in-band time needed
  stressMs: number; // continuous outside time that breaks the part
  graceMs: number;
};

export type PressureState = {
  p: PressureParams;
  pressure: number;
  velocity: number;
  base: number;
  phase: number;
  progress: number;
  stress: number;
  maxStress: number;
  outsideFor: number;
  entered: boolean;
  enteredAt: number;
  inBand: number;
  excursions: number;
  inside: boolean;
  over: boolean;
};

/** Pressure at or above this is overpressure: it counts as outside and stresses twice as fast. */
export const OVERPRESSURE = 0.97;

export function bandCenter(s: PressureState, t: number): number {
  return s.base + s.p.bandMotion * Math.sin((2 * Math.PI * t) / s.p.bandPeriodMs + s.phase);
}

export const pressure = defineGame<PressureParams, PressureState>({
  id: 'pressure',
  version: 1,
  name: 'Pressure Control',
  inputs: ['keyboard', 'mouse', 'controller'],
  presentation: 'compact',
  params: {
    rise: { type: 'number', min: 0.6, max: 4 },
    decay: { type: 'number', min: 0.2, max: 2 },
    damping: { type: 'number', min: 1, max: 8 },
    bandWidth: { type: 'number', min: 0.08, max: 0.4 },
    bandMotion: { type: 'number', min: 0, max: 0.3 },
    bandPeriodMs: { type: 'int', min: 2000, max: 12000 },
    workMs: { type: 'int', min: 2000, max: 15000 },
    stressMs: { type: 'int', min: 500, max: 5000 },
    graceMs: { type: 'int', min: 0, max: 800 },
  },
  presets: {
    easy: { rise: 1.7, decay: 0.8, damping: 3, bandWidth: 0.28, bandMotion: 0.05, bandPeriodMs: 7000, workMs: 4000, stressMs: 3000, graceMs: 500 },
    normal: { rise: 1.8, decay: 0.85, damping: 3, bandWidth: 0.22, bandMotion: 0.1, bandPeriodMs: 6000, workMs: 5500, stressMs: 2200, graceMs: 350 },
    hard: { rise: 2, decay: 0.9, damping: 2.6, bandWidth: 0.16, bandMotion: 0.16, bandPeriodMs: 5200, workMs: 7000, stressMs: 1600, graceMs: 250 },
    expert: { rise: 2.2, decay: 1, damping: 2.4, bandWidth: 0.12, bandMotion: 0.2, bandPeriodMs: 4600, workMs: 8000, stressMs: 1200, graceMs: 150 },
  },
  metrics: { inBandRatio: 'number', maxStress: 'number', excursions: 'number', workDone: 'number' },
  hints: [{ actions: ['primary'], label: 'Hold to build pressure' }],
  tutorial: 'Hold to raise pressure, release to let it fall. Keep the needle inside the band to fill the work meter.',
  minDurationMs: 1500,
  defaultTimeoutMs: (p) => Math.round(p.workMs * 2 + 3000),
  check(p, timeoutMs) {
    if (p.bandWidth / 2 + p.bandMotion > 0.42) return 'band_out_of_range';
    const climb = (p.rise - p.decay) / p.damping; // terminal upward speed at full input
    const fall = p.decay / p.damping;
    if (climb <= 0.05) return 'cannot_build_pressure';
    const bandSpeed = (p.bandMotion * 2 * Math.PI) / (p.bandPeriodMs / 1000);
    if (bandSpeed > Math.min(climb, fall) * 0.8) return 'band_too_fast';
    if (timeoutMs < p.workMs + 2000) return 'time_budget_too_short';
    return null;
  },
  create(p, rng) {
    return {
      p, pressure: 0, velocity: 0,
      base: rng.range(0.45, 0.58),
      phase: rng.range(0, Math.PI * 2),
      progress: 0, stress: 0, maxStress: 0, outsideFor: 0, entered: false, enteredAt: 0, inBand: 0,
      excursions: 0, inside: false, over: false,
    };
  },
  step(s, dt, t, input) {
    const { p } = s;
    const seconds = dt / 1000;
    const drive = Math.max(input.held.has('primary') ? 1 : 0, clamp(input.axes.rt));
    const accel = drive * p.rise - p.decay - p.damping * s.velocity;
    s.velocity += accel * seconds;
    s.pressure += s.velocity * seconds;
    if (s.pressure <= 0) { s.pressure = 0; if (s.velocity < 0) s.velocity = 0; }
    if (s.pressure >= 1) { s.pressure = 1; if (s.velocity > 0) s.velocity = 0; }

    const center = bandCenter(s, t);
    s.over = s.pressure >= OVERPRESSURE;
    const inside = !s.over && Math.abs(s.pressure - center) <= p.bandWidth / 2;
    if (inside && !s.entered) { s.entered = true; s.enteredAt = t; }
    if (inside) {
      s.progress = Math.min(1, s.progress + dt / p.workMs);
      s.inBand += dt;
      s.outsideFor = 0;
      s.stress = Math.max(0, s.stress - dt / (p.stressMs * 3));
    } else if (s.entered) {
      // Stress only counts after the first entry: the initial climb is never punished.
      if (s.inside) s.excursions++;
      s.outsideFor += dt;
      if (s.outsideFor > p.graceMs) s.stress += (dt / p.stressMs) * (s.over ? 2 : 1);
      s.maxStress = Math.max(s.maxStress, Math.min(1, s.stress));
    }
    s.inside = inside;
  },
  outcome(s) {
    if (s.stress >= 1) return { status: 'failed', reason: 'overstressed' };
    if (s.progress >= 1) return { status: 'success', reason: 'completed' };
    return null;
  },
  report(s, _outcome, t) {
    const active = s.entered ? Math.max(1, t - s.enteredAt) : Math.max(1, t);
    const ratio = clamp(s.inBand / active);
    return {
      score: toScore(s.progress * (0.7 * ratio + 0.3 * (1 - s.maxStress))),
      mistakes: s.excursions,
      metrics: { inBandRatio: ratio, maxStress: s.maxStress, excursions: s.excursions, workDone: s.progress },
    };
  },
});
