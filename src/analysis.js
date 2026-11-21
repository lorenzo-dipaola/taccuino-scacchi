// Game analysis: engine evaluations -> win%, per-move accuracy, move
// classification, game accuracy, estimated game Elo, themes, puzzles.
import { Chess } from 'chess.js';
import openings from './openings.json' with { type: 'json' };
import { motifsOfMove, phaseOf, endgameType, gridOf, hasAdvancedPasser, applyUci } from './motifs.js';

export const MATE_CP = 10000;

/** Win probability (0-100) from centipawns, side-to-move POV. Lichess' public formula. */
export const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1500, Math.min(1500, cp)))) - 1);

/** Per-move accuracy from win% lost (Lichess' public formula). */
export const moveAccuracy = (loss) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669 + 1));

export const scoreToCp = (s) => (s.mate != null ? (s.mate > 0 ? MATE_CP - s.mate : s.mate < 0 ? -MATE_CP - s.mate : -MATE_CP) : s.cp);

export const CLASSES = ['brilliant', 'great', 'book', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder'];

const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
export const lookupOpening = (fen) => openings[posKey(fen)] || null;

/**
 * Estimated rating from accuracy. ROUGH piecewise mapping chosen by hand,
 * not fitted on data; depth and game length change it a lot.
 */
const ELO_ANCHORS = [[30, 100], [40, 250], [50, 450], [60, 800], [70, 1200], [75, 1450], [80, 1700], [85, 2000], [90, 2350], [95, 2750], [100, 3100]];
export function eloFromAccuracy(acc) {
  if (acc <= ELO_ANCHORS[0][0]) return ELO_ANCHORS[0][1];
  for (let i = 1; i < ELO_ANCHORS.length; i++) {
    const [a1, e1] = ELO_ANCHORS[i - 1], [a2, e2] = ELO_ANCHORS[i];
    if (acc <= a2) return Math.round((e1 + ((acc - a1) / (a2 - a1)) * (e2 - e1)) / 25) * 25;
  }
  return 3100;
}

/** Lichess-style game accuracy: mean of volatility-weighted mean and harmonic mean. */
export function gameAccuracy(wpWhiteSeries, plies, color) {
  const accs = [], weights = [];
  const win = Math.max(2, Math.min(8, Math.floor(wpWhiteSeries.length / 10)));
  plies.forEach((p, i) => {
    if (p.color !== color) return;
    const lo = Math.max(0, i - win + 1), seg = wpWhiteSeries.slice(lo, i + 2);
    const mean = seg.reduce((s, x) => s + x, 0) / seg.length;
    const sd = Math.sqrt(seg.reduce((s, x) => s + (x - mean) ** 2, 0) / seg.length);
    accs.push(p.acc);
    weights.push(Math.max(0.5, Math.min(12, sd)));
  });
  if (!accs.length) return null;
  const wsum = weights.reduce((a, b) => a + b, 0);
  const wmean = accs.reduce((s, a, i) => s + a * weights[i], 0) / wsum;
  const hmean = accs.length / accs.reduce((s, a) => s + 1 / Math.max(a, 1), 0);
  return Math.round(((wmean + hmean) / 2) * 10) / 10;
}

function classify({ loss, isBest, wpBest, wpAfter, gap, sacrifice, book, prevOppLoss, onlyLegal, recapture, bestMate, afterMate }) {
  if (book) return 'book';
  // Brilliant: a real material sacrifice that is (near-)best and not losing, and
  // not just a flourish in a position that was trivially winning anyway.
  if (loss < 2 && sacrifice && wpAfter >= 45 && (wpBest < 97 || (gap != null && gap >= 15)) && !onlyLegal) return 'brilliant';
  // Great: the only move that keeps the evaluation, in a position not yet decided.
  if (isBest && gap != null && gap >= 15 && wpAfter >= 30 && wpBest <= 92 && !onlyLegal && !recapture) return 'great';
  // Miss: the opponent just erred, or mate was on the board, and the chance was not taken.
  if (loss >= 8 && ((prevOppLoss >= 10 && wpBest >= 60) || (bestMate && !afterMate && wpBest >= 95))) return 'miss';
  if (isBest || loss < 0.5) return 'best';
  if (loss < 2) return 'excellent';
  if (loss < 5) return 'good';
  // A move that leaves you clearly better is not called a blunder.
  if (loss < 10 || wpAfter >= 75) return 'inaccuracy';
  if (loss < 20 || wpAfter >= 60) return 'mistake';
  return 'blunder';
}

/** Theme tags for one of the user's decisions. */
function themesFor(ply, motifsBest, motifsPlayed, gap, phase, egType, wpBest, bestMate, clockFrac, fen) {
  const t = new Set([phase]);
  if (phase === 'endgame' && egType) t.add(egType);
  const significant = gap == null || gap >= 8;
  for (const m of ['fork', 'pin', 'skewer', 'discovered', 'sacrifice', 'kingAttack', 'material']) {
    if (motifsPlayed.has(m) || (motifsBest.has(m) && significant)) t.add(m);
  }
  if (bestMate) t.add('mate');
  if (wpBest <= 30) t.add('defense');
  if (wpBest >= 75 && !bestMate) t.add('conversion');
  if (gap != null && gap >= 15) t.add('critical');
  if (phase !== 'opening' && (motifsPlayed.has('pawnMove') || motifsBest.has('pawnMove'))) t.add('pawnStructure');
  if (hasAdvancedPasser(gridOf(fen))) t.add('passedPawn');
  if (clockFrac != null && clockFrac < 0.1) t.add('timePressure');
  return [...t];
}

/**
 * Analyse a parsed game. `engine.analyse(fen, {depth, multipv})` must resolve
 * to an array of lines [{ cp|mate, pv: [uci...] }] from side-to-move POV.
 */
export async function analyzeGame(game, engine, { depth = 12, onProgress } = {}) {
  const fens = [game.startFen, ...game.moves.map((m) => m.after)];
  const ch = new Chess(game.startFen);
  const evals = [];
  // Terminal positions are scored by the rules, not by the engine.
  for (let i = 0; i < fens.length; i++) {
    if (i > 0) ch.move(game.moves[i - 1].san);
    if (ch.isCheckmate()) evals.push({ cp: -MATE_CP, mate: 0, lines: [] });
    else if (ch.isDraw() || ch.isStalemate()) evals.push({ cp: 0, mate: null, lines: [], draw: true });
    else {
      const lines = await engine.analyse(fens[i], { depth, multipv: 2 });
      const top = lines[0];
      evals.push({ cp: scoreToCp(top), mate: top.mate ?? null, lines, legal: ch.moves().length });
    }
    onProgress?.(i + 1, fens.length);
  }

  // Opening: deepest known position reached, and how long the game stayed "in book".
  let opening = null, bookUntil = -1;
  for (let i = 0; i < game.moves.length; i++) {
    const o = lookupOpening(game.moves[i].after);
    if (o) { opening = { eco: o[0], name: o[1], ply: i }; if (bookUntil === i - 1) bookUntil = i; }
  }
  if (!opening && game.headers.Opening) opening = { eco: game.headers.ECO || '', name: game.headers.Opening, ply: -1 };

  const initialClock = game.timeControl?.base || null;
  const plies = [];
  let endgameAt = null;
  const wpWhite = evals.map((e, i) => {
    const stm = new Chess(fens[i]).turn();
    const w = winPct(e.cp);
    return stm === 'w' ? w : 100 - w;
  });

  for (let i = 0; i < game.moves.length; i++) {
    const m = game.moves[i];
    const eb = evals[i], ea = evals[i + 1];
    const best = eb.lines[0]?.pv?.[0] || null;
    const second = eb.lines[1];
    const cpBest = eb.cp;
    const cpAfter = -ea.cp; // mover's POV
    const wpBest = winPct(cpBest);
    const isBest = best === m.uci;
    const wpAfter = isBest ? Math.max(winPct(cpAfter), wpBest) : winPct(cpAfter);
    const loss = isBest ? 0 : Math.max(0, wpBest - wpAfter);
    const gap = second ? wpBest - winPct(scoreToCp(second)) : null;
    const mPlayed = motifsOfMove(m.before, m.uci);
    const mBest = best && !isBest ? motifsOfMove(m.before, best) : mPlayed;
    const prev = plies[i - 1];
    const recapture = !!(prev && prev.captureSq === m.uci.slice(2, 4) && mPlayed.has('capture'));
    const inBook = i <= bookUntil;
    const phase = phaseOf(m.before, i, inBook);
    if (phase === 'endgame' && endgameAt == null) endgameAt = i;
    const egType = phase === 'endgame' ? endgameType(m.before) : null;
    const bestMate = eb.mate != null && eb.mate > 0 && eb.mate <= 6;
    const afterMate = ea.mate != null && (ea.mate < 0 || ea.mate === 0);

    const cls = classify({
      loss, isBest, wpBest, wpAfter, gap, sacrifice: mPlayed.has('sacrifice'), book: inBook,
      prevOppLoss: prev ? prev.loss : 0, onlyLegal: eb.legal === 1, recapture, bestMate, afterMate,
    });
    const acc = cls === 'book' ? 100 : moveAccuracy(loss);
    const clockFrac = m.clock != null && initialClock ? m.clock / initialClock : null;
    const ply = {
      i, san: m.san, uci: m.uci, color: m.color, fen: m.before,
      best, bestSan: best ? applyUci(m.before, best)?.move.san : null,
      pv: (eb.lines[0]?.pv || []).slice(0, 8),
      cpBest, cpAfter, wpBest: +wpBest.toFixed(1), wpAfter: +wpAfter.toFixed(1), loss: +loss.toFixed(1),
      gap: gap == null ? null : +gap.toFixed(1), acc: +acc.toFixed(1), cls, phase,
      mate: eb.mate, clock: m.clock, captureSq: mPlayed.has('capture') ? m.uci.slice(2, 4) : null,
    };
    if (m.color === game.userColor) {
      ply.themes = themesFor(ply, mBest, mPlayed, gap, phase, egType, wpBest, bestMate, clockFrac, m.before);
    }
    plies.push(ply);
  }

  const out = { depth, opening, endgameAt, endgameType: endgameAt != null ? endgameType(game.moves[endgameAt].before) : null, plies, wpWhite: wpWhite.map((x) => +x.toFixed(1)) };
  out.accuracy = { w: gameAccuracy(wpWhite, plies, 'w'), b: gameAccuracy(wpWhite, plies, 'b') };
  out.elo = { w: out.accuracy.w != null ? eloFromAccuracy(out.accuracy.w) : null, b: out.accuracy.b != null ? eloFromAccuracy(out.accuracy.b) : null };
  out.counts = { w: {}, b: {} };
  for (const c of CLASSES) { out.counts.w[c] = 0; out.counts.b[c] = 0; }
  plies.forEach((p) => out.counts[p.color][p.cls]++);
  out.phaseAcc = {};
  for (const col of ['w', 'b']) {
    out.phaseAcc[col] = {};
    for (const ph of ['opening', 'middlegame', 'endgame']) {
      const xs = plies.filter((p) => p.color === col && p.phase === ph && p.cls !== 'book').map((p) => p.acc);
      out.phaseAcc[col][ph] = xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null;
    }
  }
  return out;
}

/** Puzzles from the user's own errors. */
export function puzzlesFromAnalysis(game, analysis, { includeInaccuracies = false } = {}) {
  const wanted = new Set(['mistake', 'blunder', 'miss', ...(includeInaccuracies ? ['inaccuracy'] : [])]);
  return analysis.plies
    .filter((p) => p.color === game.userColor && wanted.has(p.cls) && p.best && p.loss >= (includeInaccuracies ? 6 : 10))
    .map((p) => ({
      id: `${game.id}:${p.i}`,
      gameId: game.id,
      ply: p.i,
      fen: p.fen,
      solution: p.best,
      solutionSan: p.bestSan,
      pv: p.pv,
      played: p.san,
      cls: p.cls,
      loss: p.loss,
      wpBest: p.wpBest,
      themes: p.themes || [],
      opponent: game.userColor === 'w' ? game.headers.Black : game.headers.White,
      date: game.date,
      solved: 0,
      attempts: 0,
      fails: 0,
      lastSeen: 0,
      createdAt: Date.now(),
    }));
}
