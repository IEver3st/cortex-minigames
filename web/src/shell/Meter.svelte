<script lang="ts">
  // A labelled, frameless meter. Tone is a severity ladder (paper → sand → soft red), and the
  // numeric readout keeps the state readable without colour.
  let { label, value, tone = 'paper', readout = undefined, segments = 0 }: {
    label: string;
    value: number;
    tone?: 'paper' | 'accent' | 'warning' | 'error';
    readout?: string;
    segments?: number;
  } = $props();
  const clamped = $derived(Math.min(1, Math.max(0, value)));
</script>

<div class="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)}>
  <span class="label">{label}</span>
  {#if segments > 0}
    <span class="segments">
      {#each Array(segments) as _, i (i)}<span class="segment {tone}" class:on={clamped * segments > i + 0.001}></span>{/each}
    </span>
  {:else}
    <span class="track"><span class="fill {tone}" style:transform="scaleX({clamped})"></span></span>
  {/if}
  <span class="readout cx-display">{readout ?? Math.round(clamped * 100)}</span>
</div>

<style>
  .meter { display: grid; grid-template-columns: calc(64 * var(--u)) 1fr calc(40 * var(--u)); align-items: center; gap: calc(10 * var(--u)); }
  .label { font: 700 calc(11 * var(--u)) / 1 var(--body); letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
  .track { height: calc(6 * var(--u)); border-radius: calc(3 * var(--u)); background: var(--rule); overflow: hidden; }
  .fill { display: block; height: 100%; transform-origin: 0 50%; }
  .segments { display: grid; grid-auto-flow: column; gap: calc(3 * var(--u)); height: calc(10 * var(--u)); }
  .segment { border-radius: calc(2 * var(--u)); background: var(--rule); }
  .paper, .segment.paper.on { background: var(--paper); }
  .accent, .segment.accent.on { background: var(--accent); }
  .warning, .segment.warning.on { background: var(--warning); }
  .error, .segment.error.on { background: var(--error); }
  .segment:not(.on) { background: var(--rule); }
  .readout { text-align: right; font-size: calc(16 * var(--u)); color: var(--paper); }
</style>
