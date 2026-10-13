<script lang="ts">
  import { onMount } from 'svelte';
  import { isNui } from './core/bridge';
  import { session } from './session.svelte';
  import Stage from './shell/Stage.svelte';

  // Idle minigame runtime has no frame loop or active audio. The optional canonical presentation
  // adapter adds its own message listener, observers and five-second readiness recovery timer.
  onMount(() => {
    const listener = (event: MessageEvent) => session.receive(event.data);
    window.addEventListener('message', listener);
    if (isNui()) void session.boot();
    return () => {
      window.removeEventListener('message', listener);
      session.stopBoot();
      session.teardown();
    };
  });
</script>

<Stage />
