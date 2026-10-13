// Test preload: lets `bun test` import runes modules (*.svelte.ts) such as the session runtime.
// TypeScript is stripped first, then Svelte compiles the module exactly as Vite would for the client.

import { plugin } from 'bun';
import { compileModule } from 'svelte/compiler';

plugin({
  name: 'svelte-runes-module',
  setup(build) {
    build.onLoad({ filter: /\.svelte\.ts$/ }, async (args) => {
      const ts = await Bun.file(args.path).text();
      const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(ts);
      const out = compileModule(js, { filename: args.path, generate: 'client', dev: false });
      return { contents: out.js.code, loader: 'js' };
    });
  },
});
