/**
 * End-to-end smoke test against a running server.
 *
 *   npm start           (terminal 1)
 *   npm run check       (terminal 2)
 *
 * Verifies authentication, RBAC boundaries, row-level security, the generic
 * CRUD engine, workflow transitions, CAPA linkage and every dashboard.
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
check('Seluruh modul termuat (93)', health.modules === 93, `modules=${health.modules}`);

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
check('Katalog modul dikirim', meta.modules.length === 93, `${meta.modules.length}`);
check('Kelompok fungsi lengkap', meta.groups.length === 13, `${meta.groups.length}`);
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
for (const key of ['executive', 'incident', 'risk', 'audit', 'quality', 'health', 'carbon', 'esg', 'vessel', 'port', 'contractor', 'asset']) {
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
check('Matriks hak akses terbaca', perms.json.permissions.length === 93);
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

console.log(`\n${'─'.repeat(56)}`);
console.log(`  ${passed} lulus, ${failed} gagal`);
console.log(`${'─'.repeat(56)}\n`);
process.exit(failed ? 1 : 0);
