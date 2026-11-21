// Sign-in by email (6-digit code or magic link) and two-way sync with Supabase.
// Model: one row per object (game, puzzle, settings) in public.user_data.
// Push: every locally changed object is upserted. Pull: rows changed on the
// server since the last pull are applied locally, unless the same object has
// unsynced local changes (then the local version wins and is pushed next).
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import * as db from './db.js';

export const enabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export const syncBus = new EventTarget();
const emit = (type) => syncBus.dispatchEvent(new Event(type));

export const status = { user: null, syncing: false, lastSync: null, error: null };

const client = enabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' } })
  : null;

const PUSH_CHUNK = 20;
const PULL_PAGE = 200;

/** Resolve the current session (also handles a magic-link redirect). */
export async function init() {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  status.user = data.session?.user || null;
  status.lastSync = (await db.getKv('lastSync')) || null;
  client.auth.onAuthStateChange((_ev, session) => {
    const before = status.user?.id;
    status.user = session?.user || null;
    if (status.user && status.user.id !== before) syncSoon(0);
    emit('auth');
  });
  if (status.user) syncSoon(0);
  // Sync when data changes, when the app comes back to the foreground and when the network returns.
  db.bus.addEventListener('local-change', () => syncSoon(4000));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncSoon(0); });
  window.addEventListener('online', () => syncSoon(0));
  return status.user;
}

export async function sendCode(email) {
  const redirect = location.origin + location.pathname;
  const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyCode(email, token) {
  const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
  status.user = data.user;
  emit('auth');
  await sync();
  return data.user;
}

/** Sign out: upload pending changes, then clear this device. */
export async function signOut() {
  try { await sync(); } catch {}
  await client.auth.signOut();
  await db.clearLocal();
  status.user = null;
  status.lastSync = null;
  emit('auth');
}

let timer = null;
export function syncSoon(ms = 3000) {
  if (!client || !status.user) return;
  clearTimeout(timer);
  timer = setTimeout(() => sync().catch(() => {}), ms);
}

let running = null;
let again = false;
/** Run one sync; a call during a running sync schedules another one right after it. */
export function sync() {
  if (!client || !status.user) return Promise.resolve();
  if (running) { again = true; return running; }
  running = doSync().finally(() => {
    running = null;
    if (again) { again = false; syncSoon(0); }
  });
  return running;
}

async function doSync() {
  if (!navigator.onLine) return;
  status.syncing = true; status.error = null; emit('status');
  try {
    const uid = status.user.id;
    // First sign-in on this device (or another account): upload what is already here.
    if ((await db.getKv('syncUser')) !== uid) {
      await db.markAllDirty();
      await db.setKv('lastPull', null);
      await db.setKv('syncUser', uid);
    }
    await push(uid);
    const n = await pull();
    status.lastSync = new Date().toISOString();
    await db.setKv('lastSync', status.lastSync);
    if (n) emit('pulled');
  } catch (e) {
    status.error = e.message || String(e);
    throw e;
  } finally {
    status.syncing = false;
    emit('status');
  }
}

async function push(uid) {
  const dirty = await db.allDirty();
  for (let i = 0; i < dirty.length; i += PUSH_CHUNK) {
    const chunk = dirty.slice(i, i + PUSH_CHUNK);
    const rows = [];
    for (const d of chunk) {
      const data = d.deleted ? null : await db.readObject(d.kind, d.id);
      rows.push({ user_id: uid, kind: d.kind, id: d.id, data: data ?? null, deleted: d.deleted || data == null });
    }
    const { error } = await client.from('user_data').upsert(rows, { onConflict: 'user_id,kind,id' });
    if (error) throw error;
    await db.clearDirty(chunk);
  }
}

async function pull() {
  const last = await db.getKv('lastPull');
  // Re-read a few seconds of overlap: rows committed slightly out of order are not missed.
  const since = last ? new Date(new Date(last).getTime() - 5000).toISOString() : null;
  let applied = 0, newest = last, from = 0;
  for (;;) {
    let q = client.from('user_data').select('kind,id,data,deleted,updated_at').order('updated_at', { ascending: true }).range(from, from + PULL_PAGE - 1);
    if (since) q = q.gte('updated_at', since);
    const { data, error } = await q;
    if (error) throw error;
    if (!data.length) break;
    applied += await db.applyRemote(data);
    newest = data[data.length - 1].updated_at;
    if (data.length < PULL_PAGE) break;
    from += PULL_PAGE;
  }
  if (newest) await db.setKv('lastPull', newest);
  return applied;
}
