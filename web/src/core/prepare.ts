// Resolve a caller spec into a playable configuration: game defaults, then preset, then permitted
// caller overrides, then contradiction checks. Runs before any focus is taken.

import { getGame } from '../games/registry';
import type { GameDef } from './game';
import { TIMEOUT_BOUNDS } from './protocol';
import { MAX_SEED } from './rng';
import { resolveParams, type Params } from './schema';
import { PRESETS, type Preset } from './types';

export interface PlaySpec {
  game: string;
  preset?: string;
  params?: unknown;
  seed?: number;
  timeoutMs?: number;
}

export type Prepared = { def: GameDef; preset: Preset; params: Params; seed: number; timeoutMs: number };
export type PrepareError = { reason: 'unknown_game' | 'invalid_options' | 'invalid_params'; field?: string; message: string };

export { TIMEOUT_BOUNDS };

export function prepare(spec: PlaySpec): { ok: true; value: Prepared } | { ok: false; error: PrepareError } {
  const def = getGame(spec.game);
  if (!def) return { ok: false, error: { reason: 'unknown_game', field: 'game', message: `unknown game ${String(spec.game)}` } };
  const preset = (spec.preset ?? 'normal') as Preset;
  if (!PRESETS.includes(preset)) return { ok: false, error: { reason: 'invalid_options', field: 'preset', message: 'unknown preset' } };
  const seed = spec.seed ?? 0;
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) return { ok: false, error: { reason: 'invalid_options', field: 'seed', message: 'seed must be 0..2147483647' } };
  const resolved = resolveParams(def.params, def.presets[preset], spec.params);
  if ('error' in resolved) return { ok: false, error: { reason: 'invalid_params', field: resolved.error.field, message: resolved.error.message } };
  const timeoutMs = spec.timeoutMs ?? def.defaultTimeoutMs(resolved.params);
  const timeoutInBounds = Number.isInteger(timeoutMs) && timeoutMs >= TIMEOUT_BOUNDS.min && timeoutMs <= TIMEOUT_BOUNDS.max;
  // Reject invalid caller budgets first, but don't let a derived budget hide contradictory params.
  if (timeoutInBounds || spec.timeoutMs == null) {
    const contradiction = def.check(resolved.params, timeoutMs);
    if (contradiction) return { ok: false, error: { reason: 'invalid_params', field: 'params', message: contradiction } };
  }
  if (!timeoutInBounds) {
    return { ok: false, error: { reason: 'invalid_options', field: 'timeoutMs', message: `timeoutMs must be ${TIMEOUT_BOUNDS.min}..${TIMEOUT_BOUNDS.max}` } };
  }
  return { ok: true, value: { def, preset, params: resolved.params, seed, timeoutMs } };
}
