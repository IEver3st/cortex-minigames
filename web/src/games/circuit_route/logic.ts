// Circuit Routing: rotate components so power reaches every required terminal without touching a
// hazard, then test explicitly. Boards are generated from a solved layout, validated, and scrambled,
// so every board is solvable by construction; power never flows while the player is editing.

import { defineGame } from '../../core/game';
import { toScore } from '../../core/result';
import type { Rng } from '../../core/rng';

export type CircuitParams = {
  cols: number;
  rows: number;
  terminals: number;
  distractors: number;
  hazards: number;
  tests: number;
};

export const N = 1, E = 2, S = 4, W = 8;
const DIRS = [
  { bit: N, dx: 0, dy: -1, opposite: S },
  { bit: E, dx: 1, dy: 0, opposite: W },
  { bit: S, dx: 0, dy: 1, opposite: N },
  { bit: W, dx: -1, dy: 0, opposite: E },
];

export type TileKind = 'empty' | 'wire' | 'source' | 'terminal' | 'hazard';
export type Tile = { kind: TileKind; mask: number; solved: number; fixed: boolean };

export type TestResult = { powered: boolean[]; lit: number[]; shorted: number[]; ok: boolean; at: number };

export type CircuitState = {
  p: CircuitParams;
  cols: number;
  rows: number;
  tiles: Tile[];
  cursor: number;
  rotations: number;
  baseline: number;
  testsUsed: number;
  lastTest: TestResult | null;
  solved: boolean;
  failed: boolean;
  fallback: boolean;
};

export const rotateCw = (mask: number): number => ((mask << 1) | (mask >> 3)) & 15;
export const rotateCcw = (mask: number): number => ((mask >> 1) | ((mask & 1) << 3)) & 15;

/** Minimum presses (either direction) from `mask` to any orientation equal to `target`. */
export function rotationDistance(mask: number, target: number): number {
  let best = 4, m = mask;
  for (let k = 0; k < 4; k++) {
    if (m === target) best = Math.min(best, k, 4 - k);
    m = rotateCw(m);
  }
  return best === 4 ? 0 : best;
}

/** Flood power from the source through mutual connections. Hazards short when any powered tile points into them. */
export function evaluate(cols: number, rows: number, tiles: Tile[], at = 0): TestResult {
  const powered = tiles.map(() => false);
  const source = tiles.findIndex((tile) => tile.kind === 'source');
  const stack = [source];
  powered[source] = true;
  const shorted = new Set<number>();
  while (stack.length) {
    const index = stack.pop()!;
    const x = index % cols, y = Math.floor(index / cols);
    for (const dir of DIRS) {
      if (!(tiles[index].mask & dir.bit)) continue;
      const nx = x + dir.dx, ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const next = ny * cols + nx;
      const tile = tiles[next];
      if (tile.kind === 'hazard') { shorted.add(next); continue; }
      if (powered[next] || !(tile.mask & dir.opposite)) continue;
      powered[next] = true;
      if (tile.kind !== 'terminal') stack.push(next);
    }
  }
  const terminals = tiles.flatMap((tile, index) => (tile.kind === 'terminal' ? [index] : []));
  const lit = terminals.filter((index) => powered[index]);
  return { powered, lit, shorted: [...shorted], ok: lit.length === terminals.length && shorted.size === 0, at };
}

/** Terminal cells: the far three edges, clear of the source column. */
function terminalEdge(cols: number, rows: number): number[] {
  const edge: number[] = [];
  for (let y = 0; y < rows; y++) edge.push(y * cols + cols - 1);
  for (let x = 2; x < cols - 1; x++) { edge.push(x); edge.push((rows - 1) * cols + x); }
  return edge;
}

/** Terminals are spread apart: more than two steps between any two, so never adjacent. */
const spaced = (cols: number, a: number, b: number): boolean =>
  Math.abs((a % cols) - (b % cols)) + Math.abs(Math.floor(a / cols) - Math.floor(b / cols)) > 2;

/** Every placement of `count` spaced terminals on the edge (at most C(14, 3) sets, so enumerable). */
export function terminalSets(cols: number, rows: number, count: number): number[][] {
  const edge = terminalEdge(cols, rows);
  const out: number[][] = [];
  const pick = (from: number, chosen: number[]) => {
    if (chosen.length === count) { out.push([...chosen]); return; }
    for (let i = from; i < edge.length; i++) {
      if (chosen.every((other) => spaced(cols, other, edge[i]))) pick(i + 1, [...chosen, edge[i]]);
    }
  };
  pick(0, []);
  return out;
}

function generate(p: CircuitParams, rng: Rng): Tile[] | null {
  const { cols, rows } = p;
  const count = cols * rows;
  const index = (x: number, y: number) => y * cols + x;
  const tiles: Tile[] = Array.from({ length: count }, () => ({ kind: 'empty', mask: 0, solved: 0, fixed: true }));

  const sourceY = rng.int(0, rows - 1);
  const source = index(0, sourceY);
  // Terminals sit on the far three edges, spread apart, never adjacent to each other or the source column.
  const edge = rng.shuffle(terminalEdge(cols, rows));
  let terminals: number[] = [];
  for (const cell of edge) {
    if (terminals.length >= p.terminals) break;
    if (terminals.every((other) => spaced(cols, other, cell))) terminals.push(cell);
  }
  // A greedy pass can paint itself into a corner on tight boards; then pick from every valid placement.
  if (terminals.length < p.terminals) {
    const sets = terminalSets(cols, rows, p.terminals);
    if (!sets.length) return null;
    terminals = rng.pick(sets);
  }

  // Randomised DFS spanning tree over the grid; the solved wiring is the union of tree paths
  // from the source to each terminal. Terminals are leaves, so paths never pass through them.
  const parent = new Array<number>(count).fill(-1);
  const seen = new Array<boolean>(count).fill(false);
  const stack = [source];
  seen[source] = true;
  const blocked = new Set(terminals);
  while (stack.length) {
    const cell = stack[stack.length - 1];
    const x = cell % cols, y = Math.floor(cell / cols);
    const options = DIRS.map((d) => ({ nx: x + d.dx, ny: y + d.dy }))
      .filter(({ nx, ny }) => nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[index(nx, ny)]);
    if (!options.length || (blocked.has(cell) && cell !== source)) { stack.pop(); continue; }
    const { nx, ny } = rng.pick(options);
    const next = index(nx, ny);
    seen[next] = true;
    parent[next] = cell;
    stack.push(next);
  }
  const onPath = new Set<number>();
  for (const terminal of terminals) {
    if (!seen[terminal]) return null;
    let cell = terminal;
    while (cell !== source) {
      const up = parent[cell];
      if (up < 0) return null;
      const x = cell % cols, y = Math.floor(cell / cols);
      const ux = up % cols, uy = Math.floor(up / cols);
      const dir = DIRS.find((d) => x + d.dx === ux && y + d.dy === uy)!;
      tiles[cell].solved |= dir.bit;
      tiles[up].solved |= dir.opposite;
      onPath.add(cell);
      onPath.add(up);
      cell = up;
    }
  }
  for (const cell of onPath) {
    const tile = tiles[cell];
    tile.kind = cell === source ? 'source' : blocked.has(cell) ? 'terminal' : 'wire';
    tile.fixed = tile.kind !== 'wire' || tile.solved === 15;
  }

  // Hazards and distractors fill cells the solution never touches. Union tiles only point along
  // their own path edges, so neither can be powered or shorted in the solved layout.
  const free = rng.shuffle([...Array(count).keys()].filter((cell) => !onPath.has(cell)));
  for (let i = 0; i < p.hazards && free.length; i++) {
    const cell = free.pop()!;
    tiles[cell] = { kind: 'hazard', mask: 15, solved: 15, fixed: true };
  }
  const shapes = [N | S, N | E, N | E | S, N | E];
  const distractorCount = Math.round(free.length * p.distractors);
  for (let i = 0; i < distractorCount; i++) {
    const cell = free.pop()!;
    const shape = rng.pick(shapes);
    tiles[cell] = { kind: 'wire', mask: shape, solved: shape, fixed: false };
  }
  for (const tile of tiles) tile.mask = tile.solved;
  return evaluate(cols, rows, tiles).ok ? tiles : null;
}

/** Hand-verified board used only if seeded generation exhausts its retry budget. */
function fallbackBoard(): { cols: number; rows: number; tiles: Tile[] } {
  const w = (solved: number, kind: TileKind = 'wire'): Tile => ({ kind, mask: solved, solved, fixed: kind !== 'wire' });
  const e = (): Tile => ({ kind: 'empty', mask: 0, solved: 0, fixed: true });
  const tiles = [
    e(), w(E | S), w(E | W), w(W, 'terminal'),
    w(E, 'source'), w(N | W | S), e(), e(),
    e(), w(N | E), w(E | W), w(W, 'terminal'),
  ];
  return { cols: 4, rows: 3, tiles };
}

function scramble(tiles: Tile[], rng: Rng): void {
  const movable = tiles.filter((tile) => !tile.fixed);
  for (const tile of movable) {
    let turns = rng.int(1, 3);
    while (turns-- > 0) tile.mask = rotateCw(tile.mask);
  }
  // Symmetric pieces (straights) can land back on a solved orientation; make sure most do not.
  const wrong = movable.filter((tile) => tile.mask !== tile.solved);
  if (wrong.length < Math.ceil(movable.length * 0.6)) {
    for (const tile of movable) if (tile.mask === tile.solved) tile.mask = rotateCw(tile.mask);
  }
}

function scrambleUnsolved(cols: number, rows: number, tiles: Tile[], rng: Rng): void {
  scramble(tiles, rng);
  const movable = tiles.filter((tile) => !tile.fixed);
  // An alternative layout can occasionally already satisfy the board; never hand over a solved puzzle.
  for (let guard = 0; guard < 16 && movable.length && evaluate(cols, rows, tiles).ok; guard++) {
    const tile = rng.pick(movable);
    tile.mask = rotateCw(tile.mask);
  }
}

export const circuitRoute = defineGame<CircuitParams, CircuitState>({
  id: 'circuit_route',
  version: 1,
  name: 'Circuit Routing',
  inputs: ['keyboard', 'mouse', 'controller'],
  presentation: 'focused',
  params: {
    cols: { type: 'int', min: 4, max: 7 },
    rows: { type: 'int', min: 3, max: 6 },
    terminals: { type: 'int', min: 1, max: 3 },
    distractors: { type: 'number', min: 0, max: 1 },
    hazards: { type: 'int', min: 0, max: 3 },
    tests: { type: 'int', min: 1, max: 5 },
  },
  presets: {
    easy: { cols: 4, rows: 3, terminals: 1, distractors: 0.3, hazards: 0, tests: 4 },
    normal: { cols: 5, rows: 4, terminals: 2, distractors: 0.4, hazards: 1, tests: 3 },
    hard: { cols: 6, rows: 4, terminals: 2, distractors: 0.6, hazards: 2, tests: 2 },
    expert: { cols: 7, rows: 5, terminals: 3, distractors: 0.7, hazards: 3, tests: 2 },
  },
  metrics: { testsUsed: 'number', rotations: 'number', baselineRotations: 'number', efficiency: 'number', fallback: 'boolean' },
  hints: [
    { actions: ['up', 'down', 'left', 'right'], label: 'Select' },
    { actions: ['next'], label: 'Rotate' },
    { actions: ['primary'], label: 'Test' },
  ],
  tutorial: 'Rotate parts so power runs from the source to every terminal. Keep clear of hazards, then test.',
  minDurationMs: 1200,
  defaultTimeoutMs: (p) => Math.round(9000 + p.cols * p.rows * 900),
  check(p, timeoutMs) {
    if (!terminalSets(p.cols, p.rows, p.terminals).length) return 'too_many_terminals';
    if (timeoutMs < p.cols * p.rows * 300) return 'time_budget_too_short';
    return null;
  },
  create(p, rng) {
    let tiles: Tile[] | null = null;
    let cols = p.cols, rows = p.rows, fallback = false;
    for (let attempt = 0; attempt < 24 && !tiles; attempt++) tiles = generate(p, rng.fork(attempt));
    if (!tiles) {
      const board = fallbackBoard();
      ({ cols, rows, tiles } = board);
      fallback = true;
    }
    scrambleUnsolved(cols, rows, tiles, rng.fork(99));
    const baseline = tiles.reduce((sum, tile) => sum + (tile.fixed ? 0 : rotationDistance(tile.mask, tile.solved)), 0);
    const start = tiles.findIndex((tile) => tile.kind === 'source');
    return {
      p, cols, rows, tiles, cursor: start + 1 < tiles.length ? start + 1 : start, rotations: 0, baseline,
      testsUsed: 0, lastTest: null, solved: false, failed: false, fallback,
    };
  },
  press(s, action, t) {
    if (s.solved || s.failed) return;
    const x = s.cursor % s.cols, y = Math.floor(s.cursor / s.cols);
    if (action === 'up' && y > 0) s.cursor -= s.cols;
    else if (action === 'down' && y < s.rows - 1) s.cursor += s.cols;
    else if (action === 'left' && x > 0) s.cursor -= 1;
    else if (action === 'right' && x < s.cols - 1) s.cursor += 1;
    else if (action === 'next' || action === 'rotate' || action === 'prev') rotate(s, action === 'prev' ? -1 : 1);
    else if (action === 'primary') test(s, t);
  },
  pointer(s, event, t) {
    if (s.solved || s.failed) return;
    if (event.kind === 'cell' && event.index >= 0 && event.index < s.tiles.length) {
      s.cursor = event.index;
      rotate(s, event.button === 2 ? -1 : 1);
    }
    if (event.kind === 'select' && event.index === -1) test(s, t);
  },
  outcome(s) {
    if (s.solved) return { status: 'success', reason: 'completed' };
    if (s.failed) return { status: 'failed', reason: 'tests_exhausted' };
    return null;
  },
  report(s) {
    const efficiency = s.solved ? Math.min(1, s.baseline / Math.max(1, s.rotations, s.baseline)) : 0;
    const testFactor = 1 - Math.max(0, s.testsUsed - 1) / s.p.tests;
    return {
      score: s.solved ? toScore(0.6 * efficiency + 0.4 * testFactor) : 0,
      mistakes: Math.max(0, s.testsUsed - (s.solved ? 1 : 0)),
      metrics: { testsUsed: s.testsUsed, rotations: s.rotations, baselineRotations: s.baseline, efficiency, fallback: s.fallback },
    };
  },
});

function rotate(s: CircuitState, dir: 1 | -1): void {
  const tile = s.tiles[s.cursor];
  if (tile.fixed) return;
  tile.mask = dir === 1 ? rotateCw(tile.mask) : rotateCcw(tile.mask);
  s.rotations++;
  s.lastTest = null; // stale power overlays never linger over an edited board
}

function test(s: CircuitState, t: number): void {
  s.testsUsed++;
  s.lastTest = evaluate(s.cols, s.rows, s.tiles, t);
  if (s.lastTest.ok) s.solved = true;
  else if (s.testsUsed >= s.p.tests) s.failed = true;
}
