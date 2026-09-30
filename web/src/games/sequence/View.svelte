<script lang="ts">
  import Keycap from '../../shell/Keycap.svelte';
  import { session } from '../../session.svelte';
  import type { Action } from '../../core/types';
  import { SYMBOLS, litAt, phase, type SequenceState } from './logic';

  // Arrow paths on a 24-unit grid; LB/RB use bracket shapes. Shape + key label, never colour alone.
  const ICON: Record<string, string> = {
    up: 'M12 4 L20 14 L15 14 L15 20 L9 20 L9 14 L4 14 Z',
    down: 'M12 20 L20 10 L15 10 L15 4 L9 4 L9 10 L4 10 Z',
    left: 'M4 12 L14 4 L14 9 L20 9 L20 15 L14 15 L14 20 Z',
    right: 'M20 12 L10 4 L10 9 L4 9 L4 15 L10 15 L10 20 Z',
    prev: 'M16 4 L8 12 L16 20 L16 15 L12 12 L16 9 Z',
    next: 'M8 4 L16 12 L8 20 L8 15 L12 12 L8 9 Z',
  };

  const m = $derived.by(() => {
    const s = session.view.s as SequenceState | null;
    if (!s) return null;
    const t = session.view.t;
    const current = phase(s, t);
    const flash = current === 'preview' ? litAt(s, t) : null;
    const fb = s.feedback && t - s.feedback.at < 260 ? s.feedback : null;
    return {
      phase: current,
      symbols: SYMBOLS[s.p.symbols],
      lit: flash && !flash.decoy ? flash.symbol : null,
      decoy: flash && flash.decoy ? flash.symbol : null,
      fb,
      slots: s.seq.map((symbol, i) => (i < s.index ? symbol : null)),
    };
  });

  const label = { preview: 'Watch', ready: 'Your turn', input: 'Repeat', done: '' } as const;
</script>

{#if m}
  <div class="sequence">
    <div class="pads">
      {#each m.symbols as symbol (symbol)}
        <button
          type="button"
          class="pad"
          class:lit={m.lit === symbol}
          class:decoy={m.decoy === symbol}
          class:ok={m.fb?.symbol === symbol && m.fb.ok}
          class:bad={m.fb?.symbol === symbol && !m.fb.ok}
          onclick={(e) => session.tap(symbol as Action, e)}
          aria-label={symbol}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICON[symbol]} /></svg>
          <Keycap action={symbol as Action} />
          {#if m.fb?.symbol === symbol && !m.fb.ok}<span class="cross cx-display">✕</span>{/if}
        </button>
      {/each}
    </div>
    <div class="status">
      <span class="phase cx-display" class:live={m.phase === 'input'}>{label[m.phase]}</span>
      <span class="slots">
        {#each m.slots as filled, i (i)}
          <span class="slot" class:filled={!!filled}>
            {#if filled}<svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICON[filled]} /></svg>{/if}
          </span>
        {/each}
      </span>
    </div>
  </div>
{/if}

<style>
  .sequence { display: grid; gap: calc(12 * var(--u)); }
  .pads { display: flex; justify-content: center; gap: calc(10 * var(--u)); }
  .pad {
    position: relative; display: grid; justify-items: center; gap: calc(6 * var(--u));
    width: calc(64 * var(--u)); padding: calc(8 * var(--u)) 0; border-radius: var(--r-sm);
    background: var(--wash); transition: background 90ms linear, color 90ms linear;
  }
  .pad svg { width: calc(30 * var(--u)); height: calc(30 * var(--u)); fill: var(--paper); }
  .pad.lit { background: var(--paper); }
  .pad.lit svg { fill: var(--ink); }
  /* Decoys are hollow: an outline instead of a filled face. */
  .pad.decoy { background: none; box-shadow: inset 0 0 0 calc(3 * var(--u)) var(--paper); }
  .pad.ok { background: var(--accent); }
  .pad.ok svg { fill: var(--ink); }
  .pad.bad { background: var(--error); }
  .pad.bad svg { fill: var(--ink); }
  .cross { position: absolute; top: calc(2 * var(--u)); right: calc(6 * var(--u)); color: var(--ink); font-size: calc(14 * var(--u)); }
  .status { display: flex; align-items: center; justify-content: space-between; gap: calc(12 * var(--u)); }
  .phase { font-size: calc(18 * var(--u)); color: var(--muted); }
  .phase.live { color: var(--accent); }
  .slots { display: flex; gap: calc(5 * var(--u)); }
  .slot { width: calc(22 * var(--u)); height: calc(22 * var(--u)); border-radius: calc(3 * var(--u)); box-shadow: inset 0 0 0 calc(3 * var(--u)) var(--rule-strong); display: grid; place-items: center; }
  .slot.filled { background: var(--paper); box-shadow: none; }
  .slot svg { width: 80%; height: 80%; fill: var(--ink); }
</style>
