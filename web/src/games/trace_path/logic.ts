// Trace Path: guide a probe along a corridor through ordered checkpoints. Every movement is
// validated as a swept segment, so jumping across a bend registers contact. The mouse drives the
// probe by chasing the pointer at a capped speed, which keeps mouse, keys and stick comparable.

import { clamp, defineGame } from '../../core/game';
import { toScore } from '../../core/result';
import type { Rng } from '../../core/rng';

export type TraceParams = {
  segments: number;
  corridor: number; // half-width, board units (board is BOARD_W × 1)
  checkpoints: number;
  contactBudgetMs: number;
  maxContacts: number;
  speed: number; // board units / s for keys and stick
};

export const BOARD_W = 1.6;
export const MOUSE_SPEED_FACTOR = 1.5;
/** Generated paths end at least this far (straight line) from where they start, so even a run that
 *  spends its whole contact budget cutting corners cannot finish under `minDurationMs`. */
export const MIN_SPAN = 1;

/** Nominal segment length; actual segments are 0.8 to 1.2 times this. */
const segmentStep = (segments: number): number => ((BOARD_W - 0.3) / segments) * 1.15;
type Point = { x: number; y: number };

export type TraceState = {
  p: TraceParams;
  path: Point[];
  lengths: number[]; // cumulative arc length at each vertex
  checkpoints: Point[];
  reached: number;
  probe: Point;
  target: Point | null;
  outside: boolean;
  contacts: number;
  contactMs: number;
  deviationSum: number;
  deviationTime: number;
  fallback: boolean;
};

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segmentsDistance(a: Point, b: Point, c: Point, d: Point): number {
  // Non-intersecting segments are closest at an endpoint; generation rejects intersections separately.
  return Math.min(segmentDistance(a, c, d), segmentDistance(b, c, d), segmentDistance(c, a, b), segmentDistance(d, a, b));
}

function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function distanceToPath(path: Point[], p: Point): number {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) best = Math.min(best, segmentDistance(p, path[i], path[i + 1]));
  return best;
}

export function isValidPath(path: Point[], corridor: number): boolean {
  const margin = corridor + 0.03;
  for (const point of path) {
    if (point.x < margin || point.x > BOARD_W - margin || point.y < margin || point.y > 1 - margin) return false;
  }
  for (let i = 0; i < path.length - 1; i++) {
    for (let j = i + 2; j < path.length - 1; j++) {
      if (intersects(path[i], path[i + 1], path[j], path[j + 1])) return false;
      if (segmentsDistance(path[i], path[i + 1], path[j], path[j + 1]) < corridor * 3) return false;
    }
  }
  return true;
}

function generatePath(p: TraceParams, rng: Rng): Point[] | null {
  const step = segmentStep(p.segments);
  const path: Point[] = [{ x: 0.12, y: rng.range(0.25, 0.75) }];
  let heading = rng.range(-0.5, 0.5);
  for (let i = 0; i < p.segments; i++) {
    let placed = false;
    for (let tries = 0; tries < 30 && !placed; tries++) {
      const last = path[path.length - 1];
      // Bias back toward the board's middle row so paths wander without hugging an edge.
      const pull = (0.5 - last.y) * 1.2;
      const turn = clamp(rng.range(-1.05, 1.05) + pull * 0.6, -1.25, 1.25);
      const h = clamp(heading + turn, -1.35, 1.35); // never head backwards past vertical
      const length = step * rng.range(0.8, 1.2);
      const next = { x: last.x + Math.cos(h) * length, y: last.y + Math.sin(h) * length };
      const candidate = [...path, next];
      if (isValidPath(candidate, p.corridor)) { path.push(next); heading = h; placed = true; }
    }
    if (!placed) return null;
  }
  const end = path[path.length - 1];
  return Math.hypot(end.x - path[0].x, end.y - path[0].y) >= MIN_SPAN ? path : null;
}

function fallbackPath(corridor: number): Point[] {
  const amplitude = Math.min(0.28, 0.5 - corridor - 0.06);
  return [0.12, 0.4, 0.68, 0.96, 1.24, 1.46].map((x, i) => ({ x, y: 0.5 + (i % 2 === 0 ? -amplitude : amplitude) * (i === 0 ? 0.3 : 1) }));
}

function pointAt(path: Point[], lengths: number[], distance: number): Point {
  for (let i = 0; i < path.length - 1; i++) {
    if (distance <= lengths[i + 1]) {
      const t = (distance - lengths[i]) / Math.max(1e-9, lengths[i + 1] - lengths[i]);
      return { x: path[i].x + (path[i + 1].x - path[i].x) * t, y: path[i].y + (path[i + 1].y - path[i].y) * t };
    }
  }
  return path[path.length - 1];
}

export const tracePath = defineGame<TraceParams, TraceState>({
  id: 'trace_path',
  version: 1,
  name: 'Trace Path',
  inputs: ['keyboard', 'mouse', 'controller'],
  presentation: 'focused',
  params: {
    segments: { type: 'int', min: 3, max: 10 },
    corridor: { type: 'number', min: 0.025, max: 0.09 },
    checkpoints: { type: 'int', min: 2, max: 6 },
    contactBudgetMs: { type: 'int', min: 150, max: 2000 },
    maxContacts: { type: 'int', min: 1, max: 6 },
    speed: { type: 'number', min: 0.2, max: 0.8 },
  },
  presets: {
    easy: { segments: 4, corridor: 0.075, checkpoints: 2, contactBudgetMs: 1400, maxContacts: 5, speed: 0.42 },
    normal: { segments: 6, corridor: 0.06, checkpoints: 3, contactBudgetMs: 1000, maxContacts: 4, speed: 0.42 },
    hard: { segments: 7, corridor: 0.047, checkpoints: 4, contactBudgetMs: 700, maxContacts: 3, speed: 0.4 },
    expert: { segments: 9, corridor: 0.036, checkpoints: 5, contactBudgetMs: 450, maxContacts: 2, speed: 0.38 },
  },
  metrics: { checkpoints: 'number', reached: 'number', contacts: 'number', contactMs: 'number', deviation: 'number', fallback: 'boolean' },
  hints: [{ actions: ['up', 'down', 'left', 'right'], label: 'Steer' }],
  tutorial: 'Guide the probe down the track through each checkpoint in order. Touching the edge costs tolerance.',
  // The probe must cover MIN_SPAN less the final checkpoint radius at the fastest mouse chase
  // (0.8 × 1.5 board units/s): about 750 ms.
  minDurationMs: 700,
  defaultTimeoutMs: (p) => Math.round(4000 + (BOARD_W * 1.6 / p.speed) * 1000 + p.segments * 600),
  check(p, timeoutMs) {
    const minimumTravel = ((BOARD_W - 0.3) / p.speed) * 1000;
    if (timeoutMs < minimumTravel * 1.4) return 'time_budget_too_short';
    if ((p.speed / 120) > p.corridor * 0.5) return 'corridor_below_precision';
    // Sections two apart are one segment apart; the shortest segment must keep them three corridors clear.
    if (segmentStep(p.segments) * 0.8 < p.corridor * 3) return 'corridor_too_wide';
    return null;
  },
  create(p, rng) {
    let path: Point[] | null = null;
    for (let attempt = 0; attempt < 30 && !path; attempt++) path = generatePath(p, rng.fork(attempt));
    const fallback = !path;
    if (!path) path = fallbackPath(p.corridor);
    const lengths = [0];
    for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
    const total = lengths[lengths.length - 1];
    const checkpoints: Point[] = [];
    for (let i = 1; i <= p.checkpoints; i++) checkpoints.push(pointAt(path, lengths, (total * i) / p.checkpoints));
    return {
      p, path, lengths, checkpoints, reached: 0, probe: { ...path[0] }, target: null, outside: false,
      contacts: 0, contactMs: 0, deviationSum: 0, deviationTime: 0, fallback,
    };
  },
  step(s, dt, _t, input) {
    const seconds = dt / 1000;
    const held = input.held;
    let vx = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    let vy = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0);
    if (vx === 0 && vy === 0) { vx = input.axes.lx; vy = input.axes.ly; }
    const magnitude = Math.hypot(vx, vy);
    if (magnitude > 1) { vx /= magnitude; vy /= magnitude; }
    const from = { ...s.probe };
    let to: Point;
    if (s.target && vx === 0 && vy === 0) {
      const dx = s.target.x - from.x, dy = s.target.y - from.y;
      const distance = Math.hypot(dx, dy);
      const max = s.p.speed * MOUSE_SPEED_FACTOR * seconds;
      to = distance <= max ? { ...s.target } : { x: from.x + (dx / distance) * max, y: from.y + (dy / distance) * max };
    } else {
      to = { x: from.x + vx * s.p.speed * seconds, y: from.y + vy * s.p.speed * seconds };
    }
    to.x = clamp(to.x, 0, BOARD_W);
    to.y = clamp(to.y, 0, 1);
    const moved = Math.hypot(to.x - from.x, to.y - from.y);
    if (moved === 0 && !s.outside) return;

    // Swept validation: sample the whole movement, not just its end point.
    const samples = Math.max(1, Math.ceil(moved / (s.p.corridor / 3)));
    let outside = s.outside, worst = 0;
    for (let i = 1; i <= samples; i++) {
      const point = { x: from.x + ((to.x - from.x) * i) / samples, y: from.y + ((to.y - from.y) * i) / samples };
      const distance = distanceToPath(s.path, point);
      worst = Math.max(worst, distance);
      const nowOutside = distance > s.p.corridor;
      if (nowOutside && !outside) s.contacts++;
      outside = nowOutside;
      const checkpoint = s.checkpoints[s.reached];
      if (checkpoint && !nowOutside && Math.hypot(point.x - checkpoint.x, point.y - checkpoint.y) <= s.p.corridor * 1.1) s.reached++;
    }
    s.outside = outside;
    if (outside) s.contactMs += dt;
    if (moved > 0) {
      s.deviationSum += clamp(worst / s.p.corridor, 0, 2) * dt;
      s.deviationTime += dt;
    }
    s.probe = to;
  },
  pointer(s, event) {
    if (event.kind !== 'target') return;
    s.target = event.grab ? { x: clamp(event.x, 0, BOARD_W), y: clamp(event.y, 0, 1) } : null;
  },
  outcome(s) {
    if (s.contacts > s.p.maxContacts || s.contactMs > s.p.contactBudgetMs) return { status: 'failed', reason: 'boundary_contact' };
    if (s.reached >= s.checkpoints.length) return { status: 'success', reason: 'completed' };
    return null;
  },
  report(s) {
    const deviation = s.deviationTime ? clamp(s.deviationSum / s.deviationTime) : 0;
    const completion = s.reached / s.checkpoints.length;
    return {
      score: toScore(completion * (0.5 * (1 - deviation) + 0.3 * (1 - clamp(s.contactMs / s.p.contactBudgetMs)) + 0.2 * (1 - s.contacts / (s.p.maxContacts + 1)))),
      mistakes: s.contacts,
      metrics: {
        checkpoints: s.checkpoints.length, reached: s.reached, contacts: s.contacts,
        contactMs: Math.round(s.contactMs), deviation, fallback: s.fallback,
      },
    };
  },
});
