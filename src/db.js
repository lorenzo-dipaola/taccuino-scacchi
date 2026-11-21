// Local persistence (IndexedDB). Everything stays in the browser.
import { openDB } from 'idb';

const dbp = openDB('taccuino-scacchi', 1, {
  upgrade(db) {
    db.createObjectStore('games', { keyPath: 'id' });
    db.createObjectStore('puzzles', { keyPath: 'id' });
    db.createObjectStore('kv');
  },
});

export const DEFAULT_SETTINGS = {
  usernames: [],
  depth: 14,
  puzzleRepeats: 3,
  includeInaccuracies: false,
};

export async function getSettings() {
  const s = await (await dbp).get('kv', 'settings');
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}
export async function saveSettings(s) { await (await dbp).put('kv', s, 'settings'); }

export async function allGames() { return (await dbp).getAll('games'); }
export async function getGame(id) { return (await dbp).get('games', id); }
export async function putGame(g) { await (await dbp).put('games', g); }
export async function hasGame(id) { return !!(await (await dbp).getKey('games', id)); }
export async function deleteGame(id) {
  const db = await dbp;
  await db.delete('games', id);
  const tx = db.transaction('puzzles', 'readwrite');
  for (const p of await tx.store.getAll()) if (p.gameId === id) await tx.store.delete(p.id);
  await tx.done;
}

export async function allPuzzles() { return (await dbp).getAll('puzzles'); }
export async function putPuzzle(p) { await (await dbp).put('puzzles', p); }
/** Add puzzles without overwriting progress on ones that already exist. */
export async function addPuzzles(list) {
  const db = await dbp;
  const tx = db.transaction('puzzles', 'readwrite');
  for (const p of list) if (!(await tx.store.getKey(p.id))) await tx.store.put(p);
  await tx.done;
}

export async function exportAll() {
  const db = await dbp;
  return { version: 1, exportedAt: new Date().toISOString(), settings: await getSettings(), games: await db.getAll('games'), puzzles: await db.getAll('puzzles') };
}
export async function importAll(data) {
  const db = await dbp;
  const tx = db.transaction(['games', 'puzzles'], 'readwrite');
  for (const g of data.games || []) await tx.objectStore('games').put(g);
  for (const p of data.puzzles || []) await tx.objectStore('puzzles').put(p);
  await tx.done;
  if (data.settings) await saveSettings({ ...(await getSettings()), ...data.settings });
}
export async function wipe() {
  const db = await dbp;
  await db.clear('games');
  await db.clear('puzzles');
}
