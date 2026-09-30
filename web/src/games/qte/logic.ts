// Composable QTE: a bounded chain of allowlisted prompt primitives. Definitions are data only
// (types, actions, durations, windows); nothing executable ever crosses from a caller or the NUI.

import { clamp, defineGame } from '../../core/game';
import { toScore } from '../../core/result';
import type { Rng } from '../../core/rng';
import type { PromptType } from '../../core/schema';
import type { Action, InputState } from '../../core/types';

export type PromptDef = {
  type: PromptType;
  actions: Action[];
  windowMs: number;
  durationMs?: number;
  count?: number;
  toleranceMs?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  targetStart?: number;
  targetWidth?: number;
  earlyRelease?: 'fail' | 'restart';
};

export type QteParams = {
  prompts: PromptDef[];
  mistakes: number;
  leadMs: number;
};

export const GAP_MS = 260;
/** Taps faster than this are ignored so mashing never beats rhythm. */
export const TAP_MIN_INTERVAL_MS = 80;

export type PromptRun = {
  def: PromptDef;
  leadEnd: number; // the get-ready lead ends
  openAt: number; // window opens (after lead, or after the react cue)
  cueAt: number; // react only: when the cue appears
  pressTimes: Partial<Record<Action, number>>; // chord: press times inside the window
  progress: number; // hold ms, alternate/tap count
  holdStart: number | null;
  lastAction: Action | null;
  lastTap: number;
  done: null | { ok: boolean; at: number; quality: number };
};

export type QteState = {
  p: QteParams;
  rng: Rng;
  index: number;
  run: PromptRun;
  mistakes: number;
  qualities: number[];
  reactions: number[];
  failed: boolean;
  lastMiss: number;
};

function startPrompt(s: QteState, at: number): PromptRun {
  const def = s.p.prompts[s.index];
  const leadEnd = at + s.p.leadMs;
  let cueAt = 0, openAt = leadEnd;
  if (def.type === 'react') {
    cueAt = leadEnd + s.rng.range(def.minDelayMs ?? 800, def.maxDelayMs ?? 2500);
    openAt = cueAt;
  }
  return { def, leadEnd, openAt, cueAt, pressTimes: {}, progress: 0, holdStart: null, lastAction: null, lastTap: -Infinity, done: null };
}

export type QtePhase = 'lead' | 'wait' | 'active' | 'gap' | 'done';

export function qtePhase(s: QteState, t: number): QtePhase {
  if (s.failed || s.index >= s.p.prompts.length) return 'done';
  const run = s.run;
  if (run.done) return 'gap';
  if (t < run.leadEnd) return 'lead';
  if (run.def.type === 'react' && t < run.cueAt) return 'wait';
  return t < run.openAt ? 'lead' : 'active';
}

/** Fraction of the active window already used, 0..1. Release prompts report their sweep instead. */
export function windowUsed(s: QteState, t: number): number {
  const run = s.run;
  if (run.def.type === 'release' && run.holdStart !== null) return clamp((t - run.holdStart) / (run.def.durationMs ?? 1500));
  return clamp((t - run.openAt) / run.def.windowMs);
}

function finishPrompt(s: QteState, ok: boolean, t: number, quality = 1): void {
  if (s.run.done) return;
  s.run.done = { ok, at: t, quality: ok ? clamp(quality) : 0 };
  if (ok) {
    s.qualities.push(clamp(quality));
    // The last prompt completes immediately; the gap only separates prompts.
    if (s.index === s.p.prompts.length - 1) s.index++;
    return;
  }
  s.mistakes++;
  s.lastMiss = t;
  if (s.mistakes > s.p.mistakes) s.failed = true;
}

const expired = (run: PromptRun, t: number) => t > run.openAt + run.def.windowMs;

export const qte = defineGame<QteParams, QteState>({
  id: 'qte',
  version: 1,
  name: 'Quick Time',
  inputs: ['keyboard', 'mouse', 'controller'],
  presentation: 'compact',
  params: {
    prompts: { type: 'prompts', maxItems: 8 },
    mistakes: { type: 'int', min: 0, max: 3 },
    leadMs: { type: 'int', min: 250, max: 1500 },
  },
  presets: {
    easy: { prompts: [{ type: 'press', actions: ['primary'], windowMs: 1600 }], mistakes: 1, leadMs: 700 },
    normal: { prompts: [{ type: 'press', actions: ['primary'], windowMs: 1100 }], mistakes: 0, leadMs: 600 },
    hard: {
      prompts: [
        { type: 'press', actions: ['primary'], windowMs: 850 },
        { type: 'hold', actions: ['alt'], windowMs: 900, durationMs: 900, earlyRelease: 'fail' },
      ],
      mistakes: 0, leadMs: 500,
    },
    expert: {
      prompts: [
        { type: 'react', actions: ['primary'], windowMs: 600, minDelayMs: 700, maxDelayMs: 2200 },
        { type: 'alternate', actions: ['left', 'right'], windowMs: 2400, count: 8 },
        { type: 'release', actions: ['primary'], windowMs: 900, durationMs: 1400, targetStart: 0.6, targetWidth: 0.14 },
      ],
      mistakes: 0, leadMs: 450,
    },
  },
  metrics: { prompts: 'number', completed: 'number', meanReactionMs: 'number' },
  hints: [],
  tutorial: 'Follow each prompt: press, hold, release or alternate the shown keys inside the window.',
  minDurationMs: 150,
  defaultTimeoutMs: (p) => Math.round(1500 + p.prompts.reduce((sum, prompt) =>
    sum + p.leadMs + GAP_MS + prompt.windowMs + (prompt.durationMs ?? 0) + (prompt.type === 'react' ? (prompt.maxDelayMs ?? 2500) : 0), 0) * (1 + p.mistakes)),
  check(p, timeoutMs) {
    const oneRun = p.prompts.reduce((sum, prompt) => sum + p.leadMs + prompt.windowMs + (prompt.durationMs ?? 0) + (prompt.type === 'react' ? (prompt.maxDelayMs ?? 2500) : 0), 0);
    if (timeoutMs < oneRun) return 'time_budget_too_short';
    for (const prompt of p.prompts) {
      if (prompt.type === 'hold' && (prompt.durationMs ?? 0) > prompt.windowMs + 5000) return 'hold_exceeds_window';
      if (prompt.type === 'alternate' && (prompt.windowMs / (prompt.count ?? 1)) < 110) return 'alternate_too_fast';
      if (prompt.type === 'tap' && (prompt.windowMs / (prompt.count ?? 1)) < TAP_MIN_INTERVAL_MS * 1.5) return 'tap_too_fast';
      if (prompt.type === 'release') {
        const width = (prompt.targetWidth ?? 0.18) * (prompt.durationMs ?? 1500);
        if (width < 90) return 'window_too_fast';
      }
    }
    return null;
  },
  create(p, rng) {
    const s: QteState = { p, rng, index: 0, run: undefined as unknown as PromptRun, mistakes: 0, qualities: [], reactions: [], failed: false, lastMiss: -Infinity };
    s.run = startPrompt(s, 0);
    return s;
  },
  step(s, _dt, t) {
    if (s.failed || s.index >= s.p.prompts.length) return;
    const run = s.run;
    if (run.done) {
      if (t - run.done.at >= GAP_MS) {
        if (run.done.ok) s.index++;
        if (s.index < s.p.prompts.length) s.run = startPrompt(s, t); // a failed prompt is retried while mistakes remain
      }
      return;
    }
    const def = run.def;
    if (def.type === 'hold' && run.holdStart !== null) {
      if (t - run.holdStart >= (def.durationMs ?? 1000)) finishPrompt(s, true, t, 1);
      return;
    }
    if (def.type === 'release' && run.holdStart !== null) {
      if (t - run.holdStart > (def.durationMs ?? 1500)) finishPrompt(s, false, t);
      return;
    }
    if (t >= run.openAt && expired(run, t)) finishPrompt(s, false, t);
  },
  press(s, action, t, input) {
    if (s.failed || s.index >= s.p.prompts.length || s.run.done) return;
    const run = s.run;
    const def = run.def;
    const relevant = def.actions.includes(action);
    if (t < run.leadEnd) return; // presses during the lead are ignored, never charged
    if (def.type === 'react' && t < run.cueAt) {
      // Early input on a reaction prompt costs a mistake and re-arms with a fresh delay.
      if (relevant) finishPrompt(s, false, t);
      return;
    }
    if (t < run.openAt) return;
    if (!relevant) return;
    const used = windowUsed(s, t);
    switch (def.type) {
      case 'press':
        finishPrompt(s, true, t, 1 - used * 0.5);
        break;
      case 'react':
        s.reactions.push(t - run.cueAt);
        finishPrompt(s, true, t, 1 - used);
        break;
      case 'hold':
      case 'release':
        if (run.holdStart === null) run.holdStart = t;
        break;
      case 'alternate':
        if (action !== run.lastAction) {
          run.lastAction = action;
          run.progress++;
          if (run.progress >= (def.count ?? 6)) finishPrompt(s, true, t, 1 - used * 0.5);
        }
        break;
      case 'tap':
        if (t - run.lastTap >= TAP_MIN_INTERVAL_MS) {
          run.lastTap = t;
          run.progress++;
          if (run.progress >= (def.count ?? 5)) finishPrompt(s, true, t, 1 - used * 0.5);
        }
        break;
      case 'chord': {
        // Every key must be pressed inside the window (keys held from the lead do not count),
        // and the first-to-last spread must stay within tolerance.
        run.pressTimes[action] = t;
        const times = def.actions.map((a) => (input.held.has(a) ? run.pressTimes[a] : undefined));
        if (times.every((time) => time !== undefined)) {
          const spread = Math.max(...(times as number[])) - Math.min(...(times as number[]));
          if (spread <= (def.toleranceMs ?? 200)) finishPrompt(s, true, t, 1 - used * 0.5);
        }
        break;
      }
    }
  },
  release(s, action, t) {
    const run = s.run;
    if (!run || run.done || run.holdStart === null || !run.def.actions.includes(action)) return;
    const def = run.def;
    if (def.type === 'hold') {
      if (def.earlyRelease === 'restart') {
        run.holdStart = null;
        s.mistakes++;
        s.lastMiss = t;
        if (s.mistakes > s.p.mistakes) s.failed = true;
      } else finishPrompt(s, false, t);
    } else if (def.type === 'release') {
      const sweep = (t - run.holdStart) / (def.durationMs ?? 1500);
      const start = def.targetStart ?? 0.55, width = def.targetWidth ?? 0.18;
      const ok = sweep >= start && sweep <= start + width;
      finishPrompt(s, ok, t, ok ? 1 - Math.abs(sweep - (start + width / 2)) / (width / 2) * 0.5 : 0);
    }
  },
  outcome(s) {
    if (s.failed) return { status: 'failed', reason: s.run?.def.type === 'hold' && s.run.done && !s.run.done.ok ? 'early_release' : 'missed' };
    if (s.index >= s.p.prompts.length) return { status: 'success', reason: 'completed' };
    return null;
  },
  report(s) {
    const total = s.p.prompts.length;
    const mean = s.qualities.length ? s.qualities.reduce((a, b) => a + b, 0) / s.qualities.length : 0;
    const completion = Math.min(s.index, total) / total;
    return {
      score: toScore(completion * mean * (1 - 0.2 * s.mistakes)),
      mistakes: s.mistakes,
      metrics: {
        prompts: total, completed: Math.min(s.index, total),
        meanReactionMs: s.reactions.length ? Math.round(s.reactions.reduce((a, b) => a + b, 0) / s.reactions.length) : 0,
      },
    };
  },
});

export type { InputState };
