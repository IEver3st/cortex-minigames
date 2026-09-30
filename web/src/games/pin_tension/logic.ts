// Pin & Tension: find the binding pin, lift it to its sweet spot and set it while holding tension
// inside the working window. Rules the player can learn:
//   1. Only the binding pin resists; the others feel loose. Pins bind in a fixed per-lock order.
//   2. Set pins stay set while tension stays at or above the window's floor.
//   3. Slack tension for SLACK_MS drops the most recently set pin.
//   4. Tension above the window stresses the tool; a full stress meter breaks it (a reason only;
//      the caller decides whether any inventory item is consumed).

import { clamp, defineGame } from '../../core/game';
import { toScore } from '../../core/result';

export type PinParams = {
  pins: number;
  liftTolerance: number;
  tensionWindow: number;
  stressRate: number;
  recovery: number;
  setMistakes: number;
  tensionSpeed: number;
  liftSpeed: number;
};

export type Pin = { sweet: number; lift: number; set: boolean };

export type PinState = {
  p: PinParams;
  pins: Pin[];
  order: number[];
  bound: number; // count of pins set, i.e. index into order of the binding pin
  selected: number;
  tension: number;
  lo: number;
  hi: number;
  stress: number;
  maxStress: number;
  slackFor: number;
  drops: number;
  mistakes: number;
  broken: boolean;
  exhausted: boolean;
  lastEvent: null | { kind: 'set' | 'miss' | 'drop'; pin: number; at: number };
  wheel: number;
};

export const SLACK_MS = 450;

export type Feel = 'slack' | 'loose' | 'binding' | 'stiff' | 'set';

/** What the selected pin feels like right now. The resistance value is the visual sweet-spot cue. */
export function feel(s: PinState, index = s.selected): { feel: Feel; resistance: number } {
  const pin = s.pins[index];
  if (pin.set) return { feel: 'set', resistance: 0 };
  if (s.tension < s.lo) return { feel: 'slack', resistance: 0 };
  if (s.tension > s.hi) return { feel: 'stiff', resistance: 1 };
  if (s.order[s.bound] !== index) return { feel: 'loose', resistance: 0.08 };
  const distance = Math.abs(pin.lift - pin.sweet);
  return { feel: 'binding', resistance: clamp(1 - distance / (s.p.liftTolerance * 3)) };
}

export const pinTension = defineGame<PinParams, PinState>({
  id: 'pin_tension',
  version: 1,
  name: 'Pin & Tension',
  inputs: ['keyboard', 'mouse', 'controller'],
  presentation: 'focused',
  params: {
    pins: { type: 'int', min: 3, max: 6 },
    liftTolerance: { type: 'number', min: 0.04, max: 0.25 },
    tensionWindow: { type: 'number', min: 0.1, max: 0.4 },
    stressRate: { type: 'number', min: 0.2, max: 2 },
    recovery: { type: 'number', min: 0.05, max: 0.6 },
    setMistakes: { type: 'int', min: 0, max: 6 },
    tensionSpeed: { type: 'number', min: 0.2, max: 0.9 },
    liftSpeed: { type: 'number', min: 0.3, max: 1.2 },
  },
  presets: {
    easy: { pins: 3, liftTolerance: 0.12, tensionWindow: 0.32, stressRate: 0.5, recovery: 0.3, setMistakes: 4, tensionSpeed: 0.5, liftSpeed: 0.6 },
    normal: { pins: 4, liftTolerance: 0.09, tensionWindow: 0.26, stressRate: 0.7, recovery: 0.22, setMistakes: 3, tensionSpeed: 0.5, liftSpeed: 0.6 },
    hard: { pins: 5, liftTolerance: 0.07, tensionWindow: 0.2, stressRate: 0.9, recovery: 0.16, setMistakes: 2, tensionSpeed: 0.45, liftSpeed: 0.55 },
    expert: { pins: 6, liftTolerance: 0.055, tensionWindow: 0.16, stressRate: 1.1, recovery: 0.12, setMistakes: 1, tensionSpeed: 0.4, liftSpeed: 0.5 },
  },
  metrics: { pins: 'number', pinsSet: 'number', drops: 'number', maxStress: 'number' },
  hints: [
    { actions: ['left', 'right'], label: 'Pin' },
    { actions: ['up', 'down'], label: 'Lift' },
    { actions: ['prev', 'next'], label: 'Tension' },
    { actions: ['primary'], label: 'Set' },
  ],
  tutorial: 'Hold tension in the band, find the pin that resists, lift it to peak resistance and set it. Slack tension drops pins.',
  minDurationMs: 1500,
  defaultTimeoutMs: (p) => Math.round(6000 + p.pins * 4500),
  check(p, timeoutMs) {
    if (p.liftSpeed * 0.035 > p.liftTolerance * 1.2) return 'tolerance_below_precision';
    if (p.tensionSpeed * 0.035 > p.tensionWindow * 0.5) return 'tolerance_below_precision';
    if (timeoutMs < p.pins * 1500) return 'time_budget_too_short';
    return null;
  },
  create(p, rng) {
    const pins: Pin[] = [];
    for (let i = 0; i < p.pins; i++) pins.push({ sweet: rng.range(0.25 + p.liftTolerance, 0.9 - p.liftTolerance), lift: 0, set: false });
    const order = rng.shuffle([...Array(p.pins).keys()]);
    const lo = rng.range(0.28, 0.62 - p.tensionWindow / 2);
    return {
      p, pins, order, bound: 0, selected: 0, tension: 0, lo, hi: lo + p.tensionWindow, stress: 0, maxStress: 0,
      slackFor: 0, drops: 0, mistakes: 0, broken: false, exhausted: false, lastEvent: null, wheel: 0,
    };
  },
  step(s, dt, t, input) {
    const seconds = dt / 1000;
    const held = input.held;
    const tensionDir = (held.has('next') ? 1 : 0) - (held.has('prev') ? 1 : 0);
    s.tension = clamp(s.tension + tensionDir * s.p.tensionSpeed * seconds);
    const pin = s.pins[s.selected];
    if (!pin.set) {
      let lift = (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0);
      if (lift === 0) lift = -input.axes.ly;
      pin.lift = clamp(pin.lift + lift * s.p.liftSpeed * seconds + s.wheel);
    }
    s.wheel = 0;

    if (s.tension > s.hi) {
      s.stress += s.p.stressRate * seconds * (1 + (s.tension - s.hi) * 4);
    } else {
      s.stress = Math.max(0, s.stress - s.p.recovery * seconds);
    }
    s.maxStress = Math.max(s.maxStress, Math.min(1, s.stress));
    if (s.stress >= 1) s.broken = true;

    if (s.tension < s.lo && s.bound > 0) {
      s.slackFor += dt;
      if (s.slackFor >= SLACK_MS) {
        s.bound--;
        const dropped = s.order[s.bound];
        s.pins[dropped].set = false;
        s.pins[dropped].lift = 0;
        s.drops++;
        s.slackFor = 0;
        s.lastEvent = { kind: 'drop', pin: dropped, at: t };
      }
    } else {
      s.slackFor = 0;
    }
  },
  press(s, action, t) {
    if (action === 'left') s.selected = (s.selected + s.pins.length - 1) % s.pins.length;
    else if (action === 'right') s.selected = (s.selected + 1) % s.pins.length;
    else if (action === 'primary') attemptSet(s, t);
  },
  pointer(s, event, t) {
    if (event.kind === 'select' && event.index >= 0 && event.index < s.pins.length) s.selected = event.index;
    else if (event.kind === 'select' && event.index === -1) attemptSet(s, t);
    else if (event.kind === 'wheel') s.wheel += event.dir * 0.02;
    else if (event.kind === 'set' && event.control === 0) s.tension = clamp(event.value);
  },
  outcome(s) {
    if (s.broken) return { status: 'failed', reason: 'tool_broke' };
    if (s.exhausted) return { status: 'failed', reason: 'mistakes_exhausted' };
    if (s.bound >= s.pins.length) return { status: 'success', reason: 'completed' };
    return null;
  },
  report(s) {
    const completion = s.bound / s.pins.length;
    const mistakeFactor = 1 - s.mistakes / (s.p.setMistakes + 1);
    return {
      score: toScore(completion * (0.5 * mistakeFactor + 0.3 * (1 - s.maxStress) + 0.2 * (1 - s.drops / s.pins.length))),
      mistakes: s.mistakes,
      perfect: s.drops === 0,
      metrics: { pins: s.pins.length, pinsSet: s.bound, drops: s.drops, maxStress: s.maxStress },
    };
  },
});

function attemptSet(s: PinState, t: number): void {
  const pin = s.pins[s.selected];
  if (pin.set) return;
  const binding = s.order[s.bound] === s.selected;
  const inWindow = s.tension >= s.lo && s.tension <= s.hi;
  if (binding && inWindow && Math.abs(pin.lift - pin.sweet) <= s.p.liftTolerance) {
    pin.set = true;
    pin.lift = pin.sweet;
    s.bound++;
    // Selection stays put: finding the next binding pin is the skill.
    s.lastEvent = { kind: 'set', pin: s.selected, at: t };
    return;
  }
  s.mistakes++;
  s.stress += 0.15;
  s.lastEvent = { kind: 'miss', pin: s.selected, at: t };
  if (s.mistakes > s.p.setMistakes) s.exhausted = true;
}
