import { expect, test } from 'bun:test';
import { prepare, TIMEOUT_BOUNDS } from '../src/core/prepare';

test('derived Mash budgets preserve the unreachable-params cause and explicit timeout validation', () => {
  // Negative and zero net fill both produce a derived budget beyond the protocol ceiling.
  for (const params of [{ gain: 0.02, decay: 1, maxRate: 6 }, { gain: 0.05, decay: 0.3, maxRate: 6 }]) {
    const spec = { game: 'mash', params };
    const contradiction = { ok: false, error: { reason: 'invalid_params', field: 'params', message: 'mash_rate_unreachable' } } as const;
    expect(prepare(spec)).toEqual(contradiction);
    expect(prepare({ ...spec, timeoutMs: TIMEOUT_BOUNDS.max })).toEqual(contradiction);
    for (const timeoutMs of [TIMEOUT_BOUNDS.min - 1, TIMEOUT_BOUNDS.max + 1, 1000.5, NaN, Infinity]) {
      expect(prepare({ ...spec, timeoutMs })).toEqual({
        ok: false,
        error: { reason: 'invalid_options', field: 'timeoutMs', message: 'timeoutMs must be 1000..180000' },
      });
    }
  }

  // Valid params with an oversized derived budget remain bounded; callers can supply a valid budget.
  const longQte = {
    game: 'qte',
    params: { prompts: Array.from({ length: 8 }, () => ({ type: 'press', actions: ['primary'], windowMs: 6000 })), mistakes: 3, leadMs: 1500 },
  };
  expect(prepare(longQte)).toMatchObject({ ok: false, error: { reason: 'invalid_options', field: 'timeoutMs' } });
  expect(prepare({ ...longQte, timeoutMs: TIMEOUT_BOUNDS.max })).toMatchObject({ ok: true, value: { timeoutMs: TIMEOUT_BOUNDS.max } });
});
