/** Small DOM + formatting helpers shared by every view. */
import { t, lang } from './i18n.js';

/** h('div.card', {onclick}, children) - terse element builder. */
export function h(spec, props = {}, ...children) {
  const [tag, ...classes] = String(spec).split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = `${el.className} ${value}`.trim();
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const mount = (el, ...children) => { clear(el); append(el, children); return el; };

/* ---------------------------------------------------------- formatting */

/**
 * Format angka dan tanggal mengikuti bahasa yang dipilih. Pemisah desimal
 * Indonesia (koma) dan Inggris (titik) berbeda, dan angka keselamatan yang
 * terbaca 1.234 di satu bahasa serta 1,234 di bahasa lain adalah kekeliruan
 * yang mahal — bukan sekadar selera tampilan.
 */
const locale = () => (lang() === 'en' ? 'en-GB' : 'id-ID');

export const fmtNumber = (v, digits = 0) =>
  v === null || v === undefined || v === '' || Number.isNaN(Number(v))
    ? '—'
    : Number(v).toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtDecimal = (v, digits = 2) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(locale(), { maximumFractionDigits: digits });
};

export function fmtCurrency(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toLocaleString(locale(), { maximumFractionDigits: 2 })} ${lang() === 'en' ? 'bn' : 'M'}`;
  if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString(locale(), { maximumFractionDigits: 1 })} ${lang() === 'en' ? 'm' : 'jt'}`;
  return `Rp ${n.toLocaleString(locale())}`;
}

export function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString(locale(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .filter((w) => /[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

/* -------------------------------------------------------------- badges */

const POSITIVE = ['closed', 'verified', 'approved', 'published', 'validated', 'active', 'completed', 'monitored'];
const NEGATIVE = ['rejected', 'revoked', 'obsolete', 'cancelled', 'overdue_closed', 'archived'];
const PROGRESS = ['in_progress', 'investigating', 'action', 'review', 'reviewed', 'submitted', 'assessed', 'treatment', 'requested', 'reported', 'planned', 'recorded', 'identified', 'open'];

export function statusBadge(statusKey, workflow = []) {
  const state = workflow.find((s) => s.key === statusKey);
  const label = state?.label || statusKey || '—';
  let cls = 'b-draft';
  if (NEGATIVE.includes(statusKey)) cls = 'b-danger';
  else if (POSITIVE.includes(statusKey)) cls = 'b-ok';
  else if (PROGRESS.includes(statusKey)) cls = 'b-progress';
  return h('span.badge', { class: cls, text: label });
}

export const riskPill = (level) =>
  level ? h('span.risk-pill', { class: `risk-${level}`, text: level }) : h('span.muted', { text: '—' });

/* -------------------------------------------------------------- toasts */

export function toast(message, kind = '') {
  const root = document.getElementById('toasts');
  const el = h('div.toast', { class: kind, text: message });
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 320);
  }, kind === 'err' ? 6500 : 3800);
}

/* --------------------------------------------------------------- modal */

export function modal({ title, body, actions = [], onClose }) {
  const root = document.getElementById('modal-root');
  const close = () => { clear(root); onClose?.(); };
  const box = h('div.modal', { role: 'dialog', 'aria-modal': 'true' },
    h('h2', { text: title }),
    body,
    // Objek props kosong ini WAJIB ada. Tanpanya, h() memperlakukan argumen
    // kedua sebagai props — dan argumen kedua di sini adalah tombol aksi
    // pertama, yang lalu hilang tanpa pesan apa pun. Akibatnya setiap dialog
    // berisi satu aksi hanya menampilkan tombol "Tutup": simpan kata sandi,
    // konfirmasi hapus, dan simpan rekaman semuanya tidak dapat ditekan.
    h('div.modal-actions', {},
      ...actions.map((a) =>
        h('button', { class: a.class || '', onclick: () => a.onClick?.(close), text: a.label })),
      h('button', { class: 'btn-ghost', onclick: close, text: t('Tutup') })),
  );
  const backdrop = h('div.modal-backdrop', {
    onclick: (e) => { if (e.target === backdrop) close(); },
  }, box);
  mount(root, backdrop);
  return close;
}

export function confirmDialog(message, onConfirm) {
  modal({
    title: t('Konfirmasi'),
    body: h('p', { text: message }),
    actions: [{ label: t('Ya, lanjutkan'), class: 'btn-danger', onClick: (close) => { close(); onConfirm(); } }],
  });
}

/* --------------------------------------------------------------- misc */

export const stat = (label, value, { sub, tone = '', unit } = {}) =>
  h('div.stat', { class: tone },
    h('div.label', { text: label }),
    h('div.value', {}, String(value ?? '—'), unit ? h('small', { text: ` ${unit}` }) : null),
    sub ? h('div.sub', { text: sub }) : null);

export const emptyState = (text = 'Belum ada data.') => h('div.empty', { text: t(text) });

export const spinner = (text = 'Memuat…') => h('div.empty', { text: t(text) });
