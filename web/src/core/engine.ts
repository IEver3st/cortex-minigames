// Fixed-timestep driver. Simulation never depends on display FPS: frames only decide how many
// fixed steps to run, and inputs are applied at their own event timestamps, not at frame time.

import type { GameDef } from './game';
import { createRng } from './rng';
import type { Params } from './schema';
import type { Action, InputState, Outcome, PointerEvt, Report } from './types';

export const STEP_MS = 1000 / 120;
/** A stall longer than this pauses the simulation instead of fast-forwarding through it. */
export const MAX_CATCHUP_MS = 250;

type QueuedEvent =
  | { at: number; kind: 'press' | 'release'; action: Action }
  | { at: number; kind: 'pointer'; event: PointerEvt }
  | { at: number; kind: 'axes'; axes: InputState['axes'] };

export class Engine<S = unknown> {
  readonly state: S;
  readonly input: InputState = { held: new Set(), axes: { lx: 0, ly: 0, rt: 0 } };
  /** Simulation clock in ms since play began. */
  simT = 0;
  /** Total ms skipped because of render stalls; reported as a diagnostic, never charged to the player. */
  stalledMs = 0;
  private origin = 0;
  private started = false;
  private queue: QueuedEvent[] = [];
  private finished: Outcome | null = null;

  constructor(
    readonly def: GameDef<Params, S>,
    readonly params: Params,
    readonly seed: number,
    readonly timeoutMs: number,
  ) {
    this.state = def.create(params, createRng(seed), timeoutMs);
  }

  /** `now` is a performance.now()-compatible timestamp for the moment play begins. */
  start(now: number): void {
    this.origin = now;
    this.started = true;
  }

  get running(): boolean {
    return this.started && !this.finished;
  }

  get outcome(): Outcome | null {
    return this.finished;
  }

  /** Presentation clock: exact elapsed ms at `now`, for drawing between fixed steps. */
  elapsed(now: number): number {
    if (!this.started) return 0;
    if (this.finished) return this.simT;
    return Math.min(Math.max(this.simT, now - this.origin), this.simT + MAX_CATCHUP_MS, this.timeoutMs);
  }

  press(action: Action, at: number): void {
    this.enqueue({ at, kind: 'press', action });
  }

  release(action: Action, at: number): void {
    this.enqueue({ at, kind: 'release', action });
  }

  pointer(event: PointerEvt, at: number): void {
    this.enqueue({ at, kind: 'pointer', event });
  }

  axes(axes: InputState['axes'], at: number): void {
    this.enqueue({ at, kind: 'axes', axes });
  }

  /** Drop every held action, e.g. after window blur, so nothing stays stuck down. */
  releaseAll(at: number): void {
    for (const action of [...this.input.held]) this.release(action, at);
    this.enqueue({ at, kind: 'axes', axes: { lx: 0, ly: 0, rt: 0 } });
  }

  private enqueue(event: QueuedEvent): void {
    if (!this.running) return;
    // Events arrive in timestamp order from one source, but pad and keyboard can interleave.
    let index = this.queue.length;
    while (index > 0 && this.queue[index - 1].at > event.at) index--;
    this.queue.splice(index, 0, event);
  }

  private apply(event: QueuedEvent, t: number): void {
    const { def, state, input } = this;
    if (event.kind === 'press') {
      if (input.held.has(event.action)) return; // a second press without release is autorepeat
      input.held.add(event.action);
      def.press?.(state, event.action, t, input);
    } else if (event.kind === 'release') {
      if (!input.held.delete(event.action)) return;
      def.release?.(state, event.action, t, input);
    } else if (event.kind === 'pointer') {
      def.pointer?.(state, event.event, t, input);
    } else if (event.kind === 'axes') {
      input.axes = event.axes;
    }
  }

  /** Advance to wall-clock `now`. Returns the terminal outcome once one exists. */
  advance(now: number): Outcome | null {
    if (!this.running) return this.finished;
    let target = now - this.origin;
    if (target - this.simT > MAX_CATCHUP_MS) {
      const skipped = target - this.simT - MAX_CATCHUP_MS;
      this.origin += skipped;
      this.stalledMs += skipped;
      target -= skipped;
      for (const event of this.queue) event.at = Math.max(event.at - skipped, this.origin + this.simT);
    }
    const { def, state, input } = this;
    for (;;) {
      // The last step is cut short at the deadline, so nothing a step produces can land after it.
      const stepEnd = Math.min(this.simT + STEP_MS, this.timeoutMs);
      if (stepEnd > target || stepEnd <= this.simT) break;
      if (this.drain(stepEnd)) return this.finished;
      const dt = stepEnd - this.simT;
      this.simT = stepEnd;
      def.step?.(state, dt, this.simT, input);
      if (this.settle()) return this.finished;
    }
    // Inputs that happened after the last whole step are judged now, at their own timestamps.
    if (this.drain(target)) return this.finished;
    return null;
  }

  private drain(until: number): boolean {
    while (this.queue.length && this.queue[0].at - this.origin <= until) {
      const event = this.queue.shift()!;
      const t = Math.max(event.at - this.origin, this.simT);
      if (t >= this.timeoutMs) {
        // Input after the deadline never counts, even if no frame has run since the deadline passed.
        this.finished = { status: 'timeout', reason: 'time_expired' };
        this.simT = this.timeoutMs;
        this.queue.length = 0;
        return true;
      }
      this.apply(event, t);
      if (this.settle(t)) return true;
    }
    return false;
  }

  private settle(t = this.simT): boolean {
    const outcome = this.def.outcome(this.state, t);
    if (outcome && Math.max(this.simT, t) <= this.timeoutMs) {
      this.finished = outcome;
      this.simT = Math.max(this.simT, t);
      this.queue.length = 0;
      return true;
    }
    if (this.simT >= this.timeoutMs) {
      this.finished = { status: 'timeout', reason: 'time_expired' };
      this.queue.length = 0;
      return true;
    }
    return false;
  }

  report(): Report {
    return this.def.report(this.state, this.finished, Math.min(this.simT, this.timeoutMs), this.timeoutMs);
  }
}
