<script lang="ts">
  import Meter from '../../shell/Meter.svelte';
  import { session } from '../../session.svelte';
  import { strength, type SignalState } from './logic';

  const BARS = 28;
  const m = $derived.by(() => {
    const s = session.view.s as SignalState | null;
    if (!s) return null;
    const t = session.view.t;
    const c = s.channels[s.active];
    const level = c.locked ? 1 : strength(s, c, t);
    // Deterministic "noise": bar heights wobble less as the signal clears. Never encodes the target.
    const bars = Array.from({ length: BARS }, (_, i) => {
      const noise = 0.5 + 0.5 * Math.sin(i * 12.9898 + t * 0.011 + i * i * 0.37);
      return Math.max(0.08, level * (0.75 + 0.25 * noise) + (1 - level) * noise * 0.35);
    });
    return {
      channels: s.channels.map((ch, i) => ({ locked: ch.locked, active: i === s.active })),
      tune: c.tune,
      tune2: c.tune2,
      second: s.p.secondAxis,
      locked: c.locked,
      level,
      bars,
      dwell: c.locked ? 1 : c.dwell / s.p.dwellMs,
      freq: (88 + c.tune * 20).toFixed(2),
    };
  });

  const W = 560, X0 = 20;
  let dragging = false, lastX = 0, lastY = 0, width = 1;
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = true;
    lastX = e.clientX; lastY = e.clientY;
    width = (e.currentTarget as Element).getBoundingClientRect().width || 1;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    session.pointer({ kind: 'drag', dx: (e.clientX - lastX) / width, dy: (e.clientY - lastY) / width }, e);
    lastX = e.clientX; lastY = e.clientY;
  };
  const up = () => { dragging = false; };
  const wheel = (e: WheelEvent) => { e.preventDefault(); session.pointer({ kind: 'wheel', dir: e.deltaY < 0 ? 1 : -1 }, e); };
</script>

{#if m}
  <div class="signal">
    {#if m.channels.length > 1}
      <div class="tabs" role="tablist">
        {#each m.channels as ch, i (i)}
          <button type="button" role="tab" class="tab cx-display" class:active={ch.active} class:locked={ch.locked} aria-selected={ch.active}
            onclick={(e) => session.pointer({ kind: 'select', index: i }, e)}>
            CH {i + 1}{#if ch.locked}<span class="check">✓</span>{/if}
          </button>
        {/each}
      </div>
    {/if}

    <div class="body">
      <svg viewBox="0 0 600 190" class="scope" role="presentation" onpointerdown={down} onpointermove={move} onpointerup={up} onlostpointercapture={up} onwheel={wheel} aria-hidden="true">
        {#each m.bars as h, i (i)}
          <rect x={X0 + i * (W / BARS) + 3} y={100 - h * 90} width={W / BARS - 6} height={h * 90} rx="2" class="bar" class:clear={m.level > 0.75} />
        {/each}
        <rect x={X0} y="124" width={W} height="10" rx="5" class="scale" />
        {#each Array(21) as _, i (i)}
          <rect x={X0 + (i / 20) * W - 2} y={i % 5 === 0 ? 138 : 138} width="4" height={i % 5 === 0 ? 18 : 9} class="tick" />
        {/each}
        {#each [0, 0.25, 0.5, 0.75, 1] as f (f)}
          <text x={X0 + f * W} y="176" class="label">{(88 + f * 20).toFixed(0)}</text>
        {/each}
        <g transform="translate({X0 + m.tune * W} 0)">
          <rect x="-3" y="110" width="6" height="52" rx="2" class="needle" class:locked={m.locked} />
          <path d="M -9 106 L 9 106 L 0 118 Z" class="needle" class:locked={m.locked} />
        </g>
      </svg>
      {#if m.second}
        <div class="pol" aria-label="Polarisation">
          <span class="pol-label">POL</span>
          <span class="pol-track"><span class="pol-needle" style:bottom="{m.tune2 * 100}%"></span></span>
        </div>
      {/if}
    </div>

    <div class="readouts">
      <span class="freq cx-display">{m.freq}<small>MHz</small></span>
      <div class="meters">
        <Meter label="Signal" value={m.level} segments={10} tone="paper" />
        <Meter label="Lock" value={m.dwell} tone="accent" readout={m.locked ? 'LOCK' : undefined} />
      </div>
    </div>
  </div>
{/if}

<style>
  .signal { display: grid; gap: calc(10 * var(--u)); }
  .tabs { display: flex; gap: calc(6 * var(--u)); }
  .tab { padding: calc(4 * var(--u)) calc(12 * var(--u)); border-radius: var(--r-sm); background: var(--wash); font-size: calc(16 * var(--u)); color: var(--muted); display: inline-flex; gap: calc(6 * var(--u)); }
  .tab.active { background: var(--paper); color: var(--ink); }
  .tab.locked:not(.active) { color: var(--paper); }
  .check { color: var(--accent-deep); }
  .tab.locked:not(.active) .check { color: var(--accent); }
  .body { display: flex; gap: calc(12 * var(--u)); align-items: stretch; }
  .scope { flex: 1; width: 100%; height: auto; cursor: ew-resize; touch-action: none; }
  .bar { fill: var(--rule-strong); }
  .bar.clear { fill: var(--paper); }
  .scale { fill: var(--rule); }
  .tick { fill: var(--rule-strong); }
  .label { fill: var(--muted); font: 700 13px var(--data); text-anchor: middle; }
  .needle { fill: var(--accent); stroke: var(--ink); stroke-width: 1.5; }
  .needle.locked { fill: var(--paper); }
  .pol { display: grid; justify-items: center; gap: calc(6 * var(--u)); }
  .pol-label { font: 700 calc(11 * var(--u)) / 1 var(--body); letter-spacing: 0.16em; color: var(--muted); }
  .pol-track { position: relative; flex: 1; width: calc(8 * var(--u)); border-radius: calc(4 * var(--u)); background: var(--rule); min-height: calc(120 * var(--u)); }
  .pol-needle { position: absolute; left: 50%; width: calc(22 * var(--u)); height: calc(6 * var(--u)); margin-left: calc(-11 * var(--u)); margin-bottom: calc(-3 * var(--u)); border-radius: calc(2 * var(--u)); background: var(--accent); }
  .readouts { display: grid; grid-template-columns: auto 1fr; gap: calc(18 * var(--u)); align-items: center; }
  .freq { font-size: calc(34 * var(--u)); line-height: 1; }
  .freq small { font-size: calc(14 * var(--u)); color: var(--muted); margin-left: calc(4 * var(--u)); }
  .meters { display: grid; gap: calc(6 * var(--u)); }
</style>
