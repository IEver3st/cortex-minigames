<script lang="ts">
  import { getGame } from '../games/registry';
  import { VIEWS } from '../games/views';
  import { session, CUE_MS } from '../session.svelte';
  import Hints from './Hints.svelte';
  import Keycap from './Keycap.svelte';
  import { gradeWord, headline as headlineFor, reasonText, t } from './labels';

  const spec = $derived(session.spec);
  const def = $derived(spec ? getGame(spec.game) : undefined);
  const name = $derived(def ? t(`game.${def.id}.name`, def.name) : '');
  const systemReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const View = $derived(spec ? VIEWS[spec.game] : undefined);
  const mode = $derived(spec?.presentation.mode ?? def?.presentation ?? 'compact');
  const anchor = $derived(spec?.presentation.anchor ?? (mode === 'compact' ? 'bottom' : 'center'));
  const scale = $derived((spec?.presentation.scale ?? 1) * session.prefs.scale);
  const reduced = $derived((spec?.reducedMotion ?? false) || (session.prefs.motion === 'auto' && systemReduced));
  const visible = $derived(session.phase !== 'idle' && session.phase !== 'preparing' && !!spec && !!def);
  const remaining = $derived(spec && session.phase === 'playing' ? Math.max(0, 1 - session.view.t / (spec.timeoutMs ?? 1)) : 1);
  const title = $derived(spec?.title || name);
  const feedback = $derived(session.feedback);
  const headline = $derived(feedback ? (feedback.status === 'success' && feedback.grade ? gradeWord(feedback.grade) : headlineFor(feedback.status)) : '');
  const interactive = $derived(session.phase === 'practice' || session.phase === 'cue' || session.phase === 'playing');
</script>

{#if visible && def && spec}
  <div class="anchor {anchor}" style:--scale={scale}>
    <section class="slip {mode}" class:cx-interactive={interactive} class:reduced data-phase={session.phase} aria-live="polite">
      <header>
        <div class="heading">
          {#if spec.step || (spec.title && spec.title !== name)}
            <span class="cx-eyebrow">{spec.title && spec.title !== name ? name : ''}{#if spec.step}{spec.title && spec.title !== name ? ' · ' : ''}{t('ui.step', 'Step')} {spec.step.index}/{spec.step.total}{/if}</span>
          {/if}
          <h1 class="cx-display">{title}</h1>
          {#if spec.instruction}<p class="instruction">{spec.instruction}</p>{/if}
        </div>
        {#if session.mistakes > 0 && session.phase === 'playing'}
          {#key session.flash}<span class="mistakes cx-display" aria-label={t('ui.mistakes', 'Mistakes')}>✕&nbsp;{session.mistakes}</span>{/key}
        {/if}
      </header>

      <div class="clock" aria-hidden="true">
        <span class="fill" class:low={remaining < 0.3} class:critical={remaining < 0.15} style:transform="scaleX({remaining})"></span>
      </div>

      <div class="mechanic">
        <!-- A run that faulted before it was built has no state to draw; only its error banner shows. -->
        {#if View && session.view.s}<View />{/if}

        {#if session.phase === 'practice'}
          <div class="overlay practice" role="button" tabindex="-1" onclick={() => session.tap('primary')} onkeydown={() => {}}>
            <span class="cx-eyebrow">{t('ui.howItWorks', 'How it works')}</span>
            <p>{t(`game.${def.id}.tutorial`, def.tutorial)}</p>
            <span class="go"><Keycap action="primary" />{t('ui.pressToStart', 'to start')}</span>
          </div>
        {:else if session.phase === 'cue' || session.phase === 'waiting'}
          <div class="overlay cue" style:--cue="{CUE_MS}ms">
            <span class="bar"></span><span class="cx-display">{t('ui.ready', 'Ready')}</span>
          </div>
        {:else if session.phase === 'feedback' && feedback}
          <div class="overlay result" data-status={feedback.status}>
            <span class="tag cx-display">
              <span class="state">{headline}</span>{#if feedback.score !== null && feedback.status === 'success'}<span class="value">{feedback.score}</span>{/if}
            </span>
            {#if reasonText(feedback.reason) && feedback.status !== 'success'}<span class="why">{reasonText(feedback.reason)}</span>{/if}
          </div>
        {/if}
      </div>

      <footer><Hints hints={def.hints} /></footer>
    </section>
  </div>
{/if}

<style>
  .anchor {
    position: fixed;
    left: 50%;
    pointer-events: none;
    transform: translateX(-50%) scale(var(--scale));
    transform-origin: 50% 100%;
  }
  .anchor.bottom { bottom: calc(150 * var(--u)); }
  .anchor.center { top: 50%; transform: translate(-50%, -50%) scale(var(--scale)); transform-origin: 50% 50%; }

  .slip {
    background: var(--slip);
    border-radius: var(--r);
    color: var(--paper);
    padding: calc(16 * var(--u)) calc(20 * var(--u)) calc(14 * var(--u));
    display: grid;
    gap: calc(12 * var(--u));
    animation: rise 260ms var(--ease) both;
  }
  .compact { width: calc(480 * var(--u)); }
  /* Spatial puzzles hold attention longer; the deeper slip keeps them legible over busy scenes. */
  .focused { width: calc(660 * var(--u)); background: var(--slip-deep); }
  .reduced { animation: none; }

  header { display: flex; align-items: flex-start; justify-content: space-between; gap: calc(12 * var(--u)); }
  .heading { display: grid; gap: calc(5 * var(--u)); min-width: 0; }
  h1 { margin: 0; font-size: calc(28 * var(--u)); line-height: 0.95; letter-spacing: 0.01em; overflow-wrap: anywhere; }
  .instruction { margin: 0; font: calc(14 * var(--u)) / 1.3 var(--body); color: var(--muted); }
  .mistakes { color: var(--warning); font-size: calc(20 * var(--u)); animation: nudge 220ms var(--ease); white-space: nowrap; }
  .reduced .mistakes { animation: none; }

  .clock { height: calc(4 * var(--u)); border-radius: calc(2 * var(--u)); background: var(--rule); overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--paper); transform-origin: 0 50%; }
  .fill.low { background: var(--warning); }
  .fill.critical { background: var(--error); }

  .mechanic { position: relative; min-height: calc(64 * var(--u)); }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: calc(8 * var(--u));
    background: var(--slip-deep);
    border-radius: var(--r-sm);
    text-align: center;
    padding: calc(8 * var(--u));
  }
  .practice p { margin: 0; max-width: calc(440 * var(--u)); font: calc(15 * var(--u)) / 1.35 var(--body); }
  .go {
    display: inline-flex; gap: calc(6 * var(--u)); align-items: center;
    font: 700 calc(12 * var(--u)) / 1 var(--body); letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted);
  }
  .cue .cx-display { font-size: calc(34 * var(--u)); }
  .cue .bar { width: calc(56 * var(--u)); height: calc(5 * var(--u)); background: var(--accent); transform-origin: 0 50%; animation: wipe var(--cue) linear both; }
  .reduced .cue .bar { animation: none; }

  .tag { display: inline-flex; font-size: calc(24 * var(--u)); border-radius: var(--r-sm); overflow: hidden; }
  .tag .state { background: var(--accent); color: var(--ink); padding: calc(4 * var(--u)) calc(12 * var(--u)); }
  .tag .value { background: var(--paper); color: var(--ink); padding: calc(4 * var(--u)) calc(12 * var(--u)); }
  [data-status='failed'] .tag .state,
  [data-status='timeout'] .tag .state,
  [data-status='error'] .tag .state { background: var(--error); }
  [data-status='cancelled'] .tag .state,
  [data-status='rejected'] .tag .state { background: var(--muted); }
  .why { font: calc(14 * var(--u)) / 1.2 var(--body); color: var(--muted); }

  @keyframes rise { from { opacity: 0; transform: translateY(calc(6 * var(--u))); } to { opacity: 1; transform: none; } }
  @keyframes wipe { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes nudge { from { transform: translateX(calc(-3 * var(--u))); } to { transform: none; } }
</style>
