// UI half of the session lifecycle. Lua owns the session, focus and the terminal decision for
// cancels and deadlines; the UI owns preparation, the ready cue, local simulation and reporting.
// Every listener, frame loop and timer created here is torn down in `teardown()`.

import { configureAudio, play, silence } from './core/audio';
import { call } from './core/bridge';
import { Engine } from './core/engine';
import { buildKeymap } from './core/input';
import { prepare } from './core/prepare';
import { DEFAULT_PREFS, parseMessage, type InboundMessage, type OpenSpec, type Prefs } from './core/protocol';
import { cleanMetrics, gradeFor } from './core/result';
import { setStrings } from './shell/labels';
import type { Action, Device, PointerEvt, Status } from './core/types';

export type Phase = 'idle' | 'preparing' | 'waiting' | 'practice' | 'cue' | 'playing' | 'feedback';
export const CUE_MS = 650;

export interface Feedback {
  status: Status;
  reason: string;
  grade: string | null;
  score: number | null;
}

export interface View {
  s: any;
  t: number;
  n: number;
}

class Session {
  phase = $state<Phase>('idle');
  spec = $state.raw<OpenSpec | null>(null);
  sid = $state<string | null>(null);
  device = $state<Device>('keyboard');
  view = $state.raw<View>({ s: null, t: 0, n: 0 });
  feedback = $state.raw<Feedback | null>(null);
  prefs = $state.raw<Prefs>(DEFAULT_PREFS);
  keymap = $state.raw(buildKeymap());
  mistakes = $state(0);
  flash = $state(0); // increments on each mistake; the shell uses it for a brief visual cue
  gen = 0;
  engine: Engine<any> | null = null;

  private frame = 0;
  private timers = new Set<number>();
  private practiceArmed = false;
  private practiced = false;
  private reported = false;
  private listening = false;

  // --- inbound -------------------------------------------------------------------------------

  receive = (data: unknown): void => {
    const message = parseMessage(data);
    if (!message) return;
    if (message.type === 'boot') {
      if (this.sid && message.gen !== this.gen) this.teardown();
      this.gen = message.gen;
      setStrings(message.strings);
      this.applyPrefs(message.prefs);
      return;
    }
    // Messages from an older resource generation are stale by definition.
    if (message.gen !== this.gen) return;
    this.dispatch(message);
  };

  private dispatch(message: InboundMessage): void {
    switch (message.type) {
      case 'prefs':
        this.applyPrefs(message.prefs);
        break;
      case 'reset':
        this.teardown();
        break;
      case 'open':
        void this.open(message.sid, message.spec);
        break;
      case 'start':
        if (message.sid === this.sid && this.phase === 'waiting') this.begin();
        break;
      case 'input':
        if (message.sid !== this.sid) return;
        this.device = 'pad';
        if (message.kind === 'press') this.onAction(message.action, performance.now());
        else this.onRelease(message.action, performance.now());
        break;
      case 'axes':
        if (message.sid !== this.sid || !this.engine) return;
        this.device = 'pad';
        this.engine.axes({ lx: message.lx, ly: message.ly, rt: message.rt }, performance.now());
        break;
      case 'close':
        if (message.sid !== this.sid) return;
        this.finishLocal(message.status as Status, message.reason, message.feedbackMs);
        break;
    }
  }

  applyPrefs(prefs: Prefs): void {
    this.prefs = prefs;
    this.keymap = buildKeymap(prefs.keys);
    configureAudio(prefs);
  }

  async boot(): Promise<void> {
    const reply = await call('boot', 0);
    if (reply.ok && reply.data) this.receive({ protocol: 1, type: 'boot', gen: reply.data.gen, prefs: reply.data.prefs, strings: reply.data.strings });
  }

  // --- lifecycle -----------------------------------------------------------------------------

  private async open(sid: string, spec: OpenSpec): Promise<void> {
    if (this.sid) this.teardown();
    // Without a caller timeout, use the game default within the operator's bounds.
    let timeoutMs = spec.timeoutMs;
    if (timeoutMs === undefined) {
      const probe = prepare({ ...spec, timeoutMs: undefined });
      const base = probe.ok ? probe.value.timeoutMs : spec.maxTimeoutMs;
      timeoutMs = Math.min(spec.maxTimeoutMs, Math.max(spec.minTimeoutMs, base));
    }
    const prepared = prepare({ ...spec, timeoutMs });
    if (!prepared.ok) {
      await call('ready', this.gen, { sid, ok: false, reason: prepared.error.reason, field: prepared.error.field ?? '', message: prepared.error.message });
      return;
    }
    let engine: Engine<any>;
    try {
      engine = new Engine(prepared.value.def, prepared.value.params, prepared.value.seed, prepared.value.timeoutMs);
    } catch {
      await call('ready', this.gen, { sid, ok: false, reason: 'generation_failed', field: '', message: 'challenge generation failed' });
      return;
    }
    this.sid = sid;
    this.spec = { ...spec, timeoutMs };
    this.engine = engine;
    this.phase = 'preparing';
    this.reported = false;
    this.mistakes = 0;
    this.feedback = null;
    this.practiced = false;
    configureAudio({ volume: Math.min(spec.audio.volume, this.prefs.volume), muted: spec.audio.muted || this.prefs.muted });
    this.view = { s: engine.state, t: 0, n: 0 };
    // Waiting before the reply resolves: Lua may send `start` before fetch() hands back the ack.
    this.phase = 'waiting';
    const reply = await call('ready', this.gen, { sid, ok: true, timeoutMs });
    if (this.sid === sid && !reply.ok) this.teardown();
  }

  private begin(): void {
    this.listen();
    if (this.spec?.practice) {
      this.phase = 'practice';
      this.practiceArmed = false;
    } else this.cue();
  }

  private cue(): void {
    this.phase = 'cue';
    play('ready');
    const sid = this.sid;
    this.later(() => {
      if (this.sid !== sid || this.phase !== 'cue' || !this.engine) return;
      // Held keys from the practice card or cue never leak into play.
      this.engine.start(performance.now());
      this.phase = 'playing';
      void call('began', this.gen, { sid, practiced: this.practiced });
      this.loop();
    }, CUE_MS);
  }

  private loop = (): void => {
    const engine = this.engine;
    if (!engine || this.phase !== 'playing') return;
    const now = performance.now();
    const outcome = engine.advance(now);
    this.view = { s: engine.state, t: engine.elapsed(now), n: this.view.n + 1 };
    const report = engine.report();
    if (report.mistakes > this.mistakes) { this.flash++; play('miss'); }
    this.mistakes = report.mistakes;
    if (outcome) {
      void this.report();
      return;
    }
    this.frame = requestAnimationFrame(this.loop);
  };

  private async report(): Promise<void> {
    const engine = this.engine, sid = this.sid, spec = this.spec;
    if (!engine || !sid || !spec || this.reported || !engine.outcome) return;
    this.reported = true;
    const outcome = engine.outcome;
    const report = engine.report();
    const result = {
      sid,
      status: outcome.status,
      reason: outcome.reason,
      score: report.score,
      grade: gradeFor(outcome.status, report),
      mistakes: report.mistakes,
      durationMs: Math.round(engine.simT),
      stalledMs: Math.round(engine.stalledMs),
      metrics: cleanMetrics(engine.def.metrics, report.metrics),
    };
    play(outcome.status === 'success' ? 'success' : 'fail');
    this.showFeedback(result, spec.feedbackMs);
    const reply = await call('complete', this.gen, result);
    // If Lua rejected or lost the report, it resolves the session itself (deadline or error path).
    if (!reply.ok) console.warn('[cortex-minigames] completion not accepted:', reply.error);
  }

  private showFeedback(feedback: Feedback, ms: number): void {
    cancelAnimationFrame(this.frame);
    this.unlisten();
    this.feedback = feedback;
    this.phase = 'feedback';
    const sid = this.sid;
    this.later(() => { if (this.sid === sid) this.teardown(); }, ms);
  }

  /** Lua decided the terminal outcome (cancel, deadline, error). Stop immediately, show it briefly. */
  private finishLocal(status: Status, reason: string, feedbackMs: number): void {
    if (this.phase === 'feedback') return;
    this.reported = true;
    this.engine?.releaseAll(performance.now());
    silence();
    play(status === 'success' ? 'success' : 'fail');
    this.showFeedback({ status, reason, grade: null, score: null }, feedbackMs);
  }

  teardown(): void {
    cancelAnimationFrame(this.frame);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.unlisten();
    silence();
    this.engine = null;
    this.sid = null;
    this.spec = null;
    this.feedback = null;
    this.phase = 'idle';
    this.view = { s: null, t: 0, n: 0 };
  }

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
  }

  // --- input ---------------------------------------------------------------------------------

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
  }

  private unlisten(): void {
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    this.engine?.releaseAll(performance.now());
  }

  private stamp(event: Event): number {
    const now = performance.now();
    const at = event.timeStamp;
    return Number.isFinite(at) && at <= now + 5 && at >= now - 1000 ? at : now;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const action = this.keymap.get(event.code);
    if (!action) return;
    event.preventDefault();
    if (event.repeat) return; // autorepeat never counts as a press
    this.device = 'keyboard';
    this.onAction(action, this.stamp(event));
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    const action = this.keymap.get(event.code);
    if (!action) return;
    event.preventDefault();
    this.onRelease(action, this.stamp(event));
  };

  /** Releases from any device. The practice card is acknowledged on release, never on press. */
  private onRelease(action: Action, at: number): void {
    if (this.phase === 'practice' && action === 'primary' && this.practiceArmed) {
      this.practiced = true;
      this.cue();
      return;
    }
    this.engine?.release(action, at);
  }

  private onBlur = (): void => {
    // Focus loss drops every held action so nothing stays stuck; the attempt itself continues.
    this.engine?.releaseAll(performance.now());
  };

  private onAction(action: Action, at: number): void {
    if (action === 'cancel') { this.requestCancel(); return; }
    if (this.phase === 'practice') {
      if (action === 'primary') this.practiceArmed = true; // acknowledged on release, so it cannot leak into play
      return;
    }
    if (this.phase === 'playing') this.engine?.press(action, at);
  }

  requestCancel(): void {
    if (!this.sid || this.phase === 'feedback' || this.phase === 'idle') return;
    void call('cancel', this.gen, { sid: this.sid });
  }

  /** Mouse helpers for views. A tap is a press and release at the same instant. */
  tap(action: Action, event?: Event): void {
    if (this.phase === 'practice' && action === 'primary') { this.practiced = true; this.cue(); return; }
    if (this.phase !== 'playing' || !this.engine) return;
    const at = event ? this.stamp(event) : performance.now();
    this.device = 'mouse';
    this.engine.press(action, at);
    this.engine.release(action, at + 0.01);
  }

  hold(action: Action, down: boolean, event?: Event): void {
    if (this.phase !== 'playing' || !this.engine) return;
    this.device = 'mouse';
    const at = event ? this.stamp(event) : performance.now();
    if (down) this.engine.press(action, at);
    else this.engine.release(action, at);
  }

  pointer(evt: PointerEvt, event?: Event): void {
    if (this.phase !== 'playing' || !this.engine) return;
    this.device = 'mouse';
    this.engine.pointer(evt, event ? this.stamp(event) : performance.now());
  }
}

export const session = new Session();
