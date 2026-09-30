// Signal Lock: search a band with coarse tuning, correct with fine tuning, and hold the signal
// inside tolerance for a dwell time to lock the channel. Harder presets add bounded drift and a
// second axis (polarisation); feedback always shows strength, never the target value.

import { clamp, defineGame } from '../../core/game';
import { toScore } from '../../core/result';

export type SignalParams = {
  channels: number;
  tolerance: number;
  dwellMs: number;
  coarseSpeed: number;
  fineSpeed: number;
  drift: number;
  secondAxis: boolean;
  searchWidth: number;
};

export type Channel = {
  target: number;
  target2: number;
  driftPeriod: number;
  driftPhase: number;
  tune: number;
  tune2: number;
  dwell: number;
  locked: boolean;
  lockError: number;
  breaks: number;
};

export type SignalState = {
  p: SignalParams;
  channels: Channel[];
  active: number;
  breaks: number;
  wheelFine: number;
};

/** Shortest deliberate keyboard tap, used to decide whether tolerance is reachable. */
export const MIN_TAP_MS = 35;

export function targetAt(s: SignalState, c: Channel, t: number): number {
  return clamp(c.target + s.p.drift * Math.sin((2 * Math.PI * t) / c.driftPeriod + c.driftPhase), 0.02, 0.98);
}

export function channelError(s: SignalState, c: Channel, t: number): number {
  const primary = Math.abs(c.tune - targetAt(s, c, t));
  if (!s.p.secondAxis) return primary;
  // Polarisation is a coarser axis: its error is scaled so both axes demand similar care.
  return Math.max(primary, Math.abs(c.tune2 - c.target2) * 0.5);
}

/** 0..1 displayed strength. Nonlinear, so the meter guides without printing the answer. */
export function strength(s: SignalState, c: Channel, t: number): number {
  return Math.pow(clamp(1 - channelError(s, c, t) / s.p.searchWidth), 1.6);
}

export const signalLock = defineGame<SignalParams, SignalState>({
  id: 'signal_lock',
  version: 1,
  name: 'Signal Lock',
  inputs: ['keyboard', 'mouse', 'controller'],
  presentation: 'focused',
  params: {
    channels: { type: 'int', min: 1, max: 3 },
    tolerance: { type: 'number', min: 0.005, max: 0.05 },
    dwellMs: { type: 'int', min: 300, max: 2500 },
    coarseSpeed: { type: 'number', min: 0.12, max: 0.6 },
    fineSpeed: { type: 'number', min: 0.01, max: 0.08 },
    drift: { type: 'number', min: 0, max: 0.03 },
    secondAxis: { type: 'bool' },
    searchWidth: { type: 'number', min: 0.06, max: 0.3 },
  },
  presets: {
    easy: { channels: 1, tolerance: 0.022, dwellMs: 600, coarseSpeed: 0.3, fineSpeed: 0.045, drift: 0, secondAxis: false, searchWidth: 0.22 },
    normal: { channels: 2, tolerance: 0.016, dwellMs: 700, coarseSpeed: 0.3, fineSpeed: 0.04, drift: 0, secondAxis: false, searchWidth: 0.18 },
    hard: { channels: 2, tolerance: 0.012, dwellMs: 850, coarseSpeed: 0.32, fineSpeed: 0.035, drift: 0.01, secondAxis: false, searchWidth: 0.14 },
    expert: { channels: 3, tolerance: 0.01, dwellMs: 900, coarseSpeed: 0.34, fineSpeed: 0.03, drift: 0.01, secondAxis: true, searchWidth: 0.12 },
  },
  metrics: { channels: 'number', channelsLocked: 'number', alignmentError: 'number', lockBreaks: 'number', stability: 'number' },
  hints: [
    { actions: ['left', 'right'], label: 'Coarse' },
    { actions: ['prev', 'next'], label: 'Fine' },
    { actions: ['alt'], label: 'Channel' },
  ],
  tutorial: 'Sweep the band until the strength bars rise, fine-tune to peak, then hold steady until the channel locks.',
  minDurationMs: 800,
  defaultTimeoutMs: (p) => Math.round(4000 + p.channels * (5000 + p.dwellMs) + (p.secondAxis ? p.channels * 3000 : 0)),
  check(p, timeoutMs) {
    if (p.fineSpeed * (MIN_TAP_MS / 1000) > p.tolerance * 1.5) return 'tolerance_below_precision';
    if (p.fineSpeed >= p.coarseSpeed) return 'fine_not_finer';
    if (p.searchWidth <= p.tolerance * 2) return 'search_width_too_small';
    const driftSpeed = (p.drift * 2 * Math.PI) / 3.2; // fastest drift period is 3.2 s
    if (driftSpeed > p.fineSpeed * 0.7) return 'drift_too_fast';
    if (timeoutMs < p.channels * (p.dwellMs + 1500)) return 'time_budget_too_short';
    return null;
  },
  create(p, rng) {
    const channels: Channel[] = [];
    for (let i = 0; i < p.channels; i++) {
      const target = rng.range(0.1 + p.drift, 0.9 - p.drift);
      // Start well away from the target so the channel always needs a real search.
      let tune = rng.range(0.05, 0.95);
      for (let tries = 0; tries < 16 && Math.abs(tune - target) < 0.25; tries++) tune = rng.range(0.05, 0.95);
      if (Math.abs(tune - target) < 0.25) tune = target > 0.5 ? 0.05 : 0.95;
      channels.push({
        target, target2: rng.range(0.15, 0.85), driftPeriod: rng.range(3200, 6200), driftPhase: rng.range(0, Math.PI * 2),
        tune, tune2: 0.5 + (rng.next() > 0.5 ? 0.35 : -0.35), dwell: 0, locked: false, lockError: 0, breaks: 0,
      });
    }
    return { p, channels, active: 0, breaks: 0, wheelFine: 0 };
  },
  step(s, dt, t, input) {
    const c = s.channels[s.active];
    const seconds = dt / 1000;
    if (c && !c.locked) {
      const held = input.held;
      let coarse = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
      if (coarse === 0) coarse = input.axes.lx;
      const fine = (held.has('next') ? 1 : 0) - (held.has('prev') ? 1 : 0);
      c.tune = clamp(c.tune + (coarse * s.p.coarseSpeed + fine * s.p.fineSpeed) * seconds + s.wheelFine);
      if (s.p.secondAxis) {
        let axis2 = (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0);
        if (axis2 === 0) axis2 = -input.axes.ly;
        c.tune2 = clamp(c.tune2 + axis2 * s.p.coarseSpeed * 0.6 * seconds);
      }
    }
    s.wheelFine = 0;
    for (const channel of s.channels) {
      if (channel.locked) continue;
      const error = channelError(s, channel, t);
      if (error <= s.p.tolerance) {
        channel.dwell += dt;
        if (channel.dwell >= s.p.dwellMs) {
          channel.locked = true;
          channel.lockError = error;
          if (channel === c) {
            const next = s.channels.findIndex((other) => !other.locked);
            if (next >= 0) s.active = next;
          }
        }
      } else {
        if (channel.dwell > 120) { channel.breaks++; s.breaks++; }
        channel.dwell = 0;
      }
    }
  },
  press(s, action) {
    if (action !== 'alt' || s.channels.length < 2) return;
    // Switching keeps every channel's tuner position, and locked channels stay locked.
    for (let i = 1; i <= s.channels.length; i++) {
      const next = (s.active + i) % s.channels.length;
      if (!s.channels[next].locked || i === s.channels.length) { s.active = next; break; }
    }
  },
  pointer(s, event) {
    const c = s.channels[s.active];
    if (event.kind === 'select' && event.index >= 0 && event.index < s.channels.length) s.active = event.index;
    if (!c || c.locked) return;
    if (event.kind === 'drag') {
      // Dragging is coarse tuning at the same maximum rate as the keys: dx is a fraction of the band.
      c.tune = clamp(c.tune + clamp(event.dx, -0.05, 0.05));
      if (s.p.secondAxis && event.dy) c.tune2 = clamp(c.tune2 - clamp(event.dy, -0.05, 0.05));
    }
    if (event.kind === 'wheel') s.wheelFine += event.dir * s.p.fineSpeed * 0.08;
  },
  outcome(s) {
    return s.channels.every((c) => c.locked) ? { status: 'success', reason: 'completed' } : null;
  },
  report(s) {
    const locked = s.channels.filter((c) => c.locked);
    const errorRatio = locked.length ? locked.reduce((sum, c) => sum + c.lockError / s.p.tolerance, 0) / locked.length : 1;
    const stability = locked.length / Math.max(1, locked.length + s.breaks);
    const completion = locked.length / s.channels.length;
    return {
      score: toScore(completion * (0.6 * stability + 0.4 * (1 - clamp(errorRatio)))),
      mistakes: s.breaks,
      metrics: {
        channels: s.channels.length, channelsLocked: locked.length, alignmentError: errorRatio,
        lockBreaks: s.breaks, stability,
      },
    };
  },
});
