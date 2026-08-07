/**
 * Database layer - SQLite via Node's built-in node:sqlite (no native build
 * step). Schema for the 80+ functional modules is generated from the registry,
 * so a new module never needs a migration written by hand.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULES, REF_FIELD_TYPES } from './registry/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.QHSE_DB || resolve(ROOT, 'data', 'qhse.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/* ------------------------------------------------------------ query helpers */

export const all = (sql, params = []) => db.prepare(sql).all(...params);
export const get = (sql, params = []) => db.prepare(sql).get(...params);
export const run = (sql, params = []) => db.prepare(sql).run(...params);

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/* ------------------------------------------------------------- column types */

export function sqlType(field) {
  if (field.type === 'number' || field.type === 'currency') return 'REAL';
  if (field.type === 'bool') return 'INTEGER';
  if (REF_FIELD_TYPES.includes(field.type)) return 'INTEGER';
  return 'TEXT';
}

/** Columns every module row carries regardless of its declaration. */
export const COMMON_COLUMNS = [
  ['id', 'INTEGER PRIMARY KEY AUTOINCREMENT'],
  ['code', 'TEXT UNIQUE'],
  ['status', 'TEXT'],
  ['region_id', 'INTEGER'],
  ['branch_id', 'INTEGER'],
  ['port_id', 'INTEGER'],
  ['vessel_id', 'INTEGER'],
  ['owner_id', 'INTEGER'],
  ['source_module', 'TEXT'],
  ['source_id', 'INTEGER'],
  ['created_by', 'INTEGER'],
  ['created_at', 'TEXT'],
  ['updated_by', 'INTEGER'],
  ['updated_at', 'TEXT'],
  ['closed_at', 'TEXT'],
  ['deleted_at', 'TEXT'],
];

const RESERVED = new Set(COMMON_COLUMNS.map(([c]) => c));

/* ------------------------------------------------------------------ schema */

const CORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS roles (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level INTEGER NOT NULL,
  scope_type TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  position TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role_key TEXT NOT NULL REFERENCES roles(key),
  region_id INTEGER,
  branch_id INTEGER,
  port_id INTEGER,
  vessel_id INTEGER,
  contractor_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  language TEXT NOT NULL DEFAULT 'id',
  -- 'system' berarti mengikuti pengaturan perangkat, bukan sebuah tema.
  theme TEXT NOT NULL DEFAULT 'system',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_key TEXT NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  can_view INTEGER NOT NULL DEFAULT 0,
  can_create INTEGER NOT NULL DEFAULT 0,
  can_edit INTEGER NOT NULL DEFAULT 0,
  can_approve INTEGER NOT NULL DEFAULT 0,
  can_delete INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (role_key, module_key)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  module_key TEXT,
  record_id INTEGER,
  record_code TEXT,
  detail TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_log(module_key, record_id);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_key TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  content BLOB,
  uploaded_by INTEGER,
  uploaded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_attach_record ON attachments(module_key, record_id);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_key TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  user_id INTEGER,
  username TEXT,
  body TEXT NOT NULL,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_comment_record ON comments(module_key, record_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  module_key TEXT,
  record_id INTEGER,
  severity TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS counters (
  prefix TEXT NOT NULL,
  year TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, year)
);

CREATE TABLE IF NOT EXISTS custom_dashboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  description TEXT,
  layout TEXT NOT NULL DEFAULT '[]',
  theme TEXT NOT NULL DEFAULT '{}',
  min_level INTEGER,
  published INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT,
  updated_by INTEGER,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

/** Create/upgrade the schema. Adding a field to a module adds a column. */
export function migrate() {
  db.exec(CORE_SCHEMA);

  // Kolom pada tabel inti tidak dibangkitkan dari registry, jadi penambahannya
  // perlu disebut satu per satu di sini agar basis data yang sudah berjalan
  // ikut terbawa.
  const userCols = new Set(all('PRAGMA table_info(users)').map((c) => c.name));
  if (!userCols.has('language')) db.exec("ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'id'");
  if (!userCols.has('theme')) db.exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'system'");

  for (const mod of MODULES) {
    const cols = COMMON_COLUMNS.map(([name, type]) => `"${name}" ${type}`);
    for (const field of mod.fields) {
      if (RESERVED.has(field.name)) {
        throw new Error(`Module ${mod.key}: field "${field.name}" collides with a reserved column`);
      }
      cols.push(`"${field.name}" ${sqlType(field)}`);
    }
    db.exec(`CREATE TABLE IF NOT EXISTS "${mod.table}" (${cols.join(', ')})`);

    // Additive migration for modules that gained fields since the DB was made.
    const existing = new Set(all(`PRAGMA table_info("${mod.table}")`).map((c) => c.name));
    for (const field of mod.fields) {
      if (!existing.has(field.name)) {
        db.exec(`ALTER TABLE "${mod.table}" ADD COLUMN "${field.name}" ${sqlType(field)}`);
      }
    }
    for (const [name, type] of COMMON_COLUMNS) {
      if (!existing.has(name) && name !== 'id') {
        const decl = type.replace(' UNIQUE', '');
        db.exec(`ALTER TABLE "${mod.table}" ADD COLUMN "${name}" ${decl}`);
      }
    }
    db.exec(`CREATE INDEX IF NOT EXISTS "idx_${mod.key}_status" ON "${mod.table}"(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS "idx_${mod.key}_org" ON "${mod.table}"(port_id, vessel_id, branch_id)`);
  }
}

/* -------------------------------------------------------------- record code */

/** Human-readable record numbers, e.g. INC/2026/0042. */
export function nextCode(prefix, year = String(new Date().getFullYear())) {
  run('INSERT INTO counters (prefix, year, seq) VALUES (?, ?, 0) ON CONFLICT(prefix, year) DO NOTHING', [prefix, year]);
  run('UPDATE counters SET seq = seq + 1 WHERE prefix = ? AND year = ?', [prefix, year]);
  const row = get('SELECT seq FROM counters WHERE prefix = ? AND year = ?', [prefix, year]);
  return `${prefix}/${year}/${String(row.seq).padStart(4, '0')}`;
}

export function setting(key, value) {
  if (value === undefined) {
    const row = get('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : null;
  }
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(value)]);
  return value;
}

export function logAudit({ user, action, module_key = null, record_id = null, record_code = null, detail = null, ip = null }) {
  run(
    `INSERT INTO audit_log (ts, user_id, username, action, module_key, record_id, record_code, detail, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      new Date().toISOString(),
      user?.id ?? null,
      user?.username ?? null,
      action,
      module_key,
      record_id,
      record_code,
      detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null,
      ip,
    ],
  );
}
