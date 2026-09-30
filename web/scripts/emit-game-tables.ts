// Prints the parameter and preset tables used in docs/games.md, straight from the registry.
import { GAMES } from '../src/games/registry';
import { PRESETS } from '../src/core/types';

for (const game of GAMES) {
  const lines: string[] = [`<!-- tables:${game.id} -->`, '', '| Param | Range | ' + PRESETS.join(' | ') + ' |', '| --- | --- |' + PRESETS.map(() => ' --- |').join('')];
  for (const [key, spec] of Object.entries(game.params)) {
    const range = spec.type === 'int' || spec.type === 'number' ? `${spec.min}–${spec.max}` : spec.type === 'enum' ? spec.values.join(' / ') : spec.type === 'bool' ? 'true / false' : `list ≤ ${spec.maxItems}`;
    const cells = PRESETS.map((p) => {
      const v = (game.presets[p] as Record<string, unknown>)[key];
      return Array.isArray(v) ? `${v.length} prompt${v.length > 1 ? 's' : ''}` : String(v);
    });
    lines.push(`| \`${key}\` | ${range} | ${cells.join(' | ')} |`);
  }
  lines.push(`| default timeout | | ${PRESETS.map((p) => `${game.defaultTimeoutMs(game.presets[p])} ms`).join(' | ')} |`);
  lines.push('', `Metrics: ${Object.keys(game.metrics).map((m) => `\`${m}\``).join(', ')}. Minimum plausible success: ${game.minDurationMs} ms.`, '');
  console.log(lines.join('\n'));
}
