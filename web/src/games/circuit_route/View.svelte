<script lang="ts">
  import ActionButton from '../../shell/ActionButton.svelte';
  import { session } from '../../session.svelte';
  import { E, N, S, W, type CircuitState } from './logic';

  const CELL = 64;
  const m = $derived.by(() => {
    const s = session.view.s as CircuitState | null;
    if (!s) return null;
    const test = s.lastTest;
    return {
      cols: s.cols,
      rows: s.rows,
      cursor: s.cursor,
      testsLeft: s.p.tests - s.testsUsed,
      tests: s.p.tests,
      tiles: s.tiles.map((tile, i) => ({
        ...tile,
        powered: !!test?.powered[i],
        lit: !!test?.lit.includes(i),
        shorted: !!test?.shorted.includes(i),
      })),
      summary: test
        ? test.shorted.length
          ? 'Short circuit: a hazard took power'
          : `${test.lit.length} of ${s.tiles.filter((t) => t.kind === 'terminal').length} terminals live`
        : '',
    };
  });

  const arms = (mask: number) => [
    mask & N ? 'M32 32 L32 0' : '',
    mask & E ? 'M32 32 L64 32' : '',
    mask & S ? 'M32 32 L32 64' : '',
    mask & W ? 'M32 32 L0 32' : '',
  ].filter(Boolean).join(' ');

  const click = (index: number, e: MouseEvent) => {
    e.preventDefault();
    session.pointer({ kind: 'cell', index, button: e.button === 2 ? 2 : 0 }, e);
  };
</script>

{#if m}
  <div class="circuit">
    <svg viewBox="-4 -4 {m.cols * CELL + 8} {m.rows * CELL + 8}" style:max-width="calc({m.cols * 84} * var(--u))" aria-label="Circuit board">
      {#each m.tiles as tile, i (i)}
        {@const x = (i % m.cols) * CELL}
        {@const y = Math.floor(i / m.cols) * CELL}
        <g transform="translate({x} {y})" class="tile k-{tile.kind}" class:fixed={tile.fixed} class:cursor={i === m.cursor}
          class:powered={tile.powered} class:lit={tile.lit} class:shorted={tile.shorted}
          role="button" tabindex="-1" aria-label="{tile.kind} {i}"
          onmousedown={(e) => click(i, e)} oncontextmenu={(e) => e.preventDefault()}>
          <rect x="3" y="3" width={CELL - 6} height={CELL - 6} rx="4" class="cell" />
          {#if tile.kind === 'wire' || tile.kind === 'source' || tile.kind === 'terminal'}
            <path d={arms(tile.mask)} class="wire" />
          {/if}
          {#if tile.kind === 'wire'}
            <circle cx="32" cy="32" r="6" class="hub" />
          {:else if tile.kind === 'source'}
            <rect x="18" y="18" width="28" height="28" rx="4" class="source-face" />
            <path d="M32 24 L32 40 M24 32 L40 32" class="source-mark" />
          {:else if tile.kind === 'terminal'}
            <circle cx="32" cy="32" r="14" class="terminal-ring" />
            {#if tile.lit}<path d="M25 32 L30 37 L40 26" class="terminal-check" />{/if}
          {:else if tile.kind === 'hazard'}
            <path d="M32 12 L52 32 L32 52 L12 32 Z" class="hazard-face" />
            <path d="M32 22 L32 35 M32 40 L32 43" class="hazard-mark" />
          {/if}
        </g>
      {/each}
    </svg>
    <div class="footer">
      <span class="summary">{m.summary}</span>
      <span class="tests cx-display" class:low={m.testsLeft <= 1}>Tests {m.testsLeft}/{m.tests}</span>
      <ActionButton action="primary" label="Test" onpress={(e) => session.pointer({ kind: 'select', index: -1 }, e)} />
    </div>
  </div>
{/if}

<style>
  .circuit { display: grid; gap: calc(10 * var(--u)); justify-items: center; }
  svg { width: 100%; height: auto; }
  .tile { cursor: pointer; }
  .tile.fixed { cursor: default; }
  .cell { fill: var(--wash); }
  .tile.fixed .cell { fill: none; }
  .wire { fill: none; stroke: var(--paper); stroke-width: 9; stroke-linecap: square; }
  .hub { fill: var(--paper); }
  .powered .wire, .powered .hub { stroke: var(--accent); fill: var(--accent); }
  .powered .wire { fill: none; }
  /* Selection flips the cell to paper with ink wiring, the strongest Cortex signal. */
  .cursor .cell { fill: var(--paper); }
  .cursor .wire { stroke: var(--ink); }
  .cursor .hub { fill: var(--ink); }
  .source-face { fill: var(--paper); stroke: var(--ink); stroke-width: 3; }
  .source-mark { stroke: var(--ink); stroke-width: 5; }
  .terminal-ring { fill: var(--ink); stroke: var(--warning); stroke-width: 5; }
  .lit .terminal-ring { stroke: var(--accent); fill: var(--accent); }
  .terminal-check { fill: none; stroke: var(--ink); stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; }
  .hazard-face { fill: none; stroke: var(--error); stroke-width: 5; }
  .shorted .hazard-face { fill: var(--error); }
  .hazard-mark { stroke: var(--error); stroke-width: 5; stroke-linecap: round; }
  .shorted .hazard-mark { stroke: var(--ink); }
  .footer { width: 100%; display: flex; align-items: center; gap: calc(14 * var(--u)); }
  .summary { flex: 1; font: calc(14 * var(--u)) / 1.2 var(--body); color: var(--muted); }
  .tests { font-size: calc(17 * var(--u)); }
  .tests.low { color: var(--warning); }
</style>
