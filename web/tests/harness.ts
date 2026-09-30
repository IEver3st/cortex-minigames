import { Engine } from '../src/core/engine';
import { prepare, type PlaySpec } from '../src/core/prepare';
import type { Action, Outcome, PointerEvt } from '../src/core/types';

export type Scripted =
  | { at: number; press: Action }
  | { at: number; release: Action }
  | { at: number; pointer: PointerEvt }
  | { at: number; axes: { lx: number; ly: number; rt: number } };

export function engineFor(spec: PlaySpec): Engine<any> {
  const prepared = prepare(spec);
  if (!prepared.ok) throw new Error(`prepare failed: ${JSON.stringify(prepared.error)}`);
  const { def, params, seed, timeoutMs } = prepared.value;
  return new Engine(def, params, seed, timeoutMs);
}

/** Frame times at a nominal FPS with deterministic jitter, from 0 to `until`. */
export function frames(fps: number, until: number, jitter = 0.25): number[] {
  const out: number[] = [];
  let t = 0, k = 1;
  while (t < until) {
    k = (k * 16807) % 2147483647;
    const wobble = ((k / 2147483647) - 0.5) * 2 * jitter;
    t += (1000 / fps) * (1 + wobble);
    out.push(t);
  }
  return out;
}

/** Replay a time-based input script against rendered frames; events are delivered on the frame after they happen. */
export function runScript(engine: Engine<any>, script: Scripted[], fps: number, until = engine.timeoutMs + 500): Outcome | null {
  engine.start(0);
  const pending = [...script].sort((a, b) => a.at - b.at);
  for (const frame of frames(fps, until)) {
    while (pending.length && pending[0].at <= frame) {
      const event = pending.shift()!;
      if ('press' in event) engine.press(event.press, event.at);
      else if ('release' in event) engine.release(event.release, event.at);
      else if ('pointer' in event) engine.pointer(event.pointer, event.at);
      else engine.axes(event.axes, event.at);
    }
    const outcome = engine.advance(frame);
    if (outcome) return outcome;
  }
  return engine.outcome;
}

/** Drive a game with a state-reading policy at a fixed frame rate. The policy returns actions to hold this frame. */
export function runPolicy<S>(
  engine: Engine<S>,
  policy: (state: S, t: number, engine: Engine<S>) => Action[] | { hold?: Action[]; tap?: Action[]; pointer?: PointerEvt[] },
  fps = 60,
  until = engine.timeoutMs + 500,
): Outcome | null {
  engine.start(0);
  const held = new Set<Action>();
  for (const frame of frames(fps, until, 0)) {
    const decision = policy(engine.state, engine.simT, engine);
    const plan = Array.isArray(decision) ? { hold: decision } : decision;
    const want = new Set(plan.hold ?? []);
    for (const action of [...held]) if (!want.has(action)) { engine.release(action, frame - 0.5); held.delete(action); }
    for (const action of want) if (!held.has(action)) { engine.press(action, frame - 0.5); held.add(action); }
    for (const action of plan.tap ?? []) {
      engine.press(action, frame - 0.5);
      engine.release(action, frame - 0.25);
    }
    for (const pointer of plan.pointer ?? []) engine.pointer(pointer, frame - 0.5);
    const outcome = engine.advance(frame);
    if (outcome) return outcome;
  }
  return engine.outcome;
}
