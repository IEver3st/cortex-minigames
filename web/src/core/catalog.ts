// The serialisable view of the registry: ids, versions, inputs, schemas, presets and metrics.
// Consumed by Lua (shared/catalog.json) and by ListGames(). Contains no functions.

import { GAMES } from '../games/registry';
import { RNG_VERSION } from './rng';
import { PROMPT_FIELDS, PROMPT_TYPES } from './schema';
import { API_VERSION, PROTOCOL, PRESETS, QTE_ACTIONS, REASONS } from './types';
import { TIMEOUT_BOUNDS } from './prepare';

export function buildCatalog() {
  return {
    apiVersion: API_VERSION,
    protocol: PROTOCOL,
    rngVersion: RNG_VERSION,
    presets: PRESETS,
    timeoutBounds: TIMEOUT_BOUNDS,
    reasons: REASONS,
    qte: { types: PROMPT_TYPES, actions: QTE_ACTIONS, fields: PROMPT_FIELDS },
    games: GAMES.map((game) => ({
      id: game.id,
      version: game.version,
      name: game.name,
      inputs: game.inputs,
      presentation: game.presentation,
      cursor: game.cursor === true,
      minDurationMs: game.minDurationMs,
      params: game.params,
      presets: game.presets,
      defaultTimeoutMs: Object.fromEntries(PRESETS.map((preset) => [preset, game.defaultTimeoutMs(game.presets[preset])])),
      metrics: game.metrics,
    })),
  };
}
