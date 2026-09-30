<script lang="ts">
  import Meter from '../../shell/Meter.svelte';
  import { session } from '../../session.svelte';
  import { BOARD_W, type TraceState } from './logic';

  const K = 100; // board units → viewBox units
  const m = $derived.by(() => {
    const s = session.view.s as TraceState | null;
    if (!s) return null;
    return {
      d: s.path.map((p, i) => `${i ? 'L' : 'M'}${(p.x * K).toFixed(1)} ${(p.y * K).toFixed(1)}`).join(' '),
      width: s.p.corridor * 2 * K,
      start: s.path[0],
      checkpoints: s.checkpoints.map((c, i) => ({ ...c, state: i < s.reached ? 'done' : i === s.reached ? 'next' : 'later' })),
      probe: s.probe,
      outside: s.outside,
      grabbed: !!s.target,
      edge: Math.min(1, s.contactMs / s.p.contactBudgetMs),
      contacts: s.contacts,
      maxContacts: s.p.maxContacts,
      r: s.p.corridor * K,
    };
  });

  let grabbing = false;
  const toBoard = (e: PointerEvent) => {
    const svg = (e.currentTarget as SVGSVGElement);
    const box = svg.getBoundingClientRect();
    return { x: ((e.clientX - box.left) / box.width) * BOARD_W, y: (e.clientY - box.top) / box.height };
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || !m) return;
    const p = toBoard(e);
    // Grab only near the probe: the mouse steers the probe, it cannot teleport it.
    if (Math.hypot(p.x - m.probe.x, p.y - m.probe.y) > Math.max(0.08, (m.r / K) * 2.5)) return;
    grabbing = true;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    session.pointer({ kind: 'target', x: p.x, y: p.y, grab: true }, e);
  };
  const move = (e: PointerEvent) => { if (grabbing) session.pointer({ kind: 'target', ...toBoard(e), grab: true }, e); };
  const up = (e: PointerEvent) => {
    if (!grabbing) return;
    grabbing = false;
    session.pointer({ kind: 'target', x: 0, y: 0, grab: false }, e);
  };
</script>

{#if m}
  <div class="trace">
    <svg viewBox="0 0 {BOARD_W * K} {K}" role="presentation" onpointerdown={down} onpointermove={move} onpointerup={up} onlostpointercapture={up} aria-label="Track">
      <rect width={BOARD_W * K} height={K} rx="3" class="board" />
      <path d={m.d} class="corridor" style:stroke-width={m.width} />
      <text x={m.start.x * K} y={m.start.y * K - m.r - 3} class="tag">START</text>
      {#each m.checkpoints as cp, i (i)}
        <g class="cp {cp.state}">
          <circle cx={cp.x * K} cy={cp.y * K} r={m.r * 0.8} />
          <text x={cp.x * K} y={cp.y * K + 2.2} class="cp-num">{cp.state === 'done' ? '✓' : i + 1}</text>
        </g>
      {/each}
      <circle cx={m.probe.x * K} cy={m.probe.y * K} r="2.6" class="probe" class:outside={m.outside} class:grabbed={m.grabbed} />
    </svg>
    <div class="meters">
      <Meter label="Edge" value={m.edge} tone={m.edge > 0.6 ? 'error' : m.edge > 0.25 ? 'warning' : 'paper'} readout="{m.contacts}/{m.maxContacts}" />
    </div>
  </div>
{/if}

<style>
  .trace { display: grid; gap: calc(10 * var(--u)); }
  svg { width: 100%; height: auto; touch-action: none; cursor: grab; }
  .board { fill: var(--wash); }
  .corridor { fill: none; stroke: var(--rule-strong); stroke-linecap: round; stroke-linejoin: round; }
  .tag { fill: var(--muted); font: 700 3.4px var(--body); letter-spacing: 0.4px; text-anchor: middle; }
  .cp circle { fill: none; stroke: var(--paper); stroke-width: 1; }
  .cp.next circle { stroke: var(--accent); stroke-width: 1.4; }
  .cp.done circle { fill: var(--paper); }
  .cp.later { opacity: 0.6; }
  .cp-num { font: 800 italic 5px var(--display); text-anchor: middle; fill: var(--paper); }
  .cp.done .cp-num { fill: var(--ink); }
  .probe { fill: var(--accent); stroke: var(--ink); stroke-width: 0.9; }
  .probe.outside { fill: var(--error); }
  .meters { display: grid; }
</style>
