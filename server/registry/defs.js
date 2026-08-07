/**
 * Shared building blocks for the module registry.
 *
 * Every functional module in the platform is declared as data. The engine
 * (server/engine.js) turns a declaration into a database table, a REST
 * resource, a permission set, a workflow and a rendered UI. Adding a module
 * therefore means adding a declaration here - never hand-written CRUD.
 */

/* ------------------------------------------------------------------ fields */

/**
 * f(name, label, type, opts)
 * type: text | textarea | number | date | datetime | time | select | multiselect
 *       | bool | user | employee | port | vessel | branch | region | asset
 *       | contractor | currency | rich | code
 */
export const f = (name, label, type = 'text', opts = {}) => ({
  name,
  label,
  type,
  required: false,
  ...opts,
});

export const req = (name, label, type = 'text', opts = {}) =>
  f(name, label, type, { ...opts, required: true });

/** Convenience builders for the most repeated shapes. */
export const sel = (name, label, options, opts = {}) =>
  f(name, label, 'select', { options, ...opts });

export const num = (name, label, opts = {}) => f(name, label, 'number', opts);
export const dt = (name, label, opts = {}) => f(name, label, 'date', opts);
export const txt = (name, label, opts = {}) => f(name, label, 'textarea', opts);

/* --------------------------------------------------------------- workflows */

/**
 * A workflow is an ordered list of states. `requires` is the RBAC action a
 * user must hold on the module to move a record INTO that state.
 */
const wf = (...states) => states;
const s = (key, label, requires = 'edit', opts = {}) => ({ key, label, requires, ...opts });

export const WF = {
  /** Incident-style reporting: report -> investigate -> act -> verify -> close */
  REPORT: wf(
    s('draft', 'Draft', 'create', { initial: true }),
    s('reported', 'Dilaporkan', 'create'),
    s('investigating', 'Investigasi', 'edit'),
    s('action', 'Tindak Lanjut', 'edit'),
    s('verified', 'Diverifikasi', 'approve'),
    s('closed', 'Ditutup', 'approve', { terminal: true }),
    s('rejected', 'Ditolak', 'approve', { terminal: true, negative: true }),
  ),
  /** Controlled documents (ISO 9001 clause 7.5) */
  DOC: wf(
    s('draft', 'Draft', 'create', { initial: true }),
    s('review', 'Tinjauan', 'edit'),
    s('approved', 'Disetujui', 'approve'),
    s('published', 'Terbit', 'approve'),
    s('obsolete', 'Kedaluwarsa', 'approve', { terminal: true, negative: true }),
  ),
  /** Generic submit -> approve */
  SIMPLE: wf(
    s('draft', 'Draft', 'create', { initial: true }),
    s('submitted', 'Diajukan', 'create'),
    s('approved', 'Disetujui', 'approve'),
    s('closed', 'Selesai', 'edit', { terminal: true }),
    s('rejected', 'Ditolak', 'approve', { terminal: true, negative: true }),
  ),
  /** Inspections & checklists */
  INSPECTION: wf(
    s('planned', 'Direncanakan', 'create', { initial: true }),
    s('in_progress', 'Berlangsung', 'edit'),
    s('completed', 'Selesai Diperiksa', 'edit'),
    s('verified', 'Diverifikasi', 'approve', { terminal: true }),
    s('cancelled', 'Dibatalkan', 'edit', { terminal: true, negative: true }),
  ),
  /** Corrective / preventive actions */
  CAPA: wf(
    s('open', 'Terbuka', 'create', { initial: true }),
    s('in_progress', 'Dikerjakan', 'edit'),
    s('completed', 'Selesai', 'edit'),
    s('verified', 'Diverifikasi Efektif', 'approve'),
    s('closed', 'Ditutup', 'approve', { terminal: true }),
    s('overdue_closed', 'Ditutup Terlambat', 'approve', { terminal: true, negative: true }),
  ),
  /** Work permits & sailing clearance - safety critical, explicit revoke */
  PERMIT: wf(
    s('requested', 'Diajukan', 'create', { initial: true }),
    s('reviewed', 'Ditinjau', 'edit'),
    s('approved', 'Disetujui', 'approve'),
    s('active', 'Berlaku', 'edit'),
    s('closed', 'Ditutup', 'edit', { terminal: true }),
    s('revoked', 'Dicabut', 'approve', { terminal: true, negative: true }),
  ),
  /** Master / register style records */
  RECORD: wf(
    s('draft', 'Draft', 'create', { initial: true }),
    s('active', 'Aktif', 'edit'),
    s('archived', 'Arsip', 'edit', { terminal: true, negative: true }),
  ),
  /** Monitoring & measurement results */
  MONITORING: wf(
    s('recorded', 'Tercatat', 'create', { initial: true }),
    s('reviewed', 'Ditinjau', 'edit'),
    s('validated', 'Tervalidasi', 'approve', { terminal: true }),
  ),
  /** Risks (ISO 31000) */
  RISK: wf(
    s('identified', 'Teridentifikasi', 'create', { initial: true }),
    s('assessed', 'Dinilai', 'edit'),
    s('treatment', 'Perlakuan Risiko', 'edit'),
    s('monitored', 'Dipantau', 'approve'),
    s('closed', 'Ditutup', 'approve', { terminal: true }),
  ),
};

/* ---------------------------------------------------------- shared choices */

export const SEVERITY = [
  { value: '1', label: '1 - Tidak Signifikan' },
  { value: '2', label: '2 - Minor' },
  { value: '3', label: '3 - Sedang' },
  { value: '4', label: '4 - Major' },
  { value: '5', label: '5 - Katastropik' },
];

export const LIKELIHOOD = [
  { value: '1', label: '1 - Sangat Jarang' },
  { value: '2', label: '2 - Jarang' },
  { value: '3', label: '3 - Mungkin' },
  { value: '4', label: '4 - Sering' },
  { value: '5', label: '5 - Hampir Pasti' },
];

/**
 * Tingkat risiko tidak dipilih pengguna melainkan dihitung dari matriks 5×5,
 * jadi tidak berupa `options`. Kosakatanya tetap terbatas dan dideklarasikan
 * di sini supaya dashboard dapat menerjemahkan labelnya tanpa menebak mana
 * nilai baku dan mana teks bebas.
 */
export const RISK_LEVELS = ['Rendah', 'Sedang', 'Tinggi', 'Ekstrem'];

export const YESNO = ['Ya', 'Tidak'];
export const CHECK_RESULT = ['Baik', 'Perlu Perbaikan', 'Tidak Berfungsi', 'Tidak Berlaku'];
export const PRIORITY = ['Rendah', 'Sedang', 'Tinggi', 'Kritis'];

/** Risk matrix fields reused by HIRA, JSA, risk register, asset criticality. */
export const riskFields = (prefix = '') => [
  sel(`${prefix}likelihood`, 'Kemungkinan (Likelihood)', LIKELIHOOD, { required: true, group: 'Penilaian Risiko' }),
  sel(`${prefix}severity`, 'Keparahan (Severity)', SEVERITY, { required: true, group: 'Penilaian Risiko' }),
  num(`${prefix}risk_score`, 'Nilai Risiko', { computed: `${prefix}likelihood*${prefix}severity`, readonly: true, group: 'Penilaian Risiko' }),
  f(`${prefix}risk_level`, 'Tingkat Risiko', 'text', { computed: `${prefix}riskLevel`, readonly: true, values: RISK_LEVELS, group: 'Penilaian Risiko' }),
];

/** Residual risk after treatment. */
export const residualFields = () => [
  sel('res_likelihood', 'Kemungkinan Residual', LIKELIHOOD, { group: 'Risiko Residual' }),
  sel('res_severity', 'Keparahan Residual', SEVERITY, { group: 'Risiko Residual' }),
  num('res_risk_score', 'Nilai Risiko Residual', { computed: 'res_likelihood*res_severity', readonly: true, group: 'Risiko Residual' }),
  f('res_risk_level', 'Tingkat Risiko Residual', 'text', { computed: 'resRiskLevel', readonly: true, values: RISK_LEVELS, group: 'Risiko Residual' }),
];

/**
 * m(def) - declare a module. Defaults keep declarations short.
 *
 * scope: 'corporate' | 'branch' | 'port' | 'vessel' | 'any'
 *   drives which organisational columns are mandatory and how row-level
 *   security filters the list for a user.
 */
export const m = (def) => ({
  workflow: WF.SIMPLE,
  scope: 'any',
  icon: '■',
  standards: [],
  regulations: [],
  fields: [],
  capa: false,
  contractorAccess: false,
  ...def,
});
