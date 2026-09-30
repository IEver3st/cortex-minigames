<script lang="ts">
  import { groupLabel } from '../core/input';
  import type { Hint } from '../core/types';
  import { session } from '../session.svelte';
  import Keycap from './Keycap.svelte';
  import { t } from './labels';

  let { hints, cancel = true }: { hints: Hint[]; cancel?: boolean } = $props();
</script>

<div class="hints" aria-label="Controls">
  {#each hints as hint (hint.label)}
    <span class="hint">
      {#each groupLabel(session.device, session.keymap, hint.actions) as text (text)}<Keycap label={text} />{/each}
      <span class="label">{t(`hint.${hint.label}`, hint.label)}</span>
    </span>
  {/each}
  {#if cancel}
    <span class="hint quiet"><Keycap action="cancel" /><span class="label">{t('ui.cancel', 'Cancel')}</span></span>
  {/if}
</div>

<style>
  .hints { display: flex; flex-wrap: wrap; gap: calc(8 * var(--u)) calc(16 * var(--u)); align-items: center; }
  .hint { display: inline-flex; align-items: center; gap: calc(5 * var(--u)); }
  .label { font: 700 calc(12 * var(--u)) / 1 var(--body); letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .quiet { margin-left: auto; opacity: 0.75; }
</style>
