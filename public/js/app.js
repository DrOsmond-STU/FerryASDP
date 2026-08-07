/**
 * Application shell: authentication, layout, navigation and the hash router.
 */
import { api, state, loadMeta, can, mod, entitled } from './api.js';
import { h, mount, clear, toast, initials, modal, languageSwitch } from './ui.js';
import { renderModuleList, renderRecordForm, renderRecordDetail } from './module.js';
import { renderDashboard, DASHBOARDS } from './dashboards.js';
import { renderAdmin, ADMIN_PAGES } from './admin.js';
import { renderLanding } from './landing.js';
import { renderCustomDashboard, listCustomDashboards, newDashboardDialog } from './customdash.js';
import { t, lang, setLang, storedLang } from './i18n.js';

const root = document.getElementById('app');

/** Dashboard kustom dimuat sekali per sesi dan disegarkan saat berubah. */
let customDashboards = { dashboards: [], canEdit: false };

/** The boot placeholder carries loading-only styling; drop it on first render. */
const ready = () => root.classList.remove('app-loading');

/* ------------------------------------------------------------------ login */

function renderLogin(message) {
  ready();
  renderLanding(root, { onLoggedIn: start, message });
}

/* ----------------------------------------------------------------- layout */

function navigation() {
  const nav = h('nav.nav');
  const search = h('input', {
    type: 'search', placeholder: t('Cari modul…'), 'aria-label': t('Cari modul'),
    oninput: () => filter(search.value.trim().toLowerCase()),
  });

  const dashGroup = h('details.nav-group', { open: true },
    h('summary', {}, h('span', { text: '▾' }), t('Dashboard')),
    ...DASHBOARDS
      .filter((d) => (!d.requires || (can(d.requires, 'view') && entitled(d.requires))))
      .filter((d) => !d.platformOnly || state.subscription?.platform)
      .map((d) => link(`#/dashboard/${d.key}`, d.icon, t(d.name))));
  nav.appendChild(dashGroup);

  // Dashboard susunan sendiri berdiri sebagai kelompok terpisah supaya jelas
  // mana yang bawaan aplikasi dan mana yang disusun oleh administrator.
  const customGroup = h('details.nav-group', { open: true },
    h('summary', {}, h('span', { text: '▾' }), t('Dashboard Kustom')),
    ...customDashboards.dashboards.map((d) =>
      link(`#/custom/${d.key}`, d.icon || '📌', d.published ? d.name : `${d.name} (${lang() === 'en' ? 'draft' : 'draf'})`)),
    customDashboards.canEdit
      ? h('a', {
        href: '#',
        dataset: { label: t('Dashboard baru').toLowerCase() },
        onclick: (e) => { e.preventDefault(); newDashboardDialog((key) => { location.hash = `#/custom/${key}`; }); },
      }, h('span.ic', { text: '＋' }), h('span', { text: t('Dashboard baru') }))
      : null);
  if (customDashboards.dashboards.length || customDashboards.canEdit) nav.appendChild(customGroup);

  for (const group of state.groups) {
    const modules = group.modules.map(mod).filter((m) => m && can(m.key, 'view'));
    if (!modules.length) continue;
    const locked = modules.filter((m) => !entitled(m.key)).length;
    const details = h('details.nav-group', { open: group.code === 'E' },
      h('summary', {},
        h('span', { text: '▾' }),
        `${group.code}. ${group.name}`,
        locked === modules.length ? h('span.nav-lock', { title: t('Di luar paket langganan'), text: '🔒' }) : null),
      ...modules.map((m) => (entitled(m.key)
        ? link(`#/m/${m.key}`, m.icon, m.nameId)
        : lockedLink(m))));
    nav.appendChild(details);
  }

  if (state.user.level <= 3) {
    nav.appendChild(h('details.nav-group', {},
      h('summary', {}, h('span', { text: '▾' }), t('Administrasi')),
      ...ADMIN_PAGES.filter((p) => state.user.level <= p.level)
        .map((p) => link(`#/admin/${p.key}`, p.icon, t(p.name)))));
  }

  function link(href, icon, label) {
    return h('a', { href, dataset: { label: label.toLowerCase() } },
      h('span.ic', { text: icon || '•' }), h('span', { text: label }));
  }

  /** Modul di luar paket tetap terlihat - terkunci, sebagai jalur peningkatan. */
  function lockedLink(m) {
    return h('a.locked', {
      href: '#',
      dataset: { label: m.nameId.toLowerCase() },
      title: t('Tidak termasuk paket langganan cabang Anda'),
      onclick: (e) => { e.preventDefault(); upgradeDialog(m); },
    }, h('span.ic', { text: '🔒' }), h('span', { text: m.nameId }));
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

/** Ajakan meningkatkan paket ketika modul di luar langganan dibuka. */
function upgradeDialog(m) {
  const sub = state.subscription;
  modal({
    title: `${m.icon} ${m.nameId}`,
    body: h('div', {},
      h('div.alert.info', { text: `Modul ini tidak termasuk paket ${sub?.planName || 'langganan cabang Anda'}.` }),
      h('p', { text: `${m.nameId} berada pada kelompok ${m.groupCode}. ${m.groupName}. Modul ini mendukung pemenuhan ${(m.standards || []).join(', ') || 'persyaratan sistem manajemen'}.` }),
      m.regulations?.length
        ? h('div', {}, h('div.small.muted', { text: 'Regulasi terkait:' }), h('div.chips', {}, ...m.regulations.map((r) => h('span.chip.reg', { text: r }))))
        : null,
      h('p.small.muted', { style: 'margin-top:.8rem', text: 'Peningkatan paket dapat diaktifkan tanpa migrasi ulang - seluruh data cabang tetap utuh. Hubungi pengelola platform melalui kantor pusat.' })),
  });
}

/** Ringkasan langganan cabang pada bilah atas. */
function subscriptionChip() {
  const sub = state.subscription;
  if (!sub) return null;

  const tone = sub.platform ? 'b-progress'
    : sub.status === 'active' ? 'b-ok'
      : sub.status === 'trial' ? 'b-warn'
        : ['past_due', 'suspended', 'ended'].includes(sub.status) ? 'b-danger' : 'b-draft';

  const label = sub.platform
    ? t('Pengelola Platform')
    : `${sub.planName || t('Tanpa paket')} · ${sub.statusLabel}`;

  return h('span.badge', {
    class: `${tone} clickable`,
    style: 'cursor:pointer',
    title: t('Rincian langganan cabang'),
    text: label,
    onclick: () => subscriptionDialog(),
  });
}

function subscriptionDialog() {
  const sub = state.subscription;
  const row = (label, value) => h('div.dl-item', {}, h('dt', { text: label }), h('dd', { text: value ?? '—' }));
  const money = (v) => (v ? `Rp ${Number(v).toLocaleString('id-ID')}` : '—');

  modal({
    title: t('Langganan Cabang'),
    body: h('div', {},
      sub.platform
        ? h('div.alert.info', { text: t('Anda masuk sebagai pengelola platform: seluruh modul dan seluruh tenant dapat diakses.') })
        : sub.reason ? h('div.alert.err', { text: sub.reason }) : null,
      h('div.detail-grid', {},
        row(t('Cabang'), sub.branch),
        row(t('Paket'), sub.planName),
        row(t('Status'), sub.statusLabel),
        row(t('Biaya bulanan'), money(sub.monthlyFee)),
        row(t('Kuota pengguna'), sub.seats ? `${sub.activeUsers ?? 0} ${t('dari')} ${sub.seats}` : t('Tanpa batas')),
        row(t('Modul aktif'), `${sub.moduleCount} ${t('dari')} ${sub.totalModules}`),
        row(t('Tagihan berikutnya'), sub.nextBilling),
        row(t('Akhir uji coba'), sub.trialEnd),
        row(t('Akhir kontrak'), sub.contractEnd)),
      h('div.progress', { style: 'margin-top:.9rem' },
        h('span', { style: `width:${Math.round((sub.moduleCount / sub.totalModules) * 100)}%` })),
      h('p.small.muted', { style: 'margin-top:.4rem', text: `${Math.round((sub.moduleCount / sub.totalModules) * 100)}% dari seluruh modul platform aktif untuk cabang ini.` })),
  });
}

function userMenu() {
  const u = state.user;
  return h('div.userchip', {
    onclick: () => modal({
      title: t('Akun & Sesi'),
      body: h('div', {},
        h('div.detail-grid', {},
          info(t('Nama'), u.full_name),
          info(t('Nama pengguna'), u.username),
          info(t('Jabatan'), u.position || '—'),
          info(t('Peran'), `${u.role_name} (Level ${u.level})`),
          info(t('Cakupan akses'), scopeLabel(u.scope_type)),
          info(t('Surel'), u.email || '—')),
        // Pilihan bahasa tetap ada di sini karena tersimpan pada akun, namun
        // sakelar utamanya ada pada bilah atas: fitur dwibahasa tidak berguna
        // bila pengguna harus membuka dialog dulu untuk menemukannya.
        h('div.field', { style: 'margin-top:1rem' },
          h('label', { text: t('Bahasa') }),
          h('select', {
            onchange: (e) => switchLanguage(e.target.value),
          },
            h('option', { value: 'id', selected: lang() === 'id', text: 'Bahasa Indonesia' }),
            h('option', { value: 'en', selected: lang() === 'en', text: 'English' })),
          h('div.help', { text: t('Dapat juga diubah lewat tombol ID / EN di bilah atas.') })),
        h('div', { style: 'margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap' },
          h('button', { onclick: passwordDialog, text: t('Ubah kata sandi') }),
          h('button', { onclick: toggleTheme, text: t('Ganti tema terang/gelap') }),
          h('button.btn-danger', { onclick: logout, text: t('Keluar') }))),
    }),
  },
    h('div.avatar', { text: initials(u.full_name) }),
    h('div', {}, h('strong.small', { text: u.full_name }), h('small', { text: u.role_name })));
}

const info = (label, value) => h('div.dl-item', {}, h('dt', { text: label }), h('dd', { text: value ?? '—' }));

const scopeLabel = (scope) => t({
  global: 'Nasional (seluruh unit)',
  region: 'Regional',
  branch: 'Cabang',
  port: 'Pelabuhan',
  vessel: 'Kapal',
  own: 'Rekaman milik sendiri',
}[scope] || scope);

/**
 * Mengganti bahasa berarti memuat ulang metadata: seluruh label isian, opsi
 * pilihan dan nama status datang dari server sudah dalam bahasa yang dipilih,
 * jadi tidak ada yang perlu diterjemahkan ulang di sini.
 */
async function switchLanguage(next) {
  if (next === lang()) return;
  setLang(next);
  // Pada halaman depan belum ada sesi: tidak ada preferensi yang bisa
  // disimpan dan tidak ada kerangka aplikasi yang perlu dimuat ulang.
  if (!state.user) {
    renderLogin();
    return;
  }
  try {
    await api.put('/api/auth/language', { language: next });
  } catch {
    // Preferensi gagal tersimpan bukan alasan menahan pergantian tampilan.
  }
  clear(document.getElementById('modal-root'));
  const hash = location.hash;
  await start();
  location.hash = hash;
  await route();
}

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
    title: t('Ubah Kata Sandi'),
    body: h('div', {},
      error,
      h('div.field.required', {}, h('label', { text: t('Kata sandi saat ini') }), current),
      h('div.field.required', {}, h('label', { text: t('Kata sandi baru') }), next,
        h('div.help', { text: t('Minimal 10 karakter, mengandung huruf besar, huruf kecil dan angka.') }))),
    actions: [{
      label: t('Simpan'),
      class: 'btn-primary',
      onClick: async (close) => {
        try {
          await api.post('/api/auth/password', { currentPassword: current.value, newPassword: next.value });
          close();
          toast(t('Kata sandi diperbarui. Silakan masuk kembali.'), 'ok');
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
  ready();
  const { nav, search } = navigation();
  const sidebar = h('aside.sidebar', {},
    h('div.sidebar-brand', {},
      h('div.mark', { text: '⚓' }),
      h('div', {},
        h('b', { text: 'QHSE ASDP' }),
        h('span', { text: `${state.meta.app.moduleCount} ${t('modul terintegrasi')}` }))),
    h('div.nav-search', {}, search),
    nav);

  const crumb = h('div.crumb');
  const content = h('main.content', {}, h('div.empty', { text: t('Memuat…') }));

  mount(root,
    h('div.layout', {},
      sidebar,
      h('div.main', {},
        h('header.topbar', {},
          h('button.menu-toggle.btn-ghost', { onclick: () => sidebar.classList.toggle('open'), text: '☰' }),
          crumb,
          h('div.spacer'),
          languageSwitch(switchLanguage),
          subscriptionChip(),
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
      setCrumb(t('Dashboard'), t(def.name));
      document.title = `${t(def.name)} — QHSE ASDP`;
      await renderDashboard(shell.content, def);
      return;
    }

    if (parts[0] === 'custom' && parts[1]) {
      const def = customDashboards.dashboards.find((d) => d.key === parts[1]);
      setCrumb(t('Dashboard Kustom'), def?.name || parts[1]);
      document.title = `${def?.name || 'Dashboard'} — QHSE ASDP`;
      await renderCustomDashboard(shell.content, parts[1]);
      return;
    }

    if (parts[0] === 'admin') {
      const page = ADMIN_PAGES.find((p) => p.key === parts[1]) || ADMIN_PAGES[0];
      setCrumb(t('Administrasi'), t(page.name));
      document.title = `${t(page.name)} — QHSE ASDP`;
      await renderAdmin(shell.content, page, parts.slice(2));
      return;
    }

    if (parts[0] === 'm' && parts[1]) {
      const module = mod(parts[1]);
      if (!module) {
        mount(shell.content, h('div.card', {}, h('h2', { text: t('Modul tidak ditemukan') }),
          h('p.muted', { text: t('Periksa kembali tautan atau pilih modul dari menu di samping.') })));
        return;
      }
      if (!can(module.key, 'view')) {
        mount(shell.content, h('div.card', {}, h('h2', { text: t('Akses ditolak') }),
          h('p.muted', { text: `Peran ${state.user.role_name} tidak memiliki hak baca pada modul ini.` })));
        return;
      }
      if (!entitled(module.key)) {
        setCrumb(module.groupName, module.nameId, t('Di luar paket'));
        mount(shell.content, h('div.card', {},
          h('h2', {}, h('span', { text: '🔒 ' }), module.nameId),
          h('p.muted', { text: `Modul ini tidak termasuk paket ${state.subscription?.planName || 'langganan cabang Anda'}.` }),
          h('button.btn-primary', { onclick: () => upgradeDialog(module), text: t('Lihat rincian modul & peningkatan paket') })));
        return;
      }
      setCrumb(module.groupName, module.nameId, parts[2] ? (parts[2] === 'new' ? t('Rekaman baru') : `#${parts[2]}`) : null);
      document.title = `${module.nameId} — QHSE ASDP`;

      if (parts[2] === 'new') return renderRecordForm(shell.content, module, null);
      if (parts[2] && parts[3] === 'edit') return renderRecordForm(shell.content, module, Number(parts[2]));
      if (parts[2]) return renderRecordDetail(shell.content, module, Number(parts[2]));
      return renderModuleList(shell.content, module);
    }

    location.hash = '#/dashboard/executive';
  } catch (err) {
    console.error(err);
    mount(shell.content, h('div.card', {}, h('h2', { text: t('Terjadi kesalahan') }), h('p.muted', { text: err.message })));
  }
}

/* ------------------------------------------------------------------ boot */

async function start() {
  await loadMeta();
  customDashboards = await listCustomDashboards();
  shell = renderShell();
  await route();
  if (state.user.must_change_password) {
    toast(t('Kata sandi masih bawaan sistem. Silakan ubah melalui menu akun.'), 'err');
  }
}

window.addEventListener('hashchange', route);

/**
 * Menyusun, membuat atau menghapus dashboard mengubah isi menu samping.
 * Daftarnya dimuat ulang lalu seluruh kerangka digambar ulang — lebih murah
 * daripada menyisipkan atau mencabut satu tautan dan menjaga urutannya sendiri.
 */
window.addEventListener('qhse:dashboards-changed', async () => {
  customDashboards = await listCustomDashboards();
  if (!state.user) return;
  const hash = location.hash;
  shell = renderShell();
  location.hash = hash;
  await route();
});
window.addEventListener('qhse:unauthorised', () => {
  if (state.user) {
    state.user = null;
    renderLogin(t('Sesi Anda telah berakhir. Silakan masuk kembali.'));
  }
});

const savedTheme = localStorage.getItem('qhse-theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

// Halaman depan tampil sebelum ada sesi, jadi bahasanya diambil dari peramban.
// Setelah masuk, `loadMeta()` menggantinya dengan bahasa yang tersimpan di akun.
const savedLang = storedLang();
if (savedLang) setLang(savedLang);

try {
  await api.get('/api/auth/me');
  await start();
} catch {
  renderLogin();
}
