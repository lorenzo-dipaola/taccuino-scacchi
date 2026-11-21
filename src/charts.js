// Hand-written SVG charts: skill radar, evaluation graph, rating trend, bars.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Split a label into at most two lines near the middle. */
function wrap(label, max) {
  if (label.length <= max || !label.includes(' ')) return [label];
  const mid = label.length / 2;
  let best = -1;
  for (let i = 0; i < label.length; i++) if (label[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return [label.slice(0, best), label.slice(best + 1)];
}

/** Radar of theme ratings. items: [{label, rating, n}], base: dashed reference ring. */
export function radarSVG(items, base) {
  const N = items.length;
  if (N < 3) return '<p class="muted">Servono almeno 3 temi con dati per disegnare il radar.</p>';
  const vals = items.map((i) => i.rating).concat(base ? [base] : []);
  const lo = Math.floor((Math.min(...vals) - 60) / 50) * 50;
  const hi = Math.ceil((Math.max(...vals) + 40) / 50) * 50;
  const W = 680, H = 500, cx = W / 2, cy = H / 2 + 4, R = 175;
  const ang = (k) => -Math.PI / 2 + (2 * Math.PI * k) / N;
  const pt = (k, v) => { const r = (R * (v - lo)) / (hi - lo); return [cx + r * Math.cos(ang(k)), cy + r * Math.sin(ang(k))]; };
  const rings = 5;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="radar" role="img" aria-label="Radar">`;
  for (let i = 1; i <= rings; i++) {
    const v = lo + ((hi - lo) * i) / rings;
    const poly = items.map((_, k) => pt(k, v).map((x) => x.toFixed(1)).join(',')).join(' ');
    s += `<polygon points="${poly}" class="ring"/>`;
    const [lx, ly] = pt(0, v);
    if (i % 2 === 0 || rings < 5) s += `<text x="${lx + 4}" y="${ly - 3}" class="ring-label">${Math.round(v)}</text>`;
  }
  items.forEach((_, k) => { const [x, y] = pt(k, hi); s += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="spoke"/>`; });
  if (base) {
    const poly = items.map((_, k) => pt(k, base).map((x) => x.toFixed(1)).join(',')).join(' ');
    s += `<polygon points="${poly}" class="base-ring"/>`;
  }
  const poly = items.map((it, k) => pt(k, it.rating).map((x) => x.toFixed(1)).join(',')).join(' ');
  s += `<polygon points="${poly}" class="area"/>`;
  items.forEach((it, k) => {
    const [x, y] = pt(k, it.rating);
    s += `<circle cx="${x}" cy="${y}" r="4.5" class="vertex ${it.confidence === 'bassa' ? 'low' : ''}"><title>${esc(it.label)}: ${it.rating} (n = ${it.n})</title></circle>`;
    const [lx, ly] = pt(k, hi + (hi - lo) * 0.14);
    const anchor = Math.abs(lx - cx) < 12 ? 'middle' : lx > cx ? 'start' : 'end';
    const lines = wrap(it.label, 16);
    const y0 = ly - (lines.length - 1) * 7;
    s += `<text x="${lx}" y="${y0}" text-anchor="${anchor}" class="axis-label">${lines.map((l, i) => `<tspan x="${lx}" dy="${i ? 14 : 0}">${esc(l)}</tspan>`).join('')}</text>`;
    s += `<text x="${lx}" y="${y0 + 14 * lines.length + 1}" text-anchor="${anchor}" class="axis-value">${it.rating}</text>`;
  });
  return s + '</svg>';
}

/** Evaluation graph (white win% per ply). Click selects ply. */
export function evalGraphSVG(wpWhite, plies, current) {
  const W = 600, H = 120, n = wpWhite.length - 1 || 1;
  const x = (i) => (i / n) * W, y = (v) => H - (v / 100) * H;
  let d = `M0,${H} ` + wpWhite.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') + ` L${W},${H} Z`;
  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="evalgraph">`;
  s += `<rect width="${W}" height="${H}" class="eg-bg"/><path d="${d}" class="eg-area"/>`;
  s += `<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="eg-mid"/>`;
  plies.forEach((p, i) => {
    if (['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(p.cls)) s += `<circle cx="${x(i + 1)}" cy="${y(wpWhite[i + 1])}" r="3.5" class="eg-dot cls-${p.cls}" vector-effect="non-scaling-stroke"/>`;
  });
  if (current != null) s += `<line x1="${x(current)}" x2="${x(current)}" y1="0" y2="${H}" class="eg-cursor" vector-effect="non-scaling-stroke"/>`;
  return s + '</svg>';
}

/** Simple line chart; series: [{values:[number|null], cls}] over common x. */
export function lineChartSVG(series, { height = 160, yMin, yMax, labels = [] } = {}) {
  const W = 600, H = height, pad = 28;
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  if (!all.length) return '';
  const lo = yMin ?? Math.floor(Math.min(...all) / 10) * 10, hi = yMax ?? (Math.ceil(Math.max(...all) / 10) * 10 || 1);
  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i) => pad + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad - 8));
  const y = (v) => 8 + (1 - (v - lo) / (hi - lo || 1)) * (H - 24);
  let s = `<svg viewBox="0 0 ${W} ${H}" class="linechart">`;
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    s += `<line x1="${pad}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pad - 4}" y="${y(v) + 3}" text-anchor="end" class="tick">${Math.round(v)}</text>`;
  }
  for (const sr of series) {
    const pts = sr.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
    if (!pts.length) continue;
    s += `<polyline points="${pts.map((p) => p.map((q) => q.toFixed(1)).join(',')).join(' ')}" class="line ${sr.cls || ''}"/>`;
    if (pts.length < 40) pts.forEach(([a, b]) => { s += `<circle cx="${a}" cy="${b}" r="2.5" class="pt ${sr.cls || ''}"/>`; });
  }
  if (labels.length) s += `<text x="${pad}" y="${H - 2}" class="tick">${esc(labels[0])}</text><text x="${W - 8}" y="${H - 2}" text-anchor="end" class="tick">${esc(labels[labels.length - 1])}</text>`;
  return s + '</svg>';
}

/** Horizontal W/D/L bar. */
export function wdlBar({ w, d, l, n }) {
  if (!n) return '';
  const pct = (k) => ((100 * k) / n).toFixed(1);
  return `<div class="wdl" title="${w} vinte, ${d} patte, ${l} perse"><span class="w" style="width:${pct(w)}%"></span><span class="d" style="width:${pct(d)}%"></span><span class="l" style="width:${pct(l)}%"></span></div>`;
}
