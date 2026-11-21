// Node adapter: runs the same Stockfish build as a child process (tests only).
import { spawn } from 'child_process';
import { createInterface } from 'readline';
export function nodeEngine(path = 'node_modules/stockfish/bin/stockfish-18-lite-single.js') {
  const p = spawn('node', [path]);
  const rl = createInterface({ input: p.stdout });
  const ls = new Set();
  rl.on('line', (l) => ls.forEach((f) => f(l)));
  const send = (c) => p.stdin.write(c + '\n');
  const until = (pred) => new Promise((r) => { const f = (l) => { if (pred(l)) { ls.delete(f); r(l); } }; ls.add(f); });
  let chain = (async () => { send('uci'); await until((l) => l === 'uciok'); })();
  return {
    analyse(fen, { depth = 10, multipv = 1 } = {}) {
      const job = chain.then(async () => {
        const lines = [];
        const f = (l) => {
          if (!l.startsWith('info') || !l.includes(' pv ')) return;
          const k = +(/multipv (\d+)/.exec(l)?.[1] || 1) - 1;
          const sc = / score (cp|mate) (-?\d+)/.exec(l); if (!sc) return;
          lines[k] = { pv: l.split(' pv ')[1].trim().split(/\s+/), ...(sc[1] === 'cp' ? { cp: +sc[2] } : { mate: +sc[2] }) };
        };
        ls.add(f);
        send(`setoption name MultiPV value ${multipv}`); send(`position fen ${fen}`); send(`go depth ${depth}`);
        await until((l) => l.startsWith('bestmove')); ls.delete(f);
        return lines.filter(Boolean);
      });
      chain = job.catch(() => {});
      return job;
    },
    quit() { p.kill(); },
  };
}
