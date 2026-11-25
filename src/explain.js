// Rule-based explanation of a puzzle: what the best move does and why the move
// played in the game was worse. Built only from the engine lines saved during the
// analysis, so it is indicative: it describes the line, it does not "understand" it.
import { Chess } from 'chess.js';
import { motifsOfMove, VAL } from './motifs.js';

/** Material of `color` minus material of the opponent (pawn = 1, minor = 3, rook = 5, queen = 9). */
export function materialBalance(fen, color) {
  let s = 0;
  for (const row of new Chess(fen).board()) for (const p of row) if (p) s += (p.color === color ? 1 : -1) * VAL[p.type];
  return s;
}

/**
 * Play a UCI line from `fen`. Returns {san: [...], fens: [...], uci: [...]} (fens[0] = start),
 * stopping at the first illegal move.
 */
export function playLine(fen, line) {
  const ch = new Chess(fen);
  const out = { san: [], fens: [fen], uci: [] };
  for (const u of line || []) {
    try {
      const m = ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.san.push(m.san); out.fens.push(ch.fen()); out.uci.push(u);
    } catch { break; }
  }
  return out;
}

/**
 * Material change for `color` along a line. If the line stops right after one of our
 * captures and the piece can be taken back, the recapture is counted too.
 */
function materialSwing(fen, line, color) {
  const pl = playLine(fen, line);
  const n = pl.san.length;
  const last = pl.fens[n];
  const ch = new Chess(last);
  let swing = materialBalance(last, color) - materialBalance(fen, color);
  if (n && ch.turn() !== color && !ch.isGameOver()) {
    const to = pl.uci[n - 1].slice(2, 4);
    if (ch.moves({ verbose: true }).some((m) => m.to === to)) swing -= VAL[ch.get(to).type];
  }
  return { swing, mate: ch.isCheckmate(), plies: n, pl };
}

/**
 * Build the explanation.
 * puzzle: {fen, solution, pv, played, wpBest}
 * ply: the analysed ply of the game (optional): {uci, mate, wpAfter}
 * reply: the next analysed ply (optional): its pv is the best answer to the move played
 * Returns a list of {key, params} to translate, plus the two lines.
 */
export function explainPuzzle(puzzle, ply, reply) {
  const color = puzzle.fen.split(' ')[1];
  const parts = [];
  const best = playLine(puzzle.fen, puzzle.pv?.length ? puzzle.pv : [puzzle.solution]);
  const m = best.san[0] || puzzle.solutionSan;
  const tags = motifsOfMove(puzzle.fen, puzzle.solution);

  // 1. What the best move does.
  if (puzzle.wpBest != null && puzzle.wpBest < 35) parts.push({ key: 'xp.defend', params: { m } });
  if (ply?.mate > 0) parts.push({ key: 'xp.mate', params: { m, n: ply.mate } });
  for (const tag of ['fork', 'pin', 'skewer', 'discovered', 'sacrifice']) if (tags.has(tag)) parts.push({ key: 'xp.' + tag, params: { m } });
  if (tags.has('material') && !tags.has('sacrifice')) parts.push({ key: 'xp.material', params: { m } });
  else if (tags.has('check') && parts.length === 0) parts.push({ key: 'xp.check', params: { m } });

  // 2. Where the line leads.
  if (!(ply?.mate > 0)) {
    const s = materialSwing(puzzle.fen, best.uci, color);
    if (s.swing >= 1) parts.push({ key: 'xp.gain', params: { n: s.swing, k: Math.ceil(s.plies / 2) } });
    else if (s.swing <= -1) parts.push({ key: puzzle.wpBest < 35 ? 'xp.limit' : 'xp.invest', params: { n: -s.swing } });
    else parts.push({ key: 'xp.quiet', params: {} });
  }

  // 3. Why the game move was worse.
  let refutation = null;
  if (ply?.uci && reply?.pv?.length) {
    refutation = playLine(puzzle.fen, [ply.uci, ...reply.pv]);
    const line = refutation.san.slice(1, 5).join(' ');
    const p = puzzle.played;
    if (reply.mate > 0) parts.push({ key: 'xp.refMate', params: { p, n: reply.mate, line } });
    else {
      const s = materialSwing(puzzle.fen, refutation.uci, color);
      if (s.swing <= -1) parts.push({ key: 'xp.refLoss', params: { p, n: -s.swing, line } });
      else parts.push({ key: 'xp.refPos', params: { p, line } });
    }
  }
  if (ply?.wpAfter != null && puzzle.wpBest != null) parts.push({ key: 'xp.wp', params: { a: Math.round(puzzle.wpBest), b: Math.round(ply.wpAfter), p: puzzle.played } });
  return { parts, best, refutation };
}
