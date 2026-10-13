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
import { REASONS, type Action, type Device, type PointerEvt, type Status } from './core/types';

export type Phase = 'idle' | 'preparing' | 'waiting' | 'practice' | 'cue' | 'playing' | 'feedback';
export const CUE_MS = 650;
/** Delays between `boot` attempts until Lua answers; the last one repeats. */
export const BOOT_RETRY_MS = [500, 1000, 2000, 5000] as const;
/** How long a rejected `ready` waits for Lua's close, which may arrive after the reply. */
export const CLOSE_GRACE_MS = 250;
/** Fault messages are a short diagnostic for the Lua log, never a stack. */
export const FAULT_MESSAGE_MAX = 120;

const describe = (error: unknown): string => {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.replace(/\s+/g, ' ').trim().slice(0, FAULT_MESSAGE_MAX) || 'unknown';
};

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
  private feedbackTimer = 0;
  private booted = false;
  private booting = false;
  private bootAttempts = 0;
  private bootTimer = 0;
  /** Cumulative paused ms last reported through `stall` for the current run. */
  private stallSent = 0;
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
      this.booted = true;
      this.stopBoot();
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
    configureAudio(this.audio());
  }

  /** Player prefs capped by the caller: muted if either side mutes, the quieter volume wins. */
  private audio(): { volume: number; muted: boolean } {
    const caller = this.spec?.audio;
    if (!caller) return { volume: this.prefs.volume, muted: this.prefs.muted };
    return { volume: Math.min(caller.volume, this.prefs.volume), muted: caller.muted || this.prefs.muted };
  }

  /** Ask Lua for the generation, retrying with backoff: without it every message is dropped as stale. */
  async boot(): Promise<void> {
    if (this.booted || this.booting) return;
    this.stopBoot();
    this.booting = true;
    const reply = await call('boot', 0);
    this.booting = false;
    if (reply.ok && reply.data) this.receive({ protocol: 1, type: 'boot', gen: reply.data.gen, prefs: reply.data.prefs, strings: reply.data.strings });
    if (this.booted) return;
    const delay = BOOT_RETRY_MS[Math.min(this.bootAttempts++, BOOT_RETRY_MS.length - 1)];
    this.bootTimer = window.setTimeout(() => { this.bootTimer = 0; void this.boot(); }, delay);
  }

  stopBoot(): void {
    if (this.bootTimer) window.clearTimeout(this.bootTimer);
    this.bootTimer = 0;
  }

  // --- lifecycle -----------------------------------------------------------------------------

  private async open(sid: string, spec: OpenSpec): Promise<void> {
    if (this.sid) this.teardown();
    // Without a caller timeout, use the game default within the operator's bounds.
    let timeoutMs = spec.timeoutMs;
    let prepared: ReturnType<typeof prepare>;
    try {
      if (timeoutMs === undefined) {
        const probe = prepare({ ...spec, timeoutMs: undefined });
        const base = probe.ok ? probe.value.timeoutMs : spec.maxTimeoutMs;
        timeoutMs = Math.min(spec.maxTimeoutMs, Math.max(spec.minTimeoutMs, base));
      }
      prepared = prepare({ ...spec, timeoutMs });
    } catch (error) {
      // A game bug, not a bad config: show the error state and let Lua end the run.
      this.sid = sid;
      this.spec = { ...spec, timeoutMs };
      this.fault(sid, error);
      return;
    }
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
    this.stallSent = 0;
    configureAudio(this.audio());
    this.view = { s: engine.state, t: 0, n: 0 };
    // Waiting before the reply resolves: Lua may send `start` before fetch() hands back the ack.
    this.phase = 'waiting';
    const reply = await call('ready', this.gen, { sid, ok: true, timeoutMs });
    // Rejected while Lua's close is showing: keep it for its feedbackMs, the feedback timer tears down.
    if (reply.ok || this.sid !== sid || (this.phase as Phase) === 'feedback') return;
    if (reply.error === 'stale') { this.teardown(); return; }
    // Lua sends close before it replies, but NUI messages and replies can arrive in either order.
    this.later(() => { if (this.sid === sid && this.phase !== 'feedback') this.teardown(); }, CLOSE_GRACE_MS);
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
    const engine = this.engine, sid = this.sid;
    if (!engine || !sid || this.phase !== 'playing') return;
    let outcome;
    try {
      const now = performance.now();
      outcome = engine.advance(now);
      this.view = { s: engine.state, t: engine.elapsed(now), n: this.view.n + 1 };
      const report = engine.report();
      if (report.mistakes > this.mistakes) { this.flash++; play('miss'); }
      this.mistakes = report.mistakes;
    } catch (error) {
      this.fault(sid, error);
      return;
    }
    if (outcome) {
      void this.report(); // `complete` carries stalledMs
      return;
    }
    // Lua's deadline is wall-clock: report the cumulative paused time whenever a stall added to it.
    const stalled = Math.round(engine.stalledMs);
    if (stalled > this.stallSent) {
      this.stallSent = stalled;
      void call('stall', this.gen, { sid, stalledMs: stalled });
    }
    this.frame = requestAnimationFrame(this.loop);
  };

  private async report(): Promise<void> {
    const engine = this.engine, sid = this.sid, spec = this.spec;
    if (!engine || !sid || !spec || this.reported || !engine.outcome) return;
    this.reported = true;
    const outcome = engine.outcome;
    let result: Feedback & Record<string, unknown>;
    try {
      const report = engine.report();
      result = {
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
    } catch (error) {
      this.fault(sid, error);
      return;
    }
    play(outcome.status === 'success' ? 'success' : 'fail');
    this.showFeedback(result, spec.feedbackMs);
    const reply = await call('complete', this.gen, result);
    if (reply.ok || this.sid !== sid) return;
    // Lua rejected the report and resolved the run itself. A named error reason is its verdict;
    // otherwise (stale, transport) Lua's own close carries the verdict.
    if ((REASONS.error as readonly string[]).includes(reply.error)) this.adoptVerdict('error', reply.error, spec.feedbackMs);
    else console.warn('[cortex-minigames] completion not accepted:', reply.error);
  }

  private showFeedback(feedback: Feedback, ms: number): void {
    cancelAnimationFrame(this.frame);
    this.unlisten();
    this.feedback = feedback;
    this.phase = 'feedback';
    const sid = this.sid;
    this.clearTimer(this.feedbackTimer);
    this.feedbackTimer = this.later(() => { if (this.sid === sid) this.teardown(); }, ms);
  }

  /** Lua's verdict replaces the banner when they differ, and gets its own full display time. */
  private adoptVerdict(status: Status, reason: string, ms: number): void {
    const shown = this.feedback;
    if (shown && shown.status === status && shown.reason === reason) return;
    if (shown?.status === 'success' && status !== 'success') play('fail');
    this.showFeedback({ status, reason, grade: null, score: null }, ms);
  }

  /** A game threw. Stop simulating, show the error state and let Lua end the run (error/ui_error). */
  private fault(sid: string, error: unknown): void {
    console.error('[cortex-minigames] game fault:', error);
    void call('fault', this.gen, { sid, message: describe(error) });
    if (this.sid !== sid || this.phase === 'feedback') return;
    this.reported = true;
    cancelAnimationFrame(this.frame);
    silence();
    play('fail');
    this.showFeedback({ status: 'error', reason: 'ui_error', grade: null, score: null }, this.spec?.feedbackMs ?? 0);
  }

  /** Lua decided the terminal outcome (cancel, deadline, error). Stop immediately, show it briefly.
   *  If the banner is already up, Lua's verdict still wins: it is the result the caller receives. */
  private finishLocal(status: Status, reason: string, feedbackMs: number): void {
    if (this.phase === 'feedback') { this.adoptVerdict(status, reason, feedbackMs); return; }
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

  private later(fn: () => void, ms: number): number {
    const id = window.setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
    return id;
  }

  private clearTimer(id: number): void {
    if (this.timers.delete(id)) clearTimeout(id);
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
