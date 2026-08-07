/**
 * End-to-end smoke test against a running server.
 *
 *   npm start           (terminal 1)
 *   npm run check       (terminal 2)
 *
 * Verifies authentication, RBAC boundaries, row-level security, the generic
 * CRUD engine, workflow transitions, CAPA linkage, every dashboard, the SaaS
 * layer (public marketing endpoints, plan-based module entitlement, commercial
 * dashboard), the competency & training cycle, and the two analytical layers:
 * the balanced scorecard arithmetic and the cross-module analytics.
 */
const BASE = process.env.QHSE_URL || 'http://localhost:3000';
const PASSWORD = process.env.QHSE_SEED_PASSWORD || 'Asdp#2026Qhse';

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** Minimal cookie-jar client so each role keeps its own session. */
function client() {
  let cookie = null;
  return async function call(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* CSV or HTML response */ }
    return { status: res.status, json, text };
  };
}

async function login(username) {
  const call = client();
  const res = await call('/api/auth/login', { method: 'POST', body: { username, password: PASSWORD } });
  if (res.status !== 200) throw new Error(`Login ${username} gagal: ${res.json?.error || res.status}`);
  return call;
}

/* ------------------------------------------------------------------ tests */

section('1. Ketersediaan layanan');
const health = await (await fetch(`${BASE}/api/health`)).json();
check('Server merespons /api/health', health.status === 'ok');
check('Seluruh modul termuat (116)', health.modules === 116, `modules=${health.modules}`);

section('2. Autentikasi');
const anon = client();
const badLogin = await anon('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'salah' } });
check('Kata sandi salah ditolak', badLogin.status === 401);
const noSession = await anon('/api/modules/incident/records');
check('Akses tanpa sesi ditolak', noSession.status === 401);

const corporate = await login('corporate.qhse');
check('Login corporate QHSE berhasil', true);
const me = await corporate('/api/auth/me');
check('Profil sesi terbaca', me.json?.user?.role_key === 'corporate_qhse');

section('3. Metadata registry');
const meta = (await corporate('/api/meta')).json;
check('Katalog modul dikirim', meta.modules.length === 116, `${meta.modules.length}`);
check('Kelompok fungsi lengkap', meta.groups.length === 15, `${meta.groups.length}`);
check('Setiap modul memiliki workflow', meta.modules.every((m) => m.workflow?.length > 0));
check('Setiap modul memiliki isian', meta.modules.every((m) => m.fields?.length > 0));
check('Faktor emisi tersedia', Object.keys(meta.emissionFactors).length > 0);

section('4. Mesin CRUD generik');
const created = await corporate('/api/modules/near_miss/records', {
  method: 'POST',
  body: {
    title: 'Uji otomatis — nyaris tertimpa muatan',
    event_date: new Date().toISOString().slice(0, 10),
    description: 'Rekaman uji yang dibuat oleh smoke test.',
    hazard_type: 'Pengangkatan Beban (Lifting)',
    potential_likelihood: '3',
    potential_severity: '4',
    port_id: 1,
  },
});
check('Rekaman baru dibuat', created.status === 201, created.json?.error);
const record = created.json?.record;
check('Kode rekaman diterbitkan otomatis', /^NMS\/\d{4}\/\d{4}$/.test(record?.code || ''), record?.code);
check('Status awal sesuai workflow', record?.status === 'draft', record?.status);
check('Nilai risiko dihitung server (3 × 4 = 12)', record?.potential_risk_score === 12, String(record?.potential_risk_score));
check('Tingkat risiko diturunkan otomatis', record?.potential_risk_level === 'Tinggi', record?.potential_risk_level);

const validation = await corporate('/api/modules/near_miss/records', { method: 'POST', body: { description: 'tanpa judul' } });
check('Validasi isian wajib ditegakkan', validation.status === 400 && validation.json.details?.length > 0);

const badOption = await corporate('/api/modules/near_miss/records', {
  method: 'POST',
  body: { title: 'x', event_date: '2026-01-01', description: 'x', hazard_type: 'Bahaya Karangan' },
});
check('Pilihan di luar daftar ditolak', badOption.status === 400);

const updated = await corporate(`/api/modules/near_miss/records/${record.id}`, {
  method: 'PUT',
  body: { potential_severity: '5' },
});
check('Perubahan tersimpan', updated.status === 200);
check('Nilai turunan dihitung ulang (3 × 5 = 15)', updated.json?.record?.potential_risk_score === 15, String(updated.json?.record?.potential_risk_score));

const detail = (await corporate(`/api/modules/near_miss/records/${record.id}`)).json;
check('Jejak audit rekaman tercatat', detail.history?.some((e) => e.action === 'create'));

section('5. Alur kerja & persetujuan');
const badStatus = await corporate(`/api/modules/near_miss/records/${record.id}/status`, { method: 'POST', body: { status: 'tidak_ada' } });
check('Status tidak dikenal ditolak', badStatus.status === 400);
const moved = await corporate(`/api/modules/near_miss/records/${record.id}/status`, {
  method: 'POST', body: { status: 'investigating', note: 'Investigasi dimulai oleh smoke test.' },
});
check('Transisi status berhasil', moved.status === 200 && moved.json.record.status === 'investigating');
const afterNote = (await corporate(`/api/modules/near_miss/records/${record.id}`)).json;
check('Catatan transisi tersimpan sebagai komentar', afterNote.comments?.length === 1);

section('6. Keterkaitan CAPA');
const capa = await corporate(`/api/modules/near_miss/records/${record.id}/capa`, {
  method: 'POST',
  body: { title: 'CAPA uji otomatis', action_plan: 'Perbaikan prosedur pengangkatan.', due_date: '2026-12-31' },
});
check('CAPA dibuat dari rekaman sumber', capa.status === 201, capa.json?.error);
const linked = (await corporate(`/api/modules/near_miss/records/${record.id}`)).json;
check('CAPA tertaut ke rekaman sumber', linked.linked?.some((l) => l.id === capa.json.record.id));

section('7. Kontrol akses berbasis peran');
const auditor = await login('auditor');
const auditorRead = await auditor('/api/modules/incident/records');
check('Auditor dapat membaca insiden', auditorRead.status === 200);
const auditorWrite = await auditor('/api/modules/incident/records', { method: 'POST', body: { title: 'x' } });
check('Auditor tidak dapat membuat rekaman', auditorWrite.status === 403);

const contractor = await login('kontraktor');
const contractorAllowed = await contractor('/api/modules/work_permit/records');
check('Kontraktor dapat mengakses izin kerja', contractorAllowed.status === 200);
const contractorBlocked = await contractor('/api/modules/management_review/records');
check('Kontraktor tidak dapat mengakses tinjauan manajemen', contractorBlocked.status === 403);

const operator = await login('operator');
const operatorApprove = await operator('/api/modules/capa/records/1/status', { method: 'POST', body: { status: 'closed' } });
check('Operator tidak dapat menyetujui CAPA', operatorApprove.status === 403 || operatorApprove.status === 404);
const operatorAdmin = await operator('/api/admin/users');
check('Operator tidak dapat membuka manajemen pengguna', operatorAdmin.status === 403);

section('8. Keamanan tingkat baris (row-level security)');
const nationalCount = (await corporate('/api/modules/incident/records?size=200')).json.total;
const portManager = await login('port.manager');
const portCount = (await portManager('/api/modules/incident/records?size=200')).json.total;
check('Corporate melihat data nasional', nationalCount > 0, String(nationalCount));
check('Port manager melihat sebagian data saja', portCount < nationalCount, `${portCount} dari ${nationalCount}`);

const master = await login('nakhoda');
const vesselRecords = (await master('/api/modules/ferry_safety_checklist/records?size=200')).json;
check('Nakhoda melihat checklist kapalnya', vesselRecords.total > 0, String(vesselRecords.total));
check('Seluruh checklist berasal dari satu kapal',
  new Set(vesselRecords.records.map((r) => r.vessel_id)).size === 1);

section('9. Dashboard');
for (const key of ['executive', 'incident', 'risk', 'audit', 'quality', 'health', 'carbon', 'esg', 'vessel', 'port', 'contractor', 'asset', 'training', 'bsc', 'analytics']) {
  const res = await corporate(`/api/dashboard/${key}`);
  check(`Dashboard ${key} merespons`, res.status === 200 && res.json !== null, res.json?.error);
}
const exec = (await corporate('/api/dashboard/executive')).json;
check('Indikator eksekutif terisi', exec.cards.incidents > 0 && exec.cards.manhours > 0);
check('Peta panas risiko berukuran 5×5', exec.riskHeatmap.length === 5 && exec.riskHeatmap.every((r) => r.length === 5));
check('Emisi karbon terhitung', exec.cards.carbonTon > 0, String(exec.cards.carbonTon));
const alerts = (await corporate('/api/dashboard/alerts')).json;
check('Peringatan kedaluwarsa terdeteksi', alerts.alerts.length > 0, String(alerts.alerts.length));

section('10. Ekspor & administrasi');
const csv = await corporate('/api/modules/incident/export');
check('Ekspor CSV menghasilkan berkas', csv.status === 200 && csv.text.includes('Kode,Status'));
const users = await corporate('/api/admin/users');
check('Daftar pengguna terbaca oleh corporate QHSE', users.status === 200 && users.json.users.length >= 11);
const perms = await corporate('/api/admin/permissions/operator');
check('Matriks hak akses terbaca', perms.json.permissions.length === 116);
const permWrite = await corporate('/api/admin/permissions/operator', { method: 'PUT', body: { permissions: [] } });
check('Perubahan hak akses dibatasi untuk administrator', permWrite.status === 403);

section('11. Penghapusan & kebersihan data');
const corporateDelete = await corporate(`/api/modules/near_miss/records/${record.id}`, { method: 'DELETE' });
check('Corporate QHSE tidak berwenang menghapus rekaman', corporateDelete.status === 403);

const admin = await login('admin');
const adminDelete = await admin(`/api/modules/near_miss/records/${record.id}`, { method: 'DELETE' });
check('Administrator sistem dapat menghapus rekaman', adminDelete.status === 200);
const afterDelete = await admin(`/api/modules/near_miss/records/${record.id}`);
check('Rekaman terhapus tidak lagi terbaca (soft delete)', afterDelete.status === 404);
await admin(`/api/modules/capa/records/${capa.json.record.id}`, { method: 'DELETE' });

section('12. Model SaaS: halaman publik & langganan');
const publicClient = client();
const overview = await publicClient('/api/public/overview');
check('Ikhtisar produk dapat diakses tanpa sesi', overview.status === 200 && overview.json.product.moduleCount > 0);
check('Kelompok komersial tidak diiklankan sebagai modul', !overview.json.groups.some((g) => g.key === 'saas'));

const publicPlans = await publicClient('/api/public/plans');
check('Paket langganan terbuka untuk publik', publicPlans.status === 200 && publicPlans.json.plans.length === 3);
const essential = publicPlans.json.plans.find((p) => p.name === 'Esensial');
const enterprise = publicPlans.json.plans.find((p) => p.name === 'Maritim Enterprise');
check('Paket memuat harga bulanan', essential?.monthlyPrice > 0, String(essential?.monthlyPrice));
check('Paket lebih tinggi memuat lebih banyak modul', enterprise.moduleCount > essential.moduleCount, `${enterprise.moduleCount} vs ${essential.moduleCount}`);

const lead = await publicClient('/api/public/trial-request', {
  method: 'POST',
  body: { organisation: 'Cabang Uji Smoke Test', contact_name: 'Petugas Uji', email: 'smoke@asdp.id', plan_interest: 'Profesional' },
});
check('Permintaan uji coba publik tercatat', lead.status === 201 && /^LEAD\//.test(lead.json.code || ''), lead.json?.error);
const badLead = await publicClient('/api/public/trial-request', { method: 'POST', body: { organisation: 'X' } });
check('Permintaan uji coba tidak lengkap ditolak', badLead.status === 400);

section('13. Pembatasan modul berdasarkan paket');
const ketapang = await login('qhse.ketapang');
const ketapangMe = await ketapang('/api/auth/me');
check('Ringkasan langganan tersedia bagi pengguna cabang', ketapangMe.json.subscription?.planName === 'Profesional', ketapangMe.json.subscription?.planName);
check('Modul aktif lebih sedikit dari total platform',
  ketapangMe.json.subscription.moduleCount < ketapangMe.json.subscription.totalModules,
  `${ketapangMe.json.subscription.moduleCount}/${ketapangMe.json.subscription.totalModules}`);

const inPlan = await ketapang('/api/modules/incident/records');
check('Modul dalam paket dapat diakses', inPlan.status === 200);
const outOfPlan = await ketapang('/api/modules/ferry_safety_checklist/records');
check('Modul di luar paket ditolak dengan 402', outOfPlan.status === 402, String(outOfPlan.status));
check('Pesan penolakan menyebutkan nama paket', /Profesional/.test(outOfPlan.json?.error || ''), outOfPlan.json?.error);
const outOfPlanWrite = await ketapang('/api/modules/marine_incident/records', { method: 'POST', body: { title: 'x' } });
check('Penulisan modul di luar paket juga ditolak', outOfPlanWrite.status === 402);
const platformModule = await ketapang('/api/modules/subscription_plan/records');
check('Modul pengelola platform tertutup bagi tenant', platformModule.status === 403);
const ownInvoice = await ketapang('/api/modules/invoice/records');
check('Cabang tetap dapat melihat tagihannya sendiri', ownInvoice.status === 200 && ownInvoice.json.total > 0, String(ownInvoice.json?.total));

const enterpriseTenant = await login('port.manager');
const maritimeOk = await enterpriseTenant('/api/modules/ferry_safety_checklist/records');
check('Cabang paket Enterprise mengakses modul maritim', maritimeOk.status === 200);

section('14. Dashboard komersial');
const commercial = await corporate('/api/dashboard/subscription');
check('Dashboard langganan tersedia bagi pengelola platform', commercial.status === 200, commercial.json?.error);
check('MRR terhitung dari langganan aktif', commercial.json.cards.mrr > 0, String(commercial.json?.cards?.mrr));
check('ARR setara 12 kali MRR', commercial.json.cards.arr === commercial.json.cards.mrr * 12);
check('Portofolio cabang terisi', commercial.json.tenants.length >= 5, String(commercial.json?.tenants?.length));
check('Piutang tertunggak terdeteksi', commercial.json.cards.outstanding > 0, String(commercial.json?.cards?.outstanding));
const commercialDenied = await ketapang('/api/dashboard/subscription');
check('Dashboard komersial tertutup bagi cabang', commercialDenied.status === 403);

section('15. Kompetensi & pelatihan');
const catalogue = await corporate('/api/modules/training_master/records?size=200');
check('Katalog pelatihan terisi', catalogue.status === 200 && catalogue.json.total >= 40, String(catalogue.json?.total));
const matrix = await corporate('/api/modules/training_matrix/records?size=200');
check('Matriks pelatihan wajib terisi', matrix.json?.total > 0, String(matrix.json?.total));
const supervisorMatrix = matrix.json.records.filter((r) => r.position === 'Supervisor Dermaga');
check('Supervisor Dermaga memiliki 15 pelatihan wajib', supervisorMatrix.length === 15, String(supervisorMatrix.length));

const gapRecords = await corporate('/api/modules/skill_gap/records?size=200');
check('Analisis kesenjangan kompetensi tersedia', gapRecords.json?.total > 0, String(gapRecords.json?.total));
check('Kesenjangan dihitung server (wajib − dimiliki)',
  gapRecords.json.records.every((r) => r.gap_count === Math.max(0, r.required_training_count - r.owned_training_count)));
check('Persentase pemenuhan tidak pernah melebihi 100',
  gapRecords.json.records.every((r) => r.compliance_percent === null || r.compliance_percent <= 100));

const certRecords = await corporate('/api/modules/employee_certification/records?size=200');
check('Sertifikat pegawai tercatat', certRecords.json?.total > 0, String(certRecords.json?.total));
check('Status sertifikat diturunkan dari masa berlaku',
  certRecords.json.records.every((r) => !r.valid_until || ['Berlaku', 'Akan Kedaluwarsa', 'Kedaluwarsa'].includes(r.cert_status)));
const expiredCert = certRecords.json.records.find((r) => r.cert_status === 'Kedaluwarsa');
check('Sertifikat lewat masa berlaku terdeteksi', !!expiredCert, expiredCert?.certificate_name);

const trainingDash = (await corporate('/api/dashboard/training')).json;
check('Dashboard pelatihan menghitung kepatuhan wajib', trainingDash.cards.mandatoryCompliance > 0, String(trainingDash.cards.mandatoryCompliance));
check('Dashboard pelatihan menghitung jam per pegawai', trainingDash.cards.hoursPerEmployee > 0, String(trainingDash.cards.hoursPerEmployee));
check('Kepatuhan per cabang tersedia', trainingDash.complianceByBranch.length > 0, String(trainingDash.complianceByBranch.length));
check('Efektivitas Kirkpatrick level 4 terhitung', trainingDash.cards.incidentReduction !== null, String(trainingDash.cards.incidentReduction));

// Pendaftaran melewati tiga lapis persetujuan; operator boleh mengajukan,
// tetapi hanya pemegang hak approve yang boleh mengonfirmasi peserta.
const registration = await operator('/api/modules/training_registration/records', {
  method: 'POST',
  body: {
    employee_name: 'Yusuf Maulana',
    employee_ref: 1,
    training_ref: catalogue.json.records[0].id,
    training_name: catalogue.json.records[0].name,
    registration_date: new Date().toISOString().slice(0, 10),
    port_id: 1,
  },
});
check('Operator dapat mendaftar pelatihan sendiri', registration.status === 201, registration.json?.error);
const regId = registration.json?.record?.id;
const submit = await operator(`/api/modules/training_registration/records/${regId}/status`, { method: 'POST', body: { status: 'submitted' } });
check('Operator dapat mengajukan pendaftarannya', submit.status === 200, submit.json?.error);
const selfConfirm = await operator(`/api/modules/training_registration/records/${regId}/status`, { method: 'POST', body: { status: 'confirmed' } });
check('Operator tidak dapat mengonfirmasi kursinya sendiri', selfConfirm.status === 403, String(selfConfirm.status));
const qhseConfirm = await corporate(`/api/modules/training_registration/records/${regId}/status`, { method: 'POST', body: { status: 'confirmed' } });
check('QHSE dapat mengonfirmasi peserta', qhseConfirm.status === 200, qhseConfirm.json?.error);
await admin(`/api/modules/training_registration/records/${regId}`, { method: 'DELETE' });

// Pelatihan wajib termasuk pada seluruh paket, termasuk Esensial: kepatuhan
// SMK3 Elemen 12 bukan fitur tambahan.
const bajoe = await login('qhse.bajoe');
const bajoeTraining = await bajoe('/api/modules/training_master/records');
check('Cabang paket Esensial tetap mendapat modul pelatihan', bajoeTraining.status === 200, String(bajoeTraining.status));

section('16. Balanced Scorecard');
const scorecard = (await corporate('/api/dashboard/bsc')).json;
check('Empat perspektif Kaplan & Norton lengkap', scorecard.perspectives.length === 4, String(scorecard.perspectives.length));
check('Setiap perspektif memiliki indikator', scorecard.perspectives.every((p) => p.kpiCount > 0));
check('Bobot tiap perspektif berjumlah 100', scorecard.perspectives.every((p) => p.weightTotal === 100),
  scorecard.perspectives.map((p) => p.weightTotal).join('/'));
const avgOfFour = scorecard.perspectives.reduce((a, p) => a + p.score, 0) / 4;
check('Skor korporat adalah rata-rata keempat perspektif',
  Math.abs(scorecard.overall - avgOfFour) < 0.01, `${scorecard.overall} vs ${avgOfFour.toFixed(2)}`);
check('Perbandingan dengan tahun lalu tersedia', scorecard.overallPrevious !== null, String(scorecard.overallPrevious));
check('Sasaran strategis terkelompok', scorecard.objectives.length > 0, String(scorecard.objectives.length));
check('Daftar sasaran diurutkan dari yang paling tertinggal',
  scorecard.objectives.every((o, i, arr) => i === 0 || (arr[i - 1].score ?? Infinity) <= (o.score ?? Infinity)));

// Target nol ("nihil insiden keamanan informasi") dulu menghasilkan pencapaian
// null dan indikatornya hilang diam-diam dari kartu skor.
const zeroTarget = scorecard.laggingKpis.find((k) => k.target === 0);
check('Indikator bertarget nol tetap dinilai', zeroTarget && zeroTarget.achievement !== null,
  zeroTarget ? `${zeroTarget.title} = ${zeroTarget.achievement}%` : 'tidak ada indikator bertarget nol');

const bscPort = await portManager('/api/dashboard/bsc');
check('Kartu skor mengikuti cakupan akses pengguna', bscPort.status === 200
  && bscPort.json.perspectives.reduce((a, p) => a + p.kpiCount, 0)
     < scorecard.perspectives.reduce((a, p) => a + p.kpiCount, 0));

section('17. Dashboard analitik');
const analytics = (await corporate('/api/dashboard/analytics')).json;
check('Rekaman lintas modul terhitung', analytics.cards.totalRecords > 1000, String(analytics.cards.totalRecords));
check('Peringkat antar cabang tersedia', analytics.branches.length >= 5, String(analytics.branches.length));
check('Indeks kinerja berada pada rentang 0-100',
  analytics.branches.every((b) => b.index >= 0 && b.index <= 100));
check('Peringkat terurut menurun', analytics.branches.every((b, i, arr) => i === 0 || arr[i - 1].index >= b.index));
check('Pareto berakhir pada 100% kumulatif', (() => {
  const rows = analytics.pareto.incidentType.rows;
  return rows.length > 0 && rows.at(-1).cumulative <= 100.01;
})());
check('Persen kumulatif menaik', analytics.pareto.incidentType.rows.every((r, i, arr) => i === 0 || arr[i - 1].cumulative <= r.cumulative));
check('Perbandingan antar tahun memuat kedua tahun', analytics.yearOverYear.every((y) => typeof y.current === 'number' && typeof y.previous === 'number'));
check('Kecepatan penutupan bukan nol hari untuk seluruh modul',
  analytics.closure.some((c) => c.days > 0), analytics.closure.map((c) => c.days).join('/'));
check('Korelasi berada pada rentang -1 sampai 1',
  analytics.leadingLagging.correlation === null || Math.abs(analytics.leadingLagging.correlation) <= 1,
  String(analytics.leadingLagging.correlation));

const analyticsPort = await portManager('/api/dashboard/analytics');
check('Analitik mengikuti keamanan tingkat baris',
  analyticsPort.status === 200 && analyticsPort.json.cards.totalRecords < analytics.cards.totalRecords,
  `${analyticsPort.json?.cards?.totalRecords} < ${analytics.cards.totalRecords}`);

section('18. Dashboard kustom yang dapat disunting');
const dashList = await corporate('/api/custom-dashboards');
check('Daftar dashboard kustom terbaca', dashList.status === 200 && dashList.json.dashboards.length >= 1);
check('Corporate QHSE berwenang menyunting', dashList.json.canEdit === true);

const sample = (await corporate('/api/custom-dashboards/ringkasan-direksi')).json;
check('Dashboard contoh memuat widget', sample.layout.length >= 8, String(sample.layout?.length));
check('Seluruh widget dapat dihitung', sample.data.every((d) => d.ok), sample.data.filter((d) => !d.ok).map((d) => d.reason).join('; '));
check('Tata letak menyimpan ukuran dan gaya',
  sample.layout.every((w) => w.layout?.span >= 2 && w.style && typeof w.style.accent === 'string'));

// Widget tidak boleh menjadi jalan pintas melewati keamanan tingkat baris:
// angkanya harus sama persis dengan yang dilihat pengguna pada daftar rekaman.
const widgetOf = (call, body) => call('/api/custom-dashboards/preview', { method: 'POST', body });
const opIncidentList = (await operator('/api/modules/incident/records?size=1')).json.total;
const opIncidentWidget = await widgetOf(operator, { widget: { kind: 'stat', source: { module: 'incident', metric: 'count', period: 'all' } } });
check('Angka widget sama dengan daftar rekaman pengguna yang sama',
  opIncidentWidget.json.result.value === opIncidentList, `${opIncidentWidget.json?.result?.value} vs ${opIncidentList}`);

const pmIncidentList = (await portManager('/api/modules/incident/records?size=1')).json.total;
const pmIncidentWidget = await widgetOf(portManager, { widget: { kind: 'stat', source: { module: 'incident', metric: 'count', period: 'all' } } });
check('Cakupan berbeda menghasilkan angka berbeda',
  pmIncidentWidget.json.result.value === pmIncidentList && pmIncidentList !== opIncidentList,
  `${pmIncidentList} vs ${opIncidentList}`);

const planBlockedWidget = await widgetOf(ketapang, { widget: { kind: 'stat', source: { module: 'ferry_safety_checklist', metric: 'count' } } });
check('Widget menolak modul di luar paket langganan',
  planBlockedWidget.json.result.ok === false && /paket/i.test(planBlockedWidget.json.result.reason), planBlockedWidget.json?.result?.reason);

// Nama kolom datang dari klien; harus dicocokkan dengan registry, bukan
// diselipkan begitu saja ke dalam SQL.
const injected = await widgetOf(corporate, {
  widget: { kind: 'bar', source: { module: 'incident', metric: 'groupBy', groupField: '(SELECT password_hash FROM users)' } },
});
check('Nama kolom karangan ditolak', injected.json.result.ok === false, JSON.stringify(injected.json?.result));

const noSuchModule = await widgetOf(corporate, { widget: { kind: 'stat', source: { module: 'm_users', metric: 'count' } } });
check('Modul karangan ditolak', noSuchModule.json.result.ok === false);

const operatorSave = await operator('/api/custom-dashboards/ringkasan-direksi', { method: 'PUT', body: { layout: [] } });
check('Pengguna biasa tidak dapat menyimpan tata letak', operatorSave.status === 403, String(operatorSave.status));
const operatorCreate = await operator('/api/custom-dashboards', { method: 'POST', body: { name: 'Coba' } });
check('Pengguna biasa tidak dapat membuat dashboard', operatorCreate.status === 403);

const madeByAdmin = await corporate('/api/custom-dashboards', {
  method: 'POST',
  body: { name: 'Uji Otomatis Dashboard', icon: '🧪', layout: [] },
});
check('Administrator dapat membuat dashboard', madeByAdmin.status === 201, madeByAdmin.json?.error);
const newKey = madeByAdmin.json.key;

// Nilai di luar batas dibersihkan server, bukan dipercaya apa adanya.
const savedLayout = await corporate(`/api/custom-dashboards/${newKey}`, {
  method: 'PUT',
  body: {
    layout: [{
      id: 'x1', title: 'Widget uji', kind: 'stat',
      source: { module: 'incident', metric: 'count', period: 'year', dateField: 'incident_date' },
      layout: { span: 99, height: 5000 },
      style: { accent: 'javascript:alert(1)', opacity: 12, gradientAngle: 999, radius: 900 },
    }],
  },
});
check('Tata letak tersimpan', savedLayout.status === 200, savedLayout.json?.error);
const w = savedLayout.json.layout[0];
check('Lebar dibatasi 12 kolom', w.layout.span === 12, String(w.layout.span));
check('Tinggi dibatasi 900px', w.layout.height === 900, String(w.layout.height));
check('Transparansi dibatasi 1', w.style.opacity === 1, String(w.style.opacity));
check('Warna bukan heksadesimal ditolak', w.style.accent === '#1189c1', w.style.accent);
check('Sudut gradasi dibatasi 360', w.style.gradientAngle === 360, String(w.style.gradientAngle));
check('Kelengkungan dibatasi 40', w.style.radius === 40, String(w.style.radius));

const reread = (await corporate(`/api/custom-dashboards/${newKey}`)).json;
check('Widget tersimpan dapat dihitung ulang', reread.data[0]?.ok === true, reread.data?.[0]?.reason);

const deleteByCorporate = await corporate(`/api/custom-dashboards/${newKey}`, { method: 'DELETE' });
check('Penghapusan dashboard khusus administrator sistem', deleteByCorporate.status === 403, String(deleteByCorporate.status));
const deleted = await admin(`/api/custom-dashboards/${newKey}`, { method: 'DELETE' });
check('Administrator sistem dapat menghapus dashboard', deleted.status === 200);
check('Dashboard terhapus tidak lagi terbaca', (await corporate(`/api/custom-dashboards/${newKey}`)).status === 404);

const sources = await corporate('/api/custom-dashboards/sources');
check('Katalog sumber widget tersedia', sources.status === 200 && sources.json.modules.length > 50, String(sources.json?.modules?.length));
check('Katalog hanya memuat modul yang boleh dilihat',
  (await ketapang('/api/custom-dashboards/sources')).json.modules.length < sources.json.modules.length);

section('19. Dwibahasa Indonesia & Inggris');
const metaId = (await corporate('/api/meta?lang=id')).json;
const metaEn = (await corporate('/api/meta?lang=en')).json;
check('Bahasa dilaporkan pada metadata', metaId.lang === 'id' && metaEn.lang === 'en');
check('Dua bahasa tersedia', Array.isArray(metaEn.languages) && metaEn.languages.length === 2);

const incId = metaId.modules.find((m) => m.key === 'incident');
const incEn = metaEn.modules.find((m) => m.key === 'incident');
check('Nama modul berpindah bahasa', incId.nameId !== incEn.nameId && incEn.nameId === 'Incident',
  `${incId.nameId} -> ${incEn.nameId}`);
check('Nama kelompok berpindah bahasa', incId.groupName !== incEn.groupName,
  `${incId.groupName} -> ${incEn.groupName}`);
check('Label isian berpindah bahasa',
  incId.fields[0].label === 'Judul Kejadian' && incEn.fields[0].label === 'Event Title',
  `${incId.fields[0].label} -> ${incEn.fields[0].label}`);
check('Nama status berpindah bahasa',
  incEn.workflow.some((w) => w.label === 'Closed') && incId.workflow.some((w) => w.label === 'Ditutup'));
check('Nama peran berpindah bahasa',
  metaEn.roles[0].name === 'System Administrator' && metaId.roles[0].name === 'Administrator Sistem');
check('Tingkat risiko berpindah bahasa',
  metaEn.riskBands[0].level === 'Low' && metaId.riskBands[0].level === 'Rendah');

// Nilai tersimpan TIDAK boleh ikut berpindah bahasa: rekaman yang dibuat dalam
// bahasa Inggris harus tetap cocok dengan penyaring dalam bahasa Indonesia.
const sevId = incId.fields.find((f) => f.name === 'severity_class');
const sevEn = incEn.fields.find((f) => f.name === 'severity_class');
if (sevId?.options?.length) {
  const valId = sevId.options.map((o) => (typeof o === 'string' ? o : o.value));
  const valEn = sevEn.options.map((o) => (typeof o === 'string' ? o : o.value));
  check('Nilai opsi tetap sama di kedua bahasa', JSON.stringify(valId) === JSON.stringify(valEn));
}
const anyTranslated = metaEn.modules.some((m) => m.fields.some((f) => (f.options || []).some(
  (o) => typeof o === 'object' && o.label !== o.value)));
check('Label opsi diterjemahkan terpisah dari nilainya', anyTranslated);

check('Struktur katalog kedua bahasa identik',
  metaId.modules.length === metaEn.modules.length && metaId.groups.length === metaEn.groups.length);
check('Setiap modul tetap punya label di bahasa Inggris',
  metaEn.modules.every((m) => m.fields.every((f) => typeof f.label === 'string' && f.label.length > 0)));

// Preferensi bahasa tersimpan pada akun, bukan hanya di peramban.
const setLang = await corporate('/api/auth/language', { method: 'PUT', body: { language: 'en' } });
check('Bahasa dapat disimpan pada akun', setLang.status === 200 && setLang.json.language === 'en');
const metaDefault = (await corporate('/api/meta')).json;
check('Metadata tanpa parameter mengikuti preferensi akun', metaDefault.lang === 'en', metaDefault.lang);
const badLang = await corporate('/api/auth/language', { method: 'PUT', body: { language: 'fr' } });
check('Bahasa yang tidak didukung ditolak', badLang.status === 400);
await corporate('/api/auth/language', { method: 'PUT', body: { language: 'id' } });
check('Preferensi dapat dikembalikan', (await corporate('/api/meta')).json.lang === 'id');

console.log(`\n${'─'.repeat(56)}`);
console.log(`  ${passed} lulus, ${failed} gagal`);
console.log(`${'─'.repeat(56)}\n`);
process.exit(failed ? 1 : 0);
