/**
 * Dashboard kustom yang dapat disusun sendiri.
 *
 * Dashboard bawaan ditulis sebagai kode; yang ini disimpan sebagai data. Satu
 * dashboard adalah sebuah dokumen JSON berisi daftar widget, dan setiap widget
 * menyebutkan dari modul mana angkanya diambil, dengan cara apa dihitung, serta
 * seperti apa tampilannya.
 *
 * Dua hal yang tidak boleh longgar di sini:
 *
 *  1. Nama kolom datang dari klien. Setiap nama divalidasi terhadap deklarasi
 *     modul di registry sebelum masuk ke SQL — bukan di-escape, melainkan
 *     dicocokkan dengan daftar yang sah. Kolom yang tidak dikenal ditolak.
 *  2. Seluruh angka tetap melewati filter hak akses dan hak paket yang sama
 *     dengan daftar rekaman. Widget tidak boleh menjadi jalan pintas melihat
 *     data cabang lain.
 */
import { Router } from 'express';
import { all, get, run, logAudit } from './db.js';
import { MODULE_BY_KEY, MODULES } from './registry/index.js';
import { COMMON_COLUMNS } from './db.js';
import { can } from './rbac.js';
import { isEntitled } from './tenancy.js';
import { requireAuth, requireLevel } from './auth.js';
import { base, countWhere, groupCount, sumOf, monthlySeries, avgOf, riskHeatmap } from './dashboards.js';

export const customRouter = Router();
customRouter.use(requireAuth);

const nowIso = () => new Date().toISOString();
const yearNow = () => String(new Date().getFullYear());

/** Level 1 dan 2 boleh menyusun dashboard; sisanya hanya melihat. */
const EDITOR_LEVEL = 2;
const canEdit = (user) => user.level <= EDITOR_LEVEL;

/* --------------------------------------------------------- katalog widget */

/** Bentuk tampilan yang tersedia beserta metrik yang masuk akal untuknya. */
export const WIDGET_KINDS = [
  { key: 'stat', name: 'Angka Ringkas', metrics: ['count', 'sum', 'avg'], icon: '🔢' },
  { key: 'line', name: 'Grafik Garis (12 bulan)', metrics: ['trend'], icon: '📈' },
  { key: 'bar', name: 'Peringkat Batang', metrics: ['groupBy'], icon: '📊' },
  { key: 'donut', name: 'Grafik Donat', metrics: ['groupBy'], icon: '🍩' },
  { key: 'table', name: 'Tabel Rekaman Terbaru', metrics: ['list'], icon: '📋' },
  { key: 'heatmap', name: 'Peta Panas Risiko 5×5', metrics: ['risk'], icon: '🌡' },
  { key: 'note', name: 'Catatan / Teks', metrics: ['none'], icon: '📝' },
];

const KIND_KEYS = new Set(WIDGET_KINDS.map((k) => k.key));
const METRIC_KEYS = new Set(['count', 'sum', 'avg', 'groupBy', 'trend', 'list', 'risk', 'none']);
const COMMON = new Set(COMMON_COLUMNS.map(([c]) => c));

const NUMERIC_TYPES = new Set(['number', 'currency']);
const GROUPABLE_TYPES = new Set(['select', 'text', 'bool']);
const DATE_TYPES = new Set(['date', 'datetime']);

/**
 * Kolom yang boleh disebut sebuah widget. Dicocokkan dengan deklarasi modul,
 * ditambah kolom bersama yang dimiliki setiap tabel. Selain ini ditolak.
 */
function fieldOf(mod, name, allowed) {
  if (!name) return null;
  if (COMMON.has(name)) return { name, type: name.endsWith('_at') ? 'datetime' : 'text' };
  const field = mod.fields.find((f) => f.name === name);
  if (!field) return null;
  if (allowed && !allowed.has(field.type)) return null;
  return field;
}

/** Modul beserta kolom yang layak dipakai, untuk dialog "tambah widget". */
customRouter.get('/sources', (req, res) => {
  const modules = MODULES
    .filter((m) => can(req.user, m.key, 'view') && isEntitled(req.user, m.key))
    .map((m) => ({
      key: m.key,
      name: m.nameId,
      icon: m.icon,
      group: `${m.groupCode}. ${m.groupName}`,
      numericFields: m.fields.filter((f) => NUMERIC_TYPES.has(f.type)).map((f) => ({ name: f.name, label: f.label })),
      groupFields: m.fields.filter((f) => GROUPABLE_TYPES.has(f.type)).map((f) => ({ name: f.name, label: f.label }))
        .concat([{ name: 'status', label: 'Status Alur Kerja' }]),
      dateFields: m.fields.filter((f) => DATE_TYPES.has(f.type)).map((f) => ({ name: f.name, label: f.label }))
        .concat([{ name: 'created_at', label: 'Tanggal Dibuat' }]),
      listFields: m.listFields,
      labelField: m.labelField,
    }));
  res.json({ kinds: WIDGET_KINDS, modules });
});

/* ------------------------------------------------------- penyelesai widget */

/**
 * Menghitung isi satu widget.
 * Mengembalikan {ok:false, reason} — bukan melempar — supaya satu widget yang
 * modulnya dicabut dari paket tidak menjatuhkan seluruh dashboard.
 */
export function resolveWidget(user, widget) {
  const src = widget?.source || {};
  const kind = widget?.kind;
  if (!KIND_KEYS.has(kind)) return { ok: false, reason: 'Jenis widget tidak dikenal.' };
  if (kind === 'note') return { ok: true, kind, body: String(widget.body || '') };

  if (kind === 'heatmap') {
    return { ok: true, kind, grid: riskHeatmap(user) };
  }

  const mod = MODULE_BY_KEY.get(src.module);
  if (!mod) return { ok: false, reason: 'Modul tidak dikenal.' };
  if (!can(user, mod.key, 'view')) return { ok: false, reason: `Peran Anda tidak memiliki hak baca pada ${mod.nameId}.` };
  if (!isEntitled(user, mod.key)) return { ok: false, reason: `${mod.nameId} di luar paket langganan cabang Anda.` };

  const metric = METRIC_KEYS.has(src.metric) ? src.metric : 'count';
  const year = yearNow();

  // Penyaring periode memakai kolom tanggal yang disebut widget; kalau tidak
  // disebut, seluruh periode dihitung.
  const dateField = fieldOf(mod, src.dateField, DATE_TYPES);
  const periodSql = src.period === 'year' && dateField ? `t."${dateField.name}" LIKE ?` : '';
  const periodParams = periodSql ? [`${year}%`] : [];

  switch (metric) {
    case 'count':
      return { ok: true, kind, value: countWhere(user, mod.key, periodSql, periodParams), unit: src.unit || null };

    case 'sum': {
      const f = fieldOf(mod, src.field, NUMERIC_TYPES);
      if (!f) return { ok: false, reason: 'Kolom angka tidak dikenal.' };
      return { ok: true, kind, value: sumOf(user, mod.key, f.name, periodSql, periodParams), unit: src.unit || f.label };
    }

    case 'avg': {
      const f = fieldOf(mod, src.field, NUMERIC_TYPES);
      if (!f) return { ok: false, reason: 'Kolom angka tidak dikenal.' };
      return { ok: true, kind, value: avgOf(user, mod.key, f.name, periodSql, periodParams), unit: src.unit || f.label };
    }

    case 'groupBy': {
      const f = fieldOf(mod, src.groupField, GROUPABLE_TYPES) || (src.groupField === 'status' ? { name: 'status' } : null);
      if (!f) return { ok: false, reason: 'Kolom pengelompokan tidak dikenal.' };
      const rows = groupCount(user, mod.key, f.name, periodSql, periodParams);
      return { ok: true, kind, rows: rows.slice(0, Math.min(Number(src.limit) || 10, 25)) };
    }

    case 'trend': {
      if (!dateField) return { ok: false, reason: 'Kolom tanggal tidak dikenal.' };
      let agg = 'COUNT(*)';
      if (src.aggField) {
        const f = fieldOf(mod, src.aggField, NUMERIC_TYPES);
        if (!f) return { ok: false, reason: 'Kolom angka tidak dikenal.' };
        agg = `SUM(t."${f.name}")`;
      }
      return { ok: true, kind, series: monthlySeries(user, mod.key, dateField.name, { agg }) };
    }

    case 'list': {
      const b = base(user, mod.key);
      if (!b) return { ok: false, reason: 'Modul tidak dapat dibaca.' };
      // Kolom tabel juga divalidasi satu per satu; yang tidak dikenal dibuang
      // diam-diam agar widget lama tetap tampil setelah modulnya berubah.
      const cols = (Array.isArray(src.fields) && src.fields.length ? src.fields : mod.listFields)
        .map((n) => fieldOf(mod, n))
        .filter(Boolean)
        .slice(0, 6);
      const names = ['id', 'code', 'status', ...cols.map((f) => f.name)];
      const limit = Math.min(Number(src.limit) || 8, 30);
      const rows = all(
        `SELECT ${names.map((n) => `t."${n}"`).join(', ')} FROM "${mod.table}" t
          WHERE ${b.where} ORDER BY t.created_at DESC LIMIT ${limit}`,
        b.params,
      );
      return {
        ok: true,
        kind,
        module: mod.key,
        columns: cols.map((f) => ({ name: f.name, label: f.label || f.name, type: f.type })),
        rows,
      };
    }

    default:
      return { ok: false, reason: 'Metrik tidak dikenal.' };
  }
}

/* -------------------------------------------------------- baca & tampilkan */

const rowToDashboard = (row) => ({
  id: row.id,
  key: row.key,
  name: row.name,
  icon: row.icon,
  description: row.description,
  layout: safeJson(row.layout, []),
  theme: safeJson(row.theme, {}),
  minLevel: row.min_level,
  published: !!row.published,
  sortOrder: row.sort_order,
  updatedAt: row.updated_at,
});

function safeJson(text, fallback) {
  try {
    const parsed = JSON.parse(text);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/** Dashboard yang boleh dilihat pengguna ini. */
function visibleTo(user) {
  return all('SELECT * FROM custom_dashboards ORDER BY sort_order, name')
    .filter((r) => (canEdit(user) ? true : r.published))
    .filter((r) => !r.min_level || user.level <= r.min_level);
}

customRouter.get('/', (req, res) => {
  res.json({
    canEdit: canEdit(req.user),
    dashboards: visibleTo(req.user).map((r) => ({
      key: r.key, name: r.name, icon: r.icon, description: r.description,
      published: !!r.published, sortOrder: r.sort_order, widgets: safeJson(r.layout, []).length,
    })),
  });
});

customRouter.get('/:key', (req, res) => {
  const row = visibleTo(req.user).find((r) => r.key === req.params.key);
  if (!row) return res.status(404).json({ error: 'Dashboard tidak ditemukan.' });
  const def = rowToDashboard(row);
  res.json({
    ...def,
    canEdit: canEdit(req.user),
    data: def.layout.map((w) => ({ id: w.id, ...resolveWidget(req.user, w) })),
  });
});

/** Pratinjau satu widget saat disusun, tanpa menyimpan apa pun. */
customRouter.post('/preview', (req, res) => {
  res.json({ result: resolveWidget(req.user, req.body?.widget || {}) });
});

/* ------------------------------------------------------------ penyuntingan */

const EDITOR = requireLevel(EDITOR_LEVEL);

/** Membersihkan satu widget yang datang dari klien. */
function sanitiseWidget(raw, index) {
  const span = Math.max(2, Math.min(Number(raw?.layout?.span) || 6, 12));
  const height = raw?.layout?.height === 'auto' ? 'auto' : Math.max(80, Math.min(Number(raw?.layout?.height) || 260, 900));
  const style = raw?.style || {};
  const colour = (v, fallback = null) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback);
  return {
    id: String(raw?.id || `w${index + 1}`).slice(0, 40),
    title: String(raw?.title || 'Widget').slice(0, 120),
    kind: KIND_KEYS.has(raw?.kind) ? raw.kind : 'stat',
    body: String(raw?.body || '').slice(0, 4000),
    source: {
      module: typeof raw?.source?.module === 'string' ? raw.source.module.slice(0, 60) : null,
      metric: METRIC_KEYS.has(raw?.source?.metric) ? raw.source.metric : 'count',
      field: typeof raw?.source?.field === 'string' ? raw.source.field.slice(0, 60) : null,
      groupField: typeof raw?.source?.groupField === 'string' ? raw.source.groupField.slice(0, 60) : null,
      dateField: typeof raw?.source?.dateField === 'string' ? raw.source.dateField.slice(0, 60) : null,
      aggField: typeof raw?.source?.aggField === 'string' ? raw.source.aggField.slice(0, 60) : null,
      fields: Array.isArray(raw?.source?.fields) ? raw.source.fields.slice(0, 6).map((f) => String(f).slice(0, 60)) : null,
      period: raw?.source?.period === 'year' ? 'year' : 'all',
      limit: Math.max(1, Math.min(Number(raw?.source?.limit) || 10, 30)),
      unit: typeof raw?.source?.unit === 'string' ? raw.source.unit.slice(0, 30) : null,
    },
    layout: { span, height },
    style: {
      accent: colour(style.accent, '#1189c1'),
      gradient: !!style.gradient,
      gradientFrom: colour(style.gradientFrom),
      gradientTo: colour(style.gradientTo),
      gradientAngle: Math.max(0, Math.min(Number(style.gradientAngle) || 135, 360)),
      opacity: Math.max(0.15, Math.min(Number(style.opacity ?? 1), 1)),
      textColor: colour(style.textColor),
      titleColor: colour(style.titleColor),
      radius: Math.max(0, Math.min(Number(style.radius ?? 16), 40)),
      shadow: style.shadow !== false,
      border: style.border !== false,
    },
  };
}

const slug = (text) => String(text || '')
  .toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  .slice(0, 40) || `dashboard-${Date.now()}`;

customRouter.post('/', EDITOR, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Nama dashboard wajib diisi.' });
  let key = slug(b.key || b.name);
  // Kunci dipakai pada URL; bila bentrok, diberi akhiran alih-alih ditolak
  // supaya penyusunan tidak terhenti hanya karena namanya mirip.
  let n = 2;
  while (get('SELECT 1 FROM custom_dashboards WHERE key = ?', [key])) key = `${slug(b.key || b.name)}-${n++}`;

  const layout = Array.isArray(b.layout) ? b.layout.map(sanitiseWidget) : [];
  const result = run(
    `INSERT INTO custom_dashboards (key, name, icon, description, layout, theme, min_level, published, sort_order,
                                    created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      key, String(b.name).slice(0, 120), String(b.icon || '📌').slice(0, 8), String(b.description || '').slice(0, 400),
      JSON.stringify(layout), JSON.stringify(b.theme || {}), b.minLevel ? Number(b.minLevel) : null,
      b.published === false ? 0 : 1, Number(b.sortOrder) || 0,
      req.user.id, nowIso(), req.user.id, nowIso(),
    ],
  );
  logAudit({ user: req.user, action: 'dashboard.create', detail: key, ip: req.ip });
  res.status(201).json({ id: Number(result.lastInsertRowid), key });
});

customRouter.put('/:key', EDITOR, (req, res) => {
  const row = get('SELECT * FROM custom_dashboards WHERE key = ?', [req.params.key]);
  if (!row) return res.status(404).json({ error: 'Dashboard tidak ditemukan.' });
  const b = req.body || {};
  const layout = Array.isArray(b.layout) ? b.layout.map(sanitiseWidget) : safeJson(row.layout, []);
  run(
    `UPDATE custom_dashboards SET name = ?, icon = ?, description = ?, layout = ?, theme = ?,
       min_level = ?, published = ?, sort_order = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    [
      String(b.name ?? row.name).slice(0, 120), String(b.icon ?? row.icon ?? '📌').slice(0, 8),
      String(b.description ?? row.description ?? '').slice(0, 400),
      JSON.stringify(layout), JSON.stringify(b.theme ?? safeJson(row.theme, {})),
      b.minLevel === undefined ? row.min_level : (b.minLevel ? Number(b.minLevel) : null),
      b.published === undefined ? row.published : (b.published ? 1 : 0),
      b.sortOrder === undefined ? row.sort_order : Number(b.sortOrder) || 0,
      req.user.id, nowIso(), row.id,
    ],
  );
  logAudit({ user: req.user, action: 'dashboard.update', detail: `${row.key} (${layout.length} widget)`, ip: req.ip });
  res.json({ ok: true, key: row.key, layout });
});

customRouter.delete('/:key', requireLevel(1), (req, res) => {
  const row = get('SELECT * FROM custom_dashboards WHERE key = ?', [req.params.key]);
  if (!row) return res.status(404).json({ error: 'Dashboard tidak ditemukan.' });
  run('DELETE FROM custom_dashboards WHERE id = ?', [row.id]);
  logAudit({ user: req.user, action: 'dashboard.delete', detail: row.key, ip: req.ip });
  res.json({ ok: true });
});
