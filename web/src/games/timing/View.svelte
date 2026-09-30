<script lang="ts">
  import { session } from '../../session.svelte';
  import { flipWarning, position, type TimingState } from './logic';

  // Render model: rebuilt each frame from engine state, so every value below is fresh.
  const m = $derived.by(() => {
    const s = session.view.s as TimingState | null;
    if (!s) return null;
    const t = session.view.t;
    const round = s.rounds[s.current];
    const live = t >= round.start && !round.judged;
    const pos = position(s, Math.max(t, round.start));
    const ahead = position(s, Math.max(t, round.start) + 12);
    const dir = s.p.variant === 'circular' ? (ahead >= pos || pos - ahead > 0.5 ? 1 : -1) : ahead >= pos ? 1 : -1;
    return {
      variant: s.p.variant,
      a: round.a,
      w: s.p.window,
      perfect: s.p.perfect,
      pos,
      dir,
      live,
      warn: flipWarning(s, t),
      rounds: Array.from({ length: s.p.rounds }, (_, i) => {
        const judged = s.rounds.filter((r) => r.judged && r.judged.hit).length;
        return i < judged ? 'hit' : 'pending';
      }),
      misses: s.misses,
    };
  });

  const W = 440, X0 = 10;
  const arc = (from: number, to: number, r: number) => {
    const p = (f: number) => [80 + r * Math.sin(f * Math.PI * 2), 80 - r * Math.cos(f * Math.PI * 2)];
    const [x1, y1] = p(from), [x2, y2] = p(to);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${x2} ${y2}`;
  };
</script>

{#if m}
  <div class="timing" role="presentation" onpointerdown={(e) => { if (e.button === 0) session.tap('primary', e); }}>
    {#if m.variant === 'linear'}
      <svg viewBox="0 0 460 64" class="linear" aria-hidden="true">
        <rect x={X0} y="26" width={W} height="12" rx="6" class="track" />
        <rect x={X0 + m.a * W} y="20" width={m.w * W} height="24" rx="4" class="window" />
        <rect x={X0 + (m.a + m.w / 2 - (m.w * m.perfect) / 2) * W} y="20" width={Math.max(4, m.w * m.perfect * W)} height="24" class="notch" />
        <g transform="translate({X0 + m.pos * W} 0)" class:dim={!m.live}>
          <rect x="-4" y="8" width="8" height="48" rx="3" class="marker" />
          <path d={m.dir > 0 ? 'M 8 4 L 16 10 L 8 16 Z' : 'M -8 4 L -16 10 L -8 16 Z'} class="arrow" class:warn={m.warn} />
        </g>
      </svg>
    {:else}
      <svg viewBox="0 0 160 160" class="circular" aria-hidden="true">
        <circle cx="80" cy="80" r="60" class="ring" />
        <path d={arc(m.a, m.a + m.w, 60)} class="window-arc" />
        <path d={arc(m.a + m.w / 2 - (m.w * m.perfect) / 2, m.a + m.w / 2 + (m.w * m.perfect) / 2 + 0.002, 60)} class="notch-arc" />
        <g transform="rotate({m.pos * 360} 80 80)" class:dim={!m.live}>
          <rect x="76" y="8" width="8" height="30" rx="3" class="marker" />
          <path d={m.dir > 0 ? 'M 90 12 L 98 18 L 90 24 Z' : 'M 70 12 L 62 18 L 70 24 Z'} class="arrow" class:warn={m.warn} />
        </g>
      </svg>
    {/if}
    {#if m.rounds.length > 1 || m.misses > 0}
      <div class="rounds" aria-label="Rounds">
        {#each m.rounds as state, i (i)}<span class="pip" class:hit={state === 'hit'}>{state === 'hit' ? '■' : '□'}</span>{/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .timing { display: grid; justify-items: center; gap: calc(6 * var(--u)); cursor: pointer; }
  .linear { width: 100%; height: auto; }
  .circular { width: calc(190 * var(--u)); height: auto; }
  .track { fill: var(--rule-strong); }
  .window { fill: var(--paper); }
  .notch { fill: var(--ink); }
  .ring { fill: none; stroke: var(--rule-strong); stroke-width: 10; }
  .window-arc { fill: none; stroke: var(--paper); stroke-width: 16; }
  .notch-arc { fill: none; stroke: var(--ink); stroke-width: 16; }
  .marker { fill: var(--accent); stroke: var(--ink); stroke-width: 2; }
  .arrow { fill: var(--muted); }
  .arrow.warn { fill: var(--warning); }
  .dim { opacity: 0.45; }
  .rounds { display: flex; gap: calc(6 * var(--u)); font: calc(16 * var(--u)) / 1 var(--data); color: var(--muted); }
  .pip.hit { color: var(--paper); }
</style>
