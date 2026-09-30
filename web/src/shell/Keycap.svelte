<script lang="ts">
  import { glyph } from '../core/input';
  import type { Action } from '../core/types';
  import { session } from '../session.svelte';

  let { action, label = undefined, pressed = false }: { action?: Action; label?: string; pressed?: boolean } = $props();
  const text = $derived(label ?? (action ? glyph(session.device, session.keymap, action) : ''));
</script>

<span class="cx-keycap" class:pad={session.device === 'pad'} class:pressed>{text}</span>

<style>
  .cx-keycap { font-size: calc(14 * var(--u)); min-width: calc(24 * var(--u)); height: calc(24 * var(--u)); }
  /* Pad glyphs read as buttons, not keys: same keycap, rounder, still ink on paper. */
  .pad { border-radius: calc(12 * var(--u)); }
  .pressed { transform: translateY(calc(2 * var(--u))); box-shadow: none; background: var(--ink); color: var(--paper); }
</style>
