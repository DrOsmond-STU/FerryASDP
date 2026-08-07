/**
 * Administration - user management, role permission matrix, audit trail.
 * Restricted to Level 1 (system administrator) unless stated otherwise.
 */
import { Router } from 'express';
import { all, get, run, logAudit } from './db.js';
import { MODULES } from './registry/index.js';
import { ROLES, ROLE_BY_KEY, clearPermissionCache, permissionsFor, defaultPermissions, seedRoles } from './rbac.js';
import { hashPassword, validatePassword, requireAuth, requireLevel, decorate } from './auth.js';
import { pickLang, tr, localiseRoles } from './i18n.js';

export const adminRouter = Router();
adminRouter.use(requireAuth);

const nowIso = () => new Date().toISOString();
const ADMIN = requireLevel(1);

// Nama modul dan kelompok sudah dwibahasa di registry; di sini tinggal dipilih.
const moduleName = (m, lang) => (lang === 'en' ? m.name : m.nameId);
const groupNameOf = (m, lang) => (lang === 'en' ? m.groupNameEn || m.groupName : m.groupName);

/* -------------------------------------------------------------------- users */

adminRouter.get('/users', requireLevel(2), (req, res) => {
  const rows = all(
    `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.position, u.role_key, u.active,
            u.region_id, u.branch_id, u.port_id, u.vessel_id, u.contractor_id, u.last_login, u.created_at,
            r.name AS role_name, r.level, r.scope_type
       FROM users u JOIN roles r ON r.key = u.role_key
      ORDER BY r.level, u.full_name`,
  );
  const lang = pickLang(req);
  res.json({ users: rows.map((u) => ({ ...u, role_name: tr(u.role_name, lang) })) });
});

adminRouter.post('/users', ADMIN, (req, res) => {
  const b = req.body || {};
  const required = ['username', 'full_name', 'role_key', 'password'];
  const missing = required.filter((k) => !b[k]);
  if (missing.length) return res.status(400).json({ error: `Wajib diisi: ${missing.join(', ')}` });
  if (!ROLE_BY_KEY.has(b.role_key)) return res.status(400).json({ error: 'Peran tidak dikenal.' });
  if (get('SELECT 1 FROM users WHERE lower(username) = lower(?)', [b.username])) {
    return res.status(409).json({ error: 'Nama pengguna sudah digunakan.' });
  }
  const problems = validatePassword(b.password);
  if (problems.length) return res.status(400).json({ error: `Kata sandi harus ${problems.join(', ')}.` });

  const { hash, salt } = hashPassword(b.password);
  const result = run(
    `INSERT INTO users (username, full_name, email, phone, position, password_hash, password_salt, role_key,
                        region_id, branch_id, port_id, vessel_id, contractor_id, active, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    [
      b.username, b.full_name, b.email || null, b.phone || null, b.position || null, hash, salt, b.role_key,
      b.region_id || null, b.branch_id || null, b.port_id || null, b.vessel_id || null, b.contractor_id || null,
      nowIso(), nowIso(),
    ],
  );
  logAudit({ user: req.user, action: 'user.create', detail: b.username, ip: req.ip });
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

adminRouter.put('/users/:id', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  const user = get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
  const b = req.body || {};
  if (b.role_key && !ROLE_BY_KEY.has(b.role_key)) return res.status(400).json({ error: 'Peran tidak dikenal.' });
  if (user.id === req.user.id && b.active === false) {
    return res.status(400).json({ error: 'Tidak dapat menonaktifkan akun Anda sendiri.' });
  }

  const fields = ['full_name', 'email', 'phone', 'position', 'role_key', 'region_id', 'branch_id', 'port_id', 'vessel_id', 'contractor_id'];
  const sets = [];
  const params = [];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(b, f)) {
      sets.push(`${f} = ?`);
      params.push(b[f] === '' ? null : b[f]);
    }
  }
  if (Object.prototype.hasOwnProperty.call(b, 'active')) {
    sets.push('active = ?');
    params.push(b.active ? 1 : 0);
  }
  if (b.password) {
    const problems = validatePassword(b.password);
    if (problems.length) return res.status(400).json({ error: `Kata sandi harus ${problems.join(', ')}.` });
    const { hash, salt } = hashPassword(b.password);
    sets.push('password_hash = ?', 'password_salt = ?', 'must_change_password = 1', 'failed_attempts = 0', 'locked_until = NULL');
    params.push(hash, salt);
    run('DELETE FROM sessions WHERE user_id = ?', [id]);
  }
  if (!sets.length) return res.json({ ok: true });
  sets.push('updated_at = ?');
  params.push(nowIso(), id);
  run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  logAudit({ user: req.user, action: 'user.update', detail: `${user.username}: ${sets.map((s) => s.split(' =')[0]).join(', ')}`, ip: req.ip });
  res.json({ ok: true });
});

adminRouter.post('/users/:id/unlock', ADMIN, (req, res) => {
  run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [Number(req.params.id)]);
  logAudit({ user: req.user, action: 'user.unlock', detail: req.params.id, ip: req.ip });
  res.json({ ok: true });
});

/* -------------------------------------------------------------------- roles */

adminRouter.get('/roles', requireLevel(2), (req, res) => {
  const rows = localiseRoles(all('SELECT * FROM roles ORDER BY level'), pickLang(req));
  const counts = all('SELECT role_key, COUNT(*) AS n FROM users WHERE active = 1 GROUP BY role_key');
  const map = new Map(counts.map((c) => [c.role_key, c.n]));
  res.json({ roles: rows.map((r) => ({ ...r, users: map.get(r.key) || 0 })) });
});

adminRouter.get('/permissions/:roleKey', requireLevel(2), (req, res) => {
  const roleKey = req.params.roleKey;
  if (!ROLE_BY_KEY.has(roleKey)) return res.status(404).json({ error: 'Peran tidak dikenal.' });
  const perms = permissionsFor(roleKey);
  const lang = pickLang(req);
  res.json({
    role: localiseRoles([ROLE_BY_KEY.get(roleKey)], lang)[0],
    permissions: MODULES.map((m) => ({
      module: m.key,
      name: moduleName(m, lang),
      group: groupNameOf(m, lang),
      groupCode: m.groupCode,
      ...(perms.get(m.key) || { view: false, create: false, edit: false, approve: false, delete: false }),
    })),
  });
});

adminRouter.put('/permissions/:roleKey', ADMIN, (req, res) => {
  const roleKey = req.params.roleKey;
  if (!ROLE_BY_KEY.has(roleKey)) return res.status(404).json({ error: 'Peran tidak dikenal.' });
  if (roleKey === 'sysadmin') return res.status(400).json({ error: 'Hak akses administrator sistem tidak dapat diubah.' });
  const changes = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
  for (const c of changes) {
    if (!MODULES.some((m) => m.key === c.module)) continue;
    run(
      `INSERT INTO role_permissions (role_key, module_key, can_view, can_create, can_edit, can_approve, can_delete)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(role_key, module_key) DO UPDATE SET
         can_view = excluded.can_view, can_create = excluded.can_create, can_edit = excluded.can_edit,
         can_approve = excluded.can_approve, can_delete = excluded.can_delete`,
      [roleKey, c.module, c.view ? 1 : 0, c.create ? 1 : 0, c.edit ? 1 : 0, c.approve ? 1 : 0, c.delete ? 1 : 0],
    );
  }
  clearPermissionCache(roleKey);
  logAudit({ user: req.user, action: 'permission.update', detail: `${roleKey}: ${changes.length} modul`, ip: req.ip });
  res.json({ ok: true });
});

adminRouter.post('/permissions/:roleKey/reset', ADMIN, (req, res) => {
  const roleKey = req.params.roleKey;
  if (!ROLE_BY_KEY.has(roleKey)) return res.status(404).json({ error: 'Peran tidak dikenal.' });
  for (const mod of MODULES) {
    const p = defaultPermissions(roleKey, mod);
    run(
      `INSERT INTO role_permissions (role_key, module_key, can_view, can_create, can_edit, can_approve, can_delete)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(role_key, module_key) DO UPDATE SET
         can_view = excluded.can_view, can_create = excluded.can_create, can_edit = excluded.can_edit,
         can_approve = excluded.can_approve, can_delete = excluded.can_delete`,
      [roleKey, mod.key, p.view, p.create, p.edit, p.approve, p.delete],
    );
  }
  clearPermissionCache(roleKey);
  logAudit({ user: req.user, action: 'permission.reset', detail: roleKey, ip: req.ip });
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- audit log */

adminRouter.get('/audit-log', requireLevel(3), (req, res) => {
  const size = Math.min(Number(req.query.size) || 100, 500);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const where = [];
  const params = [];
  if (req.query.action) { where.push('action LIKE ?'); params.push(`${req.query.action}%`); }
  if (req.query.module) { where.push('module_key = ?'); params.push(req.query.module); }
  if (req.query.username) { where.push('username LIKE ?'); params.push(`%${req.query.username}%`); }
  if (req.query.from) { where.push('ts >= ?'); params.push(String(req.query.from)); }
  if (req.query.to) { where.push('ts <= ?'); params.push(`${req.query.to}T23:59:59.999Z`); }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(`SELECT COUNT(*) AS n FROM audit_log ${sql}`, params).n;
  const rows = all(`SELECT * FROM audit_log ${sql} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, size, (page - 1) * size]);
  res.json({ total, page, size, entries: rows });
});

/* ------------------------------------------------------------------ system */

adminRouter.get('/system', requireLevel(2), (req, res) => {
  const lang = pickLang(req);
  const counts = MODULES.map((m) => ({
    key: m.key,
    name: moduleName(m, lang),
    group: groupNameOf(m, lang),
    records: get(`SELECT COUNT(*) AS n FROM "${m.table}" WHERE deleted_at IS NULL`).n,
  }));
  res.json({
    modules: MODULES.length,
    users: get('SELECT COUNT(*) AS n FROM users WHERE active = 1').n,
    sessions: get('SELECT COUNT(*) AS n FROM sessions').n,
    auditEntries: get('SELECT COUNT(*) AS n FROM audit_log').n,
    records: counts.reduce((a, c) => a + c.records, 0),
    byModule: counts,
    roles: ROLES,
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

adminRouter.post('/system/reseed-roles', ADMIN, (req, res) => {
  seedRoles({ overwrite: false });
  clearPermissionCache();
  logAudit({ user: req.user, action: 'system.reseed_roles', ip: req.ip });
  res.json({ ok: true });
});

export { decorate };
