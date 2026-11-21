// Thin UCI wrapper around Stockfish (WASM, single-threaded "lite" build) in a Web Worker.
export class Engine {
  constructor(url) {
    this.url = url;
    this.worker = null;
    this.listeners = new Set();
    this.chain = Promise.resolve();
  }

  async start() {
    if (this.worker) return;
    this.worker = new Worker(this.url);
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      for (const f of [...this.listeners]) f(line);
    };
    this.send('uci');
    await this.until((l) => l === 'uciok');
    this.send('setoption name Hash value 32');
    await this.ready();
  }

  send(cmd) { this.worker.postMessage(cmd); }

  until(pred) {
    return new Promise((resolve) => {
      const f = (l) => { if (pred(l)) { this.listeners.delete(f); resolve(l); } };
      this.listeners.add(f);
    });
  }

  async ready() { this.send('isready'); await this.until((l) => l === 'readyok'); }

  /** Serialised analysis: resolves to [{cp|mate, pv:[uci], depth}] sorted by multipv. */
  analyse(fen, { depth = 12, multipv = 1, movetime } = {}) {
    const job = this.chain.then(() => this._analyse(fen, depth, multipv, movetime));
    this.chain = job.catch(() => {});
    return job;
  }

  async _analyse(fen, depth, multipv, movetime) {
    await this.start();
    const lines = [];
    const onInfo = (l) => {
      if (!l.startsWith('info') || !l.includes(' pv ')) return;
      const m = /multipv (\d+)/.exec(l);
      const k = m ? +m[1] - 1 : 0;
      const sc = / score (cp|mate) (-?\d+)/.exec(l);
      if (!sc) return;
      const d = +(/ depth (\d+)/.exec(l)?.[1] || 0);
      const pv = l.split(' pv ')[1].trim().split(/\s+/);
      lines[k] = { depth: d, pv, ...(sc[1] === 'cp' ? { cp: +sc[2] } : { mate: +sc[2] }) };
    };
    this.listeners.add(onInfo);
    this.send(`setoption name MultiPV value ${multipv}`);
    this.send(`position fen ${fen}`);
    this.send(movetime ? `go movetime ${movetime}` : `go depth ${depth}`);
    await this.until((l) => l.startsWith('bestmove'));
    this.listeners.delete(onInfo);
    return lines.filter(Boolean);
  }

  stop() { if (this.worker) this.send('stop'); }
  terminate() { this.worker?.terminate(); this.worker = null; this.chain = Promise.resolve(); }
}
