// NUI protocol v1. Lua → UI messages are parsed defensively; anything malformed, from another
// protocol version, or from an older resource generation is dropped before it reaches a game.

import { isBindableCode, RESERVED_CODES } from './input';
import { ACTIONS, PROTOCOL, type Action, type Presentation } from './types';

export interface Prefs {
  volume: number;
  muted: boolean;
  motion: 'auto' | 'reduced' | 'full';
  scale: number;
  keys: Partial<Record<Action, string>>;
}

export const DEFAULT_PREFS: Prefs = { volume: 0.5, muted: false, motion: 'auto', scale: 1, keys: {} };

/** Play timeout cap in ms, inclusive at both ends. config.lua's Config.Bounds clamps to the same range. */
export const TIMEOUT_BOUNDS = { min: 1000, max: 180000 } as const;

export interface OpenSpec {
  game: string;
  preset: string;
  params: Record<string, unknown>;
  seed: number;
  /** Absent when the caller gave none: the UI computes the game default and reports it on ready. */
  timeoutMs?: number;
  minTimeoutMs: number;
  maxTimeoutMs: number;
  title: string;
  instruction: string;
  presentation: { mode: Presentation; anchor: 'bottom' | 'center'; scale: number };
  practice: boolean;
  feedbackMs: number;
  audio: { volume: number; muted: boolean };
  reducedMotion: boolean;
  step: null | { index: number; total: number };
}

export type InboundMessage =
  | { type: 'boot'; gen: number; prefs: Prefs; strings: Record<string, string> }
  | { type: 'open'; gen: number; sid: string; spec: OpenSpec }
  | { type: 'start'; gen: number; sid: string }
  | { type: 'input'; gen: number; sid: string; kind: 'press' | 'release'; action: Action }
  | { type: 'axes'; gen: number; sid: string; lx: number; ly: number; rt: number }
  | { type: 'close'; gen: number; sid: string; status: string; reason: string; feedbackMs: number }
  | { type: 'prefs'; gen: number; prefs: Prefs };

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isStr = (value: unknown, max = 128): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const bounded = (value: unknown, min: number, max: number, fallback: number) => (isNum(value) ? Math.min(max, Math.max(min, value)) : fallback);

export function parsePrefs(value: unknown): Prefs {
  if (!isObject(value)) return { ...DEFAULT_PREFS };
  const keys: Partial<Record<Action, string>> = {};
  if (isObject(value.keys)) {
    for (const [action, code] of Object.entries(value.keys)) {
      // Only real KeyboardEvent.code values; cancel and the reserved fallbacks never move.
      if ((ACTIONS as readonly string[]).includes(action) && action !== 'cancel' && isBindableCode(code) && !RESERVED_CODES.has(code)) keys[action as Action] = code;
    }
  }
  return {
    volume: bounded(value.volume, 0, 1, DEFAULT_PREFS.volume),
    muted: value.muted === true,
    motion: value.motion === 'reduced' || value.motion === 'full' ? value.motion : 'auto',
    scale: bounded(value.scale, 0.75, 1.5, 1),
    keys,
  };
}

/** Locale overrides: bounded count and length, plain text only. */
export function parseStrings(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObject(value)) return out;
  let count = 0;
  for (const [key, text] of Object.entries(value)) {
    if (count >= 200) break;
    if (key.length <= 64 && typeof text === 'string' && text.length <= 160) { out[key] = text; count++; }
  }
  return out;
}

function parseSpec(value: unknown): OpenSpec | null {
  if (!isObject(value) || !isStr(value.game, 32) || !isStr(value.preset, 16) || !isObject(value.params)) return null;
  if (!isNum(value.seed) || (value.timeoutMs !== undefined && value.timeoutMs !== null && !isNum(value.timeoutMs))) return null;
  const presentation = isObject(value.presentation) ? value.presentation : {};
  const audio = isObject(value.audio) ? value.audio : {};
  const step = isObject(value.step) && isNum(value.step.index) && isNum(value.step.total)
    ? { index: Math.trunc(value.step.index), total: Math.trunc(value.step.total) } : null;
  return {
    game: value.game,
    preset: value.preset,
    params: value.params,
    seed: Math.trunc(value.seed),
    timeoutMs: isNum(value.timeoutMs) ? Math.trunc(value.timeoutMs) : undefined,
    minTimeoutMs: bounded(value.minTimeoutMs, TIMEOUT_BOUNDS.min, TIMEOUT_BOUNDS.max, TIMEOUT_BOUNDS.min),
    maxTimeoutMs: bounded(value.maxTimeoutMs, TIMEOUT_BOUNDS.min, TIMEOUT_BOUNDS.max, TIMEOUT_BOUNDS.max),
    title: typeof value.title === 'string' ? value.title.slice(0, 64) : '',
    instruction: typeof value.instruction === 'string' ? value.instruction.slice(0, 140) : '',
    presentation: {
      mode: presentation.mode === 'compact' || presentation.mode === 'focused' ? presentation.mode : 'focused',
      anchor: presentation.anchor === 'center' ? 'center' : 'bottom',
      scale: bounded(presentation.scale, 0.75, 1.5, 1),
    },
    practice: value.practice === true,
    feedbackMs: bounded(value.feedbackMs, 0, 2000, 650),
    audio: { volume: bounded(audio.volume, 0, 1, 0.5), muted: audio.muted === true },
    reducedMotion: value.reducedMotion === true,
    step,
  };
}

export function parseMessage(data: unknown): InboundMessage | null {
  if (!isObject(data) || data.protocol !== PROTOCOL || !isStr(data.type, 16) || !isNum(data.gen)) return null;
  const gen = data.gen;
  const sid = data.sid;
  switch (data.type) {
    case 'boot':
      return { type: 'boot', gen, prefs: parsePrefs(data.prefs), strings: parseStrings(data.strings) };
    case 'prefs':
      return { type: 'prefs', gen, prefs: parsePrefs(data.prefs) };
    case 'open': {
      const spec = parseSpec(data.spec);
      return isStr(sid, 40) && spec ? { type: 'open', gen, sid, spec } : null;
    }
    case 'start':
      return isStr(sid, 40) ? { type: 'start', gen, sid } : null;
    case 'input':
      return isStr(sid, 40) && (data.kind === 'press' || data.kind === 'release') && (ACTIONS as readonly string[]).includes(data.action as string)
        ? { type: 'input', gen, sid, kind: data.kind, action: data.action as Action } : null;
    case 'axes':
      return isStr(sid, 40) ? { type: 'axes', gen, sid, lx: bounded(data.lx, -1, 1, 0), ly: bounded(data.ly, -1, 1, 0), rt: bounded(data.rt, 0, 1, 0) } : null;
    case 'close':
      return isStr(sid, 40) && isStr(data.status, 16) && isStr(data.reason, 40)
        ? { type: 'close', gen, sid, status: data.status, reason: data.reason, feedbackMs: bounded(data.feedbackMs, 0, 2000, 650) } : null;
    default:
      return null;
  }
}
