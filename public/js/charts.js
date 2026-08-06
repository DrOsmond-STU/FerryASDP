/**
 * Dependency-free SVG charts.
 *
 * Deliberately small: a line, a bar list, a donut and the 5x5 risk heatmap
 * cover every visual the dashboards need, and they stay readable in both
 * colour themes because they inherit currentColor for text.
 */
import { h, fmtDecimal } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';

/**
 * Palet kategorikal, dipimpin warna merek (#1189c1 dari token produk QHSE
 * Semesta). Urutannya bukan selera: dua warna pertama harus paling mudah
 * dibedakan karena itulah yang dipakai grafik dua seri, dan biru muda merek
 * (#4bcbfb) sengaja ditaruh jauh dari biru utama supaya tidak tertukar
 * dengannya pada grafik banyak seri.
 */
export const PALETTE = ['#1189c1', '#0e9488', '#f7941d', '#7c3aed', '#d13438', '#12a150', '#4bcbfb', '#a8480f', '#51697f'];

/** Penghitung id gradien - dua grafik pada satu halaman tidak boleh berbagi id. */
let gradientSeq = 0;

const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

const text = (x, y, content, attrs = {}) => {
  const el = svgEl('text', { x, y, 'font-size': 10, fill: 'currentColor', ...attrs });
  el.textContent = content;
  return el;
};

const niceMax = (value) => {
  if (value <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / mag) * mag;
};

/* ----------------------------------------------------------------- line */

/** series: [{label, value}] - monthly trend. */
export function lineChart(series, { height = 190, color = PALETTE[0], area = true, format = fmtDecimal } = {}) {
  const wrap = h('div.chart');
  if (!series?.length) return wrap;

  const W = Math.max(320, series.length * 56);
  const H = height;
  const pad = { l: 42, r: 12, t: 14, b: 26 };
  const max = niceMax(Math.max(...series.map((d) => Number(d.value) || 0), 1));
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i) => pad.l + (series.length === 1 ? iw / 2 : (i * iw) / (series.length - 1));
  const y = (v) => pad.t + ih - ((Number(v) || 0) / max) * ih;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
  svg.style.color = 'var(--text-dim)';

  for (let i = 0; i <= 4; i++) {
    const gy = pad.t + (ih * i) / 4;
    svg.appendChild(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: gy, y2: gy, stroke: 'currentColor', 'stroke-opacity': .18 }));
    svg.appendChild(text(pad.l - 6, gy + 3, format(max - (max * i) / 4, max < 10 ? 2 : 0), { 'text-anchor': 'end' }));
  }

  const points = series.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  if (area) {
    // Isian bergradasi, bukan warna rata: pekat tepat di bawah garis lalu
    // memudar ke bidang kartu, sehingga grafik menyatu dengan kartunya
    // alih-alih terlihat sebagai blok warna yang ditempel di dalamnya.
    const gid = `qg${++gradientSeq}`;
    const defs = svgEl('defs');
    const grad = svgEl('linearGradient', { id: gid, x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': '.30' }));
    grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '.02' }));
    defs.appendChild(grad);
    svg.appendChild(defs);
    svg.appendChild(svgEl('polygon', {
      points: `${pad.l},${pad.t + ih} ${points} ${x(series.length - 1)},${pad.t + ih}`,
      fill: `url(#${gid})`,
    }));
  }
  svg.appendChild(svgEl('polyline', { points, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));

  series.forEach((d, i) => {
    const dot = svgEl('circle', { cx: x(i), cy: y(d.value), r: 3, fill: color });
    dot.appendChild(svgEl('title')).textContent = `${d.label}: ${format(d.value)}`;
    svg.appendChild(dot);
    if (series.length <= 14 || i % 2 === 0) {
      svg.appendChild(text(x(i), H - 8, String(d.label).slice(2), { 'text-anchor': 'middle' }));
    }
  });

  wrap.appendChild(svg);
  return wrap;
}

/* ------------------------------------------------------------ bar list */

/** Horizontal ranked bars - the most legible form for long category names. */
export function barList(rows, { limit = 10, color = PALETTE[0], format = (v) => v } = {}) {
  const wrap = h('div');
  const data = (rows || []).filter((r) => r && r.label !== null).slice(0, limit);
  if (!data.length) return h('div.empty', { text: 'Belum ada data.' });
  const max = Math.max(...data.map((d) => Number(d.value) || 0), 1);
  for (const d of data) {
    wrap.appendChild(h('div.bar-row', {},
      h('span', { title: String(d.label), text: String(d.label) }),
      h('div.bar-track', {}, h('div.bar-fill', { style: `width:${((Number(d.value) || 0) / max) * 100}%;background:${color}` })),
      h('strong', { text: String(format(d.value)) })));
  }
  return wrap;
}

/* ---------------------------------------------------------------- donut */

export function donut(rows, { size = 168, format = (v) => v } = {}) {
  const data = (rows || []).filter((r) => Number(r.value) > 0);
  const total = data.reduce((a, d) => a + Number(d.value), 0);
  if (!total) return h('div.empty', { text: 'Belum ada data.' });

  const r = size / 2 - 8;
  const c = size / 2;
  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size });
  let angle = -Math.PI / 2;

  data.forEach((d, i) => {
    const slice = (Number(d.value) / total) * Math.PI * 2;
    const end = angle + slice;
    const large = slice > Math.PI ? 1 : 0;
    const path = svgEl('path', {
      d: `M ${c + r * Math.cos(angle)} ${c + r * Math.sin(angle)} A ${r} ${r} 0 ${large} 1 ${c + r * Math.cos(end)} ${c + r * Math.sin(end)}`,
      fill: 'none', stroke: PALETTE[i % PALETTE.length], 'stroke-width': 22,
    });
    path.appendChild(svgEl('title')).textContent = `${d.label}: ${format(d.value)}`;
    svg.appendChild(path);
    angle = end;
  });

  svg.appendChild(text(c, c - 2, format(total), { 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 700, fill: 'currentColor' }));
  svg.appendChild(text(c, c + 14, 'total', { 'text-anchor': 'middle', 'font-size': 10, fill: 'currentColor', 'font-weight': 400 }));

  const legend = h('div.legend', {}, ...data.map((d, i) =>
    h('span', {}, h('i', { style: `background:${PALETTE[i % PALETTE.length]}` }), `${d.label} (${format(d.value)})`)));

  const chart = h('div.chart');
  chart.appendChild(svg);
  return h('div', {}, chart, legend);
}

/* -------------------------------------------------------------- heatmap */

// Warna pita risiko memakai token status produk, bukan warna sendiri: peta
// panas dan lencana status harus menyebut "tinggi" dengan warna yang sama.
const bandColor = (score) => (score <= 4 ? '#12a150' : score <= 9 ? '#e0a207' : score <= 15 ? '#e8712a' : '#d13438');

/** grid[likelihood-1][severity-1] = count, matching ISO 31000 5x5 practice. */
export function riskHeatmap(grid, { onCell } = {}) {
  const table = h('table.heatmap');
  const head = h('tr', {}, h('th', { text: '' }), h('th', { colspan: 5, text: 'Keparahan (Severity) →' }));
  table.appendChild(head);
  table.appendChild(h('tr', {}, h('th', { text: '' }), ...[1, 2, 3, 4, 5].map((s) => h('th', { text: String(s) }))));

  for (let l = 5; l >= 1; l--) {
    const row = h('tr', {}, h('th', { text: `L${l}` }));
    for (let s = 1; s <= 5; s++) {
      const count = grid?.[l - 1]?.[s - 1] || 0;
      const cell = h('td', {
        style: `background:${bandColor(l * s)};${count ? '' : 'opacity:.35'};${onCell ? 'cursor:pointer' : ''}`,
        title: `Kemungkinan ${l} × Keparahan ${s} = ${l * s} — ${count} risiko`,
        text: String(count),
        onclick: onCell ? () => onCell(l, s) : null,
      });
      row.appendChild(cell);
    }
    table.appendChild(row);
  }

  const legend = h('div.legend', {},
    h('span', {}, h('i', { style: 'background:#12a150' }), 'Rendah (1–4)'),
    h('span', {}, h('i', { style: 'background:#e0a207' }), 'Sedang (5–9)'),
    h('span', {}, h('i', { style: 'background:#e8712a' }), 'Tinggi (10–15)'),
    h('span', {}, h('i', { style: 'background:#d13438' }), 'Ekstrem (16–25)'));

  return h('div', {}, h('div.chart', {}, table), legend,
    h('div.small.muted', { text: 'Sumbu tegak: kemungkinan (L1–L5). Sumbu datar: keparahan (1–5).' }));
}

/* ---------------------------------------------------------- comparison */

/** Target vs realisation, used by the KPI and ESG dashboards. */
export function targetBars(rows, { limit = 12 } = {}) {
  const data = (rows || []).slice(0, limit);
  if (!data.length) return h('div.empty', { text: 'Belum ada data.' });
  return h('div', {}, ...data.map((d) => {
    const achievement = Number(d.achievement) || 0;
    const capped = Math.max(0, Math.min(achievement, 130));
    const color = achievement >= 100 ? '#12a150' : achievement >= 90 ? '#e0a207' : '#d13438';
    return h('div', { style: 'margin-bottom:.6rem' },
      h('div.bar-row', { style: 'margin-bottom:.2rem' },
        h('span', { title: d.title, text: d.title }),
        h('div.bar-track', {}, h('div.bar-fill', { style: `width:${(capped / 130) * 100}%;background:${color}` })),
        h('strong', { text: `${fmtDecimal(achievement, 1)}%` })),
      h('div.small.muted', { text: `Target ${fmtDecimal(d.target)} ${d.unit || ''} · Realisasi ${fmtDecimal(d.actual)} ${d.unit || ''}` }));
  }));
}
