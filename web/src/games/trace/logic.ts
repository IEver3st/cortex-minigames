// Trace Sweep: turn a virtual knob along a half ring in one sweep. The same model as cortex-lib's
// native mouse trace (imports/skillCheck/shared.lua): the knob sits on the ring at 3 o'clock, each
// motion delta is added to it and projected back onto the ring, so only tangential motion turns it.
// Lower: 3 -> 6 -> 9 (clockwise on screen); upper: 3 -> 12 -> 9. Straight swipes stall by ~151°,
// pauses cost nothing, and small reversals are tolerated without a reset.
//
// Input: mouse movement deltas in CSS pixels (no button), keys/D-pad as a direction to "draw" in,
// or the left stick as an analog direction. All three feed the same knob.

import { clamp, defineGame } from '../../core/game';
import { toScore } from '../../core/result';
import type { Rng } from '../../core/rng';
import type { InputState } from '../../core/types';

export type Direction = 'upper' | 'lower';

export type TraceSweepParams = {
  direction: 'upper' | 'lower' | 'random';
  sweeps: number;
  tolerance: number; // how far the knob may slide back, fraction of a half turn
  sensitivity: number; // divides the knob radius
};

export type TraceSweepState = {
  p: TraceSweepParams;
  directions: Direction[];
  round: number;
  angle: number;
  peak: number;
  lastMotion: number;
  lastStep: number;
  openAt: number; // input is ignored until this sim time (gap between sweeps)
  travel: number; // total motion, in knob radii
  backtrack: number; // total backward knob travel, radians
  eases: number;
  easing: boolean;
};

/** Knob radius in CSS px at sensitivity 1. A physical mouse maps counts to pixels 1:1 (CEF DPR 1),
 *  so pixels, not --u, keep the gesture the same size at every resolution. ~9 mm of travel at
 *  800 DPI for the full half ring; people draw bigger, and the knob simply runs ahead. */
export const RADIUS_PX = 90;
/** Keys and stick "draw" at this many radii per second: a quarter turn in about 0.6 s. */
export const KEY_SPEED = 2.6;
export const MIN_TANGENT = 0.25;
export const CENTRE_GUARD = 0.5;
export const COMPLETE = 0.96;
export const IDLE_MS = 1500;
export const EASE_PER_SECOND = 0.35;
export const GAP_MS = 350;
const MAX_CHUNKS = 64;

const radius = (p: TraceSweepParams) => RADIUS_PX / p.sensitivity;
export const progress = (s: TraceSweepState): number => s.angle / Math.PI;
export const direction = (s: TraceSweepState): Direction => s.directions[Math.min(s.round, s.directions.length - 1)];

function ease(s: TraceSweepState, t: number): void {
  const from = Math.max(s.lastStep, s.lastMotion + IDLE_MS);
  s.lastStep = t;
  if (s.angle <= 0 || t <= from) return;
  s.angle = Math.max(0, s.angle - ((t - from) / 1000) * EASE_PER_SECOND * Math.PI);
  s.peak = s.angle;
  if (!s.easing) { s.easing = true; s.eases++; }
}

/** Advance the knob by one motion delta in pixels (screen axes, y down). */
export function turn(s: TraceSweepState, dx: number, dy: number, t: number): void {
  if (t < s.openAt || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  if (direction(s) === 'upper') dy = -dy;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-6) return;
  s.lastMotion = t;
  s.easing = false;
  const r = radius(s.p);
  s.travel += distance / r;
  const chunks = Math.min(MAX_CHUNKS, Math.max(1, Math.ceil(distance / (r * 0.25))));
  const sx = dx / chunks, sy = dy / chunks, step = distance / chunks;
  for (let i = 0; i < chunks; i++) {
    const c = Math.cos(s.angle), n = Math.sin(s.angle);
    if (Math.abs(-n * sx + c * sy) < MIN_TANGENT * step) continue; // radial noise
    const px = r * c + sx, py = r * n + sy;
    if (Math.hypot(px, py) < r * CENTRE_GUARD) continue; // would cross the centre
    let delta = Math.atan2(py, px) - s.angle;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    else if (delta < -Math.PI) delta += 2 * Math.PI;
    const floor = Math.max(0, s.peak - s.p.tolerance * Math.PI);
    const next = Math.min(Math.PI, Math.max(floor, s.angle + delta));
    if (next < s.angle) s.backtrack += s.angle - next;
    s.angle = next;
    s.peak = Math.max(s.peak, s.angle);
  }
  if (progress(s) >= COMPLETE) {
    s.round++;
    s.angle = 0;
    s.peak = 0;
    s.openAt = t + GAP_MS;
  }
}

function drawVector(input: InputState): [number, number] {
  const held = input.held;
  let vx = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
  let vy = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0);
  if (vx === 0 && vy === 0) { vx = input.axes.lx; vy = input.axes.ly; }
  const magnitude = Math.hypot(vx, vy);
  if (magnitude > 1) { vx /= magnitude; vy /= magnitude; }
  return [vx, vy];
}

export const traceSweep = defineGame<TraceSweepParams, TraceSweepState>({
  id: 'trace',
  version: 1,
  name: 'Trace Sweep',
  inputs: ['keyboard', 'mouse', 'controller'],
  presentation: 'compact',
  cursor: true,
  params: {
    direction: { type: 'enum', values: ['upper', 'lower', 'random'] },
    sweeps: { type: 'int', min: 1, max: 3 },
    tolerance: { type: 'number', min: 0.08, max: 0.4 },
    sensitivity: { type: 'number', min: 0.25, max: 4 },
  },
  presets: {
    easy: { direction: 'upper', sweeps: 1, tolerance: 0.2, sensitivity: 1.3 },
    normal: { direction: 'random', sweeps: 1, tolerance: 0.15, sensitivity: 1 },
    hard: { direction: 'random', sweeps: 2, tolerance: 0.12, sensitivity: 1 },
    expert: { direction: 'random', sweeps: 3, tolerance: 0.1, sensitivity: 0.85 },
  },
  metrics: { sweeps: 'number', travel: 'number', backtrack: 'number', eases: 'number' },
  hints: [{ actions: ['up', 'down', 'left', 'right'], label: 'Sweep' }],
  tutorial: 'Sweep the mouse once along the arc, from the knob to the far end. Keys or the stick work too.',
  minDurationMs: 150,
  defaultTimeoutMs: (p) => Math.round(4000 + p.sweeps * 3000),
  check(p, timeoutMs) {
    if (timeoutMs < 1000 + p.sweeps * 1600) return 'time_budget_too_short';
    return null;
  },
  create(p, rng: Rng) {
    const directions: Direction[] = [];
    for (let i = 0; i < p.sweeps; i++) {
      directions.push(p.direction === 'random' ? (rng.next() < 0.5 ? 'upper' : 'lower') : p.direction);
    }
    return { p, directions, round: 0, angle: 0, peak: 0, lastMotion: 0, lastStep: 0, openAt: 0, travel: 0, backtrack: 0, eases: 0, easing: false };
  },
  step(s, dt, t, input) {
    const [vx, vy] = drawVector(input);
    if (vx !== 0 || vy !== 0) {
      const d = (KEY_SPEED * radius(s.p) * dt) / 1000;
      turn(s, vx * d, vy * d, t);
    }
    ease(s, t);
  },
  pointer(s, event, t) {
    if (event.kind !== 'drag') return;
    // Bound a single event: a teleporting pointer is treated as a very fast flick, never a jump.
    turn(s, clamp(event.dx, -2000, 2000), clamp(event.dy, -2000, 2000), t);
  },
  outcome(s) {
    return s.round >= s.p.sweeps ? { status: 'success', reason: 'completed' } : null;
  },
  report(s, outcome, t, timeoutMs) {
    const done = s.round + (outcome?.status === 'success' ? 0 : progress(s));
    return {
      score: toScore((done / s.p.sweeps) * (0.75 * (1 - clamp(t / timeoutMs)) + 0.25 * (1 - clamp(s.backtrack / Math.PI)))),
      mistakes: 0,
      metrics: { sweeps: s.round, travel: s.travel, backtrack: s.backtrack, eases: s.eases },
    };
  },
});
