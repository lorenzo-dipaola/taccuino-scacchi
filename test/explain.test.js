import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainPuzzle, materialBalance } from '../src/explain.js';

test('material balance', () => {
  assert.equal(materialBalance('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', 'w'), -2);
});

test('knight fork wins the rook', () => {
  const p = { fen: 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', solution: 'd5c7', pv: ['d5c7', 'e8d7', 'c7a8'], played: 'Ke2', wpBest: 95 };
  const ply = { uci: 'e1e2', mate: null, wpAfter: 50 };
  const reply = { pv: ['a8a2'], mate: null };
  const { parts, best, refutation } = explainPuzzle(p, ply, reply);
  const keys = parts.map((x) => x.key);
  assert.ok(keys.includes('xp.fork'), keys.join());
  const gain = parts.find((x) => x.key === 'xp.gain');
  assert.equal(gain.params.n, 5);
  assert.deepEqual(best.san, ['Nc7+', 'Kd7', 'Nxa8']);
  assert.equal(refutation.san[0], 'Ke2');
  assert.ok(keys.includes('xp.refPos'));
  assert.ok(keys.includes('xp.wp'));
});

test('capture that is taken back is not counted as a gain', () => {
  // Qxd5 wins a pawn but the queen is recaptured by the c6 pawn.
  const p = { fen: '4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1', solution: 'd1d5', pv: ['d1d5'], played: 'Ke2', wpBest: 10 };
  const { parts } = explainPuzzle(p, null, null);
  assert.equal(parts.find((x) => x.key === 'xp.limit')?.params.n, 8);
});
