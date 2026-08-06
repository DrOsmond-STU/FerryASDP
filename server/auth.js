/**
 * Authentication - scrypt password hashing, opaque session tokens in an
 * httpOnly cookie, lockout after repeated failures (ISO 27001 A.5.17/A.8.5).
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { get, run, logAudit } from './db.js';
import { ROLE_BY_KEY } from './rbac.js';

const SESSION_HOURS = Number(process.env.QHSE_SESSION_HOURS || 12);
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
export const COOKIE_NAME = 'qhse_session';

const KEYLEN = 64;

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, KEYLEN).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const candidate = scryptSync(password, salt, KEYLEN);
  const stored = Buffer.from(hash, 'hex');
  if (stored.length !== candidate.length) return false;
  return timingSafeEqual(candidate, stored);
}

/** Password policy - deliberately explicit so it can be cited in an audit. */
export function validatePassword(password) {
  const problems = [];
  if (!password || password.length < 10) problems.push('minimal 10 karakter');
  if (!/[A-Z]/.test(password || '')) problems.push('mengandung huruf besar');
  if (!/[a-z]/.test(password || '')) problems.push('mengandung huruf kecil');
  if (!/[0-9]/.test(password || '')) problems.push('mengandung angka');
  return problems;
}

const now = () => new Date();
const iso = (d) => d.toISOString();

export function createSession(user, { ip, userAgent } = {}) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(now().getTime() + SESSION_HOURS * 3600 * 1000);
  run('INSERT INTO sessions (token, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)', [
    // Only a digest is stored: a leaked database cannot be replayed as a login.
    sha(token),
    user.id,
    iso(now()),
    iso(expires),
    ip || null,
    userAgent || null,
  ]);
  return { token, expires };
}

const sha = (v) => createHash('sha256').update(v).digest('hex');

export function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', [sha(token)]);
}

export function purgeExpiredSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', [iso(now())]);
}

export function userFromToken(token) {
  if (!token) return null;
  const session = get('SELECT * FROM sessions WHERE token = ?', [sha(token)]);
  if (!session) return null;
  if (new Date(session.expires_at) < now()) {
    run('DELETE FROM sessions WHERE token = ?', [sha(token)]);
    return null;
  }
  const user = get('SELECT * FROM users WHERE id = ? AND active = 1', [session.user_id]);
  if (!user) return null;
  return decorate(user);
}

export function decorate(user) {
  const role = ROLE_BY_KEY.get(user.role_key);
  const { password_hash, password_salt, ...safe } = user;
  return { ...safe, level: role?.level ?? 99, role_name: role?.name ?? user.role_key, scope_type: role?.scope_type ?? 'own' };
}

export function login({ username, password, ip, userAgent }) {
  const row = get('SELECT * FROM users WHERE lower(username) = lower(?)', [username || '']);
  const fail = (reason) => {
    logAudit({ user: { username }, action: 'login.failed', detail: reason, ip });
    const err = new Error('Nama pengguna atau kata sandi tidak sesuai.');
    err.status = 401;
    return err;
  };

  if (!row) throw fail('unknown user');
  if (!row.active) {
    const err = new Error('Akun dinonaktifkan. Hubungi administrator sistem.');
    err.status = 403;
    throw err;
  }
  if (row.locked_until && new Date(row.locked_until) > now()) {
    const err = new Error(`Akun terkunci sementara sampai ${new Date(row.locked_until).toLocaleString('id-ID')}.`);
    err.status = 423;
    throw err;
  }
  if (!verifyPassword(password || '', row.password_hash, row.password_salt)) {
    const attempts = row.failed_attempts + 1;
    const lock = attempts >= MAX_FAILED ? iso(new Date(now().getTime() + LOCK_MINUTES * 60000)) : null;
    run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', [attempts, lock, row.id]);
    throw fail(`bad password (attempt ${attempts})`);
  }

  run('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = ? WHERE id = ?', [iso(now()), row.id]);
  const user = decorate(row);
  const session = createSession(user, { ip, userAgent });
  logAudit({ user, action: 'login.success', ip });
  purgeExpiredSessions();
  return { user, session };
}

export function changePassword(user, { currentPassword, newPassword }) {
  const row = get('SELECT * FROM users WHERE id = ?', [user.id]);
  if (!row) {
    const err = new Error('Pengguna tidak ditemukan.');
    err.status = 404;
    throw err;
  }
  if (!verifyPassword(currentPassword || '', row.password_hash, row.password_salt)) {
    const err = new Error('Kata sandi saat ini tidak sesuai.');
    err.status = 400;
    throw err;
  }
  const problems = validatePassword(newPassword);
  if (problems.length) {
    const err = new Error(`Kata sandi baru harus ${problems.join(', ')}.`);
    err.status = 400;
    throw err;
  }
  const { hash, salt } = hashPassword(newPassword);
  run('UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = ? WHERE id = ?', [
    hash, salt, iso(now()), user.id,
  ]);
  run('DELETE FROM sessions WHERE user_id = ?', [user.id]);
  logAudit({ user, action: 'password.changed' });
}

/* --------------------------------------------------------------- middleware */

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function attachUser(req, _res, next) {
  const token = readCookie(req, COOKIE_NAME);
  req.sessionToken = token;
  req.user = userFromToken(token);
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sesi tidak valid atau telah berakhir. Silakan masuk kembali.' });
  next();
}

export function requireLevel(maxLevel) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Belum masuk.' });
    if (req.user.level > maxLevel) return res.status(403).json({ error: 'Hak akses tidak mencukupi.' });
    next();
  };
}

export function sessionCookie(token, expires) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Expires=${expires.toUTCString()}`,
  ];
  if (process.env.QHSE_SECURE_COOKIE === '1') parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
