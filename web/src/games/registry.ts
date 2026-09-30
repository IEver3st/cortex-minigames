// The game registry. The session runtime looks games up here and nowhere else; adding a game is
// one import and one entry. Order is the catalog order shown to developers.

import type { GameDef } from '../core/game';
import { circuitRoute } from './circuit_route/logic';
import { mash } from './mash/logic';
import { patternRebuild } from './pattern_rebuild/logic';
import { pinTension } from './pin_tension/logic';
import { pressure } from './pressure/logic';
import { pulseSync } from './pulse_sync/logic';
import { qte } from './qte/logic';
import { sequence } from './sequence/logic';
import { signalLock } from './signal_lock/logic';
import { timing } from './timing/logic';
import { traceSweep } from './trace/logic';
import { tracePath } from './trace_path/logic';
import { waveMatch } from './wave_match/logic';

// Each def keeps its own param/state types; the registry erases them behind the shared contract.
export const GAMES = [
  timing, sequence, pressure, signalLock, circuitRoute, pinTension, waveMatch, tracePath, patternRebuild, pulseSync, mash, traceSweep, qte,
] as unknown as GameDef[];

const byId = new Map(GAMES.map((game) => [game.id, game]));
export const getGame = (id: string): GameDef | undefined => byId.get(id);
