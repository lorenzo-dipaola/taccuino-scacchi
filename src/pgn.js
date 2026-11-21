// PGN import: split multi-game files, parse, identify the user's side, extract clocks.
import { Chess } from 'chess.js';

/** Split a text containing one or more PGN games into single-game strings. */
export function splitPgn(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '').split('\n');
  const games = [];
  let cur = [];
  let inMoves = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('[') && inMoves) {
      games.push(cur.join('\n'));
      cur = [];
      inMoves = false;
    }
    if (line && !line.startsWith('[')) inMoves = true;
    cur.push(raw);
  }
  if (cur.join('').trim()) games.push(cur.join('\n'));
  return games.map((g) => g.trim()).filter(Boolean);
}

/** cyrb53 string hash -> hex id (stable dedup key). */
export function hash(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function parseClock(comment) {
  const m = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/.exec(comment || '');
  if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
}

function parseTimeControl(tc) {
  if (!tc || tc === '-' || tc === '?') return null;
  const m = /^(\d+)(?:\+(\d+(?:\.\d+)?))?$/.exec(tc.split(':')[0]);
  if (!m) return null;
  return { base: +m[1], inc: m[2] ? +m[2] : 0 };
}

export function timeClass(tc) {
  if (!tc) return 'unknown';
  const est = tc.base + 40 * tc.inc;
  if (est < 180) return 'bullet';
  if (est < 480) return 'blitz';
  if (est < 1500) return 'rapid';
  return 'classical';
}

/** Normalise "2024.03.05" / "2024-03-05" / "????.??.??" -> sortable string or ''. */
function normDate(h) {
  const d = (h.UTCDate || h.Date || '').replace(/-/g, '.');
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(d)) return '';
  const t = (h.UTCTime || h.StartTime || '').slice(0, 8);
  return d.replace(/\./g, '-') + (t ? 'T' + t : '');
}

/**
 * Parse one PGN game. `usernames` is a list of aliases; returns null colour if
 * the user does not appear in White/Black.
 */
export function parseGame(pgnText, usernames = []) {
  const chess = new Chess();
  chess.loadPgn(pgnText, { strict: false });
  const headers = chess.getHeaders();
  const comments = new Map(chess.getComments().map((c) => [c.fen, c.comment]));
  const history = chess.history({ verbose: true });
  if (!history.length) throw new Error('no-moves');

  const startFen = history[0].before;
  const moves = history.map((m) => ({
    san: m.san,
    uci: m.from + m.to + (m.promotion || ''),
    before: m.before,
    after: m.after,
    color: m.color,
    clock: parseClock(comments.get(m.after)),
  }));

  const names = usernames.map((u) => u.trim().toLowerCase()).filter(Boolean);
  const w = (headers.White || '').toLowerCase();
  const b = (headers.Black || '').toLowerCase();
  let userColor = null;
  if (names.includes(w)) userColor = 'w';
  else if (names.includes(b)) userColor = 'b';

  const tc = parseTimeControl(headers.TimeControl);
  const key = [headers.White, headers.Black, headers.Date, headers.UTCTime || headers.StartTime || '', headers.Result, moves.map((m) => m.san).join(' ')].join('|');
  return {
    id: hash(key),
    pgn: pgnText,
    headers,
    startFen,
    moves,
    userColor,
    date: normDate(headers),
    result: headers.Result || '*',
    timeControl: tc,
    timeClass: timeClass(tc),
  };
}

/** Result from the user's perspective: 1, 0.5, 0 or null. */
export function userScore(game) {
  const r = game.result;
  if (!game.userColor || !['1-0', '0-1', '1/2-1/2'].includes(r)) return null;
  if (r === '1/2-1/2') return 0.5;
  return (r === '1-0') === (game.userColor === 'w') ? 1 : 0;
}
