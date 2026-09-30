// Sequence Recall: watch, then reproduce. Preview, ready, input and result are separate phases;
// input during preview is ignored without cost, and the ready phase will not arm until every key
// has been released, so the key that was down at the transition cannot answer the first step.

import { clamp, defineGame } from '../../core/game';
import { toScore } from '../../core/result';
import type { Action } from '../../core/types';

export type SequenceParams = {
  length: number;
  symbols: 'directions' | 'extended';
  previewMs: number;
  mistakes: number;
  interference: boolean;
};

export const SYMBOLS: Record<SequenceParams['symbols'], Action[]> = {
  directions: ['up', 'right', 'down', 'left'],
  extended: ['up', 'right', 'down', 'left', 'prev', 'next'],
};
export const READY_MS = 550;
/** Lit share of each preview slot; the rest is a gap so repeated symbols read as two flashes. */
const LIT = 0.68;

type Flash = { at: number; until: number; symbol: Action; decoy: boolean };

export type SequenceState = {
  p: SequenceParams;
  seq: Action[];
  flashes: Flash[];
  previewEnd: number;
  readyEnd: number;
  armed: boolean;
  index: number;
  mistakes: number;
  previewPresses: number;
  responses: number[];
  lastAt: number;
  feedback: null | { symbol: Action; ok: boolean; at: number };
  failed: boolean;
};

export type SequencePhase = 'preview' | 'ready' | 'input' | 'done';

export function phase(s: SequenceState, t: number): SequencePhase {
  if (s.failed || s.index >= s.seq.length) return 'done';
  if (t < s.previewEnd) return 'preview';
  if (t < s.readyEnd || !s.armed) return 'ready';
  return 'input';
}

export function litAt(s: SequenceState, t: number): Flash | null {
  for (const flash of s.flashes) if (t >= flash.at && t < flash.until) return flash;
  return null;
}

export const sequence = defineGame<SequenceParams, SequenceState>({
  id: 'sequence',
  version: 1,
  name: 'Sequence Recall',
  inputs: ['keyboard', 'mouse', 'controller'],
  presentation: 'compact',
  params: {
    length: { type: 'int', min: 3, max: 10 },
    symbols: { type: 'enum', values: ['directions', 'extended'] },
    previewMs: { type: 'int', min: 250, max: 1500 },
    mistakes: { type: 'int', min: 0, max: 3 },
    interference: { type: 'bool' },
  },
  presets: {
    easy: { length: 4, symbols: 'directions', previewMs: 900, mistakes: 2, interference: false },
    normal: { length: 5, symbols: 'directions', previewMs: 700, mistakes: 1, interference: false },
    hard: { length: 6, symbols: 'extended', previewMs: 560, mistakes: 1, interference: true },
    expert: { length: 8, symbols: 'extended', previewMs: 460, mistakes: 0, interference: true },
  },
  metrics: { length: 'number', correct: 'number', previewPresses: 'number', meanResponseMs: 'number' },
  hints: [
    { actions: ['up', 'right', 'down', 'left'], label: 'Repeat' },
  ],
  tutorial: 'Watch the solid symbols light up, then repeat them in order. Hollow flashes are noise; ignore them.',
  minDurationMs: 600,
  defaultTimeoutMs: (p) => Math.round(p.length * p.previewMs + READY_MS + p.length * 1500 + 2500),
  check(p, timeoutMs) {
    const minimum = p.length * p.previewMs + READY_MS + p.length * 350;
    return timeoutMs < minimum ? 'time_budget_too_short' : null;
  },
  create(p, rng) {
    const pool = SYMBOLS[p.symbols];
    const seq: Action[] = [];
    while (seq.length < p.length) {
      const symbol = rng.pick(pool);
      // No triple repeats: they read as one long flash and test counting, not memory.
      if (seq.length >= 2 && seq[seq.length - 1] === symbol && seq[seq.length - 2] === symbol) continue;
      seq.push(symbol);
    }
    const flashes: Flash[] = [];
    const lead = 350;
    seq.forEach((symbol, i) => {
      const at = lead + i * p.previewMs;
      flashes.push({ at, until: at + p.previewMs * LIT, symbol, decoy: false });
    });
    if (p.interference) {
      // Decoys appear only inside gaps, drawn hollow, and never on the next real symbol.
      for (let i = 0; i < seq.length - 1; i++) {
        if (rng.next() > 0.45) continue;
        const gapStart = lead + i * p.previewMs + p.previewMs * LIT;
        const decoy = rng.pick(pool.filter((sym) => sym !== seq[i + 1] && sym !== seq[i]));
        flashes.push({ at: gapStart + 10, until: gapStart + p.previewMs * (1 - LIT) - 10, symbol: decoy, decoy: true });
      }
      flashes.sort((a, b) => a.at - b.at);
    }
    const previewEnd = lead + p.length * p.previewMs;
    return {
      p, seq, flashes, previewEnd, readyEnd: previewEnd + READY_MS, armed: false, index: 0, mistakes: 0,
      previewPresses: 0, responses: [], lastAt: 0, feedback: null, failed: false,
    };
  },
  step(s, _dt, t, input) {
    if (!s.armed && t >= s.readyEnd && input.held.size === 0) {
      s.armed = true;
      s.lastAt = t;
    }
  },
  press(s, action, t) {
    const current = phase(s, t);
    if (current === 'preview') {
      s.previewPresses++;
      return;
    }
    if (current !== 'input' || !SYMBOLS[s.p.symbols].includes(action)) return;
    const ok = s.seq[s.index] === action;
    s.feedback = { symbol: action, ok, at: t };
    if (ok) {
      s.responses.push(t - s.lastAt);
      s.index++;
    } else {
      s.mistakes++;
      if (s.mistakes > s.p.mistakes) s.failed = true;
    }
    s.lastAt = t;
  },
  outcome(s) {
    if (s.failed) return { status: 'failed', reason: s.p.mistakes > 0 ? 'mistakes_exhausted' : 'missed' };
    if (s.index >= s.seq.length) return { status: 'success', reason: 'completed' };
    return null;
  },
  report(s) {
    const accuracy = s.index / Math.max(1, s.index + s.mistakes);
    const mean = s.responses.length ? s.responses.reduce((a, b) => a + b, 0) / s.responses.length : 0;
    // Speed is a declared secondary factor: 15% of the score, full marks at or under 400 ms per step.
    const speedFactor = s.responses.length ? clamp(1 - (mean - 400) / 1600) : 0;
    const completion = s.index / s.seq.length;
    return {
      score: toScore(completion * (0.85 * accuracy + 0.15 * speedFactor)),
      mistakes: s.mistakes,
      metrics: { length: s.seq.length, correct: s.index, previewPresses: s.previewPresses, meanResponseMs: Math.round(mean) },
    };
  },
});
