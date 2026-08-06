/**
 * Registry index - assembles every module declaration into one catalogue and
 * normalises it so the rest of the server can rely on a complete shape.
 */
import governance, { group as gGovernance } from './governance.js';
import document, { group as gDocument } from './document.js';
import quality, { group as gQuality } from './quality.js';
import health, { group as gHealth } from './health.js';
import safety, { group as gSafety } from './safety.js';
import environment, { group as gEnvironment } from './environment.js';
import audit, { group as gAudit } from './audit.js';
import risk, { group as gRisk } from './risk.js';
import assetSafety, { group as gAsset } from './asset.js';
import contractorSafety, { group as gContractor } from './contractor.js';
import maritime, { group as gMaritime } from './maritime.js';
import portSafety, { group as gPortSafety } from './portsafety.js';
import continuity, { group as gContinuity } from './continuity.js';

const SOURCES = [
  [gGovernance, governance],
  [gDocument, document],
  [gQuality, quality],
  [gHealth, health],
  [gSafety, safety],
  [gEnvironment, environment],
  [gAudit, audit],
  [gRisk, risk],
  [gAsset, assetSafety],
  [gContractor, contractorSafety],
  [gMaritime, maritime],
  [gPortSafety, portSafety],
  [gContinuity, continuity],
];

/** Organisational columns injected into every module table. */
export const ORG_FIELDS = ['region', 'branch', 'port', 'vessel'];

const ORG_DEFAULTS = {
  corporate: { fields: [], required: [] },
  branch: { fields: ['region', 'branch'], required: ['branch'] },
  port: { fields: ['region', 'branch', 'port'], required: ['port'] },
  vessel: { fields: ['port', 'vessel'], required: ['vessel'] },
  any: { fields: ORG_FIELDS, required: [] },
};

/** Reference field types resolved against another module's table. */
export const REF_TYPES = {
  region: 'region',
  branch: 'branch',
  port: 'port',
  vessel: 'vessel',
  employee: 'employee',
  asset: 'asset',
  contractor: 'contractor',
};

export const GROUPS = [];
export const MODULES = [];
export const MODULE_BY_KEY = new Map();

for (const [group, modules] of SOURCES) {
  const g = { ...group, modules: [] };
  GROUPS.push(g);
  for (const raw of modules) {
    if (MODULE_BY_KEY.has(raw.key)) throw new Error(`Duplicate module key: ${raw.key}`);
    const orgDefault = ORG_DEFAULTS[raw.scope] || ORG_DEFAULTS.any;
    const mod = {
      ...raw,
      nameId: raw.nameId || raw.name,
      group: g.key,
      groupCode: g.code,
      groupName: g.name,
      table: `m_${raw.key}`,
      labelField: raw.labelField || (raw.fields.some((f) => f.name === 'title') ? 'title' : 'name'),
      orgFields: raw.orgFields || orgDefault.fields,
      orgRequired: raw.orgRequired || orgDefault.required,
      statuses: raw.workflow.map((s) => s.key),
      initialStatus: (raw.workflow.find((s) => s.initial) || raw.workflow[0]).key,
      master: !!raw.master,
    };
    // A module with no explicit label field still needs something to show.
    if (!mod.fields.some((f) => f.name === mod.labelField)) {
      mod.labelField = mod.fields[0]?.name || 'code';
    }
    mod.listFields = raw.listFields || defaultListFields(mod);
    MODULES.push(mod);
    MODULE_BY_KEY.set(mod.key, mod);
    g.modules.push(mod.key);
  }
}

/** First few meaningful columns make a sensible default table view. */
function defaultListFields(mod) {
  const preferred = mod.fields
    .filter((f) => !['textarea', 'rich'].includes(f.type) && !f.group)
    .map((f) => f.name);
  const label = mod.labelField;
  const rest = preferred.filter((n) => n !== label).slice(0, 4);
  return [label, ...rest];
}

export const MASTER_MODULES = MODULES.filter((m) => m.master);
export const DATA_MODULES = MODULES.filter((m) => !m.master);

/** Modules a Level-9 contractor account may touch at all. */
export const CONTRACTOR_MODULES = MODULES.filter((m) => m.contractorAccess).map((m) => m.key);

export function moduleOrThrow(key) {
  const mod = MODULE_BY_KEY.get(key);
  if (!mod) {
    const err = new Error(`Unknown module: ${key}`);
    err.status = 404;
    throw err;
  }
  return mod;
}

/** Compact catalogue for the client - the UI is generated from this. */
export function catalogue() {
  return {
    groups: GROUPS.map((g) => ({ code: g.code, key: g.key, name: g.name, icon: g.icon, modules: g.modules })),
    modules: MODULES.map((m) => ({
      key: m.key,
      name: m.name,
      nameId: m.nameId,
      icon: m.icon,
      group: m.group,
      groupCode: m.groupCode,
      groupName: m.groupName,
      codePrefix: m.codePrefix,
      scope: m.scope,
      master: m.master,
      singleton: !!m.singleton,
      capa: !!m.capa,
      standards: m.standards,
      regulations: m.regulations,
      labelField: m.labelField,
      listFields: m.listFields,
      orgFields: m.orgFields,
      orgRequired: m.orgRequired,
      workflow: m.workflow,
      initialStatus: m.initialStatus,
      fields: m.fields,
    })),
  };
}
