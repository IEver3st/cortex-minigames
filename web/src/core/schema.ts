// Declarative parameter schemas. The same declarations are emitted to shared/catalog.json so the Lua
// runtime and the server-attempt service validate exactly the rules the UI enforces.

import { QTE_ACTIONS } from './types';

export type ParamSpec =
  | { type: 'int'; min: number; max: number }
  | { type: 'number'; min: number; max: number }
  | { type: 'bool' }
  | { type: 'enum'; values: readonly string[] }
  | { type: 'prompts'; maxItems: number };

export type ParamSchema = Record<string, ParamSpec>;
export type Params = Record<string, unknown>;

export const PROMPT_TYPES = ['press', 'hold', 'release', 'alternate', 'chord', 'react', 'tap'] as const;
export type PromptType = (typeof PROMPT_TYPES)[number];

/** Bounds for each QTE prompt field. Emitted to the catalog alongside game schemas. */
export const PROMPT_FIELDS = {
  windowMs: { type: 'int', min: 300, max: 6000 },
  durationMs: { type: 'int', min: 300, max: 5000 },
  count: { type: 'int', min: 2, max: 20 },
  toleranceMs: { type: 'int', min: 40, max: 500 },
  minDelayMs: { type: 'int', min: 300, max: 5000 },
  maxDelayMs: { type: 'int', min: 300, max: 6000 },
  targetStart: { type: 'number', min: 0.15, max: 0.85 },
  targetWidth: { type: 'number', min: 0.06, max: 0.4 },
  earlyRelease: { type: 'enum', values: ['fail', 'restart'] },
} as const satisfies ParamSchema;

export interface ValidationError {
  code: 'invalid_params';
  field: string;
  message: string;
}

const fail = (field: string, message: string): ValidationError => ({ code: 'invalid_params', field, message });

function checkScalar(field: string, spec: ParamSpec, value: unknown): ValidationError | null {
  switch (spec.type) {
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) return fail(field, 'must be an integer');
      if (value < spec.min || value > spec.max) return fail(field, `must be ${spec.min}..${spec.max}`);
      return null;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail(field, 'must be a finite number');
      if (value < spec.min || value > spec.max) return fail(field, `must be ${spec.min}..${spec.max}`);
      return null;
    case 'bool':
      return typeof value === 'boolean' ? null : fail(field, 'must be a boolean');
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value) ? null : fail(field, `must be one of ${spec.values.join(', ')}`);
    case 'prompts':
      return validatePrompts(field, value, spec.maxItems);
  }
}

const ACTION_COUNT: Record<PromptType, [number, number]> = {
  press: [1, 1], hold: [1, 1], release: [1, 1], react: [1, 1], tap: [1, 1], alternate: [2, 2], chord: [2, 3],
};
const PROMPT_REQUIRED: Record<PromptType, (keyof typeof PROMPT_FIELDS)[]> = {
  press: ['windowMs'],
  hold: ['windowMs', 'durationMs'],
  release: ['windowMs', 'durationMs'],
  alternate: ['windowMs', 'count'],
  chord: ['windowMs'],
  react: ['windowMs'],
  tap: ['windowMs', 'count'],
};

export function validatePrompts(field: string, value: unknown, maxItems: number): ValidationError | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) return fail(field, `must be a list of 1..${maxItems} prompts`);
  for (let i = 0; i < value.length; i++) {
    const prompt = value[i] as Record<string, unknown>;
    const path = `${field}[${i + 1}]`;
    if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) return fail(path, 'must be an object');
    const type = prompt.type as PromptType;
    if (!PROMPT_TYPES.includes(type)) return fail(`${path}.type`, `must be one of ${PROMPT_TYPES.join(', ')}`);
    const actions = prompt.actions;
    const [minA, maxA] = ACTION_COUNT[type];
    if (!Array.isArray(actions) || actions.length < minA || actions.length > maxA) return fail(`${path}.actions`, `needs ${minA}..${maxA} actions`);
    if (new Set(actions).size !== actions.length) return fail(`${path}.actions`, 'must not repeat an action');
    for (const action of actions) {
      if (!(QTE_ACTIONS as readonly string[]).includes(action as string)) return fail(`${path}.actions`, `unknown action ${String(action)}`);
    }
    for (const key of Object.keys(prompt)) {
      if (key === 'type' || key === 'actions') continue;
      const spec = (PROMPT_FIELDS as ParamSchema)[key];
      if (!spec) return fail(`${path}.${key}`, 'is not a prompt field');
      const error = checkScalar(`${path}.${key}`, spec, prompt[key]);
      if (error) return error;
    }
    for (const key of PROMPT_REQUIRED[type]) {
      if (prompt[key] === undefined) return fail(`${path}.${key}`, 'is required');
    }
    if (type === 'react') {
      const min = (prompt.minDelayMs as number | undefined) ?? 800;
      const max = (prompt.maxDelayMs as number | undefined) ?? 2500;
      if (min > max) return fail(`${path}.minDelayMs`, 'must not exceed maxDelayMs');
    }
    if (type === 'release') {
      const start = (prompt.targetStart as number | undefined) ?? 0.55;
      const width = (prompt.targetWidth as number | undefined) ?? 0.18;
      if (start + width > 0.95) return fail(`${path}.targetWidth`, 'target must end before 0.95');
    }
  }
  return null;
}

/**
 * Merge caller params over preset params and validate every field. Unknown keys are rejected so a
 * typo never silently falls back to a default.
 */
export function resolveParams(schema: ParamSchema, base: Params, overrides: unknown): { params: Params } | { error: ValidationError } {
  if (overrides !== undefined && overrides !== null && (typeof overrides !== 'object' || Array.isArray(overrides))) {
    return { error: fail('params', 'must be an object') };
  }
  const merged: Params = { ...base };
  for (const [key, value] of Object.entries((overrides as Params | undefined) ?? {})) {
    if (!(key in schema)) return { error: fail(key, 'is not a parameter of this game') };
    merged[key] = value;
  }
  for (const [key, spec] of Object.entries(schema)) {
    if (merged[key] === undefined) return { error: fail(key, 'is required') };
    const error = checkScalar(key, spec, merged[key]);
    if (error) return { error };
  }
  return { params: merged };
}
