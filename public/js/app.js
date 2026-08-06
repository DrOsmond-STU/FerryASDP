/**
 * Application shell: authentication, layout, navigation and the hash router.
 */
import { api, state, loadMeta, can, mod } from './api.js';
import { h, mount, clear, toast, initials, modal } from './ui.js';
import { renderModuleList, renderRecordForm, renderRecordDetail } from './module.js';
import { renderDashboard, DASHBOARDS } from './dashboards.js';
import { renderAdmin, ADMIN_PAGES } from './admin.js';

const root = document.getElementById('app');

/* ------------------------------------------------------------------ login */

function renderLogin(message) {
  document.title = 'Masuk — QHSE ASDP';
  const error = h('div.alert.err', { class: message ? '' : 'hidden', text: message || '' });
  const username = h('input', { name: 'username', autocomplete: 'username', required: true, placeholder: 'mis. corporate.qhse' });
  const password = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button.btn-primary', { type: 'submit', style: 'width:100%;justify-content:center', text: 'Masuk' });

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Memeriksa…';
      try {
        await api.post('/api/auth/login', { username: username.value.trim(), password: password.value });
        await start();
      } catch (err) {
        error.textContent = err.message;
        error.classList.remove('hidden');
        submit.disabled = false;
        submit.textContent = 'Masuk';
      }
    },
  },
    error,
    h('div.field.required', {}, h('label', { for: 'username', text: 'Nama Pengguna' }), username),
    h('div.field.required', {}, h('label', { for: 'password', text: 'Kata Sandi' }), password),
    submit);

  mount(root,
    h('div.login-wrap', {},
      h('div.login-card', {},
        h('div.login-brand', {},
          h('div.mark', { text: '⚓' }),
          h('div', {},
            h('strong', { text: 'QHSE ASDP' }),
            h('span.small.muted', { text: 'Enterprise Integrated QHSE Management System' }))),
        h('p.small.muted', { text: 'PT ASDP Indonesia Ferry (Persero) — mutu, kesehatan, keselamatan kerja, lingkungan, keselamatan pelayaran dan keamanan dalam satu platform.' }),
        form,
        h('div.login-hint', {},
          h('div', { text: 'Akun demo: admin · corporate.qhse · regional.qhse · port.manager · nakhoda · dept.head · supervisor · operator · kontraktor · auditor' }),
          h('div', { style: 'margin-top:.3rem', text: 'Kata sandi awal disediakan oleh administrator sistem (lihat README).' })))));
  username.focus();
}

/* ----------------------------------------------------------------- layout */

function navigation() {
  const nav = h('nav.nav');
  const search = h('input', {
    type: 'search', placeholder: 'Cari modul…', 'aria-label': 'Cari modul',
    oninput: () => filter(search.value.trim().toLowerCase()),
  });

  const dashGroup = h('details.nav-group', { open: true },
    h('summary', {}, h('span', { text: '▾' }), 'Dashboard'),
    ...DASHBOARDS.filter((d) => !d.requires || can(d.requires, 'view'))
      .map((d) => link(`#/dashboard/${d.key}`, d.icon, d.name)));
  nav.appendChild(dashGroup);

  for (const group of state.groups) {
    const modules = group.modules.map(mod).filter((m) => m && can(m.key, 'view'));
    if (!modules.length) continue;
    const details = h('details.nav-group', { open: group.code === 'E' },
      h('summary', {}, h('span', { text: '▾' }), `${group.code}. ${group.name}`),
      ...modules.map((m) => link(`#/m/${m.key}`, m.icon, m.nameId)));
    nav.appendChild(details);
  }

  if (state.user.level <= 3) {
    nav.appendChild(h('details.nav-group', {},
      h('summary', {}, h('span', { text: '▾' }), 'Administrasi'),
      ...ADMIN_PAGES.filter((p) => state.user.level <= p.level)
        .map((p) => link(`#/admin/${p.key}`, p.icon, p.name))));
  }

  function link(href, icon, label) {
    return h('a', { href, dataset: { label: label.toLowerCase() } },
      h('span.ic', { text: icon || '•' }), h('span', { text: label }));
  }

  function filter(query) {
    for (const details of nav.querySelectorAll('.nav-group')) {
      let visible = 0;
      for (const a of details.querySelectorAll('a')) {
        const match = !query || a.dataset.label.includes(query);
        a.classList.toggle('hidden', !match);
        if (match) visible += 1;
      }
      details.classList.toggle('hidden', visible === 0);
      if (query && visible) details.open = true;
    }
  }

  return { nav, search };
}

function userMenu() {
  const u = state.user;
  return h('div.userchip', {
    onclick: () => modal({
      title: 'Akun & Sesi',
      body: h('div', {},
        h('div.detail-grid', {},
          info('Nama', u.full_name),
          info('Nama pengguna', u.username),
          info('Jabatan', u.position || '—'),
          info('Peran', `${u.role_name} (Level ${u.level})`),
          info('Cakupan akses', scopeLabel(u.scope_type)),
          info('Surel', u.email || '—')),
        h('div', { style: 'margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap' },
          h('button', { onclick: passwordDialog, text: 'Ubah kata sandi' }),
          h('button', { onclick: toggleTheme, text: 'Ganti tema terang/gelap' }),
          h('button.btn-danger', { onclick: logout, text: 'Keluar' }))),
    }),
  },
    h('div.avatar', { text: initials(u.full_name) }),
    h('div', {}, h('strong.small', { text: u.full_name }), h('small', { text: u.role_name })));
}

const info = (label, value) => h('div.dl-item', {}, h('dt', { text: label }), h('dd', { text: value ?? '—' }));

const scopeLabel = (scope) => ({
  global: 'Nasional (seluruh unit)',
  region: 'Regional',
  branch: 'Cabang',
  port: 'Pelabuhan',
  vessel: 'Kapal',
  own: 'Rekaman milik sendiri',
}[scope] || scope);

function toggleTheme() {
  const current = document.documentElement.dataset.theme
    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('qhse-theme', next);
}

function passwordDialog() {
  const current = h('input', { type: 'password', autocomplete: 'current-password' });
  const next = h('input', { type: 'password', autocomplete: 'new-password' });
  const error = h('div.alert.err.hidden');
  modal({
    title: 'Ubah Kata Sandi',
    body: h('div', {},
      error,
      h('div.field.required', {}, h('label', { text: 'Kata sandi saat ini' }), current),
      h('div.field.required', {}, h('label', { text: 'Kata sandi baru' }), next,
        h('div.help', { text: 'Minimal 10 karakter, mengandung huruf besar, huruf kecil dan angka.' }))),
    actions: [{
      label: 'Simpan',
      class: 'btn-primary',
      onClick: async (close) => {
        try {
          await api.post('/api/auth/password', { currentPassword: current.value, newPassword: next.value });
          close();
          toast('Kata sandi diperbarui. Silakan masuk kembali.', 'ok');
          renderLogin();
        } catch (err) {
          error.textContent = err.message;
          error.classList.remove('hidden');
        }
      },
    }],
  });
}

async function logout() {
  await api.post('/api/auth/logout').catch(() => {});
  clear(document.getElementById('modal-root'));
  state.user = null;
  location.hash = '';
  renderLogin();
}

function renderShell() {
  const { nav, search } = navigation();
  const sidebar = h('aside.sidebar', {},
    h('div.sidebar-brand', {},
      h('div.mark', { text: '⚓' }),
      h('div', {},
        h('b', { text: 'QHSE ASDP' }),
        h('span', { text: `${state.meta.app.moduleCount} modul terintegrasi` }))),
    h('div.nav-search', {}, search),
    nav);

  const crumb = h('div.crumb');
  const content = h('main.content', {}, h('div.empty', { text: 'Memuat…' }));

  mount(root,
    h('div.layout', {},
      sidebar,
      h('div.main', {},
        h('header.topbar', {},
          h('button.menu-toggle.btn-ghost', { onclick: () => sidebar.classList.toggle('open'), text: '☰' }),
          crumb,
          h('div.spacer'),
          h('span.badge.small', { text: state.meta.app.organisation }),
          userMenu()),
        content)));

  return { content, crumb, sidebar };
}

/* ----------------------------------------------------------------- router */

let shell = null;

function highlight(hash) {
  for (const a of shell.sidebar.querySelectorAll('.nav a')) {
    const active = a.getAttribute('href') === hash;
    a.classList.toggle('active', active);
    if (active) a.closest('.nav-group')?.setAttribute('open', '');
  }
}

async function route() {
  if (!state.user) return;
  const hash = location.hash || '#/dashboard/executive';
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  highlight(hash);
  shell.sidebar.classList.remove('open');
  window.scrollTo(0, 0);

  const setCrumb = (...items) => { shell.crumb.textContent = items.filter(Boolean).join('  ›  '); };

  try {
    if (parts[0] === 'dashboard') {
      const key = parts[1] || 'executive';
      const def = DASHBOARDS.find((d) => d.key === key) || DASHBOARDS[0];
      setCrumb('Dashboard', def.name);
      document.title = `${def.name} — QHSE ASDP`;
      await renderDashboard(shell.content, def);
      return;
    }

    if (parts[0] === 'admin') {
      const page = ADMIN_PAGES.find((p) => p.key === parts[1]) || ADMIN_PAGES[0];
      setCrumb('Administrasi', page.name);
      document.title = `${page.name} — QHSE ASDP`;
      await renderAdmin(shell.content, page, parts.slice(2));
      return;
    }

    if (parts[0] === 'm' && parts[1]) {
      const module = mod(parts[1]);
      if (!module) {
        mount(shell.content, h('div.card', {}, h('h2', { text: 'Modul tidak ditemukan' }),
          h('p.muted', { text: 'Periksa kembali tautan atau pilih modul dari menu di samping.' })));
        return;
      }
      if (!can(module.key, 'view')) {
        mount(shell.content, h('div.card', {}, h('h2', { text: 'Akses ditolak' }),
          h('p.muted', { text: `Peran ${state.user.role_name} tidak memiliki hak baca pada modul ini.` })));
        return;
      }
      setCrumb(module.groupName, module.nameId, parts[2] ? (parts[2] === 'new' ? 'Rekaman baru' : `#${parts[2]}`) : null);
      document.title = `${module.nameId} — QHSE ASDP`;

      if (parts[2] === 'new') return renderRecordForm(shell.content, module, null);
      if (parts[2] && parts[3] === 'edit') return renderRecordForm(shell.content, module, Number(parts[2]));
      if (parts[2]) return renderRecordDetail(shell.content, module, Number(parts[2]));
      return renderModuleList(shell.content, module);
    }

    location.hash = '#/dashboard/executive';
  } catch (err) {
    console.error(err);
    mount(shell.content, h('div.card', {}, h('h2', { text: 'Terjadi kesalahan' }), h('p.muted', { text: err.message })));
  }
}

/* ------------------------------------------------------------------ boot */

async function start() {
  await loadMeta();
  shell = renderShell();
  await route();
  if (state.user.must_change_password) {
    toast('Kata sandi masih bawaan sistem. Silakan ubah melalui menu akun.', 'err');
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('qhse:unauthorised', () => {
  if (state.user) {
    state.user = null;
    renderLogin('Sesi Anda telah berakhir. Silakan masuk kembali.');
  }
});

const savedTheme = localStorage.getItem('qhse-theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

try {
  await api.get('/api/auth/me');
  await start();
} catch {
  renderLogin();
}
