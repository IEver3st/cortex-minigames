// Emits shared/catalog.json from the TypeScript registry so Lua validates the exact same schema.
// `bun run build` runs this first; tests fail if the committed catalog drifts from the registry.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from '../src/core/catalog';

const target = fileURLToPath(new URL('../../shared/catalog.json', import.meta.url));
writeFileSync(target, JSON.stringify(buildCatalog(), null, 2) + '\n');
console.log(`catalog written: ${target}`);
