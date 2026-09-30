<script lang="ts">
  import ActionButton from '../../shell/ActionButton.svelte';
  import Meter from '../../shell/Meter.svelte';
  import { session } from '../../session.svelte';
  import { feel, type PinState } from './logic';

  const FEEL_TEXT = { slack: 'Slack', loose: 'Loose', binding: 'Binding', stiff: 'Too stiff', set: 'Set' } as const;

  const m = $derived.by(() => {
    const s = session.view.s as PinState | null;
    if (!s) return null;
    const t = session.view.t;
    const current = feel(s);
    const event = s.lastEvent && t - s.lastEvent.at < 450 ? s.lastEvent : null;
    return {
      pins: s.pins.map((pin, i) => ({ lift: pin.lift, set: pin.set, selected: i === s.selected, event: event?.pin === i ? event.kind : null })),
      feel: current.feel,
      resistance: current.resistance,
      tension: s.tension,
      lo: s.lo,
      hi: s.hi,
      stress: Math.min(1, s.stress),
      slack: s.slackFor > 0,
    };
  });

  // Pin geometry: the shear line's lower edge is y=60; a pin at full lift reaches it.
  const COL = 70, SHEAR = 60, TRAVEL = 70;
  let dragging = false;
  const setTension = (e: PointerEvent) => {
    const box = (e.currentTarget as Element).getBoundingClientRect();
    session.pointer({ kind: 'set', control: 0, value: (e.clientX - box.left) / box.width }, e);
  };
</script>

{#if m}
  <div class="lock">
    <svg viewBox="0 0 {m.pins.length * COL + 20} 214" aria-label="Pins">
      <rect x="0" y="54" width={m.pins.length * COL + 20} height="6" class="shear" />
      {#each m.pins as pin, i (i)}
        {@const x = 10 + i * COL}
        <g class="pin" class:selected={pin.selected} class:set={pin.set} class:miss={pin.event === 'miss'} class:drop={pin.event === 'drop'}
          role="button" tabindex="-1" aria-label="Pin {i + 1}{pin.set ? ' set' : ''}"
          onmousedown={(e) => session.pointer({ kind: 'select', index: i }, e)}
          onwheel={(e) => { e.preventDefault(); session.pointer({ kind: 'select', index: i }, e); session.pointer({ kind: 'wheel', dir: e.deltaY < 0 ? 1 : -1 }, e); }}>
          <rect x={x + 4} y="6" width={COL - 8} height="178" rx="4" class="slot" />
          <rect x={x + COL / 2 - 13} y={SHEAR + (1 - pin.lift) * TRAVEL} width="26" height="44" rx="4" class="driver" />
          <text x={x + COL / 2} y="208" class="num">{pin.set ? '✓' : i + 1}</text>
        </g>
      {/each}
    </svg>

    <div class="readouts">
      <div class="feel">
        <span class="cx-eyebrow">Feel</span>
        <span class="feel-word cx-display" class:binding={m.feel === 'binding'} class:bad={m.feel === 'stiff'}>{FEEL_TEXT[m.feel]}</span>
        <Meter label="Resist" value={m.resistance} segments={8} tone={m.feel === 'stiff' ? 'error' : 'paper'} />
      </div>
      <div class="gauges">
        <div class="tension" role="slider" tabindex="-1" aria-label="Tension" aria-valuenow={Math.round(m.tension * 100)}
          onpointerdown={(e) => { dragging = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); setTension(e); }}
          onpointermove={(e) => { if (dragging) setTension(e); }}
          onpointerup={() => (dragging = false)}
          onlostpointercapture={() => (dragging = false)}>
          <span class="t-label">Tension</span>
          <span class="t-track">
            <span class="t-window" style:left="{m.lo * 100}%" style:width="{(m.hi - m.lo) * 100}%"></span>
            <span class="t-level" class:slack={m.slack} style:width="{m.tension * 100}%"></span>
          </span>
        </div>
        <Meter label="Stress" value={m.stress} tone={m.stress > 0.6 ? 'error' : m.stress > 0.25 ? 'warning' : 'paper'} />
      </div>
      <ActionButton action="primary" label="Set" onpress={(e) => session.pointer({ kind: 'select', index: -1 }, e)} />
    </div>
  </div>
{/if}

<style>
  .lock { display: grid; gap: calc(12 * var(--u)); }
  svg { width: 100%; max-height: calc(220 * var(--u)); }
  .shear { fill: var(--rule-strong); }
  .slot { fill: var(--wash); cursor: pointer; }
  .selected .slot { fill: none; stroke: var(--accent); stroke-width: 4; }
  .driver { fill: var(--muted); }
  .selected .driver { fill: var(--accent); }
  .set .driver { fill: var(--paper); }
  .miss .driver { fill: var(--error); }
  .drop .slot { fill: none; stroke: var(--warning); stroke-width: 4; }
  .num { fill: var(--muted); font: 800 italic 18px var(--display); text-anchor: middle; }
  .set .num { fill: var(--paper); }
  .readouts { display: grid; grid-template-columns: 1fr 1.3fr auto; gap: calc(16 * var(--u)); align-items: end; }
  .feel { display: grid; gap: calc(6 * var(--u)); }
  .feel-word { font-size: calc(24 * var(--u)); color: var(--muted); line-height: 1; }
  .feel-word.binding { color: var(--paper); }
  .feel-word.bad { color: var(--error); }
  .gauges { display: grid; gap: calc(8 * var(--u)); }
  .tension { display: grid; grid-template-columns: calc(64 * var(--u)) 1fr; gap: calc(10 * var(--u)); align-items: center; cursor: ew-resize; touch-action: none; }
  .t-label { font: 700 calc(11 * var(--u)) / 1 var(--body); letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
  .t-track { position: relative; height: calc(14 * var(--u)); border-radius: calc(4 * var(--u)); background: var(--rule); }
  .t-window { position: absolute; top: calc(-4 * var(--u)); bottom: calc(-4 * var(--u)); border-radius: calc(4 * var(--u)); box-shadow: inset 0 0 0 calc(3 * var(--u)) var(--paper); }
  .t-level { position: absolute; left: 0; top: calc(4 * var(--u)); bottom: calc(4 * var(--u)); border-radius: calc(3 * var(--u)); background: var(--accent); }
  .t-level.slack { background: var(--warning); }
</style>
