/**
 * Role-Based Access Control.
 *
 * Ten hierarchical levels mirroring ASDP governance. Two orthogonal questions
 * are answered here:
 *   1. WHAT may a role do to a module?   -> role_permissions table
 *   2. WHICH rows may a user see?        -> scope filter (row-level security)
 */
import { MODULES, MODULE_BY_KEY, CONTRACTOR_MODULES } from './registry/index.js';
import { all, get, run } from './db.js';

export const ACTIONS = ['view', 'create', 'edit', 'approve', 'delete'];

export const ROLES = [
  { key: 'sysadmin', level: 1, name: 'Administrator Sistem', scope_type: 'global', description: 'Konfigurasi sistem, master data, pengguna, hak akses.' },
  { key: 'corporate_qhse', level: 2, name: 'Corporate QHSE', scope_type: 'global', description: 'Kebijakan, KPI nasional, dashboard korporat, persetujuan strategis.' },
  { key: 'regional_qhse', level: 3, name: 'Regional/Branch QHSE', scope_type: 'region', description: 'Implementasi QHSE di wilayah/cabang.' },
  { key: 'port_manager', level: 4, name: 'Port Manager', scope_type: 'port', description: 'Pengelolaan QHSE pelabuhan, inspeksi, tindak lanjut.' },
  { key: 'vessel_master', level: 5, name: 'Vessel Master (Nakhoda)', scope_type: 'vessel', description: 'Inspeksi kapal, insiden, izin kerja di kapal.' },
  { key: 'dept_head', level: 6, name: 'Department Head', scope_type: 'branch', description: 'Persetujuan CAPA, HIRA, izin kerja, evaluasi risiko.' },
  { key: 'supervisor', level: 7, name: 'Supervisor', scope_type: 'port', description: 'Inspeksi, observasi keselamatan, toolbox meeting, monitoring pekerjaan.' },
  { key: 'operator', level: 8, name: 'Petugas/Operator', scope_type: 'own', description: 'Pelaporan insiden, near miss, unsafe action/condition, checklist operasional.' },
  { key: 'contractor', level: 9, name: 'Kontraktor', scope_type: 'own', description: 'Akses terbatas untuk izin kerja, HIRA pekerjaan dan pelaporan terkait.' },
  { key: 'auditor', level: 10, name: 'Auditor Internal & Eksternal', scope_type: 'global', description: 'Akses baca dokumen, audit, temuan dan laporan.' },
];

export const ROLE_BY_KEY = new Map(ROLES.map((r) => [r.key, r]));

/** Modules a Level-8 operator may originate records in. */
const OPERATOR_CREATE = new Set([
  'incident', 'near_miss', 'unsafe_action', 'unsafe_condition', 'safety_observation',
  'toolbox_meeting', 'clinic', 'fatigue_management', 'ferry_safety_checklist',
  'vehicle_loading_safety', 'passenger_safety', 'cargo_securing', 'mooring_safety',
  'port_safety_patrol', 'port_environment_monitoring', 'weather_monitoring',
  'equipment_inspection', 'inspection', 'lsa_inspection', 'ffa_inspection',
  'ramp_door_inspection', 'stability_monitoring', 'fuel_consumption',
  'waste_management', 'hazardous_waste', 'crowd_management', 'customer_complaint',
  'spill_management', 'marine_incident', 'jsa', 'hira', 'work_permit', 'information_security',
  // Pelatihan: setiap pekerja boleh mendaftar sendiri dan mengusulkan
  // kebutuhan pelatihannya; pencatatan hasil tetap milik penyelenggara.
  'training_registration', 'training_request',
]);

/** Modules a Level-6 department head or Level-5 master may approve. */
const APPROVER_MODULES = new Set([
  'capa', 'preventive_action', 'continuous_improvement', 'non_conformity', 'hira', 'jsa',
  'work_permit', 'risk_register', 'operational_risk', 'port_risk', 'vessel_risk',
  'risk_treatment', 'contractor_permit', 'contractor_prequalification', 'dangerous_goods',
  'sailing_clearance', 'ferry_safety_checklist', 'vehicle_loading_safety', 'passenger_safety',
  'emergency_response', 'inspection', 'equipment_inspection', 'maintenance', 'legal_register',
  'training_registration', 'training_request', 'skill_gap', 'practical_assessment',
  'competency_assessment', 'employee_certification', 'training_budget',
]);

const MARITIME_GROUPS = new Set(['maritime', 'safety', 'environment', 'assetsafety']);

/**
 * Default permission matrix. Explicit and readable beats clever: this is the
 * document an auditor will ask to see.
 */
export function defaultPermissions(roleKey, mod) {
  const none = { view: 0, create: 0, edit: 0, approve: 0, delete: 0 };
  const ro = { ...none, view: 1 };
  const rw = { view: 1, create: 1, edit: 1, approve: 0, delete: 0 };
  const full = { view: 1, create: 1, edit: 1, approve: 1, delete: 1 };

  // Modul komersial (langganan & penagihan) dikelola pengelola platform.
  // Peran cabang hanya boleh membaca tagihan dan pemakaian miliknya sendiri.
  if (mod.group === 'saas') {
    if (roleKey === 'sysadmin') return full;
    if (roleKey === 'corporate_qhse') return { ...full, delete: 0 };
    if (roleKey === 'auditor') return mod.platformOnly ? none : ro;
    if (['contractor', 'operator'].includes(roleKey)) return none;
    return mod.platformOnly ? none : ro;
  }

  switch (roleKey) {
    case 'sysadmin':
      return full;

    case 'corporate_qhse':
      return mod.master ? { ...rw, approve: 1 } : { ...full, delete: 0 };

    case 'regional_qhse':
      return mod.master ? ro : { view: 1, create: 1, edit: 1, approve: 1, delete: 0 };

    case 'port_manager':
      if (mod.master) return mod.key === 'employee' || mod.key === 'asset' ? rw : ro;
      return { view: 1, create: 1, edit: 1, approve: APPROVER_MODULES.has(mod.key) ? 1 : 0, delete: 0 };

    case 'vessel_master':
      if (mod.master) return ro;
      if (mod.scope === 'vessel' || MARITIME_GROUPS.has(mod.group)) {
        return { view: 1, create: 1, edit: 1, approve: APPROVER_MODULES.has(mod.key) ? 1 : 0, delete: 0 };
      }
      return rw;

    case 'dept_head':
      if (mod.master) return ro;
      return { view: 1, create: 1, edit: 1, approve: APPROVER_MODULES.has(mod.key) ? 1 : 0, delete: 0 };

    case 'supervisor':
      if (mod.master) return ro;
      return rw;

    case 'operator':
      if (mod.master) return ro;
      return OPERATOR_CREATE.has(mod.key) ? rw : ro;

    case 'contractor':
      if (!CONTRACTOR_MODULES.includes(mod.key)) return none;
      return rw;

    case 'auditor':
      return ro;

    default:
      return none;
  }
}

/** Write the role catalogue and default matrix into the database. */
export function seedRoles({ overwrite = false } = {}) {
  for (const role of ROLES) {
    run(
      `INSERT INTO roles (key, name, level, scope_type, description) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET name = excluded.name, level = excluded.level,
         scope_type = excluded.scope_type, description = excluded.description`,
      [role.key, role.name, role.level, role.scope_type, role.description],
    );
    for (const mod of MODULES) {
      const p = defaultPermissions(role.key, mod);
      const exists = get('SELECT 1 FROM role_permissions WHERE role_key = ? AND module_key = ?', [role.key, mod.key]);
      if (exists && !overwrite) continue;
      run(
        `INSERT INTO role_permissions (role_key, module_key, can_view, can_create, can_edit, can_approve, can_delete)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(role_key, module_key) DO UPDATE SET
           can_view = excluded.can_view, can_create = excluded.can_create,
           can_edit = excluded.can_edit, can_approve = excluded.can_approve,
           can_delete = excluded.can_delete`,
        [role.key, mod.key, p.view, p.create, p.edit, p.approve, p.delete],
      );
    }
  }
}

/* --------------------------------------------------------------- runtime */

const cache = new Map();

export function permissionsFor(roleKey) {
  if (cache.has(roleKey)) return cache.get(roleKey);
  const rows = all('SELECT * FROM role_permissions WHERE role_key = ?', [roleKey]);
  const map = new Map();
  for (const r of rows) {
    map.set(r.module_key, {
      view: !!r.can_view,
      create: !!r.can_create,
      edit: !!r.can_edit,
      approve: !!r.can_approve,
      delete: !!r.can_delete,
    });
  }
  cache.set(roleKey, map);
  return map;
}

export function clearPermissionCache(roleKey) {
  if (roleKey) cache.delete(roleKey);
  else cache.clear();
}

export function can(user, moduleKey, action) {
  if (!user) return false;
  const perms = permissionsFor(user.role_key).get(moduleKey);
  return !!perms?.[action];
}

export function assertCan(user, moduleKey, action) {
  if (!can(user, moduleKey, action)) {
    const err = new Error(`Akses ditolak: tidak memiliki hak "${action}" pada modul "${moduleKey}".`);
    err.status = 403;
    throw err;
  }
}

/**
 * Row-level security.
 *
 * Master/reference data stays readable by everyone who can view the module -
 * dropdowns across the app depend on it - while transactional records are
 * filtered to the user's slice of the organisation.
 */
export function scopeClause(user, mod, alias = 't') {
  const role = ROLE_BY_KEY.get(user.role_key);
  const scope = user.scope_override || role?.scope_type || 'own';
  if (scope === 'global' || mod.master) return { sql: '', params: [] };

  const ownSql = `(${alias}.created_by = ? OR ${alias}.owner_id = ?)`;

  // Rekaman yang memang milik cabang (langganan, tagihan, pemakaian) dilihat
  // per cabang, walaupun cakupan peran penggunanya lebih sempit dari cabang.
  if (mod.scope === 'branch' && user.branch_id) {
    return { sql: `${alias}.branch_id = ?`, params: [user.branch_id] };
  }

  switch (scope) {
    case 'region':
      return user.region_id
        ? { sql: `(${alias}.region_id = ? OR ${ownSql})`, params: [user.region_id, user.id, user.id] }
        : { sql: '', params: [] };
    case 'branch':
      return user.branch_id
        ? { sql: `(${alias}.branch_id = ? OR ${ownSql})`, params: [user.branch_id, user.id, user.id] }
        : { sql: '', params: [] };
    case 'port':
      return user.port_id
        ? { sql: `(${alias}.port_id = ? OR ${ownSql})`, params: [user.port_id, user.id, user.id] }
        : { sql: '', params: [] };
    case 'vessel':
      return user.vessel_id
        ? { sql: `(${alias}.vessel_id = ? OR ${ownSql})`, params: [user.vessel_id, user.id, user.id] }
        : { sql: '', params: [] };
    case 'own':
    default:
      return { sql: ownSql, params: [user.id, user.id] };
  }
}

/** Does the workflow allow this user to move a record into `status`? */
export function canTransition(user, mod, statusKey) {
  const state = mod.workflow.find((s) => s.key === statusKey);
  if (!state) return false;
  return can(user, mod.key, state.requires);
}

/** Modules the user may at least see, grouped for the navigation sidebar. */
export function visibleModules(user) {
  const perms = permissionsFor(user.role_key);
  return MODULES.filter((m) => perms.get(m.key)?.view).map((m) => m.key);
}

export function permissionSummary(user) {
  const perms = permissionsFor(user.role_key);
  const out = {};
  for (const [key, value] of perms) {
    if (MODULE_BY_KEY.has(key)) out[key] = value;
  }
  return out;
}
