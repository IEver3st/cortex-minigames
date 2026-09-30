<script lang="ts">
  import Meter from '../../shell/Meter.svelte';
  import { session } from '../../session.svelte';
  import { OVERPRESSURE, bandCenter, type PressureState } from './logic';

  const m = $derived.by(() => {
    const s = session.view.s as PressureState | null;
    if (!s) return null;
    const center = bandCenter(s, session.view.t);
    return {
      pressure: s.pressure,
      lo: center - s.p.bandWidth / 2,
      hi: center + s.p.bandWidth / 2,
      inside: s.inside,
      over: s.over,
      work: s.progress,
      stress: Math.min(1, s.stress),
      venting: s.velocity < -0.02,
    };
  });
  const W = 440, X0 = 10;
  let held = false;
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    held = true;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    session.hold('primary', true, e);
  };
  const up = (e: PointerEvent) => {
    if (!held) return;
    held = false;
    session.hold('primary', false, e);
  };
</script>

{#if m}
  <div class="pressure">
    <svg viewBox="0 0 460 70" role="presentation" onpointerdown={down} onpointerup={up} onlostpointercapture={up} aria-hidden="true">
      <defs>
        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="8" class="hatch" />
        </pattern>
      </defs>
      <rect x={X0} y="28" width={W} height="16" rx="4" class="track" />
      <rect x={X0 + OVERPRESSURE * W} y="28" width={(1 - OVERPRESSURE) * W} height="16" fill="url(#hatch)" />
      <rect x={X0 + m.lo * W} y="20" width={(m.hi - m.lo) * W} height="32" rx="4" class="band" class:inside={m.inside} />
      <rect x={X0} y="31" width={m.pressure * W} height="10" rx="3" class="level" class:over={m.over} />
      <g transform="translate({X0 + m.pressure * W} 0)">
        <path d="M -9 6 L 9 6 L 0 18 Z" class="needle" />
        <rect x="-3" y="16" width="6" height="40" rx="2" class="needle" />
      </g>
      <text x={X0} y="68" class="scale">0</text>
      <text x={X0 + W} y="68" class="scale end">MAX</text>
    </svg>
    <div class="meters">
      <Meter label="Work" value={m.work} tone="paper" />
      <Meter label="Stress" value={m.stress} tone={m.stress > 0.6 ? 'error' : m.stress > 0.25 ? 'warning' : 'paper'} />
    </div>
    <span class="state cx-display" class:ok={m.inside} class:bad={m.over}>{m.over ? 'Overpressure' : m.inside ? 'In band' : m.pressure < m.lo ? 'Build up' : 'Ease off'}</span>
  </div>
{/if}

<style>
  .pressure { display: grid; gap: calc(10 * var(--u)); }
  svg { width: 100%; height: auto; cursor: pointer; touch-action: none; }
  .track { fill: var(--rule); }
  .hatch { fill: var(--error); opacity: 0.55; }
  .band { fill: none; stroke: var(--paper); stroke-width: 4; }
  .band.inside { stroke: var(--accent); }
  .level { fill: var(--rule-strong); }
  .level.over { fill: var(--error); }
  .needle { fill: var(--accent); stroke: var(--ink); stroke-width: 1.5; }
  .scale { fill: var(--muted); font: 700 11px var(--body); letter-spacing: 0.1em; }
  .scale.end { text-anchor: end; }
  .meters { display: grid; gap: calc(6 * var(--u)); }
  .state { font-size: calc(16 * var(--u)); color: var(--muted); }
  .state.ok { color: var(--accent); }
  .state.bad { color: var(--error); }
</style>
