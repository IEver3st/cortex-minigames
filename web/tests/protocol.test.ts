import { describe, expect, test } from 'bun:test';
import { parseMessage, parsePrefs, parseStrings } from '../src/core/protocol';
import { buildKeymap, glyph, groupLabel } from '../src/core/input';
import { cleanMetrics } from '../src/core/result';

const spec = {
  game: 'timing', preset: 'normal', params: {}, seed: 3, minTimeoutMs: 1000, maxTimeoutMs: 180000,
  title: 'T', instruction: '', presentation: { mode: 'compact', anchor: 'bottom', scale: 1 }, practice: false,
  feedbackMs: 500, audio: { volume: 1, muted: false }, reducedMotion: false, step: null,
};

describe('protocol', () => {
  test('rejects wrong protocol, missing generation and unknown types', () => {
    expect(parseMessage({ protocol: 2, type: 'reset', gen: 1 })).toBeNull();
    expect(parseMessage({ protocol: 1, type: 'reset' })).toBeNull();
    expect(parseMessage({ protocol: 1, type: 'explode', gen: 1 })).toBeNull();
    expect(parseMessage('nope')).toBeNull();
  });
  test('open requires a session id and a well-formed spec; timeout may be omitted', () => {
    expect(parseMessage({ protocol: 1, type: 'open', gen: 1, spec })).toBeNull();
    const parsed = parseMessage({ protocol: 1, type: 'open', gen: 1, sid: 's1', spec });
    expect(parsed?.type).toBe('open');
    if (parsed?.type === 'open') expect(parsed.spec.timeoutMs).toBeUndefined();
    expect(parseMessage({ protocol: 1, type: 'open', gen: 1, sid: 's1', spec: { ...spec, timeoutMs: 'x' } })).toBeNull();
  });
  test('text is truncated, presentation and audio are bounded', () => {
    const parsed = parseMessage({
      protocol: 1, type: 'open', gen: 1, sid: 's1',
      spec: { ...spec, title: 'x'.repeat(500), presentation: { mode: 'weird', scale: 9 }, audio: { volume: 7 }, feedbackMs: 99999 },
    });
    if (parsed?.type !== 'open') throw new Error('expected open');
    expect(parsed.spec.title.length).toBe(64);
    expect(parsed.spec.presentation.mode).toBe('focused');
    expect(parsed.spec.presentation.scale).toBe(1.5);
    expect(parsed.spec.audio.volume).toBe(1);
    expect(parsed.spec.feedbackMs).toBe(2000);
  });
  test('pad input only carries known actions', () => {
    expect(parseMessage({ protocol: 1, type: 'input', gen: 1, sid: 's', kind: 'press', action: 'primary' })).not.toBeNull();
    expect(parseMessage({ protocol: 1, type: 'input', gen: 1, sid: 's', kind: 'press', action: 'eval' })).toBeNull();
    const axes = parseMessage({ protocol: 1, type: 'axes', gen: 1, sid: 's', lx: 5, ly: -5, rt: -1 });
    expect(axes).toEqual({ type: 'axes', gen: 1, sid: 's', lx: 1, ly: -1, rt: 0 });
  });
  test('prefs and locale strings are sanitised', () => {
    const prefs = parsePrefs({ volume: 3, scale: 0.1, motion: 'wild', keys: { primary: 'KeyG', cancel: 'KeyX', alt: '<script>' } });
    expect(prefs).toEqual({ volume: 1, muted: false, motion: 'auto', scale: 0.75, keys: { primary: 'KeyG' } });
    const strings = parseStrings({ ok: 'Fine', long: 'x'.repeat(200), n: 5 });
    expect(strings).toEqual({ ok: 'Fine' });
  });
});

describe('input', () => {
  test('rebinding replaces the letter binding; arrows stay; collisions are dropped', () => {
    const map = buildKeymap({ primary: 'KeyG', next: 'KeyQ' });
    expect(map.get('KeyG')).toBe('primary');
    expect(map.get('Enter')).toBe('primary');
    expect(map.get('ArrowUp')).toBe('up');
    expect(map.get('KeyQ')).toBe('prev'); // 'next' tried to steal Q; earlier binding wins
    expect(glyph('keyboard', map, 'primary')).toBe('G');
    expect(glyph('pad', map, 'primary')).toBe('A');
    expect(groupLabel('keyboard', buildKeymap(), ['up', 'down', 'left', 'right'])).toEqual(['WASD']);
    expect(groupLabel('pad', buildKeymap(), ['up', 'down', 'left', 'right'])).toEqual(['D-Pad']);
  });
  test('metrics are allowlisted and bounded', () => {
    expect(cleanMetrics({ a: 'number', b: 'boolean' }, { a: 1.23456, b: true, c: 3, d: NaN } as never)).toEqual({ a: 1.235, b: true });
  });
});
