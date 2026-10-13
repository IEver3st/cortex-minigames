// Short synthesised cues: no audio files, nothing fetched. Every cue has a visual equivalent in
// the shell, so muting never hides information. One context, suspended whenever no game runs.

export type Cue = 'tick' | 'hit' | 'miss' | 'lock' | 'success' | 'fail' | 'ready';

const CUES: Record<Cue, { freq: number[]; ms: number; type: OscillatorType; gain: number }> = {
  tick: { freq: [880], ms: 40, type: 'square', gain: 0.18 },
  ready: { freq: [660], ms: 70, type: 'sine', gain: 0.35 },
  hit: { freq: [990, 1320], ms: 70, type: 'triangle', gain: 0.4 },
  lock: { freq: [740, 988], ms: 110, type: 'triangle', gain: 0.4 },
  miss: { freq: [220, 180], ms: 140, type: 'sawtooth', gain: 0.22 },
  success: { freq: [660, 880, 1175], ms: 90, type: 'triangle', gain: 0.4 },
  fail: { freq: [311, 233], ms: 160, type: 'sawtooth', gain: 0.22 },
};

let context: AudioContext | null = null;
let volume = 0.5;
let muted = false;
const live = new Set<OscillatorNode>();
/** The state the context should settle in. resume() and suspend() are async and must not overlap. */
let wanted: 'running' | 'suspended' = 'suspended';
let switching = false;

/** Move the context toward `wanted`, one transition at a time. A resume still in flight when the
 *  session ends is followed by a suspend once it settles, so an idle UI never keeps audio running. */
function sync(): void {
  const ctx = context;
  if (!ctx || switching || ctx.state === 'closed' || ctx.state === wanted) return;
  const target = wanted;
  switching = true;
  let op: Promise<void>;
  try {
    op = target === 'running' ? ctx.resume() : ctx.suspend();
  } catch {
    switching = false;
    return;
  }
  void op.catch(() => {}).then(() => {
    switching = false;
    if (wanted !== target) sync();
  });
}

export function configureAudio(next: { volume: number; muted: boolean }): void {
  volume = Math.min(1, Math.max(0, next.volume));
  muted = next.muted;
}

export function play(cue: Cue): void {
  if (muted || volume <= 0 || typeof AudioContext === 'undefined') return;
  try {
    context ??= new AudioContext();
    wanted = 'running';
    sync();
    const spec = CUES[cue];
    let at = context.currentTime;
    for (const freq of spec.freq) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = spec.type;
      osc.frequency.value = freq;
      // Short attack/release envelope so cues never click; overall level stays modest.
      const peak = spec.gain * volume * 0.5;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(peak, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + spec.ms / 1000);
      osc.connect(gain).connect(context.destination);
      osc.start(at);
      osc.stop(at + spec.ms / 1000 + 0.02);
      live.add(osc);
      osc.onended = () => { live.delete(osc); osc.disconnect(); gain.disconnect(); };
      at += spec.ms / 1000 * 0.8;
    }
  } catch {
    // Audio is supplementary; a CEF audio failure must never affect play.
  }
}

/** Stop owned sounds and suspend the context: nothing audible or scheduled survives a session. */
export function silence(): void {
  for (const osc of live) {
    try { osc.stop(); } catch { /* already stopped */ }
  }
  live.clear();
  wanted = 'suspended';
  sync();
}
