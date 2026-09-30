<script lang="ts">
  import { onMount } from 'svelte';
  import { isNui } from './core/bridge';
  import { session } from './session.svelte';
  import Stage from './shell/Stage.svelte';

  // Idle cost: one message listener. No frame loop, timer or audio runs until a session opens.
  onMount(() => {
    const listener = (event: MessageEvent) => session.receive(event.data);
    window.addEventListener('message', listener);
    if (isNui()) void session.boot();
    return () => {
      window.removeEventListener('message', listener);
      session.teardown();
    };
  });
</script>

<Stage />
