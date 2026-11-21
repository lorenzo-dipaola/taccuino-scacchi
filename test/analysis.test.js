import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { splitPgn, parseGame } from '../src/pgn.js';
import { analyzeGame, puzzlesFromAnalysis } from '../src/analysis.js';
import { themeRatings, aggregate } from '../src/stats.js';
import { motifsOfMove } from '../src/motifs.js';
import { nodeEngine } from './node-engine.js';

test('motifs', () => {
  // Knight fork Nc7+ hitting king e8 and rook a8
  assert.ok(motifsOfMove('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', 'd5c7').has('fork'));
  // Bishop pin Bb5 pinning Nc6 to Ke8
  assert.ok(motifsOfMove('4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', 'f1b5').has('pin'));
  // Discovered check: Nd5 moves away from Rd1..d8 line? use rook on e1, knight e4 moves, king e8
  assert.ok(motifsOfMove('4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1', 'e4c5').has('discovered'));
  // Queen sacrifice Qb8+ in the Opera game final position
  assert.ok(motifsOfMove('1n1rkb1r/p4ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16', 'b3b8').has('sacrifice'));
});

test('full pipeline on sample games', { timeout: 600000 }, async () => {
  const eng = nodeEngine();
  const texts = splitPgn(fs.readFileSync('public/samples/esempio.pgn', 'utf8'));
  assert.equal(texts.length, 3);
  const games = [];
  for (const t of texts) {
    const g = parseGame(t, ['Adolf Anderssen', 'Paul Morphy']);
    assert.equal(g.userColor, 'w');
    g.addedAt = Date.now();
    g.analysis = await analyzeGame(g, eng, { depth: 10 });
    games.push(g);
    const a = g.analysis;
    console.log(g.headers.White, '-', g.headers.Black, '|', a.opening?.name, '| acc', a.accuracy, 'elo', a.elo);
    console.log('  ', a.plies.filter((p) => p.color === 'w').map((p) => `${p.san}:${p.cls}`).join(' '));
    console.log('   puzzles:', puzzlesFromAnalysis(g, a).map((p) => `${p.played}->${p.solutionSan}`).join(', '));
  }
  eng.quit();
  const tr = themeRatings(games);
  console.log('base', tr.base, tr.baseSource, tr.themes.map((t) => `${t.label}:${t.rating}(${t.n})`).join(', '));
  const ag = aggregate(games);
  console.log(JSON.stringify({ acc: ag.accuracy, classes: ag.classes, phases: ag.phases, tactics: ag.tactics, highlights: ag.highlights.length }));
  assert.ok(games[0].analysis.plies.some((p) => p.san === 'Qb8+' && (p.cls === 'brilliant' || p.cls === 'best' || p.cls === 'great')));
});

test('elo calibration follows header ratings', async () => {
  const { eloCalibration, gameElo } = await import('../src/stats.js');
  const games = [];
  for (let i = 0; i < 10; i++) games.push({ analysis: { accuracy: { w: 70 + i, b: 75 - i } }, headers: { WhiteElo: String(1300 + i * 20), BlackElo: String(1400 - i * 20) } });
  const cal = eloCalibration(games);
  assert.ok(cal && cal.n === 20);
  const e = gameElo(75, cal);
  assert.ok(Math.abs(e - 1400) < 100, 'calibrated ' + e);
  assert.equal(eloCalibration(games.slice(0, 2)), null);
});
