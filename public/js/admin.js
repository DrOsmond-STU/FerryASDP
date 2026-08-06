/** Administration screens: users, role permission matrix, audit trail, system. */
import { api, state, invalidateUsers, userList } from './api.js';
import { h, mount, toast, modal, spinner, emptyState, fmtDateTime, fmtDate, fmtNumber, initials } from './ui.js';

export const ADMIN_PAGES = [
  { key: 'users', name: 'Manajemen Pengguna', icon: '👥', level: 2, render: usersPage },
  { key: 'permissions', name: 'Hak Akses Peran', icon: '🔐', level: 2, render: permissionsPage },
  { key: 'audit-log', name: 'Jejak Audit Sistem', icon: '🧾', level: 3, render: auditLogPage },
  { key: 'system', name: 'Informasi Sistem', icon: '🖥', level: 2, render: systemPage },
];

export async function renderAdmin(container, page, params) {
  if (state.user.level > page.level) {
    return mount(container, h('div.card', {}, h('h2', { text: 'Akses ditolak' }),
      h('p.muted', { text: 'Halaman administrasi ini hanya untuk peran dengan level lebih tinggi.' })));
  }
  mount(container, spinner());
  await page.render(container, params);
}

const head = (title, subtitle, ...actions) => h('div.page-head', {},
  h('div.grow', {}, h('h1', { text: title }), h('div.small.muted', { text: subtitle })),
  h('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap' }, ...actions));

const isAdmin = () => state.user.level === 1;

/* ------------------------------------------------------------------ users */

async function usersPage(container) {
  const { users } = await api.get('/api/admin/users');
  const { roles } = await api.get('/api/admin/roles');

  const table = h('div.table-wrap', {}, h('table', {},
    h('thead', {}, h('tr', {},
      h('th', { text: 'Pengguna' }), h('th', { text: 'Peran' }), h('th', { text: 'Level' }),
      h('th', { text: 'Cakupan' }), h('th', { text: 'Terakhir Masuk' }), h('th', { text: 'Status' }), h('th', { text: '' }))),
    h('tbody', {}, ...users.map((u) => h('tr', {},
      h('td', {}, h('div', { style: 'display:flex;align-items:center;gap:.5rem' },
        h('div.avatar', { text: initials(u.full_name) }),
        h('div', {}, h('strong', { text: u.full_name }), h('div.small.muted', { text: `${u.username} · ${u.position || '—'}` })))),
      h('td.small', { text: u.role_name }),
      h('td', {}, h('span.badge', { text: `L${u.level}` })),
      h('td.small', { text: u.scope_type }),
      h('td.small', { text: u.last_login ? fmtDateTime(u.last_login) : 'belum pernah' }),
      h('td', {}, h('span.badge', { class: u.active ? 'b-ok' : 'b-danger', text: u.active ? 'Aktif' : 'Nonaktif' })),
      h('td', {}, isAdmin()
        ? h('button.btn-sm', { onclick: () => userDialog(container, roles, u), text: 'Kelola' })
        : null))))));

  mount(container,
    head('Manajemen Pengguna', `${users.length} akun terdaftar pada ${roles.length} peran.`,
      isAdmin() ? h('button.btn-primary', { onclick: () => userDialog(container, roles, null), text: '+ Pengguna Baru' }) : null),
    h('div.card', {},
      h('h3', { text: 'Hirarki Peran' }),
      h('div.chips', {}, ...roles.map((r) => h('span.chip', { title: r.description, text: `L${r.level} ${r.name} (${r.users})` })))),
    table);
}

async function userDialog(container, roles, existing) {
  const editing = !!existing;
  const field = (label, el, required) => h('div.field', { class: required ? 'required' : '' }, h('label', { text: label }), el);

  const username = h('input', { value: existing?.username || '', readonly: editing });
  const fullName = h('input', { value: existing?.full_name || '' });
  const email = h('input', { type: 'email', value: existing?.email || '' });
  const position = h('input', { value: existing?.position || '' });
  const password = h('input', { type: 'password', placeholder: editing ? 'Kosongkan bila tidak diubah' : '' });
  const role = h('select', {}, ...roles.map((r) => h('option', { value: r.key, text: `L${r.level} — ${r.name}`, selected: existing?.role_key === r.key })));
  const active = h('input', { type: 'checkbox', checked: existing ? !!existing.active : true });

  const scopeSelects = {};
  const scopeGrid = h('div.grid.cols-2');
  for (const [key, label] of [['region', 'Regional'], ['branch', 'Cabang'], ['port', 'Pelabuhan'], ['vessel', 'Kapal'], ['contractor', 'Kontraktor']]) {
    const select = h('select', {}, h('option', { value: '', text: '— tidak dibatasi —' }));
    scopeSelects[key] = select;
    api.get(`/api/modules/${key}/options`).then(({ options }) => {
      for (const o of options) select.appendChild(h('option', { value: o.id, text: o.label }));
      if (existing?.[`${key}_id`]) select.value = String(existing[`${key}_id`]);
    }).catch(() => {});
    scopeGrid.appendChild(field(label, select));
  }

  const error = h('div.alert.err.hidden');

  modal({
    title: editing ? `Kelola Pengguna — ${existing.full_name}` : 'Pengguna Baru',
    body: h('div', {},
      error,
      h('div.grid.cols-2', {},
        field('Nama pengguna', username, !editing),
        field('Nama lengkap', fullName, true),
        field('Surel', email),
        field('Jabatan', position),
        field('Peran', role, true),
        field(editing ? 'Kata sandi baru' : 'Kata sandi awal', password, !editing)),
      h('div.fieldset-title', { text: 'Cakupan Akses (Row-Level Security)' }),
      h('p.small.muted', { text: 'Batasi rekaman yang dapat dilihat sesuai penempatan. Kosongkan bila peran sudah bersifat nasional.' }),
      scopeGrid,
      h('div.checkbox', { style: 'margin-top:.6rem' }, active, h('span', { text: 'Akun aktif' }))),
    actions: [
      editing ? {
        label: 'Buka kunci akun',
        onClick: async () => {
          await api.post(`/api/admin/users/${existing.id}/unlock`);
          toast('Kunci akun dilepas.', 'ok');
        },
      } : null,
      {
        label: 'Simpan',
        class: 'btn-primary',
        onClick: async (close) => {
          const payload = {
            username: username.value.trim(),
            full_name: fullName.value.trim(),
            email: email.value.trim() || null,
            position: position.value.trim() || null,
            role_key: role.value,
            active: active.checked,
          };
          for (const [key, select] of Object.entries(scopeSelects)) payload[`${key}_id`] = select.value ? Number(select.value) : null;
          if (password.value) payload.password = password.value;
          try {
            if (editing) await api.put(`/api/admin/users/${existing.id}`, payload);
            else await api.post('/api/admin/users', payload);
            invalidateUsers();
            close();
            toast(editing ? 'Pengguna diperbarui.' : 'Pengguna dibuat.', 'ok');
            usersPage(container);
          } catch (err) {
            error.textContent = err.message;
            error.classList.remove('hidden');
          }
        },
      },
    ].filter(Boolean),
  });
}

/* ------------------------------------------------------------ permissions */

async function permissionsPage(container) {
  const { roles } = await api.get('/api/admin/roles');
  let currentRole = roles.find((r) => r.key !== 'sysadmin')?.key || roles[0].key;

  const host = h('div');
  const selector = h('select', { onchange: () => { currentRole = selector.value; load(); } },
    ...roles.map((r) => h('option', { value: r.key, text: `L${r.level} — ${r.name}` })));
  selector.value = currentRole;

  mount(container,
    head('Hak Akses Peran', 'Matriks kewenangan per modul: lihat, buat, ubah, setujui, hapus.'),
    h('div.card', {}, h('div.toolbar', {}, h('label', { text: 'Peran' }), selector,
      isAdmin() ? h('button.btn-ghost', {
        onclick: async () => {
          await api.post(`/api/admin/permissions/${currentRole}/reset`);
          toast('Hak akses dikembalikan ke bawaan sistem.', 'ok');
          load();
        },
        text: '↺ Kembalikan ke bawaan',
      }) : null)),
    host);

  async function load() {
    mount(host, spinner());
    const { role, permissions } = await api.get(`/api/admin/permissions/${currentRole}`);
    const locked = role.key === 'sysadmin' || !isAdmin();
    const changed = new Map();

    const rows = permissions.map((p) => {
      const boxes = ['view', 'create', 'edit', 'approve', 'delete'].map((action) =>
        h('td.right', {}, h('input', {
          type: 'checkbox', checked: p[action], disabled: locked,
          onchange: (e) => {
            const entry = changed.get(p.module) || { module: p.module, view: p.view, create: p.create, edit: p.edit, approve: p.approve, delete: p.delete };
            entry[action] = e.target.checked;
            changed.set(p.module, entry);
          },
        })));
      return h('tr', {},
        h('td', {}, h('strong.small', { text: p.name }), h('div.small.muted', { text: `${p.groupCode} · ${p.module}` })),
        ...boxes);
    });

    mount(host,
      h('div.card', {},
        h('h3', {}, `${role.name} — Level ${role.level}`),
        h('p.small.muted', { text: role.description }),
        locked ? h('div.alert.info', { text: role.key === 'sysadmin' ? 'Hak akses administrator sistem bersifat tetap dan tidak dapat diubah.' : 'Hanya administrator sistem yang dapat mengubah matriks ini.' }) : null,
        h('div.table-wrap', {}, h('table.perm-matrix', {},
          h('thead', {}, h('tr', {},
            h('th', { text: 'Modul' }), h('th.right', { text: 'Lihat' }), h('th.right', { text: 'Buat' }),
            h('th.right', { text: 'Ubah' }), h('th.right', { text: 'Setujui' }), h('th.right', { text: 'Hapus' }))),
          h('tbody', {}, ...rows))),
        locked ? null : h('div', { style: 'margin-top:.8rem' },
          h('button.btn-primary', {
            onclick: async () => {
              if (!changed.size) return toast('Tidak ada perubahan.', '');
              await api.put(`/api/admin/permissions/${currentRole}`, { permissions: [...changed.values()] });
              toast(`${changed.size} modul diperbarui. Pengguna terkait perlu memuat ulang halaman.`, 'ok');
              load();
            },
            text: 'Simpan Perubahan',
          }))));
  }

  await load();
}

/* -------------------------------------------------------------- audit log */

async function auditLogPage(container) {
  const filters = { action: '', username: '', module: '', page: 1 };
  const host = h('div');

  const actionInput = h('input', { placeholder: 'mis. login, create, status' });
  const userInput = h('input', { placeholder: 'nama pengguna' });

  mount(container,
    head('Jejak Audit Sistem', 'Rekaman aktivitas untuk pemenuhan ISO 27001 A.8.15 dan penelusuran perubahan data.'),
    h('div.card', {}, h('div.toolbar', {},
      actionInput, userInput,
      h('button', {
        onclick: () => { filters.action = actionInput.value.trim(); filters.username = userInput.value.trim(); filters.page = 1; load(); },
        text: 'Terapkan',
      }))),
    host);

  async function load() {
    mount(host, spinner());
    const query = new URLSearchParams({ page: filters.page, size: 100 });
    if (filters.action) query.set('action', filters.action);
    if (filters.username) query.set('username', filters.username);
    const data = await api.get(`/api/admin/audit-log?${query}`);

    mount(host, h('div.card', {},
      h('h3', { text: `${fmtNumber(data.total)} entri` }),
      data.entries.length
        ? h('div.table-wrap', {}, h('table', {},
          h('thead', {}, h('tr', {},
            h('th', { text: 'Waktu' }), h('th', { text: 'Pengguna' }), h('th', { text: 'Aksi' }),
            h('th', { text: 'Modul' }), h('th', { text: 'Rekaman' }), h('th', { text: 'Rincian' }), h('th', { text: 'IP' }))),
          h('tbody', {}, ...data.entries.map((e) => h('tr', {},
            h('td.small.nowrap', { text: fmtDateTime(e.ts) }),
            h('td.small', { text: e.username || '—' }),
            h('td', {}, h('span.badge', { class: e.action.includes('failed') || e.action === 'delete' ? 'b-danger' : 'b-draft', text: e.action })),
            h('td.small', { text: e.module_key || '—' }),
            h('td.small.mono', { text: e.record_code || '—' }),
            h('td.small.cell-truncate', { title: e.detail || '', text: e.detail || '—' }),
            h('td.small.muted', { text: e.ip || '—' }))))))
        : emptyState('Tidak ada entri yang cocok.'),
      h('div.pager', {},
        h('span.muted', { text: `Halaman ${data.page}` }),
        h('button.btn-sm', { disabled: data.page <= 1, onclick: () => { filters.page -= 1; load(); }, text: '‹' }),
        h('button.btn-sm', { disabled: data.page * data.size >= data.total, onclick: () => { filters.page += 1; load(); }, text: '›' }))));
  }

  await load();
}

/* ----------------------------------------------------------------- system */

async function systemPage(container) {
  const info = await api.get('/api/admin/system');
  const byGroup = new Map();
  for (const m of info.byModule) {
    if (!byGroup.has(m.group)) byGroup.set(m.group, []);
    byGroup.get(m.group).push(m);
  }

  mount(container,
    head('Informasi Sistem', 'Ringkasan konfigurasi dan volume data platform.'),
    h('div.grid.cols-4', {},
      h('div.stat', {}, h('div.label', { text: 'Modul Terpasang' }), h('div.value', { text: String(info.modules) })),
      h('div.stat', {}, h('div.label', { text: 'Total Rekaman' }), h('div.value', { text: fmtNumber(info.records) })),
      h('div.stat', {}, h('div.label', { text: 'Pengguna Aktif' }), h('div.value', { text: String(info.users) })),
      h('div.stat', {}, h('div.label', { text: 'Entri Jejak Audit' }), h('div.value', { text: fmtNumber(info.auditEntries) })),
      h('div.stat', {}, h('div.label', { text: 'Sesi Aktif' }), h('div.value', { text: String(info.sessions) })),
      h('div.stat', {}, h('div.label', { text: 'Runtime' }), h('div.value', { text: info.node }), h('div.sub', { text: `uptime ${Math.round(info.uptimeSeconds / 60)} menit` }))),
    h('div.card', { style: 'margin-top:1rem' },
      h('h3', { text: 'Volume Rekaman per Modul' }),
      h('div.table-wrap', {}, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'Kelompok' }), h('th', { text: 'Modul' }), h('th', { text: 'Kunci' }), h('th.right', { text: 'Rekaman' }))),
        h('tbody', {}, ...info.byModule.map((m) => h('tr.clickable', { onclick: () => { location.hash = `#/m/${m.key}`; } },
          h('td.small.muted', { text: m.group }), h('td', { text: m.name }),
          h('td.small.mono', { text: m.key }), h('td.right', { text: fmtNumber(m.records) }))))))));
}
