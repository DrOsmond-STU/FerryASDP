/**
 * Halaman depan (pra-masuk).
 *
 * Menggabungkan prolog pemasaran — mengapa QHSE terintegrasi dibutuhkan
 * cabang ASDP, apa saja yang didapat, dan berapa biayanya — dengan panel
 * masuk dan formulir permintaan uji coba. Semua data paket diambil dari
 * API publik sehingga selalu sama dengan yang ditagihkan sistem.
 */
import { api } from './api.js';
import { h, mount, toast, fmtNumber } from './ui.js';

const rupiah = (v) => (v ? `Rp ${fmtNumber(v)}` : '—');
const juta = (v) => (v ? `Rp ${fmtNumber(Math.round(v / 1e6))} juta` : '—');

/* ------------------------------------------------------------ prolog isi */

const PILLARS = [
  {
    icon: '🚢',
    title: 'Dirancang untuk penyeberangan, bukan pabrik',
    body: 'Checklist pra-berlayar 28 item, inspeksi ramp door, stabilitas GM, keselamatan muat kendaraan golongan I–IX, manifest penumpang, dan klasifikasi insiden pelayaran sesuai IMO. Modul yang tidak akan Anda temukan pada aplikasi QHSE umum.',
  },
  {
    icon: '⚓',
    title: 'Pelabuhan penyeberangan sebagai objek utama',
    body: 'Kondisi fender, bollard, movable bridge, gangway, area steril, jalur evakuasi, APAR dan pencahayaan dermaga terpantau melalui patroli shift. Termasuk manajemen kepadatan angkutan lebaran dan Nataru.',
  },
  {
    icon: '📋',
    title: 'Siap diperiksa regulator',
    body: 'Setiap rekaman membawa acuan standar dan pasal regulasinya: SMK3 PP 50/2012, UU Pelayaran, PermenLHK limbah B3, ISM Code, ISPS. Ekspor laporan per modul dalam hitungan detik saat auditor datang.',
  },
  {
    icon: '🧮',
    title: 'Angka dihitung sistem, bukan diketik manual',
    body: 'LTIFR, TRIR, severity rate, nilai risiko 5×5, emisi CO₂e, tingkat daur ulang, batas simpan limbah B3 90 hari, dan status sertifikat dihitung otomatis dari data yang Anda masukkan — konsisten antar cabang.',
  },
  {
    icon: '⏰',
    title: 'Tidak ada lagi sertifikat kedaluwarsa',
    body: 'Sistem memindai seluruh tanggal berlaku — sertifikat kapal, izin lingkungan, izin TPS B3, riksa-uji Disnaker, kalibrasi, servis life raft — dan menampilkannya jauh sebelum jatuh tempo.',
  },
  {
    icon: '🎓',
    title: 'Kompetensi pekerja terpantau, bukan diasumsikan',
    body: 'Matriks pelatihan wajib per jabatan menjawab satu pertanyaan yang selalu ditanya auditor: siapa yang belum boleh bertugas. Sistem membandingkan pelatihan wajib dengan sertifikat yang dimiliki dan masih berlaku, lalu menampilkan kesenjangannya per pegawai, per pelabuhan dan per cabang.',
  },
  {
    icon: '🔐',
    title: 'Kewenangan berjenjang 10 level',
    body: 'Dari Administrator Sistem sampai Kontraktor. Nakhoda hanya melihat kapalnya, Port Manager hanya pelabuhannya, Corporate QHSE melihat nasional. Persetujuan tidak dapat dilewati.',
  },
];

const STEPS = [
  ['Hubungi kami', 'Sampaikan kebutuhan cabang melalui formulir di bawah.'],
  ['Uji coba 30 hari', 'Akun cabang aktif dengan data contoh; tidak perlu kartu kredit.'],
  ['Migrasi & pelatihan', 'Kami bantu pindahkan data eksisting dan melatih pengguna.'],
  ['Berlangganan bulanan', 'Bayar per cabang, dapat dihentikan kapan saja pada akhir periode.'],
];

const FAQ = [
  ['Apakah data tiap cabang terpisah?', 'Ya. Setiap cabang adalah tenant tersendiri. Pengguna cabang hanya melihat rekaman cabangnya; pemisahan ini ditegakkan di sisi server, termasuk pada seluruh dashboard.'],
  ['Bagaimana jika kami hanya butuh sebagian modul?', 'Pilih paket Esensial atau Profesional. Modul di luar paket tetap terlihat namun terkunci, dan dapat diaktifkan kapan saja tanpa migrasi ulang.'],
  ['Apakah bisa berhenti berlangganan?', 'Bisa, berlaku pada akhir periode berjalan. Data cabang dapat diekspor seluruhnya dalam format CSV sebelum akun ditutup.'],
  ['Apakah mendukung audit SMK3 dan ISO?', 'Ya. Jejak audit mencatat setiap perubahan beserta penggunanya, dan setiap modul mencantumkan klausul standar yang dipenuhi.'],
];

/* --------------------------------------------------------------- render */

export async function renderLanding(root, { onLoggedIn, message } = {}) {
  document.title = 'QHSE ASDP — Sistem Manajemen QHSE Terintegrasi untuk Cabang ASDP';

  const [overview, planData] = await Promise.all([
    api.get('/api/public/overview').catch(() => null),
    api.get('/api/public/plans').catch(() => ({ plans: [] })),
  ]);
  const plans = planData?.plans || [];

  const page = h('div.landing', {},
    topbar(),
    hero(overview, plans, message, onLoggedIn),
    pillars(),
    coverage(overview),
    pricing(plans),
    howItWorks(),
    faq(),
    trialForm(plans),
    footer(overview),
  );

  mount(root, page);
  document.querySelector('.landing input[name=username]')?.focus();
}

const jump = (id) => (e) => {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function topbar() {
  return h('header.lnd-topbar', {},
    h('div.lnd-wrap.lnd-topbar-inner', {},
      h('a.lnd-brand', { href: '#top' },
        h('span.mark', { text: '⚓' }),
        h('span', {}, h('b', { text: 'QHSE ASDP' }), h('small', { text: 'Integrated Management System' }))),
      h('nav.lnd-nav', {},
        h('a', { href: '#fitur', onclick: jump('fitur'), text: 'Fitur' }),
        h('a', { href: '#kepatuhan', onclick: jump('kepatuhan'), text: 'Kepatuhan' }),
        h('a', { href: '#harga', onclick: jump('harga'), text: 'Harga' }),
        h('a', { href: '#faq', onclick: jump('faq'), text: 'Tanya Jawab' })),
      h('div.lnd-topbar-cta', {},
        h('a.btn.btn-sm', { href: '#coba', onclick: jump('coba'), text: 'Coba Gratis' }),
        h('a.btn.btn-sm.btn-primary', { href: '#masuk', onclick: jump('masuk'), text: 'Masuk' }))));
}

function hero(overview, plans, message, onLoggedIn) {
  const moduleCount = overview?.product?.moduleCount ?? 111;
  const groupCount = overview?.product?.groupCount ?? 13;
  const cheapest = plans.length ? Math.min(...plans.map((p) => p.monthlyPrice)) : null;

  return h('section.lnd-hero', { id: 'top' },
    h('div.lnd-wrap.lnd-hero-grid', {},
      h('div', {},
        h('span.lnd-eyebrow', { text: 'Perangkat lunak berlangganan untuk cabang PT ASDP Indonesia Ferry (Persero)' }),
        h('h1.lnd-h1', {}, 'Satu sistem untuk ', h('em', { text: 'seluruh' }), ' kewajiban QHSE cabang Anda.'),
        h('p.lnd-lead', { text: 'Mutu, kesehatan kerja, K3, lingkungan, keselamatan pelayaran, keselamatan pelabuhan, risiko, aset, kontraktor, audit dan pelaporan ESG — tidak lagi tersebar di puluhan berkas Excel dan map arsip.' }),
        h('div.lnd-stats', {},
          heroStat(String(moduleCount), 'modul siap pakai'),
          heroStat(String(groupCount), 'kelompok fungsi'),
          heroStat('16', 'standar & kode maritim'),
          heroStat('10', 'level kewenangan')),
        h('div.lnd-hero-cta', {},
          h('a.btn.btn-primary', { href: '#coba', onclick: jump('coba'), text: 'Ajukan Uji Coba 30 Hari' }),
          h('a.btn', { href: '#harga', onclick: jump('harga'), text: 'Lihat Paket & Harga' })),
        cheapest
          ? h('p.lnd-note', { text: `Berlangganan per cabang mulai ${juta(cheapest)}/bulan. Tanpa biaya pemasangan perangkat keras — cukup peramban.` })
          : null),
      loginPanel(message, onLoggedIn)));
}

const heroStat = (value, label) =>
  h('div.lnd-stat', {}, h('strong', { text: value }), h('span', { text: label }));

function loginPanel(message, onLoggedIn) {
  const error = h('div.alert.err', { class: message ? '' : 'hidden', text: message || '' });
  const username = h('input', { name: 'username', autocomplete: 'username', required: true, placeholder: 'mis. corporate.qhse' });
  const password = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button.btn-primary', { type: 'submit', style: 'width:100%;justify-content:center', text: 'Masuk ke Aplikasi' });

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Memeriksa…';
      try {
        await api.post('/api/auth/login', { username: username.value.trim(), password: password.value });
        await onLoggedIn();
      } catch (err) {
        error.textContent = err.message;
        error.classList.remove('hidden');
        submit.disabled = false;
        submit.textContent = 'Masuk ke Aplikasi';
      }
    },
  },
    error,
    h('div.field.required', {}, h('label', { text: 'Nama Pengguna' }), username),
    h('div.field.required', {}, h('label', { text: 'Kata Sandi' }), password),
    submit);

  return h('div.lnd-login', { id: 'masuk' },
    h('h2', { text: 'Masuk' }),
    h('p.small.muted', { text: 'Untuk pengguna cabang yang sudah berlangganan.' }),
    form,
    h('div.lnd-login-demo', {},
      h('strong.small', { text: 'Akun demo tersedia' }),
      h('p.small.muted', { text: 'corporate.qhse (pengelola platform) · port.manager (cabang berlangganan penuh) · qhse.ketapang (paket Profesional) · qhse.bajoe (masa uji coba). Kata sandi demo dapat diminta kepada tim kami.' })));
}

function pillars() {
  return h('section.lnd-section', { id: 'fitur' },
    h('div.lnd-wrap', {},
      h('div.lnd-head', {},
        h('h2', { text: 'Mengapa cabang memilih QHSE ASDP' }),
        h('p', { text: 'Aplikasi QHSE umumnya dibuat untuk pabrik. Operasi penyeberangan punya kewajiban yang berbeda — dan justru di situ risikonya terbesar.' })),
      h('div.lnd-cards', {}, ...PILLARS.map((p) =>
        h('article.lnd-card', {},
          h('div.lnd-card-icon', { text: p.icon }),
          h('h3', { text: p.title }),
          h('p', { text: p.body }))))));
}

function coverage(overview) {
  const groups = overview?.groups || [];
  const standards = overview?.standards || [];
  const regulators = overview?.regulators || [];

  return h('section.lnd-section.lnd-alt', { id: 'kepatuhan' },
    h('div.lnd-wrap', {},
      h('div.lnd-head', {},
        h('h2', { text: 'Cakupan modul & kepatuhan' }),
        h('p', { text: 'Setiap modul membawa acuan standar dan regulasinya. Yang Anda catat hari ini adalah bukti yang diminta auditor bulan depan.' })),

      h('div.lnd-groups', {}, ...groups.map((g) =>
        h('div.lnd-group', {},
          h('span.lnd-group-icon', { text: g.icon }),
          h('div', {},
            h('strong', { text: `${g.code}. ${g.name}` }),
            h('span.small.muted', { text: `${g.modules} modul` }))))),

      h('h3.lnd-sub', { text: 'Standar yang diakomodasi' }),
      h('div.chips', {}, ...standards.map((s) => h('span.chip.std', { text: s }))),

      h('h3.lnd-sub', { text: 'Regulasi Indonesia' }),
      h('div.lnd-regs', {}, ...regulators.map((r) =>
        h('div.lnd-reg', {},
          h('strong', { text: r.name }),
          h('ul', {}, ...r.items.map((i) => h('li', { text: i }))))))));
}

function pricing(plans) {
  if (!plans.length) return h('section', {});
  return h('section.lnd-section', { id: 'harga' },
    h('div.lnd-wrap', {},
      h('div.lnd-head', {},
        h('h2', { text: 'Paket langganan per cabang' }),
        h('p', { text: 'Harga per cabang per bulan, sudah termasuk pembaruan sistem dan penyimpanan data. Berlangganan tahunan hemat dua bulan.' })),
      h('div.lnd-plans', {}, ...plans.map(planCard)),
      h('p.lnd-note.center', { text: 'Harga belum termasuk PPN 11%. Penambahan cabang mengikuti tarif yang sama; kontrak lintas cabang dapat dinegosiasikan melalui kantor pusat.' })));
}

function planCard(plan) {
  const tick = (label, on = true) =>
    h('li', { class: on ? '' : 'off' }, h('span', { text: on ? '✓' : '·' }), label);

  return h('article.lnd-plan', { class: plan.recommended ? 'featured' : '' },
    plan.recommended ? h('span.lnd-plan-tag', { text: 'Paling banyak dipilih' }) : null,
    h('h3', { text: plan.name }),
    h('p.lnd-plan-tagline', { text: plan.tagline || '' }),
    h('div.lnd-price', {},
      h('strong', { text: rupiah(plan.monthlyPrice) }),
      h('span', { text: '/cabang/bulan' })),
    plan.annualPrice
      ? h('div.small.muted', { text: `atau ${rupiah(plan.annualPrice)}/tahun — hemat ${plan.annualSavingPercent ?? 0}%` })
      : null,
    h('ul.lnd-plan-list', {},
      tick(`${plan.moduleCount} modul aktif`),
      tick(plan.maxUsers ? `${plan.maxUsers} pengguna` : 'Pengguna tanpa batas'),
      tick(`Penyimpanan ${plan.storageGb} GB`),
      tick(`SLA ${plan.slaUptime}`),
      tick(plan.supportLevel),
      tick('Pendampingan implementasi', plan.onboardingIncluded),
      tick('Pelatihan pengguna', plan.trainingIncluded),
      tick('Integrasi API', plan.apiAccess),
      tick('Laporan kustom & analitik lanjutan', plan.dedicatedReport)),
    h('details.lnd-plan-groups', {},
      h('summary', { text: 'Rincian kelompok modul' }),
      h('ul', {}, ...plan.groups.map((g) => h('li', { text: `${g.name} (${g.modules} modul)` })))),
    plan.highlights?.length
      ? h('div.chips', { style: 'margin-top:.7rem' }, ...plan.highlights.slice(0, 4).map((x) => h('span.chip', { text: x })))
      : null,
    h('a.btn.btn-primary', { href: '#coba', onclick: jump('coba'), style: 'width:100%;justify-content:center;margin-top:1rem', text: 'Ajukan Uji Coba' }));
}

function howItWorks() {
  return h('section.lnd-section.lnd-alt', {},
    h('div.lnd-wrap', {},
      h('div.lnd-head', {}, h('h2', { text: 'Dari permintaan sampai berjalan penuh' })),
      h('ol.lnd-steps', {}, ...STEPS.map(([title, body], i) =>
        h('li', {},
          h('span.lnd-step-no', { text: String(i + 1) }),
          h('div', {}, h('strong', { text: title }), h('p.small.muted', { text: body })))))));
}

function faq() {
  return h('section.lnd-section', { id: 'faq' },
    h('div.lnd-wrap', {},
      h('div.lnd-head', {}, h('h2', { text: 'Tanya jawab' })),
      h('div.lnd-faq', {}, ...FAQ.map(([q, a]) =>
        h('details', {}, h('summary', { text: q }), h('p', { text: a }))))));
}

function trialForm(plans) {
  const field = (label, el, required) =>
    h('div.field', { class: required ? 'required' : '' }, h('label', { text: label }), el);

  const organisation = h('input', { placeholder: 'mis. Cabang Lembar' });
  const contact = h('input', { placeholder: 'Nama lengkap' });
  const position = h('input', { placeholder: 'mis. Kepala QHSE' });
  const email = h('input', { type: 'email', placeholder: 'nama@asdp.id' });
  const phone = h('input', { placeholder: '08xxxxxxxxxx' });
  const users = h('input', { type: 'number', min: 1, placeholder: '30' });
  const plan = h('select', {},
    h('option', { value: 'Belum Menentukan', text: 'Belum menentukan' }),
    ...plans.map((p) => h('option', { value: p.name, text: p.name })));
  const area = h('select', {},
    ...['Keselamatan Pelayaran & Checklist Kapal', 'Keselamatan Kerja (K3) & SMK3',
      'Pengelolaan Lingkungan & Limbah B3', 'Mutu & Kepuasan Pelanggan',
      'Manajemen Risiko & Audit', 'Pelaporan ESG & Keberlanjutan', 'Pengelolaan Aset & Sertifikat']
      .map((o) => h('option', { value: o, text: o })));
  const message = h('textarea', { placeholder: 'Ceritakan kondisi pengelolaan QHSE di cabang Anda saat ini…' });

  const feedback = h('div.alert.hidden');
  const submit = h('button.btn-primary', { type: 'submit', text: 'Kirim Permintaan Uji Coba' });

  const form = h('form.lnd-form', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Mengirim…';
      feedback.classList.add('hidden');
      try {
        const result = await api.post('/api/public/trial-request', {
          organisation: organisation.value, contact_name: contact.value, position: position.value,
          email: email.value, phone: phone.value, employee_count: users.value,
          plan_interest: plan.value, priority_area: area.value, message: message.value,
        });
        feedback.className = 'alert info';
        feedback.textContent = result.message;
        form.reset();
        toast('Permintaan uji coba terkirim.', 'ok');
      } catch (err) {
        feedback.className = 'alert err';
        feedback.textContent = [err.message, ...(err.details || [])].join(' ');
      } finally {
        submit.disabled = false;
        submit.textContent = 'Kirim Permintaan Uji Coba';
      }
    },
  },
    h('div.grid.cols-2', {},
      field('Nama cabang / unit', organisation, true),
      field('Nama penanggung jawab', contact, true),
      field('Jabatan', position),
      field('Surel dinas', email, true),
      field('Telepon', phone),
      field('Perkiraan jumlah pengguna', users),
      field('Paket yang diminati', plan),
      field('Kebutuhan utama', area)),
    field('Pesan', message),
    feedback,
    submit);

  return h('section.lnd-section.lnd-cta', { id: 'coba' },
    h('div.lnd-wrap.lnd-cta-grid', {},
      h('div', {},
        h('h2', { text: 'Coba gratis 30 hari' }),
        h('p', { text: 'Cabang Anda mendapat akun lengkap berisi data contoh untuk dicoba bersama tim QHSE, tanpa biaya dan tanpa komitmen. Kami bantu migrasi data dan pelatihan pengguna bila memutuskan berlangganan.' }),
        h('ul.lnd-check', {},
          h('li', { text: 'Aktif dalam 2 hari kerja' }),
          h('li', { text: 'Tanpa pemasangan server di cabang' }),
          h('li', { text: 'Data dapat diekspor kapan saja' }),
          h('li', { text: 'Berhenti kapan saja pada akhir periode' }))),
      h('div.lnd-form-wrap', {}, form)));
}

function footer(overview) {
  return h('footer.lnd-footer', {},
    h('div.lnd-wrap.lnd-footer-grid', {},
      h('div', {},
        h('div.lnd-brand', {}, h('span.mark', { text: '⚓' }),
          h('span', {}, h('b', { text: 'QHSE ASDP' }), h('small', { text: 'Integrated Management System' }))),
        h('p.small', { text: 'Platform manajemen QHSE terintegrasi untuk operator kapal penyeberangan dan pelabuhan.' })),
      h('div', {},
        h('strong.small', { text: 'Produk' }),
        h('ul.lnd-links', {},
          h('li', {}, h('a', { href: '#fitur', onclick: jump('fitur'), text: 'Fitur' })),
          h('li', {}, h('a', { href: '#kepatuhan', onclick: jump('kepatuhan'), text: 'Cakupan kepatuhan' })),
          h('li', {}, h('a', { href: '#harga', onclick: jump('harga'), text: 'Paket & harga' })))),
      h('div', {},
        h('strong.small', { text: 'Dikembangkan oleh' }),
        h('p.small', { text: overview?.product?.operator || 'PT Semesta Teknologi Utama' }),
        h('p.small', { text: 'Dukungan: support@semestateknologiutama.com' }))),
    h('div.lnd-wrap.lnd-footer-note', {},
      h('p.small', { text: `© ${new Date().getFullYear()} QHSE ASDP. Data yang ditampilkan pada lingkungan demonstrasi bersifat ilustratif dan bukan data operasional PT ASDP Indonesia Ferry (Persero).` })));
}
