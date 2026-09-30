<script lang="ts">
  // Mouse affordance for a keyboard action. Shows the bound key so both paths are taught at once.
  import type { Action } from '../core/types';
  import Keycap from './Keycap.svelte';

  let { action, label, onpress, disabled = false }: { action: Action; label: string; onpress: (event: MouseEvent) => void; disabled?: boolean } = $props();
</script>

<button type="button" class="action cx-display" {disabled} onclick={onpress}>
  <Keycap {action} />{label}
</button>

<style>
  .action {
    display: inline-flex; align-items: center; gap: calc(8 * var(--u));
    padding: calc(6 * var(--u)) calc(12 * var(--u)) calc(6 * var(--u)) calc(6 * var(--u));
    border-radius: var(--r-sm); background: var(--wash); color: var(--paper); font-size: calc(17 * var(--u));
    transition: background 120ms var(--ease), color 120ms var(--ease);
  }
  .action:hover, .action:focus-visible { background: var(--paper); color: var(--ink); }
  .action:active { transform: translateY(calc(1 * var(--u))); }
  .action:disabled { color: var(--dim); cursor: default; background: none; }
</style>
