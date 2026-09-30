<script lang="ts">
  import ActionButton from '../../shell/ActionButton.svelte';
  import { session } from '../../session.svelte';
  import { GLYPHS, inPreview, type PatternState, type Piece } from './logic';

  const m = $derived.by(() => {
    const s = session.view.s as PatternState | null;
    if (!s) return null;
    const t = session.view.t;
    const preview = inPreview(s, t);
    const targetAt = new Map(s.target.map((goal) => [goal.cell, goal]));
    const correct = new Set(s.marks?.correct ?? []);
    return {
      size: s.p.size,
      preview,
      previewLeft: preview ? Math.max(0, (s.previewEnd - t) / s.p.previewMs) : 0,
      cells: s.board.map((piece, i) => ({ piece: preview ? targetAt.get(i) ?? null : piece, cursor: !preview && i === s.cursor, correct: correct.has(i) })),
      tray: s.tray.map((piece, i) => ({ ...piece, selected: i === s.selected })),
      left: s.p.submissions - s.submissionsUsed,
      submissions: s.p.submissions,
      rotation: s.p.rotation,
    };
  });

  const blocks = (piece: Piece) => GLYPHS[piece.glyph];
  let drag = -1;
</script>

{#snippet glyph(piece: Piece)}
  <svg viewBox="0 0 30 30" class="glyph" aria-label="{piece.glyph} facing {piece.rotation * 90} degrees">
    <g transform="rotate({piece.rotation * 90} 15 15)">
      {#each blocks(piece) as [x, y], i (i)}<rect x={1.5 + x * 9} y={1.5 + y * 9} width="8" height="8" rx="1.2" />{/each}
    </g>
  </svg>
{/snippet}

{#if m}
  <div class="pattern">
    <div class="layout">
      <div class="board" style:--n={m.size} class:preview={m.preview} role="grid" aria-label="Board">
        {#each m.cells as cell, i (i)}
          <button type="button" class="cell" class:cursor={cell.cursor} class:correct={cell.correct} class:filled={!!cell.piece}
            onmousedown={(e) => { e.preventDefault(); session.pointer({ kind: 'cell', index: i, button: e.button === 2 ? 2 : 0 }, e); }}
            onmouseup={(e) => { if (drag >= 0 && e.button === 0 && !cell.piece) session.pointer({ kind: 'cell', index: i, button: 0 }, e); drag = -1; }}
            oncontextmenu={(e) => e.preventDefault()} aria-label="Cell {i + 1}">
            {#if cell.piece}{@render glyph(cell.piece)}{/if}
            {#if cell.correct}<span class="mark">✓</span>{/if}
          </button>
        {/each}
      </div>
      <div class="side">
        {#if m.preview}
          <span class="cx-eyebrow">Memorise</span>
          <span class="countdown"><span style:transform="scaleX({m.previewLeft})"></span></span>
        {:else}
          <span class="cx-eyebrow">Pieces</span>
          <div class="tray">
            {#each m.tray as piece, i (piece.glyph)}
              <button type="button" class="piece" class:selected={piece.selected}
                onmousedown={(e) => { session.pointer({ kind: 'tray', index: i }, e); drag = i; }} aria-label="Piece {piece.glyph}">
                {@render glyph(piece)}
              </button>
            {:else}
              <span class="empty">All placed</span>
            {/each}
          </div>
          <span class="left cx-display" class:low={m.left <= 1}>Attempts {m.left}/{m.submissions}</span>
          <ActionButton action="alt" label="Submit" onpress={(e) => session.pointer({ kind: 'select', index: -1 }, e)} />
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .layout { display: grid; grid-template-columns: auto 1fr; gap: calc(18 * var(--u)); align-items: start; }
  .board {
    --cell: calc(min(64, 300 / var(--n)) * var(--u));
    display: grid; grid-template-columns: repeat(var(--n), var(--cell)); gap: calc(5 * var(--u));
  }
  .cell { position: relative; width: var(--cell); height: var(--cell); border-radius: var(--r-sm); background: var(--wash); display: grid; place-items: center; }
  .cell.cursor { box-shadow: inset 0 0 0 calc(3 * var(--u)) var(--accent); }
  .preview .cell.filled { background: var(--paper); }
  .preview .cell.filled .glyph { fill: var(--ink); }
  .glyph { width: 76%; height: 76%; fill: var(--paper); }
  .mark { position: absolute; top: calc(2 * var(--u)); right: calc(4 * var(--u)); color: var(--accent); font: 800 italic calc(14 * var(--u)) / 1 var(--display); }
  .side { display: grid; gap: calc(10 * var(--u)); align-content: start; }
  .countdown { height: calc(6 * var(--u)); border-radius: calc(3 * var(--u)); background: var(--rule); overflow: hidden; }
  .countdown span { display: block; height: 100%; background: var(--paper); transform-origin: 0 50%; }
  .tray { display: flex; flex-wrap: wrap; gap: calc(6 * var(--u)); }
  .piece { width: calc(52 * var(--u)); height: calc(52 * var(--u)); border-radius: var(--r-sm); background: var(--wash); display: grid; place-items: center; }
  .piece.selected { background: var(--paper); }
  .piece.selected .glyph { fill: var(--ink); }
  .empty { font: calc(13 * var(--u)) / 1 var(--body); color: var(--muted); }
  .left { font-size: calc(17 * var(--u)); }
  .left.low { color: var(--warning); }
</style>
