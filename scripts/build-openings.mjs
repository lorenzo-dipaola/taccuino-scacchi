// Builds src/openings.json from lichess-org/chess-openings (CC0) TSV files.
import { Chess } from 'chess.js';
import fs from 'fs';
const out = {};
for (const f of ['a','b','c','d','e']) {
  const lines = fs.readFileSync(`data/${f}.tsv`, 'utf8').trim().split('\n').slice(1);
  for (const l of lines) {
    const [eco, name, pgn] = l.split('\t');
    const c = new Chess();
    c.loadPgn(pgn);
    const key = c.fen().split(' ').slice(0, 4).join(' ');
    if (!out[key] || out[key][1].length > name.length) out[key] = [eco, name];
  }
}
fs.writeFileSync('src/openings.json', JSON.stringify(out));
console.log(Object.keys(out).length, 'positions');
