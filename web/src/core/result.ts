// Grade thresholds are shared by every game so a grade means the same thing everywhere.
// Scores stay comparable only within one game and preset.

import type { Grade, Report, Status } from './types';

export const GRADE_THRESHOLDS = { perfect: 95, good: 75 } as const;
export const MAX_METRICS = 12;

export function gradeFor(status: Status, report: Pick<Report, 'score' | 'mistakes' | 'perfect'>): Grade | null {
  if (status === 'failed' || status === 'timeout') return 'fail';
  if (status !== 'success') return null;
  const score = report.score ?? 0;
  if ((report.perfect ?? true) && report.mistakes === 0 && score >= GRADE_THRESHOLDS.perfect) return 'perfect';
  if (score >= GRADE_THRESHOLDS.good) return 'good';
  return 'pass';
}

export const toScore = (fraction: number): number => Math.round(Math.min(1, Math.max(0, fraction)) * 100);

/** Strip metrics to the game's allowlist, finite numbers and booleans only. */
export function cleanMetrics(allow: Record<string, 'number' | 'boolean'>, metrics: Record<string, number | boolean>): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  let count = 0;
  for (const [key, kind] of Object.entries(allow)) {
    const value = metrics[key];
    if (count >= MAX_METRICS) break;
    if (kind === 'boolean' && typeof value === 'boolean') out[key] = value;
    else if (kind === 'number' && typeof value === 'number' && Number.isFinite(value)) out[key] = Math.round(value * 1000) / 1000;
    else continue;
    count++;
  }
  return out;
}
