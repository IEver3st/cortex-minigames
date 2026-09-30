// Public contract shared by the registry, the engine, the bridge and the emitted Lua catalog.
// Changing a value here is an API change: bump API_VERSION or the affected game's version.

export const API_VERSION = 1 as const;
export const PROTOCOL = 1 as const;

export const PRESETS = ['easy', 'normal', 'hard', 'expert'] as const;
export type Preset = (typeof PRESETS)[number];

export const STATUSES = ['success', 'failed', 'cancelled', 'timeout', 'error', 'rejected'] as const;
export type Status = (typeof STATUSES)[number];
export type Grade = 'perfect' | 'good' | 'pass' | 'fail';

/** Abstract actions. Every device maps onto these; games never read raw keys. */
export const ACTIONS = ['up', 'down', 'left', 'right', 'primary', 'alt', 'prev', 'next', 'rotate', 'cancel'] as const;
export type Action = (typeof ACTIONS)[number];
/** Actions a caller may name in a QTE prompt. `cancel` is reserved for emergency dismissal. */
export const QTE_ACTIONS = ACTIONS.filter((a) => a !== 'cancel') as Exclude<Action, 'cancel'>[];

export type Device = 'keyboard' | 'mouse' | 'pad';
export const INPUT_MODES = ['keyboard', 'mouse', 'controller'] as const;
export type InputMode = (typeof INPUT_MODES)[number];
export type Presentation = 'compact' | 'focused';

/** Reasons are a closed vocabulary; UI text is derived from them, never the other way round. */
export const REASONS = {
  success: ['completed'],
  failed: [
    'missed', 'mistakes_exhausted', 'overstressed', 'tool_broke', 'tests_exhausted',
    'submissions_exhausted', 'boundary_contact', 'early_release', 'step_failed', 'abandoned',
  ],
  timeout: ['time_expired', 'hard_deadline', 'sequence_deadline'],
  cancelled: [
    'player_cancelled', 'caller_cancelled', 'player_died', 'left_area', 'target_lost', 'context_check',
    'logged_out', 'caller_stopped', 'resource_stopping', 'server_cancelled', 'attempt_expired', 'practice_idle',
  ],
  error: ['ui_startup_timeout', 'ui_error', 'bridge_failure', 'invalid_report', 'focus_failed', 'generation_failed'],
  rejected: [
    'busy', 'invalid_options', 'invalid_params', 'unknown_game', 'unsupported_input', 'focus_unavailable',
    'not_owner', 'invalid_sequence', 'dependency_missing',
  ],
} as const satisfies Record<Status, readonly string[]>;

export interface Outcome {
  status: 'success' | 'failed' | 'timeout';
  reason: string;
}

export interface Report {
  score: number | null;
  mistakes: number;
  metrics: Record<string, number | boolean>;
  /** Game-specific perfect flag; grade stays non-contradictory with status. */
  perfect?: boolean;
}

export interface MinigameResult {
  apiVersion: typeof API_VERSION;
  sessionId: string | null;
  game: string;
  status: Status;
  reason: string;
  score: number | null;
  grade: Grade | null;
  durationMs: number;
  mistakes: number;
  metrics: Record<string, number | boolean>;
}

/** Live input snapshot the engine hands to fixed-step simulation. */
export interface InputState {
  held: Set<Action>;
  /** Analog axes from a controller, -1..1 (sticks) or 0..1 (trigger). Zero when absent. */
  axes: { lx: number; ly: number; rt: number };
}

export type PointerEvt =
  | { kind: 'target'; x: number; y: number; grab: boolean }
  | { kind: 'drag'; dx: number; dy: number; control?: number }
  | { kind: 'set'; control: number; value: number }
  | { kind: 'wheel'; dir: -1 | 1; control?: number }
  | { kind: 'select'; index: number }
  | { kind: 'cell'; index: number; button: 0 | 2 }
  | { kind: 'tray'; index: number };

export interface Hint {
  actions: Action[];
  label: string;
}
