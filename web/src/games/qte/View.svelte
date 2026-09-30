<script lang="ts">
  import Keycap from '../../shell/Keycap.svelte';
  import { session } from '../../session.svelte';
  import type { Action } from '../../core/types';
  import { qtePhase, windowUsed, type QteState } from './logic';

  const VERB = { press: 'Press', hold: 'Hold', release: 'Hold, then release in the zone', alternate: 'Alternate', chord: 'Together', react: 'Wait for it', tap: 'Tap' } as const;

  const m = $derived.by(() => {
    const s = session.view.s as QteState | null;
    if (!s || !s.run) return null;
    const t = session.view.t;
    const run = s.run;
    const def = run.def;
    const phase = qtePhase(s, t);
    const holding = run.holdStart !== null;
    return {
      def,
      phase,
      used: phase === 'active' ? windowUsed(s, t) : 0,
      holdProgress: def.type === 'hold' && holding ? Math.min(1, (t - run.holdStart!) / (def.durationMs ?? 1000)) : 0,
      sweep: def.type === 'release' && holding ? Math.min(1, (t - run.holdStart!) / (def.durationMs ?? 1500)) : 0,
      holding,
      count: run.progress,
      next: def.type === 'alternate' ? (run.lastAction === def.actions[0] ? def.actions[1] : def.actions[0]) : null,
      done: run.done,
      held: new Set(session.engine?.input.held ?? []),
      index: s.index,
      total: s.p.prompts.length,
    };
  });

  const verb = (phase: string, type: keyof typeof VERB) => (type === 'react' ? (phase === 'active' ? 'Now' : 'Wait for it') : VERB[type]);
</script>

{#if m}
  <div class="qte" data-phase={m.phase}>
    <div class="keys">
      {#each m.def.actions as action (action)}
        <button type="button" class="key" class:next={m.next === action}
          onpointerdown={(e) => { if (e.button === 0) session.hold(action as Action, true, e); }}
          onpointerup={(e) => session.hold(action as Action, false, e)}
          onpointerleave={(e) => { if (m.held.has(action as Action)) session.hold(action as Action, false, e); }}
          aria-label={action}>
          <Keycap action={action as Action} pressed={m.held.has(action as Action)} />
        </button>
        {#if m.def.type === 'chord' && action !== m.def.actions[m.def.actions.length - 1]}<span class="plus cx-display">+</span>{/if}
      {/each}
    </div>
    <span class="verb cx-display" class:now={m.def.type === 'react' && m.phase === 'active'} class:dim={m.phase === 'lead' || m.phase === 'wait'}>
      {verb(m.phase, m.def.type)}{#if m.def.type === 'alternate' || m.def.type === 'tap'}&nbsp;{m.count}/{m.def.count}{/if}
    </span>

    {#if m.def.type === 'release'}
      <span class="bar sweep">
        <span class="zone" style:left="{(m.def.targetStart ?? 0.55) * 100}%" style:width="{(m.def.targetWidth ?? 0.18) * 100}%"></span>
        <span class="cursor" style:left="{m.sweep * 100}%"></span>
      </span>
    {:else if m.def.type === 'hold'}
      <span class="bar"><span class="fill accent" style:transform="scaleX({m.holdProgress})"></span></span>
    {/if}
    {#if m.phase === 'active' && !(m.def.type === 'release' && m.holding)}
      <span class="bar window"><span class="fill" style:transform="scaleX({1 - m.used})"></span></span>
    {/if}
    {#if m.total > 1}
      <span class="chain" aria-label="Prompt {m.index + 1} of {m.total}">
        {#each Array(m.total) as _, i (i)}<span class:done={i < m.index} class:current={i === m.index}>{i < m.index ? '■' : '□'}</span>{/each}
      </span>
    {/if}
  </div>
{/if}

<style>
  .qte { display: grid; justify-items: center; gap: calc(10 * var(--u)); padding: calc(6 * var(--u)) 0; }
  .keys { display: flex; align-items: center; gap: calc(10 * var(--u)); }
  .key :global(.cx-keycap) { min-width: calc(54 * var(--u)); height: calc(54 * var(--u)); font-size: calc(26 * var(--u)); border-radius: var(--r); }
  .key.next :global(.cx-keycap) { box-shadow: 0 0 0 calc(4 * var(--u)) var(--accent); }
  [data-phase='lead'] .keys, [data-phase='wait'] .keys { opacity: 0.55; }
  .plus { font-size: calc(26 * var(--u)); color: var(--muted); }
  .verb { font-size: calc(22 * var(--u)); }
  .verb.dim { color: var(--muted); }
  .verb.now { color: var(--accent); }
  .bar { position: relative; width: calc(300 * var(--u)); height: calc(8 * var(--u)); border-radius: calc(4 * var(--u)); background: var(--rule); overflow: hidden; }
  .bar.window { height: calc(5 * var(--u)); }
  .fill { display: block; height: 100%; background: var(--paper); transform-origin: 0 50%; }
  .fill.accent { background: var(--accent); }
  .sweep { height: calc(18 * var(--u)); overflow: visible; }
  .zone { position: absolute; top: calc(-3 * var(--u)); bottom: calc(-3 * var(--u)); border-radius: calc(3 * var(--u)); box-shadow: inset 0 0 0 calc(3 * var(--u)) var(--paper); }
  .cursor { position: absolute; top: calc(-6 * var(--u)); bottom: calc(-6 * var(--u)); width: calc(6 * var(--u)); margin-left: calc(-3 * var(--u)); border-radius: calc(2 * var(--u)); background: var(--accent); }
  .chain { display: flex; gap: calc(5 * var(--u)); font: calc(14 * var(--u)) / 1 var(--data); color: var(--muted); }
  .chain .done { color: var(--paper); }
  .chain .current { color: var(--accent); }
</style>
