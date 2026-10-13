// Keyboard → abstract actions, plus the glyphs shown in hints. The browser is the input authority
// for keyboard and mouse; the controller arrives from Lua as already-abstract action edges.

import type { Action, Device } from './types';

type Binding = Record<Action, string[]>;

export const DEFAULT_KEYS: Binding = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  primary: ['Space', 'Enter'],
  alt: ['KeyF'],
  prev: ['KeyQ'],
  next: ['KeyE'],
  rotate: ['KeyR'],
  cancel: ['Escape', 'Backspace'],
};

/** Actions a player may rebind. Arrows, Enter and Escape always stay as fallbacks. */
export const REBINDABLE: Action[] = ['up', 'down', 'left', 'right', 'primary', 'alt', 'prev', 'next', 'rotate'];

/** Fallback codes no rebinding may take: cancel keeps Escape and Backspace, directions keep the arrows. */
export const RESERVED_CODES: ReadonlySet<string> = new Set(['Escape', 'Backspace', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** KeyboardEvent.code values a player may bind. client/prefs.lua enforces the same list. */
export const BINDABLE_CODE = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-2])|Space|Tab|(Shift|Control|Alt)(Left|Right)|Minus|Equal|BracketLeft|BracketRight|Semicolon|Quote|Backquote|Backslash|Comma|Period|Slash|CapsLock)$/;

export const isBindableCode = (code: unknown): code is string => typeof code === 'string' && BINDABLE_CODE.test(code);

/**
 * Apply rebindings to the defaults. A rebinding takes its key; an action already on that key swaps
 * onto the rebinding action's previous key, so every action keeps one key and no key does two jobs.
 */
export function resolveBindings(overrides: Partial<Record<Action, string>> = {}): Binding {
  const bindings: Binding = structuredClone(DEFAULT_KEYS);
  for (const action of REBINDABLE) {
    const code = overrides[action];
    if (!isBindableCode(code) || RESERVED_CODES.has(code) || bindings[action][0] === code) continue;
    const holder = REBINDABLE.find((other) => bindings[other][0] === code);
    if (holder) bindings[holder][0] = bindings[action][0];
    bindings[action][0] = code;
  }
  return bindings;
}

export function buildKeymap(overrides: Partial<Record<Action, string>> = {}): Map<string, Action> {
  const map = new Map<string, Action>();
  // Each action's first code is its hint glyph, so insertion order matters for primaryCode().
  const bindings = resolveBindings(overrides);
  for (const action of Object.keys(bindings) as Action[]) {
    for (const code of bindings[action]) if (!map.has(code)) map.set(code, action);
  }
  return map;
}

export function primaryCode(map: Map<string, Action>, action: Action): string | undefined {
  for (const [code, bound] of map) if (bound === action) return code;
  return undefined;
}

const KEY_LABELS: Record<string, string> = {
  Space: 'Space', Enter: 'Enter', Escape: 'Esc', Backspace: 'Bksp',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
  Tab: 'Tab', CapsLock: 'Caps', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';',
  Quote: "'", Backquote: '`', Backslash: '\\',Comma: ',', Period: '.', Slash: '/',
};

export function keyLabel(code: string | undefined): string {
  if (!code) return '?';
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num${code.slice(6)}`;
  return code.slice(0, 5);
}

/** Controller glyphs follow the Lua pad mapping in client/input.lua. */
export const PAD_LABELS: Record<Action, string> = {
  up: '▲', down: '▼', left: '◀', right: '▶', primary: 'A', alt: 'X', prev: 'LB', next: 'RB', rotate: 'Y', cancel: 'B',
};

export function glyph(device: Device, map: Map<string, Action>, action: Action): string {
  if (device === 'pad') return PAD_LABELS[action];
  return keyLabel(primaryCode(map, action));
}

/** Direction groups read better as one hint than four keycaps. */
export function groupLabel(device: Device, map: Map<string, Action>, actions: Action[]): string[] {
  const dirs: Action[] = ['up', 'right', 'down', 'left'];
  if (actions.length === 4 && dirs.every((d) => actions.includes(d))) {
    if (device === 'pad') return ['D-Pad'];
    const letters = dirs.map((d) => keyLabel(primaryCode(map, d))).join('');
    return [letters === 'WDSA' ? 'WASD' : letters];
  }
  return actions.map((action) => glyph(device, map, action));
}
