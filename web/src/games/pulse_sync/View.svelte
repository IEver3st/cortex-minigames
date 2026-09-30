<script lang="ts">
  import ActionButton from '../../shell/ActionButton.svelte';
  import Meter from '../../shell/Meter.svelte';
  import { session } from '../../session.svelte';
  import { MARKER, inWindow, type PulseState } from './logic';

  const W = 560, X0 = 20, LANE = 40;
  const m = $derived.by(() => {
    const s = session.view.s as PulseState | null;
    if (!s) return null;
    const t = session.view.t;
    return {
      lanes: s.lanes.map((lane, i) => ({ pos: lane.pos, parked: lane.parked, selected: i === s.selected, inside: inWindow(s, lane) })),
      window: s.p.window,
      park: s.p.parkMs ? 1 - Math.min(1, s.parkUsed / s.p.parkMs) : 0,
      hasPark: s.p.parkMs > 0,
      rounds: Array.from({ length: s.p.rounds }, (_, i) => i < s.round),
      flash: s.flash && t - s.flash.at < 300 ? s.flash.ok : null,
    };
  });
</script>

{#if m}
  <div class="pulse">
    <svg viewBox="0 0 600 {m.lanes.length * LANE + 16}" aria-label="Pulse lanes" class:good={m.flash === true} class:bad={m.flash === false}>
      <defs>
        <pattern id="park-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="6" class="hatch" />
        </pattern>
      </defs>
      {#each m.lanes as lane, i (i)}
        {@const y = 8 + i * LANE + LANE / 2}
        <g class="lane" class:selected={lane.selected} class:parked={lane.parked} role="button" tabindex="-1" aria-label="Lane {i + 1}{lane.parked ? ' parked' : ''}"
          onmousedown={(e) => session.pointer({ kind: 'select', index: i }, e)}>
          <rect x="0" y={y - LANE / 2 + 3} width="600" height={LANE - 6} rx="4" class="row" />
          <rect x={X0} y={y - 4} width={W} height="8" rx="4" class="track" />
          <path d="M {X0 + (MARKER - m.window / 2) * W} {y - 13} h -6 v 26 h 6 M {X0 + (MARKER + m.window / 2) * W} {y - 13} h 6 v 26 h -6" class="bracket" class:inside={lane.inside} />
          <circle cx={X0 + lane.pos * W} cy={y} r="10" class="dot" class:inside={lane.inside} fill={lane.parked ? 'url(#park-hatch)' : undefined} />
        </g>
      {/each}
      <rect x={X0 + MARKER * W - 3} y="4" width="6" height={m.lanes.length * LANE + 8} rx="2" class="marker" />
    </svg>
    <div class="footer">
      <span class="rounds" aria-label="Syncs">{#each m.rounds as done, i (i)}<span class:done>{done ? '■' : '□'}</span>{/each}</span>
      {#if m.hasPark}<div class="park"><Meter label="Park" value={m.park} tone={m.park < 0.25 ? 'warning' : 'paper'} /></div>{/if}
      <ActionButton action="primary" label="Sync" onpress={(e) => session.pointer({ kind: 'select', index: -1 }, e)} />
    </div>
  </div>
{/if}

<style>
  .pulse { display: grid; gap: calc(10 * var(--u)); }
  svg { width: 100%; height: auto; }
  .row { fill: none; }
  .lane { cursor: pointer; }
  .lane.selected .row { fill: var(--wash); stroke: var(--accent); stroke-width: 3; }
  .track { fill: var(--rule); }
  .bracket { fill: none; stroke: var(--muted); stroke-width: 4; }
  .bracket.inside { stroke: var(--paper); }
  .dot { fill: var(--accent); stroke: var(--ink); stroke-width: 2; }
  .dot.inside { stroke: var(--paper); stroke-width: 3; }
  .hatch { fill: var(--accent); }
  .marker { fill: var(--paper); }
  .good .marker { fill: var(--accent); }
  .bad .marker { fill: var(--error); }
  .footer { display: flex; align-items: center; gap: calc(16 * var(--u)); }
  .rounds { display: flex; gap: calc(5 * var(--u)); font: calc(16 * var(--u)) / 1 var(--data); color: var(--muted); }
  .rounds .done { color: var(--paper); }
  .park { flex: 1; }
</style>
