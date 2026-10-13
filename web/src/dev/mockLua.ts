// Development stand-in for client/session.lua. It speaks protocol v1 to the real UI session so
// the playground exercises production components and logic; only the bridge and game context are
// simulated. Failure switches reproduce the runtime paths the Lua side owns.

import { setLocalHandler, type CallbackName, type Reply } from '../core/bridge';
import type { OpenSpec, Prefs } from '../core/protocol';
import { PROTOCOL } from '../core/types';

export interface MockFaults {
  /** Never acknowledge `ready`, so the startup timeout fires. */
  dropReady: boolean;
  /** Reject the completion report as if it failed server-side validation. */
  rejectComplete: boolean;
}

export interface MockResult {
  sessionId: string;
  status: string;
  reason: string;
  score: number | null;
  grade: string | null;
  durationMs: number;
  mistakes: number;
  metrics: Record<string, number | boolean>;
}

const STARTUP_TIMEOUT_MS = 5000;
const HARD_GRACE_MS = 1500;
const PRACTICE_IDLE_MS = 30000;
const MAX_STALL_EXTENSION_MS = 15000;

export class MockLua {
  gen = 1;
  faults: MockFaults = { dropReady: false, rejectComplete: false };
  onResult: (result: MockResult) => void = () => {};
  private sid: string | null = null;
  private spec: OpenSpec | null = null;
  private timer = 0;
  private counter = 0;
  private started = 0;
  private deadlineAt = 0;
  private stallGranted = 0;

  constructor(private deliver: (message: object) => void, private prefs: Prefs) {
    setLocalHandler((name, body) => this.handle(name, body));
    this.deliver({ protocol: PROTOCOL, type: 'boot', gen: this.gen, prefs });
  }

  setPrefs(prefs: Prefs): void {
    this.prefs = prefs;
    this.deliver({ protocol: PROTOCOL, type: 'prefs', gen: this.gen, prefs });
  }

  get busy(): boolean {
    return this.sid !== null;
  }

  /** Mirrors Play(): returns false with `busy` while a session exists. */
  play(spec: OpenSpec): { ok: boolean; reason?: string } {
    if (this.sid) return { ok: false, reason: 'busy' };
    this.sid = `dev-${++this.counter}`;
    this.spec = spec;
    this.started = performance.now();
    this.deliver({ protocol: PROTOCOL, type: 'open', gen: this.gen, sid: this.sid, spec });
    this.arm(STARTUP_TIMEOUT_MS, () => this.finish('error', 'ui_startup_timeout'));
    return { ok: true };
  }

  cancel(reason = 'caller_cancelled'): void {
    if (this.sid) this.finish('cancelled', reason);
  }

  forceDeadline(): void {
    if (this.sid) this.finish('timeout', 'hard_deadline');
  }

  /** Simulates a resource restart: a new generation makes every in-flight message stale. */
  restart(): void {
    if (this.sid) this.finish('cancelled', 'resource_stopping');
    this.gen++;
    this.deliver({ protocol: PROTOCOL, type: 'boot', gen: this.gen, prefs: this.prefs });
  }

  private arm(ms: number, fn: () => void): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(fn, ms);
  }

  private finish(status: string, reason: string, report?: Partial<MockResult>): void {
    const sid = this.sid;
    if (!sid) return;
    clearTimeout(this.timer);
    this.sid = null;
    this.deliver({ protocol: PROTOCOL, type: 'close', gen: this.gen, sid, status, reason, feedbackMs: this.spec?.feedbackMs ?? 650 });
    this.onResult({
      sessionId: sid, status, reason,
      score: report?.score ?? null, grade: report?.grade ?? null, durationMs: report?.durationMs ?? 0,
      mistakes: report?.mistakes ?? 0, metrics: report?.metrics ?? {},
    });
  }

  private async handle(name: CallbackName, body: Record<string, unknown>): Promise<Reply> {
    if (name === 'boot') return { ok: true, data: { gen: this.gen, prefs: this.prefs } };
    if (body.gen !== this.gen || body.sid !== this.sid || !this.sid) return { ok: false, error: 'stale_session' };
    switch (name) {
      case 'ready':
        if (this.faults.dropReady) return new Promise(() => {}); // never resolves: exercises the startup timeout
        if (body.ok !== true) {
          this.finish('rejected', String(body.reason ?? 'invalid_params'));
          return { ok: true };
        }
        queueMicrotask(() => this.deliver({ protocol: PROTOCOL, type: 'start', gen: this.gen, sid: this.sid }));
        this.arm(PRACTICE_IDLE_MS, () => this.finish('cancelled', 'practice_idle'));
        return { ok: true };
      case 'began':
        this.stallGranted = 0;
        this.deadlineAt = performance.now() + (this.spec?.timeoutMs ?? 10000) + HARD_GRACE_MS;
        this.arm(this.deadlineAt - performance.now(), () => this.finish('timeout', 'hard_deadline'));
        return { ok: true };
      case 'stall': {
        // Cumulative paused ms: the wall-clock deadline grows by the increase, capped per run.
        const granted = Math.min(Number(body.stalledMs) || 0, this.spec?.timeoutMs ?? 10000, MAX_STALL_EXTENSION_MS);
        if (granted > this.stallGranted) {
          this.deadlineAt += granted - this.stallGranted;
          this.stallGranted = granted;
          this.arm(this.deadlineAt - performance.now(), () => this.finish('timeout', 'hard_deadline'));
        }
        return { ok: true };
      }
      case 'fault':
        this.finish('error', 'ui_error');
        return { ok: true };
      case 'cancel':
        this.finish('cancelled', 'player_cancelled');
        return { ok: true };
      case 'complete':
        if (this.faults.rejectComplete) {
          this.finish('error', 'invalid_report');
          return { ok: false, error: 'invalid_report' };
        }
        this.finish(String(body.status), String(body.reason), body as Partial<MockResult>);
        return { ok: true };
      default:
        return { ok: false, error: 'unknown_callback' };
    }
  }

  elapsed(): number {
    return this.sid ? performance.now() - this.started : 0;
  }
}
