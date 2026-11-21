// Import + background analysis queue. Every finished game triggers a
// 'data-changed' event so radar, statistics and puzzles refresh incrementally.
import { Engine } from './engine.js';
import { splitPgn, parseGame } from './pgn.js';
import { analyzeGame, puzzlesFromAnalysis } from './analysis.js';
import * as db from './db.js';

export const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

let engine = null;
export function getEngine() {
  engine ??= new Engine(new URL('engine/stockfish-18-lite-single.js', document.baseURI).href);
  return engine;
}

export const state = { running: false, current: null, progress: 0, pending: 0 };

/** Import PGN text. Returns counts; duplicates are skipped. */
export async function importPgnText(text, usernames) {
  const res = { added: 0, duplicates: 0, errors: [], noUser: 0 };
  const chunks = splitPgn(text);
  for (const [k, chunk] of chunks.entries()) {
    try {
      const g = parseGame(chunk, usernames);
      if (await db.hasGame(g.id)) { res.duplicates++; continue; }
      g.addedAt = Date.now() + k;
      g.status = g.userColor ? 'pending' : 'skipped';
      if (!g.userColor) res.noUser++;
      await db.putGame(g);
      res.added++;
    } catch (e) {
      res.errors.push({ n: k + 1, msg: e.message });
    }
  }
  emit('data-changed');
  run();
  return res;
}

/** Re-assign colours after the usernames change (games skipped before may become analysable). */
export async function reassignUsers(usernames) {
  const names = usernames.map((u) => u.toLowerCase());
  for (const g of await db.allGames()) {
    const w = (g.headers.White || '').toLowerCase(), b = (g.headers.Black || '').toLowerCase();
    const c = names.includes(w) ? 'w' : names.includes(b) ? 'b' : null;
    if (c !== g.userColor) {
      g.userColor = c;
      g.status = c ? 'pending' : 'skipped';
      delete g.analysis;
      await db.putGame(g);
    }
  }
  emit('data-changed');
  run();
}

export async function reanalyse(id) {
  const g = await db.getGame(id);
  if (!g || !g.userColor) return;
  g.status = 'pending';
  delete g.analysis;
  await db.putGame(g);
  emit('data-changed');
  run();
}

/** Process pending games one by one (oldest added first). */
export async function run() {
  if (state.running) return;
  state.running = true;
  try {
    for (;;) {
      const settings = await db.getSettings();
      const pending = (await db.allGames()).filter((g) => g.status === 'pending').sort((a, b) => a.addedAt - b.addedAt);
      state.pending = pending.length;
      if (!pending.length) break;
      const g = pending[0];
      state.current = g.id;
      state.label = `${g.headers.White} – ${g.headers.Black}`;
      state.progress = 0;
      emit('progress', state);
      try {
        g.analysis = await analyzeGame(g, getEngine(), {
          depth: settings.depth,
          onProgress: (i, n) => { state.progress = i / n; emit('progress', state); },
        });
        g.status = 'done';
        await db.putGame(g);
        await db.addPuzzles(puzzlesFromAnalysis(g, g.analysis, { includeInaccuracies: settings.includeInaccuracies }));
      } catch (e) {
        console.error(e);
        g.status = 'error';
        g.error = String(e.message || e);
        await db.putGame(g);
      }
      emit('data-changed');
    }
  } finally {
    state.running = false;
    state.current = null;
    state.pending = 0;
    emit('progress', state);
  }
}
