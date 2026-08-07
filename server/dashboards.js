/**
 * Dashboards & analytics.
 *
 * Every aggregate is computed through the same row-level security filter used
 * by the list API, so a port manager's "national" number is really their port.
 */
import { Router } from 'express';
import { all, get } from './db.js';
import { MODULE_BY_KEY, MODULES } from './registry/index.js';
import { scopeClause, can } from './rbac.js';
import { isEntitled, tenantOverview, tenantContext } from './tenancy.js';
import { requireAuth } from './auth.js';
import { EMISSION_FACTORS, round } from './compute.js';
import { pickLang, tr } from './i18n.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

/**
 * Bahasa ditempelkan pada salinan `req.user` supaya seluruh pembantu di berkas
 * ini — yang sudah menerima `user` untuk keperluan hak akses — ikut tahu bahasa
 * yang diminta tanpa harus menambah satu parameter pada setiap pemanggilan.
 *
 * Label grafik dan lencana dashboard berasal dari nilai kolom di basis data,
 * bukan dari teks tetap di antarmuka; hanya di sinilah tempat menerjemahkannya.
 * Yang diterjemahkan adalah label yang tampil — bukan nilai yang tersimpan.
 */
dashboardRouter.use((req, _res, next) => {
  if (req.user) req.user = { ...req.user, language: pickLang(req) };
  next();
});

const langOf = (user) => (user?.language === 'en' ? 'en' : 'id');
const trFor = (user, text) => tr(text, langOf(user));

/** Nama modul: `nameId` Indonesia, `name` Inggris — sudah dwibahasa di registry. */
const moduleName = (user, mod) => (mod ? (langOf(user) === 'en' ? mod.name : mod.nameId) : undefined);

const monthsBack = (n) => {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
};

const yearNow = () => String(new Date().getFullYear());
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Base WHERE for a module honouring soft-delete and the user's scope. */
export function base(user, key) {
  const mod = MODULE_BY_KEY.get(key);
  if (!mod || !can(user, key, 'view') || !isEntitled(user, key)) return null;
  const scope = scopeClause(user, mod);
  return {
    mod,
    where: `t.deleted_at IS NULL${scope.sql ? ` AND ${scope.sql}` : ''}`,
    params: scope.params,
  };
}

export function countWhere(user, key, extraSql = '', extraParams = []) {
  const b = base(user, key);
  if (!b) return 0;
  const sql = `SELECT COUNT(*) AS n FROM "${b.mod.table}" t WHERE ${b.where}${extraSql ? ` AND ${extraSql}` : ''}`;
  return get(sql, [...b.params, ...extraParams])?.n || 0;
}

/**
 * Label pengelompokan berasal dari isi kolom, dan isi kolom ada dua macam:
 * nilai pilihan yang sudah tertulis di registry, dan teks bebas yang diketik
 * pengguna. Hanya yang pertama boleh diterjemahkan — nama kapal, nama pegawai
 * dan judul rekaman adalah data operasional, bukan istilah antarmuka.
 *
 * Kolom `status` menyimpan kunci alur kerja (`in_progress`), bukan teks yang
 * layak dibaca; kuncinya ditukar dengan label alur kerjanya lebih dulu.
 */
function groupLabeller(mod, column, lang) {
  if (column === 'status') {
    const labels = new Map(mod.workflow.map((s) => [s.key, s.label]));
    return (v) => tr(labels.get(v) || v, lang);
  }
  const field = mod.fields.find((f) => f.name === column);
  // `options` untuk yang dipilih pengguna, `values` untuk yang dihitung sistem
  // namun kosakatanya tetap terbatas (tingkat risiko, status sertifikat).
  const vocabulary = field?.options?.map((o) => (typeof o === 'string' ? o : o.value)) || field?.values;
  if (!vocabulary?.length) return (v) => v;
  const known = new Set(vocabulary);
  return (v) => (known.has(v) ? tr(v, lang) : v);
}

export function groupCount(user, key, column, extraSql = '', extraParams = []) {
  const b = base(user, key);
  if (!b) return [];
  const sql = `SELECT t."${column}" AS label, COUNT(*) AS value FROM "${b.mod.table}" t
               WHERE ${b.where}${extraSql ? ` AND ${extraSql}` : ''} AND t."${column}" IS NOT NULL
               GROUP BY t."${column}" ORDER BY value DESC`;
  // Pengelompokan sudah selesai di SQL atas nilai aslinya, jadi mengganti
  // labelnya di sini tidak dapat menggabungkan atau memecah baris.
  const label = groupLabeller(b.mod, column, langOf(user));
  return all(sql, [...b.params, ...extraParams]).map((r) => ({ ...r, label: label(r.label) }));
}

export function sumOf(user, key, column, extraSql = '', extraParams = []) {
  const b = base(user, key);
  if (!b) return 0;
  const sql = `SELECT COALESCE(SUM(t."${column}"), 0) AS s FROM "${b.mod.table}" t WHERE ${b.where}${extraSql ? ` AND ${extraSql}` : ''}`;
  return round(get(sql, [...b.params, ...extraParams])?.s || 0, 3);
}

/** Monthly series based on a date column. */
export function monthlySeries(user, key, dateColumn, { months = 12, agg = 'COUNT(*)', extraSql = '', extraParams = [] } = {}) {
  const b = base(user, key);
  const labels = monthsBack(months);
  if (!b) return labels.map((m) => ({ label: m, value: 0 }));
  const rows = all(
    `SELECT substr(t."${dateColumn}", 1, 7) AS ym, ${agg} AS value FROM "${b.mod.table}" t
     WHERE ${b.where} AND t."${dateColumn}" IS NOT NULL${extraSql ? ` AND ${extraSql}` : ''}
     GROUP BY ym`,
    [...b.params, ...extraParams],
  );
  const map = new Map(rows.map((r) => [r.ym, r.value]));
  return labels.map((m) => ({ label: m, value: round(map.get(m) || 0, 3) }));
}

/* ------------------------------------------------------------ risk heatmap */

export function riskHeatmap(user, keys = ['risk_register', 'corporate_risk', 'operational_risk', 'port_risk', 'vessel_risk', 'hira']) {
  const grid = Array.from({ length: 5 }, () => Array(5).fill(0));
  for (const key of keys) {
    const b = base(user, key);
    if (!b) continue;
    const rows = all(
      `SELECT t.likelihood AS l, t.severity AS s, COUNT(*) AS n FROM "${b.mod.table}" t
       WHERE ${b.where} AND t.likelihood IS NOT NULL AND t.severity IS NOT NULL GROUP BY l, s`,
      b.params,
    );
    for (const r of rows) {
      const l = Number(String(r.l).match(/^\d+/)?.[0]);
      const s = Number(String(r.s).match(/^\d+/)?.[0]);
      if (l >= 1 && l <= 5 && s >= 1 && s <= 5) grid[l - 1][s - 1] += r.n;
    }
  }
  return grid;
}

/* -------------------------------------------------------------- safety math */

function safetyRates(user, year = yearNow()) {
  const manhours = sumOf(user, 'manhours', 'total_hours', "t.period LIKE ?", [`${year}-%`]);
  const like = [`${year}-%`];
  const fatality = sumOf(user, 'incident', 'fatality_count', 't.incident_date LIKE ?', like);
  const lti = countWhere(user, 'incident', "t.classification = 'Lost Time Injury (LTI)' AND t.incident_date LIKE ?", like);
  const mtc = countWhere(user, 'incident', "t.classification = 'Medical Treatment Case (MTC)' AND t.incident_date LIKE ?", like);
  const fac = countWhere(user, 'incident', "t.classification = 'First Aid Case (FAC)' AND t.incident_date LIKE ?", like);
  const rwc = countWhere(user, 'incident', "t.classification = 'Restricted Work Case (RWC)' AND t.incident_date LIKE ?", like);
  const lostDays = sumOf(user, 'incident', 'lost_days', 't.incident_date LIKE ?', like);
  const rate = (n) => (manhours > 0 ? round((n * 1e6) / manhours, 2) : null);
  return {
    manhours,
    fatality,
    lti,
    mtc,
    fac,
    rwc,
    lostDays,
    ltifr: rate(fatality + lti),
    trir: rate(fatality + lti + mtc + rwc + fac),
    severityRate: rate(lostDays),
  };
}

/* ---------------------------------------------------------------- carbon */

function carbonTotals(user, year = yearNow()) {
  const b = base(user, 'fuel_consumption');
  const byScope = { 'Scope 1': 0, 'Scope 2': 0, 'Scope 3': 0 };
  const bySource = [];
  if (b) {
    const rows = all(
      `SELECT t.energy_type AS type, COALESCE(SUM(t.co2e_kg), 0) AS kg FROM "${b.mod.table}" t
       WHERE ${b.where} AND t.period LIKE ? GROUP BY t.energy_type`,
      [...b.params, `${year}-%`],
    );
    for (const r of rows) {
      const scope = r.type === 'Listrik PLN' ? 'Scope 2' : 'Scope 1';
      byScope[scope] += r.kg / 1000;
      bySource.push({ label: trFor(user, r.type), value: round(r.kg / 1000, 3), factor: EMISSION_FACTORS[r.type]?.factor ?? null });
    }
  }
  const declared = base(user, 'carbon_footprint');
  if (declared) {
    const rows = all(
      `SELECT t.scope_ghg AS scope, COALESCE(SUM(t.co2e_ton), 0) AS ton FROM "${declared.mod.table}" t
       WHERE ${declared.where} AND t.period LIKE ? GROUP BY t.scope_ghg`,
      [...declared.params, `${year}%`],
    );
    for (const r of rows) {
      if (String(r.scope).startsWith('Scope 3')) byScope['Scope 3'] += r.ton;
    }
  }
  const total = Object.values(byScope).reduce((a, v) => a + v, 0);
  return {
    byScope: Object.entries(byScope).map(([label, value]) => ({ label, value: round(value, 3) })),
    bySource: bySource.sort((a, b2) => b2.value - a.value),
    total: round(total, 3),
  };
}

/* ------------------------------------------------------------------ alerts */

/** Documents, certificates and permits approaching (or past) their date. */
export function collectAlerts(user, { days = 60, limit = 200 } = {}) {
  const limitDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const today = todayIso();
  const alerts = [];

  for (const mod of MODULES) {
    if (!can(user, mod.key, 'view') || !isEntitled(user, mod.key)) continue;
    const scope = scopeClause(user, mod);
    const where = `t.deleted_at IS NULL${scope.sql ? ` AND ${scope.sql}` : ''}`;

    for (const field of mod.fields) {
      if (field.alert !== 'expiry' && field.alert !== 'due') continue;
      const rows = all(
        `SELECT t.id, t.code, t.status, t."${field.name}" AS target, t."${mod.labelField}" AS label
         FROM "${mod.table}" t WHERE ${where} AND t."${field.name}" IS NOT NULL AND t."${field.name}" <= ?
         ORDER BY t."${field.name}" LIMIT 50`,
        [...scope.params, limitDate],
      );
      for (const r of rows) {
        const terminal = mod.workflow.find((s) => s.key === r.status)?.terminal;
        if (terminal) continue;
        const overdue = r.target < today;
        alerts.push({
          module: mod.key,
          moduleName: moduleName(user, mod),
          icon: mod.icon,
          id: r.id,
          code: r.code,
          label: r.label,
          field: trFor(user, field.label),
          date: r.target,
          kind: field.alert,
          severity: overdue ? 'overdue' : 'soon',
          daysLeft: Math.round((new Date(r.target) - new Date(today)) / 86400000),
        });
      }
    }
  }
  alerts.sort((a, b) => a.date.localeCompare(b.date));
  return alerts.slice(0, limit);
}

/* ------------------------------------------------------------------ routes */

dashboardRouter.get('/alerts', (req, res) => {
  res.json({ alerts: collectAlerts(req.user, { days: Number(req.query.days) || 60 }) });
});

dashboardRouter.get('/executive', (req, res) => {
  const year = req.query.year || yearNow();
  const like = [`${year}-%`];
  const rates = safetyRates(req.user, year);
  const carbon = carbonTotals(req.user, year);
  const openCapa = countWhere(req.user, 'capa', "t.status NOT IN ('closed','overdue_closed')");
  const overdueCapa = countWhere(req.user, 'capa', "t.status NOT IN ('closed','overdue_closed') AND t.due_date IS NOT NULL AND t.due_date < ?", [todayIso()]);

  const complianceRows = groupCount(req.user, 'legal_register', 'compliance_status');
  const complianceTotal = complianceRows.reduce((a, r) => a + r.value, 0);
  const compliant = complianceRows.find((r) => r.label === 'Patuh')?.value || 0;

  res.json({
    year,
    cards: {
      incidents: countWhere(req.user, 'incident', 't.incident_date LIKE ?', like),
      fatality: rates.fatality,
      lti: rates.lti,
      nearMiss: countWhere(req.user, 'near_miss', 't.event_date LIKE ?', like),
      unsafeFindings: countWhere(req.user, 'unsafe_action', 't.observed_date LIKE ?', like) + countWhere(req.user, 'unsafe_condition', 't.observed_date LIKE ?', like),
      marineIncidents: countWhere(req.user, 'marine_incident', 't.incident_date LIKE ?', like),
      ltifr: rates.ltifr,
      trir: rates.trir,
      manhours: rates.manhours,
      openCapa,
      overdueCapa,
      highRisks: countWhere(req.user, 'risk_register', "t.risk_level IN ('Tinggi','Ekstrem')"),
      complianceRate: complianceTotal ? round((compliant / complianceTotal) * 100, 1) : null,
      carbonTon: carbon.total,
      internalAudits: countWhere(req.user, 'internal_audit', 't.actual_date LIKE ?', like),
      majorNc: sumOf(req.user, 'internal_audit', 'major_nc', 't.actual_date LIKE ?', like) + sumOf(req.user, 'external_audit', 'major_nc', 't.start_date LIKE ?', like),
      complaints: countWhere(req.user, 'customer_complaint', 't.complaint_date LIKE ?', like),
      trainings: countWhere(req.user, 'training_competency', 't.start_date LIKE ?', like),
      drills: countWhere(req.user, 'emergency_response', "t.record_type = 'Latihan (Drill)' AND t.event_date LIKE ?", like),
      trainingCompliance: avgOf(req.user, 'skill_gap', 'compliance_percent'),
      expiredCertificates: countWhere(req.user, 'employee_certification', 't.valid_until IS NOT NULL AND t.valid_until < ?', [todayIso()]),
    },
    incidentTrend: monthlySeries(req.user, 'incident', 'incident_date'),
    nearMissTrend: monthlySeries(req.user, 'near_miss', 'event_date'),
    incidentByClassification: groupCount(req.user, 'incident', 'classification', 't.incident_date LIKE ?', like),
    incidentByType: groupCount(req.user, 'incident', 'incident_type', 't.incident_date LIKE ?', like).slice(0, 8),
    capaByStatus: groupCount(req.user, 'capa', 'status'),
    riskHeatmap: riskHeatmap(req.user),
    carbon,
    alerts: collectAlerts(req.user, { days: 45, limit: 12 }),
  });
});

dashboardRouter.get('/incident', (req, res) => {
  const year = req.query.year || yearNow();
  const like = [`${year}-%`];
  res.json({
    year,
    rates: safetyRates(req.user, year),
    trend: monthlySeries(req.user, 'incident', 'incident_date'),
    lostDaysTrend: monthlySeries(req.user, 'incident', 'incident_date', { agg: 'SUM(t.lost_days)' }),
    byClassification: groupCount(req.user, 'incident', 'classification', 't.incident_date LIKE ?', like),
    byType: groupCount(req.user, 'incident', 'incident_type', 't.incident_date LIKE ?', like),
    byLocation: groupCount(req.user, 'incident', 'location_type', 't.incident_date LIKE ?', like),
    byVictim: groupCount(req.user, 'incident', 'victim_category', 't.incident_date LIKE ?', like),
    nearMissTrend: monthlySeries(req.user, 'near_miss', 'event_date'),
    unsafeActionByCategory: groupCount(req.user, 'unsafe_action', 'category'),
    unsafeConditionByCategory: groupCount(req.user, 'unsafe_condition', 'category'),
    observationTrend: monthlySeries(req.user, 'safety_observation', 'observation_date'),
    toolboxTrend: monthlySeries(req.user, 'toolbox_meeting', 'meeting_date'),
    reportingRatio: {
      incidents: countWhere(req.user, 'incident', 't.incident_date LIKE ?', like),
      nearMiss: countWhere(req.user, 'near_miss', 't.event_date LIKE ?', like),
      unsafe: countWhere(req.user, 'unsafe_action', 't.observed_date LIKE ?', like) + countWhere(req.user, 'unsafe_condition', 't.observed_date LIKE ?', like),
    },
  });
});

dashboardRouter.get('/risk', (req, res) => {
  const modules = ['risk_register', 'corporate_risk', 'operational_risk', 'port_risk', 'vessel_risk'];
  const byModule = modules.map((key) => ({
    key,
    name: moduleName(req.user, MODULE_BY_KEY.get(key)),
    total: countWhere(req.user, key),
    high: countWhere(req.user, key, "t.risk_level IN ('Tinggi','Ekstrem')"),
  }));
  const b = base(req.user, 'risk_register');
  const top = b
    ? all(
      `SELECT t.id, t.code, t.title, t.risk_category, t.risk_level, t.risk_score, t.res_risk_level, t.status
         FROM "${b.mod.table}" t WHERE ${b.where} AND t.risk_score IS NOT NULL
         ORDER BY t.risk_score DESC LIMIT 10`,
      b.params,
    )
    : [];
  res.json({
    heatmap: riskHeatmap(req.user),
    hiraHeatmap: riskHeatmap(req.user, ['hira']),
    byModule,
    byCategory: groupCount(req.user, 'risk_register', 'risk_category'),
    byLevel: groupCount(req.user, 'risk_register', 'risk_level'),
    residualByLevel: groupCount(req.user, 'risk_register', 'res_risk_level'),
    treatmentByStatus: groupCount(req.user, 'risk_treatment', 'status'),
    treatmentProgress: sumOf(req.user, 'risk_treatment', 'progress'),
    topRisks: top,
    hiraByHazard: groupCount(req.user, 'hira', 'hazard_type').slice(0, 10),
    appetiteBreaches: countWhere(req.user, 'risk_register', "t.risk_appetite = 'Melebihi Selera Risiko'"),
  });
});

dashboardRouter.get('/audit', (req, res) => {
  const year = req.query.year || yearNow();
  const like = [`${year}-%`];
  res.json({
    year,
    internal: {
      planned: countWhere(req.user, 'internal_audit', 't.plan_date LIKE ?', like),
      executed: countWhere(req.user, 'internal_audit', 't.actual_date LIKE ?', like),
      majorNc: sumOf(req.user, 'internal_audit', 'major_nc', 't.actual_date LIKE ?', like),
      minorNc: sumOf(req.user, 'internal_audit', 'minor_nc', 't.actual_date LIKE ?', like),
      observations: sumOf(req.user, 'internal_audit', 'observations', 't.actual_date LIKE ?', like),
    },
    external: {
      total: countWhere(req.user, 'external_audit', 't.start_date LIKE ?', like),
      majorNc: sumOf(req.user, 'external_audit', 'major_nc', 't.start_date LIKE ?', like),
      minorNc: sumOf(req.user, 'external_audit', 'minor_nc', 't.start_date LIKE ?', like),
      byType: groupCount(req.user, 'external_audit', 'audit_type', 't.start_date LIKE ?', like),
    },
    inspectionTrend: monthlySeries(req.user, 'inspection', 'inspection_date'),
    inspectionByType: groupCount(req.user, 'inspection', 'inspection_type'),
    ncByCategory: groupCount(req.user, 'non_conformity', 'category'),
    ncBySource: groupCount(req.user, 'non_conformity', 'source'),
    capaByStatus: groupCount(req.user, 'capa', 'status'),
    capaOverdue: countWhere(req.user, 'capa', "t.status NOT IN ('closed','overdue_closed') AND t.due_date < ?", [todayIso()]),
    capaAvgProgress: round(sumOf(req.user, 'capa', 'progress') / Math.max(1, countWhere(req.user, 'capa')), 1),
    complianceByStatus: groupCount(req.user, 'legal_register', 'compliance_status'),
    managementReviews: countWhere(req.user, 'management_review', 't.meeting_date LIKE ?', like),
  });
});

dashboardRouter.get('/carbon', (req, res) => {
  const year = req.query.year || yearNow();
  const carbon = carbonTotals(req.user, year);
  res.json({
    year,
    ...carbon,
    trend: monthlySeries(req.user, 'fuel_consumption', 'period', { agg: 'SUM(t.co2e_kg)/1000.0' }),
    fuelTrend: monthlySeries(req.user, 'fuel_consumption', 'period', { agg: 'SUM(t.quantity)', extraSql: "t.energy_type LIKE 'Solar%'" }),
    electricityTrend: monthlySeries(req.user, 'fuel_consumption', 'period', { agg: 'SUM(t.quantity)', extraSql: "t.energy_type = 'Listrik PLN'" }),
    byConsumer: groupCount(req.user, 'fuel_consumption', 'consumer_type'),
    factors: Object.entries(EMISSION_FACTORS).map(([k, v]) => ({ type: k, ...v })),
    energyPrograms: {
      total: countWhere(req.user, 'energy_review'),
      saving: sumOf(req.user, 'energy_review', 'energy_saving_value'),
      co2Avoided: sumOf(req.user, 'energy_review', 'co2_avoided_ton'),
    },
  });
});

dashboardRouter.get('/esg', (req, res) => {
  const year = req.query.year || yearNow();
  const b = base(req.user, 'esg');
  const indicators = b
    ? all(
      `SELECT t.id, t.code, t.title, t.pillar, t.gri_code, t.unit, t.target, t.actual, t.achievement, t.previous_year
         FROM "${b.mod.table}" t WHERE ${b.where} AND t.period LIKE ? ORDER BY t.pillar, t.title`,
      [...b.params, `${year}%`],
    )
    : [];
  const byPillar = ['Environmental', 'Social', 'Governance'].map((p) => {
    const rows = indicators.filter((i) => i.pillar === p && i.achievement !== null);
    return {
      label: trFor(req.user, p),
      value: rows.length ? round(rows.reduce((a, r) => a + r.achievement, 0) / rows.length, 1) : 0,
      count: indicators.filter((i) => i.pillar === p).length,
    };
  });
  res.json({
    year,
    byPillar,
    indicators,
    carbon: carbonTotals(req.user, year),
    waste: {
      nonB3: sumOf(req.user, 'waste_management', 'quantity', 't.period LIKE ?', [`${year}-%`]),
      recycled: sumOf(req.user, 'waste_management', 'recycled_qty', 't.period LIKE ?', [`${year}-%`]),
      b3: sumOf(req.user, 'hazardous_waste', 'quantity', 't.period LIKE ?', [`${year}-%`]),
    },
    social: {
      trainingHours: sumOf(req.user, 'training_competency', 'duration_hours', 't.start_date LIKE ?', [`${year}-%`]),
      trainingParticipants: sumOf(req.user, 'training_competency', 'actual_participants', 't.start_date LIKE ?', [`${year}-%`]),
      mcu: countWhere(req.user, 'mcu', 't.exam_date LIKE ?', [`${year}-%`]),
      healthCampaigns: countWhere(req.user, 'health_campaign', 't.start_date LIKE ?', [`${year}-%`]),
      complaints: countWhere(req.user, 'customer_complaint', 't.complaint_date LIKE ?', [`${year}-%`]),
    },
    governance: {
      compliance: groupCount(req.user, 'legal_register', 'compliance_status'),
      securityEvents: countWhere(req.user, 'information_security', 't.event_date LIKE ?', [`${year}-%`]),
      contractorEvaluated: countWhere(req.user, 'contractor_evaluation'),
    },
    environmentCompliance: {
      emission: groupCount(req.user, 'air_emission', 'compliance'),
      water: groupCount(req.user, 'water_quality', 'compliance'),
      monitoring: groupCount(req.user, 'environmental_monitoring', 'compliance'),
    },
    spills: {
      count: countWhere(req.user, 'spill_management', 't.spill_date LIKE ?', [`${year}-%`]),
      volume: sumOf(req.user, 'spill_management', 'volume_liter', 't.spill_date LIKE ?', [`${year}-%`]),
      recovered: sumOf(req.user, 'spill_management', 'recovered_liter', 't.spill_date LIKE ?', [`${year}-%`]),
    },
  });
});

dashboardRouter.get('/vessel', (req, res) => {
  const year = req.query.year || yearNow();
  const like = [`${year}-%`];
  const b = base(req.user, 'vessel');
  const fleet = b
    ? all(
      `SELECT t.id, t.code, t.name, t.vessel_type, t.operational_status, t.route, t.gt,
              t.smc_expiry, t.issc_expiry, t.sertifikat_keselamatan_expiry, t.class_survey_due, t.docking_next
         FROM "${b.mod.table}" t WHERE ${b.where} ORDER BY t.name`,
      b.params,
    )
    : [];
  res.json({
    year,
    fleet,
    fleetStatus: groupCount(req.user, 'vessel', 'operational_status'),
    checklist: {
      total: countWhere(req.user, 'ferry_safety_checklist', 't.voyage_date LIKE ?', like),
      delayed: countWhere(req.user, 'ferry_safety_checklist', "t.departure_decision IN ('Ditunda','Dibatalkan') AND t.voyage_date LIKE ?", like),
      byDecision: groupCount(req.user, 'ferry_safety_checklist', 'departure_decision', 't.voyage_date LIKE ?', like),
      trend: monthlySeries(req.user, 'ferry_safety_checklist', 'voyage_date'),
    },
    inspections: {
      total: countWhere(req.user, 'vessel_safety_inspection', 't.inspection_date LIKE ?', like),
      notSeaworthy: countWhere(req.user, 'vessel_safety_inspection', "t.seaworthy = 'Tidak Laik Laut'"),
      bySeaworthy: groupCount(req.user, 'vessel_safety_inspection', 'seaworthy'),
      rampDoor: groupCount(req.user, 'ramp_door_inspection', 'result'),
      lsa: groupCount(req.user, 'lsa_inspection', 'result'),
      ffa: groupCount(req.user, 'ffa_inspection', 'result'),
    },
    marineIncidents: {
      total: countWhere(req.user, 'marine_incident', 't.incident_date LIKE ?', like),
      byType: groupCount(req.user, 'marine_incident', 'incident_type', 't.incident_date LIKE ?', like),
      bySeverity: groupCount(req.user, 'marine_incident', 'severity', 't.incident_date LIKE ?', like),
      trend: monthlySeries(req.user, 'marine_incident', 'incident_date'),
    },
    stability: {
      records: countWhere(req.user, 'stability_monitoring', 't.voyage_date LIKE ?', like),
      nonCompliant: countWhere(req.user, 'stability_monitoring', 't.gm_compliant = 0'),
    },
    loading: {
      records: countWhere(req.user, 'vehicle_loading_safety', 't.loading_date LIKE ?', like),
      overDimension: sumOf(req.user, 'vehicle_loading_safety', 'overdimension_count', 't.loading_date LIKE ?', like),
      dgShipments: countWhere(req.user, 'dangerous_goods', 't.shipment_date LIKE ?', like),
    },
    passenger: {
      records: countWhere(req.user, 'passenger_safety', 't.voyage_date LIKE ?', like),
      overCapacity: countWhere(req.user, 'passenger_safety', 't.overcapacity = 1'),
    },
    clearance: {
      issued: countWhere(req.user, 'sailing_clearance', "t.clearance_status = 'Diterbitkan' AND t.clearance_date LIKE ?", like),
      held: countWhere(req.user, 'sailing_clearance', "t.clearance_status IN ('Ditahan (Detained)','Ditunda','Dibatalkan') AND t.clearance_date LIKE ?", like),
    },
    certificateAlerts: collectAlerts(req.user, { days: 90, limit: 40 }).filter((a) => ['certification', 'vessel', 'lsa_inspection'].includes(a.module)),
  });
});

dashboardRouter.get('/port', (req, res) => {
  const year = req.query.year || yearNow();
  const like = [`${year}-%`];
  const b = base(req.user, 'port');
  const ports = b ? all(`SELECT t.id, t.code, t.name, t.port_class, t.province, t.berth_count FROM "${b.mod.table}" t WHERE ${b.where} ORDER BY t.name`, b.params) : [];
  res.json({
    year,
    ports,
    patrol: {
      total: countWhere(req.user, 'port_safety_patrol', 't.patrol_date LIKE ?', like),
      findings: sumOf(req.user, 'port_safety_patrol', 'findings_count', 't.patrol_date LIKE ?', like),
      trend: monthlySeries(req.user, 'port_safety_patrol', 'patrol_date'),
      avgConformity: round(sumOf(req.user, 'port_safety_patrol', 'conformity_rate') / Math.max(1, countWhere(req.user, 'port_safety_patrol')), 1),
    },
    facility: {
      inspections: countWhere(req.user, 'port_inspection', 't.inspection_date LIKE ?', like),
      criticalFindings: sumOf(req.user, 'port_inspection', 'critical_findings', 't.inspection_date LIKE ?', like),
      avgConformity: round(sumOf(req.user, 'port_inspection', 'conformity_rate') / Math.max(1, countWhere(req.user, 'port_inspection')), 1),
    },
    crowd: {
      records: countWhere(req.user, 'crowd_management', 't.record_date LIKE ?', like),
      byCongestion: groupCount(req.user, 'crowd_management', 'congestion_level', 't.record_date LIKE ?', like),
      passengerTrend: monthlySeries(req.user, 'crowd_management', 'record_date', { agg: 'SUM(t.passenger_count)' }),
      vehicleTrend: monthlySeries(req.user, 'crowd_management', 'record_date', { agg: 'SUM(t.vehicle_count)' }),
    },
    security: {
      events: countWhere(req.user, 'port_security', 't.event_date LIKE ?', like),
      byCategory: groupCount(req.user, 'port_security', 'incident_category', 't.event_date LIKE ?', like),
      byLevel: groupCount(req.user, 'port_security', 'security_level'),
    },
    environment: {
      wasteTrend: monthlySeries(req.user, 'waste_management', 'period', { agg: 'SUM(t.quantity)' }),
      b3Trend: monthlySeries(req.user, 'hazardous_waste', 'period', { agg: 'SUM(t.quantity)' }),
      emissionCompliance: groupCount(req.user, 'air_emission', 'compliance'),
      waterCompliance: groupCount(req.user, 'water_quality', 'compliance'),
      housekeepingFindings: sumOf(req.user, 'port_environment_monitoring', 'findings_count', 't.record_date LIKE ?', like),
    },
    emergency: {
      drills: countWhere(req.user, 'emergency_response', "t.record_type = 'Latihan (Drill)' AND t.event_date LIKE ?", like),
      realEvents: countWhere(req.user, 'emergency_response', "t.record_type = 'Kejadian Darurat Nyata' AND t.event_date LIKE ?", like),
      byScenario: groupCount(req.user, 'emergency_response', 'scenario', 't.event_date LIKE ?', like),
    },
  });
});

dashboardRouter.get('/quality', (req, res) => {
  const year = req.query.year || yearNow();
  const like = [`${year}-%`];
  const b = base(req.user, 'quality_objective');
  const kpis = b
    ? all(
      `SELECT t.id, t.code, t.title, t.perspective, t.period, t.unit, t.target, t.actual, t.achievement, t.achievement_status
         FROM "${b.mod.table}" t WHERE ${b.where} AND t.period LIKE ? ORDER BY t.perspective, t.title`,
      [...b.params, `${year}%`],
    )
    : [];
  res.json({
    year,
    kpis,
    kpiByStatus: groupCount(req.user, 'quality_objective', 'achievement_status', 't.period LIKE ?', [`${year}%`]),
    complaintTrend: monthlySeries(req.user, 'customer_complaint', 'complaint_date'),
    complaintByCategory: groupCount(req.user, 'customer_complaint', 'category', 't.complaint_date LIKE ?', like),
    complaintByChannel: groupCount(req.user, 'customer_complaint', 'channel', 't.complaint_date LIKE ?', like),
    satisfaction: groupCount(req.user, 'customer_complaint', 'customer_satisfaction'),
    ncTrend: monthlySeries(req.user, 'non_conformity', 'found_date'),
    improvement: {
      total: countWhere(req.user, 'continuous_improvement'),
      saving: sumOf(req.user, 'continuous_improvement', 'realized_saving'),
      byMethod: groupCount(req.user, 'continuous_improvement', 'method'),
    },
    documents: {
      total: countWhere(req.user, 'document_control'),
      published: countWhere(req.user, 'document_control', "t.status = 'published'"),
      obsolete: countWhere(req.user, 'document_control', "t.status = 'obsolete'"),
      dueReview: countWhere(req.user, 'document_control', 't.review_due IS NOT NULL AND t.review_due <= ?', [todayIso()]),
    },
  });
});

dashboardRouter.get('/health', (req, res) => {
  const year = req.query.year || yearNow();
  const like = [`${year}-%`];
  res.json({
    year,
    mcu: {
      total: countWhere(req.user, 'mcu', 't.exam_date LIKE ?', like),
      byResult: groupCount(req.user, 'mcu', 'result', 't.exam_date LIKE ?', like),
      followUp: countWhere(req.user, 'mcu', 't.follow_up_required = 1'),
      trend: monthlySeries(req.user, 'mcu', 'exam_date'),
    },
    fatigue: {
      records: countWhere(req.user, 'fatigue_management', 't.assessment_date LIKE ?', like),
      highRisk: countWhere(req.user, 'fatigue_management', "t.risk_flag = 'Berisiko Tinggi'"),
      nonCompliantRest: countWhere(req.user, 'fatigue_management', 't.rest_compliance = 0'),
      byRisk: groupCount(req.user, 'fatigue_management', 'risk_flag'),
    },
    occupationalDisease: {
      total: countWhere(req.user, 'occupational_disease'),
      byCategory: groupCount(req.user, 'occupational_disease', 'disease_category'),
    },
    clinic: {
      visits: countWhere(req.user, 'clinic', 't.visit_date LIKE ?', like),
      workRelated: countWhere(req.user, 'clinic', 't.work_related = 1'),
      byPatientType: groupCount(req.user, 'clinic', 'patient_type', 't.visit_date LIKE ?', like),
      trend: monthlySeries(req.user, 'clinic', 'visit_date'),
    },
    vaccination: groupCount(req.user, 'vaccination', 'vaccine_type'),
    campaigns: countWhere(req.user, 'health_campaign', 't.start_date LIKE ?', like),
  });
});

dashboardRouter.get('/contractor', (req, res) => {
  const year = req.query.year || yearNow();
  const b = base(req.user, 'contractor');
  const list = b
    ? all(
      `SELECT t.id, t.code, t.name, t.work_type, t.risk_category, t.csms_score, t.csms_grade, t.blacklist_status, t.contract_end
         FROM "${b.mod.table}" t WHERE ${b.where} ORDER BY t.csms_score DESC`,
      b.params,
    )
    : [];
  res.json({
    year,
    contractors: list,
    byGrade: groupCount(req.user, 'contractor', 'csms_grade'),
    byStatus: groupCount(req.user, 'contractor', 'blacklist_status'),
    prequalification: groupCount(req.user, 'contractor_prequalification', 'result'),
    evaluation: groupCount(req.user, 'contractor_evaluation', 'recommendation'),
    performance: {
      manhours: sumOf(req.user, 'contractor_safety_performance', 'manhours', 't.period LIKE ?', [`${year}-%`]),
      lti: sumOf(req.user, 'contractor_safety_performance', 'lti', 't.period LIKE ?', [`${year}-%`]),
      fatality: sumOf(req.user, 'contractor_safety_performance', 'fatality', 't.period LIKE ?', [`${year}-%`]),
      byRating: groupCount(req.user, 'contractor_safety_performance', 'performance_rating'),
      trend: monthlySeries(req.user, 'contractor_safety_performance', 'period', { agg: 'SUM(t.lti)' }),
    },
    permits: {
      active: countWhere(req.user, 'contractor_permit', "t.status IN ('approved','active')"),
      total: countWhere(req.user, 'contractor_permit'),
    },
  });
});

/* ------------------------------------------------- langganan (model SaaS) */

/**
 * Dashboard komersial: hanya untuk pengelola platform. Cabang tenant melihat
 * ringkasan langganannya sendiri melalui /api/meta dan modul tagihan.
 */
dashboardRouter.get('/subscription', (req, res) => {
  const ctx = tenantContext(req.user);
  if (!ctx.platform) return res.status(403).json({ error: 'Dashboard komersial hanya untuk pengelola platform.' });

  const subs = tenantOverview();
  const active = subs.filter((s) => ['active', 'past_due'].includes(s.status));
  const trial = subs.filter((s) => s.status === 'trial');
  const churned = subs.filter((s) => s.status === 'ended');
  const mrr = active.reduce((a, s) => a + (s.effective_fee || 0), 0);
  const trialPipeline = trial.reduce((a, s) => a + (s.effective_fee || 0), 0);

  const inv = base(req.user, 'invoice');
  const invoiceRows = inv ? all(`SELECT t.* FROM "${inv.mod.table}" t WHERE ${inv.where}`, inv.params) : [];
  const paid = invoiceRows.filter((i) => i.status === 'paid');
  const outstanding = invoiceRows.filter((i) => ['issued', 'overdue'].includes(i.status));
  const collected = paid.reduce((a, i) => a + (i.total || 0), 0);

  const aging = [
    { label: trFor(req.user, 'Belum jatuh tempo'), value: outstanding.filter((i) => (i.days_overdue || 0) === 0).reduce((a, i) => a + i.total, 0) },
    { label: trFor(req.user, '1–30 hari'), value: outstanding.filter((i) => i.days_overdue > 0 && i.days_overdue <= 30).reduce((a, i) => a + i.total, 0) },
    { label: trFor(req.user, '31–60 hari'), value: outstanding.filter((i) => i.days_overdue > 30 && i.days_overdue <= 60).reduce((a, i) => a + i.total, 0) },
    { label: trFor(req.user, '> 60 hari'), value: outstanding.filter((i) => i.days_overdue > 60).reduce((a, i) => a + i.total, 0) },
  ];

  const revenueByMonth = monthsBack(12).map((m) => ({
    label: m,
    value: round(paid.filter((i) => i.period === m).reduce((a, i) => a + i.total, 0), 0),
  }));

  const byPlan = new Map();
  for (const s of active) {
    const entry = byPlan.get(s.plan_name) || { label: s.plan_name || trFor(req.user, 'Tanpa paket'), value: 0, mrr: 0 };
    entry.value += 1;
    entry.mrr += s.effective_fee || 0;
    byPlan.set(s.plan_name, entry);
  }

  const usage = base(req.user, 'subscription_usage');
  const adoption = usage
    ? all(
      `SELECT t.branch_id, t.period, t.active_users, t.adoption_score, t.adoption_status, b.name AS branch_name
         FROM "${usage.mod.table}" t LEFT JOIN m_branch b ON b.id = t.branch_id
        WHERE ${usage.where} ORDER BY t.period DESC LIMIT 60`,
      usage.params,
    )
    : [];

  const leads = base(req.user, 'trial_request');
  const leadRows = leads ? all(`SELECT t.* FROM "${leads.mod.table}" t WHERE ${leads.where} ORDER BY t.id DESC`, leads.params) : [];

  const totalTenants = active.length + trial.length;
  res.json({
    year: yearNow(),
    cards: {
      mrr: round(mrr, 0),
      arr: round(mrr * 12, 0),
      activeTenants: active.length,
      trialTenants: trial.length,
      churnedTenants: churned.length,
      churnRate: subs.length ? round((churned.length / subs.length) * 100, 1) : 0,
      arpa: totalTenants ? round(mrr / Math.max(1, active.length), 0) : 0,
      trialPipeline: round(trialPipeline, 0),
      collected: round(collected, 0),
      outstanding: round(outstanding.reduce((a, i) => a + i.total, 0), 0),
      overdueCount: outstanding.filter((i) => i.days_overdue > 0).length,
      newLeads: leadRows.filter((l) => l.status === 'new').length,
    },
    revenueByMonth,
    byPlan: [...byPlan.values()],
    byStatus: ['trial', 'active', 'past_due', 'suspended', 'ended'].map((s) => ({
      label: trFor(req.user, { trial: 'Uji Coba', active: 'Aktif', past_due: 'Menunggak', suspended: 'Ditangguhkan', ended: 'Berhenti' }[s]),
      value: subs.filter((x) => x.status === s).length,
    })).filter((x) => x.value > 0),
    aging,
    tenants: subs.map((s) => ({
      id: s.id,
      code: s.code,
      branch: s.branch_name,
      plan: s.plan_name,
      status: s.status,
      fee: s.effective_fee,
      seats: s.user_seats,
      activeUsers: s.active_users,
      utilisation: s.seat_utilization,
      nextBilling: s.next_billing_date,
      health: s.health_status,
      nps: s.nps_score,
    })),
    adoption,
    leads: leadRows.slice(0, 20),
    leadFunnel: ['new', 'contacted', 'demo', 'trial', 'converted', 'lost'].map((s) => ({
      label: trFor(req.user, { new: 'Permintaan Baru', contacted: 'Dihubungi', demo: 'Demo', trial: 'Uji Coba', converted: 'Berlangganan', lost: 'Tidak Lanjut' }[s]),
      value: leadRows.filter((l) => l.status === s).length,
    })),
  });
});

/* ------------------------------------------------ balanced scorecard (BSC) */

/**
 * Empat perspektif Kaplan & Norton dalam urutan sebab-akibat: pembelajaran
 * menopang proses, proses melayani pelanggan, pelanggan menghasilkan kinerja
 * keuangan. Urutan ini yang dipakai peta strategi, dari bawah ke atas.
 */
const BSC_LAYERS = [
  { key: '1 - Pembelajaran & Pertumbuhan', short: 'Pembelajaran & Pertumbuhan', en: 'Learning & Growth' },
  { key: '2 - Proses Bisnis Internal', short: 'Proses Bisnis Internal', en: 'Internal Business Process' },
  { key: '3 - Pelanggan', short: 'Pelanggan', en: 'Customer' },
  { key: '4 - Keuangan', short: 'Keuangan', en: 'Financial' },
];

/**
 * Skor perspektif = rata-rata pencapaian tertimbang, dipotong 120% per
 * indikator. Bila tidak satu pun indikator diberi bobot, seluruhnya dianggap
 * berbobot sama - lebih jujur daripada diam-diam menganggap skornya nol.
 */
function scorePerspective(rows) {
  const scored = rows.filter((r) => r.achievement !== null && r.achievement !== undefined);
  if (!scored.length) return null;
  const totalWeight = scored.reduce((a, r) => a + (Number(r.weight) || 0), 0);
  if (totalWeight > 0) {
    const sum = scored.reduce((a, r) => a + Math.min(r.achievement, 120) * (Number(r.weight) || 0), 0);
    return round(sum / totalWeight, 2);
  }
  return round(scored.reduce((a, r) => a + Math.min(r.achievement, 120), 0) / scored.length, 2);
}

const scoreGrade = (s) => {
  if (s === null) return null;
  if (s >= 100) return 'Sangat Baik';
  if (s >= 90) return 'Baik';
  if (s >= 75) return 'Cukup';
  return 'Perlu Perbaikan';
};

dashboardRouter.get('/bsc', (req, res) => {
  const year = req.query.year || yearNow();
  const b = base(req.user, 'quality_objective');
  const rows = b
    ? all(
      `SELECT t.id, t.code, t.title, t.perspective, t.bsc_perspective, t.strategic_objective,
              t.weight, t.weighted_score, t.period, t.unit, t.target, t.actual, t.achievement,
              t.achievement_status, t.polarity, t.owner_unit, t.analysis, t.improvement_plan
         FROM "${b.mod.table}" t WHERE ${b.where} AND t.period LIKE ?
        ORDER BY t.bsc_perspective, t.title`,
      [...b.params, `${year}%`],
    )
    : [];

  const previous = b
    ? all(
      `SELECT t.bsc_perspective, t.title, t.achievement, t.weight FROM "${b.mod.table}" t
        WHERE ${b.where} AND t.period LIKE ?`,
      [...b.params, `${Number(year) - 1}%`],
    )
    : [];

  const perspectives = BSC_LAYERS.map((layer) => {
    const kpis = rows.filter((r) => r.bsc_perspective === layer.key);
    const score = scorePerspective(kpis);
    const prior = scorePerspective(previous.filter((r) => r.bsc_perspective === layer.key));
    return {
      ...layer,
      score,
      grade: scoreGrade(score),
      previousScore: prior,
      delta: score !== null && prior !== null ? round(score - prior, 2) : null,
      kpiCount: kpis.length,
      achieved: kpis.filter((r) => (r.achievement ?? 0) >= 100).length,
      atRisk: kpis.filter((r) => r.achievement !== null && r.achievement < 90).length,
      weightTotal: kpis.reduce((a, r) => a + (Number(r.weight) || 0), 0),
      kpis,
    };
  });

  // Skor korporat memberi bobot sama pada keempat perspektif: itulah inti
  // "berimbang" pada Balanced Scorecard - keuangan tidak boleh menutupi
  // perspektif pembelajaran yang tertinggal, dan sebaliknya.
  const scored = perspectives.filter((p) => p.score !== null);
  const overall = scored.length ? round(scored.reduce((a, p) => a + p.score, 0) / scored.length, 2) : null;
  const overallPrev = (() => {
    const prior = perspectives.filter((p) => p.previousScore !== null);
    return prior.length ? round(prior.reduce((a, p) => a + p.previousScore, 0) / prior.length, 2) : null;
  })();

  // Sasaran strategis: satu sasaran dapat diukur beberapa indikator sekaligus.
  const byObjective = new Map();
  for (const r of rows) {
    if (!r.strategic_objective) continue;
    const entry = byObjective.get(r.strategic_objective)
      || { objective: r.strategic_objective, perspective: r.bsc_perspective, kpis: [] };
    entry.kpis.push(r);
    byObjective.set(r.strategic_objective, entry);
  }
  const objectives = [...byObjective.values()].map((o) => ({
    objective: o.objective,
    perspective: o.perspective,
    kpiCount: o.kpis.length,
    score: scorePerspective(o.kpis),
    achieved: o.kpis.filter((r) => (r.achievement ?? 0) >= 100).length,
    // Sasaran tanpa skor diletakkan di belakang: belum terukur bukan berarti
    // paling buruk, dan daftar ini diurutkan dari yang paling tertinggal.
  })).sort((a, x) => (a.score ?? Infinity) - (x.score ?? Infinity));

  res.json({
    year,
    overall,
    overallGrade: scoreGrade(overall),
    overallPrevious: overallPrev,
    overallDelta: overall !== null && overallPrev !== null ? round(overall - overallPrev, 2) : null,
    perspectives,
    objectives,
    byStatus: groupCount(req.user, 'quality_objective', 'achievement_status', 't.period LIKE ?', [`${year}%`]),
    laggingKpis: rows.filter((r) => r.achievement !== null).sort((a, x) => a.achievement - x.achievement).slice(0, 10),
    // Inisiatif yang menutup kesenjangan sasaran - bagian "initiative" pada BSC.
    initiatives: {
      improvement: countWhere(req.user, 'continuous_improvement'),
      improvementSaving: sumOf(req.user, 'continuous_improvement', 'realized_saving'),
      capaOpen: countWhere(req.user, 'capa', "t.status NOT IN ('closed','overdue_closed')"),
      riskTreatment: countWhere(req.user, 'risk_treatment'),
      trainingPlanned: countWhere(req.user, 'training_schedule', 't.start_date LIKE ?', [`${year}-%`]),
      managementReviews: countWhere(req.user, 'management_review', 't.meeting_date LIKE ?', [`${year}-%`]),
    },
  });
});

/* --------------------------------------------------------- analitik lintas */

/** Rata-rata hari dari rekaman dibuat sampai ditutup. */
function closureDays(user, key) {
  const b = base(user, key);
  if (!b) return null;
  const row = get(
    `SELECT AVG(julianday(t.closed_at) - julianday(t.created_at)) AS d, COUNT(*) AS n
       FROM "${b.mod.table}" t WHERE ${b.where} AND t.closed_at IS NOT NULL AND t.created_at IS NOT NULL`,
    b.params,
  );
  return row?.n ? { days: round(row.d, 1), closed: row.n } : { days: null, closed: 0 };
}

/**
 * Korelasi Pearson antara dua deret bulanan.
 * Dipakai untuk pertanyaan yang sering diperdebatkan tanpa angka: apakah
 * pelaporan proaktif yang naik benar-benar diikuti insiden yang turun.
 * Korelasi bukan sebab-akibat, dan itu dinyatakan di antarmuka.
 */
function correlation(a, b) {
  const xs = a.map((d) => Number(d.value) || 0);
  const ys = b.map((d) => Number(d.value) || 0);
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return round(num / Math.sqrt(dx * dy), 3);
}

/** Pareto: peringkat menurun beserta persen kumulatifnya. */
function pareto(rows, limit = 10) {
  const data = (rows || []).filter((r) => r.label !== null);
  const total = data.reduce((a, r) => a + r.value, 0);
  if (!total) return { total: 0, rows: [] };
  let running = 0;
  return {
    total,
    rows: data.slice(0, limit).map((r) => {
      running += r.value;
      return {
        label: r.label,
        value: r.value,
        percent: round((r.value / total) * 100, 1),
        cumulative: round((running / total) * 100, 1),
      };
    }),
  };
}

/** Satu metrik dihitung untuk setiap unit organisasi yang terlihat pengguna. */
function perOrg(user, orgKey, orgTable, metrics) {
  const b = base(user, orgKey === 'branch_id' ? 'branch' : 'port');
  if (!b) return [];
  const units = all(`SELECT t.id, t.name FROM "${b.mod.table}" t WHERE ${b.where} ORDER BY t.name`, b.params);
  return units.map((u) => {
    const out = { id: u.id, name: u.name };
    for (const [name, fn] of Object.entries(metrics)) out[name] = fn(u.id, orgKey);
    return out;
  });
}

dashboardRouter.get('/analytics', (req, res) => {
  const year = req.query.year || yearNow();
  const last = String(Number(year) - 1);
  const thisYear = [`${year}-%`];
  const lastYear = [`${last}-%`];
  const today = todayIso();

  const cnt = (key, dateCol, orgCol, orgId, extra = '') => countWhere(
    req.user, key,
    `t."${orgCol}" = ?${dateCol ? ` AND t."${dateCol}" LIKE ?` : ''}${extra ? ` AND ${extra}` : ''}`,
    dateCol ? [orgId, `${year}-%`] : [orgId],
  );

  const branchMetrics = {
    incidents: (id, col) => cnt('incident', 'incident_date', col, id),
    nearMiss: (id, col) => cnt('near_miss', 'event_date', col, id),
    unsafe: (id, col) => cnt('unsafe_action', 'observed_date', col, id) + cnt('unsafe_condition', 'observed_date', col, id),
    findings: (id, col) => cnt('non_conformity', 'found_date', col, id),
    capaOverdue: (id, col) => countWhere(req.user, 'capa', `t."${col}" = ? AND t.status NOT IN ('closed','overdue_closed') AND t.due_date < ?`, [id, today]),
    complaints: (id, col) => cnt('customer_complaint', 'complaint_date', col, id),
    trainingCompliance: (id, col) => {
      const b = base(req.user, 'skill_gap');
      if (!b) return null;
      const row = get(
        `SELECT AVG(t.compliance_percent) AS a FROM "${b.mod.table}" t
          WHERE ${b.where} AND t."${col}" = ? AND t.compliance_percent IS NOT NULL`,
        [...b.params, id],
      );
      return row?.a === null || row?.a === undefined ? null : round(row.a, 1);
    },
    expiredCerts: (id, col) => countWhere(req.user, 'employee_certification', `t."${col}" = ? AND t.valid_until IS NOT NULL AND t.valid_until < ?`, [id, today]),
  };

  const branches = perOrg(req.user, 'branch_id', 'm_branch', branchMetrics);
  const ports = perOrg(req.user, 'port_id', 'm_port', branchMetrics);

  /**
   * Indeks gabungan, 0-100. Bukan nilai mutlak melainkan pembanding antar unit:
   * pelaporan proaktif menaikkan, kejadian dan tunggakan menurunkan. Rasio
   * pelaporan sengaja dihitung positif - unit yang melaporkan banyak near miss
   * sedang bekerja dengan benar, bukan sedang berkinerja buruk.
   */
  const withIndex = (list) => list.map((u) => {
    const proactive = u.nearMiss + u.unsafe;
    const reporting = u.incidents ? Math.min(proactive / Math.max(u.incidents, 1), 20) : Math.min(proactive, 20);
    const penalty = u.incidents * 4 + u.capaOverdue * 3 + u.expiredCerts * 2 + u.findings;
    const training = u.trainingCompliance ?? 70;
    const raw = 60 + reporting * 1.5 + (training - 70) * 0.4 - penalty;
    return { ...u, proactive, index: round(Math.max(0, Math.min(100, raw)), 1) };
  }).sort((a, b) => b.index - a.index);

  const incidentTrend = monthlySeries(req.user, 'incident', 'incident_date');
  // Kedua deret dihitung sekali lalu dijumlahkan per bulan. Memanggil
  // monthlySeries() di dalam map() akan mengulang kueri penuh dua belas kali.
  const nearMissTrend = monthlySeries(req.user, 'near_miss', 'event_date');
  const observationTrend = monthlySeries(req.user, 'safety_observation', 'observation_date');
  const proactiveTrend = nearMissTrend.map((m, i) => ({
    label: m.label,
    value: m.value + (observationTrend[i]?.value || 0),
  }));

  const yoy = (label, key, dateCol, extra = '') => ({
    label: trFor(req.user, label),
    current: countWhere(req.user, key, `t."${dateCol}" LIKE ?${extra ? ` AND ${extra}` : ''}`, thisYear),
    previous: countWhere(req.user, key, `t."${dateCol}" LIKE ?${extra ? ` AND ${extra}` : ''}`, lastYear),
  });

  const yearOverYear = [
    yoy('Insiden', 'incident', 'incident_date'),
    yoy('Near miss', 'near_miss', 'event_date'),
    yoy('Tindakan tidak aman', 'unsafe_action', 'observed_date'),
    yoy('Ketidaksesuaian', 'non_conformity', 'found_date'),
    yoy('Keluhan pelanggan', 'customer_complaint', 'complaint_date'),
    yoy('Inspeksi', 'inspection', 'inspection_date'),
    yoy('Audit internal', 'internal_audit', 'actual_date'),
    yoy('Insiden pelayaran', 'marine_incident', 'incident_date'),
    yoy('Pelatihan terlaksana', 'training_competency', 'start_date'),
  ].map((r) => ({
    ...r,
    change: r.previous ? round(((r.current - r.previous) / r.previous) * 100, 1) : null,
  }));

  const closure = ['capa', 'non_conformity', 'incident', 'customer_complaint', 'near_miss', 'skill_gap']
    .map((key) => ({ key, name: moduleName(req.user, MODULE_BY_KEY.get(key)), ...closureDays(req.user, key) }))
    .filter((r) => r.closed > 0);

  /**
   * Satu sapuan lintas modul menghasilkan tiga angka sekaligus: jumlah rekaman,
   * rekaman 30 hari terakhir, dan rekaman yang tidak bergerak. Tiga sapuan
   * terpisah berarti tiga kali 116 kueri untuk data yang sama.
   *
   * "Tidak bergerak" = dibuat lebih dari 30 hari lalu, masih berstatus awal,
   * belum ditutup. Inilah yang membuat dashboard terlihat sehat padahal
   * pekerjaannya menumpuk di kotak masuk seseorang.
   */
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const volumeByModule = [];
  const stale = [];
  let totalRecords = 0;
  let recent30 = 0;

  for (const mod of MODULES) {
    if (mod.master || !can(req.user, mod.key, 'view') || !isEntitled(req.user, mod.key)) continue;
    const scope = scopeClause(req.user, mod);
    const where = `t.deleted_at IS NULL${scope.sql ? ` AND ${scope.sql}` : ''}`;
    const row = get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN t.created_at >= ? THEN 1 ELSE 0 END) AS baru,
              SUM(CASE WHEN t.closed_at IS NULL AND t.status = ? AND t.created_at < ? THEN 1 ELSE 0 END) AS mandek
         FROM "${mod.table}" t WHERE ${where}`,
      [since, mod.initialStatus, since, ...scope.params],
    );
    if (!row?.total) continue;
    totalRecords += row.total;
    recent30 += row.baru || 0;
    volumeByModule.push({
      label: moduleName(req.user, mod),
      value: row.total,
      module: mod.key,
      // Kode kelompok saja terbaca sebagai huruf lepas pada grafik sebaran;
      // namanya ikut supaya sumbu grafik dapat dibaca tanpa tabel rujukan.
      group: `${mod.groupCode}. ${langOf(req.user) === 'en' ? mod.groupNameEn || mod.groupName : mod.groupName}`,
    });
    if (row.mandek) stale.push({ module: mod.key, name: moduleName(req.user, mod), icon: mod.icon, count: row.mandek });
  }
  volumeByModule.sort((a, b) => b.value - a.value);
  stale.sort((a, b) => b.count - a.count);

  res.json({
    year,
    previousYear: last,
    cards: {
      totalRecords,
      recent30,
      activeModules: volumeByModule.length,
      staleRecords: stale.reduce((a, r) => a + r.count, 0),
      overdueOpen: countWhere(req.user, 'capa', "t.status NOT IN ('closed','overdue_closed') AND t.due_date < ?", [today])
        + countWhere(req.user, 'non_conformity', "t.closed_at IS NULL AND t.due_date < ?", [today]),
      proactiveRatio: (() => {
        const inc = countWhere(req.user, 'incident', 't.incident_date LIKE ?', thisYear);
        const pro = countWhere(req.user, 'near_miss', 't.event_date LIKE ?', thisYear)
          + countWhere(req.user, 'unsafe_action', 't.observed_date LIKE ?', thisYear)
          + countWhere(req.user, 'unsafe_condition', 't.observed_date LIKE ?', thisYear);
        return inc ? round(pro / inc, 1) : pro;
      })(),
      avgCapaClosure: closureDays(req.user, 'capa')?.days ?? null,
      branchesCompared: branches.length,
    },
    branches: withIndex(branches),
    ports: withIndex(ports),
    leadingLagging: {
      incidentTrend,
      proactiveTrend,
      correlation: correlation(proactiveTrend, incidentTrend),
    },
    yearOverYear,
    pareto: {
      incidentType: pareto(groupCount(req.user, 'incident', 'incident_type')),
      ncSource: pareto(groupCount(req.user, 'non_conformity', 'source')),
      complaintCategory: pareto(groupCount(req.user, 'customer_complaint', 'category')),
      hazard: pareto(groupCount(req.user, 'hira', 'hazard_type')),
    },
    closure,
    stale: stale.slice(0, 12),
    volumeByModule: volumeByModule.slice(0, 15),
    volumeByGroup: (() => {
      const map = new Map();
      for (const r of volumeByModule) map.set(r.group, (map.get(r.group) || 0) + r.value);
      return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    })(),
  });
});

/* ------------------------------------------------- kompetensi & pelatihan */

/**
 * Rata-rata sebuah kolom, dihitung hanya atas baris yang benar-benar terisi.
 * Membagi dengan COUNT(*) akan menyeret rata-rata ke bawah setiap kali ada
 * rekaman yang kolomnya kosong - itulah kekeliruan yang dihindari di sini.
 */
export function avgOf(user, key, column, extraSql = '', extraParams = []) {
  const b = base(user, key);
  if (!b) return null;
  const row = get(
    `SELECT AVG(t."${column}") AS a FROM "${b.mod.table}" t
      WHERE ${b.where} AND t."${column}" IS NOT NULL${extraSql ? ` AND ${extraSql}` : ''}`,
    [...b.params, ...extraParams],
  );
  return row?.a === null || row?.a === undefined ? null : round(row.a, 2);
}

/** Kepatuhan pelatihan wajib per unit organisasi, dari analisis kesenjangan. */
function complianceByOrg(user, column, joinTable) {
  const b = base(user, 'skill_gap');
  if (!b) return [];
  return all(
    `SELECT o.name AS label,
            ROUND(AVG(t.compliance_percent), 1) AS value,
            COUNT(*) AS employees,
            SUM(t.gap_count) AS gaps
       FROM "${b.mod.table}" t JOIN "${joinTable}" o ON o.id = t."${column}"
      WHERE ${b.where} AND t.compliance_percent IS NOT NULL
      GROUP BY o.name ORDER BY value ASC`,
    b.params,
  );
}

dashboardRouter.get('/training', (req, res) => {
  const year = req.query.year || yearNow();
  const like = [`${year}-%`];
  const today = todayIso();

  const catalogue = base(req.user, 'training_master');
  const mandatoryCatalogue = catalogue
    ? get(`SELECT COUNT(*) AS n FROM "${catalogue.mod.table}" t WHERE ${catalogue.where} AND t.mandatory LIKE 'Wajib%'`, catalogue.params)?.n || 0
    : 0;

  // Jam pelatihan per pegawai memakai jumlah pegawai yang terlihat oleh
  // pengguna, bukan jumlah nasional, agar konsisten dengan angka lain di layar.
  const employeeCount = countWhere(req.user, 'employee') || 0;
  const trainingHours = sumOf(req.user, 'training_competency', 'duration_hours', 't.start_date LIKE ?', like);
  const participants = sumOf(req.user, 'training_competency', 'actual_participants', 't.start_date LIKE ?', like);

  const gap = base(req.user, 'skill_gap');
  const gapRows = gap
    ? all(
      `SELECT t.id, t.code, t.employee_name, t.position, t.required_training_count, t.owned_training_count,
              t.gap_count, t.compliance_percent, t.gap_status, t.priority, t.target_date
         FROM "${gap.mod.table}" t WHERE ${gap.where} AND t.gap_count IS NOT NULL
         ORDER BY t.gap_count DESC, t.compliance_percent ASC LIMIT 15`,
      gap.params,
    )
    : [];

  const cert = base(req.user, 'employee_certification');
  const expiringCerts = cert
    ? all(
      `SELECT t.id, t.code, t.certificate_name, t.employee_name, t.certificate_type,
              t.issuer, t.valid_until, t.cert_status, t.days_to_expiry
         FROM "${cert.mod.table}" t
        WHERE ${cert.where} AND t.valid_until IS NOT NULL AND t.valid_until <= ?
        ORDER BY t.valid_until LIMIT 30`,
      [...cert.params, new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)],
    )
    : [];

  const vendor = base(req.user, 'training_vendor');
  const vendors = vendor
    ? all(
      `SELECT t.id, t.name, t.vendor_type, t.vendor_score, t.vendor_grade, t.training_count,
              t.participant_count, t.accreditation_expiry, t.vendor_status
         FROM "${vendor.mod.table}" t WHERE ${vendor.where} AND t.vendor_score IS NOT NULL
         ORDER BY t.vendor_score DESC LIMIT 10`,
      vendor.params,
    )
    : [];

  const examTotal = countWhere(req.user, 'training_exam', 't.exam_date LIKE ?', like);
  const examPassed = countWhere(req.user, 'training_exam', "t.exam_result = 'Lulus' AND t.exam_date LIKE ?", like);
  const attendanceTotal = countWhere(req.user, 'training_attendance', 't.session_date LIKE ?', like);
  const attendancePresent = countWhere(req.user, 'training_attendance', "t.attendance_status IN ('Hadir','Terlambat') AND t.session_date LIKE ?", like);

  const plannedSchedules = countWhere(req.user, 'training_schedule', 't.start_date LIKE ?', like);
  const completedSchedules = countWhere(req.user, 'training_schedule', "t.status = 'completed' AND t.start_date LIKE ?", like);

  res.json({
    year,
    cards: {
      catalogue: countWhere(req.user, 'training_master'),
      mandatoryCatalogue,
      trainingsThisYear: countWhere(req.user, 'training_competency', 't.start_date LIKE ?', like),
      participants,
      trainingHours,
      hoursPerEmployee: employeeCount ? round(trainingHours / employeeCount, 2) : null,
      mandatoryCompliance: avgOf(req.user, 'skill_gap', 'compliance_percent'),
      gapEmployees: countWhere(req.user, 'skill_gap', 't.gap_count > 0'),
      totalGaps: sumOf(req.user, 'skill_gap', 'gap_count'),
      certificates: countWhere(req.user, 'employee_certification'),
      certificatesExpired: countWhere(req.user, 'employee_certification', 't.valid_until IS NOT NULL AND t.valid_until < ?', [today]),
      certificatesExpiring: countWhere(req.user, 'employee_certification', 't.valid_until IS NOT NULL AND t.valid_until >= ? AND t.valid_until <= ?', [today, new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)]),
      plannedSchedules,
      completedSchedules,
      planAchievement: plannedSchedules ? round((completedSchedules / plannedSchedules) * 100, 1) : null,
      budget: sumOf(req.user, 'training_budget', 'total_budget', 't.period LIKE ?', [`${year}%`]),
      actualCost: sumOf(req.user, 'training_budget', 'actual_cost', 't.period LIKE ?', [`${year}%`]),
      costPerParticipant: avgOf(req.user, 'training_budget', 'cost_per_participant', 't.period LIKE ?', [`${year}%`]),
      satisfaction: avgOf(req.user, 'training_evaluation', 'satisfaction_score', 't.evaluation_date LIKE ?', like),
      knowledgeGain: avgOf(req.user, 'training_evaluation', 'knowledge_gain', 't.evaluation_date LIKE ?', like),
      incidentReduction: avgOf(req.user, 'training_effectiveness', 'incident_reduction'),
      examPassRate: examTotal ? round((examPassed / examTotal) * 100, 1) : null,
      attendanceRate: attendanceTotal ? round((attendancePresent / attendanceTotal) * 100, 1) : null,
      lmsCompletion: avgOf(req.user, 'learning_content', 'completion_rate'),
      ojtActive: countWhere(req.user, 'ojt_program', "t.status NOT IN ('closed','rejected')"),
      practicalNotCompetent: countWhere(req.user, 'practical_assessment', "t.result = 'Belum Kompeten'"),
    },
    deliveryTrend: monthlySeries(req.user, 'training_competency', 'start_date'),
    hoursTrend: monthlySeries(req.user, 'training_competency', 'start_date', { agg: 'SUM(t.duration_hours)' }),
    scheduleTrend: monthlySeries(req.user, 'training_schedule', 'start_date'),
    byCategory: groupCount(req.user, 'training_master', 'category'),
    byMandatory: groupCount(req.user, 'training_master', 'mandatory'),
    byMethod: groupCount(req.user, 'training_schedule', 'method'),
    scheduleByStatus: groupCount(req.user, 'training_schedule', 'status', 't.start_date LIKE ?', like),
    registrationByStatus: groupCount(req.user, 'training_registration', 'status'),
    attendanceByStatus: groupCount(req.user, 'training_attendance', 'attendance_status', 't.session_date LIKE ?', like),
    attendanceByMethod: groupCount(req.user, 'training_attendance', 'attendance_method'),
    certByStatus: groupCount(req.user, 'employee_certification', 'cert_status'),
    certByType: groupCount(req.user, 'employee_certification', 'certificate_type'),
    competencyByDivision: (() => {
      const b = base(req.user, 'competency_matrix');
      if (!b) return [];
      return all(
        `SELECT t.division AS label, ROUND(AVG(CAST(substr(t.current_level, 1, 1) AS REAL)), 2) AS value,
                SUM(CASE WHEN t.gap_level > 0 THEN 1 ELSE 0 END) AS gaps, COUNT(*) AS total
           FROM "${b.mod.table}" t WHERE ${b.where} AND t.division IS NOT NULL AND t.current_level IS NOT NULL
          GROUP BY t.division ORDER BY value DESC`,
        b.params,
      );
    })(),
    competencyByType: groupCount(req.user, 'competency_matrix', 'competency_type'),
    competencyGapStatus: groupCount(req.user, 'competency_matrix', 'gap_status'),
    complianceByBranch: complianceByOrg(req.user, 'branch_id', 'm_branch'),
    complianceByPort: complianceByOrg(req.user, 'port_id', 'm_port'),
    topGaps: gapRows,
    expiringCertificates: expiringCerts,
    vendors,
    requestBySource: groupCount(req.user, 'training_request', 'need_source'),
    effectiveness: groupCount(req.user, 'training_effectiveness', 'effectiveness_level'),
    behaviour: groupCount(req.user, 'training_effectiveness', 'behaviour_observed'),
    costTrend: monthlySeries(req.user, 'training_budget', 'created_at', { agg: 'SUM(t.actual_cost)' }),
  });
});

dashboardRouter.get('/asset', (req, res) => {
  const year = req.query.year || yearNow();
  const like = [`${year}-%`];
  res.json({
    year,
    assets: {
      total: countWhere(req.user, 'asset'),
      byCategory: groupCount(req.user, 'asset', 'category'),
      byCondition: groupCount(req.user, 'asset', 'condition'),
      criticalityClass: groupCount(req.user, 'asset_criticality', 'criticality_class'),
    },
    inspections: {
      total: countWhere(req.user, 'equipment_inspection', 't.inspection_date LIKE ?', like),
      byResult: groupCount(req.user, 'equipment_inspection', 'result', 't.inspection_date LIKE ?', like),
      notFit: countWhere(req.user, 'equipment_inspection', "t.result = 'Tidak Laik Operasi'"),
      trend: monthlySeries(req.user, 'equipment_inspection', 'inspection_date'),
    },
    maintenance: {
      total: countWhere(req.user, 'maintenance', 't.actual_date LIKE ?', like),
      byType: groupCount(req.user, 'maintenance', 'maintenance_type', 't.actual_date LIKE ?', like),
      downtime: sumOf(req.user, 'maintenance', 'downtime_hours', 't.actual_date LIKE ?', like),
      cost: sumOf(req.user, 'maintenance', 'cost', 't.actual_date LIKE ?', like),
    },
    calibration: {
      total: countWhere(req.user, 'calibration'),
      outOfTolerance: countWhere(req.user, 'calibration', "t.result = 'Tidak Sesuai (Out of Tolerance)'"),
    },
    certificates: {
      total: countWhere(req.user, 'certification'),
      byStatus: groupCount(req.user, 'certification', 'cert_status'),
      expiring: collectAlerts(req.user, { days: 90, limit: 50 }).filter((a) => a.module === 'certification'),
    },
  });
});
