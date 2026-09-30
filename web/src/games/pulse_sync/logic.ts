// Pulse Sync: several lanes carry pulses on different periods. Commit when every pulse sits inside
// its window at the shared marker. Phases are constructed so a natural alignment always occurs
// within the round budget; parking (a bounded brake on one lane) lets a skilled player align sooner.

import { clamp, defineGame } from '../../core/game';
import { toScore } from '../../core/result';
import type { Rng } from '../../core/rng';

export type PulseParams = {
  tracks: number;
  periodMin: number;
  periodMax: number;
  window: number; // full window width as a fraction of one cycle
  rounds: number;
  parkMs: number; // total lane-parking allowance
  mistakes: number;
};

export const MARKER = 0.5;
export const MIN_WINDOW_MS = 90;

export type Lane = { period: number; pos: number; parked: boolean };

export type PulseState = {
  p: PulseParams;
  rng: Rng;
  lanes: Lane[];
  selected: number;
  parkUsed: number;
  round: number;
  roundMistakes: number;
  mistakes: number;
  clean: number;
  errors: number[];
  alignAt: number; // guaranteed natural alignment time for this round (sim ms)
  flash: null | { ok: boolean; at: number };
  failed: boolean;
};

export const inWindow = (s: PulseState, lane: Lane): boolean => Math.abs(lane.pos - MARKER) <= s.p.window / 2;

/** Place every lane so that, moving naturally, all pulses cross the marker together at `alignAt`. */
function rephase(s: PulseState, now: number, rng: Rng): void {
  const lead = rng.range(1800, 3600);
  s.alignAt = now + lead;
  for (const lane of s.lanes) {
    lane.parked = false;
    lane.pos = (((MARKER - lead / lane.period) % 1) + 1) % 1;
  }
}

export const pulseSync = defineGame<PulseParams, PulseState>({
  id: 'pulse_sync',
  version: 1,
  name: 'Pulse Sync',
  inputs: ['keyboard', 'mouse', 'controller'],
  presentation: 'focused',
  params: {
    tracks: { type: 'int', min: 2, max: 4 },
    periodMin: { type: 'int', min: 700, max: 3000 },
    periodMax: { type: 'int', min: 900, max: 4500 },
    window: { type: 'number', min: 0.05, max: 0.25 },
    rounds: { type: 'int', min: 1, max: 3 },
    parkMs: { type: 'int', min: 0, max: 8000 },
    mistakes: { type: 'int', min: 0, max: 3 },
  },
  presets: {
    easy: { tracks: 2, periodMin: 1400, periodMax: 2200, window: 0.18, rounds: 1, parkMs: 4000, mistakes: 2 },
    normal: { tracks: 3, periodMin: 1200, periodMax: 2200, window: 0.14, rounds: 1, parkMs: 3500, mistakes: 1 },
    hard: { tracks: 3, periodMin: 1000, periodMax: 2000, window: 0.11, rounds: 2, parkMs: 3000, mistakes: 1 },
    expert: { tracks: 4, periodMin: 900, periodMax: 1900, window: 0.105, rounds: 2, parkMs: 2500, mistakes: 0 },
  },
  metrics: { rounds: 'number', cleanSyncs: 'number', phaseError: 'number', parkUsedMs: 'number' },
  hints: [
    { actions: ['up', 'down'], label: 'Lane' },
    { actions: ['alt'], label: 'Park' },
    { actions: ['primary'], label: 'Sync' },
  ],
  tutorial: 'Sync when every pulse sits inside its bracket on the marker. Park a lane to hold it while the others catch up.',
  minDurationMs: 800,
  defaultTimeoutMs: (p) => Math.round(2000 + p.rounds * (3600 + p.periodMax * 2)),
  check(p, timeoutMs) {
    if (p.periodMin > p.periodMax) return 'period_range_inverted';
    if (p.window * p.periodMin < MIN_WINDOW_MS) return 'window_too_fast';
    // Each round's natural alignment lands at most 3.6 s after it starts.
    if (timeoutMs < p.rounds * 3800 + 1000) return 'time_budget_too_short';
    return null;
  },
  create(p, rng) {
    const lanes: Lane[] = [];
    for (let i = 0; i < p.tracks; i++) lanes.push({ period: rng.range(p.periodMin, p.periodMax), pos: 0, parked: false });
    // Keep periods distinct so lanes visibly drift apart instead of moving as a block.
    lanes.sort((a, b) => a.period - b.period);
    for (let i = 1; i < lanes.length; i++) {
      if (lanes[i].period - lanes[i - 1].period < 120) lanes[i].period = Math.min(p.periodMax + 400, lanes[i - 1].period + 120 + rng.range(0, 200));
    }
    rng.shuffle(lanes);
    const s: PulseState = {
      p, rng, lanes, selected: 0, parkUsed: 0, round: 0, roundMistakes: 0, mistakes: 0, clean: 0, errors: [],
      alignAt: 0, flash: null, failed: false,
    };
    rephase(s, 0, rng);
    return s;
  },
  step(s, dt) {
    const parked = s.lanes.filter((lane) => lane.parked).length;
    if (parked) {
      s.parkUsed += dt * parked;
      if (s.parkUsed >= s.p.parkMs) for (const lane of s.lanes) lane.parked = false;
    }
    for (const lane of s.lanes) if (!lane.parked) lane.pos = (lane.pos + dt / lane.period) % 1;
  },
  press(s, action, t) {
    if (s.failed || s.round >= s.p.rounds) return;
    if (action === 'up') s.selected = (s.selected + s.lanes.length - 1) % s.lanes.length;
    else if (action === 'down') s.selected = (s.selected + 1) % s.lanes.length;
    else if (action === 'alt') toggle(s, s.selected);
    else if (action === 'primary') commit(s, t);
  },
  pointer(s, event, t) {
    if (event.kind === 'select' && event.index >= 0 && event.index < s.lanes.length) {
      s.selected = event.index;
      toggle(s, event.index);
    } else if (event.kind === 'select' && event.index === -1) commit(s, t);
  },
  outcome(s) {
    if (s.failed) return { status: 'failed', reason: s.p.mistakes > 0 ? 'mistakes_exhausted' : 'missed' };
    if (s.round >= s.p.rounds) return { status: 'success', reason: 'completed' };
    return null;
  },
  report(s) {
    const phaseError = s.errors.length ? s.errors.reduce((a, b) => a + b, 0) / s.errors.length : 1;
    return {
      score: toScore((s.round / s.p.rounds) * (0.6 * (1 - phaseError) + 0.4 * (s.clean / s.p.rounds))),
      mistakes: s.mistakes,
      metrics: { rounds: s.p.rounds, cleanSyncs: s.clean, phaseError, parkUsedMs: Math.round(s.parkUsed) },
    };
  },
});

function toggle(s: PulseState, index: number): void {
  const lane = s.lanes[index];
  if (lane.parked) lane.parked = false;
  else if (s.parkUsed < s.p.parkMs) lane.parked = true;
}

function commit(s: PulseState, t: number): void {
  const ok = s.lanes.every((lane) => inWindow(s, lane));
  s.flash = { ok, at: t };
  if (ok) {
    const error = s.lanes.reduce((sum, lane) => sum + Math.abs(lane.pos - MARKER) / (s.p.window / 2), 0) / s.lanes.length;
    s.errors.push(clamp(error));
    if (s.roundMistakes === 0) s.clean++;
    s.round++;
    s.roundMistakes = 0;
    if (s.round < s.p.rounds) rephase(s, t, s.rng);
    return;
  }
  s.mistakes++;
  s.roundMistakes++;
  if (s.mistakes > s.p.mistakes) s.failed = true;
}
