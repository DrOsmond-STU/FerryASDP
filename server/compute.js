/**
 * Derived-value engine.
 *
 * Fields declared with `computed:` are never trusted from the client - they are
 * recalculated here on every write so the stored data always matches the rule.
 */

/* ------------------------------------------------------- reference constants */

/**
 * Emission factors (kg CO2e per unit of activity).
 * Sources: IPCC 2006 Guidelines Vol.2 (stationary/mobile combustion),
 * KESDM grid emission factor for the Jamali system, DEFRA 2023 for LPG.
 * Kept in one place so an update is a one-line change with a traceable source.
 */
export const EMISSION_FACTORS = {
  'Solar / HSD (Kapal)': { factor: 2.68, unit: 'liter', source: 'IPCC 2006 - Gas/Diesel Oil' },
  'Solar / HSD (Genset)': { factor: 2.68, unit: 'liter', source: 'IPCC 2006 - Gas/Diesel Oil' },
  MFO: { factor: 3.114, unit: 'kg', source: 'IPCC 2006 - Residual Fuel Oil' },
  'Bensin (Kendaraan Operasional)': { factor: 2.31, unit: 'liter', source: 'IPCC 2006 - Motor Gasoline' },
  'Listrik PLN': { factor: 0.794, unit: 'kWh', source: 'KESDM - Faktor Emisi Sistem Jamali' },
  LPG: { factor: 2.98, unit: 'kg', source: 'DEFRA 2023' },
  Pelumas: { factor: 2.95, unit: 'liter', source: 'IPCC 2006 - Lubricants' },
  'Air Bersih (PDAM)': { factor: 0.344, unit: 'm3', source: 'DEFRA 2023 - Water Supply' },
};

/** 5x5 matrix bands used consistently across HIRA, risk register, criticality. */
export const RISK_BANDS = [
  { max: 4, level: 'Rendah', color: '#16a34a' },
  { max: 9, level: 'Sedang', color: '#eab308' },
  { max: 15, level: 'Tinggi', color: '#f97316' },
  { max: 25, level: 'Ekstrem', color: '#dc2626' },
];

export function riskLevelOf(score) {
  const n = Number(score);
  if (!n || Number.isNaN(n)) return null;
  return (RISK_BANDS.find((b) => n <= b.max) || RISK_BANDS.at(-1)).level;
}

/* --------------------------------------------------------------- helpers */

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const has = (v) => v !== null && v !== undefined && v !== '';
const pct = (a, b) => (n(b) === 0 ? null : round((n(a) / n(b)) * 100, 2));
const round = (v, d = 2) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const daysBetween = (from, to) => Math.floor((new Date(to) - new Date(from)) / 86400000);
const today = () => new Date().toISOString().slice(0, 10);

/** Leading integer of choices like "3 - Sedang". */
const rank = (v) => {
  if (!has(v)) return 0;
  const match = String(v).match(/^\s*(\d+)/);
  return match ? Number(match[1]) : 0;
};

/* ------------------------------------------------------ computed functions */

const COMPUTED = {
  riskLevel: (r) => riskLevelOf(rank(r.likelihood) * rank(r.severity)),
  resRiskLevel: (r) => riskLevelOf(rank(r.res_likelihood) * rank(r.res_severity)),
  potential_riskLevel: (r) => riskLevelOf(rank(r.potential_likelihood) * rank(r.potential_severity)),

  sumHours: (r) => round(n(r.employee_hours) + n(r.contractor_hours) + n(r.crew_hours), 2),

  kpiAchievement: (r) => {
    if (!has(r.actual) || !has(r.target) || n(r.target) === 0) return null;
    const lowerBetter = String(r.polarity || '').startsWith('Semakin Rendah');
    return round(lowerBetter ? (n(r.target) / n(r.actual)) * 100 : (n(r.actual) / n(r.target)) * 100, 2);
  },
  kpiStatus: (r) => {
    const a = COMPUTED.kpiAchievement(r);
    if (a === null) return null;
    if (a >= 100) return 'Tercapai';
    if (a >= 90) return 'Hampir Tercapai';
    if (a >= 75) return 'Perlu Perhatian';
    return 'Tidak Tercapai';
  },

  restCompliance: (r) => (n(r.hours_rest_24h) >= 10 && (!has(r.hours_rest_7d) || n(r.hours_rest_7d) >= 77) ? 1 : 0),
  fatigueRisk: (r) => {
    const score = rank(r.fatigue_score);
    const restOk = COMPUTED.restCompliance(r) === 1;
    if (score >= 5 || !restOk) return 'Berisiko Tinggi';
    if (score === 4 || n(r.consecutive_days) > 6) return 'Perlu Perhatian';
    return 'Aman';
  },

  recycleRate: (r) => pct(r.recycled_qty, r.quantity),

  storageDays: (r) => (has(r.storage_start) ? Math.max(0, daysBetween(r.storage_start, today())) : null),
  b3StorageCompliant: (r) => {
    const d = COMPUTED.storageDays(r);
    if (d === null) return null;
    return d <= 90 ? 1 : 0;
  },

  specificConsumption: (r) => {
    if (n(r.operating_hours) > 0) return round(n(r.quantity) / n(r.operating_hours), 4);
    if (n(r.trips) > 0) return round(n(r.quantity) / n(r.trips), 4);
    return null;
  },
  co2e: (r) => {
    const ef = EMISSION_FACTORS[r.energy_type];
    if (!ef || !has(r.quantity)) return null;
    return round(n(r.quantity) * ef.factor, 3);
  },

  co2eTon: (r) => {
    if (has(r.emission_factor)) return round((n(r.activity_data) * n(r.emission_factor)) / 1000, 4);
    return null;
  },
  reductionPercent: (r) => {
    if (!has(r.baseline_ton) || n(r.baseline_ton) === 0) return null;
    const actual = COMPUTED.co2eTon(r);
    if (actual === null) return null;
    return round(((n(r.baseline_ton) - actual) / n(r.baseline_ton)) * 100, 2);
  },

  recoveryRate: (r) => pct(r.recovered_liter, r.volume_liter),
  safePercentage: (r) => pct(r.safe_count, n(r.safe_count) + n(r.unsafe_count)),
  conformityRate: (r) => {
    if (has(r.items_conform) && n(r.items_checked) > 0) return pct(r.items_conform, r.items_checked);
    if (has(r.findings_count) && n(r.items_checked) > 0) {
      return round(((n(r.items_checked) - n(r.findings_count)) / n(r.items_checked)) * 100, 2);
    }
    return null;
  },
  complianceRate: (r) => pct(r.obligations_compliant, r.obligations_total),

  certStatus: (r) => {
    if (!has(r.valid_until)) return null;
    const d = daysBetween(today(), r.valid_until);
    if (d < 0) return 'Kedaluwarsa';
    if (d <= n(r.renewal_lead_days || 60)) return 'Akan Kedaluwarsa';
    return 'Berlaku';
  },

  criticalityClass: (r) => {
    const worst = Math.max(rank(r.safety_impact), rank(r.operational_impact), rank(r.environmental_impact), rank(r.financial_impact));
    const score = rank(r.likelihood) * rank(r.severity);
    if (worst >= 4 || score >= 15) return 'Kritis Tinggi';
    if (worst === 3 || score >= 8) return 'Kritis Sedang';
    return 'Non-Kritis';
  },

  csmsScore: (r) => {
    const parts = ['score_commitment', 'score_procedure', 'score_competency', 'score_equipment', 'score_performance', 'score_compliance']
      .filter((k) => has(r[k]))
      .map((k) => n(r[k]));
    return parts.length ? round(parts.reduce((a, b) => a + b, 0) / parts.length, 2) : null;
  },
  csmsGrade: (r) => {
    const s = COMPUTED.csmsScore(r);
    if (s === null) return null;
    if (s >= 90) return 'A - Sangat Baik';
    if (s >= 75) return 'B - Baik';
    if (s >= 60) return 'C - Cukup';
    if (s >= 45) return 'D - Kurang';
    return 'E - Tidak Layak';
  },
  evalScore: (r) => {
    const parts = ['score_quality', 'score_hse', 'score_timeliness', 'score_cooperation', 'score_documentation']
      .filter((k) => has(r[k]))
      .map((k) => n(r[k]));
    return parts.length ? round(parts.reduce((a, b) => a + b, 0) / parts.length, 2) : null;
  },

  // Frequency rates normalised to 1,000,000 man-hours (Indonesian & OSHA-style
  // reporting both appear in practice; 1e6 is what ASDP-scale reporting uses).
  ltifr: (r) => (n(r.manhours) > 0 ? round(((n(r.fatality) + n(r.lti)) * 1e6) / n(r.manhours), 3) : null),
  trir: (r) => (n(r.manhours) > 0 ? round(((n(r.fatality) + n(r.lti) + n(r.mtc) + n(r.fac)) * 1e6) / n(r.manhours), 3) : null),
  severityRate: (r) => (n(r.manhours) > 0 ? round((n(r.lost_days) * 1e6) / n(r.manhours), 3) : null),
  safetyRating: (r) => {
    if (n(r.fatality) > 0) return 'Buruk';
    const rate = COMPUTED.ltifr(r);
    if (rate === null) return null;
    if (rate === 0) return 'Sangat Baik';
    if (rate <= 1) return 'Baik';
    if (rate <= 3) return 'Cukup';
    return 'Buruk';
  },

  capacityUtilization: (r) => pct(r.total_vehicles, r.deck_capacity_sup),
  paxUtilization: (r) => pct(r.actual_count ?? r.manifest_count, r.pax_capacity),
  overCapacity: (r) => {
    const u = COMPUTED.paxUtilization(r);
    return u === null ? null : u > 100 ? 1 : 0;
  },
  occupancyRate: (r) => pct(r.passenger_count, r.terminal_capacity),

  meanDraft: (r) => (has(r.draft_fore) && has(r.draft_aft) ? round((n(r.draft_fore) + n(r.draft_aft)) / 2, 3) : null),
  trimValue: (r) => (has(r.draft_fore) && has(r.draft_aft) ? round(n(r.draft_aft) - n(r.draft_fore), 3) : null),
  gmCompliant: (r) => {
    if (!has(r.gm_value)) return null;
    const min = has(r.gm_minimum) ? n(r.gm_minimum) : 0.15;
    return n(r.gm_value) >= min ? 1 : 0;
  },

  /* ------------------------------------------------------- langganan SaaS */

  annualSaving: (r) => {
    if (!has(r.monthly_price) || !has(r.annual_price) || n(r.monthly_price) === 0) return null;
    const full = n(r.monthly_price) * 12;
    return round(((full - n(r.annual_price)) / full) * 100, 1);
  },
  effectiveFee: (r) => {
    if (!has(r.list_price)) return null;
    return round(n(r.list_price) * (1 - n(r.discount_percent) / 100), 2);
  },
  seatUtilization: (r) => pct(r.active_users, r.user_seats),
  usageSeatUtilization: (r) => pct(r.active_users, r.licensed_users),

  // PPN 11% sesuai UU No. 7 Tahun 2021 (HPP), dihitung setelah diskon.
  invoiceTax: (r) => round((n(r.subtotal) - n(r.discount)) * 0.11, 2),
  invoiceTotal: (r) => round((n(r.subtotal) - n(r.discount)) * 1.11, 2),
  daysOverdue: (r) => {
    if (!has(r.due_date)) return null;
    if (has(r.paid_date)) return Math.max(0, daysBetween(r.due_date, r.paid_date));
    return Math.max(0, daysBetween(r.due_date, today()));
  },

  adoptionScore: (r) => {
    const seat = pct(r.active_users, r.licensed_users);
    const modules = pct(r.modules_used, r.modules_available);
    const parts = [seat, modules].filter((v) => v !== null);
    if (!parts.length) return null;
    return round(parts.reduce((a, b) => a + b, 0) / parts.length, 1);
  },
  adoptionStatus: (r) => {
    const score = COMPUTED.adoptionScore(r);
    if (score === null) return null;
    if (score >= 75) return 'Sangat Baik';
    if (score >= 55) return 'Baik';
    if (score >= 35) return 'Perlu Pendampingan';
    return 'Rendah';
  },

  energyReduction: (r) => {
    if (!has(r.baseline_consumption) || n(r.baseline_consumption) === 0) return null;
    return round(((n(r.baseline_consumption) - n(r.actual_consumption)) / n(r.baseline_consumption)) * 100, 2);
  },
};

/**
 * Recompute every declared computed field on a row.
 * Supports the shorthand `a*b` used by the risk matrix fields.
 */
export function applyComputed(mod, row) {
  for (const field of mod.fields) {
    if (!field.computed) continue;
    const expr = field.computed;
    if (expr.includes('*')) {
      const [a, b] = expr.split('*');
      const value = rank(row[a]) * rank(row[b]);
      row[field.name] = value || null;
      continue;
    }
    const fn = COMPUTED[expr];
    if (!fn) continue;
    try {
      row[field.name] = fn(row);
    } catch {
      row[field.name] = null;
    }
  }
  return row;
}

export { rank, round, pct, daysBetween, today };
