// Player-facing words for statuses and reasons. Reasons are a closed vocabulary; unknown ones
// fall back to the status headline so no raw identifier ever reaches the screen.

import type { Status } from '../core/types';

export const HEADLINES: Record<Status, string> = {
  success: 'Clear',
  failed: 'Failed',
  timeout: 'Out of time',
  cancelled: 'Cancelled',
  error: 'Interrupted',
  rejected: 'Unavailable',
};

export const GRADE_WORDS: Record<string, string> = { perfect: 'Perfect', good: 'Clean', pass: 'Done' };

const REASON_TEXT: Record<string, string> = {
  missed: 'Missed the window',
  mistakes_exhausted: 'Too many mistakes',
  overstressed: 'The part gave out',
  tool_broke: 'The tool snapped',
  tests_exhausted: 'No tests left',
  submissions_exhausted: 'No attempts left',
  boundary_contact: 'Touched the edge too often',
  early_release: 'Released too early',
  step_failed: 'A step failed',
  abandoned: 'You gave up',
  time_expired: 'The clock ran out',
  hard_deadline: 'The clock ran out',
  sequence_deadline: 'The job ran out of time',
  player_cancelled: 'You stepped away',
  caller_cancelled: 'Stopped',
  player_died: 'You went down',
  left_area: 'You moved too far away',
  target_lost: 'The target is gone',
  context_check: 'Conditions changed',
  logged_out: 'Character changed',
  caller_stopped: 'Stopped',
  resource_stopping: 'Stopped',
  server_cancelled: 'Stopped by the server',
  attempt_expired: 'The attempt expired',
  practice_idle: 'No response',
  ui_startup_timeout: 'Could not start',
  ui_error: 'Something went wrong',
  bridge_failure: 'Something went wrong',
  invalid_report: 'Something went wrong',
  focus_failed: 'Another screen is open',
};

// Operator locale overrides from Lua (locales/<code>.lua `ui` table). Plain text, bounded upstream.
let overrides: Record<string, string> = {};
export function setStrings(strings: Record<string, string>): void {
  overrides = { ...strings };
}

/** Localised text for `key`, falling back to the built-in English. */
export const t = (key: string, fallback: string): string => overrides[key] ?? fallback;

export const headline = (status: Status): string => t(`headline.${status}`, HEADLINES[status]);
export const gradeWord = (grade: string): string => t(`grade.${grade}`, GRADE_WORDS[grade] ?? HEADLINES.success);
export const reasonText = (reason: string): string => t(`reason.${reason}`, REASON_TEXT[reason] ?? '');
