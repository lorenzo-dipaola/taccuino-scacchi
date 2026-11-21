// Aggregates over all analysed games: per-theme ratings and statistics.
import { userScore } from './pgn.js';
import { CLASSES, eloFromAccuracy } from './analysis.js';

const hdrElo = (g, col) => parseInt(col === 'w' ? g.headers.WhiteElo : g.headers.BlackElo, 10) || null;

/**
 * Calibrate "accuracy -> Elo" on the real ratings found in the PGN headers.
 * Uses BOTH players of every analysed game (your opponents' ratings count too),
 * fits rating = alpha + beta * accuracy by least squares, with the slope pulled
 * towards the default table's slope (ridge) so a few games cannot produce
 * absurd values. Returns null with fewer than 6 rated data points.
 */
export function eloCalibration(games, { minPoints = 6, lambda = 400 } = {}) {
  const pts = [];
  for (const g of games) {
    if (!g.analysis) continue;
    for (const col of ['w', 'b']) {
      const y = hdrElo(g, col), x = g.analysis.accuracy[col];
      if (y && y > 100 && x != null) pts.push([x, y]);
    }
  }
  if (pts.length < minPoints) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); }
  const beta0 = (eloFromAccuracy(Math.min(99, mx + 2)) - eloFromAccuracy(Math.max(31, mx - 2))) / 4;
  const beta = Math.max(5, Math.min(100, (sxy + lambda * beta0) / (sxx + lambda)));
  const alpha = my - beta * mx;
  const sd = Math.sqrt(pts.reduce((s, [x, y]) => s + (y - alpha - beta * x) ** 2, 0) / Math.max(1, n - 2));
  return { alpha, beta, n, sd: Math.round(sd), meanRating: Math.round(my) };
}

/** Game Elo: calibrated if possible, otherwise the default table. */
export function gameElo(acc, cal) {
  if (acc == null) return null;
  if (!cal) return eloFromAccuracy(acc);
  return Math.max(100, Math.min(3200, Math.round((cal.alpha + cal.beta * acc) / 25) * 25));
}

export const THEMES = {
  opening: 'Apertura',
  middlegame: 'Mediogioco',
  endgame: 'Finale',
  rookEndgame: 'Finale di torre',
  pawnEndgame: 'Finale di pedoni',
  minorEndgame: 'Finale di pezzi minori',
  queenEndgame: 'Finale di donna',
  mixedEndgame: 'Finale misto',
  fork: 'Attacco doppio',
  pin: 'Inchiodatura',
  skewer: 'Infilata',
  discovered: 'Attacco di scoperta',
  sacrifice: 'Sacrificio',
  mate: 'Scacco matto',
  kingAttack: 'Attacco al re',
  material: 'Guadagno di materiale',
  passedPawn: 'Pedone avanzato',
  pawnStructure: 'Struttura pedonale',
  defense: 'Difesa',
  conversion: 'Conversione del vantaggio',
  critical: 'Mosse critiche',
  timePressure: 'Zeitnot',
};

export const CLASS_INFO = {
  brilliant: { label: 'Geniale', sym: '!!' },
  great: { label: 'Grande', sym: '!' },
  book: { label: 'Teoria', sym: '≡' },
  best: { label: 'Migliore', sym: '★' },
  excellent: { label: 'Ottima', sym: '✓✓' },
  good: { label: 'Buona', sym: '✓' },
  inaccuracy: { label: 'Imprecisione', sym: '?!' },
  mistake: { label: 'Errore', sym: '?' },
  miss: { label: 'Occasione persa', sym: '⊘' },
  blunder: { label: 'Errore grave', sym: '??' },
};

/** Fractional success of one decision, from win% lost. */
export function decisionScore(p) {
  if (p.cls === 'brilliant' || p.cls === 'great') return 1;
  const l = p.loss;
  if (l < 2) return 1;
  if (l < 5) return 0.75;
  if (l < 10) return 0.4;
  if (l < 20) return 0.15;
  return 0;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/**
 * Per-theme rating. Method (an approximation, NOT a real Elo):
 * base = your rating (median header Elo of your recent games, else the mean
 * estimated game Elo). For each theme we take the recency-weighted success
 * rate, shrink it towards your overall rate with K pseudo-decisions, and
 * convert the odds ratio to Elo points: R = base + 400*log10(odds_theme/odds_all).
 */
export function themeRatings(games, { shrink = 8, halfLife = 80 } = {}) {
  const done = games.filter((g) => g.analysis && g.userColor).sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.addedAt - b.addedAt);
  if (!done.length) return { base: null, baseSource: null, themes: [] };
  const hdr = done.slice(-30).map((g) => parseInt(g.userColor === 'w' ? g.headers.WhiteElo : g.headers.BlackElo, 10)).filter((x) => x > 0).sort((a, b) => a - b);
  let base, baseSource;
  if (hdr.length >= 3) { base = hdr[Math.floor(hdr.length / 2)]; baseSource = 'rating nelle intestazioni PGN (mediana ultime partite)'; }
  else { const cal = eloCalibration(done); base = Math.round(mean(done.map((g) => gameElo(g.analysis.accuracy[g.userColor], cal)))); baseSource = 'Elo stimato medio delle partite'; }

  const n = done.length;
  let allS = 0, allW = 0;
  const acc = {};
  done.forEach((g, gi) => {
    const w = Math.pow(0.5, (n - 1 - gi) / halfLife);
    for (const p of g.analysis.plies) {
      if (p.color !== g.userColor || p.cls === 'book') continue;
      const s = decisionScore(p);
      allS += s * w; allW += w;
      for (const t of p.themes || []) {
        acc[t] ??= { s: 0, w: 0, n: 0, errors: 0 };
        acc[t].s += s * w; acc[t].w += w; acc[t].n++;
        if (s <= 0.15) acc[t].errors++;
      }
    }
  });
  const pAll = Math.min(0.98, Math.max(0.02, allS / allW));
  const odds = (p) => p / (1 - p);
  const themes = Object.entries(acc).map(([key, a]) => {
    const p = Math.min(0.98, Math.max(0.02, (a.s + shrink * pAll) / (a.w + shrink)));
    const rating = Math.round(base + 400 * Math.log10(odds(p) / odds(pAll)));
    return { key, label: THEMES[key] || key, rating, n: a.n, errors: a.errors, success: r1(100 * a.s / a.w), confidence: a.n >= 40 ? 'alta' : a.n >= 12 ? 'media' : 'bassa' };
  });
  themes.sort((a, b) => b.n - a.n);
  return { base, baseSource, overallSuccess: r1(100 * pAll), themes };
}

export function aggregate(games) {
  const all = games.filter((g) => g.userColor);
  const done = all.filter((g) => g.analysis).sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.addedAt - b.addedAt);
  const res = { total: all.length, analysed: done.length };
  const wdl = (gs) => {
    const o = { n: 0, w: 0, d: 0, l: 0 };
    for (const g of gs) { const s = userScore(g); if (s == null) continue; o.n++; if (s === 1) o.w++; else if (s === 0) o.l++; else o.d++; }
    o.score = o.n ? r1((100 * (o.w + o.d / 2)) / o.n) : null;
    return o;
  };
  res.results = { all: wdl(all), w: wdl(all.filter((g) => g.userColor === 'w')), b: wdl(all.filter((g) => g.userColor === 'b')) };
  if (!done.length) return res;
  const my = (g) => g.userColor, opp = (g) => (g.userColor === 'w' ? 'b' : 'w');

  res.accuracy = r1(mean(done.map((g) => g.analysis.accuracy[my(g)]).filter((x) => x != null)));
  res.oppAccuracy = r1(mean(done.map((g) => g.analysis.accuracy[opp(g)]).filter((x) => x != null)));
  const cal = eloCalibration(games);
  res.calibration = cal;
  res.estElo = Math.round(mean(done.map((g) => gameElo(g.analysis.accuracy[my(g)], cal)).filter(Boolean)));
  res.trend = done.map((g) => ({ id: g.id, date: g.date, acc: g.analysis.accuracy[my(g)], elo: gameElo(g.analysis.accuracy[my(g)], cal), hdrElo: hdrElo(g, my(g)), score: userScore(g) }));

  // Classification totals
  res.classes = {};
  for (const c of CLASSES) res.classes[c] = 0;
  done.forEach((g) => { for (const c of CLASSES) res.classes[c] += g.analysis.counts[my(g)][c] || 0; });
  const userMoves = done.reduce((s, g) => s + g.analysis.plies.filter((p) => p.color === my(g)).length, 0);
  res.userMoves = userMoves;

  // Highlights: brilliant and great moves
  res.highlights = [];
  done.forEach((g) => g.analysis.plies.forEach((p) => {
    if (p.color === my(g) && (p.cls === 'brilliant' || p.cls === 'great')) res.highlights.push({ gameId: g.id, ply: p.i, san: p.san, cls: p.cls, date: g.date, opp: g.userColor === 'w' ? g.headers.Black : g.headers.White, moveNo: Math.floor(p.i / 2) + 1 });
  }));
  res.highlights.reverse();

  // Phases
  res.phases = {};
  for (const ph of ['opening', 'middlegame', 'endgame']) res.phases[ph] = r1(mean(done.map((g) => g.analysis.phaseAcc[my(g)][ph]).filter((x) => x != null)));

  // Openings by family, split by colour
  const fam = {};
  done.forEach((g) => {
    const name = g.analysis.opening?.name || 'Sconosciuta';
    const family = name.split(':')[0];
    const k = g.userColor + '|' + family;
    fam[k] ??= { color: g.userColor, family, games: [], variations: {} };
    fam[k].games.push(g);
    fam[k].variations[name] = (fam[k].variations[name] || 0) + 1;
  });
  res.openings = Object.values(fam).map((f) => ({
    color: f.color, family: f.family, ...wdl(f.games),
    acc: r1(mean(f.games.map((g) => g.analysis.phaseAcc[my(g)].opening).filter((x) => x != null))),
    topVariation: Object.entries(f.variations).sort((a, b) => b[1] - a[1])[0][0],
    eco: f.games[0].analysis.opening?.eco || '',
  })).sort((a, b) => b.n - a.n);

  // Endgames reached
  const eg = {};
  done.forEach((g) => { const t = g.analysis.endgameType; if (!t) return; (eg[t] ??= []).push(g); });
  res.endgames = Object.entries(eg).map(([t, gs]) => ({ key: t, label: THEMES[t], ...wdl(gs), acc: r1(mean(gs.map((g) => g.analysis.phaseAcc[my(g)].endgame).filter((x) => x != null))) })).sort((a, b) => b.n - a.n);
  res.reachedEndgame = done.filter((g) => g.analysis.endgameType).length;

  // Tactics: opportunities (best move had the motif and mattered) taken vs missed
  const tac = {};
  done.forEach((g) => g.analysis.plies.forEach((p) => {
    if (p.color !== my(g) || !p.themes) return;
    for (const t of ['fork', 'pin', 'skewer', 'discovered', 'sacrifice', 'mate', 'material', 'kingAttack']) {
      if (!p.themes.includes(t)) continue;
      tac[t] ??= { found: 0, missed: 0 };
      if (p.loss < 5) tac[t].found++; else tac[t].missed++;
    }
  }));
  res.tactics = Object.entries(tac).map(([k, v]) => ({ key: k, label: THEMES[k], ...v, rate: r1((100 * v.found) / (v.found + v.missed)) })).sort((a, b) => b.found + b.missed - (a.found + a.missed));

  // Advantage conversion and comebacks (user win% at any point)
  let hadWin = 0, converted = 0, wasLost = 0, saved = 0, decidedByBlunder = 0, losses = 0;
  done.forEach((g) => {
    const wps = g.analysis.wpWhite.map((x) => (g.userColor === 'w' ? x : 100 - x));
    const s = userScore(g);
    if (s == null) return;
    if (wps.some((x) => x >= 85)) { hadWin++; if (s === 1) converted++; }
    if (wps.some((x) => x <= 15)) { wasLost++; if (s >= 0.5) saved++; }
    if (s === 0) { losses++; if (g.analysis.counts[my(g)].blunder > 0) decidedByBlunder++; }
  });
  res.conversion = { hadWin, converted, rate: hadWin ? r1((100 * converted) / hadWin) : null };
  res.comebacks = { wasLost, saved, rate: wasLost ? r1((100 * saved) / wasLost) : null };
  res.lossesWithBlunder = { losses, n: decidedByBlunder, rate: losses ? r1((100 * decidedByBlunder) / losses) : null };

  // Time management (only games with clock data)
  const timed = done.filter((g) => g.analysis.plies.some((p) => p.clock != null) && g.timeControl);
  if (timed.length) {
    const low = [], normal = [];
    let zeit = 0;
    timed.forEach((g) => {
      let hit = false;
      g.analysis.plies.forEach((p) => {
        if (p.color !== my(g) || p.clock == null || p.cls === 'book') return;
        const f = p.clock / g.timeControl.base;
        (f < 0.1 ? low : normal).push(p.acc);
        if (f < 0.1) hit = true;
      });
      if (hit) zeit++;
    });
    res.time = { games: timed.length, zeitnotGames: zeit, accLow: r1(mean(low)), accNormal: r1(mean(normal)), lowMoves: low.length };
  }

  // By time class
  const tcs = {};
  done.forEach((g) => (tcs[g.timeClass] ??= []).push(g));
  res.timeClasses = Object.entries(tcs).map(([k, gs]) => ({ key: k, ...wdl(gs), acc: r1(mean(gs.map((g) => g.analysis.accuracy[my(g)]))) })).sort((a, b) => b.n - a.n);

  // Game length and how games ended
  res.avgMoves = Math.round(mean(done.map((g) => Math.ceil(g.moves.length / 2))));
  return res;
}
