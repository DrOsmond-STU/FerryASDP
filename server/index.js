/**
 * Enterprise Integrated QHSE Management System
 * PT ASDP Indonesia Ferry (Persero)
 *
 * Application entry point.
 */
import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { migrate, get, logAudit, setting } from './db.js';
import { catalogue, GROUPS, MODULES } from './registry/index.js';
import { seedRoles, permissionSummary, ROLES, clearPermissionCache } from './rbac.js';
import { RISK_BANDS, EMISSION_FACTORS } from './compute.js';
import {
  attachUser, requireAuth, login, destroySession, changePassword,
  sessionCookie, clearCookie, decorate,
} from './auth.js';
import { engineRouter } from './engine.js';
import { publicRouter } from './public.js';
import { subscriptionSummary, clearTenancyCache } from './tenancy.js';
import { dashboardRouter } from './dashboards.js';
import { adminRouter } from './admin.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);

migrate();
seedRoles();
clearPermissionCache();
clearTenancyCache();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '8mb' }));

/** Baseline security headers (ISO 27001 A.8.9 - secure configuration). */
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  next();
});

app.use(attachUser);

/* ------------------------------------------------------------------- auth */

app.post('/api/auth/login', (req, res, next) => {
  try {
    const { user, session } = login({
      username: req.body?.username,
      password: req.body?.password,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.setHeader('Set-Cookie', sessionCookie(session.token, session.expires));
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/logout', (req, res) => {
  if (req.user) logAudit({ user: req.user, action: 'logout', ip: req.ip });
  destroySession(req.sessionToken);
  res.setHeader('Set-Cookie', clearCookie());
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Belum masuk.' });
  res.json({
    user: publicUser(req.user),
    permissions: permissionSummary(req.user),
    subscription: subscriptionSummary(req.user),
  });
});

app.post('/api/auth/password', requireAuth, (req, res, next) => {
  try {
    changePassword(req.user, { currentPassword: req.body?.currentPassword, newPassword: req.body?.newPassword });
    res.setHeader('Set-Cookie', clearCookie());
    res.json({ ok: true, message: 'Kata sandi diperbarui. Silakan masuk kembali.' });
  } catch (err) {
    next(err);
  }
});

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    email: user.email,
    position: user.position,
    role_key: user.role_key,
    role_name: user.role_name,
    level: user.level,
    scope_type: user.scope_type,
    region_id: user.region_id,
    branch_id: user.branch_id,
    port_id: user.port_id,
    vessel_id: user.vessel_id,
    contractor_id: user.contractor_id,
    must_change_password: !!user.must_change_password,
  };
}

/* ------------------------------------------------------------------- meta */

app.get('/api/meta', requireAuth, (req, res) => {
  res.json({
    app: {
      name: 'Enterprise Integrated QHSE Management System',
      organisation: setting('company_name') || 'PT ASDP Indonesia Ferry (Persero)',
      version: '1.0.0',
      moduleCount: MODULES.length,
      groupCount: GROUPS.length,
    },
    ...catalogue(),
    roles: ROLES,
    riskBands: RISK_BANDS,
    emissionFactors: EMISSION_FACTORS,
    user: publicUser(req.user),
    permissions: permissionSummary(req.user),
    subscription: subscriptionSummary(req.user),
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', modules: MODULES.length, users: get('SELECT COUNT(*) AS n FROM users').n });
});

/* ----------------------------------------------------------------- routers */

app.use('/api/public', publicRouter);
app.use('/api', engineRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/admin', adminRouter);

/* ------------------------------------------------------------------ static */

const PUBLIC = resolve(ROOT, 'public');
app.use(express.static(PUBLIC, { index: 'index.html', maxAge: '1h' }));

app.get(/^\/(?!api).*/, (_req, res) => {
  const index = resolve(PUBLIC, 'index.html');
  if (existsSync(index)) return res.sendFile(index);
  res.status(404).send('Antarmuka belum tersedia.');
});

/* ------------------------------------------------------------ error handler */

app.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error('[qhse]', err);
    logAudit({ user: req.user, action: 'error', detail: err.message, ip: req.ip });
  }
  res.status(status).json({ error: err.message || 'Terjadi kesalahan pada server.', details: err.details });
});

if (!get('SELECT 1 FROM users LIMIT 1')) {
  console.warn('\n  Belum ada pengguna. Jalankan "npm run seed" untuk memuat data awal.\n');
}

app.listen(PORT, () => {
  console.log(`\n  QHSE ASDP siap pada http://localhost:${PORT}`);
  console.log(`  ${MODULES.length} modul dalam ${GROUPS.length} kelompok fungsi.\n`);
});

export default app;
