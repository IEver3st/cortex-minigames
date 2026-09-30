// Mash: tap one key to fill a meter against constant decay. A held key never repeats (the engine
// filters autorepeat and a second press without a release), and taps faster than `maxRate` are
// ignored, so a macro or bounce cannot beat a human. Waiting never helps: the meter only drains.

import { clamp, defineGame } from '../../core/game';
import { toScore } from '../../core/result';
import type { Action } from '../../core/types';

export const MASH_ACTIONS = ['primary', 'alt', 'next', 'prev', 'rotate'] as const;

export type MashParams = {
  action: (typeof MASH_ACTIONS)[number];
  gain: number; // fill per accepted tap
  decay: number; // fill lost per second
  maxRate: number; // accepted taps per second, at most
};

export type MashState = {
  p: MashParams;
  fill: number;
  peak: number;
  taps: number;
  ignored: number;
  lastTap: number;
  lastAt: number; // sim ms of the last accepted tap, for the view's press cue
  firstAt: number;
};

/** Taps per second a player must sustain just to hold the meter level. */
export const breakEvenRate = (p: MashParams): number => p.decay / p.gain;
/** Net fill per second at a sustainable human rate (75% of the cap). */
const comfortableNet = (p: MashParams): number => 0.75 * p.maxRate * p.gain - p.decay;

export const mash = defineGame<MashParams, MashState>({
  id: 'mash',
  version: 1,
  name: 'Mash',
  inputs: ['keyboard', 'mouse', 'controller'],
  presentation: 'compact',
  params: {
    action: { type: 'enum', values: MASH_ACTIONS },
    gain: { type: 'number', min: 0.02, max: 0.3 },
    decay: { type: 'number', min: 0.05, max: 1 },
    maxRate: { type: 'int', min: 6, max: 20 },
  },
  presets: {
    easy: { action: 'primary', gain: 0.12, decay: 0.25, maxRate: 14 },
    normal: { action: 'primary', gain: 0.09, decay: 0.35, maxRate: 16 },
    hard: { action: 'primary', gain: 0.07, decay: 0.45, maxRate: 18 },
    expert: { action: 'primary', gain: 0.055, decay: 0.55, maxRate: 20 },
  },
  metrics: { taps: 'number', ignored: 'number', peak: 'number', rate: 'number' },
  hints: [{ actions: ['primary'], label: 'Tap fast' }],
  tutorial: 'Tap the key as fast as you can to fill the meter before it drains.',
  minDurationMs: 150,
  defaultTimeoutMs: (p) => Math.round(3000 + (2500 / Math.max(0.05, comfortableNet(p)))),
  check(p, timeoutMs) {
    if (breakEvenRate(p) > p.maxRate * 0.7) return 'mash_rate_unreachable';
    if (timeoutMs < 1000 / comfortableNet(p) * 1.3 + 500) return 'time_budget_too_short';
    return null;
  },
  create(p) {
    return { p, fill: 0, peak: 0, taps: 0, ignored: 0, lastTap: -Infinity, lastAt: -Infinity, firstAt: -1 };
  },
  step(s, dt) {
    s.fill = Math.max(0, s.fill - (s.p.decay * dt) / 1000);
  },
  press(s, action: Action, t) {
    if (action !== s.p.action) return;
    if (t - s.lastTap < 1000 / s.p.maxRate) { s.ignored++; return; }
    s.lastTap = t;
    s.lastAt = t;
    if (s.firstAt < 0) s.firstAt = t;
    s.taps++;
    s.fill = Math.min(1, s.fill + s.p.gain);
    s.peak = Math.max(s.peak, s.fill);
  },
  outcome(s) {
    return s.fill >= 1 ? { status: 'success', reason: 'completed' } : null;
  },
  report(s, outcome, t, timeoutMs) {
    const active = Math.max(1, t - Math.max(0, s.firstAt));
    return {
      // Speed relative to the budget; a failed attempt scores how close it got.
      score: outcome?.status === 'success' ? toScore(0.4 + 0.6 * (1 - clamp(t / timeoutMs))) : toScore(s.peak * 0.5),
      mistakes: 0,
      metrics: { taps: s.taps, ignored: s.ignored, peak: s.peak, rate: s.taps ? (s.taps / active) * 1000 : 0 },
    };
  },
});
