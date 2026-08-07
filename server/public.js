/**
 * Endpoint publik (tanpa sesi) untuk halaman depan pemasaran.
 *
 * Hanya membaca data paket yang ditandai publik dan menerima permintaan uji
 * coba. Tidak ada data operasional cabang yang terekspos di sini.
 */
import { Router } from 'express';
import { all, run, nextCode, logAudit, get } from './db.js';
import { MODULE_BY_KEY, MODULES, GROUPS } from './registry/index.js';
import { applyComputed } from './compute.js';
import { pickLang, tr } from './i18n.js';

export const publicRouter = Router();

const nowIso = () => new Date().toISOString();

/** Jumlah modul per kelompok, untuk menampilkan isi tiap paket. */
const groupModuleCount = new Map(GROUPS.map((g) => [g.key, g.modules.length]));

/**
 * Nama kelompok modul sudah dwibahasa sejak di registry: `name` bahasa Inggris,
 * `nameId` bahasa Indonesia. Halaman depan memakai keduanya, jadi dipilih di
 * sini — bukan diterjemahkan ulang lewat kamus.
 */
const groupName = (key, lang) => {
  const g = GROUPS.find((x) => x.key === key);
  if (!g) return key;
  return lang === 'en' ? g.name : (g.nameId || g.name);
};

publicRouter.get('/plans', (req, res) => {
  const lang = pickLang(req);
  const rows = all(
    `SELECT * FROM m_subscription_plan WHERE deleted_at IS NULL AND is_public = 1 AND status = 'active'
     ORDER BY COALESCE(sort_order, 999), monthly_price`,
  );

  const plans = rows.map((p) => {
    let groups = [];
    try { groups = JSON.parse(p.included_groups || '[]'); } catch { groups = []; }
    let highlights = [];
    try { highlights = JSON.parse(p.highlights || '[]'); } catch { highlights = []; }
    return {
      id: p.id,
      // Nama paket adalah merek dagang — tidak diterjemahkan. Kalimat penjelas,
      // tingkat dukungan dan sorotan fitur diterjemahkan.
      name: p.name,
      tagline: tr(p.tagline, lang),
      monthlyPrice: p.monthly_price,
      annualPrice: p.annual_price,
      annualSavingPercent: p.annual_saving_percent,
      maxUsers: p.max_users,
      storageGb: p.storage_gb,
      supportLevel: tr(p.support_level, lang),
      slaUptime: p.sla_uptime,
      onboardingIncluded: !!p.onboarding_included,
      trainingIncluded: !!p.training_included,
      apiAccess: !!p.api_access,
      dedicatedReport: !!p.dedicated_report,
      recommended: !!p.recommended,
      description: tr(p.description, lang),
      highlights: highlights.map((x) => tr(x, lang)),
      groups: groups.map((key) => ({
        key,
        name: groupName(key, lang),
        modules: groupModuleCount.get(key) || 0,
      })),
      moduleCount: groups.reduce((a, key) => a + (groupModuleCount.get(key) || 0), 0),
    };
  });

  res.json({ plans });
});

/** Ringkasan kemampuan produk untuk halaman depan. */
publicRouter.get('/overview', (req, res) => {
  const lang = pickLang(req);
  res.json({
    product: {
      name: 'QHSE ASDP',
      full: 'Enterprise Integrated QHSE Management System',
      operator: 'PT Semesta Teknologi Utama',
      moduleCount: MODULES.filter((m) => m.group !== 'saas').length,
      groupCount: GROUPS.filter((g) => g.key !== 'saas').length,
    },
    // Kelompok komersial (langganan & penagihan) bukan bagian dari nilai jual
    // produk, jadi tidak ditampilkan sebagai modul pada halaman depan.
    groups: GROUPS.filter((g) => g.key !== 'saas')
      .map((g) => ({ code: g.code, key: g.key, name: groupName(g.key, lang), icon: g.icon, modules: g.modules.length })),
    standards: [
      'ISO 9001:2015', 'ISO 14001:2015', 'ISO 45001:2018', 'ISO 31000:2018', 'ISO 55001:2014',
      'ISO 50001:2018', 'ISO 22301:2019', 'ISO 27001:2022', 'ISO 19011:2018', 'ISO 14064-1',
      'ISM Code', 'SOLAS', 'LSA & FSS Code', 'IMDG Code', 'ISPS Code', 'GRI Standards',
    ],
    // Nomor peraturan adalah identitas hukumnya dan tidak diterjemahkan;
    // yang berpindah bahasa hanya nama lembaga dan keterangan di dalamnya.
    regulators: regulators(lang),
  });
});

const REGULATORS = [
  { name: 'Kementerian Perhubungan', items: ['UU No. 17 Tahun 2008', 'PP No. 61 Tahun 2009', 'PP No. 20 Tahun 2010', 'PM No. 82 Tahun 2014 (SPB)', 'PM No. 134 Tahun 2016 (ISPS)'] },
  { name: 'Kementerian Ketenagakerjaan', items: ['UU No. 1 Tahun 1970', 'PP No. 50 Tahun 2012 (SMK3)', 'Permenaker APD, P2K3, Pesawat Angkat, Listrik, Bejana Tekan'] },
  { name: 'Kementerian LHK', items: ['PP No. 22 Tahun 2021', 'PermenLHK No. 6 Tahun 2021 (Limbah B3)', 'Pelaporan RKL-RPL', 'Perpres No. 98 Tahun 2021 (Karbon)'] },
  { name: 'OJK & Keberlanjutan', items: ['POJK No. 51/POJK.03/2017', 'SEOJK No. 16/SEOJK.04/2021', 'GRI Standards'] },
];

const regulators = (lang) => REGULATORS.map((r) => ({
  name: tr(r.name, lang),
  items: r.items.map((i) => tr(i, lang)),
}));

/* --------------------------------------------------- permintaan uji coba */

// Pembatas laju sederhana per alamat IP agar formulir publik tidak disalahgunakan.
const submissions = new Map();
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 5;

function rateLimited(ip) {
  const now = Date.now();
  const entries = (submissions.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (entries.length >= RATE_MAX) return true;
  entries.push(now);
  submissions.set(ip, entries);
  return false;
}

const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);

publicRouter.post('/trial-request', (req, res) => {
  const lang = pickLang(req);
  if (rateLimited(req.ip)) {
    return res.status(429).json({ error: tr('Terlalu banyak permintaan dari jaringan ini. Coba lagi beberapa saat lagi.', lang) });
  }

  const body = req.body || {};
  const organisation = clean(body.organisation, 160);
  const contactName = clean(body.contact_name, 120);
  const email = clean(body.email, 160);

  const errors = [];
  if (!organisation) errors.push(tr('Nama cabang/unit wajib diisi.', lang));
  if (!contactName) errors.push(tr('Nama penanggung jawab wajib diisi.', lang));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push(tr('Alamat surel tidak valid.', lang));
  if (errors.length) return res.status(400).json({ error: tr('Data belum lengkap.', lang), details: errors });

  const mod = MODULE_BY_KEY.get('trial_request');
  const row = {
    organisation,
    contact_name: contactName,
    position: clean(body.position, 120) || null,
    email,
    phone: clean(body.phone, 40) || null,
    plan_interest: ['Esensial', 'Profesional', 'Maritim Enterprise', 'Belum Menentukan'].includes(body.plan_interest)
      ? body.plan_interest : 'Belum Menentukan',
    employee_count: Number.isFinite(Number(body.employee_count)) ? Number(body.employee_count) : null,
    priority_area: clean(body.priority_area, 120) || null,
    message: clean(body.message, 2000) || null,
    source: 'Halaman Depan Aplikasi',
    request_date: nowIso().slice(0, 10),
    qualification: 'Sedang',
  };
  applyComputed(mod, row);

  row.code = nextCode(mod.codePrefix);
  row.status = mod.initialStatus;
  row.created_at = nowIso();
  row.updated_at = row.created_at;

  const cols = Object.keys(row);
  run(
    `INSERT INTO "${mod.table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => row[c]),
  );
  logAudit({ user: { username: email }, action: 'public.trial_request', module_key: mod.key, record_code: row.code, detail: organisation, ip: req.ip });

  res.status(201).json({
    ok: true,
    code: row.code,
    message: lang === 'en'
      ? `Thank you. Your trial request has been logged as ${row.code}. Our team will contact ${email} within two working days.`
      : `Terima kasih. Permintaan uji coba Anda tercatat dengan nomor ${row.code}. Tim kami akan menghubungi ${email} paling lambat 2 hari kerja.`,
  });
});
