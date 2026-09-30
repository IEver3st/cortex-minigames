<script lang="ts">
  // Developer playground (dev server only). Real session, real engine, real views; only the Lua
  // bridge and world context are mocked. Built as a docked Cortex editor panel.
  import { prepare } from '../core/prepare';
  import { DEFAULT_PREFS, type OpenSpec, type Prefs } from '../core/protocol';
  import { MAX_SEED, randomSeed } from '../core/rng';
  import type { ParamSpec } from '../core/schema';
  import { PRESETS, type Preset } from '../core/types';
  import { GAMES, getGame } from '../games/registry';
  import { session } from '../session.svelte';
  import { toLua } from './lua';
  import { MockLua, type MockResult } from './mockLua';

  const COMPOSITIONS = [
    {
      id: 'electrical', label: 'Electrical repair',
      steps: [
        { game: 'sequence', preset: 'normal', title: 'Identify the fault' },
        { game: 'circuit_route', preset: 'normal', title: 'Reroute the circuit' },
        { game: 'pressure', preset: 'normal', title: 'Stabilise the feed' },
      ],
    },
    {
      id: 'receiver', label: 'Receiver setup',
      steps: [
        { game: 'signal_lock', preset: 'normal', title: 'Tune the receiver' },
        { game: 'wave_match', preset: 'normal', title: 'Match the carrier' },
        { game: 'qte', preset: 'normal', title: 'Confirm', params: { prompts: [{ type: 'release', actions: ['primary'], windowMs: 1200, durationMs: 1400, targetStart: 0.55, targetWidth: 0.2 }] } },
      ],
    },
    {
      id: 'mechanical', label: 'Mechanical bypass',
      steps: [
        { game: 'pin_tension', preset: 'normal', title: 'Set the pins' },
        { game: 'pulse_sync', preset: 'normal', title: 'Sync the tumblers' },
        { game: 'timing', preset: 'normal', title: 'Throw the bolt' },
      ],
    },
    {
      id: 'forced', label: 'Forced entry',
      steps: [
        { game: 'trace', preset: 'normal', title: 'Turn the lock' },
        { game: 'mash', preset: 'normal', title: 'Force the door' },
      ],
    },
  ];

  let prefs = $state<Prefs>({ ...DEFAULT_PREFS });
  let gameId = $state('timing');
  let preset = $state<Preset>('normal');
  let overrides = $state<Record<string, unknown>>({});
  let promptsText = $state('');
  let seed = $state(randomSeed());
  let fixedSeed = $state(false);
  let title = $state('');
  let instruction = $state('');
  let timeoutText = $state('');
  let mode = $state<'default' | 'compact' | 'focused'>('default');
  let anchor = $state<'default' | 'bottom' | 'center'>('default');
  let practice = $state(false);
  let reduced = $state(false);
  let feedbackMs = $state(650);
  let scene = $state<'dark' | 'bright' | 'street'>('street');
  let results = $state<MockResult[]>([]);
  let note = $state('');
  let collapsed = $state(false);
  let composition = $state<{ label: string; index: number; results: MockResult[] } | null>(null);

  const mock = new MockLua((message) => session.receive(message), { ...DEFAULT_PREFS });
  mock.onResult = (result) => {
    results = [result, ...results].slice(0, 12);
    if (composition) advanceComposition(result);
  };

  const def = $derived(getGame(gameId)!);
  const base = $derived(def.presets[preset] as Record<string, unknown>);
  const effectiveParams = $derived.by(() => {
    const merged: Record<string, unknown> = { ...overrides };
    if (gameId === 'qte' && promptsText.trim()) {
      try { merged.prompts = JSON.parse(promptsText); } catch { merged.prompts = '__invalid_json__'; }
    }
    return merged;
  });
  const timeoutMs = $derived(timeoutText.trim() ? Number(timeoutText) : undefined);
  const check = $derived(prepare({ game: gameId, preset, params: effectiveParams, seed, timeoutMs }));

  $effect(() => {
    document.body.dataset.scene = scene;
  });

  function spec(game = gameId, p: Record<string, unknown> = effectiveParams, extra: Partial<OpenSpec> = {}, presetName: string = preset): OpenSpec | null {
    const prepared = prepare({ game, preset: presetName, params: p, seed, timeoutMs: game === gameId ? timeoutMs : undefined });
    if (!prepared.ok) return null;
    return {
      game, preset: presetName, params: prepared.value.params, seed: prepared.value.seed, timeoutMs: prepared.value.timeoutMs, minTimeoutMs: 1000, maxTimeoutMs: 180000,
      title, instruction,
      presentation: { mode: mode === 'default' ? prepared.value.def.presentation : mode, anchor: anchor === 'default' ? (prepared.value.def.presentation === 'compact' ? 'bottom' : 'center') : anchor, scale: 1 },
      practice, feedbackMs, audio: { volume: prefs.volume, muted: prefs.muted }, reducedMotion: reduced, step: null,
      ...extra,
    };
  }

  function start() {
    if (!fixedSeed) seed = randomSeed();
    const s = spec();
    if (!s) { note = 'Fix the configuration first.'; return; }
    const accepted = mock.play(s);
    note = accepted.ok ? '' : `Rejected: ${accepted.reason}`;
  }

  function runComposition(index: number) {
    const comp = COMPOSITIONS[index];
    composition = { label: comp.label, index: 0, results: [] };
    playStep(index, 0);
  }
  let compIndex = 0;
  function playStep(index: number, step: number) {
    compIndex = index;
    const comp = COMPOSITIONS[index];
    const item = comp.steps[step];
    seed = randomSeed();
    const s = spec(item.game, (item as { params?: Record<string, unknown> }).params ?? {}, { title: item.title, step: { index: step + 1, total: comp.steps.length } }, item.preset);
    if (s) mock.play(s);
  }
  function advanceComposition(result: MockResult) {
    if (!composition) return;
    const comp = COMPOSITIONS[compIndex];
    const done = [...composition.results, result];
    // Preview uses the default `stop` policy; the Lua runtime implements continue/retry too.
    if (result.status !== 'success' || done.length >= comp.steps.length) {
      note = `${comp.label}: ${result.status === 'success' ? 'all steps cleared' : `stopped at step ${done.length} (${result.status})`}`;
      composition = null;
      return;
    }
    composition = { ...composition, index: done.length, results: done };
    setTimeout(() => playStep(compIndex, done.length), (spec()?.feedbackMs ?? 650) + 100);
  }

  function setPrefs(next: Partial<Prefs>) {
    prefs = { ...prefs, ...next };
    mock.setPrefs($state.snapshot(prefs) as Prefs);
  }

  const luaCall = $derived.by(() => {
    const options: Record<string, unknown> = { game: gameId, preset };
    if (title) options.title = title;
    if (instruction) options.instruction = instruction;
    if (timeoutMs) options.timeoutMs = timeoutMs;
    if (Object.keys(effectiveParams).length) options.params = effectiveParams;
    if (fixedSeed) options.seed = seed;
    if (mode !== 'default' || anchor !== 'default') options.presentation = { mode: mode === 'default' ? undefined : mode, anchor: anchor === 'default' ? undefined : anchor };
    if (practice) options.practice = 'always';
    return `local result = exports['cortex-minigames']:Play(${toLua(options)})`;
  });

  const numberValue = (key: string) => (overrides[key] ?? base[key]) as number;
  const setParam = (key: string, spec: ParamSpec, raw: unknown) => {
    const next = { ...overrides };
    if (spec.type === 'int' || spec.type === 'number') {
      const n = Number(raw);
      if (raw === '' || Number.isNaN(n)) delete next[key];
      else next[key] = spec.type === 'int' ? Math.round(n) : n;
    } else next[key] = raw;
    overrides = next;
  };
  function pickGame(id: string) {
    gameId = id;
    overrides = {};
    promptsText = '';
  }
</script>

<aside class="panel" class:collapsed>
  <header>
    <span class="brand cx-display">Minigames <span>Lab</span></span>
    <button type="button" class="ghost" onclick={() => (collapsed = !collapsed)}>{collapsed ? 'Open' : 'Hide'}</button>
  </header>
  {#if !collapsed}
    <div class="scroll">
      <section>
        <span class="cx-eyebrow">Game</span>
        <div class="list">
          {#each GAMES as game (game.id)}
            <button type="button" class="row" class:selected={game.id === gameId} onclick={() => pickGame(game.id)}>
              <span class="cx-display">{game.name}</span><span class="id">{game.id}</span>
            </button>
          {/each}
        </div>
      </section>

      <section>
        <span class="cx-eyebrow">Preset</span>
        <div class="seg">
          {#each PRESETS as p (p)}<button type="button" class:on={preset === p} onclick={() => { preset = p; overrides = {}; }}>{p}</button>{/each}
        </div>
      </section>

      <section>
        <span class="cx-eyebrow">Parameters</span>
        {#each Object.entries(def.params) as [key, spec] (gameId + key)}
          <div class="param">
            <span class="key">{key}</span>
            {#if spec.type === 'int' || spec.type === 'number'}
              <input type="number" min={spec.min} max={spec.max} step={spec.type === 'int' ? 1 : 0.01} value={numberValue(key)}
                oninput={(e) => setParam(key, spec, (e.currentTarget as HTMLInputElement).value)} />
              <span class="range">{spec.min}–{spec.max}</span>
            {:else if spec.type === 'bool'}
              {@const value = (overrides[key] ?? base[key]) as boolean}
              <button type="button" class="toggle" class:on={value} onclick={() => setParam(key, spec, !value)}>{value ? 'On' : 'Off'}</button>
            {:else if spec.type === 'enum'}
              <div class="seg small">
                {#each spec.values as option (option)}
                  <button type="button" class:on={(overrides[key] ?? base[key]) === option} onclick={() => setParam(key, spec, option)}>{option}</button>
                {/each}
              </div>
            {:else}
              <textarea rows="5" placeholder={JSON.stringify(base[key])} bind:value={promptsText}></textarea>
            {/if}
          </div>
        {/each}
        {#if !check.ok}
          <p class="error">✕ {check.error.reason}: {check.error.field ? `${check.error.field} ` : ''}{check.error.message}</p>
        {:else}
          <p class="ok">Valid. Timeout {check.value.timeoutMs} ms.</p>
        {/if}
      </section>

      <section>
        <span class="cx-eyebrow">Session</span>
        <div class="param"><span class="key">seed</span><input type="number" min="0" max={MAX_SEED} bind:value={seed} />
          <button type="button" class="toggle" class:on={fixedSeed} onclick={() => (fixedSeed = !fixedSeed)}>{fixedSeed ? 'Fixed' : 'Random'}</button></div>
        <div class="param"><span class="key">timeoutMs</span><input type="text" placeholder="auto" bind:value={timeoutText} /></div>
        <div class="param"><span class="key">title</span><input type="text" maxlength="64" placeholder={def.name} bind:value={title} /></div>
        <div class="param"><span class="key">instruction</span><input type="text" maxlength="140" bind:value={instruction} /></div>
        <div class="param"><span class="key">mode</span><div class="seg small">{#each ['default', 'compact', 'focused'] as v (v)}<button type="button" class:on={mode === v} onclick={() => (mode = v as typeof mode)}>{v}</button>{/each}</div></div>
        <div class="param"><span class="key">anchor</span><div class="seg small">{#each ['default', 'bottom', 'center'] as v (v)}<button type="button" class:on={anchor === v} onclick={() => (anchor = v as typeof anchor)}>{v}</button>{/each}</div></div>
        <div class="param"><span class="key">practice</span><button type="button" class="toggle" class:on={practice} onclick={() => (practice = !practice)}>{practice ? 'Show' : 'Skip'}</button></div>
        <div class="param"><span class="key">feedbackMs</span><input type="number" min="0" max="2000" bind:value={feedbackMs} /></div>
      </section>

      <section>
        <span class="cx-eyebrow">Player preferences</span>
        <div class="param"><span class="key">scale</span><div class="seg small">{#each [0.8, 1, 1.25, 1.5] as v (v)}<button type="button" class:on={prefs.scale === v} onclick={() => setPrefs({ scale: v })}>{v}×</button>{/each}</div></div>
        <div class="param"><span class="key">motion</span><button type="button" class="toggle" class:on={reduced} onclick={() => (reduced = !reduced)}>{reduced ? 'Reduced' : 'Full'}</button></div>
        <div class="param"><span class="key">audio</span><button type="button" class="toggle" class:on={!prefs.muted} onclick={() => setPrefs({ muted: !prefs.muted })}>{prefs.muted ? 'Muted' : 'On'}</button>
          <input type="number" min="0" max="1" step="0.1" value={prefs.volume} oninput={(e) => setPrefs({ volume: Number((e.currentTarget as HTMLInputElement).value) })} /></div>
        <div class="param"><span class="key">scene</span><div class="seg small">{#each ['dark', 'bright', 'street'] as v (v)}<button type="button" class:on={scene === v} onclick={() => (scene = v as typeof scene)}>{v}</button>{/each}</div></div>
      </section>

      <section>
        <span class="cx-eyebrow">Run</span>
        <div class="actions">
          <button type="button" class="primary cx-display" disabled={!check.ok} onclick={start}>Start</button>
          <button type="button" class="ghost" onclick={() => mock.cancel('caller_cancelled')}>Caller cancel</button>
          <button type="button" class="ghost" onclick={() => mock.cancel('player_died')}>Player died</button>
          <button type="button" class="ghost" onclick={() => mock.forceDeadline()}>Hard deadline</button>
          <button type="button" class="ghost" onclick={() => mock.restart()}>Restart resource</button>
        </div>
        <div class="param"><span class="key">bridge</span>
          <button type="button" class="toggle" class:on={mock.faults.dropReady} onclick={() => (mock.faults.dropReady = !mock.faults.dropReady)}>Drop ready</button>
          <button type="button" class="toggle" class:on={mock.faults.rejectComplete} onclick={() => (mock.faults.rejectComplete = !mock.faults.rejectComplete)}>Reject report</button>
        </div>
        <div class="list">
          {#each COMPOSITIONS as comp, i (comp.id)}
            <button type="button" class="row" onclick={() => runComposition(i)}><span class="cx-display">{comp.label}</span><span class="id">sequence preview</span></button>
          {/each}
        </div>
        {#if note}<p class="ok">{note}</p>{/if}
      </section>

      <section>
        <span class="cx-eyebrow">Lua call</span>
        <pre class="code">{luaCall}</pre>
        <button type="button" class="ghost" onclick={() => navigator.clipboard?.writeText(luaCall)}>Copy</button>
      </section>

      <section>
        <span class="cx-eyebrow">Results</span>
        {#each results as result (result.sessionId + result.reason)}
          <pre class="code result" data-status={result.status}>{JSON.stringify(result, null, 2)}</pre>
        {:else}
          <p class="muted">No results yet.</p>
        {/each}
      </section>
    </div>
  {/if}
</aside>

<style>
  :global(body[data-scene='dark']) { background: #1d2430; }
  :global(body[data-scene='bright']) { background: #cfe0ec; }
  :global(body[data-scene='street']) {
    background-color: #6f7478;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='160'%3E%3Crect width='240' height='160' fill='%23707a80'/%3E%3Crect x='0' y='96' width='240' height='64' fill='%23383c40'/%3E%3Crect x='20' y='124' width='40' height='6' fill='%23e8e2c8'/%3E%3Crect x='140' y='124' width='40' height='6' fill='%23e8e2c8'/%3E%3Crect x='14' y='20' width='50' height='76' fill='%23a89c86'/%3E%3Crect x='96' y='6' width='64' height='90' fill='%23c9c3b3'/%3E%3Crect x='176' y='36' width='52' height='60' fill='%23535a60'/%3E%3C/svg%3E");
  }
  .panel {
    position: fixed; top: 0; left: 0; bottom: 0; width: 360px; pointer-events: auto; z-index: 10;
    background: var(--slip-deep); color: var(--paper); display: flex; flex-direction: column; font-size: 13px;
  }
  .panel.collapsed { bottom: auto; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; }
  .brand { font-size: 22px; }
  .brand span { color: var(--accent); }
  .scroll { overflow: auto; padding: 0 14px 20px; display: grid; gap: 16px; }
  section { display: grid; gap: 7px; }
  .list { display: grid; gap: 3px; }
  .row { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 9px; border-radius: 4px; background: var(--wash); }
  .row:hover { background: rgba(240, 240, 233, 0.12); }
  .row.selected { background: var(--paper); color: var(--ink); }
  .row .cx-display { font-size: 16px; }
  .id { font: 12px var(--data); color: var(--muted); }
  .row.selected .id { color: var(--accent-deep); }
  .seg { display: flex; flex-wrap: wrap; gap: 3px; }
  .seg button, .toggle, .ghost { padding: 5px 9px; border-radius: 4px; background: var(--wash); color: var(--muted); font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; }
  .seg button.on, .toggle.on { background: var(--paper); color: var(--ink); }
  .ghost:hover { color: var(--paper); }
  .param { display: flex; align-items: center; gap: 8px; }
  .key { width: 96px; flex: none; font: 12px var(--data); color: var(--muted); }
  .range { font: 11px var(--data); color: var(--dim); }
  input, textarea { flex: 1; min-width: 0; background: rgba(240, 240, 233, 0.08); border: 0; border-radius: 4px; padding: 5px 7px; font: 12px var(--data); color: var(--paper); box-shadow: inset 0 -3px 0 var(--rule-strong); }
  input:focus, textarea:focus { box-shadow: inset 0 -3px 0 var(--accent); }
  .actions { display: flex; flex-wrap: wrap; gap: 5px; }
  .primary { padding: 6px 16px; border-radius: 4px; background: var(--accent); color: var(--ink); font-size: 18px; }
  .primary:disabled { background: var(--wash); color: var(--dim); }
  .error { margin: 0; color: var(--error); font: 12px var(--data); }
  .ok, .muted { margin: 0; color: var(--muted); font: 12px var(--data); }
  .code { margin: 0; padding: 8px; background: rgba(0, 0, 0, 0.35); border-radius: 4px; font: 11px/1.35 var(--data); white-space: pre-wrap; user-select: text; }
  .result[data-status='success'] { box-shadow: inset 4px 0 0 var(--accent); }
  .result[data-status='failed'], .result[data-status='timeout'], .result[data-status='error'] { box-shadow: inset 4px 0 0 var(--error); }
</style>
