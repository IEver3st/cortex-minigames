import { describe, expect, test } from 'bun:test';
import { buildKeymap, DEFAULT_KEYS, glyph, isBindableCode, REBINDABLE, RESERVED_CODES, resolveBindings } from '../src/core/input';
import { ACTIONS, type Action } from '../src/core/types';

const letters = Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`);
const digits = Array.from({ length: 10 }, (_, i) => `Digit${i}`);
const numpad = Array.from({ length: 10 }, (_, i) => `Numpad${i}`);
const fkeys = Array.from({ length: 12 }, (_, i) => `F${i + 1}`);
const named = [
  'Space', 'Tab', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'Minus', 'Equal',
  'BracketLeft', 'BracketRight', 'Semicolon', 'Quote', 'Backquote', 'Backslash', 'Comma', 'Period', 'Slash', 'CapsLock',
];
const VALID = [...letters, ...digits, ...numpad, ...fkeys, ...named];

/** Every action has at least one key and no code is claimed twice. */
function expectSound(overrides: Partial<Record<Action, string>>): void {
  const bindings = resolveBindings(overrides);
  const seen = new Map<string, Action>();
  for (const action of ACTIONS) {
    expect(bindings[action].length).toBeGreaterThan(0);
    for (const code of bindings[action]) {
      if (seen.has(code)) throw new Error(`${code} bound to ${seen.get(code)} and ${action} for ${JSON.stringify(overrides)}`);
      seen.set(code, action);
    }
  }
  const map = buildKeymap(overrides);
  expect(new Set(map.values()).size).toBe(ACTIONS.length);
  for (const action of ACTIONS) expect(glyph('keyboard', map, action)).not.toBe('?');
}

describe('key rebinding', () => {
  test('the valid code list matches the validator and excludes reserved codes', () => {
    for (const code of VALID) expect(isBindableCode(code)).toBe(true);
    for (const code of ['E', 'keyE', 'F0', 'F13', 'Numpad10', 'MetaLeft', 'Enter', 'Escape', 'ArrowUp', '', 'Key']) expect(isBindableCode(code)).toBe(false);
    for (const code of VALID) expect(RESERVED_CODES.has(code)).toBe(false);
  });

  test('every single-key override from the valid set leaves every action bound, once', () => {
    let checked = 0;
    for (const action of REBINDABLE) {
      for (const code of VALID) {
        expectSound({ [action]: code });
        expect(buildKeymap({ [action]: code }).get(code)).toBe(action);
        checked++;
      }
    }
    expect(checked).toBe(REBINDABLE.length * VALID.length);
  });

  test('pairs of overrides stay sound, including two actions asking for the same key', () => {
    const sample = ['KeyW', 'KeyE', 'KeyQ', 'KeyF', 'KeyR', 'Space', 'KeyG', 'Digit1'];
    for (const a of REBINDABLE) for (const b of REBINDABLE) for (const ca of sample) for (const cb of sample) {
      if (a !== b) expectSound({ [a]: ca, [b]: cb });
    }
  });

  test('a collision swaps: the displaced action takes the rebinding action\'s previous key', () => {
    const map = buildKeymap({ primary: 'KeyE' });
    expect(map.get('KeyE')).toBe('primary');
    expect(map.get('Space')).toBe('next');
    expect(glyph('keyboard', map, 'next')).toBe('Space'); // was '?' before the swap rule
    expect(map.get('Enter')).toBe('primary');
    const dirs = buildKeymap({ up: 'KeyS' });
    expect(dirs.get('KeyS')).toBe('up');
    expect(dirs.get('KeyW')).toBe('down');
    expect(dirs.get('ArrowDown')).toBe('down');
  });

  test('reserved and malformed codes are ignored, cancel cannot be rebound', () => {
    for (const code of RESERVED_CODES) {
      for (const action of REBINDABLE) expect(resolveBindings({ [action]: code })).toEqual(DEFAULT_KEYS);
    }
    expect(resolveBindings({ primary: 'E', alt: '<script>', cancel: 'KeyX' })).toEqual(DEFAULT_KEYS);
    const map = buildKeymap({ cancel: 'KeyX' });
    expect(map.get('Escape')).toBe('cancel');
    expect(map.get('Backspace')).toBe('cancel');
    expect(map.get('KeyX')).toBeUndefined();
    for (const [code, action] of [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right']] as const) {
      expect(buildKeymap({ [action]: 'KeyI' }).get(code)).toBe(action);
    }
  });

  test('glyphs exist for every bindable code', () => {
    for (const code of VALID) {
      const label = glyph('keyboard', buildKeymap({ alt: code }), 'alt');
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe('?');
    }
    expect(glyph('keyboard', buildKeymap({ alt: 'Numpad7' }), 'alt')).toBe('Num7');
    expect(glyph('keyboard', buildKeymap({ alt: 'Backslash' }), 'alt')).toBe('\\');
  });
});
