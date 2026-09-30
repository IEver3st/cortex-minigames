// Timing Check: stop a travelling indicator inside a target window. Linear and circular are two
// presentations of one mechanic. Position is analytic in time, so judging uses the exact input
// timestamp rather than whichever frame happened to be on screen.

import { clamp, defineGame } from '../../core/game';
import { toScore } from '../../core/result';
import type { Rng } from '../../core/rng';

export type TimingParams = {
  variant: 'linear' | 'circular';
  rounds: number;
  cyclesPerSec: number;
  window: number;
  perfect: number;
  reversals: boolean;
  mistakes: number;
  roundGapMs: number;
};

/** Minimum time the indicator spends inside the window; below this, reaction precision decides, not skill. */
export const MIN_WINDOW_MS = 70;
export const TELEGRAPH_MS = 380;

type Round = {
  start: number; // sim ms the indicator starts moving
  a: number; // window start, 0..1
  flips: number[]; // absolute sim ms of direction changes
  judged: null | { hit: boolean; perfect: boolean; accuracy: number; offset: number; at: number };
};

export type TimingState = {
  p: TimingParams;
  rng: Rng;
  rounds: Round[];
  current: number;
  hits: number;
  misses: number;
  perfects: number;
  failed: boolean;
};

/** Track-lengths travelled per ms. Linear ping-pong covers the track twice per cycle. */
const speed = (p: TimingParams) => (p.variant === 'linear' ? 2 : 1) * p.cyclesPerSec / 1000;

function makeRound(p: TimingParams, rng: Rng, start: number): Round {
  const w = p.window;
  // Keep the window away from the start position so there is always visible travel before it.
  const a = p.variant === 'linear' ? rng.range(0.22, 0.94 - w) : rng.range(0.18, 0.86 - w);
  const flips: number[] = [];
  if (p.reversals) {
    let t = start + rng.range(900, 1600);
    for (let i = 0; i < 12; i++) {
      flips.push(t);
      t += rng.range(900, 2200);
    }
  }
  return { start, a, flips, judged: null };
}

/** Distance travelled (track lengths, signed by direction) since the round began. */
function travel(round: Round, p: TimingParams, t: number): number {
  const v = speed(p);
  let u = 0, dir = 1, last = round.start;
  for (const flip of round.flips) {
    if (flip >= t) break;
    u += dir * v * (flip - last);
    dir = -dir;
    last = flip;
  }
  return u + dir * v * (Math.max(t, round.start) - last);
}

export function position(s: TimingState, t: number, index = s.current): number {
  const round = s.rounds[index];
  const u = travel(round, s.p, t);
  if (s.p.variant === 'circular') return ((u % 1) + 1) % 1;
  const m = ((u % 2) + 2) % 2; // triangle wave: 0 → 1 → 0
  return m <= 1 ? m : 2 - m;
}

/** Upcoming direction change within the telegraph lead, for the UI warning. */
export function flipWarning(s: TimingState, t: number): boolean {
  const round = s.rounds[s.current];
  if (!round || round.judged) return false;
  return round.flips.some((flip) => flip > t && flip - t <= TELEGRAPH_MS);
}

export function distanceToCenter(s: TimingState, pos: number, round: Round): number {
  const center = round.a + s.p.window / 2;
  const d = Math.abs(pos - center);
  return s.p.variant === 'circular' ? Math.min(d, 1 - d) : d;
}

export const timing = defineGame<TimingParams, TimingState>({
  id: 'timing',
  version: 1,
  name: 'Timing Check',
  inputs: ['keyboard', 'mouse', 'controller'],
  presentation: 'compact',
  params: {
    variant: { type: 'enum', values: ['linear', 'circular'] },
    rounds: { type: 'int', min: 1, max: 5 },
    cyclesPerSec: { type: 'number', min: 0.2, max: 3 },
    window: { type: 'number', min: 0.04, max: 0.4 },
    perfect: { type: 'number', min: 0, max: 0.6 },
    reversals: { type: 'bool' },
    mistakes: { type: 'int', min: 0, max: 3 },
    roundGapMs: { type: 'int', min: 200, max: 1500 },
  },
  presets: {
    easy: { variant: 'linear', rounds: 1, cyclesPerSec: 0.45, window: 0.22, perfect: 0.35, reversals: false, mistakes: 1, roundGapMs: 500 },
    normal: { variant: 'linear', rounds: 1, cyclesPerSec: 0.65, window: 0.15, perfect: 0.3, reversals: false, mistakes: 0, roundGapMs: 450 },
    hard: { variant: 'circular', rounds: 2, cyclesPerSec: 0.8, window: 0.11, perfect: 0.25, reversals: true, mistakes: 0, roundGapMs: 400 },
    expert: { variant: 'circular', rounds: 3, cyclesPerSec: 1.05, window: 0.08, perfect: 0.2, reversals: true, mistakes: 0, roundGapMs: 350 },
  },
  metrics: { rounds: 'number', hits: 'number', perfects: 'number', accuracy: 'number', meanOffset: 'number' },
  hints: [{ actions: ['primary'], label: 'Stop' }],
  tutorial: 'Stop the marker inside the lit window. The inner notch is a perfect stop.',
  minDurationMs: 120,
  defaultTimeoutMs: (p) => Math.round(2500 + p.rounds * (2 / p.cyclesPerSec) * 1000 + p.rounds * p.roundGapMs),
  check(p) {
    const windowMs = p.window / speed(p);
    if (windowMs < MIN_WINDOW_MS) return 'window_too_fast';
    return null;
  },
  create(p, rng) {
    const s: TimingState = { p, rng, rounds: [], current: 0, hits: 0, misses: 0, perfects: 0, failed: false };
    s.rounds.push(makeRound(p, rng, 0));
    return s;
  },
  press(s, action, t) {
    if (action !== 'primary' || s.failed) return;
    const round = s.rounds[s.current];
    if (!round || round.judged || t < round.start) return; // presses in the gap between rounds are ignored
    const pos = position(s, t);
    const d = distanceToCenter(s, pos, round);
    const half = s.p.window / 2;
    const hit = d <= half;
    const perfect = hit && d <= half * s.p.perfect;
    round.judged = { hit, perfect, accuracy: hit ? clamp(1 - d / half) : 0, offset: d, at: t };
    if (hit) {
      s.hits++;
      if (perfect) s.perfects++;
    } else {
      s.misses++;
      if (s.misses > s.p.mistakes) {
        s.failed = true;
        return;
      }
    }
    if (s.hits < s.p.rounds) {
      s.current++;
      s.rounds.push(makeRound(s.p, s.rng, t + s.p.roundGapMs));
    }
  },
  outcome(s) {
    if (s.failed) return { status: 'failed', reason: s.p.mistakes > 0 ? 'mistakes_exhausted' : 'missed' };
    if (s.hits >= s.p.rounds) return { status: 'success', reason: 'completed' };
    return null;
  },
  report(s) {
    const judged = s.rounds.filter((r) => r.judged).map((r) => r.judged!);
    const hits = judged.filter((j) => j.hit);
    const accuracy = judged.length ? judged.reduce((sum, j) => sum + j.accuracy, 0) / Math.max(judged.length, s.p.rounds) : 0;
    return {
      score: toScore(accuracy),
      mistakes: s.misses,
      perfect: s.perfects === s.p.rounds,
      metrics: {
        rounds: s.p.rounds,
        hits: s.hits,
        perfects: s.perfects,
        accuracy: hits.length ? hits.reduce((sum, j) => sum + j.accuracy, 0) / hits.length : 0,
        meanOffset: judged.length ? judged.reduce((sum, j) => sum + j.offset, 0) / judged.length : 0,
      },
    };
  },
});
