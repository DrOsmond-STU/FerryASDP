/**
 * Generic module UI.
 *
 * The list, form and detail screens below are driven entirely by the module
 * metadata served from /api/meta, which is why 93 modules need no bespoke
 * screens of their own.
 */
import { api, state, can, mod, options, invalidateOptions, userList } from './api.js';
import {
  h, mount, clear, toast, modal, confirmDialog, statusBadge, riskPill,
  fmtDate, fmtDateTime, fmtNumber, fmtDecimal, fmtCurrency, emptyState, spinner,
} from './ui.js';
import { t } from './i18n.js';

/**
 * Jenis field yang menunjuk rekaman modul lain, dipetakan ke kunci modulnya.
 * Nama jenis dan kunci modul tidak selalu sama - `plan` menunjuk
 * `subscription_plan`, `training` menunjuk `training_master` - jadi pemetaan
 * ini harus dibaca, bukan ditebak dari nama jenisnya.
 * Cerminan REF_TYPES di server/registry/index.js.
 */
const REF_TYPES = {
  region: 'region',
  branch: 'branch',
  port: 'port',
  vessel: 'vessel',
  employee: 'employee',
  asset: 'asset',
  contractor: 'contractor',
  plan: 'subscription_plan',
  subscription: 'subscription',
  training: 'training_master',
  vendor: 'training_vendor',
};
const ORG_LABEL = { region: 'Regional', branch: 'Cabang', port: 'Pelabuhan', vessel: 'Kapal' };

const optValue = (o) => (typeof o === 'string' ? o : o.value);
const optLabel = (o) => (typeof o === 'string' ? o : o.label ?? o.value);

/* ----------------------------------------------------------- value display */

async function refLabel(type, id) {
  if (!id) return '—';
  const list = await options(REF_TYPES[type]);
  return list.find((o) => o.id === Number(id))?.label || `#${id}`;
}

/** Renders a stored value for reading. Returns a Node. */
export function displayValue(field, value, record) {
  if (value === null || value === undefined || value === '') return h('span.muted', { text: '—' });

  switch (field.type) {
    case 'bool':
      return h('span.badge', { class: value ? 'b-ok' : 'b-draft', text: value ? t('Ya') : t('Tidak') });
    case 'currency':
      return h('span', { text: fmtCurrency(value) });
    case 'number':
      return h('span', { text: Number.isInteger(Number(value)) ? fmtNumber(value) : fmtDecimal(value, 3) });
    case 'date':
      return h('span', { text: fmtDate(value) });
    case 'datetime':
      return h('span', { text: fmtDateTime(value) });
    case 'multiselect':
      return h('div.chips', {}, ...(Array.isArray(value) ? value : [value]).map((v) => h('span.chip', { text: v })));
    case 'textarea':
      return h('div', { style: 'white-space:pre-wrap', text: String(value) });
    default:
      if (field.type in REF_TYPES) {
        const span = h('span', { text: `#${value}` });
        refLabel(field.type, value).then((label) => { span.textContent = label; });
        return span;
      }
      if (field.name.endsWith('risk_level')) return riskPill(value);
      return h('span', { text: String(value) });
  }
}

/** Compact value for table cells. */
function cellValue(field, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (field.type === 'bool') return value ? t('Ya') : t('Tidak');
  if (field.type === 'currency') return fmtCurrency(value);
  if (field.type === 'number') return Number.isInteger(Number(value)) ? fmtNumber(value) : fmtDecimal(value, 2);
  if (field.type === 'date') return fmtDate(value);
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/* --------------------------------------------------------------- listing */

const listStateByModule = new Map();

export async function renderModuleList(container, module) {
  const view = listStateByModule.get(module.key) || { page: 1, size: 25, q: '', status: '', sort: 'created_at', dir: 'desc', org: {} };
  listStateByModule.set(module.key, view);

  const header = h('div.page-head', {},
    h('div.grow', {},
      h('h1', {}, h('span', { text: module.icon }), module.nameId),
      h('div.small.muted', { text: `${module.name} · ${t('Kelompok')} ${module.groupCode} — ${module.groupName}` }),
      h('div.chips', { style: 'margin-top:.4rem' },
        ...module.standards.map((s) => h('span.chip.std', { text: s })),
        ...module.regulations.map((r) => h('span.chip.reg', { text: r })))),
    h('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap' },
      h('button', { onclick: () => downloadCsv(module, view), text: t('⭳ Ekspor CSV') }),
      can(module.key, 'create')
        ? h('a.btn.btn-primary', { href: `#/m/${module.key}/new`, text: t('+ Rekaman Baru') })
        : null));

  const statsBar = h('div.chips', { style: 'margin-bottom:.7rem' });
  const tableHost = h('div');
  mount(container, header, statsBar, toolbar(module, view, () => refresh()), tableHost);

  async function refresh() {
    mount(tableHost, spinner());
    const query = new URLSearchParams({
      page: view.page, size: view.size, sort: view.sort, dir: view.dir,
    });
    if (view.q) query.set('q', view.q);
    if (view.status) query.set('status', view.status);
    for (const [k, v] of Object.entries(view.org)) if (v) query.set(`${k}_id`, v);

    const [data, stats] = await Promise.all([
      api.get(`/api/modules/${module.key}/records?${query}`),
      api.get(`/api/modules/${module.key}/stats?${query}`).catch(() => ({ byStatus: [] })),
    ]);

    mount(statsBar,
      h('span.chip', { text: `${t('Total')} ${fmtNumber(data.total)} ${t('rekaman')}` }),
      ...(stats.byStatus || []).map((s) =>
        h('span.chip', { style: 'cursor:pointer', onclick: () => { view.status = s.status; view.page = 1; refresh(); },
          text: `${module.workflow.find((w) => w.key === s.status)?.label || s.status}: ${s.n}` })));

    mount(tableHost, recordTable(module, data, view, refresh));
  }

  await refresh();
}

function toolbar(module, view, refresh) {
  const search = h('input', {
    type: 'search', placeholder: t('Cari kode atau isi rekaman…'), value: view.q,
    onkeydown: (e) => { if (e.key === 'Enter') { view.q = search.value.trim(); view.page = 1; refresh(); } },
  });

  const statusSelect = h('select', {
    onchange: () => { view.status = statusSelect.value; view.page = 1; refresh(); },
  },
    h('option', { value: '', text: t('Semua status') }),
    ...module.workflow.map((s) => h('option', { value: s.key, text: s.label, selected: view.status === s.key })));

  const bar = h('div.toolbar', {},
    search,
    h('button', { onclick: () => { view.q = search.value.trim(); view.page = 1; refresh(); }, text: t('Cari') }),
    statusSelect);

  for (const org of module.orgFields) {
    const select = h('select', { onchange: () => { view.org[org] = select.value; view.page = 1; refresh(); } },
      h('option', { value: '', text: `${t('Semua')} ${t(ORG_LABEL[org])}` }));
    options(org).then((list) => {
      for (const o of list) select.appendChild(h('option', { value: o.id, text: o.label, selected: String(view.org[org]) === String(o.id) }));
    });
    bar.appendChild(select);
  }

  bar.appendChild(h('button.btn-ghost', {
    onclick: () => {
      Object.assign(view, { q: '', status: '', page: 1, org: {} });
      renderModuleList(document.querySelector('.content'), module);
    },
    text: t('Atur ulang'),
  }));

  return bar;
}

function recordTable(module, data, view, refresh) {
  if (!data.records.length) return emptyState(t('Belum ada rekaman yang sesuai dengan filter.'));

  const fields = module.listFields
    .map((name) => module.fields.find((f) => f.name === name))
    .filter(Boolean);

  const sortableHeader = (label, key) => h('th.sortable', {
    onclick: () => {
      view.dir = view.sort === key && view.dir === 'desc' ? 'asc' : 'desc';
      view.sort = key;
      refresh();
    },
    text: `${label}${view.sort === key ? (view.dir === 'desc' ? ' ↓' : ' ↑') : ''}`,
  });

  const head = h('tr', {},
    sortableHeader(t('Kode'), 'code'),
    ...fields.map((f) => sortableHeader(f.label, f.name)),
    h('th', { text: t('Status') }),
    sortableHeader(t('Diperbarui'), 'updated_at'));

  const body = h('tbody', {}, ...data.records.map((record) =>
    h('tr.clickable', { onclick: () => { location.hash = `#/m/${module.key}/${record.id}`; } },
      h('td.mono.nowrap', { text: record.code }),
      ...fields.map((f) => h('td.cell-truncate', { title: cellValue(f, record[f.name]) },
        f.name.endsWith('risk_level') ? riskPill(record[f.name]) : cellValue(f, record[f.name]))),
      h('td', {}, statusBadge(record.status, module.workflow)),
      h('td.small.nowrap', { text: fmtDate(record.updated_at) }))));

  const pager = h('div.pager', {},
    h('span.muted', { text: `${t('Halaman')} ${data.page} ${t('dari')} ${data.pages} · ${fmtNumber(data.total)} ${t('rekaman')}` }),
    h('button.btn-sm', { disabled: data.page <= 1, onclick: () => { view.page -= 1; refresh(); }, text: t('‹ Sebelumnya') }),
    h('button.btn-sm', { disabled: data.page >= data.pages, onclick: () => { view.page += 1; refresh(); }, text: t('Berikutnya ›') }));

  return h('div', {}, h('div.table-wrap', {}, h('table', {}, h('thead', {}, head), body)), pager);
}

async function downloadCsv(module, view) {
  const query = new URLSearchParams({ sort: view.sort, dir: view.dir });
  if (view.q) query.set('q', view.q);
  if (view.status) query.set('status', view.status);
  for (const [k, v] of Object.entries(view.org)) if (v) query.set(`${k}_id`, v);
  const res = await api.raw(`/api/modules/${module.key}/export?${query}`);
  if (!res.ok) return toast('Ekspor gagal.', 'err');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `${module.key}.csv` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Berkas CSV diunduh.', 'ok');
}

/* ------------------------------------------------------------------ form */

export async function renderRecordForm(container, module, recordId) {
  const editing = recordId !== null;
  if (!can(module.key, editing ? 'edit' : 'create')) {
    return mount(container, h('div.card', {}, h('h2', { text: t('Akses ditolak') }),
      h('p.muted', { text: t('Peran Anda tidak memiliki hak untuk menyimpan rekaman pada modul ini.') })));
  }

  mount(container, spinner());
  const record = editing ? (await api.get(`/api/modules/${module.key}/records/${recordId}`)).record : {};
  const inputs = new Map();
  const errorBox = h('div.alert.err.hidden');

  const form = h('form', { onsubmit: (e) => { e.preventDefault(); save(); } });

  // Organisational placement first - it determines who else can see the record.
  if (module.orgFields.length) {
    form.appendChild(h('div.fieldset-title', { text: t('Penempatan Organisasi') }));
    const grid = h('div.grid.cols-3');
    for (const org of module.orgFields) {
      const select = h('select', { name: `${org}_id` });
      select.appendChild(h('option', { value: '', text: `— ${t('pilih')} ${t(ORG_LABEL[org])} —` }));
      options(org).then((list) => {
        for (const o of list) {
          select.appendChild(h('option', { value: o.id, text: o.label }));
        }
        const current = record[`${org}_id`] ?? state.user[`${org}_id`];
        if (current) select.value = String(current);
      });
      inputs.set(`${org}_id`, { field: { name: `${org}_id`, type: 'number' }, el: select });
      grid.appendChild(h('div.field', { class: module.orgRequired.includes(org) ? 'required' : '' },
        h('label', { text: t(ORG_LABEL[org]) }), select));
    }
    form.appendChild(grid);
  }

  const groups = new Map();
  for (const field of module.fields) {
    const key = field.group || 'Isian Utama';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(field);
  }

  for (const [groupName, fields] of groups) {
    form.appendChild(h('div.fieldset-title', { text: groupName }));
    const grid = h('div.grid.cols-2');
    for (const field of fields) {
      const wide = ['textarea', 'multiselect'].includes(field.type);
      const control = buildControl(field, record[field.name]);
      inputs.set(field.name, { field, el: control });
      grid.appendChild(h('div.field', {
        class: `${field.required ? 'required' : ''}`,
        style: wide ? 'grid-column:1/-1' : '',
      },
        h('label', { text: field.label }),
        control,
        field.help ? h('div.help', { text: field.help }) : null,
        field.computed ? h('div.help', { text: t('Dihitung otomatis oleh sistem.') }) : null));
    }
    form.appendChild(grid);
  }

  const submit = h('button.btn-primary', { type: 'submit', text: editing ? 'Simpan Perubahan' : 'Simpan Rekaman' });
  form.appendChild(h('div', { style: 'display:flex;gap:.5rem;margin-top:1rem' },
    submit,
    h('a.btn', { href: editing ? `#/m/${module.key}/${recordId}` : `#/m/${module.key}`, text: t('Batal') })));

  mount(container,
    h('div.page-head', {},
      h('div.grow', {},
        h('h1', {}, h('span', { text: module.icon }), editing ? `Ubah ${record.code}` : `${t('Rekaman Baru')} — ${module.nameId}`),
        h('div.small.muted', { text: editing ? 'Perubahan tercatat dalam jejak audit.' : 'Kode rekaman diterbitkan otomatis setelah disimpan.' }))),
    h('div.card', {}, errorBox, form));

  async function save() {
    submit.disabled = true;
    submit.textContent = 'Menyimpan…';
    errorBox.classList.add('hidden');
    const payload = {};
    for (const [name, { field, el }] of inputs) payload[name] = readControl(field, el);

    try {
      const result = editing
        ? await api.put(`/api/modules/${module.key}/records/${recordId}`, payload)
        : await api.post(`/api/modules/${module.key}/records`, payload);
      if (module.master) invalidateOptions(module.key);
      toast(editing ? 'Perubahan tersimpan.' : `Rekaman ${result.record.code} dibuat.`, 'ok');
      location.hash = `#/m/${module.key}/${result.record.id}`;
    } catch (err) {
      errorBox.textContent = [err.message, ...(err.details || [])].join(' ');
      errorBox.classList.remove('hidden');
      errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      submit.disabled = false;
      submit.textContent = editing ? 'Simpan Perubahan' : 'Simpan Rekaman';
    }
  }
}

function buildControl(field, value) {
  const readonly = !!field.computed || !!field.readonly;

  if (field.type === 'select') {
    const select = h('select', { disabled: readonly });
    select.appendChild(h('option', { value: '', text: t('— pilih —') }));
    for (const o of field.options || []) {
      select.appendChild(h('option', { value: optValue(o), text: optLabel(o), selected: value === optValue(o) }));
    }
    return select;
  }

  if (field.type === 'multiselect') {
    const chosen = new Set(Array.isArray(value) ? value : []);
    return h('div.multi', {}, ...(field.options || []).map((o) =>
      h('label', {}, h('input', { type: 'checkbox', value: optValue(o), checked: chosen.has(optValue(o)) }), optLabel(o))));
  }

  if (field.type === 'bool') {
    return h('div.checkbox', {}, h('input', { type: 'checkbox', checked: !!value, disabled: readonly }), h('span.small.muted', { text: t('Ya bila dicentang') }));
  }

  if (field.type === 'textarea') {
    return h('textarea', { readonly: readonly, text: value ?? '' });
  }

  if (field.type in REF_TYPES) {
    const select = h('select', {});
    select.appendChild(h('option', { value: '', text: t('— pilih —') }));
    options(REF_TYPES[field.type]).then((list) => {
      for (const o of list) select.appendChild(h('option', { value: o.id, text: o.label }));
      if (value) select.value = String(value);
    });
    return select;
  }

  if (field.type === 'user') {
    const input = h('input', { list: 'user-options', value: value ?? '', placeholder: t('Nama pengguna atau nama lengkap') });
    ensureUserDatalist();
    return input;
  }

  const type = { number: 'number', currency: 'number', date: 'date', datetime: 'datetime-local', time: 'time' }[field.type] || 'text';
  return h('input', {
    type,
    value: value ?? (field.default ?? ''),
    readonly: readonly,
    step: field.step ?? (field.type === 'currency' ? 1 : undefined),
    min: field.min,
    max: field.max,
    placeholder: field.placeholder,
  });
}

function readControl(field, el) {
  if (field.type === 'multiselect') {
    return [...el.querySelectorAll('input:checked')].map((i) => i.value);
  }
  if (field.type === 'bool') return el.querySelector('input').checked;
  const raw = el.value;
  if (raw === '') return null;
  if (field.type === 'number' || field.type === 'currency') return Number(raw);
  return raw;
}

let datalistReady = false;
function ensureUserDatalist() {
  if (datalistReady) return;
  datalistReady = true;
  const list = h('datalist', { id: 'user-options' });
  document.body.appendChild(list);
  userList().then((users) => {
    for (const u of users) list.appendChild(h('option', { value: u.full_name, label: `${u.username} — ${u.role_name}` }));
  });
}

/* ---------------------------------------------------------------- detail */

export async function renderRecordDetail(container, module, recordId) {
  mount(container, spinner());
  const data = await api.get(`/api/modules/${module.key}/records/${recordId}`);
  const record = data.record;

  const workflowStrip = h('div.workflow', {}, ...module.workflow.map((s, i) => {
    const currentIndex = module.workflow.findIndex((w) => w.key === record.status);
    const cls = s.key === record.status ? 'current' : i < currentIndex ? 'done' : '';
    return h('span.step', { class: cls, text: s.label });
  }));

  const actions = h('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap' });
  if (can(module.key, 'edit')) actions.appendChild(h('a.btn', { href: `#/m/${module.key}/${recordId}/edit`, text: t('✎ Ubah') }));

  const transitions = module.workflow.filter((s) => s.key !== record.status && can(module.key, s.requires));
  if (transitions.length) {
    const select = h('select', { style: 'min-width:170px' },
      h('option', { value: '', text: t('Ubah status ke…') }),
      ...transitions.map((s) => h('option', { value: s.key, text: s.label })));
    select.addEventListener('change', () => {
      if (!select.value) return;
      const target = transitions.find((t) => t.key === select.value);
      const note = h('textarea', { placeholder: t('Catatan (opsional) — akan tersimpan sebagai komentar.') });
      modal({
        title: `${t('Ubah status menjadi')} "${target.label}"`,
        body: h('div', {}, h('div.field', {}, h('label', { text: t('Catatan') }), note)),
        actions: [{
          label: t('Terapkan'),
          class: 'btn-primary',
          onClick: async (close) => {
            try {
              await api.post(`/api/modules/${module.key}/records/${recordId}/status`, { status: target.key, note: note.value.trim() || undefined });
              close();
              toast(`Status diubah menjadi ${target.label}.`, 'ok');
              renderRecordDetail(container, module, recordId);
            } catch (err) { toast(err.message, 'err'); }
          },
        }],
        onClose: () => { select.value = ''; },
      });
    });
    actions.appendChild(select);
  }

  if (module.capa && can('capa', 'create') && module.key !== 'capa') {
    actions.appendChild(h('button', { onclick: () => capaDialog(module, record), text: t('⚙ Buat CAPA') }));
  }
  if (can(module.key, 'delete')) {
    actions.appendChild(h('button.btn-danger', {
      onclick: () => confirmDialog('Hapus rekaman ini? Rekaman akan diarsipkan dan tidak tampil lagi pada daftar.', async () => {
        await api.del(`/api/modules/${module.key}/records/${recordId}`);
        toast('Rekaman dihapus.', 'ok');
        location.hash = `#/m/${module.key}`;
      }),
      text: t('🗑 Hapus'),
    }));
  }
  actions.appendChild(h('a.btn.btn-ghost', { href: `#/m/${module.key}`, text: t('← Daftar') }));

  // Grouped read-only field grid.
  const groups = new Map();
  for (const field of module.fields) {
    const key = field.group || 'Rincian';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(field);
  }
  const detailBody = h('div');
  for (const [groupName, fields] of groups) {
    detailBody.appendChild(h('div.fieldset-title', { text: groupName }));
    detailBody.appendChild(h('div.detail-grid', {}, ...fields.map((f) =>
      h('div.dl-item', {}, h('dt', { text: f.label }), h('dd', {}, displayValue(f, record[f.name], record))))));
  }

  const orgRow = h('div.detail-grid', {}, ...['region', 'branch', 'port', 'vessel']
    .filter((org) => record[`${org}_id`])
    .map((org) => {
      const dd = h('dd', { text: '…' });
      refLabel(org, record[`${org}_id`]).then((label) => { dd.textContent = label; });
      return h('div.dl-item', {}, h('dt', { text: t(ORG_LABEL[org]) }), dd);
    }));

  mount(container,
    h('div.page-head', {},
      h('div.grow', {},
        h('h1', {}, h('span', { text: module.icon }), record[module.labelField] || record.code),
        h('div.small.muted', {}, h('span.mono', { text: record.code }), ' · ', module.nameId, ' · dibuat ', fmtDateTime(record.created_at)),
        h('div', { style: 'margin-top:.4rem' }, statusBadge(record.status, module.workflow))),
      actions),
    h('div.card', {}, h('h3', { text: t('Alur Status') }), workflowStrip),
    h('div.card', {}, h('h3', { text: t('Rincian Rekaman') }), orgRow, detailBody),
    h('div.grid.cols-2', {},
      linkedCard(module, data.linked),
      attachmentsCard(module, recordId, data.attachments, container)),
    h('div.grid.cols-2', {},
      commentsCard(module, recordId, data.comments, container),
      historyCard(data.history)));
}

function linkedCard(module, linked) {
  const card = h('div.card', {}, h('h3', { text: t('🔗 Tindakan Korektif Terkait') }));
  if (!linked?.length) card.appendChild(h('p.muted.small', { text: t('Belum ada CAPA yang dibuat dari rekaman ini.') }));
  else {
    card.appendChild(h('div.table-wrap', {}, h('table', {},
      h('thead', {}, h('tr', {}, h('th', { text: t('Kode') }), h('th', { text: t('Judul') }), h('th', { text: t('Status') }))),
      h('tbody', {}, ...linked.map((l) => h('tr.clickable', { onclick: () => { location.hash = `#/m/capa/${l.id}`; } },
        h('td.mono', { text: l.code }), h('td', { text: l.title }),
        h('td', {}, statusBadge(l.status, mod('capa').workflow))))))));
  }
  return card;
}

function capaDialog(module, record) {
  const title = h('input', { value: `Tindakan korektif untuk ${record.code}` });
  const plan = h('textarea', { placeholder: t('Uraikan rencana tindakan…') });
  const due = h('input', { type: 'date' });
  modal({
    title: t('Buat Tindakan Korektif (CAPA)'),
    body: h('div', {},
      h('p.small.muted', { text: t('CAPA akan tertaut otomatis ke rekaman ini beserta penempatan organisasinya.') }),
      h('div.field.required', {}, h('label', { text: t('Judul') }), title),
      h('div.field', {}, h('label', { text: t('Rencana tindakan') }), plan),
      h('div.field', {}, h('label', { text: t('Target selesai') }), due)),
    actions: [{
      label: t('Buat CAPA'),
      class: 'btn-primary',
      onClick: async (close) => {
        try {
          const result = await api.post(`/api/modules/${module.key}/records/${record.id}/capa`, {
            title: title.value.trim(),
            action_plan: plan.value.trim() || undefined,
            due_date: due.value || undefined,
          });
          close();
          toast(`CAPA ${result.record.code} dibuat.`, 'ok');
          location.hash = `#/m/capa/${result.record.id}`;
        } catch (err) { toast([err.message, ...(err.details || [])].join(' '), 'err'); }
      },
    }],
  });
}

function commentsCard(module, recordId, comments, container) {
  const input = h('textarea', { placeholder: t('Tambahkan catatan tindak lanjut…') });
  const list = h('ul.timeline', {}, ...(comments || []).map((c) =>
    h('li', {},
      h('div.small.muted', { text: `${c.username} · ${fmtDateTime(c.created_at)}` }),
      h('div', { style: 'white-space:pre-wrap', text: c.body }))));

  return h('div.card', {},
    h('h3', { text: t('💬 Catatan & Tindak Lanjut') }),
    comments?.length ? list : h('p.muted.small', { text: t('Belum ada catatan.') }),
    h('div.field', { style: 'margin-top:.7rem' }, input),
    h('button', {
      onclick: async () => {
        const body = input.value.trim();
        if (!body) return;
        await api.post(`/api/modules/${module.key}/records/${recordId}/comments`, { body });
        toast('Catatan ditambahkan.', 'ok');
        renderRecordDetail(container, module, recordId);
      },
      text: t('Kirim Catatan'),
    }));
}

function attachmentsCard(module, recordId, attachments, container) {
  const card = h('div.card', {}, h('h3', { text: t('📎 Lampiran Bukti') }));

  if (attachments?.length) {
    card.appendChild(h('div.table-wrap', {}, h('table', {},
      h('thead', {}, h('tr', {}, h('th', { text: t('Berkas') }), h('th', { text: t('Ukuran') }), h('th', { text: t('Diunggah') }), h('th', { text: '' }))),
      h('tbody', {}, ...attachments.map((a) => h('tr', {},
        h('td', {}, h('a', { href: `/api/attachments/${a.id}`, text: a.filename })),
        h('td.small', { text: `${Math.max(1, Math.round(a.size / 1024))} KB` }),
        h('td.small', { text: fmtDate(a.uploaded_at) }),
        h('td', {}, can(module.key, 'edit')
          ? h('button.btn-sm.btn-ghost', {
            onclick: async () => {
              await api.del(`/api/attachments/${a.id}`);
              renderRecordDetail(container, module, recordId);
            },
            text: '✕',
          })
          : null)))))));
  } else {
    card.appendChild(h('p.muted.small', { text: t('Belum ada lampiran.') }));
  }

  if (can(module.key, 'edit')) {
    const file = h('input', { type: 'file' });
    file.addEventListener('change', async () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      if (chosen.size > 5 * 1024 * 1024) return toast('Ukuran berkas melebihi 5 MB.', 'err');
      const buffer = await chosen.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      try {
        await api.post(`/api/modules/${module.key}/records/${recordId}/attachments`, {
          filename: chosen.name, mime: chosen.type, dataBase64: base64,
        });
        toast('Lampiran diunggah.', 'ok');
        renderRecordDetail(container, module, recordId);
      } catch (err) { toast(err.message, 'err'); }
    });
    card.appendChild(h('div.field', { style: 'margin-top:.7rem' }, h('label', { text: t('Unggah berkas (maks. 5 MB)') }), file));
  }

  return card;
}

function historyCard(history) {
  return h('div.card', {},
    h('h3', { text: t('🕘 Jejak Audit') }),
    history?.length
      ? h('ul.timeline', {}, ...history.map((entry) =>
        h('li', {},
          h('div.small.muted', { text: `${entry.username || t('sistem')} · ${fmtDateTime(entry.ts)}` }),
          h('div', { text: `${entry.action}${entry.detail ? ` — ${entry.detail}` : ''}` }))))
      : h('p.muted.small', { text: t('Belum ada aktivitas tercatat.') }));
}
