import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Relative base: the NUI loads from nui://cortex-minigames/web/dist/, never from a dev server.
export default defineConfig({
  base: './',
  plugins: [svelte()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome100', sourcemap: false, assetsInlineLimit: 0 },
});
