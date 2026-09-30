<script lang="ts">
  import { session } from '../../session.svelte';
  import { direction, progress, type TraceSweepState } from './logic';

  // Half ring from 3 to 9 o'clock. The mint knob and fill are the player's; the paper cap is the goal.
  const R = 72;
  const m = $derived.by(() => {
    const s = session.view.s as TraceSweepState | null;
    if (!s) return null;
    const upper = direction(s) === 'upper';
    const cy = upper ? 96 : 20;
    const value = progress(s);
    const angle = value * Math.PI;
    return {
      upper,
      cy,
      value,
      track: `M ${100 + R} ${cy} A ${R} ${R} 0 0 ${upper ? 0 : 1} ${100 - R} ${cy}`,
      knob: { x: 100 + R * Math.cos(angle), y: cy + (upper ? -1 : 1) * R * Math.sin(angle) },
      arrow: upper ? 'M 184 88 L 191 76 L 198 88 Z' : 'M 184 28 L 191 40 L 198 28 Z',
      mouse: upper ? 58 : 20,
      waiting: session.view.t < s.openAt,
      pips: s.p.sweeps > 1 ? Array.from({ length: s.p.sweeps }, (_, i) => i < s.round) : [],
    };
  });

  // Mouse motion anywhere on the screen drives the knob; no button, no grabbing. Deltas come from
  // consecutive pointer positions, so a pointer that stops at a screen edge simply stops the knob.
  $effect(() => {
    if (session.phase !== 'playing') return;
    let last: { x: number; y: number } | null = null;
    const move = (e: PointerEvent) => {
      if (last) session.pointer({ kind: 'drag', dx: e.clientX - last.x, dy: e.clientY - last.y }, e);
      last = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  });
</script>

{#if m}
  <div class="trace" role="progressbar" aria-label={m.upper ? 'Sweep right, up and over to the left' : 'Sweep right, down and under to the left'}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(m.value * 100)}>
    <svg viewBox="0 0 200 116" aria-hidden="true">
      <path d={m.track} class="track" />
      <path d={m.track} class="fill" pathLength="1" stroke-dasharray="{m.value} 1" />
      <rect x={100 - R - 13} y={m.cy - 3} width="26" height="6" rx="2" class="goal" />
      <path d={m.arrow} class="arrow" />
      <g transform="translate(100 {m.mouse})" class="mouse">
        <rect x="-11" y="0" width="22" height="34" rx="11" class="mouse-body" />
        <path d="M 0 6 V 13" class="mouse-wheel" />
      </g>
      <circle cx={m.knob.x} cy={m.knob.y} r="11" class="knob" class:waiting={m.waiting} />
    </svg>
    {#if m.pips.length}
      <div class="pips" aria-label="Sweeps">
        {#each m.pips as done, i (i)}<span class:done>{done ? '■' : '□'}</span>{/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .trace { display: grid; justify-items: center; gap: calc(6 * var(--u)); padding: calc(4 * var(--u)) 0; }
  svg { width: calc(270 * var(--u)); height: auto; overflow: visible; }
  .track { fill: none; stroke: var(--rule-strong); stroke-width: 14; }
  .fill { fill: none; stroke: var(--accent); stroke-width: 14; }
  .goal { fill: var(--paper); }
  .arrow { fill: var(--muted); }
  .mouse-body { fill: none; stroke: var(--paper); stroke-width: 3.5; }
  .mouse-wheel { stroke: var(--paper); stroke-width: 3.5; stroke-linecap: round; }
  .knob { fill: var(--accent); stroke: var(--ink); stroke-width: 3.5; }
  .knob.waiting { opacity: 0.45; }
  .pips { display: flex; gap: calc(6 * var(--u)); font: calc(16 * var(--u)) / 1 var(--data); color: var(--muted); }
  .pips .done { color: var(--paper); }
</style>
