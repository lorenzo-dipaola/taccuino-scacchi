import './style.css';
import { Chess } from 'chess.js';
import * as db from './db.js';
import { bus, state as qstate, importPgnText, reassignUsers, reanalyse, run as runQueue, getEngine } from './queue.js';
import { themeRatings, aggregate, eloCalibration, gameElo, THEMES, CLASS_INFO } from './stats.js';
import { t, themeLabel, classLabel, num, fmtDate, lang, setLang, LANGS } from './i18n.js';
import { METHOD } from './method.js';
import { CLASSES, winPct, scoreToCp } from './analysis.js';
import { userScore } from './pgn.js';
import { Board } from './board.js';
import { radarSVG, evalGraphSVG, lineChartSVG, wdlBar } from './charts.js';
import * as sync from './sync.js';
import { explainPuzzle, playLine } from './explain.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const pct = (x) => (x == null ? '—' : num(x, 0) + '%');
const oppName = (g) => (g.userColor === 'b' ? g.headers.White : g.headers.Black) || '?';
const resultBadge = (g) => { const s = userScore(g); return s == null ? '<span class="res">–</span>' : s === 1 ? `<span class="res win">${t('res.w')}</span>` : s === 0 ? `<span class="res loss">${t('res.l')}</span>` : `<span class="res draw">${t('res.d')}</span>`; };
const clsPill = (c) => `<span class="pill cls-${c}" title="${classLabel(c)}">${CLASS_INFO[c].sym}</span>`;
const wdlText = (o) => `${o.w}${t('res.w')} ${o.d}${t('res.d')} ${o.l}${t('res.l')}`;
const confLabel = (c) => t({ alta: 'conf.high', media: 'conf.medium', bassa: 'conf.low' }[c] || c);
const tcLabel = (k) => t('tc.' + ({ sconosciuto: 'unknown', classica: 'classical' }[k] || k));
const errMsg = (m) => (m === 'no-moves' ? t('err.noMoves') : m);

function pvToSan(fen, pv, max = 8) {
  const ch = new Chess(fen); const out = [];
  for (const u of pv.slice(0, max)) {
    try { const m = ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); out.push(m.san); } catch { break; }
  }
  return out;
}
function movePrefix(fen) { const [, turn, , , , full] = fen.split(' '); return turn === 'w' ? `${full}.` : `${full}…`; }
function evalText(cp) {
  if (Math.abs(cp) >= 9000) { const m = 10000 - Math.abs(cp); return (cp > 0 ? '#' : '#-') + m; }
  return (cp > 0 ? '+' : '') + (cp / 100).toFixed(1);
}


/** In-page confirmation: first click arms the button, second click within 4 s runs the action. */
function confirmClick(btn, label, action) {
  const orig = btn.textContent;
  let armed = false, t;
  btn.onclick = async () => {
    if (!armed) { armed = true; btn.textContent = label; btn.classList.add('armed'); t = setTimeout(() => { armed = false; btn.textContent = orig; btn.classList.remove('armed'); }, 4000); return; }
    clearTimeout(t); btn.disabled = true; await action(); btn.disabled = false; btn.textContent = orig; btn.classList.remove('armed'); armed = false;
  };
}

// ---------------------------------------------------------------- shell
function renderShell() {
  document.title = 'Taccuino Scacchi';
  $('.nav').innerHTML = `
    <a href="#/">${t('nav.overview')}</a>
    <a href="#/partite">${t('nav.games')}</a>
    <a href="#/statistiche">${t('nav.stats')}</a>
    <a href="#/allenamento">${t('nav.training')}</a>
    <a href="#/importa">${t('nav.import')}</a>
    <a href="#/impostazioni" aria-label="${t('nav.settings')}" title="${t('nav.settings')}">⚙</a>
    <select id="langsel" class="langsel" aria-label="Language">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === lang ? 'selected' : ''}>${k.toUpperCase()}</option>`).join('')}</select>`;
  $('#langsel').onchange = (e) => changeLang(e.target.value);
}
function changeLang(l) { setLang(l); renderShell(); route(); renderQueueBar(); }

// ---------------------------------------------------------------- router
const routes = [
  [/^#?\/?$/, viewOverview],
  [/^#\/partite$/, viewGames],
  [/^#\/partita\/([\w]+)(?:\/(\d+))?$/, viewGame],
  [/^#\/statistiche$/, viewStats],
  [/^#\/allenamento$/, viewTraining],
  [/^#\/importa$/, viewImport],
  [/^#\/impostazioni$/, viewSettings],
  [/^#\/metodo$/, viewMethod],
];
let currentView = null;
let ready = false;
const locked = () => sync.enabled && !sync.status.user;
async function route() {
  if (!ready) return;
  document.body.classList.toggle('locked', locked());
  if (locked()) { currentView = viewLogin; viewLogin(); return; }
  const h = location.hash || '#/';
  // Tokens or errors from a magic-link redirect: handled by sync.js, not by the router.
  if (/^#(access_token|error)=/.test(h)) return;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', h === a.getAttribute('href') || (a.getAttribute('href') === '#/partite' && h.startsWith('#/partita/'))));
  for (const [re, fn] of routes) {
    const m = re.exec(h);
    if (m) { currentView = fn; window.scrollTo(0, 0); await fn(...m.slice(1)); return; }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', route);

// Live refresh: views that show aggregates re-render when data changes.
let refreshTimer = null;
bus.addEventListener('data-changed', () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { if ([viewOverview, viewGames, viewStats].includes(currentView)) currentView(); }, 400);
});
bus.addEventListener('progress', () => renderQueueBar());
// Sync: data pulled from another device, sign-in / sign-out, status changes.
sync.syncBus.addEventListener('pulled', () => {
  bus.dispatchEvent(new Event('data-changed')); runQueue();
  if (currentView === viewTraining && !trainBusy) viewTraining();
});
sync.syncBus.addEventListener('auth', () => { if (ready && (locked() || currentView === viewLogin)) route(); });
sync.syncBus.addEventListener('status', () => { if (currentView === viewSettings) renderSyncStatus(); });
function renderQueueBar() {
  const bar = $('#queue');
  if (!qstate.running || !qstate.current) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = `<div class="qtext">${t('queue.running', { label: esc(qstate.label) })}${qstate.pending > 1 ? t('queue.more', { n: qstate.pending - 1 }) : ''}</div><div class="qbar"><span style="width:${(qstate.progress * 100).toFixed(0)}%"></span></div>`;
}

async function loadAll() {
  const [games, settings, puzzles] = await Promise.all([db.allGames(), db.getSettings(), db.allPuzzles()]);
  return { games, settings, puzzles };
}
const activePuzzles = (puzzles, s) => puzzles.filter((p) => p.solved < s.puzzleRepeats);

// ---------------------------------------------------------------- overview
const RADAR_ORDER = ['opening', 'middlegame', 'endgame', 'rookEndgame', 'pawnEndgame', 'minorEndgame', 'queenEndgame', 'mixedEndgame', 'fork', 'pin', 'skewer', 'discovered', 'sacrifice', 'mate', 'kingAttack', 'material', 'passedPawn', 'pawnStructure', 'defense', 'conversion', 'critical', 'timePressure'];
let radarAll = false;

async function viewOverview() {
  const { games, settings, puzzles } = await loadAll();
  if (!settings.usernames.length || !games.length) {
    app.innerHTML = `
      <section class="hero card">
        <h1>${t('hero.title')}</h1>
        <p>${t('hero.lead')}</p>
        <ol class="steps">
          <li class="${settings.usernames.length ? 'done' : ''}">${t('hero.s1')}</li>
          <li class="${games.length ? 'done' : ''}">${t('hero.s2')}</li>
          <li>${t('hero.s3')}</li>
        </ol>
        <a class="btn primary" href="#/importa">${t('hero.cta')}</a>
      </section>`;
    return;
  }
  const tr = themeRatings(games);
  tr.themes.forEach((x) => { x.label = themeLabel(x.key); });
  const ag = aggregate(games);
  const minN = 5;
  // Default radar: the 12 themes with most data (secondary endgame types left out).
  let items = radarAll ? [...tr.themes] : tr.themes.filter((t) => t.n >= minN && !['mixedEndgame', 'queenEndgame', 'minorEndgame'].includes(t.key)).sort((a, b) => b.n - a.n).slice(0, 12);
  const ord = (k) => { const i = RADAR_ORDER.indexOf(k); return i < 0 ? 99 : i; };
  items.sort((a, b) => ord(a.key) - ord(b.key));
  const ranked = tr.themes.filter((t) => t.n >= 8).sort((a, b) => b.rating - a.rating);
  const recent = games.filter((g) => g.userColor).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.addedAt - a.addedAt).slice(0, 6);
  const due = activePuzzles(puzzles, settings).length;
  const pending = games.filter((g) => g.status === 'pending').length;

  app.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span class="k">${t('kpi.analysed')}</span><span class="v">${ag.analysed}<small> / ${ag.total}</small></span></div>
      <div class="kpi"><span class="k">${t('kpi.score')}</span><span class="v">${pct(ag.results.all.score)}</span><small>${wdlText(ag.results.all)}</small></div>
      <div class="kpi"><span class="k">${t('kpi.acc')}</span><span class="v">${num(ag.accuracy)}</span><small>${t('kpi.opp', { x: num(ag.oppAccuracy) })}</small></div>
      <div class="kpi"><span class="k">${t('kpi.base')}</span><span class="v">${tr.base ?? '—'}</span><small>${tr.baseSource ? (tr.baseSource.startsWith('rating') ? t('kpi.base.hdr') : t('kpi.base.est')) : ''}</small></div>
      <a class="kpi link" href="#/allenamento"><span class="k">${t('kpi.puzzles')}</span><span class="v">${due}</span><small>${t('kpi.puzzles.sub')}</small></a>
    </div>
    ${pending ? `<p class="note">${t('ov.pending', { n: pending })}</p>` : ''}
    <div class="grid2">
      <section class="card">
        <div class="card-h"><h2>${t('ov.radar')}</h2>
          <label class="toggle"><input type="checkbox" id="radarAll" ${radarAll ? 'checked' : ''}> ${t('ov.allThemes')}</label></div>
        ${items.length ? radarSVG(items, tr.base) : `<p class="muted">${t('ov.fewData')}</p>`}
        <p class="fine">${t('ov.radarNote', { base: tr.base })} <a href="#/metodo">${t('ov.how')}</a></p>
      </section>
      <section class="card">
        <h2>${t('ov.sw')}</h2>
        ${ranked.length >= 2 ? `
          <h3 class="up">${t('ov.better')}</h3>
          <ul class="themelist">${ranked.slice(0, 3).map((x) => `<li><span>${esc(x.label)}</span><b>${x.rating}</b><small>${t('ov.decSucc', { n: x.n, s: num(x.success, 0) })}</small></li>`).join('')}</ul>
          <h3 class="down">${t('ov.train')}</h3>
          <ul class="themelist">${ranked.slice(-3).reverse().map((x) => `<li><span>${esc(x.label)}</span><b>${x.rating}</b><small>${t('ov.decErr', { n: x.n, e: x.errors })}</small></li>`).join('')}</ul>` : `<p class="muted">${t('ov.need8')}</p>`}
        <h2 class="mt">${t('ov.recent')}</h2>
        <ul class="gamelist">${recent.map(gameRow).join('')}</ul>
        <a href="#/partite">${t('ov.allGames')}</a>
      </section>
    </div>
    <section class="card">
      <h2>${t('ov.allThemesT')}</h2>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>${t('th.theme')}</th><th>${t('th.rating')}</th><th>${t('th.decisions')}</th><th>${t('th.success')}</th><th>${t('th.errors')}</th><th>${t('th.conf')}</th></tr></thead>
      <tbody>${[...tr.themes].sort((a, b) => b.rating - a.rating).map((x) => `<tr><td>${esc(x.label)}</td><td><b>${x.rating}</b> <span class="delta ${x.rating >= tr.base ? 'pos' : 'neg'}">${x.rating >= tr.base ? '+' : ''}${x.rating - tr.base}</span></td><td>${x.n}</td><td>${pct(x.success)}</td><td>${x.errors}</td><td>${confLabel(x.confidence)}</td></tr>`).join('')}</tbody></table></div>
    </section>`;
  $('#radarAll').onchange = (e) => { radarAll = e.target.checked; viewOverview(); };
}

function gameRow(g) {
  const a = g.analysis;
  const acc = a ? num(a.accuracy[g.userColor]) : g.status === 'pending' ? `<span class="muted">${t('gl.queued')}</span>` : g.status === 'error' ? `<span class="neg">${t('gl.error')}</span>` : '—';
  return `<li><a href="#/partita/${g.id}">${resultBadge(g)}<span class="who"><span class="dot-col ${g.userColor}"></span>${esc(oppName(g))}</span><span class="op">${esc(a?.opening?.name?.split(':')[0] || g.headers.Opening || '')}</span><span class="acc">${acc}</span><span class="date">${fmtDate(g.date)}</span></a></li>`;
}

// ---------------------------------------------------------------- games list
async function viewGames() {
  const { games } = await loadAll();
  const mine = games.filter((g) => g.userColor).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.addedAt - a.addedAt);
  const skipped = games.filter((g) => !g.userColor);
  app.innerHTML = `
    <section class="card">
      <div class="card-h"><h2>${t('games.title', { n: mine.length })}</h2><input id="q" type="search" placeholder="${t('games.search')}"></div>
      <ul class="gamelist big" id="gl">${mine.map(gameRow).join('')}</ul>
      ${skipped.length ? `<p class="fine">${t('games.skipped', { n: skipped.length })}</p>` : ''}
    </section>`;
  $('#q').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    $('#gl').innerHTML = mine.filter((g) => (oppName(g) + ' ' + (g.analysis?.opening?.name || g.headers.Opening || '')).toLowerCase().includes(q)).map(gameRow).join('');
  };
}

// ---------------------------------------------------------------- single game
async function viewGame(id, startPly) {
  const g = await db.getGame(id);
  if (!g) { app.innerHTML = `<p class="card">${t('game.notFound')}</p>`; return; }
  const cal = eloCalibration(await db.allGames());
  const a = g.analysis;
  const H = g.headers;
  const me = g.userColor || 'w';
  app.innerHTML = `
    <div class="game-head card">
      <div class="players">
        <div class="pl ${me === 'w' ? 'me' : ''}"><span class="dot-col w"></span>${esc(H.White)} ${H.WhiteElo ? `<small>(${esc(H.WhiteElo)})</small>` : ''}</div>
        <div class="score">${esc(g.result)}</div>
        <div class="pl ${me === 'b' ? 'me' : ''}"><span class="dot-col b"></span>${esc(H.Black)} ${H.BlackElo ? `<small>(${esc(H.BlackElo)})</small>` : ''}</div>
      </div>
      <div class="meta">${fmtDate(g.date)} · ${esc(H.Event || '')} · ${esc(tcLabel(g.timeClass))} ${a?.opening ? `· <b>${esc(a.opening.eco)} ${esc(a.opening.name)}</b>` : ''}</div>
    </div>
    ${!a ? `<p class="card">${g.status === 'pending' ? t('game.pending') : g.status === 'error' ? t('game.failed', { e: esc(g.error) }) : t('game.notMine')}</p>` : ''}
    <div class="game-layout">
      <div class="board-col">
        <div class="board-wrap"><div class="evalbar"><span id="evalfill"></span><em id="evaltxt"></em></div><div id="board" class="board"></div></div>
        <div class="navbtns">
          <button data-nav="first" aria-label="${t('nav.first')}">⏮</button><button data-nav="prev" aria-label="${t('nav.prev')}">◀</button>
          <button data-nav="next" aria-label="${t('nav.next')}">▶</button><button data-nav="last" aria-label="${t('nav.last')}">⏭</button>
          <button data-nav="flip" aria-label="${t('nav.flip')}">⇅</button>
        </div>
        <div id="explain" class="explain card"></div>
        ${a ? `<div id="graph" class="card graph-card"></div>` : ''}
      </div>
      <div class="side-col">
        ${a ? summaryTable(g, cal) : ''}
        <div class="card"><h3>${t('game.moves')}</h3><div id="moves" class="moves"></div></div>
        <div class="card actions">
          <button class="btn" id="reanalyse">${t('game.reanalyse')}</button>
          <button class="btn danger" id="delgame">${t('game.delete')}</button>
        </div>
      </div>
    </div>`;

  const board = new Board($('#board'), { orientation: me });
  let ply = startPly != null ? Math.min(+startPly, g.moves.length) : a ? 0 : g.moves.length;
  const fens = [g.startFen, ...g.moves.map((m) => m.after)];

  function show() {
    const p = a?.plies[ply - 1];
    const lastUci = ply > 0 ? g.moves[ply - 1].uci : null;
    const arrows = [];
    const nextP = a?.plies[ply];
    // show the engine's best move for the position on the board
    if (nextP?.best) arrows.push({ from: nextP.best.slice(0, 2), to: nextP.best.slice(2, 4), kind: 'best' });
    board.set(fens[ply], { lastMove: lastUci, arrows, badge: p ? { sq: lastUci.slice(2, 4), cls: p.cls, sym: CLASS_INFO[p.cls].sym } : null });
    if (a) {
      const wp = a.wpWhite[ply];
      $('#evalfill').style.height = `${100 - wp}%`;
      const stm = fens[ply].split(' ')[1];
      const nextEval = a.plies[ply] ? a.plies[ply].cpBest : -a.plies[ply - 1]?.cpAfter;
      const cpW = nextEval == null ? 0 : stm === 'w' ? nextEval : -nextEval;
      $('#evaltxt').textContent = evalText(cpW);
      $('#graph').innerHTML = evalGraphSVG(a.wpWhite, a.plies, ply);
    }
    document.querySelectorAll('#moves .mv').forEach((e) => e.classList.toggle('cur', +e.dataset.ply === ply));
    $('#moves .cur')?.scrollIntoView({ block: 'nearest' });
    $('#explain').innerHTML = explain(g, p, ply);
  }

  // Move list
  const rows = [];
  for (let i = 0; i < g.moves.length; i += 2) {
    const cell = (k) => {
      if (k >= g.moves.length) return '<span></span>';
      const p = a?.plies[k];
      return `<button class="mv ${p ? 'cls-' + p.cls : ''}" data-ply="${k + 1}">${p && !['best', 'excellent', 'good', 'book'].includes(p.cls) ? clsPill(p.cls) : ''}${esc(g.moves[k].san)}</button>`;
    };
    rows.push(`<span class="no">${Math.floor(i / 2) + 1}.</span>${cell(i)}${cell(i + 1)}`);
  }
  $('#moves').innerHTML = rows.join('');
  $('#moves').onclick = (e) => { const b = e.target.closest('.mv'); if (b) { ply = +b.dataset.ply; show(); } };
  const nav = (k) => {
    if (k === 'first') ply = 0; else if (k === 'prev') ply = Math.max(0, ply - 1);
    else if (k === 'next') ply = Math.min(g.moves.length, ply + 1); else if (k === 'last') ply = g.moves.length;
    else if (k === 'flip') board.flip();
    show();
  };
  document.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => nav(b.dataset.nav)));
  const keyh = (e) => {
    if (currentView !== viewGame) return document.removeEventListener('keydown', keyh);
    if (e.key === 'ArrowLeft') nav('prev'); if (e.key === 'ArrowRight') nav('next');
  };
  document.addEventListener('keydown', keyh);
  if (a) $('#graph').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    ply = Math.round(((e.clientX - r.left) / r.width) * g.moves.length);
    show();
  };
  $('#reanalyse').onclick = async () => { await reanalyse(g.id); viewGame(id); };
  confirmClick($('#delgame'), t('game.deleteConfirm'), async () => { await db.deleteGame(g.id); location.hash = '#/partite'; });
  show();
}

function summaryTable(g, cal) {
  const elo = (c) => gameElo(g.analysis.accuracy[c], cal) ?? '—';
  const a = g.analysis, H = g.headers;
  const cell = (c, col) => `<td class="cls-${c} n">${a.counts[col][c]}</td>`;
  return `<div class="card summary">
    <table class="sumtbl">
      <thead><tr><th></th><th>${esc((H.White || '').slice(0, 14))}</th><th></th><th>${esc((H.Black || '').slice(0, 14))}</th></tr></thead>
      <tbody>
        <tr class="big"><td>${t('sum.acc')}</td><td><b class="box">${num(a.accuracy.w)}</b></td><td></td><td><b class="box">${num(a.accuracy.b)}</b></td></tr>
        <tr class="big"><td>${t('sum.elo')} <a href="#/metodo" class="q" title="${t('ov.how')}">?</a></td><td><b>${elo('w')}</b></td><td></td><td><b>${elo('b')}</b></td></tr>
        ${CLASSES.map((c) => `<tr><td>${classLabel(c)}</td>${cell(c, 'w')}<td>${clsPill(c)}</td>${cell(c, 'b')}</tr>`).join('')}
        <tr class="sep"><td colspan="4">${t('sum.phaseAcc')}</td></tr>
        ${['opening', 'middlegame', 'endgame'].map((ph) => `<tr><td>${themeLabel(ph)}</td><td class="n">${num(a.phaseAcc.w[ph])}</td><td></td><td class="n">${num(a.phaseAcc.b[ph])}</td></tr>`).join('')}
      </tbody>
    </table>
    <p class="fine">${cal ? t('sum.cal', { n: cal.n, sd: cal.sd }) : t('sum.nocal')} ${t('sum.depth', { d: a.depth })} ${a.endgameType ? t('sum.endgame', { t: themeLabel(a.endgameType) }) : ''}</p>
  </div>`;
}

function explain(g, p, ply) {
  if (ply === 0) return `<p class="muted">${t('ex.start')}</p>`;
  if (!p) return `<p>${movePrefix(g.moves[ply - 1].before)} ${esc(g.moves[ply - 1].san)}</p>`;
  const who = p.color === g.userColor ? t('ex.you') : t('ex.opp');
  let s = `<p>${clsPill(p.cls)} <b>${who} ${movePrefix(p.fen)} ${esc(p.san)}</b>: ${classLabel(p.cls).toLowerCase()}`;
  if (p.cls !== 'book') s += ` <span class="muted">${t('ex.wp', { a: num(p.wpBest, 0), b: num(p.wpAfter, 0) })}</span>`;
  s += '</p>';
  if (p.best && p.best !== p.uci && p.cls !== 'book') {
    const line = pvToSan(p.fen, p.pv, 7);
    s += `<p>${t('ex.best')}: <b>${esc(p.bestSan)}</b> <span class="muted">${esc(line.slice(1).join(' '))}</span></p>`;
  }
  const nb = g.analysis?.plies[ply];
  if (nb?.bestSan) s += `<p class="fine">${t('ex.arrow', { m: `${movePrefix(nb.fen)} ${esc(nb.bestSan)}` })}</p>`;
  if (p.themes?.length) s += `<p class="tags">${p.themes.map((k) => `<span class="tag">${esc(themeLabel(k))}</span>`).join('')}</p>`;
  return s;
}

// ---------------------------------------------------------------- statistics
async function viewStats() {
  const { games } = await loadAll();
  const ag = aggregate(games);
  if (!ag.analysed) { app.innerHTML = `<p class="card">${t('st.none')}</p>`; return; }
  const totalCls = Object.values(ag.classes).reduce((x, y) => x + y, 0) || 1;
  const trendAcc = ag.trend.map((t) => t.acc);
  const trendElo = ag.trend.map((t) => t.elo), trendHdr = ag.trend.map((t) => t.hdrElo);
  const roll = (xs, k = 5) => xs.map((_, i) => { const w = xs.slice(Math.max(0, i - k + 1), i + 1).filter((v) => v != null); return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null; });
  const per100 = (c) => num((100 * ag.classes[c]) / ag.userMoves, 1);
  const opTable = (col) => {
    const rows = ag.openings.filter((o) => o.color === col);
    if (!rows.length) return `<p class="muted">${t('st.noGames')}</p>`;
    return `<div class="scroll-x"><table class="tbl"><thead><tr><th>${t('th.opening')}</th><th>N</th><th>${t('th.results')}</th><th>${t('th.points')}</th><th>${t('th.opAcc')}</th></tr></thead><tbody>${rows.map((o) => `<tr><td><b>${esc(o.family)}</b><br><small class="muted">${esc(o.eco)} · ${esc(o.topVariation)}</small></td><td>${o.n}</td><td class="wdlcell">${wdlBar(o)}</td><td>${pct(o.score)}</td><td>${num(o.acc)}</td></tr>`).join('')}</tbody></table></div>`;
  };

  app.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span class="k">${t('st.games')}</span><span class="v">${ag.analysed}</span><small>${t('st.avgLen', { n: ag.avgMoves })}</small></div>
      <div class="kpi"><span class="k">${t('st.white')}</span><span class="v">${pct(ag.results.w.score)}</span><small>${wdlText(ag.results.w)}</small></div>
      <div class="kpi"><span class="k">${t('st.black')}</span><span class="v">${pct(ag.results.b.score)}</span><small>${wdlText(ag.results.b)}</small></div>
      <div class="kpi"><span class="k">${t('st.estElo')}</span><span class="v">${ag.estElo}</span><small>${ag.calibration ? t('st.cal', { n: ag.calibration.n, sd: ag.calibration.sd }) : t('st.nocal')}</small></div>
    </div>
    <div class="grid2">
      <section class="card">
        <h2>${t('st.trend')}</h2>
        <h3>${t('st.accTrend')}</h3>
        ${lineChartSVG([{ values: trendAcc, cls: 'faint' }, { values: roll(trendAcc), cls: 'main' }], { yMin: 30, yMax: 100, labels: [fmtDate(ag.trend[0].date), fmtDate(ag.trend.at(-1).date)] })}
        <h3>${t('st.eloTrend')}</h3>
        ${lineChartSVG([{ values: roll(trendElo), cls: 'main' }, { values: trendHdr, cls: 'alt' }], { labels: [fmtDate(ag.trend[0].date), fmtDate(ag.trend.at(-1).date)] })}
        <p class="fine"><span class="lg main"></span> ${t('st.lgEst')} <span class="lg alt"></span> ${t('st.lgHdr')}</p>
      </section>
      <section class="card">
        <h2>${t('st.quality')}</h2>
        <table class="tbl compact"><thead><tr><th></th><th>${t('st.total')}</th><th>${t('st.per100')}</th></tr></thead>
        <tbody>${CLASSES.map((c) => `<tr><td>${clsPill(c)} ${classLabel(c)}</td><td>${ag.classes[c]}</td><td>${per100(c)}</td></tr>`).join('')}</tbody></table>
        <div class="stack">${CLASSES.map((c) => `<span class="cls-bg-${c}" style="width:${((100 * ag.classes[c]) / totalCls).toFixed(2)}%" title="${classLabel(c)}"></span>`).join('')}</div>
      </section>
    </div>
    <div class="grid2">
      <section class="card"><h2>${t('st.opW')}</h2>${opTable('w')}</section>
      <section class="card"><h2>${t('st.opB')}</h2>${opTable('b')}</section>
    </div>
    <div class="grid2">
      <section class="card">
        <h2>${t('st.tactics')}</h2>
        <p class="fine">${t('st.tacticsNote')}</p>
        <table class="tbl"><thead><tr><th>${t('th.motif')}</th><th>${t('th.found')}</th><th>${t('th.missed')}</th><th>%</th></tr></thead>
        <tbody>${ag.tactics.map((x) => `<tr><td>${esc(themeLabel(x.key))}</td><td>${x.found}</td><td>${x.missed}</td><td><div class="meter"><span style="width:${x.rate}%"></span></div>${pct(x.rate)}</td></tr>`).join('')}</tbody></table>
      </section>
      <section class="card">
        <h2>${t('st.phases')}</h2>
        <div class="phases">${['opening', 'middlegame', 'endgame'].map((ph) => `<div><span>${themeLabel(ph)}</span><b>${num(ag.phases[ph])}</b><div class="meter"><span style="width:${ag.phases[ph] ?? 0}%"></span></div></div>`).join('')}</div>
        <h2 class="mt">${t('st.endgames', { n: ag.reachedEndgame })}</h2>
        ${ag.endgames.length ? `<table class="tbl"><thead><tr><th>${t('th.type')}</th><th>N</th><th>${t('th.results')}</th><th>${t('th.acc')}</th></tr></thead><tbody>${ag.endgames.map((e) => `<tr><td>${esc(themeLabel(e.key))}</td><td>${e.n}</td><td class="wdlcell">${wdlBar(e)}</td><td>${num(e.acc)}</td></tr>`).join('')}</tbody></table>` : `<p class="muted">${t('st.noEndgame')}</p>`}
      </section>
    </div>
    <div class="grid2">
      <section class="card">
        <h2>${t('st.mgmt')}</h2>
        <ul class="facts">
          <li><b>${pct(ag.conversion.rate)}</b> ${t('st.conv')} <small>${t('st.convD', { a: ag.conversion.converted, b: ag.conversion.hadWin })}</small></li>
          <li><b>${pct(ag.comebacks.rate)}</b> ${t('st.saved')} <small>${t('st.savedD', { a: ag.comebacks.saved, b: ag.comebacks.wasLost })}</small></li>
          <li><b>${pct(ag.lossesWithBlunder.rate)}</b> ${t('st.lossBl')} <small>${t('st.lossBlD', { a: ag.lossesWithBlunder.n, b: ag.lossesWithBlunder.losses })}</small></li>
          ${ag.time ? `<li><b>${ag.time.zeitnotGames}</b> ${t('st.zeit', { b: ag.time.games })} <small>${t('st.zeitD', { a: num(ag.time.accLow), b: num(ag.time.accNormal), n: ag.time.lowMoves })}</small></li>` : `<li class="muted">${t('st.noTime')}</li>`}
        </ul>
        <h2 class="mt">${t('st.byTc')}</h2>
        <table class="tbl"><thead><tr><th>${t('th.tc')}</th><th>N</th><th>${t('th.results')}</th><th>${t('th.acc')}</th></tr></thead><tbody>${ag.timeClasses.map((x) => `<tr><td>${esc(tcLabel(x.key))}</td><td>${x.n}</td><td class="wdlcell">${wdlBar(x)}</td><td>${num(x.acc)}</td></tr>`).join('')}</tbody></table>
      </section>
      <section class="card">
        <h2>${t('st.hl', { n: ag.highlights.length })}</h2>
        ${ag.highlights.length ? `<ul class="hl">${ag.highlights.slice(0, 30).map((h) => `<li><a href="#/partita/${h.gameId}/${h.ply + 1}">${clsPill(h.cls)} <b>${h.moveNo}. ${esc(h.san)}</b> ${t('st.vs')} ${esc(h.opp)} <small>${fmtDate(h.date)}</small></a></li>`).join('')}</ul>` : `<p class="muted">${t('st.noneYet')}</p>`}
      </section>
    </div>`;
}

// ---------------------------------------------------------------- training
let trainFilter = '';
let trainBusy = false;
async function viewTraining() {
  trainBusy = false;
  const { puzzles, settings } = await loadAll();
  const active = activePuzzles(puzzles, settings);
  const archived = puzzles.length - active.length;
  const themesAvail = [...new Set(active.flatMap((p) => p.themes))].filter((t) => THEMES[t]);
  const pool = active.filter((p) => !trainFilter || p.themes.includes(trainFilter));
  // Priority: puzzles failed more often, then those not seen for longest.
  pool.sort((a, b) => b.fails - b.solved - (a.fails - a.solved) || a.lastSeen - b.lastSeen);
  app.innerHTML = `
    <section class="card train-head">
      <div><h2>${t('tr.title')}</h2>
      <p class="fine">${t('tr.sub', { a: active.length, c: archived, n: settings.puzzleRepeats })}</p></div>
      <select id="tf"><option value="">${t('tr.all')}</option>${themesAvail.map((k) => `<option value="${k}" ${k === trainFilter ? 'selected' : ''}>${esc(themeLabel(k))}</option>`).join('')}</select>
    </section>
    ${pool.length ? `
    <div class="game-layout">
      <div class="board-col"><div class="board-wrap"><div id="board" class="board"></div></div></div>
      <div class="side-col"><div class="card" id="pz"></div></div>
    </div>` : `<p class="card">${active.length ? t('tr.noneTheme') : t('tr.none')}</p>`}`;
  $('#tf').onchange = (e) => { trainFilter = e.target.value; viewTraining(); };
  if (!pool.length) return;

  const p = pool[0];
  const turn = p.fen.split(' ')[1];
  let attempted = false, finished = false;
  const board = new Board($('#board'), { orientation: turn, interactive: true, onMove });
  board.set(p.fen);
  const panel = $('#pz');
  const header = `<h3>${t('tr.find')}</h3>
    <p>${t('tr.toMove', { c: turn === 'w' ? t('tr.white') : t('tr.black'), o: esc(p.opponent), d: fmtDate(p.date), m: movePrefix(p.fen) })}</p>
    <p class="tags">${p.themes.filter((k) => !['opening', 'middlegame', 'endgame'].includes(k)).map((k) => `<span class="tag">${esc(themeLabel(k))}</span>`).join('')}</p>
    <div class="progress-dots">${Array.from({ length: settings.puzzleRepeats }, (_, i) => `<span class="${i < p.solved ? 'on' : ''}"></span>`).join('')}</div>`;
  panel.innerHTML = header + `<div id="fb"></div><div class="btnrow" id="pzbtns"><button class="btn" id="hint">${t('tr.hint')}</button><button class="btn" id="giveup">${t('tr.show')}</button></div>`;
  $('#hint').onclick = () => { attempted = true; trainBusy = true; board.set(p.fen, { lastMove: null, arrows: [] }); board.selected = p.solution.slice(0, 2); board.render(); $('#fb').innerHTML = `<p class="muted">${t('tr.hintMsg')}</p>`; };
  $('#giveup').onclick = () => fail(true);

  async function onMove(uci) {
    if (finished) return;
    trainBusy = true;
    const res = new Chess(p.fen);
    const m = res.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    board.set(res.fen(), { lastMove: uci });
    if (uci === p.solution) return success(false);
    if (res.isCheckmate()) return success(true);
    $('#fb').innerHTML = `<p class="muted">${t('tr.checking')}</p>`;
    const lines = await getEngine().analyse(res.fen(), { depth: Math.min(settings.depth, 14), multipv: 1 });
    const wp = lines.length ? 100 - winPct(scoreToCp(lines[0])) : 50;
    if (p.wpBest - wp <= 3) return success(true, m.san);
    $('#fb').innerHTML = `<p class="neg">${t('tr.notEnough', { m: esc(m.san), a: num(wp, 0), b: num(p.wpBest, 0) })}</p>`;
    attempted = true;
    setTimeout(() => { if (!finished) board.set(p.fen); }, 900);
  }
  async function success(alt, san) {
    finished = true;
    board.interactive = false;
    trainBusy = true;
    const counted = !attempted;
    // Re-read before updating: another device may have synced progress since this view was drawn.
    Object.assign(p, (await db.getPuzzle(p.id)) || {});
    if (counted) p.solved++;
    p.attempts++; p.lastSeen = Date.now();
    await db.putPuzzle(p);
    document.querySelectorAll('.progress-dots span').forEach((e, i) => e.classList.toggle('on', i < p.solved));
    const gone = p.solved >= settings.puzzleRepeats;
    finish(`<p class="pos"><b>${alt ? t('tr.altOk', { m: esc(san || '') }) : t('tr.exact')}</b> ${counted ? t('tr.count', { a: p.solved, b: settings.puzzleRepeats }) : t('tr.noCount')}${gone ? t('tr.gone') : ''}</p>`);
  }
  async function fail() {
    finished = true;
    board.interactive = false;
    trainBusy = true;
    Object.assign(p, (await db.getPuzzle(p.id)) || {});
    p.fails++; p.attempts++; p.lastSeen = Date.now();
    await db.putPuzzle(p);
    board.set(p.fen, { arrows: [{ from: p.solution.slice(0, 2), to: p.solution.slice(2, 4), kind: 'best' }] });
    finish(`<p class="neg">${t('tr.here')}</p>`);
  }
  async function finish(msg) {
    const game = await db.getGame(p.gameId);
    const plies = game?.analysis?.plies || [];
    const ex = explainPuzzle(p, plies[p.ply], plies[p.ply + 1]);
    const lines = { best: ex.best, game: ex.refutation };
    let which = 'best', k = -1;
    $('#fb').innerHTML = msg + `
      <p>${t('tr.played')} <b>${esc(p.played)}</b> ${clsPill(p.cls)} <a href="#/partita/${p.gameId}/${p.ply + 1}">${t('tr.seeGame')}</a></p>
      <div class="xp"><h4>${t('xp.title')}</h4><ul>${ex.parts.map((x) => `<li>${t(x.key, Object.fromEntries(Object.entries(x.params).map(([a, b]) => [a, esc(b)])))}</li>`).join('')}</ul>
      <p class="fine">${t('xp.note')}</p></div>
      <div class="linebox">
        <div class="seg">${lines.game ? `<button class="btn sm on" data-l="best">${t('xp.lineBest')}</button><button class="btn sm" data-l="game">${t('xp.lineGame', { p: esc(p.played) })}</button>` : `<b>${t('xp.lineBest')}</b>`}</div>
        <div id="linemoves" class="linemoves"></div>
        <div class="btnrow"><button class="btn sm" id="lprev" aria-label="${t('nav.prev')}">◀</button><button class="btn sm" id="lnext" aria-label="${t('nav.next')}">▶</button> <span class="fine">${t('xp.step')}</span></div>
      </div>`;
    const label = (L, i) => { const [, turn, , , , full] = L.fens[i].split(' '); return turn === 'w' ? `${full}. ${L.san[i]}` : i === 0 ? `${full}… ${L.san[i]}` : L.san[i]; };
    const show = () => {
      const L = lines[which];
      $('#linemoves').innerHTML = L.san.map((_, i) => `<button class="mv ${i === k ? 'cur' : ''}" data-i="${i}">${esc(label(L, i))}</button>`).join(' ');
      $('#linemoves').querySelectorAll('.mv').forEach((b) => (b.onclick = () => { k = +b.dataset.i; show(); }));
      if (k < 0) board.set(p.fen, { arrows: [{ from: L.uci[0].slice(0, 2), to: L.uci[0].slice(2, 4), kind: which === 'best' ? 'best' : 'played' }] });
      else board.set(L.fens[k + 1], { lastMove: L.uci[k] });
    };
    $('#fb').querySelectorAll('[data-l]').forEach((b) => (b.onclick = () => {
      which = b.dataset.l; k = -1;
      $('#fb').querySelectorAll('[data-l]').forEach((x) => x.classList.toggle('on', x === b));
      show();
    }));
    $('#lprev').onclick = () => { k = Math.max(-1, k - 1); show(); };
    $('#lnext').onclick = () => { k = Math.min(lines[which].san.length - 1, k + 1); show(); };
    show();
    $('#pzbtns').innerHTML = `<button class="btn primary" id="next">${t('tr.next')}</button>`;
    $('#next').onclick = viewTraining;
    // Longer main line: ask the engine again from the puzzle position (the saved line stops after 8 half-moves).
    const fbEl = $('#fb');
    getEngine().analyse(p.fen, { depth: Math.max(settings.depth, 14), multipv: 1 }).then((res) => {
      const pv = res[0]?.pv || [];
      if (!fbEl.isConnected || pv[0] !== p.solution || pv.length <= lines.best.san.length) return;
      lines.best = playLine(p.fen, pv.slice(0, 16));
      if (which === 'best') show();
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------- import
async function viewImport() {
  const s = await db.getSettings();
  app.innerHTML = `
    <section class="card">
      <h2>${t('im.title')}</h2>
      <p class="fine">${t('im.lead')}</p>
      <label class="field">${t('im.users')} <small>${t('im.usersHint')}</small>
        <input id="users" value="${esc(s.usernames.join(', '))}" placeholder="${t('im.usersPh')}"></label>
    </section>
    <section class="card">
      <h3>${t('im.fromPgn')}</h3>
      <label class="drop" id="drop"><input type="file" id="file" accept=".pgn,.txt,application/x-chess-pgn" multiple hidden>
        <span>${t('im.drop')}</span></label>
      <textarea id="pgn" rows="8" placeholder="${t('im.paste')}"></textarea>
      <div class="btnrow"><button class="btn primary" id="go">${t('im.go')}</button>
      <button class="btn" id="sample">${t('im.sample')}</button></div>
      <p class="fine">${t('im.howto')}</p>
    </section>
    <div id="out"></div>`;
  const users = () => $('#users').value.split(',').map((x) => x.trim()).filter(Boolean);
  const saveUsers = async (extra = []) => {
    const list = [...new Set([...users(), ...extra])];
    const cur = await db.getSettings();
    const changed = list.join('|').toLowerCase() !== cur.usernames.join('|').toLowerCase();
    await db.saveSettings({ ...cur, usernames: list });
    if (changed) await reassignUsers(list);
    $('#users').value = list.join(', ');
    return list;
  };
  const report = (r) => {
    $('#out').innerHTML = `<div class="card ${r.added ? 'ok' : ''}"><p>${t('im.added', { a: r.added, d: r.duplicates })}${r.noUser ? ` <span class="neg">${t('im.noUser', { n: r.noUser })}</span>` : ''}</p>${r.errors.length ? `<details><summary>${t('im.errors', { n: r.errors.length })}</summary><pre>${esc(r.errors.map((e) => `${t('im.gameN', { n: e.n })}: ${errMsg(e.msg)}`).join('\n'))}</pre></details>` : ''}${r.added ? `<p>${t('im.started')} <a href="#/">${t('im.toOverview')}</a></p>` : ''}</div>`;
  };
  const doImport = async (text, extra) => {
    const list = await saveUsers(extra);
    if (!list.length) { $('#out').innerHTML = `<p class="card neg">${t('im.needUser')}</p>`; return; }
    report(await importPgnText(text, list));
  };
  const readFiles = async (files) => { const texts = await Promise.all([...files].map((f) => f.text())); await doImport(texts.join('\n\n')); };
  $('#file').onchange = (e) => readFiles(e.target.files);
  const drop = $('#drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); readFiles(e.dataTransfer.files); };
  $('#go').onclick = () => doImport($('#pgn').value);
  $('#sample').onclick = async () => {
    const t = await (await fetch(new URL('samples/esempio.pgn', document.baseURI))).text();
    await doImport(t, ['Adolf Anderssen', 'Paul Morphy']);
  };
}


// ---------------------------------------------------------------- login (only when sync is configured)
let loginEmail = '';
function viewLogin(step = loginEmail ? 'code' : 'email', msg = '') {
  const urlErr = /error_description=([^&]+)/.exec(location.hash);
  if (urlErr && !msg) { msg = decodeURIComponent(urlErr[1].replace(/\+/g, ' ')); history.replaceState(null, '', location.pathname + location.search); }
  app.innerHTML = `
    <section class="card form login">
      <h2>${t('auth.title')}</h2>
      <p class="fine">${t('auth.lead')}</p>
      ${step === 'email' ? `
        <form id="lf">
          <label class="field">${t('auth.email')}<input id="email" type="email" autocomplete="email" required value="${esc(loginEmail)}"></label>
          <button class="btn primary" id="go">${t('auth.send')}</button>
        </form>` : `
        <p>${t('auth.sent', { email: `<b>${esc(loginEmail)}</b>` })}</p>
        <form id="lf">
          <label class="field">${t('auth.code')}<input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required></label>
          <button class="btn primary" id="go">${t('auth.verify')}</button>
          <button type="button" class="btn" id="back">${t('auth.change')}</button>
        </form>`}
      <p id="lmsg" class="${msg ? 'neg' : 'fine'}">${esc(msg)}</p>
      <p class="fine">${t('auth.privacy')} <a href="#/metodo" id="lmeth">${t('auth.how')}</a></p>
    </section>`;
  $('#lmeth').onclick = (e) => { e.preventDefault(); app.insertAdjacentHTML('beforeend', `<article class="card prose">${METHOD[lang]}</article>`); e.target.remove(); };
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#go'); btn.disabled = true; $('#lmsg').className = 'fine'; $('#lmsg').textContent = t('auth.wait');
    try {
      if (step === 'email') { loginEmail = $('#email').value.trim(); await sync.sendCode(loginEmail); viewLogin('code'); }
      else { await sync.verifyCode(loginEmail, $('#code').value.trim()); loginEmail = ''; }
    } catch (err) {
      btn.disabled = false; $('#lmsg').className = 'neg'; $('#lmsg').textContent = authError(err);
    }
  };
  if (step === 'code') $('#back').onclick = () => { loginEmail = ''; viewLogin('email'); };
}
function authError(err) {
  const m = String(err?.message || err);
  if (/rate|too many|seconds/i.test(m)) return t('auth.errRate');
  if (/expired|invalid|token/i.test(m)) return t('auth.errCode');
  if (/fetch|network/i.test(m)) return t('auth.errNet');
  return m;
}

function renderSyncStatus() {
  const el = $('#syncstat'); if (!el) return;
  const st = sync.status;
  el.className = st.error ? 'neg' : 'fine';
  el.textContent = st.syncing ? t('sync.running') : st.error ? t('sync.error', { e: st.error }) : st.lastSync ? t('sync.last', { d: new Date(st.lastSync).toLocaleString(lang) }) : t('sync.never');
}

// ---------------------------------------------------------------- settings
async function viewSettings() {
  const s = await db.getSettings();
  const { games, puzzles } = await loadAll();
  app.innerHTML = `
    <section class="card form">
      <h2>${t('se.title')}</h2>
      <label class="field">${t('se.lang')}
        <select id="lang2">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === lang ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field">${t('se.users')} <small>${t('se.usersHint')}</small><input id="users" value="${esc(s.usernames.join(', '))}"></label>
      <label class="field">${t('se.depth')}
        <select id="depth">${[10, 12, 14, 16, 18].map((d) => `<option ${d === s.depth ? 'selected' : ''}>${d}</option>`).join('')}</select>
        <small>${t('se.depthHint')}</small></label>
      <label class="field">${t('se.rep')}
        <input id="rep" type="number" min="1" max="20" value="${s.puzzleRepeats}"></label>
      <label class="check"><input id="inacc" type="checkbox" ${s.includeInaccuracies ? 'checked' : ''}> ${t('se.inacc')}</label>
      <button class="btn primary" id="save">${t('se.save')}</button> <span id="saved" class="pos"></span>
    </section>
    ${sync.enabled && sync.status.user ? `<section class="card">
      <h2>${t('sync.title')}</h2>
      <p>${t('sync.as', { email: `<b>${esc(sync.status.user.email)}</b>` })}</p>
      <p id="syncstat" class="fine"></p>
      <div class="btnrow"><button class="btn" id="syncnow">${t('sync.now')}</button>
      <button class="btn danger" id="logout">${t('sync.logout')}</button></div>
      <p class="fine">${t('sync.logoutHint')}</p>
    </section>` : ''}
    <section class="card">
      <h2>${t('se.data')}</h2>
      <p class="fine">${t(sync.enabled ? 'se.dataLeadSync' : 'se.dataLead', { g: games.length, p: puzzles.length })}</p>
      <div class="btnrow"><button class="btn" id="exp">${t('se.export')}</button>
      <label class="btn">${t('se.import')}<input type="file" id="imp" accept=".json" hidden></label>
      <button class="btn" id="reall">${t('se.reall')}</button>
      <button class="btn danger" id="wipe">${t('se.wipe')}</button></div>
    </section>`;
  $('#lang2').onchange = (e) => changeLang(e.target.value);
  $('#save').onclick = async () => {
    const usernames = $('#users').value.split(',').map((x) => x.trim()).filter(Boolean);
    const changed = usernames.join('|').toLowerCase() !== s.usernames.join('|').toLowerCase();
    await db.saveSettings({ ...s, usernames, depth: +$('#depth').value, puzzleRepeats: Math.max(1, +$('#rep').value || 3), includeInaccuracies: $('#inacc').checked });
    if (changed) await reassignUsers(usernames);
    if ($('#saved')) $('#saved').textContent = t('se.saved');
  };
  $('#exp').onclick = async () => {
    const blob = new Blob([JSON.stringify(await db.exportAll())], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `taccuino-scacchi-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  $('#imp').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; await db.importAll(JSON.parse(await f.text())); runQueue(); viewSettings(); };
  confirmClick($('#reall'), t('se.reallC'), async () => { for (const g of games) if (g.userColor) await reanalyse(g.id); });
  if ($('#syncnow')) {
    renderSyncStatus();
    $('#syncnow').onclick = () => sync.sync().catch(() => {});
    confirmClick($('#logout'), t('sync.logoutC'), async () => { await sync.signOut(); });
  }
  confirmClick($('#wipe'), t(sync.enabled ? 'se.wipeCSync' : 'se.wipeC'), async () => { await db.wipe(); location.hash = '#/'; });
}

// ---------------------------------------------------------------- method
function viewMethod() {
  app.innerHTML = `<article class="card prose">${METHOD[lang]}</article>`;
}

// ---------------------------------------------------------------- boot
renderShell();
(async () => {
  try { await sync.init(); } catch (e) { console.error(e); }
  ready = true;
  await route();
  runQueue();
})();
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('sw.js').catch(() => {});
