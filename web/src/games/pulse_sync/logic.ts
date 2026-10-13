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

/** Shortest time from a round's start until its last lane first reaches its window. No sync, natural
 *  or parked, can land sooner, which is what `minDurationMs` relies on. */
export const MIN_ENTRY_MS = 500;
const LEAD_MIN = 1800, LEAD_MAX = 3600, LEAD_SCAN_MIN = 1200;

/** Lane `pos` that puts it on the marker `lead` ms from now. */
const phaseFor = (period: number, lead: number): number => (((MARKER - lead / period) % 1) + 1) % 1;

/** In-window intervals of one lane over [0, until] ms from now, given its current phase. */
function laneIntervals(pos: number, period: number, half: number, until: number): [number, number][] {
  const out: [number, number][] = [];
  // k-th visit: the pulse is inside [MARKER - half, MARKER + half] between these two times.
  for (let k = -1; ; k++) {
    const from = (k + MARKER - half - pos) * period;
    const to = (k + MARKER + half - pos) * period;
    if (from > until) break;
    if (to >= 0) out.push([Math.max(0, from), Math.min(until, to)]);
  }
  return out;
}

/** For lanes placed for `lead`: when the last lane first enters its window, and when every lane is first
 *  inside together (ms from now). The planned alignment sits at `lead` itself. */
export function alignmentProfile(periods: number[], window: number, lead: number): { entry: number; first: number } {
  const half = window / 2;
  let together: [number, number][] = [[0, lead]];
  let entry = 0;
  for (const period of periods) {
    const own = laneIntervals(phaseFor(period, lead), period, half, lead);
    entry = Math.max(entry, own.length ? own[0][0] : lead);
    const next: [number, number][] = [];
    for (const [a0, a1] of together) for (const [b0, b1] of own) {
      const from = Math.max(a0, b0), to = Math.min(a1, b1);
      if (from <= to) next.push([from, to]);
    }
    together = next;
  }
  together.sort((x, y) => x[0] - y[0]);
  return { entry, first: together.length ? together[0][0] : lead };
}

/** Place every lane so that, moving naturally, all pulses cross the marker together at `alignAt`.
 *  The lead is chosen so the planned alignment is the first time every pulse is inside together and
 *  the last lane needs at least MIN_ENTRY_MS to reach its window. Bounded random draws, then a scan
 *  that may shorten the lead to 1.2 s; if nothing keeps the planned alignment first (close periods,
 *  wide windows), the entry guarantee alone is kept, constructed if necessary. */
function rephase(s: PulseState, now: number, rng: Rng): void {
  const periods = s.lanes.map((lane) => lane.period);
  const half = s.p.window / 2;
  let fallback = -1;
  const judge = (candidate: number): boolean => {
    const { entry, first } = alignmentProfile(periods, s.p.window, candidate);
    if (entry < MIN_ENTRY_MS) return false;
    // The together-interval that ends at the planned alignment starts half a window before it.
    if (first >= candidate - half * Math.min(...periods) - 1) return true;
    if (fallback < 0) fallback = candidate;
    return false;
  };
  let lead = -1;
  for (let attempt = 0; attempt < 24 && lead < 0; attempt++) {
    const candidate = rng.range(LEAD_MIN, LEAD_MAX);
    if (judge(candidate)) lead = candidate;
  }
  if (lead < 0) {
    const valid: number[] = [];
    for (let candidate = LEAD_SCAN_MIN; candidate <= LEAD_MAX; candidate += 10) if (judge(candidate)) valid.push(candidate);
    if (valid.length) lead = rng.pick(valid);
  }
  if (lead < 0) lead = fallback;
  if (lead < 0) {
    // Constructed: the slowest lane enters its window MIN_ENTRY_MS + 20 ms from now, and the lead is
    // that lane's latest visit inside the lead range.
    const slow = Math.max(...periods);
    const base = half * slow + MIN_ENTRY_MS + 20;
    lead = base + Math.max(0, Math.floor((LEAD_MAX - base) / slow)) * slow;
  }
  s.alignAt = now + lead;
  for (const lane of s.lanes) {
    lane.parked = false;
    lane.pos = phaseFor(lane.period, lead);
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
  // A parked or natural sync needs every lane inside its window; the last one arrives no sooner
  // than MIN_ENTRY_MS into the first round.
  minDurationMs: 450,
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
