<script lang="ts">
  import Meter from '../../shell/Meter.svelte';
  import { session } from '../../session.svelte';
  import { AXES, convergence, sample, type WaveState } from './logic';

  const LABELS = { frequency: 'Freq', amplitude: 'Amp', phase: 'Phase' } as const;
  const PW = 600, PH = 150;
  const points = (c: readonly number[]) => {
    let d = '';
    for (let i = 0; i <= 120; i++) {
      const x = i / 120;
      d += `${i ? 'L' : 'M'}${(x * PW).toFixed(1)} ${(PH / 2 - sample(c, x) * (PH / 2 - 10)).toFixed(1)} `;
    }
    return d;
  };

  const m = $derived.by(() => {
    const s = session.view.s as WaveState | null;
    if (!s) return null;
    return {
      target: points(s.target),
      player: points(s.controls),
      rows: AXES.map((axis) => {
        const k = s.adjustable.indexOf(axis);
        return { axis, adjustable: k >= 0, index: k, value: s.controls[AXES.indexOf(axis)], selected: k === s.selected };
      }),
      match: convergence(s),
      dwell: Math.min(1, s.dwell / s.p.dwellMs),
      holding: s.error <= s.p.tolerance,
    };
  });

  let dragging = -1;
  const set = (index: number, e: PointerEvent) => {
    const box = (e.currentTarget as Element).getBoundingClientRect();
    session.pointer({ kind: 'set', control: index, value: (e.clientX - box.left) / box.width }, e);
  };
</script>

{#if m}
  <div class="wave">
    <svg viewBox="0 0 {PW} {PH}" aria-label="Waveforms: dashed is the target, solid is yours">
      <rect x="0" y={PH / 2 - 2} width={PW} height="4" class="axis" />
      <path d={m.target} class="target" />
      <path d={m.player} class="player" class:holding={m.holding} />
    </svg>
    <div class="controls">
      {#each m.rows as row (row.axis)}
        <div class="row" class:selected={row.selected} class:fixed={!row.adjustable}>
          <span class="name cx-display">{LABELS[row.axis]}</span>
          {#if row.adjustable}
            <span class="track" role="slider" tabindex="-1" aria-label={LABELS[row.axis]} aria-valuenow={Math.round(row.value * 100)}
              onpointerdown={(e) => { dragging = row.index; (e.currentTarget as Element).setPointerCapture(e.pointerId); set(row.index, e); }}
              onpointermove={(e) => { if (dragging === row.index) set(row.index, e); }}
              onpointerup={() => (dragging = -1)}
              onlostpointercapture={() => (dragging = -1)}
              onwheel={(e) => { e.preventDefault(); session.pointer({ kind: 'wheel', dir: e.deltaY < 0 ? 1 : -1, control: row.index }, e); }}>
              <span class="handle" style:left="{row.value * 100}%"></span>
            </span>
          {:else}
            <span class="locked">Fixed</span>
          {/if}
        </div>
      {/each}
    </div>
    <div class="meters">
      <Meter label="Match" value={m.match} segments={12} tone="paper" />
      <Meter label="Hold" value={m.dwell} tone="accent" />
    </div>
  </div>
{/if}

<style>
  .wave { display: grid; gap: calc(12 * var(--u)); }
  svg { width: 100%; height: auto; background: var(--wash); border-radius: var(--r-sm); }
  .axis { fill: var(--rule); }
  .target { fill: none; stroke: var(--paper); stroke-width: 5; stroke-dasharray: 14 9; stroke-linecap: round; }
  .player { fill: none; stroke: var(--accent); stroke-width: 5; stroke-linejoin: round; }
  .controls { display: grid; gap: calc(6 * var(--u)); }
  .row { display: grid; grid-template-columns: calc(70 * var(--u)) 1fr; align-items: center; gap: calc(12 * var(--u)); padding: calc(5 * var(--u)) calc(8 * var(--u)); border-radius: var(--r-sm); }
  .row.selected { background: var(--paper); color: var(--ink); }
  .name { font-size: calc(17 * var(--u)); }
  .fixed .name { color: var(--dim); }
  .track { position: relative; height: calc(8 * var(--u)); border-radius: calc(4 * var(--u)); background: var(--rule-strong); cursor: ew-resize; touch-action: none; }
  .selected .track { background: rgba(15, 16, 18, 0.25); }
  .handle { position: absolute; top: 50%; width: calc(14 * var(--u)); height: calc(22 * var(--u)); margin: calc(-11 * var(--u)) 0 0 calc(-7 * var(--u)); border-radius: calc(3 * var(--u)); background: var(--accent); box-shadow: 0 0 0 calc(2 * var(--u)) var(--ink); }
  .locked { font: 700 calc(11 * var(--u)) / 1 var(--body); letter-spacing: 0.16em; text-transform: uppercase; color: var(--dim); }
  .meters { display: grid; gap: calc(6 * var(--u)); }
</style>
