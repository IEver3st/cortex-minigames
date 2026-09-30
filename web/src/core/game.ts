// The registry contract. A game owns its mechanics; the engine and session runtime own time,
// input routing and lifecycle. Adding a game means adding one GameDef, never touching the runtime.

import type { Rng } from './rng';
import type { ParamSchema, Params } from './schema';
import type { Action, Hint, InputMode, InputState, Outcome, PointerEvt, Preset, Presentation, Report } from './types';

export interface GameDef<P extends Params = Params, S = unknown> {
  id: string;
  /** Contract version for this game's params, metrics and scoring. */
  version: number;
  name: string;
  inputs: readonly InputMode[];
  presentation: Presentation;
  /** Pointer-gesture games: in `auto` input mode Lua shows the NUI cursor so mouse motion reaches
   *  the UI even in a compact slip. Keyboard and pad still work without it. */
  cursor?: boolean;
  params: ParamSchema;
  presets: Record<Preset, P>;
  /** Allowlisted result metrics and their types; anything else is stripped by the runtime. */
  metrics: Record<string, 'number' | 'boolean'>;
  hints: Hint[];
  /** One sentence shown on first use. Plain text. */
  tutorial: string;
  /** Floor used by server plausibility checks; a legitimate success cannot be faster. */
  minDurationMs: number;
  defaultTimeoutMs(p: P): number;
  /** Cross-field contradictions (impossible budgets, targets below input precision). Error code or null. */
  check(p: P, timeoutMs: number): string | null;
  /** Build the logical challenge. Must be deterministic for a given rng seed. */
  create(p: P, rng: Rng, timeoutMs: number): S;
  /** Fixed-step simulation. `t` is simulation time in ms at the end of the step. */
  step?(s: S, dt: number, t: number, input: InputState): void;
  press?(s: S, action: Action, t: number, input: InputState): void;
  release?(s: S, action: Action, t: number, input: InputState): void;
  pointer?(s: S, event: PointerEvt, t: number, input: InputState): void;
  outcome(s: S, t: number): Outcome | null;
  report(s: S, outcome: Outcome | null, t: number, timeoutMs: number): Report;
}

// Generic helper so each game file keeps its own P/S types while the registry stores a uniform list.
export const defineGame = <P extends Params, S>(def: GameDef<P, S>): GameDef<P, S> => def;

export const clamp = (value: number, min = 0, max = 1): number => (value < min ? min : value > max ? max : value);
export const round2 = (value: number): number => Math.round(value * 100) / 100;
