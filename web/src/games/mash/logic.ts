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

/** Taps per second most players can sustain for several seconds on one key. Presets, the
 *  reachability check and the default budget are calibrated against this, never against `maxRate`,
 *  which is only the anti-macro cap. */
export const HUMAN_TAP_RATE = 7;
/** A strong player's sustained rate; finishing as fast as this earns full marks. */
export const STRONG_TAP_RATE = 10;

/** Taps per second a player must sustain just to hold the meter level. */
export const breakEvenRate = (p: MashParams): number => p.decay / p.gain;
/** Net fill per second at `rate` taps per second, never above the cap. */
const netFill = (p: MashParams, rate: number): number => Math.min(rate, p.maxRate) * p.gain - p.decay;
/** Ms to fill the meter at `rate` taps per second (continuous estimate, slightly generous). */
export const fillMs = (p: MashParams, rate: number): number => 1000 / Math.max(1e-6, netFill(p, rate));

/** The key a game instance asks for; the hint follows the configured action. */
const hintFor = (action: Action) => [{ actions: [action], label: 'Tap fast' }];
let shownHints = hintFor('primary');

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
    // Break-even rates 2 / 3 / 4 / 4.8 taps per second; a 7 taps/s player fills them in about
    // 2 / 2.5 / 3.7 / 4.5 s.
    easy: { action: 'primary', gain: 0.1, decay: 0.2, maxRate: 14 },
    normal: { action: 'primary', gain: 0.1, decay: 0.3, maxRate: 16 },
    hard: { action: 'primary', gain: 0.09, decay: 0.36, maxRate: 18 },
    expert: { action: 'primary', gain: 0.1, decay: 0.48, maxRate: 20 },
  },
  metrics: { taps: 'number', ignored: 'number', peak: 'number', rate: 'number' },
  // Footer hints follow the action of the instance most recently created (one session at a time).
  get hints() { return shownHints; },
  tutorial: 'Tap the key as fast as you can to fill the meter before it drains.',
  // Fastest legitimate fill: four taps at the widest cap (gain 0.3, 20 taps/s) is 150 ms after the first.
  minDurationMs: 120,
  defaultTimeoutMs: (p) => Math.round(3000 + 2.5 * fillMs(p, HUMAN_TAP_RATE)),
  check(p, timeoutMs) {
    const breakEven = breakEvenRate(p);
    if (breakEven > HUMAN_TAP_RATE * 0.7 || breakEven > p.maxRate * 0.7) return 'mash_rate_unreachable';
    if (timeoutMs < fillMs(p, HUMAN_TAP_RATE) * 1.3 + 500) return 'time_budget_too_short';
    return null;
  },
  create(p) {
    shownHints = hintFor(p.action);
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
      // Full marks at a strong player's pace, falling to 40% at the budget; a failed attempt scores
      // how close it got.
      score: outcome?.status === 'success' ? toScore(0.4 + 0.6 * speedShare(s.p, t, timeoutMs)) : toScore(s.peak * 0.5),
      mistakes: 0,
      metrics: { taps: s.taps, ignored: s.ignored, peak: s.peak, rate: s.taps ? (s.taps / active) * 1000 : 0 },
    };
  },
});

/** 1 at or under the strong-player fill time, 0 at the budget. */
function speedShare(p: MashParams, t: number, timeoutMs: number): number {
  const target = Math.min(fillMs(p, STRONG_TAP_RATE), timeoutMs * 0.5);
  return clamp((timeoutMs - t) / Math.max(1, timeoutMs - target));
}
