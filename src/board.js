// SVG chessboard: display, arrows, move highlights, click or drag to move.
import { Chess } from 'chess.js';
import { PIECES } from './pieces.js';

const NS = 'http://www.w3.org/2000/svg';
const FILES = 'abcdefgh';
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

export class Board {
  /**
   * @param {HTMLElement} host
   * @param {{orientation?: 'w'|'b', interactive?: boolean, onMove?: (uci:string)=>void}} opts
   */
  constructor(host, opts = {}) {
    this.host = host;
    this.orientation = opts.orientation || 'w';
    this.interactive = !!opts.interactive;
    this.onMove = opts.onMove;
    this.fen = new Chess().fen();
    this.arrows = [];
    this.marks = {};
    this.badge = null;
    this.selected = null;
    this.svg = el('svg', { viewBox: '0 0 8 8', class: 'board-svg', role: 'img', 'aria-label': 'Scacchiera' });
    host.replaceChildren(this.svg);
    this._bindPointer();
    this.render();
  }

  set(fen, { lastMove = null, arrows = [], badge = null } = {}) {
    this.fen = fen;
    this.lastMove = lastMove;
    this.arrows = arrows;
    this.badge = badge;
    this.selected = null;
    this.render();
  }

  flip() { this.orientation = this.orientation === 'w' ? 'b' : 'w'; this.render(); }

  sqXY(sq) {
    const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1;
    return this.orientation === 'w' ? [f, 7 - r] : [7 - f, r];
  }
  xySq(x, y) {
    const f = this.orientation === 'w' ? x : 7 - x;
    const r = this.orientation === 'w' ? 7 - y : y;
    return FILES[f] + (r + 1);
  }

  render() {
    const s = this.svg;
    s.replaceChildren();
    const chess = new Chess(this.fen);
    const board = chess.board();
    const hl = new Set(this.lastMove ? [this.lastMove.slice(0, 2), this.lastMove.slice(2, 4)] : []);
    const legalTargets = new Set();
    if (this.selected) for (const m of chess.moves({ square: this.selected, verbose: true })) legalTargets.add(m.to);

    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const sq = this.xySq(x, y);
      const light = (x + y) % 2 === 0;
      s.append(el('rect', { x, y, width: 1, height: 1, class: light ? 'sq-l' : 'sq-d' }));
      if (hl.has(sq)) s.append(el('rect', { x, y, width: 1, height: 1, class: 'sq-last' }));
      if (sq === this.selected) s.append(el('rect', { x, y, width: 1, height: 1, class: 'sq-sel' }));
      if (x === 0) { const t = el('text', { x: 0.04, y: y + 0.2, class: 'coord ' + (light ? 'on-l' : 'on-d') }); t.textContent = sq[1]; s.append(t); }
      if (y === 7) { const t = el('text', { x: x + 0.82, y: 7.96, class: 'coord ' + (light ? 'on-l' : 'on-d') }); t.textContent = sq[0]; s.append(t); }
    }
    if (chess.inCheck()) {
      for (const row of board) for (const p of row) if (p && p.type === 'k' && p.color === chess.turn()) {
        const [x, y] = this.sqXY(p.square);
        s.append(el('circle', { cx: x + 0.5, cy: y + 0.5, r: 0.48, class: 'sq-check' }));
      }
    }
    for (const row of board) for (const p of row) {
      if (!p) continue;
      const [x, y] = this.sqXY(p.square);
      const img = el('image', { href: PIECES[p.color + p.type], x, y, width: 1, height: 1, 'data-sq': p.square, class: 'piece' });
      if (this.dragging && this.dragging.from === p.square) img.setAttribute('opacity', '0.35');
      s.append(img);
    }
    for (const t of legalTargets) {
      const [x, y] = this.sqXY(t);
      const occupied = chess.get(t);
      s.append(occupied ? el('circle', { cx: x + 0.5, cy: y + 0.5, r: 0.44, class: 'dot-cap' }) : el('circle', { cx: x + 0.5, cy: y + 0.5, r: 0.14, class: 'dot' }));
    }
    const defs = el('defs');
    s.prepend(defs);
    this.arrows.forEach((a, i) => this._arrow(defs, a, i));
    if (this.badge) {
      const [x, y] = this.sqXY(this.badge.sq);
      const g = el('g', { class: 'badge cls-' + this.badge.cls });
      g.append(el('circle', { cx: x + 0.86, cy: y + 0.14, r: 0.2 }));
      const t = el('text', { x: x + 0.86, y: y + 0.21 });
      t.textContent = this.badge.sym;
      g.append(t);
      s.append(g);
    }
    if (this.dragging?.pos) {
      const p = chess.get(this.dragging.from);
      if (p) s.append(el('image', { href: PIECES[p.color + p.type], x: this.dragging.pos[0] - 0.5, y: this.dragging.pos[1] - 0.5, width: 1, height: 1, class: 'piece drag' }));
    }
  }

  _arrow(defs, { from, to, kind = 'best' }, i) {
    const [x1, y1] = this.sqXY(from), [x2, y2] = this.sqXY(to);
    const id = 'ah' + i + Math.random().toString(36).slice(2, 6);
    const m = el('marker', { id, viewBox: '0 0 10 10', refX: 5, refY: 5, markerWidth: 3, markerHeight: 3, orient: 'auto-start-reverse' });
    m.append(el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrow-head ' + kind }));
    defs.append(m);
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    const ex = x2 + 0.5 - (dx / len) * 0.35, ey = y2 + 0.5 - (dy / len) * 0.35;
    this.svg.append(el('line', { x1: x1 + 0.5, y1: y1 + 0.5, x2: ex, y2: ey, class: 'arrow ' + kind, 'marker-end': `url(#${id})` }));
  }

  _pt(e) {
    const r = this.svg.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 8, ((e.clientY - r.top) / r.height) * 8];
  }

  _bindPointer() {
    this.svg.addEventListener('pointerdown', (e) => {
      if (!this.interactive) return;
      const [px, py] = this._pt(e);
      const sq = this.xySq(Math.floor(px), Math.floor(py));
      const chess = new Chess(this.fen);
      const p = chess.get(sq);
      if (this.selected && this.selected !== sq && !(p && p.color === chess.turn())) {
        this._try(this.selected, sq);
        return;
      }
      if (p && p.color === chess.turn()) {
        this.selected = sq;
        this.dragging = { from: sq, pos: null };
        this.svg.setPointerCapture(e.pointerId);
        this.render();
      } else {
        this.selected = null;
        this.render();
      }
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.dragging.pos = this._pt(e);
      this.render();
    });
    this.svg.addEventListener('pointerup', (e) => {
      if (!this.dragging) return;
      const d = this.dragging;
      this.dragging = null;
      if (d.pos) {
        const sq = this.xySq(Math.max(0, Math.min(7, Math.floor(d.pos[0]))), Math.max(0, Math.min(7, Math.floor(d.pos[1]))));
        if (sq !== d.from) { this._try(d.from, sq); return; }
      }
      this.render();
    });
  }

  async _try(from, to) {
    const chess = new Chess(this.fen);
    const legal = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    this.selected = null;
    if (!legal.length) { this.render(); return; }
    let promo = '';
    if (legal[0].promotion) promo = await this._askPromotion(chess.turn());
    this.render();
    this.onMove?.(from + to + promo);
  }

  _askPromotion(color) {
    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.className = 'promo';
      for (const t of ['q', 'r', 'b', 'n']) {
        const b = document.createElement('button');
        b.innerHTML = `<img src="${PIECES[color + t]}" alt="${t}">`;
        b.onclick = () => { box.remove(); resolve(t); };
        box.append(b);
      }
      this.host.append(box);
    });
  }
}
