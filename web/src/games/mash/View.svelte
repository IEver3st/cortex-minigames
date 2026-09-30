<script lang="ts">
  import Keycap from '../../shell/Keycap.svelte';
  import { session } from '../../session.svelte';
  import type { Action } from '../../core/types';
  import type { MashState } from './logic';

  // Keycap inside a thick ring: the ring is the meter, the keycap is the button being hammered.
  const m = $derived.by(() => {
    const s = session.view.s as MashState | null;
    if (!s) return null;
    const t = session.view.t;
    const action = s.p.action as Action;
    return {
      action,
      fill: s.fill,
      pressed: (session.engine?.input.held.has(action) ?? false) || t - s.lastAt < 70,
      word: s.fill >= 0.8 ? 'Almost' : s.taps === 0 ? 'Tap' : 'Keep going',
    };
  });
  let down = false;
  const press = (e: PointerEvent) => {
    if (e.button !== 0 || !m) return;
    down = true;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    session.hold(m.action, true, e);
  };
  const release = (e: PointerEvent) => {
    if (!down || !m) return;
    down = false;
    session.hold(m.action, false, e);
  };
</script>

{#if m}
  <div class="mash">
    <div class="dial">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="50" class="track" />
        <circle cx="60" cy="60" r="50" class="fill" pathLength="100" stroke-dasharray="{m.fill * 100} 100" />
      </svg>
      <button type="button" class="key" aria-label="Tap" onpointerdown={press} onpointerup={release} onlostpointercapture={release}>
        <Keycap action={m.action} pressed={m.pressed} />
      </button>
    </div>
    <div class="readout" role="meter" aria-label="Fill" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(m.fill * 100)}>
      <span class="value cx-display">{Math.round(m.fill * 100)}</span>
      <span class="word cx-display" class:hot={m.fill >= 0.8}>{m.word}</span>
    </div>
  </div>
{/if}

<style>
  .mash { display: grid; grid-template-columns: auto auto; align-items: center; justify-content: center; gap: calc(22 * var(--u)); padding: calc(4 * var(--u)) 0; }
  .dial { position: relative; width: calc(128 * var(--u)); aspect-ratio: 1; }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
  .track { fill: none; stroke: var(--rule-strong); stroke-width: 12; }
  .fill { fill: none; stroke: var(--accent); stroke-width: 12; }
  .key { position: absolute; inset: 0; display: grid; place-items: center; cursor: pointer; }
  .key :global(.cx-keycap) {
    min-width: calc(58 * var(--u)); height: calc(58 * var(--u)); font-size: calc(26 * var(--u)); border-radius: var(--r);
    transition: transform 60ms var(--ease);
  }
  .readout { display: grid; gap: calc(4 * var(--u)); min-width: calc(110 * var(--u)); }
  .value { font-size: calc(44 * var(--u)); line-height: 0.9; }
  .word { font-size: calc(16 * var(--u)); color: var(--muted); }
  .word.hot { color: var(--paper); }
</style>
