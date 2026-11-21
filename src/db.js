// Local persistence (IndexedDB). Every local change is also recorded in the
// 'dirty' store so that sync.js can upload it when the user is signed in.
import { openDB } from 'idb';

const dbp = openDB('taccuino-scacchi', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('games', { keyPath: 'id' });
      db.createObjectStore('puzzles', { keyPath: 'id' });
      db.createObjectStore('kv');
    }
    if (oldVersion < 2) db.createObjectStore('dirty', { keyPath: 'key' });
  },
});

export const bus = new EventTarget();
const changed = () => bus.dispatchEvent(new Event('local-change'));

export const DEFAULT_SETTINGS = {
  usernames: [],
  depth: 14,
  puzzleRepeats: 3,
  includeInaccuracies: false,
};

const STORE = { game: 'games', puzzle: 'puzzles' };
const mark = (tx, kind, id, deleted = false) => tx.objectStore('dirty').put({ key: `${kind}:${id}`, kind, id, deleted, at: Date.now() });

export async function getSettings() {
  const s = await (await dbp).get('kv', 'settings');
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}
export async function saveSettings(s) {
  const db = await dbp;
  const tx = db.transaction(['kv', 'dirty'], 'readwrite');
  await tx.objectStore('kv').put(s, 'settings');
  await mark(tx, 'settings', 'settings');
  await tx.done;
  changed();
}

export async function allGames() { return (await dbp).getAll('games'); }
export async function getGame(id) { return (await dbp).get('games', id); }
export async function hasGame(id) { return !!(await (await dbp).getKey('games', id)); }
export async function putGame(g) {
  const db = await dbp;
  const tx = db.transaction(['games', 'dirty'], 'readwrite');
  await tx.objectStore('games').put(g);
  await mark(tx, 'game', g.id);
  await tx.done;
  changed();
}
export async function deleteGame(id) {
  const db = await dbp;
  const tx = db.transaction(['games', 'puzzles', 'dirty'], 'readwrite');
  await tx.objectStore('games').delete(id);
  await mark(tx, 'game', id, true);
  for (const p of await tx.objectStore('puzzles').getAll()) {
    if (p.gameId === id) { await tx.objectStore('puzzles').delete(p.id); await mark(tx, 'puzzle', p.id, true); }
  }
  await tx.done;
  changed();
}

export async function allPuzzles() { return (await dbp).getAll('puzzles'); }
export async function putPuzzle(p) {
  const db = await dbp;
  const tx = db.transaction(['puzzles', 'dirty'], 'readwrite');
  await tx.objectStore('puzzles').put(p);
  await mark(tx, 'puzzle', p.id);
  await tx.done;
  changed();
}
/** Add puzzles without overwriting progress on ones that already exist. */
export async function addPuzzles(list) {
  const db = await dbp;
  const tx = db.transaction(['puzzles', 'dirty'], 'readwrite');
  for (const p of list) {
    if (!(await tx.objectStore('puzzles').getKey(p.id))) { await tx.objectStore('puzzles').put(p); await mark(tx, 'puzzle', p.id); }
  }
  await tx.done;
  changed();
}

export async function exportAll() {
  const db = await dbp;
  return { version: 1, exportedAt: new Date().toISOString(), settings: await getSettings(), games: await db.getAll('games'), puzzles: await db.getAll('puzzles') };
}
export async function importAll(data) {
  const db = await dbp;
  const tx = db.transaction(['games', 'puzzles', 'dirty'], 'readwrite');
  for (const g of data.games || []) { await tx.objectStore('games').put(g); await mark(tx, 'game', g.id); }
  for (const p of data.puzzles || []) { await tx.objectStore('puzzles').put(p); await mark(tx, 'puzzle', p.id); }
  await tx.done;
  if (data.settings) await saveSettings({ ...(await getSettings()), ...data.settings });
  changed();
}
/** Delete everything; when signed in, the deletions are synced too. */
export async function wipe() {
  const db = await dbp;
  const tx = db.transaction(['games', 'puzzles', 'dirty'], 'readwrite');
  for (const id of await tx.objectStore('games').getAllKeys()) await mark(tx, 'game', id, true);
  for (const id of await tx.objectStore('puzzles').getAllKeys()) await mark(tx, 'puzzle', id, true);
  await tx.objectStore('games').clear();
  await tx.objectStore('puzzles').clear();
  await tx.done;
  changed();
}

// ---------------------------------------------------------------- sync helpers
export async function getKv(key) { return (await dbp).get('kv', key); }
export async function setKv(key, value) { await (await dbp).put('kv', value, key); }
export async function allDirty() { return (await dbp).getAll('dirty'); }

/** Remove dirty entries that have not changed since they were read. */
export async function clearDirty(entries) {
  const db = await dbp;
  const tx = db.transaction('dirty', 'readwrite');
  for (const e of entries) {
    const cur = await tx.store.get(e.key);
    if (cur && cur.at === e.at) await tx.store.delete(e.key);
  }
  await tx.done;
}

/** Read the local object a dirty entry refers to. */
export async function readObject(kind, id) {
  if (kind === 'settings') return getSettings();
  return (await dbp).get(STORE[kind], id);
}

/** Apply a row coming from the server without marking it dirty. Local unsynced changes win. */
export async function applyRemote(rows) {
  const db = await dbp;
  const tx = db.transaction(['games', 'puzzles', 'kv', 'dirty'], 'readwrite');
  let n = 0;
  for (const r of rows) {
    if (await tx.objectStore('dirty').get(`${r.kind}:${r.id}`)) continue;
    if (r.kind === 'settings') {
      if (!r.deleted && r.data) await tx.objectStore('kv').put(r.data, 'settings');
    } else if (STORE[r.kind]) {
      const st = tx.objectStore(STORE[r.kind]);
      if (r.deleted) await st.delete(r.id);
      else await st.put(r.data);
    }
    n++;
  }
  await tx.done;
  return n;
}

/** Mark every local object as changed (first sign-in on a device that already had data). */
export async function markAllDirty() {
  const db = await dbp;
  const tx = db.transaction(['games', 'puzzles', 'kv', 'dirty'], 'readwrite');
  for (const id of await tx.objectStore('games').getAllKeys()) await mark(tx, 'game', id);
  for (const id of await tx.objectStore('puzzles').getAllKeys()) await mark(tx, 'puzzle', id);
  if (await tx.objectStore('kv').get('settings')) await mark(tx, 'settings', 'settings');
  await tx.done;
}

/** Clear all local data and sync state (used at sign-out). */
export async function clearLocal() {
  const db = await dbp;
  for (const s of ['games', 'puzzles', 'dirty']) await db.clear(s);
  for (const k of ['settings', 'lastPull', 'syncUser', 'lastSync']) await db.delete('kv', k);
}
