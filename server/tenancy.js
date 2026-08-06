/**
 * Multi-tenancy & entitlement.
 *
 * Model bisnis: setiap CABANG ASDP adalah satu tenant yang berlangganan
 * bulanan. Paket langganan menentukan kelompok modul yang aktif dan batas
 * jumlah pengguna; status langganan menentukan apakah cabang masih boleh
 * menulis data.
 *
 * Dua jenis pengguna:
 *   - Operator platform (tanpa cabang: sysadmin, corporate QHSE, auditor)
 *     mengelola seluruh tenant dan tidak dibatasi paket.
 *     - Pengguna tenant (terikat pada satu cabang) dibatasi paket cabangnya.
 */
import { get, all } from './db.js';
import { MODULE_BY_KEY, MODULES } from './registry/index.js';

/** Kelompok yang selalu tersedia: master data dibutuhkan sebagai rujukan. */
const ALWAYS_INCLUDED = new Set(['governance']);

/** Status langganan yang masih memperbolehkan penulisan data. */
const WRITABLE_STATUS = new Set(['trial', 'active', 'past_due']);

const cache = new Map();
export const clearTenancyCache = () => cache.clear();

/**
 * Resolusi konteks langganan untuk seorang pengguna.
 * Hasilnya di-cache singkat karena dipanggil pada setiap permintaan.
 */
export function tenantContext(user) {
  if (!user) return null;
  const platform = !user.branch_id || ['sysadmin', 'corporate_qhse', 'auditor'].includes(user.role_key);
  if (platform) {
    return {
      platform: true,
      branchId: user.branch_id || null,
      subscription: null,
      plan: null,
      entitledGroups: null, // null = seluruh kelompok
      writable: true,
      reason: null,
    };
  }

  const key = `b${user.branch_id}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const subscription = get(
    `SELECT * FROM m_subscription WHERE branch_id = ? AND deleted_at IS NULL
     ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'trial' THEN 1 WHEN 'past_due' THEN 2 ELSE 3 END, id DESC LIMIT 1`,
    [user.branch_id],
  );

  let plan = null;
  if (subscription?.plan) plan = get('SELECT * FROM m_subscription_plan WHERE id = ?', [subscription.plan]);

  let entitledGroups = null;
  if (plan?.included_groups) {
    try {
      entitledGroups = new Set([...JSON.parse(plan.included_groups), ...ALWAYS_INCLUDED]);
    } catch {
      entitledGroups = new Set(ALWAYS_INCLUDED);
    }
  } else {
    // Tanpa langganan aktif, cabang hanya memperoleh akses baca terbatas.
    entitledGroups = new Set(ALWAYS_INCLUDED);
  }

  const writable = !!subscription && WRITABLE_STATUS.has(subscription.status);
  const value = {
    platform: false,
    branchId: user.branch_id,
    subscription,
    plan,
    entitledGroups,
    writable,
    reason: !subscription
      ? 'Cabang Anda belum memiliki langganan aktif.'
      : !writable
        ? `Langganan cabang berstatus "${subscription.status === 'suspended' ? 'Ditangguhkan' : 'Berhenti'}" sehingga hanya dapat dibaca.`
        : null,
  };

  cache.set(key, { value, expires: Date.now() + 30_000 });
  return value;
}

/** Apakah modul termasuk dalam paket langganan pengguna? */
export function isEntitled(user, moduleKey) {
  const mod = MODULE_BY_KEY.get(moduleKey);
  if (!mod) return false;
  const ctx = tenantContext(user);
  if (!ctx) return false;
  if (ctx.platform) return true;
  if (mod.platformOnly) return false;
  // Modul langganan (tagihan, pemakaian) selalu terlihat oleh tenant sendiri.
  if (mod.tenantVisible) return true;
  return ctx.entitledGroups.has(mod.group);
}

/**
 * Penjaga akses berbasis langganan, dipanggil sebelum operasi modul.
 * Menghasilkan 402 (Payment Required) agar dapat dibedakan dari 403 RBAC.
 */
export function assertEntitled(user, mod, action = 'view') {
  const ctx = tenantContext(user);
  if (ctx.platform) return;

  if (mod.platformOnly) {
    const err = new Error('Modul ini hanya untuk pengelola platform.');
    err.status = 403;
    throw err;
  }

  if (!mod.tenantVisible && !ctx.entitledGroups.has(mod.group)) {
    const err = new Error(
      `Modul "${mod.nameId}" tidak termasuk dalam paket ${ctx.plan?.name || 'langganan cabang Anda'}. ` +
      'Hubungi pengelola platform untuk meningkatkan paket.',
    );
    err.status = 402;
    err.upgrade = { module: mod.key, group: mod.groupName, currentPlan: ctx.plan?.name || null };
    throw err;
  }

  if (action !== 'view' && !ctx.writable) {
    const err = new Error(ctx.reason || 'Langganan cabang tidak memperbolehkan perubahan data.');
    err.status = 402;
    throw err;
  }
}

/** Ringkasan langganan untuk ditampilkan pada antarmuka. */
export function subscriptionSummary(user) {
  const ctx = tenantContext(user);
  const entitledKeys = MODULES.filter((m) => isEntitled(user, m.key)).map((m) => m.key);

  if (ctx.platform) {
    return {
      platform: true,
      planName: 'Pengelola Platform',
      status: 'platform',
      statusLabel: 'Akses Penuh Platform',
      entitledModules: entitledKeys,
      moduleCount: entitledKeys.length,
      totalModules: MODULES.length,
      writable: true,
    };
  }

  const branch = ctx.branchId ? get('SELECT name FROM m_branch WHERE id = ?', [ctx.branchId]) : null;
  const statusLabels = {
    trial: 'Uji Coba', active: 'Aktif', past_due: 'Menunggak',
    suspended: 'Ditangguhkan', ended: 'Berhenti',
  };

  return {
    platform: false,
    branch: branch?.name || null,
    planName: ctx.plan?.name || null,
    planTagline: ctx.plan?.tagline || null,
    status: ctx.subscription?.status || 'none',
    statusLabel: statusLabels[ctx.subscription?.status] || 'Belum Berlangganan',
    monthlyFee: ctx.subscription?.effective_fee ?? null,
    seats: ctx.subscription?.user_seats ?? null,
    activeUsers: ctx.subscription?.active_users ?? null,
    nextBilling: ctx.subscription?.next_billing_date || null,
    trialEnd: ctx.subscription?.trial_end || null,
    contractEnd: ctx.subscription?.contract_end || null,
    entitledModules: entitledKeys,
    moduleCount: entitledKeys.length,
    totalModules: MODULES.length,
    writable: ctx.writable,
    reason: ctx.reason,
  };
}

/** Statistik ringkas seluruh tenant, untuk dashboard pengelola platform. */
export function tenantOverview() {
  const rows = all(
    `SELECT s.*, b.name AS branch_name, p.name AS plan_name
       FROM m_subscription s
       LEFT JOIN m_branch b ON b.id = s.branch_id
       LEFT JOIN m_subscription_plan p ON p.id = s.plan
      WHERE s.deleted_at IS NULL
      ORDER BY s.status, b.name`,
  );
  return rows;
}
