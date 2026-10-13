// Session runtime against a fake NUI host: virtual clock, timers and frames, a scripted Lua on the
// other end of fetch(), and an AudioContext whose resume()/suspend() settle late like Chromium's.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

const g = globalThis as any;
const real = {
  setTimeout: g.setTimeout, clearTimeout: g.clearTimeout, fetch: g.fetch, now: performance.now,
  window: g.window, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame, AudioContext: g.AudioContext,
  GetParentResourceName: g.GetParentResourceName, error: console.error, warn: console.warn,
};
const realSleep = (ms: number) => new Promise((resolve) => real.setTimeout(resolve, ms));

// --- virtual clock, timers and frames --------------------------------------------------------------
let clock = 10_000;
let seq = 0;
const timers = new Map<number, { at: number; fn: () => void }>();
const frames = new Map<number, (t: number) => void>();
const FRAME_MS = 16;
let frameDue = 0;
let framesRun = 0;

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** Run virtual time forward, firing timers and animation frames in order. */
async function advance(ms: number): Promise<void> {
  const end = clock + ms;
  for (;;) {
    await flush();
    let next = end;
    for (const timer of timers.values()) next = Math.min(next, timer.at);
    if (frames.size) next = Math.min(next, frameDue);
    clock = Math.max(clock, next);
    let fired = false;
    for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > clock || !timers.has(id)) continue;
      timers.delete(id);
      timer.fn();
      fired = true;
    }
    if (frames.size && clock >= frameDue) {
      const due = [...frames.values()];
      frames.clear();
      frameDue = clock + FRAME_MS;
      framesRun++;
      for (const fn of due) fn(clock);
      fired = true;
    }
    if (clock >= end && !fired) break;
  }
  await flush();
}

/** A render stall: wall time jumps with no frame in between, then one frame runs. */
async function stall(ms: number): Promise<void> {
  clock += ms;
  frameDue = clock;
  await advance(0);
}

// --- fake audio ----------------------------------------------------------------------------------
let oscillators = 0;
let lastPeak = 0;
class FakeParam {
  value = 0;
  setValueAtTime() {}
  linearRampToValueAtTime(value: number) { lastPeak = value; }
  exponentialRampToValueAtTime() {}
}
class FakeNode { connect(node: unknown) { return node; } disconnect() {} }
class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  state: 'running' | 'suspended' | 'closed' = 'running';
  currentTime = 0;
  destination = new FakeNode();
  constructor() { FakeAudioContext.last = this; }
  createOscillator() {
    oscillators++;
    const osc: any = new FakeNode();
    osc.frequency = new FakeParam();
    osc.start = () => {};
    osc.stop = () => {};
    return osc;
  }
  createGain() { const node: any = new FakeNode(); node.gain = new FakeParam(); return node; }
  // Chromium flips `state` only when the promise settles, which is what made the old suspend miss.
  resume() { return new Promise<void>((resolve) => real.setTimeout(() => { this.state = 'running'; resolve(); }, 30)); }
  suspend() { return new Promise<void>((resolve) => real.setTimeout(() => { this.state = 'suspended'; resolve(); }, 30)); }
}

// --- scripted Lua --------------------------------------------------------------------------------
const GEN = 77;
type Post = { name: string; body: any; at: number };
const posts: Post[] = [];
let handler: (name: string, body: any) => any = () => ({ ok: true });
const sent = (name: string) => posts.filter((post) => post.name === name);
const lua = (message: Record<string, unknown>) => session.receive({ protocol: 1, gen: GEN, ...message });

/** Default Lua: acknowledge everything and answer an ok `ready` with `start`. */
const standardLua = (name: string, body: any) => {
  if (name === 'ready' && body.ok) queueMicrotask(() => lua({ type: 'start', sid: body.sid }));
  return { ok: true };
};

const spec = (extra: Record<string, unknown> = {}) => ({
  game: 'mash', preset: 'normal', params: {}, seed: 5, timeoutMs: 20000, minTimeoutMs: 1000, maxTimeoutMs: 180000,
  title: '', instruction: '', presentation: { mode: 'compact', anchor: 'bottom', scale: 1 }, practice: false, feedbackMs: 650,
  audio: { volume: 1, muted: false }, reducedMotion: false, step: null, ...extra,
});

let session: typeof import('../src/session.svelte').session;
let CUE_MS = 0;
let BOOT_RETRY_MS: readonly number[] = [];
let CLOSE_GRACE_MS = 0;
let FAULT_MESSAGE_MAX = 0;
let audio: typeof import('../src/core/audio');
let registry: typeof import('../src/games/registry');

async function open(sid: string, extra: Record<string, unknown> = {}): Promise<void> {
  lua({ type: 'open', sid, spec: spec(extra) });
  await advance(0);
}

async function openAndPlay(sid: string, extra: Record<string, unknown> = {}): Promise<void> {
  await open(sid, extra);
  expect(session.phase).toBe('cue');
  await advance(CUE_MS + 1);
  expect(session.phase).toBe('playing');
}

/** Make the running engine finish with `outcome` on its next frame. */
function finishWith(outcome: { status: string; reason: string }): void {
  const engine = session.engine as any;
  engine.advance = () => { engine.finished = outcome; return outcome; };
}

async function settleIdle(): Promise<void> {
  await advance(5000);
  expect(session.phase).toBe('idle');
  handler = standardLua;
  posts.length = 0;
}

beforeAll(async () => {
  g.window = g;
  g.setTimeout = (fn: () => void, ms = 0) => { const id = ++seq; timers.set(id, { at: clock + Math.max(0, ms), fn }); return id; };
  g.clearTimeout = (id: number) => { timers.delete(id); };
  g.requestAnimationFrame = (fn: (t: number) => void) => { if (!frames.size) frameDue = clock + FRAME_MS; const id = ++seq; frames.set(id, fn); return id; };
  g.cancelAnimationFrame = (id: number) => { frames.delete(id); };
  Object.defineProperty(performance, 'now', { value: () => clock, configurable: true, writable: true });
  g.AudioContext = FakeAudioContext;
  g.GetParentResourceName = () => 'cortex-minigames';
  g.fetch = async (url: string, init: { body: string }) => {
    const name = url.split('/').pop()!;
    const body = JSON.parse(init.body);
    posts.push({ name, body, at: clock });
    const reply = await handler(name, body);
    if (reply === 'throw') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(reply), { status: 200 });
  };
  console.error = () => {};
  console.warn = () => {};
  ({ session, CUE_MS, BOOT_RETRY_MS, CLOSE_GRACE_MS, FAULT_MESSAGE_MAX } = await import('../src/session.svelte'));
  audio = await import('../src/core/audio');
  registry = await import('../src/games/registry');
});

afterAll(() => {
  session.teardown();
  session.stopBoot();
  Object.assign(g, {
    setTimeout: real.setTimeout, clearTimeout: real.clearTimeout, fetch: real.fetch, requestAnimationFrame: real.raf,
    cancelAnimationFrame: real.caf, AudioContext: real.AudioContext, GetParentResourceName: real.GetParentResourceName,
  });
  if (real.window === undefined) delete g.window;
  Object.defineProperty(performance, 'now', { value: real.now, configurable: true, writable: true });
  console.error = real.error;
  console.warn = real.warn;
});

describe('session runtime', () => {
  // Must run first: once booted, the session never boots again.
  test('boot retries with backoff until Lua answers, then stops', async () => {
    let failures = 4;
    handler = (name, body) => {
      if (name === 'boot') return failures-- > 0 ? 'throw' : { ok: true, data: { gen: GEN, prefs: {}, strings: [] } };
      return standardLua(name, body);
    };
    const started = clock;
    void session.boot();
    await advance(0);
    lua({ type: 'open', sid: 'early', spec: spec() });
    await advance(0);
    expect(sent('ready')).toHaveLength(0); // gen unknown: everything is stale until boot succeeds
    await advance(BOOT_RETRY_MS.reduce((a, b) => a + b, 0) + 1000);
    const boots = sent('boot').map((post) => post.at - started);
    expect(boots).toEqual([0, 500, 1500, 3500, 8500]);
    expect(session.gen).toBe(GEN);
    await advance(30000);
    expect(sent('boot')).toHaveLength(5);
    expect(timers.size).toBe(0);
    await open('after-boot');
    expect(sent('ready')).toEqual([expect.objectContaining({ body: expect.objectContaining({ sid: 'after-boot', ok: true, gen: GEN }) })]);
    session.teardown();
    await settleIdle();
  });

  test('an exception in the frame loop stops it, shows the error and posts fault', async () => {
    await openAndPlay('f-1');
    const sid = 'f-1';
    (session.engine as any).advance = () => { throw new Error(`boom\n    at stack line ${'x'.repeat(300)}`); };
    await advance(FRAME_MS * 3);
    const faults = sent('fault');
    expect(faults).toHaveLength(1);
    expect(faults[0].body.sid).toBe(sid);
    expect(typeof faults[0].body.message).toBe('string');
    expect(faults[0].body.message.length).toBeLessThanOrEqual(FAULT_MESSAGE_MAX);
    expect(faults[0].body.message).toStartWith('Error: boom');
    expect(faults[0].body.message).not.toContain('\n');
    expect(session.phase).toBe('feedback');
    expect(session.feedback).toMatchObject({ status: 'error', reason: 'ui_error' });
    expect(frames.size).toBe(0);
    expect(sent('complete')).toHaveLength(0);
    lua({ type: 'close', sid, status: 'error', reason: 'ui_error', feedbackMs: 650 });
    await advance(651);
    expect(session.phase).toBe('idle');
    await settleIdle();
  });

  test('an exception while preparing posts fault and shows the error state', async () => {
    const def = registry.getGame('mash')!;
    const check = def.check;
    def.check = () => { throw new RangeError('bad budget'); };
    try {
      await open('f-2');
    } finally {
      def.check = check;
    }
    expect(sent('ready')).toHaveLength(0);
    expect(sent('fault')).toEqual([expect.objectContaining({ body: expect.objectContaining({ sid: 'f-2', message: 'RangeError: bad budget' }) })]);
    expect(session.phase).toBe('feedback');
    expect(session.feedback).toMatchObject({ status: 'error', reason: 'ui_error' });
    await settleIdle();
  });

  test('Lua\'s close replaces a different verdict on the banner', async () => {
    await openAndPlay('v-1');
    finishWith({ status: 'success', reason: 'completed' });
    await advance(FRAME_MS);
    expect(session.feedback).toMatchObject({ status: 'success', reason: 'completed' });
    lua({ type: 'close', sid: 'v-1', status: 'timeout', reason: 'hard_deadline', feedbackMs: 800 });
    expect(session.feedback).toEqual({ status: 'timeout', reason: 'hard_deadline', grade: null, score: null });
    await advance(799);
    expect(session.phase).toBe('feedback'); // Lua's verdict gets its own full display time
    await advance(2);
    expect(session.phase).toBe('idle');
    await settleIdle();
  });

  test('a matching close leaves the UI banner (grade and score) alone', async () => {
    await openAndPlay('v-2');
    finishWith({ status: 'success', reason: 'completed' });
    await advance(FRAME_MS);
    const shown = session.feedback;
    lua({ type: 'close', sid: 'v-2', status: 'success', reason: 'completed', feedbackMs: 650 });
    expect(session.feedback).toBe(shown);
    await settleIdle();
  });

  test('a rejected complete shows Lua\'s outcome from the reply', async () => {
    handler = (name, body) => (name === 'complete' ? { ok: false, error: 'invalid_report' } : standardLua(name, body));
    await openAndPlay('v-3');
    finishWith({ status: 'success', reason: 'completed' });
    await advance(FRAME_MS);
    expect(sent('complete')).toHaveLength(1);
    expect(session.feedback).toEqual({ status: 'error', reason: 'invalid_report', grade: null, score: null });
    await settleIdle();
  });

  test('a stale complete waits for Lua\'s close to show the verdict', async () => {
    handler = (name, body) => (name === 'complete' ? { ok: false, error: 'stale' } : standardLua(name, body));
    await openAndPlay('v-4');
    finishWith({ status: 'success', reason: 'completed' });
    await advance(FRAME_MS);
    expect(session.feedback).toMatchObject({ status: 'success' });
    lua({ type: 'close', sid: 'v-4', status: 'cancelled', reason: 'player_died', feedbackMs: 650 });
    expect(session.feedback).toMatchObject({ status: 'cancelled', reason: 'player_died' });
    await settleIdle();
  });

  test('stalls post the cumulative paused ms, once per stall, never while idle', async () => {
    await openAndPlay('st-1');
    await advance(FRAME_MS * 10);
    expect(sent('stall')).toHaveLength(0);
    await stall(1000);
    const first = sent('stall');
    expect(first).toHaveLength(1);
    expect(first[0].body.sid).toBe('st-1');
    expect(Number.isInteger(first[0].body.stalledMs)).toBe(true);
    expect(first[0].body.stalledMs).toBe(Math.round(session.engine!.stalledMs));
    expect(first[0].body.stalledMs).toBeGreaterThan(700);
    await advance(FRAME_MS * 10);
    expect(sent('stall')).toHaveLength(1);
    await stall(600);
    const second = sent('stall');
    expect(second).toHaveLength(2);
    expect(second[1].body.stalledMs).toBeGreaterThan(first[0].body.stalledMs + 300);
    // At most one per frame.
    const perFrame = new Map<number, number>();
    for (const post of second) perFrame.set(post.at, (perFrame.get(post.at) ?? 0) + 1);
    for (const count of perFrame.values()) expect(count).toBe(1);
    finishWith({ status: 'failed', reason: 'missed' });
    await advance(FRAME_MS);
    expect(sent('complete')[0].body.stalledMs).toBe(second[1].body.stalledMs);
    await settleIdle();
    await stall(2000);
    expect(sent('stall')).toHaveLength(0);
  });

  test('a prefs push mid-session never lifts the caller\'s audio cap', async () => {
    await open('a-1', { audio: { volume: 1, muted: true } });
    oscillators = 0;
    audio.play('tick');
    expect(oscillators).toBe(0);
    lua({ type: 'prefs', prefs: { volume: 1, muted: false } });
    audio.play('tick');
    expect(oscillators).toBe(0);
    session.teardown();
    await settleIdle();

    await open('a-2', { audio: { volume: 0.2, muted: false } });
    lua({ type: 'prefs', prefs: { volume: 1, muted: false } });
    audio.play('tick');
    const capped = lastPeak;
    lua({ type: 'prefs', prefs: { volume: 0.1, muted: false } });
    audio.play('tick');
    expect(lastPeak).toBeCloseTo(capped / 2, 9); // player prefs lower it further: min(0.2, 0.1)
    lua({ type: 'prefs', prefs: { volume: 1, muted: true } });
    oscillators = 0;
    audio.play('tick');
    expect(oscillators).toBe(0);
    lua({ type: 'prefs', prefs: { volume: 0.5, muted: false } });
    session.teardown();
    await settleIdle();
  });

  test('audio context ends suspended when silenced while a resume is pending', async () => {
    audio.play('tick');
    await realSleep(80);
    const context = FakeAudioContext.last!;
    audio.silence();
    await realSleep(80);
    expect(context.state).toBe('suspended');
    audio.play('tick'); // resume in flight ...
    audio.silence(); // ... and the session ends before it lands
    await realSleep(150);
    expect(context.state).toBe('suspended');
  });

  for (const feedbackMs of [0, 5]) {
    test(`idle audio context is suspended after a Lua close with feedbackMs ${feedbackMs}`, async () => {
      const context = FakeAudioContext.last!;
      expect(context.state).toBe('suspended');
      handler = (name, body) => (name === 'ready' ? { ok: true } : standardLua(name, body)); // no start: Lua closes first
      await open(`au-${feedbackMs}`);
      lua({ type: 'close', sid: `au-${feedbackMs}`, status: 'cancelled', reason: 'player_cancelled', feedbackMs });
      await advance(feedbackMs + 1);
      expect(session.phase).toBe('idle');
      await realSleep(150);
      expect(context.state).toBe('suspended');
      await settleIdle();
    });
  }

  test('a rejected ready keeps Lua\'s close feedback on screen for its feedbackMs', async () => {
    handler = (name, body) => {
      if (name !== 'ready') return standardLua(name, body);
      lua({ type: 'close', sid: body.sid, status: 'rejected', reason: 'focus_unavailable', feedbackMs: 650 });
      return { ok: false, error: 'focus_unavailable' };
    };
    await open('r-1');
    expect(session.phase).toBe('feedback');
    expect(session.feedback).toMatchObject({ status: 'rejected', reason: 'focus_unavailable' });
    await advance(640);
    expect(session.phase).toBe('feedback');
    await advance(20);
    expect(session.phase).toBe('idle');
    await settleIdle();
  });

  test('a rejected ready that beats Lua\'s close still shows the close', async () => {
    handler = (name, body) => {
      if (name !== 'ready') return standardLua(name, body);
      window.setTimeout(() => lua({ type: 'close', sid: body.sid, status: 'error', reason: 'invalid_report', feedbackMs: 650 }), CLOSE_GRACE_MS / 2);
      return { ok: false, error: 'invalid_timeout' };
    };
    await open('r-2');
    await advance(CLOSE_GRACE_MS / 2 + 1);
    expect(session.phase).toBe('feedback');
    expect(session.feedback).toMatchObject({ status: 'error', reason: 'invalid_report' });
    await settleIdle();
  });

  test('a stale ready reply, or no close at all, tears down', async () => {
    handler = (name, body) => (name === 'ready' ? { ok: false, error: 'stale' } : standardLua(name, body));
    await open('r-3');
    expect(session.phase).toBe('idle');
    handler = (name, body) => (name === 'ready' ? { ok: false, error: 'focus_unavailable' } : standardLua(name, body));
    await open('r-4');
    await advance(CLOSE_GRACE_MS + 1);
    expect(session.phase).toBe('idle');
    await settleIdle();
  });

  test('a timeout of exactly 180000 ms is accepted', async () => {
    await open('t-1', { timeoutMs: 180000 });
    expect(sent('ready')[0].body).toMatchObject({ sid: 't-1', ok: true, timeoutMs: 180000 });
    session.teardown();
    await settleIdle();
  });

  test('repeated open/close cycles leave no timer, frame or listener behind', async () => {
    for (let i = 0; i < 25; i++) {
      await open(`c-${i}`, { feedbackMs: i % 3 === 0 ? 0 : 40 });
      if (i % 2) await advance(CUE_MS + 1);
      lua({ type: 'close', sid: `c-${i}`, status: 'cancelled', reason: 'player_cancelled', feedbackMs: i % 3 === 0 ? 0 : 40 });
      await advance(50);
      expect(session.phase).toBe('idle');
    }
    expect(timers.size).toBe(0);
    expect(frames.size).toBe(0);
    expect((session as any).listening).toBe(false);
  });
});
