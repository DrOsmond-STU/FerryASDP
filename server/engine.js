/**
 * Generic module engine.
 *
 * One REST surface serves every module in the registry: validation, workflow,
 * row-level security, audit trail, comments, attachments and CSV export are
 * implemented once instead of ~80 times.
 */
import { Router } from 'express';
import { all, get, run, nextCode, logAudit, tx } from './db.js';
import { MODULE_BY_KEY, moduleOrThrow, MODULES } from './registry/index.js';
import { applyComputed } from './compute.js';
import { assertCan, can, scopeClause, canTransition } from './rbac.js';
import { requireAuth } from './auth.js';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const nowIso = () => new Date().toISOString();

/* ------------------------------------------------------------- validation */

const isEmpty = (v) => v === undefined || v === null || v === '';

function coerce(field, value) {
  if (isEmpty(value)) return null;
  switch (field.type) {
    case 'number':
    case 'currency':
      { const num = Number(value); return Number.isFinite(num) ? num : null; }
    case 'bool':
      return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
    case 'multiselect':
      return JSON.stringify(Array.isArray(value) ? value : [value]);
    case 'region':
    case 'branch':
    case 'port':
    case 'vessel':
    case 'employee':
    case 'asset':
    case 'contractor':
      { const id = Number(value); return Number.isInteger(id) ? id : null; }
    default:
      return String(value);
  }
}

function optionValues(field) {
  if (!field.options) return null;
  return field.options.map((o) => (typeof o === 'string' ? o : o.value));
}

function validate(mod, payload, { partial = false } = {}) {
  const errors = [];
  const row = {};

  for (const field of mod.fields) {
    if (field.computed) continue; // recalculated server-side, never accepted
    const present = Object.prototype.hasOwnProperty.call(payload, field.name);
    if (partial && !present) continue;

    const raw = payload[field.name];
    if (field.required && isEmpty(raw) && !(field.type === 'bool')) {
      errors.push(`${field.label} wajib diisi.`);
      continue;
    }
    const value = coerce(field, raw);

    if (value !== null && field.type === 'select') {
      const allowed = optionValues(field);
      if (allowed && !allowed.includes(value)) errors.push(`${field.label}: pilihan "${value}" tidak dikenal.`);
    }
    if (value !== null && field.type === 'multiselect') {
      const allowed = optionValues(field);
      if (allowed) {
        for (const v of JSON.parse(value)) {
          if (!allowed.includes(v)) errors.push(`${field.label}: pilihan "${v}" tidak dikenal.`);
        }
      }
    }
    if (value !== null && (field.type === 'number' || field.type === 'currency')) {
      if (field.min !== undefined && value < field.min) errors.push(`${field.label} minimal ${field.min}.`);
      if (field.max !== undefined && value > field.max) errors.push(`${field.label} maksimal ${field.max}.`);
    }
    if (value !== null && field.pattern && !new RegExp(field.pattern).test(String(value))) {
      errors.push(`${field.label} tidak sesuai format yang diharapkan.`);
    }
    row[field.name] = value;
  }

  // Organisational placement.
  for (const org of mod.orgFields) {
    const key = `${org}_id`;
    const present = Object.prototype.hasOwnProperty.call(payload, key);
    if (partial && !present) continue;
    const value = isEmpty(payload[key]) ? null : Number(payload[key]);
    if (mod.orgRequired.includes(org) && !value) errors.push(`Penempatan organisasi (${org}) wajib dipilih.`);
    row[key] = Number.isInteger(value) ? value : null;
  }

  return { row, errors };
}

/* ------------------------------------------------------------- presentation */

function decodeRow(mod, row) {
  if (!row) return row;
  const out = { ...row };
  for (const field of mod.fields) {
    if (field.type === 'multiselect' && typeof out[field.name] === 'string') {
      try { out[field.name] = JSON.parse(out[field.name]); } catch { out[field.name] = []; }
    }
    if (field.type === 'bool' && out[field.name] !== null && out[field.name] !== undefined) {
      out[field.name] = !!out[field.name];
    }
  }
  return out;
}

/** Human label for a master record, used by reference dropdowns. */
export function labelOf(mod, row) {
  if (!row) return null;
  return row[mod.labelField] || row.code || `#${row.id}`;
}

/* ------------------------------------------------------------------ queries */

function buildList(mod, user, query) {
  const where = ['t.deleted_at IS NULL'];
  const params = [];

  const scope = scopeClause(user, mod);
  if (scope.sql) {
    where.push(scope.sql);
    params.push(...scope.params);
  }

  if (query.status) {
    const statuses = String(query.status).split(',').filter(Boolean);
    where.push(`t.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  for (const org of ['region', 'branch', 'port', 'vessel']) {
    const val = query[`${org}_id`];
    if (val) {
      where.push(`t.${org}_id = ?`);
      params.push(Number(val));
    }
  }
  if (query.q) {
    const searchable = mod.fields
      .filter((f) => ['text', 'textarea', 'select', 'multiselect'].includes(f.type))
      .map((f) => f.name);
    const cols = ['code', ...searchable];
    where.push(`(${cols.map((c) => `t."${c}" LIKE ?`).join(' OR ')})`);
    params.push(...cols.map(() => `%${query.q}%`));
  }
  if (query.from) {
    where.push('t.created_at >= ?');
    params.push(String(query.from));
  }
  if (query.to) {
    where.push('t.created_at <= ?');
    params.push(`${String(query.to)}T23:59:59.999Z`);
  }
  // Arbitrary field equality filter: field:<name>=<value>
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith('field:') || isEmpty(value)) continue;
    const name = key.slice(6);
    if (!mod.fields.some((f) => f.name === name)) continue;
    where.push(`t."${name}" = ?`);
    params.push(value);
  }

  const sortable = new Set(['id', 'code', 'status', 'created_at', 'updated_at', ...mod.fields.map((f) => f.name)]);
  const sort = sortable.has(query.sort) ? query.sort : 'created_at';
  const dir = String(query.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  return { whereSql: where.join(' AND '), params, sort, dir };
}

/* -------------------------------------------------------------------- router */

export const engineRouter = Router();
engineRouter.use(requireAuth);

const withModule = (req, _res, next) => {
  try {
    req.mod = moduleOrThrow(req.params.key);
    next();
  } catch (err) {
    next(err);
  }
};

/** Reference options for dropdowns (master modules). */
engineRouter.get('/modules/:key/options', withModule, (req, res) => {
  const mod = req.mod;
  assertCan(req.user, mod.key, 'view');
  const rows = all(
    `SELECT id, code, "${mod.labelField}" AS label, region_id, branch_id, port_id, vessel_id
     FROM "${mod.table}" t WHERE deleted_at IS NULL ORDER BY label COLLATE NOCASE`,
  );
  res.json({ options: rows.map((r) => ({ id: r.id, label: r.label || r.code, code: r.code, region_id: r.region_id, branch_id: r.branch_id, port_id: r.port_id, vessel_id: r.vessel_id })) });
});

engineRouter.get('/modules/:key/stats', withModule, (req, res) => {
  const mod = req.mod;
  assertCan(req.user, mod.key, 'view');
  const { whereSql, params } = buildList(mod, req.user, req.query);
  const byStatus = all(`SELECT status, COUNT(*) AS n FROM "${mod.table}" t WHERE ${whereSql} GROUP BY status`, params);
  const total = byStatus.reduce((a, r) => a + r.n, 0);
  res.json({ total, byStatus });
});

engineRouter.get('/modules/:key/records', withModule, (req, res) => {
  const mod = req.mod;
  assertCan(req.user, mod.key, 'view');
  const { whereSql, params, sort, dir } = buildList(mod, req.user, req.query);

  const size = Math.min(Math.max(Number(req.query.size) || 25, 1), 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const offset = (page - 1) * size;

  const total = get(`SELECT COUNT(*) AS n FROM "${mod.table}" t WHERE ${whereSql}`, params).n;
  const rows = all(
    `SELECT t.* FROM "${mod.table}" t WHERE ${whereSql} ORDER BY t."${sort}" ${dir}, t.id DESC LIMIT ? OFFSET ?`,
    [...params, size, offset],
  );
  res.json({
    total,
    page,
    size,
    pages: Math.max(1, Math.ceil(total / size)),
    records: rows.map((r) => decodeRow(mod, r)),
  });
});

engineRouter.get('/modules/:key/export', withModule, (req, res) => {
  const mod = req.mod;
  assertCan(req.user, mod.key, 'view');
  const { whereSql, params, sort, dir } = buildList(mod, req.user, req.query);
  const rows = all(`SELECT t.* FROM "${mod.table}" t WHERE ${whereSql} ORDER BY t."${sort}" ${dir} LIMIT 10000`, params);

  const columns = ['code', 'status', ...mod.fields.map((f) => f.name), 'created_at', 'updated_at'];
  const headers = ['Kode', 'Status', ...mod.fields.map((f) => f.label), 'Dibuat', 'Diperbarui'];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.join(' | ') : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(',')];
  for (const raw of rows) {
    const row = decodeRow(mod, raw);
    lines.push(columns.map((c) => esc(row[c])).join(','));
  }
  logAudit({ user: req.user, action: 'export', module_key: mod.key, detail: `${rows.length} baris`, ip: req.ip });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${mod.key}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`﻿${lines.join('\n')}`);
});

engineRouter.get('/modules/:key/records/:id', withModule, (req, res) => {
  const mod = req.mod;
  assertCan(req.user, mod.key, 'view');
  const row = get(`SELECT * FROM "${mod.table}" WHERE id = ? AND deleted_at IS NULL`, [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Rekaman tidak ditemukan.' });

  const comments = all('SELECT id, username, body, created_at FROM comments WHERE module_key = ? AND record_id = ? ORDER BY id', [mod.key, row.id]);
  const attachments = all('SELECT id, filename, mime, size, uploaded_at FROM attachments WHERE module_key = ? AND record_id = ? ORDER BY id', [mod.key, row.id]);
  const history = all(
    'SELECT ts, username, action, detail FROM audit_log WHERE module_key = ? AND record_id = ? ORDER BY id DESC LIMIT 50',
    [mod.key, row.id],
  );
  const linked = all(
    `SELECT id, code, status, title FROM "m_capa" WHERE source_module = ? AND source_id = ? AND deleted_at IS NULL`,
    [mod.key, row.id],
  );
  res.json({ record: decodeRow(mod, row), comments, attachments, history, linked });
});

engineRouter.post('/modules/:key/records', withModule, (req, res, next) => {
  try {
    const mod = req.mod;
    assertCan(req.user, mod.key, 'create');
    const { row, errors } = validate(mod, req.body || {});
    if (errors.length) return res.status(400).json({ error: 'Validasi gagal.', details: errors });

    if (mod.singleton) {
      const existing = get(`SELECT id FROM "${mod.table}" WHERE deleted_at IS NULL`);
      if (existing) return res.status(409).json({ error: 'Modul ini hanya boleh memiliki satu rekaman. Silakan ubah rekaman yang ada.' });
    }

    applyComputed(mod, row);
    row.code = nextCode(mod.codePrefix);
    row.status = mod.initialStatus;
    row.owner_id = req.body?.owner_id ? Number(req.body.owner_id) : req.user.id;
    row.created_by = req.user.id;
    row.created_at = nowIso();
    row.updated_by = req.user.id;
    row.updated_at = row.created_at;
    if (req.body?.source_module && MODULE_BY_KEY.has(req.body.source_module)) {
      row.source_module = req.body.source_module;
      row.source_id = Number(req.body.source_id) || null;
    }
    // Default a user's own organisational placement when they did not pick one.
    for (const org of mod.orgFields) {
      const key = `${org}_id`;
      if (!row[key] && req.user[key]) row[key] = req.user[key];
    }

    const cols = Object.keys(row);
    const id = tx(() => {
      const result = run(
        `INSERT INTO "${mod.table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map((c) => row[c]),
      );
      return Number(result.lastInsertRowid);
    });

    logAudit({ user: req.user, action: 'create', module_key: mod.key, record_id: id, record_code: row.code, ip: req.ip });
    res.status(201).json({ record: decodeRow(mod, get(`SELECT * FROM "${mod.table}" WHERE id = ?`, [id])) });
  } catch (err) {
    next(err);
  }
});

engineRouter.put('/modules/:key/records/:id', withModule, (req, res, next) => {
  try {
    const mod = req.mod;
    assertCan(req.user, mod.key, 'edit');
    const id = Number(req.params.id);
    const current = get(`SELECT * FROM "${mod.table}" WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (!current) return res.status(404).json({ error: 'Rekaman tidak ditemukan.' });

    const terminal = mod.workflow.find((s) => s.key === current.status)?.terminal;
    if (terminal && !can(req.user, mod.key, 'approve')) {
      return res.status(409).json({ error: 'Rekaman sudah ditutup dan hanya dapat diubah oleh pemberi persetujuan.' });
    }

    const { row, errors } = validate(mod, req.body || {}, { partial: true });
    if (errors.length) return res.status(400).json({ error: 'Validasi gagal.', details: errors });

    const merged = { ...current, ...row };
    applyComputed(mod, merged);
    for (const field of mod.fields) {
      if (field.computed) row[field.name] = merged[field.name];
    }

    row.updated_by = req.user.id;
    row.updated_at = nowIso();
    const cols = Object.keys(row);
    run(`UPDATE "${mod.table}" SET ${cols.map((c) => `"${c}" = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => row[c]), id]);

    const changed = cols.filter((c) => !['updated_by', 'updated_at'].includes(c) && String(current[c] ?? '') !== String(row[c] ?? ''));
    logAudit({
      user: req.user, action: 'update', module_key: mod.key, record_id: id, record_code: current.code,
      detail: changed.length ? `Perubahan: ${changed.join(', ')}` : 'Tanpa perubahan nilai', ip: req.ip,
    });
    res.json({ record: decodeRow(mod, get(`SELECT * FROM "${mod.table}" WHERE id = ?`, [id])) });
  } catch (err) {
    next(err);
  }
});

engineRouter.post('/modules/:key/records/:id/status', withModule, (req, res, next) => {
  try {
    const mod = req.mod;
    const id = Number(req.params.id);
    const target = String(req.body?.status || '');
    const record = get(`SELECT * FROM "${mod.table}" WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (!record) return res.status(404).json({ error: 'Rekaman tidak ditemukan.' });

    const state = mod.workflow.find((s) => s.key === target);
    if (!state) return res.status(400).json({ error: `Status "${target}" tidak dikenal pada modul ini.` });
    if (!canTransition(req.user, mod, target)) {
      return res.status(403).json({ error: `Anda tidak berwenang memindahkan rekaman ke status "${state.label}".` });
    }

    const closedAt = state.terminal ? nowIso() : null;
    run(`UPDATE "${mod.table}" SET status = ?, closed_at = ?, updated_by = ?, updated_at = ? WHERE id = ?`, [
      target, closedAt, req.user.id, nowIso(), id,
    ]);
    if (req.body?.note) {
      run('INSERT INTO comments (module_key, record_id, user_id, username, body, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        mod.key, id, req.user.id, req.user.username, `[${state.label}] ${req.body.note}`, nowIso(),
      ]);
    }
    logAudit({
      user: req.user, action: 'status', module_key: mod.key, record_id: id, record_code: record.code,
      detail: `${record.status} -> ${target}`, ip: req.ip,
    });
    res.json({ record: decodeRow(mod, get(`SELECT * FROM "${mod.table}" WHERE id = ?`, [id])) });
  } catch (err) {
    next(err);
  }
});

engineRouter.delete('/modules/:key/records/:id', withModule, (req, res, next) => {
  try {
    const mod = req.mod;
    assertCan(req.user, mod.key, 'delete');
    const id = Number(req.params.id);
    const record = get(`SELECT * FROM "${mod.table}" WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (!record) return res.status(404).json({ error: 'Rekaman tidak ditemukan.' });
    run(`UPDATE "${mod.table}" SET deleted_at = ?, updated_by = ? WHERE id = ?`, [nowIso(), req.user.id, id]);
    logAudit({ user: req.user, action: 'delete', module_key: mod.key, record_id: id, record_code: record.code, ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Spawn a corrective action linked back to the originating record. */
engineRouter.post('/modules/:key/records/:id/capa', withModule, (req, res, next) => {
  try {
    const mod = req.mod;
    assertCan(req.user, mod.key, 'view');
    assertCan(req.user, 'capa', 'create');
    const capa = MODULE_BY_KEY.get('capa');
    const id = Number(req.params.id);
    const source = get(`SELECT * FROM "${mod.table}" WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (!source) return res.status(404).json({ error: 'Rekaman sumber tidak ditemukan.' });

    const payload = {
      title: req.body?.title || `Tindakan korektif untuk ${source.code}`,
      problem_statement: req.body?.problem_statement || source[mod.labelField] || source.code,
      action_plan: req.body?.action_plan || '(diisi oleh penanggung jawab)',
      pic: req.body?.pic || String(req.user.id),
      due_date: req.body?.due_date || null,
      source_type: req.body?.source_type || 'Ketidaksesuaian',
    };
    const { row, errors } = validate(capa, payload);
    if (errors.length) return res.status(400).json({ error: 'Validasi gagal.', details: errors });

    row.source_module = mod.key;
    row.source_id = id;
    row.source_ref = `${mod.nameId} / ${source.code}`;
    row.code = nextCode(capa.codePrefix);
    row.status = capa.initialStatus;
    row.owner_id = req.user.id;
    row.created_by = req.user.id;
    row.created_at = nowIso();
    row.updated_by = req.user.id;
    row.updated_at = row.created_at;
    for (const org of ['region', 'branch', 'port', 'vessel']) {
      row[`${org}_id`] = source[`${org}_id`] ?? null;
    }
    applyComputed(capa, row);

    const cols = Object.keys(row);
    const result = run(
      `INSERT INTO "${capa.table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => row[c]),
    );
    const newId = Number(result.lastInsertRowid);
    logAudit({ user: req.user, action: 'capa.create', module_key: 'capa', record_id: newId, record_code: row.code, detail: `dari ${mod.key}/${source.code}`, ip: req.ip });
    res.status(201).json({ record: decodeRow(capa, get(`SELECT * FROM "${capa.table}" WHERE id = ?`, [newId])) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------- comments & files */

engineRouter.post('/modules/:key/records/:id/comments', withModule, (req, res) => {
  const mod = req.mod;
  assertCan(req.user, mod.key, 'view');
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Isi catatan tidak boleh kosong.' });
  run('INSERT INTO comments (module_key, record_id, user_id, username, body, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    mod.key, Number(req.params.id), req.user.id, req.user.username, body.slice(0, 4000), nowIso(),
  ]);
  res.status(201).json({ ok: true });
});

engineRouter.post('/modules/:key/records/:id/attachments', withModule, (req, res) => {
  const mod = req.mod;
  assertCan(req.user, mod.key, 'edit');
  const { filename, mime, dataBase64 } = req.body || {};
  if (!filename || !dataBase64) return res.status(400).json({ error: 'Nama berkas dan konten wajib diisi.' });
  const buffer = Buffer.from(dataBase64, 'base64');
  if (buffer.length > MAX_ATTACHMENT_BYTES) return res.status(413).json({ error: 'Ukuran berkas melebihi 5 MB.' });
  run('INSERT INTO attachments (module_key, record_id, filename, mime, size, content, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    mod.key, Number(req.params.id), String(filename).slice(0, 255), mime || 'application/octet-stream', buffer.length, buffer, req.user.id, nowIso(),
  ]);
  logAudit({ user: req.user, action: 'attachment.add', module_key: mod.key, record_id: Number(req.params.id), detail: filename, ip: req.ip });
  res.status(201).json({ ok: true });
});

engineRouter.get('/attachments/:id', (req, res) => {
  const row = get('SELECT * FROM attachments WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Berkas tidak ditemukan.' });
  assertCan(req.user, row.module_key, 'view');
  res.setHeader('Content-Type', row.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${row.filename.replace(/"/g, '')}"`);
  res.send(Buffer.from(row.content));
});

engineRouter.delete('/attachments/:id', (req, res) => {
  const row = get('SELECT * FROM attachments WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Berkas tidak ditemukan.' });
  assertCan(req.user, row.module_key, 'edit');
  run('DELETE FROM attachments WHERE id = ?', [row.id]);
  logAudit({ user: req.user, action: 'attachment.delete', module_key: row.module_key, record_id: row.record_id, detail: row.filename, ip: req.ip });
  res.json({ ok: true });
});

/* ------------------------------------------------------------- my work list */

/** Records assigned to, or raised by, the signed-in user that still need work. */
engineRouter.get('/my/tasks', (req, res) => {
  const tasks = [];
  for (const mod of MODULES) {
    if (!can(req.user, mod.key, 'view')) continue;
    const terminal = new Set(mod.workflow.filter((s) => s.terminal).map((s) => s.key));
    const open = mod.statuses.filter((s) => !terminal.has(s));
    if (!open.length) continue;
    const hasDue = mod.fields.some((f) => f.name === 'due_date');
    const rows = all(
      `SELECT id, code, status, "${mod.labelField}" AS label${hasDue ? ', due_date' : ''}
       FROM "${mod.table}"
       WHERE deleted_at IS NULL AND status IN (${open.map(() => '?').join(',')})
         AND (owner_id = ? OR created_by = ?)
       ORDER BY id DESC LIMIT 20`,
      [...open, req.user.id, req.user.id],
    );
    for (const r of rows) {
      tasks.push({
        module: mod.key,
        moduleName: mod.nameId,
        icon: mod.icon,
        id: r.id,
        code: r.code,
        status: r.status,
        statusLabel: mod.workflow.find((s) => s.key === r.status)?.label || r.status,
        label: r.label,
        due_date: r.due_date || null,
      });
    }
  }
  tasks.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  res.json({ tasks: tasks.slice(0, 100) });
});

export { validate, decodeRow };
