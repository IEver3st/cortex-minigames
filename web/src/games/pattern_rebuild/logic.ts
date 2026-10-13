// Pattern Rebuild: a spatial arrangement of distinct pieces is revealed briefly, then rebuilt on
// discrete cells. Every glyph is unique and has no rotational symmetry, so each target has exactly
// one correct placement and orientation per piece: nothing is ambiguous to judge.

import { defineGame } from '../../core/game';
import { toScore } from '../../core/result';

export type PatternParams = {
  size: number;
  pieces: number;
  previewMs: number;
  rotation: boolean;
  submissions: number;
};

/**
 * Polyomino glyphs on a 3×3 grid. None has rotational symmetry and no glyph is a rotation of
 * another (mirror pairs such as ell/jay are distinct because rotation never mirrors). Tested.
 */
export const GLYPHS: Record<string, [number, number][]> = {
  ell: [[0, 0], [0, 1], [0, 2], [1, 2]],
  jay: [[1, 0], [1, 1], [1, 2], [0, 2]],
  tee: [[0, 0], [1, 0], [2, 0], [1, 1]],
  pea: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]],
  eff: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
  you: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  vee: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
  wee: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]],
};
export const GLYPH_IDS = Object.keys(GLYPHS);

export type Piece = { glyph: string; rotation: number };
export type Placement = Piece & { cell: number };

export type PatternState = {
  p: PatternParams;
  target: Placement[];
  board: (Piece | null)[];
  tray: Piece[]; // unplaced pieces
  selected: number; // tray index
  cursor: number;
  previewEnd: number;
  submissionsUsed: number;
  marks: null | { correct: number[]; at: number };
  moves: number;
  solved: boolean;
  failed: boolean;
  drag: number | null;
};

export const inPreview = (s: PatternState, t: number): boolean => t < s.previewEnd;

export function correctCells(s: PatternState): number[] {
  return s.target.filter((goal) => {
    const piece = s.board[goal.cell];
    return piece && piece.glyph === goal.glyph && (!s.p.rotation || piece.rotation === goal.rotation);
  }).map((goal) => goal.cell);
}

function isSolved(s: PatternState): boolean {
  const placed = s.board.filter(Boolean).length;
  return placed === s.target.length && correctCells(s).length === s.target.length;
}

export const patternRebuild = defineGame<PatternParams, PatternState>({
  id: 'pattern_rebuild',
  version: 1,
  name: 'Pattern Rebuild',
  inputs: ['keyboard', 'mouse', 'controller'],
  presentation: 'focused',
  params: {
    size: { type: 'int', min: 3, max: 5 },
    pieces: { type: 'int', min: 2, max: 7 },
    previewMs: { type: 'int', min: 1000, max: 8000 },
    rotation: { type: 'bool' },
    submissions: { type: 'int', min: 1, max: 4 },
  },
  presets: {
    easy: { size: 3, pieces: 3, previewMs: 4000, rotation: false, submissions: 3 },
    normal: { size: 4, pieces: 4, previewMs: 3500, rotation: false, submissions: 2 },
    hard: { size: 4, pieces: 5, previewMs: 3500, rotation: true, submissions: 2 },
    expert: { size: 5, pieces: 6, previewMs: 3200, rotation: true, submissions: 1 },
  },
  metrics: { pieces: 'number', submissions: 'number', correctCells: 'number', moves: 'number' },
  hints: [
    { actions: ['up', 'down', 'left', 'right'], label: 'Cell' },
    { actions: ['prev', 'next'], label: 'Piece' },
    { actions: ['rotate'], label: 'Turn' },
    { actions: ['primary'], label: 'Place' },
    { actions: ['alt'], label: 'Submit' },
  ],
  tutorial: 'Memorise where each piece sits and which way it faces, then rebuild the layout and submit.',
  // Input is ignored until the preview ends, at least 1250 ms in.
  minDurationMs: 1200,
  defaultTimeoutMs: (p) => Math.round(p.previewMs + 6000 + p.pieces * 4000 + (p.rotation ? p.pieces * 1500 : 0)),
  check(p, timeoutMs) {
    if (p.pieces >= p.size * p.size) return 'too_many_pieces';
    if (p.pieces > GLYPH_IDS.length) return 'too_many_pieces';
    if (timeoutMs < p.previewMs + p.pieces * 1500) return 'time_budget_too_short';
    return null;
  },
  create(p, rng) {
    const cells = rng.shuffle([...Array(p.size * p.size).keys()]).slice(0, p.pieces);
    const glyphs = rng.shuffle([...GLYPH_IDS]).slice(0, p.pieces);
    const target = cells.map((cell, i) => ({ cell, glyph: glyphs[i], rotation: p.rotation ? rng.int(0, 3) : 0 }));
    const tray = rng.shuffle(target.map((goal) => ({ glyph: goal.glyph, rotation: p.rotation ? rng.int(0, 3) : 0 })));
    return {
      p, target, board: Array(p.size * p.size).fill(null), tray, selected: 0,
      cursor: Math.floor((p.size * p.size) / 2), previewEnd: 250 + p.previewMs, submissionsUsed: 0, marks: null,
      moves: 0, solved: false, failed: false, drag: null,
    };
  },
  press(s, action, t) {
    if (inPreview(s, t) || s.solved || s.failed) return;
    const size = s.p.size;
    const x = s.cursor % size, y = Math.floor(s.cursor / size);
    if (action === 'up' && y > 0) s.cursor -= size;
    else if (action === 'down' && y < size - 1) s.cursor += size;
    else if (action === 'left' && x > 0) s.cursor -= 1;
    else if (action === 'right' && x < size - 1) s.cursor += 1;
    else if (action === 'next' && s.tray.length) s.selected = (s.selected + 1) % s.tray.length;
    else if (action === 'prev' && s.tray.length) s.selected = (s.selected + s.tray.length - 1) % s.tray.length;
    else if (action === 'rotate') turn(s);
    else if (action === 'primary') placeOrLift(s, s.cursor);
    else if (action === 'alt') submit(s, t);
  },
  pointer(s, event, t) {
    if (inPreview(s, t) || s.solved || s.failed) return;
    if (event.kind === 'tray' && event.index >= 0 && event.index < s.tray.length) s.selected = event.index;
    else if (event.kind === 'cell' && event.index >= 0 && event.index < s.board.length) {
      s.cursor = event.index;
      if (event.button === 2) turn(s);
      else placeOrLift(s, event.index);
    } else if (event.kind === 'select' && event.index === -1) submit(s, t);
  },
  outcome(s) {
    if (s.solved) return { status: 'success', reason: 'completed' };
    if (s.failed) return { status: 'failed', reason: 'submissions_exhausted' };
    return null;
  },
  report(s, _o, t, timeoutMs) {
    const correct = correctCells(s).length;
    const mistakes = s.submissionsUsed - (s.solved ? 1 : 0);
    const timeFactor = Math.max(0, 1 - (t - s.previewEnd) / Math.max(1, timeoutMs - s.previewEnd));
    const base = s.solved ? 1 - mistakes / (s.p.submissions + 1) : (correct / s.target.length) * 0.4;
    return {
      score: toScore(base * (0.8 + 0.2 * timeFactor)),
      mistakes,
      metrics: { pieces: s.target.length, submissions: s.submissionsUsed, correctCells: correct, moves: s.moves },
    };
  },
});

function turn(s: PatternState): void {
  if (!s.p.rotation) return;
  const placed = s.board[s.cursor];
  if (placed) placed.rotation = (placed.rotation + 1) % 4;
  else if (s.tray[s.selected]) s.tray[s.selected].rotation = (s.tray[s.selected].rotation + 1) % 4;
  else return;
  s.moves++;
  s.marks = null;
}

function placeOrLift(s: PatternState, cell: number): void {
  const existing = s.board[cell];
  if (existing) {
    s.board[cell] = null;
    s.tray.push(existing);
    s.selected = s.tray.length - 1;
  } else if (s.tray.length) {
    s.board[cell] = s.tray.splice(s.selected, 1)[0];
    s.selected = Math.min(s.selected, Math.max(0, s.tray.length - 1));
  } else return;
  s.moves++;
  s.marks = null;
}

function submit(s: PatternState, t: number): void {
  s.submissionsUsed++;
  if (isSolved(s)) { s.solved = true; return; }
  s.marks = { correct: correctCells(s), at: t };
  if (s.submissionsUsed >= s.p.submissions) s.failed = true;
}
