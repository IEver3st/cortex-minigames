import { mount } from 'svelte';
import App from './App.svelte';
import { isNui } from './core/bridge';
import { startPresentation } from './core/presentation';
import './cortex.css';
import './app.css';

const target = document.getElementById('app');
if (!target) throw new Error('cortex-minigames: #app mount point is missing');
mount(App, { target });
startPresentation();

// Development only: `bun run dev` outside FiveM adds the playground, which replaces the Lua bridge
// with a local mock. Vite drops this branch from production builds.
if (import.meta.env.DEV && !isNui()) {
  const { mountPlayground } = await import('./dev/playground');
  mountPlayground();
}
