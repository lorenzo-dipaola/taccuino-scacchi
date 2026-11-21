// Board geometry and heuristic motif detection (fork, pin, skewer, discovered
// attack, sacrifice, king attack, passed pawns, game phase).
// These are HEURISTICS: they look one move deep on the board, they do not
// prove that a tactic works. The engine evaluation decides whether it worked.
import { Chess } from 'chess.js';

export const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const KING = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_D = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

// grid[r][c]: r = 0 is rank 8, c = 0 is file a (same as chess.js board()).
export function gridOf(fen) {
  return new Chess(fen).board().map((row) => row.map((p) => (p ? { type: p.type, color: p.color } : null)));
}
export const rc = (sq) => [8 - +sq[1], sq.charCodeAt(0) - 97];
const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

function dirsOf(type) {
  if (type === 'b') return BISHOP_D;
  if (type === 'r') return ROOK_D;
  if (type === 'q') return ROOK_D.concat(BISHOP_D);
  return null;
}

/** Squares attacked by the piece on (r, c). */
export function attacks(g, r, c) {
  const p = g[r][c];
  if (!p) return [];
  const out = [];
  if (p.type === 'p') {
    const dr = p.color === 'w' ? -1 : 1;
    for (const dc of [-1, 1]) if (inside(r + dr, c + dc)) out.push([r + dr, c + dc]);
  } else if (p.type === 'n' || p.type === 'k') {
    for (const [dr, dc] of p.type === 'n' ? KNIGHT : KING) if (inside(r + dr, c + dc)) out.push([r + dr, c + dc]);
  } else {
    for (const [dr, dc] of dirsOf(p.type)) {
      let rr = r + dr, cc = c + dc;
      while (inside(rr, cc)) {
        out.push([rr, cc]);
        if (g[rr][cc]) break;
        rr += dr; cc += dc;
      }
    }
  }
  return out;
}

export function attackersOf(g, r, c, color) {
  const res = [];
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const p = g[i][j];
    if (p && p.color === color && attacks(g, i, j).some(([a, b]) => a === r && b === c)) res.push({ r: i, c: j, ...p });
  }
  return res;
}

function findKing(g, color) {
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if (g[i][j]?.type === 'k' && g[i][j].color === color) return [i, j];
  return null;
}

/** Apply a UCI move to a FEN; returns { after, move } (chess.js verbose move) or null. */
export function applyUci(fen, uci) {
  const ch = new Chess(fen);
  try {
    const move = ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
    return { after: ch.fen(), move, chess: ch };
  } catch {
    return null;
  }
}

export function pieceCounts(g) {
  const n = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const row of g) for (const p of row) if (p && p.type !== 'k') n[p.color][p.type]++;
  return n;
}

/** 'opening' | 'middlegame' | 'endgame' (simple piece-count rule). */
export function phaseOf(fen, ply, inBook) {
  const n = pieceCounts(gridOf(fen));
  const pieces = ['w', 'b'].reduce((s, col) => s + n[col].n + n[col].b + n[col].r + n[col].q, 0);
  if (pieces <= 6) return 'endgame';
  if (inBook || ply < 24) return 'opening';
  return 'middlegame';
}

/** Endgame type from material, or null. */
export function endgameType(fen) {
  const n = pieceCounts(gridOf(fen));
  const has = (t) => n.w[t] + n.b[t] > 0;
  if (!has('n') && !has('b') && !has('r') && !has('q')) return 'pawnEndgame';
  if (has('r') && !has('n') && !has('b') && !has('q')) return 'rookEndgame';
  if (!has('r') && !has('q')) return 'minorEndgame';
  if (has('q') && !has('r') && !has('n') && !has('b')) return 'queenEndgame';
  return 'mixedEndgame';
}

function isPassed(g, r, c, color) {
  const dir = color === 'w' ? -1 : 1;
  for (let rr = r + dir; rr >= 0 && rr < 8; rr += dir)
    for (const cc of [c - 1, c, c + 1])
      if (inside(rr, cc) && g[rr][cc]?.type === 'p' && g[rr][cc].color !== color) return false;
  return true;
}

/** Any passed pawn already on the 5th rank or beyond (relative) for either side. */
export function hasAdvancedPasser(g) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = g[r][c];
    if (p?.type !== 'p') continue;
    const rel = p.color === 'w' ? 8 - r : r + 1;
    if (rel >= 5 && isPassed(g, r, c, p.color)) return true;
  }
  return false;
}

const isUndefended = (g, r, c, color) => attackersOf(g, r, c, color).length === 0;

/**
 * Detect motifs created by playing `uci` in `fen`. Returns a Set of tags:
 * fork, pin, skewer, discovered, sacrifice, kingAttack, material, check, capture, pawnMove.
 */
export function motifsOfMove(fen, uci) {
  const tags = new Set();
  const res = applyUci(fen, uci);
  if (!res) return tags;
  const { move, after } = res;
  const me = move.color, opp = me === 'w' ? 'b' : 'w';
  const g1 = gridOf(fen), g2 = gridOf(after);
  const [tr, tc] = rc(move.to);
  const P = g2[tr][tc];
  const pv = VAL[P.type] || 0;
  const captured = move.captured ? VAL[move.captured] : 0;
  if (move.san.includes('+') || move.san.includes('#')) tags.add('check');
  if (move.captured) tags.add('capture');
  if (move.piece === 'p') tags.add('pawnMove');

  // Material grab: capture of an undefended piece or of a more valuable one.
  if (move.captured && move.captured !== 'p' && (captured > VAL[move.piece] || isUndefended(g1, tr, tc, opp))) tags.add('material');

  // Fork: moved piece attacks >= 2 valuable targets.
  const targets = attacks(g2, tr, tc).filter(([r, c]) => {
    const t = g2[r][c];
    if (!t || t.color !== opp) return false;
    if (t.type === 'k') return true;
    return VAL[t.type] > pv || (VAL[t.type] >= 3 && isUndefended(g2, r, c, opp));
  });
  if (targets.length >= 2) tags.add('fork');

  // Pin / skewer created by the moved slider.
  const dirs = dirsOf(P.type);
  if (dirs) {
    for (const [dr, dc] of dirs) {
      let r = tr + dr, c = tc + dc, first = null;
      while (inside(r, c)) {
        const q = g2[r][c];
        if (q) {
          if (!first) {
            if (q.color !== opp) break;
            first = q;
          } else {
            if (q.color === opp) {
              if (first.type !== 'k' && (q.type === 'k' || VAL[q.type] > VAL[first.type])) tags.add('pin');
              else if ((first.type === 'k' || VAL[first.type] > VAL[q.type]) && VAL[q.type] >= 3) tags.add('skewer');
            }
            break;
          }
        }
        r += dr; c += dc;
      }
    }
  }

  // Discovered attack: another own slider gains a valuable target.
  const [fr, fc] = rc(move.from);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const S = g2[r][c];
    if (!S || S.color !== me || !dirsOf(S.type) || (r === tr && c === tc)) continue;
    const before = new Set(attacks(g1, r, c).map(([a, b]) => a * 8 + b));
    for (const [a, b] of attacks(g2, r, c)) {
      if (before.has(a * 8 + b)) continue;
      const t = g2[a][b];
      if (!t || t.color !== opp) continue;
      // the new line must pass through the vacated square
      const onLine = (a - r) * (fc - c) === (b - c) * (fr - r) && Math.min(r, a) <= fr && fr <= Math.max(r, a) && Math.min(c, b) <= fc && fc <= Math.max(c, b);
      if (!onLine) continue;
      if (t.type === 'k' || VAL[t.type] > VAL[S.type] || (VAL[t.type] >= 3 && isUndefended(g2, a, b, opp))) tags.add('discovered');
    }
  }

  // Sacrifice: the moved piece can be taken at a net loss of >= 2 points.
  const attackersOpp = attackersOf(g2, tr, tc, opp);
  const defenders = attackersOf(g2, tr, tc, me);
  const usable = attackersOpp.filter((a) => a.type !== 'k' || defenders.length === 0);
  if (usable.length && move.piece !== 'k') {
    const minA = Math.min(...usable.map((a) => (a.type === 'k' ? 0 : VAL[a.type])));
    const loss = defenders.length ? pv - minA : pv;
    if (loss - captured >= 2) tags.add('sacrifice');
  }

  // King attack: the move hits the enemy king zone and >= 2 pieces aim at it.
  const k = findKing(g2, opp);
  if (k) {
    const zone = [k, ...KING.map(([dr, dc]) => [k[0] + dr, k[1] + dc]).filter(([a, b]) => inside(a, b))];
    const zoneSet = new Set(zone.map(([a, b]) => a * 8 + b));
    const hitsZone = (r, c) => attacks(g2, r, c).some(([a, b]) => zoneSet.has(a * 8 + b));
    let n = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const S = g2[r][c];
      if (S && S.color === me && S.type !== 'p' && S.type !== 'k' && hitsZone(r, c)) n++;
    }
    if (P.type !== 'k' && hitsZone(tr, tc) && n >= 2) tags.add('kingAttack');
  }
  return tags;
}
