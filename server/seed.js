/**
 * Seed - master data, demo accounts for all ten access levels, and a body of
 * realistic transactional records so every dashboard has something to show.
 *
 *   npm run seed           add anything missing (idempotent)
 *   npm run reset          drop the database file first, then seed
 */
import { rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = process.env.QHSE_DB || resolve(ROOT, 'data', 'qhse.db');

if (process.argv.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${DB_FILE}${suffix}`;
    if (existsSync(f)) rmSync(f);
  }
  console.log('  Basis data lama dihapus.');
}

const { db, migrate, get, run, all, nextCode, setting } = await import('./db.js');
const { seedRoles } = await import('./rbac.js');
const { MODULE_BY_KEY } = await import('./registry/index.js');
const { applyComputed } = await import('./compute.js');
const { hashPassword } = await import('./auth.js');

migrate();
seedRoles();

const nowIso = () => new Date().toISOString();
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000));
const daysAhead = (n) => iso(new Date(Date.now() + n * 86400000));
const monthKey = (back = 0) => {
  const d = new Date();
  const m = new Date(d.getFullYear(), d.getMonth() - back, 1);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
};
const pick = (arr, i) => arr[i % arr.length];

/** Deterministic pseudo-random so repeated seeds produce comparable data. */
let seedState = 20260806;
const rnd = () => {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
};
const randInt = (min, max) => min + Math.floor(rnd() * (max - min + 1));

/* ------------------------------------------------------------------ insert */

let created = 0;

function insert(moduleKey, data, { status, org = {}, createdAt } = {}) {
  const mod = MODULE_BY_KEY.get(moduleKey);
  if (!mod) throw new Error(`Unknown module in seed: ${moduleKey}`);

  const row = {};
  for (const field of mod.fields) {
    if (!(field.name in data)) continue;
    const value = data[field.name];
    if (value === null || value === undefined) continue;
    row[field.name] = field.type === 'multiselect'
      ? JSON.stringify(Array.isArray(value) ? value : [value])
      : field.type === 'bool'
        ? (value ? 1 : 0)
        : value;
  }
  applyComputed(mod, row);

  row.code = nextCode(mod.codePrefix);
  row.status = status || mod.initialStatus;
  row.region_id = org.region_id ?? null;
  row.branch_id = org.branch_id ?? null;
  row.port_id = org.port_id ?? null;
  row.vessel_id = org.vessel_id ?? null;
  row.owner_id = org.owner_id ?? 1;
  row.created_by = org.created_by ?? org.owner_id ?? 1;
  row.created_at = createdAt || nowIso();
  row.updated_by = row.created_by;
  row.updated_at = row.created_at;
  if (mod.workflow.find((s) => s.key === row.status)?.terminal) row.closed_at = row.created_at;

  const cols = Object.keys(row);
  const res = run(
    `INSERT INTO "${mod.table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => row[c]),
  );
  created += 1;
  return Number(res.lastInsertRowid);
}

const hasRows = (key) => get(`SELECT 1 FROM "${MODULE_BY_KEY.get(key).table}" LIMIT 1`);

/* ------------------------------------------------------------- master data */

console.log('  Memuat master data ...');

setting('company_name', 'PT ASDP Indonesia Ferry (Persero)');

if (!hasRows('company_profile')) {
  insert('company_profile', {
    name: 'PT ASDP Indonesia Ferry (Persero)',
    legal_name: 'PT Angkutan Sungai Danau dan Penyeberangan Indonesia Ferry (Persero)',
    address: 'Jl. Jend. Ahmad Yani Kav. 52A, Cempaka Putih, Jakarta Pusat',
    phone: '(021) 4208911',
    email: 'corsec@asdp.id',
    website: 'https://asdp.id',
    vision: 'Menjadi perusahaan penyeberangan dan kepelabuhanan terdepan di Asia Tenggara yang berkelanjutan.',
    mission: 'Menyelenggarakan jasa angkutan penyeberangan dan kepelabuhanan yang aman, andal, dan ramah lingkungan.',
    qhse_policy: 'Perusahaan berkomitmen menerapkan sistem manajemen terintegrasi mutu, K3, lingkungan, energi, aset, keamanan informasi dan keselamatan pelayaran; mematuhi seluruh peraturan perundangan; mencegah cedera, penyakit akibat kerja dan pencemaran; serta melakukan perbaikan berkelanjutan.',
    policy_date: daysAgo(210),
    policy_signed_by: 'Direktur Utama',
    iso_certificates: ['ISO 9001:2015', 'ISO 14001:2015', 'ISO 45001:2018', 'SMK3 PP 50/2012', 'ISM Code', 'ISPS Code'],
  }, { status: 'active' });
}

const REGIONS = [
  { name: 'Regional I - Sumatera', head_office: 'Bandar Lampung', area_description: 'Sumatera bagian selatan dan Selat Sunda.' },
  { name: 'Regional II - Jawa & Bali', head_office: 'Surabaya', area_description: 'Jawa, Madura, Bali dan Selat Bali.' },
  { name: 'Regional III - Indonesia Timur', head_office: 'Makassar', area_description: 'Sulawesi, Nusa Tenggara, Maluku dan Papua.' },
];

const regionIds = {};
for (const r of REGIONS) {
  const existing = get('SELECT id FROM m_region WHERE name = ?', [r.name]);
  regionIds[r.name] = existing ? existing.id : insert('region', r, { status: 'active' });
}

const BRANCHES = [
  { name: 'Cabang Merak', region: 'Regional I - Sumatera', address: 'Jl. Pelabuhan Merak, Cilegon, Banten', employee_count: 420 },
  { name: 'Cabang Bakauheni', region: 'Regional I - Sumatera', address: 'Bakauheni, Lampung Selatan', employee_count: 380 },
  { name: 'Cabang Ketapang', region: 'Regional II - Jawa & Bali', address: 'Ketapang, Banyuwangi, Jawa Timur', employee_count: 260 },
  { name: 'Cabang Gilimanuk', region: 'Regional II - Jawa & Bali', address: 'Gilimanuk, Jembrana, Bali', employee_count: 210 },
  { name: 'Cabang Bajoe', region: 'Regional III - Indonesia Timur', address: 'Bajoe, Bone, Sulawesi Selatan', employee_count: 140 },
];

const branchIds = {};
for (const b of BRANCHES) {
  const existing = get('SELECT id FROM m_branch WHERE name = ?', [b.name]);
  branchIds[b.name] = existing
    ? existing.id
    : insert('branch', { name: b.name, address: b.address, employee_count: b.employee_count },
      { status: 'active', org: { region_id: regionIds[b.region] } });
}

const PORTS = [
  { name: 'Pelabuhan Merak', branch: 'Cabang Merak', region: 'Regional I - Sumatera', port_class: 'Kelas I', province: 'Banten', city: 'Kota Cilegon', latitude: -5.9285, longitude: 105.9975, berth_count: 7, mb_count: 7, max_draft: 8.5, syahbandar_office: 'KSOP Kelas I Banten', annual_passengers: 6200000, annual_vehicles: 2100000 },
  { name: 'Pelabuhan Bakauheni', branch: 'Cabang Bakauheni', region: 'Regional I - Sumatera', port_class: 'Kelas I', province: 'Lampung', city: 'Lampung Selatan', latitude: -5.8720, longitude: 105.7530, berth_count: 7, mb_count: 7, max_draft: 8.0, syahbandar_office: 'KSOP Kelas II Panjang', annual_passengers: 5900000, annual_vehicles: 2000000 },
  { name: 'Pelabuhan Ketapang', branch: 'Cabang Ketapang', region: 'Regional II - Jawa & Bali', port_class: 'Kelas I', province: 'Jawa Timur', city: 'Banyuwangi', latitude: -8.1440, longitude: 114.3910, berth_count: 6, mb_count: 5, max_draft: 7.0, syahbandar_office: 'KSOP Tanjung Wangi', annual_passengers: 4100000, annual_vehicles: 1500000 },
  { name: 'Pelabuhan Gilimanuk', branch: 'Cabang Gilimanuk', region: 'Regional II - Jawa & Bali', port_class: 'Kelas I', province: 'Bali', city: 'Jembrana', latitude: -8.1620, longitude: 114.4380, berth_count: 6, mb_count: 5, max_draft: 7.0, syahbandar_office: 'KSOP Gilimanuk', annual_passengers: 4000000, annual_vehicles: 1450000 },
  { name: 'Pelabuhan Bajoe', branch: 'Cabang Bajoe', region: 'Regional III - Indonesia Timur', port_class: 'Kelas II', province: 'Sulawesi Selatan', city: 'Bone', latitude: -4.5330, longitude: 120.4160, berth_count: 2, mb_count: 2, max_draft: 6.0, syahbandar_office: 'KSOP Bajoe', annual_passengers: 320000, annual_vehicles: 110000 },
];

const portIds = {};
for (const p of PORTS) {
  const existing = get('SELECT id FROM m_port WHERE name = ?', [p.name]);
  if (existing) { portIds[p.name] = existing.id; continue; }
  const { branch, region, ...fields } = p;
  portIds[p.name] = insert('port', {
    ...fields,
    harbourmaster: 'Kepala KSOP',
    operating_hours: '24 jam',
    env_permit_no: `660/UKL-UPL/${randInt(100, 999)}/2023`,
    env_permit_expiry: daysAhead(randInt(120, 900)),
    tps_b3_permit_no: `660.1/TPS-B3/${randInt(10, 99)}/2024`,
    tps_b3_permit_expiry: daysAhead(randInt(30, 700)),
  }, { status: 'active', org: { region_id: regionIds[region], branch_id: branchIds[branch] } });
}

const VESSELS = [
  { name: 'KMP Portlink III', region: 'Regional I - Sumatera', branch: 'Cabang Merak', gt: 4200, pax: 1200, veh: 180, route: 'Merak - Bakauheni', year: 2016 },
  { name: 'KMP Jatra I', region: 'Regional I - Sumatera', branch: 'Cabang Merak', gt: 3800, pax: 950, veh: 150, route: 'Merak - Bakauheni', year: 2009 },
  { name: 'KMP Batumandi', region: 'Regional I - Sumatera', branch: 'Cabang Bakauheni', gt: 3500, pax: 900, veh: 140, route: 'Bakauheni - Merak', year: 2011 },
  { name: 'KMP Gilimanuk II', region: 'Regional II - Jawa & Bali', branch: 'Cabang Ketapang', gt: 1800, pax: 500, veh: 70, route: 'Ketapang - Gilimanuk', year: 2013 },
  { name: 'KMP Nusa Dua', region: 'Regional II - Jawa & Bali', branch: 'Cabang Gilimanuk', gt: 1650, pax: 450, veh: 65, route: 'Gilimanuk - Ketapang', year: 2008 },
  { name: 'KMP Bontoharu', region: 'Regional III - Indonesia Timur', branch: 'Cabang Bajoe', gt: 1400, pax: 400, veh: 55, route: 'Bajoe - Kolaka', year: 2012 },
];

const vesselIds = {};
for (const v of VESSELS) {
  const existing = get('SELECT id FROM m_vessel WHERE name = ?', [v.name]);
  if (existing) { vesselIds[v.name] = existing.id; continue; }
  vesselIds[v.name] = insert('vessel', {
    name: v.name,
    call_sign: `YB${randInt(1000, 9999)}`,
    imo_number: `9${randInt(100000, 999999)}`,
    mmsi: `525${randInt(100000, 999999)}`,
    vessel_type: 'KMP Ro-Ro',
    gt: v.gt,
    dwt: Math.round(v.gt * 0.45),
    loa: Math.round(60 + v.gt / 90),
    breadth: Math.round(12 + v.gt / 600),
    draft: 4.2,
    year_built: v.year,
    shipyard: 'PT Dok & Perkapalan Surabaya',
    pax_capacity: v.pax,
    vehicle_capacity: v.veh,
    crew_capacity: 28,
    deck_count: 2,
    route: v.route,
    class_society: 'BKI',
    class_notation: 'A100 P "Ro-Ro Passenger Ship"',
    class_survey_due: daysAhead(randInt(20, 500)),
    docking_last: daysAgo(randInt(120, 600)),
    docking_next: daysAhead(randInt(15, 400)),
    smc_no: `SMC/${randInt(1000, 9999)}/2024`,
    smc_expiry: daysAhead(randInt(25, 800)),
    issc_no: `ISSC/${randInt(1000, 9999)}/2024`,
    issc_expiry: daysAhead(randInt(40, 800)),
    sertifikat_keselamatan_no: `PK.001/${randInt(100, 999)}/KSOP`,
    sertifikat_keselamatan_expiry: daysAhead(randInt(10, 400)),
    operational_status: 'Beroperasi',
  }, { status: 'active', org: { region_id: regionIds[v.region], branch_id: branchIds[v.branch] } });
}

console.log(`  Master organisasi: ${REGIONS.length} regional, ${BRANCHES.length} cabang, ${PORTS.length} pelabuhan, ${VESSELS.length} kapal.`);

/* ------------------------------------------------------------------ users */

const DEMO_PASSWORD = process.env.QHSE_SEED_PASSWORD || 'Asdp#2026Qhse';

const USERS = [
  { username: 'admin', full_name: 'Administrator Sistem', role_key: 'sysadmin', position: 'IT System Administrator' },
  { username: 'corporate.qhse', full_name: 'Dwi Rahmawati', role_key: 'corporate_qhse', position: 'VP QHSE Korporat' },
  { username: 'regional.qhse', full_name: 'Bambang Setiawan', role_key: 'regional_qhse', position: 'Manager QHSE Regional I', region: 'Regional I - Sumatera' },
  { username: 'port.manager', full_name: 'Hendra Gunawan', role_key: 'port_manager', position: 'General Manager Pelabuhan Merak', region: 'Regional I - Sumatera', branch: 'Cabang Merak', port: 'Pelabuhan Merak' },
  { username: 'nakhoda', full_name: 'Capt. Ridwan Saleh', role_key: 'vessel_master', position: 'Nakhoda KMP Portlink III', region: 'Regional I - Sumatera', branch: 'Cabang Merak', port: 'Pelabuhan Merak', vessel: 'KMP Portlink III' },
  { username: 'dept.head', full_name: 'Sri Wahyuni', role_key: 'dept_head', position: 'Manager Teknik & Fasilitas', region: 'Regional I - Sumatera', branch: 'Cabang Merak' },
  { username: 'supervisor', full_name: 'Agus Prasetyo', role_key: 'supervisor', position: 'Supervisor Operasi Dermaga', region: 'Regional I - Sumatera', branch: 'Cabang Merak', port: 'Pelabuhan Merak' },
  { username: 'operator', full_name: 'Yusuf Maulana', role_key: 'operator', position: 'Petugas Movable Bridge', region: 'Regional I - Sumatera', branch: 'Cabang Merak', port: 'Pelabuhan Merak' },
  { username: 'kontraktor', full_name: 'Rina Kartika', role_key: 'contractor', position: 'HSE Officer PT Bahari Teknik', region: 'Regional I - Sumatera', branch: 'Cabang Merak', port: 'Pelabuhan Merak' },
  { username: 'auditor', full_name: 'Tri Handoko', role_key: 'auditor', position: 'Lead Auditor SMT' },
  { username: 'qhse.ketapang', full_name: 'Made Suardana', role_key: 'port_manager', position: 'General Manager Pelabuhan Ketapang', region: 'Regional II - Jawa & Bali', branch: 'Cabang Ketapang', port: 'Pelabuhan Ketapang' },
];

const userIds = {};
for (const u of USERS) {
  const existing = get('SELECT id FROM users WHERE username = ?', [u.username]);
  if (existing) { userIds[u.username] = existing.id; continue; }
  const { hash, salt } = hashPassword(DEMO_PASSWORD);
  const res = run(
    `INSERT INTO users (username, full_name, email, position, password_hash, password_salt, role_key,
                        region_id, branch_id, port_id, vessel_id, active, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
    [
      u.username, u.full_name, `${u.username}@asdp.id`, u.position, hash, salt, u.role_key,
      u.region ? regionIds[u.region] : null,
      u.branch ? branchIds[u.branch] : null,
      u.port ? portIds[u.port] : null,
      u.vessel ? vesselIds[u.vessel] : null,
      nowIso(), nowIso(),
    ],
  );
  userIds[u.username] = Number(res.lastInsertRowid);
}

const MERAK = { region_id: regionIds['Regional I - Sumatera'], branch_id: branchIds['Cabang Merak'], port_id: portIds['Pelabuhan Merak'], owner_id: userIds['port.manager'] };
const BAKAUHENI = { region_id: regionIds['Regional I - Sumatera'], branch_id: branchIds['Cabang Bakauheni'], port_id: portIds['Pelabuhan Bakauheni'], owner_id: userIds['regional.qhse'] };
const KETAPANG = { region_id: regionIds['Regional II - Jawa & Bali'], branch_id: branchIds['Cabang Ketapang'], port_id: portIds['Pelabuhan Ketapang'], owner_id: userIds['qhse.ketapang'] };
const GILIMANUK = { region_id: regionIds['Regional II - Jawa & Bali'], branch_id: branchIds['Cabang Gilimanuk'], port_id: portIds['Pelabuhan Gilimanuk'], owner_id: userIds['qhse.ketapang'] };
const BAJOE = { region_id: regionIds['Regional III - Indonesia Timur'], branch_id: branchIds['Cabang Bajoe'], port_id: portIds['Pelabuhan Bajoe'], owner_id: userIds['corporate.qhse'] };
const CORPORATE = { owner_id: userIds['corporate.qhse'] };
const SITES = [MERAK, BAKAUHENI, KETAPANG, GILIMANUK, BAJOE];
const VESSEL_SITE = (name) => {
  const v = VESSELS.find((x) => x.name === name);
  return {
    region_id: regionIds[v.region],
    branch_id: branchIds[v.branch],
    port_id: portIds[PORTS.find((p) => p.branch === v.branch)?.name] ?? null,
    vessel_id: vesselIds[name],
    // The master owns records for his own vessel; the rest sit with regional QHSE.
    owner_id: name === 'KMP Portlink III' ? userIds['nakhoda'] : userIds['regional.qhse'],
  };
};

console.log(`  Pengguna: ${USERS.length} akun demo (kata sandi: ${DEMO_PASSWORD}).`);

/* ------------------------------------------- employees, assets, contractors */

if (!hasRows('org_unit')) {
  const UNITS = [
    { name: 'Direktorat Operasi', level: 'Direktorat', responsibility: 'Kebijakan operasi kapal dan pelabuhan.', org: CORPORATE },
    { name: 'Divisi QHSE Korporat', level: 'Divisi', responsibility: 'Pengelolaan sistem manajemen terintegrasi, audit internal, dan pelaporan kinerja QHSE.', org: CORPORATE },
    { name: 'P2K3 Cabang Merak', level: 'Cabang', responsibility: 'Panitia Pembina K3 sesuai Permenaker No. 04/MEN/1987.', is_p2k3: true, org: MERAK },
    { name: 'Departemen Teknik Merak', level: 'Departemen', responsibility: 'Pemeliharaan dermaga, movable bridge dan utilitas.', org: MERAK },
    { name: 'Departemen Operasi Ketapang', level: 'Departemen', responsibility: 'Pengaturan sandar, bongkar muat dan pelayanan penumpang.', org: KETAPANG },
  ];
  for (const u of UNITS) {
    const { org, ...fields } = u;
    insert('org_unit', { ...fields, headcount: randInt(8, 60) }, { status: 'active', org });
  }
}

const EMPLOYEE_NAMES = [
  ['Ahmad Fauzi', 'Operator Movable Bridge', MERAK], ['Siti Nurhaliza', 'Petugas Loket', MERAK],
  ['Joko Susilo', 'Teknisi Listrik', MERAK], ['Dewi Anggraini', 'Perawat Klinik', MERAK],
  ['Rudi Hartono', 'Petugas Tambat', BAKAUHENI], ['Nia Ramadhani', 'Petugas Keamanan', BAKAUHENI],
  ['I Wayan Sudira', 'Operator Gangway', KETAPANG], ['Ni Kadek Ayu', 'Petugas Kebersihan', KETAPANG],
  ['Slamet Riyadi', 'Juru Mudi', GILIMANUK], ['Andi Baso', 'Kepala Kamar Mesin', BAJOE],
];

if (!hasRows('employee')) {
  EMPLOYEE_NAMES.forEach(([name, position, org], i) => {
    insert('employee', {
      name,
      nip: `ASDP${String(20260001 + i)}`,
      employment_type: pick(['Organik', 'PKWT', 'ABK'], i),
      position,
      department: pick(['Operasi', 'Teknik', 'QHSE', 'Umum'], i),
      join_date: daysAgo(randInt(400, 4000)),
      gender: i % 3 === 1 ? 'Perempuan' : 'Laki-laki',
      work_location_type: org === CORPORATE ? 'Kantor Pusat' : 'Pelabuhan',
      certifications: pick([['Ahli K3 Umum'], ['Petugas P3K'], ['Operator Forklift'], ['BST', 'SCRB'], ['ANT-III']], i),
      cert_expiry: daysAhead(randInt(-30, 700)),
      last_mcu: daysAgo(randInt(30, 400)),
      fit_to_work: i % 7 === 0 ? 'Fit with Note' : 'Fit',
      emergency_contact: `08${randInt(1000000000, 9999999999)}`,
    }, { status: 'active', org });
  });
}

const ASSET_SPECS = [
  ['Movable Bridge Dermaga 1', 'Movable Bridge', MERAK, 'Kritis Keselamatan'],
  ['Movable Bridge Dermaga 2', 'Movable Bridge', MERAK, 'Kritis Keselamatan'],
  ['Gangway Penumpang Dermaga 1', 'Gangway', MERAK, 'Kritis Keselamatan'],
  ['Genset Terminal 500 kVA', 'Genset / Generator', MERAK, 'Kritis Operasi'],
  ['Fender Dermaga 3', 'Fender', MERAK, 'Kritis Keselamatan'],
  ['Forklift 3 Ton', 'Forklift', MERAK, 'Pendukung'],
  ['Movable Bridge Dermaga 1 Bakauheni', 'Movable Bridge', BAKAUHENI, 'Kritis Keselamatan'],
  ['IPAL Terminal Bakauheni', 'IPAL', BAKAUHENI, 'Kritis Operasi'],
  ['TPS Limbah B3 Bakauheni', 'TPS Limbah B3', BAKAUHENI, 'Kritis Operasi'],
  ['Movable Bridge Ketapang', 'Movable Bridge', KETAPANG, 'Kritis Keselamatan'],
  ['Crane Pelabuhan Ketapang', 'Crane', KETAPANG, 'Kritis Keselamatan'],
  ['Pompa Kebakaran Terminal Gilimanuk', 'Pompa Kebakaran', GILIMANUK, 'Kritis Keselamatan'],
  ['Ramp Door Haluan KMP Portlink III', 'Ramp Door', VESSEL_SITE('KMP Portlink III'), 'Kritis Keselamatan'],
  ['Mesin Induk KMP Portlink III', 'Mesin Induk Kapal', VESSEL_SITE('KMP Portlink III'), 'Kritis Operasi'],
  ['Ramp Door Buritan KMP Jatra I', 'Ramp Door', VESSEL_SITE('KMP Jatra I'), 'Kritis Keselamatan'],
  ['Bejana Tekan Udara KMP Nusa Dua', 'Bejana Tekan', VESSEL_SITE('KMP Nusa Dua'), 'Kritis Operasi'],
];

const assetIds = {};
if (!hasRows('asset')) {
  ASSET_SPECS.forEach(([name, category, org, klass], i) => {
    assetIds[name] = insert('asset', {
      name,
      category,
      asset_class: klass,
      manufacturer: pick(['MacGregor', 'TTS Marine', 'Cummins', 'Caterpillar', 'Trelleborg', 'Toyota'], i),
      model: `TYPE-${randInt(100, 900)}`,
      serial_number: `SN${randInt(100000, 999999)}`,
      commission_date: daysAgo(randInt(700, 5000)),
      condition: i % 9 === 0 ? 'Perlu Perbaikan' : 'Baik',
      last_inspection: daysAgo(randInt(10, 120)),
      next_inspection: daysAhead(randInt(-10, 180)),
      permit_required: ['Crane', 'Forklift', 'Bejana Tekan', 'Instalasi Listrik'].includes(category),
      permit_number: `SUKET/${randInt(100, 999)}/DISNAKER/2025`,
      permit_expiry: daysAhead(randInt(-20, 600)),
      replacement_value: randInt(2, 90) * 1e8,
    }, { status: 'active', org });
  });
} else {
  for (const row of all('SELECT id, name FROM m_asset')) assetIds[row.name] = row.id;
}

const CONTRACTORS = [
  ['PT Bahari Teknik Nusantara', 'Docking & Reparasi Kapal', 'Tinggi', 88, MERAK],
  ['PT Karya Dermaga Perkasa', 'Konstruksi', 'Tinggi', 76, MERAK],
  ['PT Bersih Mandiri Sejahtera', 'Kebersihan', 'Rendah', 82, BAKAUHENI],
  ['PT Garda Aman Pelabuhan', 'Keamanan', 'Sedang', 79, KETAPANG],
  ['PT Limbah Lestari Indonesia', 'Pengelolaan Limbah', 'Tinggi', 91, BAKAUHENI],
];

const contractorIds = {};
if (!hasRows('contractor')) {
  CONTRACTORS.forEach(([name, work_type, risk, score, org], i) => {
    contractorIds[name] = insert('contractor', {
      name,
      npwp: `0${randInt(10000000, 99999999)}.${randInt(1, 9)}-0${randInt(10, 99)}.000`,
      address: 'Kawasan Industri, Indonesia',
      pic_name: pick(['Rina Kartika', 'Budi Santoso', 'Ratna Sari', 'Firman Hadi'], i),
      pic_phone: `08${randInt(1000000000, 9999999999)}`,
      pic_email: `hse@${name.split(' ')[1].toLowerCase()}.co.id`,
      work_type,
      risk_category: risk,
      contract_no: `PKS/${randInt(100, 999)}/ASDP/2025`,
      contract_start: daysAgo(randInt(60, 400)),
      contract_end: daysAhead(randInt(-15, 500)),
      smk3_certified: score > 80,
      iso45001_certified: score > 85,
      bpjs_compliance: true,
      worker_count: randInt(12, 120),
      csms_score: score,
      csms_grade: score >= 90 ? 'A - Sangat Baik' : score >= 75 ? 'B - Baik' : 'C - Cukup',
      blacklist_status: 'Aktif',
    }, { status: 'active', org });
  });
} else {
  for (const row of all('SELECT id, name FROM m_contractor')) contractorIds[row.name] = row.id;
}

if (!hasRows('manhours')) {
  for (let back = 11; back >= 0; back--) {
    for (const site of SITES) {
      insert('manhours', {
        period: monthKey(back),
        employee_hours: randInt(38000, 72000),
        contractor_hours: randInt(6000, 18000),
        crew_hours: randInt(9000, 22000),
        headcount: randInt(180, 460),
      }, { status: 'active', org: site, createdAt: `${monthKey(back)}-28T08:00:00.000Z` });
    }
  }
}

/* ------------------------------------------------------- safety & incidents */

console.log('  Memuat rekaman K3 & insiden ...');

const INCIDENTS = [
  ['Petugas tambat terjepit tali saat kapal sandar', 'Kecelakaan Kerja - Cedera', 'Lost Time Injury (LTI)', 'Dermaga', 4, 4],
  ['Operator MB terpeleset di area basah', 'Kecelakaan Kerja - Cedera', 'Medical Treatment Case (MTC)', 'Movable Bridge', 3, 2],
  ['Jari tangan tergores saat perbaikan ramp door', 'Kecelakaan Kerja - Cedera', 'First Aid Case (FAC)', 'Kapal - Dek Kendaraan', 2, 2],
  ['Kebakaran kecil pada panel listrik terminal', 'Kebakaran', 'Property Damage', 'Terminal Penumpang', 3, 4],
  ['Kendaraan penumpang menabrak barrier antrian', 'Kecelakaan Kendaraan', 'Property Damage', 'Area Parkir/Antrian', 3, 2],
  ['ABK terjatuh dari tangga ruang mesin', 'Jatuh dari Ketinggian', 'Restricted Work Case (RWC)', 'Kapal - Ruang Mesin', 3, 4],
  ['Tumpahan oli hidrolik movable bridge', 'Tumpahan Bahan Kimia/B3', 'Environmental Damage', 'Movable Bridge', 3, 3],
  ['Petugas kebersihan tersengat listrik ringan', 'Tersengat Listrik', 'Medical Treatment Case (MTC)', 'Terminal Penumpang', 3, 4],
  ['Penumpang terjatuh di gangway licin', 'Kecelakaan Penumpang', 'First Aid Case (FAC)', 'Gangway', 3, 3],
  ['Forklift menabrak rak gudang', 'Kecelakaan Alat Angkat', 'Property Damage', 'Gudang', 2, 3],
];

if (!hasRows('incident')) {
  INCIDENTS.forEach(([title, type, classification, location, likelihood, severity], i) => {
    const site = pick(SITES, i);
    const date = daysAgo(randInt(10, 330));
    const lti = classification === 'Lost Time Injury (LTI)';
    insert('incident', {
      title,
      incident_date: date,
      incident_time: `${String(randInt(6, 21)).padStart(2, '0')}:${String(randInt(0, 59)).padStart(2, '0')}`,
      reported_date: date,
      incident_type: type,
      classification,
      location_type: location,
      exact_location: `Area ${location}`,
      description: `Kejadian terjadi saat kegiatan operasional rutin. ${title}. Korban segera mendapatkan pertolongan pertama dan area diamankan oleh petugas K3.`,
      injured_count: classification === 'Property Damage' || classification === 'Environmental Damage' ? 0 : 1,
      fatality_count: 0,
      victim_category: pick(['Pegawai Organik', 'ABK', 'Kontraktor', 'Penumpang'], i),
      lost_days: lti ? randInt(3, 21) : 0,
      property_loss: classification === 'Property Damage' ? randInt(5, 80) * 1e6 : 0,
      body_part: pick([['Tangan/Jari'], ['Kaki'], ['Kepala'], ['Punggung'], []], i),
      immediate_cause_unsafe_act: 'Tidak mengikuti prosedur kerja aman yang berlaku.',
      immediate_cause_unsafe_condition: 'Kondisi area kerja tidak sepenuhnya terkendali.',
      root_cause: 'Pengawasan pekerjaan belum optimal dan sosialisasi prosedur belum menjangkau seluruh shift.',
      immediate_action: 'Area diisolasi, korban ditangani, pekerjaan dihentikan sementara.',
      investigation_team: 'Tim P2K3 dan Supervisor Area',
      investigation_date: date,
      ppe_used: pick([['Helm', 'Sepatu Safety'], ['Sepatu Safety', 'Rompi Reflektif'], ['Helm', 'Sarung Tangan', 'Sepatu Safety']], i),
      reported_disnaker: lti,
      reported_bpjs: lti,
      reported_kemenhub: false,
      potential_likelihood: String(likelihood),
      potential_severity: String(severity),
      lesson_learned: 'Perlu penguatan toolbox meeting dan inspeksi area sebelum kegiatan.',
    }, { status: i < 7 ? 'closed' : 'action', org: site, createdAt: `${date}T09:00:00.000Z` });
  });
}

if (!hasRows('near_miss')) {
  const NEAR_MISS = [
    ['Tali tambat nyaris putus saat sandar', 'Mekanik (terjepit, terpotong, tertimpa)'],
    ['Kendaraan hampir masuk laut di area antrian', 'Tenggelam / Jatuh ke Laut'],
    ['Beban crane nyaris mengenai pekerja', 'Pengangkatan Beban (Lifting)'],
    ['Percikan api las dekat drum bekas oli', 'Kebakaran & Ledakan'],
    ['Pekerja nyaris terjatuh dari ramp door', 'Ketinggian / Jatuh'],
    ['Kabel terkelupas di ruang panel', 'Listrik'],
    ['Penumpang nyaris tertabrak truk di dek', 'Lalu Lintas Kendaraan'],
    ['Gas terdeteksi saat pembersihan tangki', 'Ruang Terbatas (Confined Space)'],
  ];
  NEAR_MISS.forEach(([title, hazard], i) => {
    const date = daysAgo(randInt(5, 340));
    insert('near_miss', {
      title,
      event_date: date,
      event_time: `${String(randInt(5, 22)).padStart(2, '0')}:00`,
      location_type: pick(['Dermaga', 'Kapal', 'Movable Bridge', 'Area Parkir', 'Terminal Penumpang'], i),
      exact_location: 'Area operasional',
      description: `${title}. Tidak terjadi cedera maupun kerusakan, namun potensi konsekuensinya signifikan.`,
      hazard_type: hazard,
      potential_consequence: 'Potensi cedera serius pada pekerja atau pengguna jasa.',
      potential_likelihood: String(randInt(2, 4)),
      potential_severity: String(randInt(3, 5)),
      immediate_action: 'Kegiatan dihentikan sementara dan dilakukan pengarahan ulang.',
      reporter_anonymous: i % 4 === 0,
    }, { status: pick(['closed', 'verified', 'action'], i), org: pick(SITES, i), createdAt: `${date}T10:00:00.000Z` });
  });
}

if (!hasRows('unsafe_action')) {
  const ACTS = ['Tidak Menggunakan APD', 'Mengabaikan Prosedur', 'Bekerja Tanpa Izin Kerja', 'Merokok di Area Terlarang', 'Posisi Kerja Berbahaya', 'Mengoperasikan Alat Tanpa Kewenangan'];
  for (let i = 0; i < 18; i++) {
    const date = daysAgo(randInt(3, 350));
    insert('unsafe_action', {
      title: `Temuan perilaku tidak aman - ${pick(ACTS, i)}`,
      observed_date: date,
      category: pick(ACTS, i),
      person_observed: 'Pekerja area operasional',
      person_category: pick(['Pegawai', 'Kontraktor', 'ABK', 'Pengguna Jasa'], i),
      exact_location: pick(['Dermaga 1', 'Dermaga 3', 'Ruang Mesin', 'Area Parkir', 'Terminal'], i),
      description: `Teramati ${pick(ACTS, i).toLowerCase()} pada saat kegiatan operasional berlangsung.`,
      severity: pick(['Rendah', 'Sedang', 'Tinggi', 'Kritis'], i),
      corrective_action: 'Diberikan teguran dan pengarahan langsung di lokasi.',
      intervention: pick(['Teguran Lisan', 'Coaching di Tempat', 'Penghentian Pekerjaan (Stop Work)'], i),
      stop_work_applied: i % 6 === 0,
    }, { status: pick(['closed', 'verified', 'action'], i), org: pick(SITES, i), createdAt: `${date}T11:00:00.000Z` });
  }
}

if (!hasRows('unsafe_condition')) {
  const CONDS = ['Housekeeping Buruk', 'Pencahayaan Kurang', 'APAR Kedaluwarsa/Tidak Ada', 'Jalur Evakuasi Terhalang', 'Railing/Pagar Pengaman Rusak', 'Permukaan Licin', 'Fender/Bollard Rusak', 'Instalasi Listrik Tidak Aman'];
  for (let i = 0; i < 16; i++) {
    const date = daysAgo(randInt(3, 350));
    insert('unsafe_condition', {
      title: `Temuan kondisi tidak aman - ${pick(CONDS, i)}`,
      observed_date: date,
      category: pick(CONDS, i),
      exact_location: pick(['Dermaga 2', 'Terminal Penumpang', 'Gangway', 'Ruang Genset', 'Area Parkir'], i),
      description: `Ditemukan ${pick(CONDS, i).toLowerCase()} yang berpotensi menimbulkan cedera.`,
      severity: pick(['Sedang', 'Tinggi', 'Rendah', 'Kritis'], i),
      immediate_action: 'Area diberi rambu peringatan dan dilaporkan ke unit teknik.',
      area_isolated: i % 5 === 0,
      due_date: daysAhead(randInt(-20, 40)),
    }, { status: pick(['closed', 'action', 'investigating'], i), org: pick(SITES, i), createdAt: `${date}T13:00:00.000Z` });
  }
}

if (!hasRows('hira')) {
  const HIRA = [
    ['Kegiatan sandar dan tambat kapal', 'Mekanik (terjepit, terpotong, tertimpa)', 'Tali tambat putus dan mengenai petugas', 4, 4, 2, 4],
    ['Pengoperasian movable bridge', 'Mekanik (terjepit, terpotong, tertimpa)', 'Kegagalan hidrolik saat kendaraan melintas', 3, 5, 2, 4],
    ['Bongkar muat kendaraan di dek', 'Lalu Lintas Kendaraan', 'Penumpang tertabrak kendaraan di dek', 4, 4, 2, 3],
    ['Pengisian bahan bakar (bunkering)', 'Kebakaran & Ledakan', 'Tumpahan BBM dan potensi kebakaran', 3, 5, 2, 4],
    ['Pekerjaan panas di ruang mesin', 'Kebakaran & Ledakan', 'Kebakaran akibat percikan las', 3, 5, 1, 4],
    ['Pembersihan tangki ballast', 'Ruang Terbatas (Confined Space)', 'Kekurangan oksigen dan keracunan gas', 3, 5, 1, 5],
    ['Pemeliharaan instalasi listrik dermaga', 'Listrik', 'Tersengat listrik tegangan menengah', 3, 5, 2, 4],
    ['Pengangkatan suku cadang dengan crane', 'Pengangkatan Beban (Lifting)', 'Beban jatuh mengenai pekerja', 3, 4, 2, 3],
    ['Pelayanan penumpang saat peak season', 'Psikososial', 'Kepadatan penumpang dan potensi berdesakan', 4, 3, 3, 2],
    ['Penanganan limbah B3 di TPS', 'Bahan Kimia / B3', 'Paparan bahan berbahaya pada petugas', 3, 3, 2, 2],
  ];
  HIRA.forEach(([activity, hazard, impact, l, s, rl, rs], i) => {
    insert('hira', {
      title: activity,
      process_activity: activity,
      routine: i % 5 === 4 ? 'Non-Rutin' : 'Rutin',
      exact_location: pick(['Dermaga', 'Kapal', 'Terminal', 'Bengkel'], i),
      hazard_type: hazard,
      hazard_description: `Bahaya ${hazard.toLowerCase()} pada aktivitas ${activity.toLowerCase()}.`,
      potential_impact: impact,
      affected_party: pick([['Pegawai'], ['ABK', 'Kontraktor'], ['Penumpang', 'Pengguna Jasa'], ['Pegawai', 'Lingkungan']], i),
      likelihood: String(l),
      severity: String(s),
      existing_control: 'SOP, izin kerja, APD wajib, pengawasan supervisor, rambu keselamatan.',
      control_hierarchy: pick(['Rekayasa Teknik', 'Administratif', 'APD', 'Substitusi'], i),
      additional_control: 'Penambahan interlock, pelatihan ulang, dan inspeksi berkala.',
      res_likelihood: String(rl),
      res_severity: String(rs),
      required_ppe: pick([['Helm', 'Sepatu Safety', 'Rompi Reflektif'], ['Life Jacket', 'Sepatu Safety'], ['Full Body Harness', 'Helm']], i),
      legal_requirement: pick(['UU No. 1 Tahun 1970', 'PP No. 50 Tahun 2012', 'Permenaker No. 09 Tahun 2016'], i),
      review_date: daysAhead(randInt(-30, 300)),
      acceptability: rl * rs <= 6 ? 'Dapat Diterima dengan Pengendalian' : 'Tidak Dapat Diterima',
    }, { status: pick(['monitored', 'treatment', 'assessed'], i), org: pick(SITES, i), createdAt: `${daysAgo(randInt(30, 340))}T08:00:00.000Z` });
  });
}

if (!hasRows('work_permit')) {
  const PERMITS = [
    ['Perbaikan hidrolik movable bridge dermaga 2', ['Pekerjaan Panas (Hot Work)', 'Listrik / LOTO']],
    ['Pembersihan tangki ballast KMP Jatra I', ['Ruang Terbatas']],
    ['Pengecatan struktur gangway', ['Ketinggian >1.8m']],
    ['Penggantian kabel panel utama terminal', ['Listrik / LOTO']],
    ['Bunkering BBM KMP Portlink III', ['Bunkering BBM']],
    ['Perbaikan fender dermaga 3', ['Pekerjaan di Atas Air', 'Ketinggian >1.8m']],
  ];
  PERMITS.forEach(([title, types], i) => {
    const from = daysAgo(randInt(0, 60));
    insert('work_permit', {
      title,
      permit_types: types,
      work_location: pick(['Dermaga 2', 'Kapal', 'Terminal', 'Dermaga 3'], i),
      valid_from: from,
      valid_to: daysAhead(randInt(-3, 12)),
      shift_time: '08:00 - 17:00',
      executor_type: i % 2 === 0 ? 'Kontraktor' : 'Internal',
      worker_count: randInt(3, 14),
      jsa_ref: `JSA/2026/${String(i + 1).padStart(4, '0')}`,
      required_ppe: ['Helm', 'Sepatu Safety', 'Sarung Tangan', 'Rompi Reflektif'],
      precautions: ['Gas Test Dilakukan', 'Isolasi Energi (LOTO)', 'APAR Tersedia', 'Area Dibarikade', 'Standby Person'],
      gas_test_o2: 20.9,
      gas_test_lel: 0,
      gas_test_h2s: 0,
      gas_test_co: 0,
      gas_test_by: 'Petugas K3 Bersertifikat',
      area_restored: i < 3,
    }, { status: pick(['closed', 'active', 'approved', 'reviewed'], i), org: pick(SITES, i), createdAt: `${from}T07:30:00.000Z` });
  });
}

if (!hasRows('toolbox_meeting')) {
  const TOPICS = ['Bahaya Pekerjaan Hari Ini', 'Penggunaan APD', 'Prosedur Darurat', 'Pembelajaran Insiden', 'Housekeeping', 'Keselamatan Pelayaran'];
  for (let i = 0; i < 24; i++) {
    const date = daysAgo(randInt(1, 350));
    insert('toolbox_meeting', {
      title: `Toolbox meeting shift ${pick(['pagi', 'siang', 'malam'], i)} - ${pick(TOPICS, i)}`,
      meeting_date: date,
      meeting_time: pick(['07:00', '15:00', '23:00'], i),
      location: pick(['Dermaga 1', 'Ruang Briefing', 'Anjungan', 'Bengkel'], i),
      participant_count: randInt(6, 32),
      topic_category: pick(TOPICS, i),
      discussion: 'Pembahasan bahaya pekerjaan hari ini, pengendalian yang harus diterapkan, dan pengingat penggunaan APD.',
      hazards_today: 'Cuaca panas, kepadatan kendaraan, permukaan dermaga basah.',
      commitment: 'Seluruh peserta berkomitmen menerapkan stop work authority bila menemukan kondisi tidak aman.',
      duration_minutes: randInt(10, 25),
    }, { status: 'closed', org: pick(SITES, i), createdAt: `${date}T07:10:00.000Z` });
  }
}

if (!hasRows('safety_observation')) {
  for (let i = 0; i < 20; i++) {
    const date = daysAgo(randInt(1, 350));
    const safe = randInt(12, 40);
    const unsafe = randInt(0, 8);
    insert('safety_observation', {
      title: `Observasi keselamatan berbasis perilaku - ${pick(['Dermaga', 'Kapal', 'Terminal', 'Bengkel'], i)}`,
      observation_date: date,
      area_observed: pick(['Dermaga', 'Kapal', 'Terminal Penumpang', 'Bengkel'], i),
      observation_type: pick(['Perilaku Aman', 'Perilaku Tidak Aman', 'Safety Patrol Manajemen'], i),
      safe_count: safe,
      unsafe_count: unsafe,
      categories_observed: ['Penggunaan APD', 'Posisi Tubuh', 'Prosedur Kerja', 'Housekeeping'],
      findings: unsafe ? 'Ditemukan sebagian pekerja tidak menggunakan APD lengkap.' : 'Seluruh perilaku teramati sesuai standar.',
      feedback_given: 'Coaching langsung diberikan dan diapresiasi untuk perilaku aman.',
      follow_up: 'Diteruskan ke supervisor area untuk pemantauan lanjutan.',
    }, { status: pick(['closed', 'verified'], i), org: pick(SITES, i), createdAt: `${date}T14:00:00.000Z` });
  }
}

if (!hasRows('emergency_response')) {
  const DRILLS = [
    ['Latihan pemadaman kebakaran terminal', 'Latihan (Drill)', 'Kebakaran di Pelabuhan'],
    ['Latihan man overboard', 'Latihan (Drill)', 'Man Overboard'],
    ['Latihan evakuasi penumpang massal', 'Latihan (Drill)', 'Evakuasi Penumpang Massal'],
    ['Latihan penanggulangan tumpahan minyak', 'Latihan (Drill)', 'Tumpahan Minyak'],
    ['Simulasi gempa dan tsunami', 'Simulasi Meja (Tabletop)', 'Tsunami'],
    ['Latihan abandon ship', 'Latihan (Drill)', 'Abandon Ship'],
    ['Kejadian pemadaman listrik total terminal', 'Kejadian Darurat Nyata', 'Kegagalan Listrik Total'],
    ['Latihan tanggap darurat kebakaran kapal', 'Latihan (Drill)', 'Kebakaran di Kapal'],
  ];
  DRILLS.forEach(([title, type, scenario], i) => {
    const date = daysAgo(randInt(10, 340));
    insert('emergency_response', {
      title,
      record_type: type,
      scenario,
      event_date: date,
      event_time: '10:00',
      location: pick(['Terminal Penumpang', 'Dermaga', 'Kapal', 'Kolam Pelabuhan'], i),
      participant_count: randInt(20, 120),
      response_time_minutes: randInt(2, 9),
      evacuation_time_minutes: randInt(6, 22),
      muster_complete: i % 5 !== 0,
      external_agency: pick([['Syahbandar / KSOP', 'Damkar'], ['Basarnas'], ['BPBD', 'Rumah Sakit'], ['Tidak Ada']], i),
      scenario_description: `Skenario ${scenario.toLowerCase()} dijalankan sesuai prosedur tanggap darurat yang berlaku.`,
      evaluation: 'Pelaksanaan berjalan sesuai rencana dengan beberapa catatan waktu respons.',
      weaknesses: 'Koordinasi antar regu masih perlu ditingkatkan; sebagian personil belum hafal titik kumpul.',
      improvement: 'Penyegaran sijil darurat dan penambahan rambu titik kumpul.',
      effectiveness: pick(['Efektif', 'Sangat Efektif', 'Cukup'], i),
      next_drill: daysAhead(randInt(30, 180)),
    }, { status: pick(['closed', 'verified'], i), org: pick(SITES, i), createdAt: `${date}T10:00:00.000Z` });
  });
}

/* ------------------------------------------------------- quality & customer */

console.log('  Memuat rekaman mutu & pelanggan ...');

if (!hasRows('quality_objective')) {
  const KPIS = [
    ['Ketepatan waktu keberangkatan kapal', 'Mutu', '%', 95, 92.4, 'Semakin Tinggi Semakin Baik'],
    ['Indeks kepuasan pengguna jasa', 'Pelayanan Pelanggan', 'indeks', 4.2, 4.05, 'Semakin Tinggi Semakin Baik'],
    ['Frekuensi kecelakaan kerja (LTIFR)', 'K3', 'per 1 juta jam', 0.5, 0.62, 'Semakin Rendah Semakin Baik'],
    ['Penyelesaian CAPA tepat waktu', 'Mutu', '%', 90, 84, 'Semakin Tinggi Semakin Baik'],
    ['Kepatuhan baku mutu lingkungan', 'Lingkungan', '%', 100, 96, 'Semakin Tinggi Semakin Baik'],
    ['Intensitas konsumsi BBM per trip', 'Energi', 'liter/trip', 480, 466, 'Semakin Rendah Semakin Baik'],
    ['Ketersediaan movable bridge', 'Aset', '%', 98, 97.2, 'Semakin Tinggi Semakin Baik'],
    ['Penyelesaian keluhan dalam 3x24 jam', 'Pelayanan Pelanggan', '%', 95, 97.5, 'Semakin Tinggi Semakin Baik'],
    ['Pelaksanaan inspeksi keselamatan kapal', 'Keselamatan Pelayaran', '%', 100, 100, 'Semakin Tinggi Semakin Baik'],
    ['Insiden keamanan informasi berdampak tinggi', 'Keamanan Informasi', 'kejadian', 0, 1, 'Semakin Rendah Semakin Baik'],
  ];
  KPIS.forEach(([title, perspective, unit, target, actual, polarity], i) => {
    insert('quality_objective', {
      title,
      perspective,
      period: String(new Date().getFullYear()),
      frequency: 'Bulanan',
      formula: 'Realisasi dibandingkan target periode berjalan.',
      unit,
      target,
      actual,
      polarity,
      owner_unit: pick(['Divisi Operasi', 'Divisi QHSE', 'Divisi Teknik', 'Divisi Pelayanan'], i),
      analysis: 'Pencapaian dipengaruhi kondisi cuaca dan kepadatan operasional pada periode puncak.',
      improvement_plan: 'Penguatan pemantauan mingguan dan tindak lanjut atas deviasi.',
    }, { status: 'validated', org: i % 3 === 0 ? CORPORATE : pick(SITES, i) });
  });
}

if (!hasRows('customer_complaint')) {
  const COMPLAINTS = [
    ['Antrian tiket terlalu panjang saat akhir pekan', 'Antrian Kendaraan', 'Loket'],
    ['Toilet kapal kurang bersih', 'Kebersihan Kapal', 'Aplikasi Ferizy'],
    ['Keberangkatan tertunda tanpa informasi', 'Keterlambatan Jadwal', 'Call Center 191'],
    ['Ruang tunggu kekurangan tempat duduk', 'Fasilitas Penumpang', 'Kotak Saran'],
    ['Petugas kurang informatif', 'Sikap Petugas', 'Media Sosial'],
    ['Sistem tiket daring gagal memuat', 'Sistem Ticketing Online', 'Email'],
    ['Akses kursi roda ke gangway sulit', 'Aksesibilitas Disabilitas', 'Surat Resmi'],
    ['Kehilangan barang di ruang penumpang', 'Kehilangan Barang', 'Loket'],
    ['Kendaraan tergores saat parkir di dek', 'Keselamatan', 'Call Center 191'],
    ['Informasi tarif tidak jelas', 'Tarif', 'Media Sosial'],
    ['Kebersihan area parkir kurang terjaga', 'Kebersihan Pelabuhan', 'Kotak Saran'],
    ['Waktu tunggu masuk kapal terlalu lama', 'Antrian Kendaraan', 'Aplikasi Ferizy'],
  ];
  COMPLAINTS.forEach(([title, category, channel], i) => {
    const date = daysAgo(randInt(5, 340));
    const hours = randInt(1, 46);
    insert('customer_complaint', {
      title,
      complaint_date: date,
      channel,
      customer_name: pick(['Pengguna Jasa', 'Bpk. Handoko', 'Ibu Marlina', 'Sdr. Faisal'], i),
      customer_contact: `08${randInt(1000000000, 9999999999)}`,
      category,
      severity: pick(['Rendah', 'Sedang', 'Tinggi'], i),
      description: `${title}. Pelanggan menyampaikan ketidaknyamanan atas layanan yang diterima.`,
      immediate_response: 'Permohonan maaf disampaikan dan keluhan diteruskan ke unit terkait.',
      response_date: date,
      response_hours: hours,
      resolution: 'Perbaikan layanan dilakukan dan hasilnya dikonfirmasikan kepada pelanggan.',
      resolved_date: daysAgo(randInt(1, 4)),
      customer_satisfaction: pick(['Puas', 'Sangat Puas', 'Cukup', 'Belum Dikonfirmasi'], i),
      recurring: i % 6 === 0,
    }, { status: i < 9 ? 'closed' : 'action', org: pick(SITES, i), createdAt: `${date}T09:30:00.000Z` });
  });
}

if (!hasRows('non_conformity')) {
  const NCS = [
    ['Rekaman inspeksi APAR tidak lengkap', 'Audit Internal', 'ISO 45001', '9.1.1', 'Minor'],
    ['Dokumen SOP bongkar muat belum direvisi', 'Audit Internal', 'ISO 9001', '7.5.2', 'Minor'],
    ['Manifes limbah B3 tidak terarsip', 'Audit Eksternal', 'ISO 14001', '8.1', 'Mayor'],
    ['Sertifikat kalibrasi gas detector kedaluwarsa', 'Inspeksi', 'ISO 9001', '7.1.5', 'Mayor'],
    ['Induksi K3 kontraktor tidak terdokumentasi', 'Audit Internal', 'ISO 45001', '7.2', 'Minor'],
    ['Tinjauan manajemen belum membahas kinerja energi', 'Audit Eksternal', 'ISO 50001', '9.3', 'Minor'],
    ['Log akses sistem tidak ditinjau berkala', 'Audit Internal', 'ISO 27001', 'A.8.15', 'Minor'],
    ['Latihan tanggap darurat tidak sesuai jadwal', 'Pemantauan Proses', 'SMK3', 'Elemen 6', 'Observasi'],
  ];
  NCS.forEach(([title, source, system, clause, category], i) => {
    const date = daysAgo(randInt(20, 320));
    insert('non_conformity', {
      title,
      found_date: date,
      source,
      system_ref: system,
      clause_ref: clause,
      category,
      description: `${title}. Ketidaksesuaian teridentifikasi terhadap persyaratan ${system} klausul ${clause}.`,
      evidence: 'Hasil verifikasi dokumen dan wawancara pada saat audit.',
      immediate_action: 'Koreksi langsung dilakukan pada rekaman terkait.',
      root_cause_method: pick(['5 Why', 'Fishbone (Ishikawa)', 'Pareto'], i),
      root_cause: 'Belum ada mekanisme pengingat otomatis dan pembagian tanggung jawab yang jelas.',
      due_date: daysAhead(randInt(-25, 45)),
      closed_date: i < 5 ? daysAgo(randInt(1, 40)) : null,
      effectiveness_verified: i < 5,
    }, { status: i < 5 ? 'closed' : 'action', org: pick([...SITES, CORPORATE], i), createdAt: `${date}T09:00:00.000Z` });
  });
}

if (!hasRows('capa')) {
  const CAPAS = [
    ['Penyediaan sistem pengingat kalibrasi otomatis', 'Ketidaksesuaian', 'Rekayasa Teknik'],
    ['Revisi SOP bongkar muat kendaraan', 'Temuan Audit', 'Administratif'],
    ['Pemasangan interlock pada movable bridge', 'Insiden', 'Rekayasa Teknik'],
    ['Pelatihan ulang petugas tambat', 'Insiden', 'Administratif'],
    ['Perbaikan penerangan area dermaga', 'Inspeksi', 'Rekayasa Teknik'],
    ['Penambahan rambu jalur evakuasi terminal', 'Inspeksi', 'Administratif'],
    ['Digitalisasi manifes limbah B3', 'Evaluasi Kepatuhan', 'Administratif'],
    ['Penggantian APAR kedaluwarsa seluruh area', 'Inspeksi', 'Eliminasi'],
    ['Peningkatan frekuensi patroli area steril', 'Analisis Risiko', 'Administratif'],
    ['Perbaikan railing dermaga 2', 'Ketidaksesuaian', 'Rekayasa Teknik'],
    ['Penyediaan APD tambahan untuk petugas B3', 'Analisis Risiko', 'APD'],
    ['Penguatan kontrol akses sistem informasi', 'Temuan Audit', 'Administratif'],
  ];
  CAPAS.forEach(([title, source, hierarchy], i) => {
    const created = daysAgo(randInt(10, 300));
    const done = i < 6;
    insert('capa', {
      title,
      source_type: source,
      problem_statement: `${title} diperlukan untuk menutup ketidaksesuaian dan mencegah keberulangan.`,
      root_cause_method: pick(['5 Why', 'Fishbone (Ishikawa)', 'FMEA'], i),
      root_cause: 'Pengendalian yang ada belum memadai untuk mencegah keberulangan kejadian serupa.',
      action_plan: `${title} dilaksanakan bertahap dengan verifikasi efektivitas setelah implementasi.`,
      action_hierarchy: hierarchy,
      due_date: daysAhead(randInt(-30, 90)),
      completed_date: done ? daysAgo(randInt(1, 60)) : null,
      progress: done ? 100 : randInt(10, 85),
      verification_result: done ? 'Tindakan efektif, tidak ditemukan keberulangan pada periode pemantauan.' : null,
      verified_date: done ? daysAgo(randInt(1, 30)) : null,
      cost: randInt(5, 250) * 1e6,
    }, { status: done ? 'closed' : pick(['in_progress', 'open', 'completed'], i), org: pick([...SITES, CORPORATE], i), createdAt: `${created}T08:00:00.000Z` });
  });
}

if (!hasRows('continuous_improvement')) {
  const CIS = [
    ['Digitalisasi checklist pra-berlayar', 'Kaizen', 'Digitalisasi', 320e6],
    ['Optimasi pola sandar untuk menekan waktu tambat', 'Lean', 'Waktu Sandar', 480e6],
    ['Penggantian lampu dermaga ke LED', 'PDCA', 'Efisiensi Energi', 260e6],
    ['Penerapan bank sampah terminal', 'Kaizen', 'Lingkungan', 45e6],
    ['Perbaikan alur antrian kendaraan', 'Six Sigma (DMAIC)', 'Produktivitas', 610e6],
  ];
  CIS.forEach(([title, method, area, saving], i) => {
    insert('continuous_improvement', {
      title,
      method,
      area,
      current_condition: 'Proses berjalan manual sehingga rawan keterlambatan dan kesalahan pencatatan.',
      proposed_improvement: `${title} untuk meningkatkan efisiensi dan keandalan proses.`,
      expected_benefit: 'Penurunan waktu proses, peningkatan akurasi data, dan penghematan biaya operasional.',
      estimated_saving: saving,
      realized_saving: i < 3 ? Math.round(saving * 0.8) : 0,
      due_date: daysAhead(randInt(-20, 150)),
      progress: i < 3 ? 100 : randInt(25, 70),
      replicated: i < 2,
    }, { status: i < 3 ? 'closed' : 'in_progress', org: pick([...SITES, CORPORATE], i) });
  });
}

/* ---------------------------------------------------------------- kesehatan */

console.log('  Memuat rekaman kesehatan kerja ...');

const employeeRows = all('SELECT id, name FROM m_employee ORDER BY id');

if (!hasRows('mcu') && employeeRows.length) {
  employeeRows.forEach((emp, i) => {
    const date = daysAgo(randInt(20, 350));
    const result = i % 8 === 0 ? 'Fit with Note' : i % 11 === 0 ? 'Temporary Unfit' : 'Fit';
    insert('mcu', {
      employee: emp.id,
      mcu_type: pick(['Berkala', 'Awal (Pra-Kerja)', 'Medical Fitness Awak Kapal'], i),
      exam_date: date,
      provider: pick(['Klinik Pratama ASDP', 'RS Pelabuhan', 'Klinik Mitra Sehat'], i),
      doctor: 'dr. Wulandari, Sp.OK',
      result,
      findings: result === 'Fit' ? ['Tidak Ada Temuan'] : pick([['Hipertensi'], ['Dislipidemia'], ['Gangguan Pendengaran'], ['Obesitas']], i),
      systolic: randInt(110, 155),
      diastolic: randInt(70, 98),
      bmi: 19 + rnd() * 9,
      audiometry: pick(['Normal', 'Gangguan Ringan', 'Normal', 'Tidak Diperiksa'], i),
      spirometry: pick(['Normal', 'Normal', 'Restriktif'], i),
      recommendation: result === 'Fit' ? 'Pertahankan pola hidup sehat dan olahraga teratur.' : 'Kontrol rutin ke fasilitas kesehatan dan evaluasi ulang dalam 3 bulan.',
      next_mcu: daysAhead(randInt(-20, 340)),
      follow_up_required: result !== 'Fit',
    }, { status: 'validated', org: pick(SITES, i), createdAt: `${date}T08:00:00.000Z` });
  });
}

if (!hasRows('fatigue_management') && employeeRows.length) {
  for (let i = 0; i < 14; i++) {
    const emp = employeeRows[i % employeeRows.length];
    const rest24 = randInt(7, 13);
    insert('fatigue_management', {
      employee: emp.id,
      assessment_date: daysAgo(randInt(1, 200)),
      role_type: pick(['Nakhoda', 'Perwira Dek', 'ABK', 'Operator MB/Gangway', 'Petugas Loket'], i),
      hours_worked_24h: 24 - rest24 - randInt(1, 3),
      hours_rest_24h: rest24,
      hours_worked_7d: randInt(45, 78),
      hours_rest_7d: randInt(70, 100),
      consecutive_days: randInt(2, 9),
      fatigue_score: pick(['2 - Segar', '3 - Normal', '4 - Lelah', '5 - Sangat Lelah'], i),
      mitigation: 'Penyesuaian jadwal jaga dan penambahan waktu istirahat.',
      fit_to_duty: rest24 >= 10,
    }, { status: 'validated', org: pick(SITES, i) });
  }
}

if (!hasRows('occupational_disease') && employeeRows.length) {
  [['Gangguan Pendengaran Akibat Bising (NIHL)', 'H83.3'], ['Gangguan Muskuloskeletal (MSD)', 'M54.5'], ['Penyakit Kulit Akibat Kerja', 'L23.9']].forEach(([category, icd], i) => {
    insert('occupational_disease', {
      employee: employeeRows[i % employeeRows.length].id,
      diagnosis_date: daysAgo(randInt(40, 300)),
      disease_category: category,
      diagnosis: category,
      icd_code: icd,
      doctor: 'dr. Prasetya, Sp.OK',
      exposure_history: 'Pajanan berulang pada area kerja dengan pengendalian yang belum optimal.',
      causal_agent: pick(['Kebisingan mesin', 'Beban angkat manual', 'Bahan pembersih kimia'], i),
      exposure_years: randInt(3, 18),
      lost_days: randInt(0, 14),
      reported_bpjs: true,
      reported_disnaker: i === 0,
      control_measures: 'Rotasi kerja, penyediaan APD sesuai bahaya, dan pemeriksaan berkala.',
      outcome: pick(['Sembuh dengan Gejala Sisa', 'Dalam Perawatan', 'Sembuh'], i),
    }, { status: 'action', org: pick(SITES, i) });
  });
}

if (!hasRows('clinic')) {
  for (let i = 0; i < 22; i++) {
    const date = daysAgo(randInt(1, 330));
    insert('clinic', {
      visit_date: date,
      patient_name: pick(['Pegawai Operasional', 'Penumpang', 'Pekerja Kontraktor', 'ABK'], i),
      patient_type: pick(['Pegawai', 'Penumpang', 'Kontraktor', 'ABK'], i),
      service_type: pick(['Pemeriksaan Umum', 'P3K / Gawat Darurat', 'Pengobatan', 'Pemeriksaan Tekanan Darah'], i),
      complaint: pick(['Pusing dan mual', 'Luka lecet', 'Nyeri punggung', 'Demam'], i),
      diagnosis: pick(['Mabuk perjalanan', 'Vulnus ekskoriasi', 'Myalgia', 'ISPA'], i),
      treatment: 'Diberikan obat simptomatik dan istirahat; kondisi membaik sebelum meninggalkan klinik.',
      work_related: i % 4 === 0,
      referred: i % 9 === 0,
      officer: 'Perawat Klinik',
      rest_days: i % 4 === 0 ? randInt(0, 2) : 0,
    }, { status: 'recorded', org: pick(SITES, i), createdAt: `${date}T12:00:00.000Z` });
  }
}

if (!hasRows('vaccination') && employeeRows.length) {
  employeeRows.slice(0, 8).forEach((emp, i) => {
    insert('vaccination', {
      employee: emp.id,
      vaccine_type: pick(['COVID-19', 'Influenza', 'Hepatitis B', 'Tetanus (TT)'], i),
      dose_number: randInt(1, 3),
      vaccination_date: daysAgo(randInt(30, 400)),
      batch_number: `BATCH-${randInt(1000, 9999)}`,
      provider: 'Dinas Kesehatan setempat',
      valid_until: daysAhead(randInt(-10, 500)),
      certificate_no: `VAC/${randInt(1000, 9999)}/2025`,
      adverse_reaction: false,
    }, { status: 'validated', org: pick(SITES, i) });
  });
}

if (!hasRows('health_campaign')) {
  [['Bulan K3 Nasional 2026', 'Bulan K3 Nasional'], ['Kampanye anti narkoba di lingkungan pelabuhan', 'Anti Narkoba (P4GN)'], ['Pemeriksaan kesehatan gratis pengemudi', 'Pola Hidup Sehat']].forEach(([title, theme], i) => {
    insert('health_campaign', {
      title,
      theme,
      start_date: daysAgo(randInt(30, 200)),
      end_date: daysAgo(randInt(1, 29)),
      format: pick(['Sosialisasi', 'Pemeriksaan Gratis', 'Lomba'], i),
      target_participants: randInt(80, 300),
      actual_participants: randInt(70, 290),
      organizer: 'Divisi QHSE bersama Klinik',
      budget: randInt(20, 120) * 1e6,
      outcome: 'Antusiasme peserta tinggi; kegiatan dilanjutkan pada periode berikutnya.',
    }, { status: 'closed', org: pick(SITES, i) });
  });
}

/* ----------------------------------------------------- lingkungan & energi */

console.log('  Memuat rekaman lingkungan & energi ...');

if (!hasRows('fuel_consumption')) {
  for (let back = 11; back >= 0; back--) {
    const period = monthKey(back);
    for (const site of SITES) {
      insert('fuel_consumption', {
        period,
        energy_type: 'Solar / HSD (Genset)',
        consumer_type: 'Pelabuhan',
        quantity: randInt(4000, 12000),
        unit: 'liter',
        cost: randInt(60, 190) * 1e6,
        operating_hours: randInt(120, 420),
      }, { status: 'validated', org: site, createdAt: `${period}-27T08:00:00.000Z` });
      insert('fuel_consumption', {
        period,
        energy_type: 'Listrik PLN',
        consumer_type: 'Pelabuhan',
        quantity: randInt(90000, 260000),
        unit: 'kWh',
        cost: randInt(120, 340) * 1e6,
      }, { status: 'validated', org: site, createdAt: `${period}-27T08:05:00.000Z` });
    }
    for (const name of Object.keys(vesselIds)) {
      insert('fuel_consumption', {
        period,
        energy_type: 'Solar / HSD (Kapal)',
        consumer_type: 'Kapal',
        quantity: randInt(120000, 320000),
        unit: 'liter',
        cost: randInt(1500, 4200) * 1e6,
        operating_hours: randInt(320, 690),
        trips: randInt(180, 420),
        distance_nm: randInt(900, 2600),
        cargo_tonnage: randInt(6000, 22000),
      }, { status: 'validated', org: VESSEL_SITE(name), createdAt: `${period}-27T08:10:00.000Z` });
    }
  }
}

if (!hasRows('waste_management')) {
  for (let back = 11; back >= 0; back--) {
    const period = monthKey(back);
    for (const site of SITES) {
      const qty = randInt(9000, 26000);
      insert('waste_management', {
        period,
        waste_type: 'Sampah Domestik',
        source: 'Terminal Penumpang',
        quantity: qty,
        unit: 'kg',
        treatment: 'Diangkut ke TPA',
        recycled_qty: Math.round(qty * (0.08 + rnd() * 0.22)),
        vendor: 'Dinas Lingkungan Hidup setempat',
        manifest_no: `BAST/${randInt(100, 999)}/${period}`,
      }, { status: 'validated', org: site, createdAt: `${period}-28T08:00:00.000Z` });
    }
  }
}

if (!hasRows('hazardous_waste')) {
  const B3 = [
    ['B105d - Minyak Pelumas Bekas', 'Minyak pelumas bekas', 'Kapal - Ruang Mesin'],
    ['A337-1 - Sludge Oil / Oily Water', 'Sludge oil', 'Kapal - Ruang Mesin'],
    ['A102d - Aki/Baterai Bekas', 'Aki bekas kendaraan operasional', 'Bengkel Pelabuhan'],
    ['B110d - Kain Majun Terkontaminasi', 'Majun terkontaminasi oli', 'Bengkel Pelabuhan'],
    ['B109d - Lampu TL Bekas', 'Lampu TL bekas', 'Perkantoran'],
    ['A339-1 - Limbah Medis', 'Limbah medis klinik', 'Klinik'],
  ];
  for (let back = 5; back >= 0; back--) {
    const period = monthKey(back);
    B3.forEach(([code, name, source], i) => {
      const site = pick(SITES, i + back);
      insert('hazardous_waste', {
        period,
        waste_code: code,
        waste_name: name,
        source,
        characteristic: pick([['Beracun'], ['Mudah Menyala', 'Beracun'], ['Korosif'], ['Infeksius']], i),
        quantity: randInt(50, 1800),
        unit: pick(['kg', 'liter'], i),
        stored_qty: randInt(0, 400),
        storage_start: daysAgo(randInt(5, 120)),
        tps_permit_no: `660.1/TPS-B3/${randInt(10, 99)}/2024`,
        disposal_method: pick(['Diserahkan ke Pengumpul Berizin', 'Diserahkan ke Pemanfaat', 'Masih Disimpan'], i),
        transporter: 'PT Limbah Lestari Indonesia',
        transporter_permit: `SK.${randInt(100, 999)}/MENLHK/2024`,
        processor: 'PT Pengolah Limbah Nusantara',
        manifest_no: `FESTRONIK-${randInt(100000, 999999)}`,
        manifest_date: daysAgo(randInt(1, 60)),
        reported_siraja: true,
      }, { status: 'validated', org: site, createdAt: `${period}-28T09:00:00.000Z` });
    });
  }
}

if (!hasRows('air_emission')) {
  for (let i = 0; i < 10; i++) {
    const exceed = i % 7 === 0;
    insert('air_emission', {
      sampling_date: daysAgo(randInt(20, 340)),
      source_type: pick(['Genset Pelabuhan', 'Mesin Induk Kapal', 'Ambien Pelabuhan'], i),
      source_name: pick(['Genset 500 kVA', 'Main Engine', 'Titik Ambien Terminal'], i),
      lab_name: 'Laboratorium Lingkungan Terakreditasi',
      lab_accreditation: `LP-${randInt(100, 999)}-IDN`,
      so2: 20 + rnd() * 60,
      no2: 90 + rnd() * (exceed ? 700 : 250),
      co: 100 + rnd() * 300,
      particulate: 30 + rnd() * (exceed ? 200 : 80),
      opacity: 5 + rnd() * 15,
      o2_reference: 5,
      compliance: exceed ? 'Melebihi Baku Mutu' : 'Memenuhi',
      exceedance_note: exceed ? 'Parameter NO2 dan partikulat melebihi baku mutu PermenLHK No. 11 Tahun 2021.' : null,
      corrective_action: exceed ? 'Penyetelan pembakaran mesin dan penjadwalan servis dipercepat.' : null,
      next_sampling: daysAhead(randInt(20, 200)),
      reported_slhi: true,
    }, { status: 'validated', org: pick(SITES, i) });
  }
}

if (!hasRows('water_quality')) {
  for (let i = 0; i < 12; i++) {
    const exceed = i % 6 === 0;
    insert('water_quality', {
      sampling_date: daysAgo(randInt(15, 340)),
      sample_type: pick(['Air Laut (Kolam Pelabuhan)', 'Air Limbah Domestik (IPAL)', 'Air Limbah Kapal (Sewage)'], i),
      sampling_point: pick(['Outlet IPAL', 'Kolam Dermaga 1', 'Kolam Dermaga 3'], i),
      lab_name: 'Laboratorium Lingkungan Terakreditasi',
      ph: 6.5 + rnd() * 1.6,
      bod: 8 + rnd() * (exceed ? 60 : 18),
      cod: 30 + rnd() * (exceed ? 140 : 50),
      tss: 15 + rnd() * (exceed ? 90 : 30),
      oil_grease: 1 + rnd() * (exceed ? 14 : 4),
      ammonia: rnd() * 3,
      total_coliform: randInt(200, 4800),
      do_value: 4 + rnd() * 3,
      debit: randInt(300, 2400),
      compliance: exceed ? 'Melebihi Baku Mutu' : 'Memenuhi',
      exceedance_note: exceed ? 'Parameter BOD, COD dan minyak-lemak melebihi baku mutu PermenLHK No. 5 Tahun 2014.' : null,
      corrective_action: exceed ? 'Pengurasan bak IPAL dan penambahan frekuensi pemeliharaan grease trap.' : null,
      sppl_permit: `660/IPAL/${randInt(100, 999)}/2024`,
      next_sampling: daysAhead(randInt(20, 180)),
    }, { status: 'validated', org: pick(SITES, i) });
  }
}

if (!hasRows('environmental_monitoring')) {
  const PARAMS = [['Kualitas Air Laut', 'DO', 'mg/L', 5.2, 5], ['Kebisingan', 'Leq siang', 'dBA', 68, 70], ['Kualitas Udara Ambien', 'PM10', 'µg/m3', 42, 75], ['Biota Perairan', 'Indeks keanekaragaman', 'indeks', 2.1, 2]];
  for (let i = 0; i < 12; i++) {
    const [groupName, param, unit, value, threshold] = pick(PARAMS, i);
    insert('environmental_monitoring', {
      title: `Pemantauan ${groupName.toLowerCase()} semester ${i % 2 === 0 ? 'I' : 'II'}`,
      monitoring_date: daysAgo(randInt(20, 340)),
      parameter_group: groupName,
      location_point: pick(['Titik A - Kolam Pelabuhan', 'Titik B - Terminal', 'Titik C - Perairan Sekitar'], i),
      parameter_name: param,
      result_value: Number((value * (0.85 + rnd() * 0.35)).toFixed(3)),
      result_unit: unit,
      threshold_value: threshold,
      compliance: i % 8 === 0 ? 'Melebihi Baku Mutu' : 'Memenuhi',
      noise_day: 60 + rnd() * 12,
      noise_night: 50 + rnd() * 12,
      lab_name: 'Laboratorium Lingkungan Terakreditasi',
      document_ref: pick(['UKL-UPL', 'AMDAL'], i),
      reporting_period: i % 2 === 0 ? 'Semester I' : 'Semester II',
      reported_to_dlh: true,
      analysis: 'Hasil pemantauan masih dalam rentang kendali dengan fluktuasi musiman.',
      corrective_action: 'Melanjutkan program pengelolaan sesuai dokumen lingkungan.',
    }, { status: 'validated', org: pick(SITES, i) });
  }
}

if (!hasRows('spill_management')) {
  [['Tumpahan oli hidrolik movable bridge', 'Minyak Pelumas', 45, 'Daratan / Dermaga'], ['Ceceran solar saat bunkering', 'Solar / HSD', 120, 'Perairan / Laut'], ['Kebocoran sludge dari kapal', 'Sludge Oil', 30, 'Perairan / Laut']].forEach(([title, material, volume, medium], i) => {
    const date = daysAgo(randInt(30, 300));
    insert('spill_management', {
      title,
      spill_date: date,
      spill_time: '14:20',
      material,
      volume_liter: volume,
      medium,
      cause: pick(['Kebocoran Peralatan', 'Kesalahan Operasi Bunkering', 'Kegagalan Selang/Sambungan'], i),
      location: pick(['Dermaga 2', 'Dermaga 1', 'Kolam Pelabuhan'], i),
      description: `${title}. Tim tanggap darurat segera melakukan penanggulangan sesuai prosedur.`,
      response_time_minutes: randInt(5, 25),
      containment_used: pick([['Oil Absorbent Pad', 'Drum Penampung'], ['Oil Boom', 'Skimmer', 'Oil Absorbent Pad'], ['Sorbent Boom']], i),
      recovered_liter: Math.round(volume * (0.7 + rnd() * 0.25)),
      reported_ksop: medium === 'Perairan / Laut',
      reported_klhk: volume > 100,
      environmental_impact: 'Dampak terbatas pada area terdampak, tidak ditemukan kematian biota.',
      remediation: 'Pembersihan area, pengambilan sampel air, dan pemantauan lanjutan selama 7 hari.',
      cost: randInt(10, 90) * 1e6,
      potential_likelihood: '3',
      potential_severity: '4',
    }, { status: 'closed', org: pick(SITES, i), createdAt: `${date}T14:30:00.000Z` });
  });
}

if (!hasRows('carbon_footprint')) {
  [['Scope 3 - Lainnya', 'Perjalanan Dinas', 480, 'orang-km', 0.15], ['Scope 3 - Lainnya', 'Limbah', 12000, 'kg', 0.021], ['Scope 3 - Lainnya', 'Rantai Pasok', 3200, 'ton-km', 0.11]].forEach(([scope, source, data, unit, factor], i) => {
    insert('carbon_footprint', {
      period: String(new Date().getFullYear()),
      scope_ghg: scope,
      emission_source: source,
      activity_data: data,
      activity_unit: unit,
      emission_factor: factor,
      factor_source: 'DEFRA 2023',
      baseline_ton: Number(((data * factor) / 1000 * 1.15).toFixed(3)),
      reduction_initiative: 'Optimalisasi perjalanan dinas dan program pengurangan limbah.',
      verified_external: false,
    }, { status: 'validated', org: CORPORATE });
  });
}

if (!hasRows('esg')) {
  const ESG = [
    ['Intensitas emisi GRK per penumpang', 'Environmental', 'GRI 305-4', 'kg CO2e/pnp', 2.1, 2.25],
    ['Tingkat daur ulang limbah', 'Environmental', 'GRI 306-4', '%', 25, 21.5],
    ['Konsumsi energi total', 'Environmental', 'GRI 302-1', 'GJ', 480000, 468000],
    ['Tingkat kecelakaan kerja tercatat', 'Social', 'GRI 403-9', 'per 1 juta jam', 0.5, 0.62],
    ['Jam pelatihan per pegawai', 'Social', 'GRI 404-1', 'jam/orang', 20, 22.4],
    ['Proporsi pekerja perempuan', 'Social', 'GRI 405-1', '%', 25, 23.8],
    ['Kepuasan pengguna jasa', 'Social', 'GRI 416-1', 'indeks', 4.2, 4.05],
    ['Kepatuhan terhadap peraturan lingkungan', 'Governance', 'GRI 2-27', '%', 100, 96],
    ['Pelaporan pelanggaran (whistleblowing) ditindaklanjuti', 'Governance', 'GRI 2-26', '%', 100, 100],
    ['Evaluasi pemasok atas aspek K3L', 'Governance', 'GRI 414-1', '%', 90, 87],
  ];
  ESG.forEach(([title, pillar, gri, unit, target, actual], i) => {
    insert('esg', {
      title,
      pillar,
      gri_code: gri,
      sdg_ref: pick([['SDG 13 - Aksi Iklim'], ['SDG 12 - Konsumsi Bertanggung Jawab'], ['SDG 8 - Pekerjaan Layak'], ['SDG 16 - Kelembagaan'], ['SDG 14 - Ekosistem Laut']], i),
      period: String(new Date().getFullYear()),
      unit,
      target,
      actual,
      previous_year: Number((actual * (0.92 + rnd() * 0.12)).toFixed(2)),
      polarity: title.includes('Intensitas') || title.includes('kecelakaan') ? 'Semakin Rendah Semakin Baik' : 'Semakin Tinggi Semakin Baik',
      assurance: i < 3 ? 'Limited Assurance' : 'Belum Diasuransi',
      narrative: 'Indikator dilaporkan dalam Laporan Keberlanjutan sesuai POJK No. 51/POJK.03/2017.',
      disclosed_in_report: true,
    }, { status: 'validated', org: CORPORATE });
  });
}

if (!hasRows('energy_review')) {
  [['Konversi penerangan dermaga ke LED', 'Penerangan', 620000, 540000], ['Optimasi jadwal genset terminal', 'Genset Pelabuhan', 96000, 88000], ['Program efisiensi bahan bakar kapal', 'BBM Kapal', 2600000, 2480000]].forEach(([title, seu, baseline, actual], i) => {
    insert('energy_review', {
      title,
      period: String(new Date().getFullYear()),
      seu_category: seu,
      baseline_consumption: baseline,
      actual_consumption: actual,
      baseline_unit: seu === 'BBM Kapal' ? 'liter' : 'kWh',
      enpi_value: Number((actual / randInt(300, 900)).toFixed(4)),
      enpi_definition: 'Konsumsi energi per unit keluaran operasional.',
      target_reduction: 10,
      energy_saving_value: randInt(200, 900) * 1e6,
      co2_avoided_ton: Number(((baseline - actual) * 0.0008).toFixed(3)),
      improvement_action: 'Penggantian peralatan efisien, penjadwalan operasi, dan pemantauan konsumsi harian.',
      due_date: daysAhead(randInt(-30, 200)),
      progress: i < 2 ? 100 : 65,
      investment: randInt(400, 2500) * 1e6,
      payback_months: randInt(14, 40),
    }, { status: i < 2 ? 'closed' : 'in_progress', org: pick([...SITES, CORPORATE], i) });
  });
}

/* ------------------------------------------------------------ audit & risiko */

console.log('  Memuat rekaman audit, kepatuhan & risiko ...');

if (!hasRows('internal_audit')) {
  const AUDITS = [
    ['Audit internal SMT Cabang Merak', ['ISO 9001:2015', 'ISO 14001:2015', 'ISO 45001:2018'], 'Cabang Merak'],
    ['Audit internal SMT Cabang Bakauheni', ['ISO 9001:2015', 'ISO 45001:2018'], 'Cabang Bakauheni'],
    ['Audit internal SMK3 Cabang Ketapang', ['SMK3 PP 50/2012'], 'Cabang Ketapang'],
    ['Verifikasi internal ISM Code armada', ['ISM Code'], 'Armada Regional I'],
    ['Audit internal keamanan informasi', ['ISO 27001:2022'], 'Divisi TI'],
    ['Audit internal manajemen energi', ['ISO 50001:2018'], 'Divisi Teknik'],
  ];
  AUDITS.forEach(([title, systems, auditee], i) => {
    const plan = daysAgo(randInt(30, 300));
    const major = randInt(0, 2);
    const minor = randInt(1, 7);
    const obs = randInt(2, 9);
    insert('internal_audit', {
      title,
      system_ref: systems,
      audit_program_year: String(new Date().getFullYear()),
      plan_date: plan,
      actual_date: plan,
      auditee_unit: auditee,
      auditors: 'Tim Auditor Internal Bersertifikat',
      audit_scope: 'Seluruh proses utama dan pendukung pada unit yang diaudit.',
      audit_criteria: `Standar ${systems.join(', ')}, prosedur internal, dan peraturan perundangan terkait.`,
      major_nc: major,
      minor_nc: minor,
      observations: obs,
      ofi: randInt(1, 6),
      conformity_rate: Number((88 + rnd() * 10).toFixed(1)),
      positive_findings: 'Komitmen manajemen kuat dan pelaporan near miss meningkat.',
      summary: `Ditemukan ${major} ketidaksesuaian mayor, ${minor} minor, dan ${obs} observasi.`,
      conclusion: 'Sistem manajemen diterapkan secara efektif dengan beberapa area perbaikan.',
      report_date: plan,
      follow_up_due: daysAhead(randInt(-20, 60)),
      follow_up_status: i < 4 ? 'Selesai Seluruhnya' : 'Sebagian Selesai',
    }, { status: i < 4 ? 'verified' : 'completed', org: pick([...SITES, CORPORATE], i), createdAt: `${plan}T08:00:00.000Z` });
  });
}

if (!hasRows('external_audit')) {
  const EXT = [
    ['Surveillance ISO 9001:2015', 'Surveillance', ['ISO 9001:2015'], 'PT Sertifikasi Mutu Indonesia'],
    ['Audit SMK3 Kemnaker', 'Audit SMK3 Kemnaker', ['SMK3 PP 50/2012'], 'Lembaga Audit SMK3 Independen'],
    ['Verifikasi ISM Code oleh Ditjen Hubla', 'Audit ISM Code', ['ISM Code'], 'Direktorat Jenderal Perhubungan Laut'],
    ['Audit ISPS Code fasilitas pelabuhan', 'Audit ISPS Code', ['ISPS Code'], 'Ditjen Hubla / Designated Authority'],
    ['Re-sertifikasi ISO 14001:2015', 'Re-sertifikasi', ['ISO 14001:2015'], 'PT Sertifikasi Mutu Indonesia'],
  ];
  EXT.forEach(([title, type, systems, body], i) => {
    const start = daysAgo(randInt(40, 320));
    const smk3 = type === 'Audit SMK3 Kemnaker';
    insert('external_audit', {
      title,
      audit_type: type,
      system_ref: systems,
      auditor_body: body,
      lead_auditor_ext: 'Lead Auditor Eksternal',
      start_date: start,
      end_date: start,
      audit_scope: 'Penerapan sistem manajemen pada kantor pusat, cabang dan armada terpilih.',
      major_nc: i === 1 ? 1 : 0,
      minor_nc: randInt(1, 5),
      observations: randInt(2, 8),
      result: pick(['Sertifikasi Dilanjutkan', 'Direkomendasikan Sertifikasi', 'Lulus'], i),
      certificate_no: `CERT/${randInt(10000, 99999)}/${new Date().getFullYear()}`,
      certificate_valid_from: start,
      certificate_expiry: daysAhead(randInt(60, 900)),
      smk3_score: smk3 ? 87 : null,
      smk3_level: smk3 ? 'Tingkat Lanjutan (166 kriteria)' : null,
      findings_summary: 'Temuan bersifat administratif dan telah disusun rencana tindak lanjutnya.',
      follow_up_due: daysAhead(randInt(-15, 60)),
    }, { status: 'verified', org: i < 2 ? CORPORATE : pick(SITES, i), createdAt: `${start}T08:00:00.000Z` });
  });
}

if (!hasRows('inspection')) {
  const TYPES = ['Inspeksi K3 Rutin', 'Inspeksi APAR & Hydrant', 'Inspeksi Housekeeping (5R)', 'Inspeksi P3K', 'Inspeksi TPS Limbah B3', 'Safety Patrol Manajemen', 'Inspeksi Listrik', 'Inspeksi Alat Angkat'];
  for (let i = 0; i < 26; i++) {
    const date = daysAgo(randInt(2, 350));
    const checked = randInt(20, 60);
    const findings = randInt(0, 9);
    insert('inspection', {
      title: `${pick(TYPES, i)} - ${pick(['Dermaga', 'Terminal', 'Bengkel', 'Gudang', 'Kapal'], i)}`,
      inspection_type: pick(TYPES, i),
      inspection_date: date,
      area: pick(['Dermaga 1', 'Terminal Penumpang', 'Bengkel', 'Gudang', 'Ruang Genset'], i),
      accompanied_by: 'Supervisor Area',
      items_checked: checked,
      items_conform: checked - findings,
      findings_count: findings,
      critical_findings: findings > 6 ? 1 : 0,
      findings: findings ? 'Ditemukan ketidaksesuaian minor pada kelengkapan sarana keselamatan.' : 'Seluruh item sesuai standar.',
      recommendation: 'Perbaikan segera dan pemantauan pada inspeksi berikutnya.',
      due_date: daysAhead(randInt(-15, 45)),
      follow_up_status: pick(['Selesai', 'Dalam Proses', 'Belum Ditindaklanjuti'], i),
    }, { status: pick(['verified', 'completed'], i), org: pick(SITES, i), createdAt: `${date}T09:00:00.000Z` });
  }
}

if (!hasRows('compliance_audit')) {
  [['Evaluasi kepatuhan peraturan keselamatan pelayaran', 'Kementerian Perhubungan', 42, 40], ['Evaluasi kepatuhan peraturan K3', 'Kementerian Ketenagakerjaan (Disnaker)', 36, 33], ['Evaluasi kepatuhan peraturan lingkungan', 'KLHK / DLH', 28, 26], ['Evaluasi kepatuhan kepelabuhanan', 'Syahbandar / KSOP', 22, 22]].forEach(([title, regulator, total, ok], i) => {
    insert('compliance_audit', {
      title,
      regulator,
      audit_date: daysAgo(randInt(20, 300)),
      auditor: 'Tim Kepatuhan & Legal',
      regulations_checked: 'Peraturan perundangan yang tercantum dalam daftar peraturan (legal register).',
      obligations_total: total,
      obligations_compliant: ok,
      non_compliance_count: total - ok,
      risk_exposure: total - ok > 3 ? 'Tinggi' : 'Sedang',
      findings: total - ok ? 'Terdapat kewajiban yang belum sepenuhnya dipenuhi terkait pelaporan berkala.' : 'Seluruh kewajiban terpenuhi.',
      sanction_risk: 'Teguran administratif apabila tidak dipenuhi dalam batas waktu.',
      action_plan: 'Penyusunan jadwal pelaporan dan penunjukan penanggung jawab per kewajiban.',
      due_date: daysAhead(randInt(-10, 90)),
    }, { status: 'verified', org: pick([...SITES, CORPORATE], i) });
  });
}

if (!hasRows('legal_register')) {
  const LEGAL = [
    ['Kewajiban pelaporan kecelakaan kerja 2x24 jam', 'Permennaker No. 03/MEN/1998', 'K3', 'Patuh'],
    ['Penyediaan P3K di tempat kerja', 'Permenakertrans No. 15 Tahun 2008', 'K3', 'Patuh'],
    ['Riksa uji pesawat angkat dan angkut', 'Permenaker No. 08 Tahun 2020', 'K3', 'Patuh Sebagian'],
    ['Pelaporan RKL-RPL semesteran', 'PP No. 22 Tahun 2021', 'Lingkungan', 'Patuh'],
    ['Izin penyimpanan sementara limbah B3', 'PermenLHK No. 6 Tahun 2021', 'Lingkungan', 'Patuh'],
    ['Sertifikat keselamatan kapal', 'UU No. 17 Tahun 2008', 'Pelayaran', 'Patuh'],
    ['Surat Persetujuan Berlayar setiap keberangkatan', 'PM Perhubungan No. 82 Tahun 2014', 'Pelayaran', 'Patuh'],
    ['Penerapan ISPS Code pada fasilitas pelabuhan', 'PM Perhubungan No. 134 Tahun 2016', 'Kepelabuhanan', 'Patuh'],
    ['Penerapan SMK3 dan audit eksternal', 'PP No. 50 Tahun 2012', 'K3', 'Patuh'],
    ['Pelindungan data pribadi pengguna jasa', 'UU No. 27 Tahun 2022', 'Keamanan Informasi', 'Patuh Sebagian'],
    ['Laporan keberlanjutan tahunan', 'POJK No. 51/POJK.03/2017', 'Perizinan', 'Patuh'],
    ['Konservasi energi bagi pengguna energi besar', 'PP No. 33 Tahun 2023', 'Lingkungan', 'Belum Dievaluasi'],
  ];
  LEGAL.forEach(([title, ref, domain, status], i) => {
    insert('legal_register', {
      title,
      regulation_ref: ref,
      domain,
      applicable_to: pick(['Seluruh unit', 'Pelabuhan', 'Armada kapal', 'Kantor pusat'], i),
      responsible_unit: pick(['Divisi QHSE', 'Divisi Operasi', 'Divisi Teknik', 'Divisi Legal'], i),
      compliance_status: status,
      last_evaluation: daysAgo(randInt(20, 200)),
      next_evaluation: daysAhead(randInt(-15, 200)),
      evidence: 'Rekaman pelaporan, sertifikat, dan dokumentasi pelaksanaan tersimpan pada sistem.',
      gap: status === 'Patuh' ? null : 'Sebagian dokumen pendukung belum lengkap dan perlu pemutakhiran.',
      action_plan: status === 'Patuh' ? null : 'Melengkapi dokumen dan menetapkan penanggung jawab pemantauan.',
      permit_number: i % 3 === 0 ? `IZIN/${randInt(100, 999)}/2024` : null,
      permit_expiry: i % 3 === 0 ? daysAhead(randInt(-20, 500)) : null,
    }, { status: 'validated', org: i % 4 === 0 ? CORPORATE : pick(SITES, i) });
  });
}

if (!hasRows('management_review')) {
  insert('management_review', {
    title: `Rapat Tinjauan Manajemen Semester I ${new Date().getFullYear()}`,
    meeting_date: daysAgo(randInt(30, 150)),
    location: 'Kantor Pusat Jakarta',
    attendees: 'Direksi, VP QHSE, GM Regional, Manager Cabang, Wakil Manajemen',
    system_ref: ['ISO 9001:2015', 'ISO 14001:2015', 'ISO 45001:2018', 'SMK3 PP 50/2012', 'ISM Code'],
    period_reviewed: `Semester I ${new Date().getFullYear()}`,
    input_previous_actions: 'Sebagian besar tindakan tinjauan sebelumnya telah diselesaikan; tersisa dua tindakan berjalan.',
    input_context_changes: 'Perubahan regulasi pelaporan limbah B3 dan peningkatan volume angkutan puncak.',
    input_kpi: 'Sebagian besar sasaran tercapai; LTIFR belum memenuhi target.',
    input_audit: 'Audit internal dan surveillance eksternal terlaksana sesuai program.',
    input_nc_capa: 'CAPA berjalan dengan tingkat penyelesaian tepat waktu 84%.',
    input_incident: 'Terjadi satu LTI; pelaporan near miss meningkat signifikan.',
    input_environment: 'Terdapat deviasi baku mutu pada dua titik pemantauan yang telah ditindaklanjuti.',
    input_customer: 'Indeks kepuasan 4,05 dengan keluhan dominan pada antrian kendaraan.',
    input_risk: 'Profil risiko didominasi risiko operasional dan keselamatan pelayaran.',
    input_resources: 'Diperlukan penambahan personil K3 bersertifikat pada dua cabang.',
    output_decisions: 'Menetapkan program penurunan LTIFR, percepatan digitalisasi checklist, dan penambahan Ahli K3 Umum.',
    output_improvement: 'Perluasan program observasi keselamatan berbasis perilaku ke seluruh cabang.',
    output_resource_needs: 'Anggaran pelatihan tambahan dan penggantian peralatan keselamatan.',
    system_effectiveness: 'Efektif',
    next_review: daysAhead(randInt(60, 180)),
  }, { status: 'closed', org: CORPORATE });
}

const RISK_ROWS = [
  ['Kecelakaan kerja pada kegiatan tambat', 'Keselamatan (K3)', 4, 4, 2, 3],
  ['Kegagalan movable bridge saat operasi puncak', 'Aset & Infrastruktur', 3, 5, 2, 4],
  ['Pencemaran perairan akibat tumpahan minyak', 'Lingkungan', 3, 4, 2, 3],
  ['Kecelakaan kapal pada cuaca ekstrem', 'Keselamatan Pelayaran', 3, 5, 2, 4],
  ['Ketidakpatuhan pelaporan lingkungan', 'Kepatuhan & Hukum', 3, 3, 2, 2],
  ['Serangan siber pada sistem ticketing', 'Keamanan Informasi', 3, 4, 2, 3],
  ['Kekurangan personil bersertifikat', 'Sumber Daya Manusia', 4, 3, 3, 2],
  ['Kepadatan penumpang saat angkutan lebaran', 'Operasional', 5, 3, 3, 3],
  ['Keterlambatan pasokan suku cadang kritis', 'Rantai Pasok', 3, 3, 2, 2],
  ['Gempa dan tsunami di area pelabuhan', 'Bencana Alam', 2, 5, 2, 4],
  ['Fluktuasi harga bahan bakar', 'Keuangan', 4, 3, 3, 3],
  ['Reputasi akibat viral keluhan pelanggan', 'Reputasi', 3, 3, 2, 2],
];

if (!hasRows('risk_register')) {
  RISK_ROWS.forEach(([title, category, l, s, rl, rs], i) => {
    insert('risk_register', {
      title,
      risk_description: `${title} berpotensi mengganggu pencapaian sasaran perusahaan.`,
      cause: 'Kombinasi faktor teknis, perilaku, dan kondisi eksternal yang belum sepenuhnya terkendali.',
      consequence: 'Gangguan operasi, potensi cedera, kerugian finansial, dan dampak reputasi.',
      risk_category: category,
      risk_source: pick(['Workshop Risiko', 'Insiden', 'Audit', 'Analisis Data'], i),
      objective_affected: pick(['Keselamatan operasi', 'Keandalan layanan', 'Kepatuhan regulasi', 'Kinerja keuangan'], i),
      likelihood: String(l),
      severity: String(s),
      existing_control: 'Prosedur, inspeksi berkala, pelatihan, dan pemantauan indikator.',
      control_effectiveness: pick(['Efektif', 'Cukup', 'Sangat Efektif'], i),
      treatment_option: pick(['Mengurangi Kemungkinan', 'Mengurangi Dampak', 'Membagi / Mengalihkan (Transfer)', 'Menerima Risiko (Accept)'], i),
      treatment_plan: 'Pelaksanaan program mitigasi terjadwal dengan pemantauan indikator risiko utama.',
      res_likelihood: String(rl),
      res_severity: String(rs),
      review_date: daysAhead(randInt(-20, 240)),
      risk_appetite: rl * rs > 9 ? 'Melebihi Selera Risiko' : rl * rs > 6 ? 'Di Ambang Batas' : 'Dalam Selera Risiko',
    }, { status: pick(['monitored', 'treatment', 'assessed'], i), org: i % 3 === 0 ? CORPORATE : pick(SITES, i) });
  });
}

if (!hasRows('corporate_risk')) {
  [['Ketergantungan pada lintasan utama Merak-Bakauheni', 'Strategis', 3, 5], ['Perubahan regulasi tarif penyeberangan', 'Kepatuhan', 3, 4], ['Kegagalan transformasi digital', 'Transformasi Digital', 3, 4], ['Tuntutan dekarbonisasi armada', 'Keberlanjutan/ESG', 4, 3]].forEach(([title, category, l, s], i) => {
    insert('corporate_risk', {
      title,
      risk_description: `${title} dapat mempengaruhi pencapaian sasaran strategis perusahaan.`,
      cause: 'Dinamika eksternal dan keterbatasan kapasitas internal.',
      consequence: 'Penurunan kinerja keuangan dan daya saing perusahaan.',
      risk_category: category,
      strategic_objective: pick(['Pertumbuhan pendapatan', 'Keunggulan layanan', 'Keberlanjutan usaha'], i),
      financial_impact: randInt(5, 60) * 1e9,
      escalated_to_board: i < 2,
      likelihood: String(l),
      severity: String(s),
      existing_control: 'Perencanaan strategis, diversifikasi lintasan, dan pemantauan regulasi.',
      control_effectiveness: 'Cukup',
      treatment_option: 'Mengurangi Dampak',
      treatment_plan: 'Program strategis multi-tahun dengan tinjauan triwulanan oleh Direksi.',
      res_likelihood: String(Math.max(1, l - 1)),
      res_severity: String(Math.max(1, s - 1)),
      review_date: daysAhead(randInt(30, 200)),
      risk_appetite: 'Di Ambang Batas',
    }, { status: 'monitored', org: CORPORATE });
  });
}

for (const [modKey, rows] of [
  ['operational_risk', [['Keterlambatan jadwal akibat antrian kendaraan', 'Operasi Pelabuhan', 4, 3], ['Kerusakan mesin kapal saat operasi', 'Operasi Kapal', 3, 4], ['Kesalahan pengaturan muatan di dek', 'Bongkar Muat', 3, 4]]],
  ['port_risk', [['Kerusakan fender akibat benturan kapal', 'Dermaga & Fender', 4, 3], ['Akses tidak sah ke area steril', 'Keamanan Fasilitas (ISPS)', 3, 4], ['Kepadatan ekstrem area antrian', 'Kepadatan Puncak (Peak Season)', 4, 4]]],
  ['vessel_risk', [['Kegagalan pengunci ramp door', 'Ramp Door / Bow Door', 2, 5], ['Kebakaran di dek kendaraan', 'Kebakaran di Kapal', 2, 5], ['Muatan bergeser saat cuaca buruk', 'Stabilitas & Muatan', 3, 4]]],
]) {
  if (hasRows(modKey)) continue;
  rows.forEach(([title, area, l, s], i) => {
    const org = modKey === 'vessel_risk' ? VESSEL_SITE(pick(Object.keys(vesselIds), i)) : pick(SITES, i);
    insert(modKey, {
      title,
      risk_description: `${title} teridentifikasi pada kegiatan operasional rutin.`,
      cause: 'Keterbatasan pengendalian teknis dan variasi kondisi lapangan.',
      consequence: 'Gangguan operasi, potensi cedera dan kerugian material.',
      risk_area: area,
      process_area: area,
      likelihood: String(l),
      severity: String(s),
      existing_control: 'Inspeksi berkala, prosedur operasi, dan pengawasan langsung.',
      control_effectiveness: 'Efektif',
      treatment_option: 'Mengurangi Kemungkinan',
      treatment_plan: 'Penambahan frekuensi inspeksi dan perbaikan sarana pengendalian.',
      res_likelihood: String(Math.max(1, l - 1)),
      res_severity: String(Math.max(1, s - 1)),
      review_date: daysAhead(randInt(20, 200)),
      risk_appetite: 'Dalam Selera Risiko',
      affects_public: modKey === 'port_risk',
      affects_seaworthiness: modKey === 'vessel_risk',
    }, { status: pick(['monitored', 'treatment'], i), org });
  });
}

if (!hasRows('risk_treatment')) {
  ['Pemasangan sensor pengunci ramp door', 'Penggantian fender dermaga 3', 'Penambahan kantong parkir angkutan lebaran', 'Penguatan sistem keamanan siber ticketing'].forEach((title, i) => {
    insert('risk_treatment', {
      title,
      risk_ref: `RSK/${new Date().getFullYear()}/${String(i + 1).padStart(4, '0')}`,
      treatment_option: 'Mengurangi Kemungkinan',
      treatment_description: `${title} sebagai perlakuan risiko prioritas tinggi.`,
      start_date: daysAgo(randInt(30, 180)),
      due_date: daysAhead(randInt(-20, 180)),
      budget: randInt(300, 3500) * 1e6,
      realization: randInt(100, 2800) * 1e6,
      progress: i < 2 ? 100 : randInt(30, 80),
      kpi_indicator: 'Penurunan frekuensi kejadian dan nilai risiko residual.',
      effectiveness_review: i < 2 ? 'Perlakuan efektif menurunkan tingkat risiko ke level yang dapat diterima.' : null,
      residual_acceptable: i < 2 ? 'Ya' : 'Perlu Perlakuan Tambahan',
    }, { status: i < 2 ? 'closed' : 'in_progress', org: pick([...SITES, CORPORATE], i) });
  });
}

/* -------------------------------------------------------- aset & kontraktor */

console.log('  Memuat rekaman aset & kontraktor ...');

const assetRows = all('SELECT id, name, category FROM m_asset ORDER BY id');
const siteOfAsset = (i) => pick(SITES, i);

if (!hasRows('equipment_inspection') && assetRows.length) {
  assetRows.forEach((asset, i) => {
    const date = daysAgo(randInt(5, 200));
    const result = i % 9 === 0 ? 'Laik dengan Catatan' : i % 13 === 0 ? 'Tidak Laik Operasi' : 'Laik Operasi';
    insert('equipment_inspection', {
      title: `Inspeksi ${asset.name}`,
      asset_ref: asset.id,
      inspection_type: pick(['Bulanan', 'Triwulanan', 'Tahunan', 'Riksa Uji Disnaker'], i),
      inspection_date: date,
      inspector_certified: i % 3 === 0,
      visual_condition: result === 'Tidak Laik Operasi' ? 'Perlu Perbaikan' : 'Baik',
      function_test: 'Baik',
      safety_device: result === 'Laik Operasi' ? 'Baik' : 'Perlu Perbaikan',
      structural: 'Baik',
      lubrication: 'Baik',
      electrical: 'Baik',
      hydraulic: pick(['Baik', 'Baik', 'Perlu Perbaikan'], i),
      operating_hours: randInt(2000, 26000),
      findings: result === 'Laik Operasi' ? 'Tidak ditemukan ketidaksesuaian signifikan.' : 'Ditemukan kebocoran minor pada sistem hidrolik dan keausan komponen.',
      result,
      tagged_out: result === 'Tidak Laik Operasi',
      recommendation: 'Penggantian komponen aus dan penjadwalan pemeliharaan preventif.',
      next_inspection: daysAhead(randInt(-15, 180)),
    }, { status: pick(['verified', 'completed'], i), org: siteOfAsset(i), createdAt: `${date}T08:00:00.000Z` });
  });
}

if (!hasRows('maintenance') && assetRows.length) {
  assetRows.slice(0, 12).forEach((asset, i) => {
    const date = daysAgo(randInt(10, 260));
    insert('maintenance', {
      title: `Pemeliharaan ${asset.name}`,
      asset_ref: asset.id,
      maintenance_type: pick(['Preventif Terjadwal', 'Korektif / Perbaikan', 'Prediktif (Condition Based)', 'Darurat / Breakdown'], i),
      plan_date: date,
      actual_date: date,
      completion_date: date,
      work_description: 'Pemeriksaan menyeluruh, penggantian komponen habis pakai, pelumasan, dan uji fungsi.',
      executor_type: i % 3 === 0 ? 'Kontraktor' : 'Internal',
      spare_parts: 'Seal hidrolik, filter, pelumas, dan komponen kelistrikan.',
      downtime_hours: randInt(2, 26),
      cost: randInt(8, 320) * 1e6,
      permit_required: i % 2 === 0,
      loto_applied: true,
      result: pick(['Selesai - Normal', 'Selesai - dengan Catatan'], i),
      post_maintenance_test: 'Uji fungsi berhasil, parameter operasi kembali normal.',
      next_maintenance: daysAhead(randInt(-10, 200)),
    }, { status: 'verified', org: siteOfAsset(i), createdAt: `${date}T08:00:00.000Z` });
  });
}

if (!hasRows('calibration')) {
  [['Gas Detector Portable', 'Gas Detector'], ['Sound Level Meter', 'Sound Level Meter'], ['Lux Meter Terminal', 'Lux Meter'], ['Jembatan Timbang Kendaraan', 'Timbangan / Jembatan Timbang'], ['Pressure Gauge Fire Main', 'Manometer / Pressure Gauge'], ['Anemometer Dermaga', 'Anemometer']].forEach(([title, type], i) => {
    const date = daysAgo(randInt(20, 320));
    const bad = i === 3;
    insert('calibration', {
      title,
      instrument_type: type,
      serial_number: `CAL-${randInt(10000, 99999)}`,
      calibration_date: date,
      calibration_body: 'Balai Kalibrasi Terakreditasi KAN',
      accreditation_no: `LK-${randInt(100, 999)}-IDN`,
      certificate_no: `KAL/${randInt(1000, 9999)}/${new Date().getFullYear()}`,
      deviation: Number((rnd() * 2).toFixed(4)),
      deviation_unit: pick(['%', 'ppm', 'dB', 'kg'], i),
      tolerance: 2,
      result: bad ? 'Tidak Sesuai (Out of Tolerance)' : 'Sesuai (In Tolerance)',
      adjustment_done: bad,
      valid_until: daysAhead(randInt(-20, 360)),
      impact_assessment: bad ? 'Data penimbangan periode sebelumnya ditinjau ulang; tidak ditemukan dampak signifikan.' : null,
    }, { status: 'validated', org: pick(SITES, i), createdAt: `${date}T08:00:00.000Z` });
  });
}

if (!hasRows('certification')) {
  const CERTS = [];
  for (const [name, id] of Object.entries(vesselIds)) {
    CERTS.push([`Sertifikat Keselamatan Kapal ${name}`, 'Kapal', 'Sertifikat Keselamatan Kapal', 'Direktorat Jenderal Perhubungan Laut', VESSEL_SITE(name)]);
    CERTS.push([`Safety Management Certificate ${name}`, 'Kapal', 'Safety Management Certificate (SMC)', 'Direktorat Jenderal Perhubungan Laut', VESSEL_SITE(name)]);
    CERTS.push([`Sertifikat Klasifikasi BKI ${name}`, 'Kapal', 'Sertifikat Klasifikasi BKI', 'Biro Klasifikasi Indonesia', VESSEL_SITE(name)]);
  }
  CERTS.push(['Document of Compliance (DOC) Perusahaan', 'Perusahaan', 'Document of Compliance (DOC)', 'Direktorat Jenderal Perhubungan Laut', CORPORATE]);
  CERTS.push(['Sertifikat ISO 45001:2018', 'Perusahaan', 'Sertifikat ISO', 'PT Sertifikasi Mutu Indonesia', CORPORATE]);
  CERTS.push(['Izin Lingkungan Pelabuhan Merak', 'Pelabuhan', 'Izin Lingkungan', 'Dinas Lingkungan Hidup Provinsi Banten', MERAK]);
  CERTS.push(['Izin TPS Limbah B3 Bakauheni', 'Pelabuhan', 'Izin TPS Limbah B3', 'Dinas Lingkungan Hidup Lampung Selatan', BAKAUHENI]);
  CERTS.push(['Suket Layak Crane Ketapang', 'Peralatan', 'Suket Layak Pesawat Angkat', 'Dinas Tenaga Kerja Provinsi Jawa Timur', KETAPANG]);

  CERTS.forEach(([title, holder, category, issuer, org], i) => {
    insert('certification', {
      title,
      holder_type: holder,
      cert_category: category,
      certificate_no: `${category.slice(0, 3).toUpperCase()}/${randInt(1000, 9999)}/${new Date().getFullYear() - (i % 2)}`,
      issuer,
      issue_date: daysAgo(randInt(120, 900)),
      valid_until: daysAhead(randInt(-25, 720)),
      endorsement_due: daysAhead(randInt(-10, 300)),
      renewal_lead_days: 60,
      notes: 'Perpanjangan diajukan paling lambat 60 hari sebelum masa berlaku berakhir.',
    }, { status: 'active', org });
  });
}

if (!hasRows('asset_criticality') && assetRows.length) {
  assetRows.slice(0, 10).forEach((asset, i) => {
    const critical = asset.category === 'Movable Bridge' || asset.category === 'Ramp Door';
    insert('asset_criticality', {
      title: `Penilaian kekritisan ${asset.name}`,
      asset_ref: asset.id,
      assessment_date: daysAgo(randInt(30, 300)),
      safety_impact: critical ? '5 - Fatal' : pick(['3 - Sedang', '2 - Ringan', '4 - Berat'], i),
      operational_impact: critical ? '5 - Operasi Berhenti' : pick(['3 - Gangguan Sebagian', '4 - Gangguan Besar'], i),
      environmental_impact: pick(['2 - Ringan', '3 - Sedang'], i),
      financial_impact: pick(['3 - 100 Juta-1 M', '4 - 1-10 M'], i),
      likelihood: String(randInt(2, 4)),
      severity: String(critical ? 5 : randInt(3, 4)),
      maintenance_strategy: critical ? 'Preventive Maintenance Ketat' : pick(['Condition Based Monitoring', 'Preventive Maintenance Ketat'], i),
      spare_stock_level: randInt(1, 6),
      redundancy_available: !critical,
      mtbf_hours: randInt(2000, 12000),
      mttr_hours: randInt(2, 36),
      justification: 'Penilaian mempertimbangkan dampak keselamatan, kelangsungan operasi, dan biaya penggantian.',
    }, { status: 'monitored', org: siteOfAsset(i) });
  });
}

const contractorRows = all('SELECT id, name FROM m_contractor ORDER BY id');

if (!hasRows('contractor_prequalification') && contractorRows.length) {
  contractorRows.forEach((c, i) => {
    insert('contractor_prequalification', {
      contractor_ref: c.id,
      assessment_date: daysAgo(randInt(40, 320)),
      scope_of_work: pick(['Pemeliharaan dermaga', 'Docking kapal', 'Kebersihan terminal', 'Pengelolaan limbah B3', 'Jasa keamanan'], i),
      risk_level_work: pick(['Tinggi', 'Sedang', 'Rendah'], i),
      score_commitment: randInt(65, 96),
      score_procedure: randInt(60, 95),
      score_competency: randInt(62, 94),
      score_equipment: randInt(60, 96),
      score_performance: randInt(58, 95),
      score_compliance: randInt(70, 98),
      result: i === 3 ? 'Lulus Bersyarat' : 'Lulus Prakualifikasi',
      conditions: i === 3 ? 'Melengkapi sertifikat kompetensi operator dan bukti kepesertaan BPJS seluruh pekerja.' : null,
      valid_until: daysAhead(randInt(-10, 500)),
    }, { status: 'closed', org: pick(SITES, i) });
  });
}

if (!hasRows('contractor_evaluation') && contractorRows.length) {
  contractorRows.forEach((c, i) => {
    insert('contractor_evaluation', {
      contractor_ref: c.id,
      period: `${new Date().getFullYear()}-Q${(i % 4) + 1}`,
      evaluation_date: daysAgo(randInt(20, 220)),
      project_name: pick(['Pemeliharaan MB Dermaga 2', 'Docking tahunan', 'Kebersihan terminal', 'Pengangkutan limbah B3', 'Pengamanan area steril'], i),
      score_quality: randInt(70, 96),
      score_hse: randInt(65, 95),
      score_timeliness: randInt(68, 97),
      score_cooperation: randInt(72, 96),
      score_documentation: randInt(60, 95),
      incident_count: randInt(0, 2),
      violation_count: randInt(0, 4),
      stop_work_count: randInt(0, 2),
      recommendation: i === 3 ? 'Dapat Digunakan dengan Pembinaan' : 'Dapat Digunakan Kembali',
      strengths: 'Responsif terhadap permintaan perbaikan dan dokumentasi kerja rapi.',
      improvement_areas: 'Kedisiplinan penggunaan APD dan kelengkapan izin kerja perlu ditingkatkan.',
    }, { status: 'closed', org: pick(SITES, i) });
  });
}

if (!hasRows('contractor_permit') && contractorRows.length) {
  contractorRows.forEach((c, i) => {
    insert('contractor_permit', {
      contractor_ref: c.id,
      title: pick(['Pemeliharaan movable bridge', 'Pekerjaan docking', 'Kebersihan area terminal', 'Pengangkutan limbah B3', 'Pengamanan area'], i),
      valid_from: daysAgo(randInt(5, 60)),
      valid_to: daysAhead(randInt(-5, 90)),
      worker_count: randInt(5, 40),
      area_access: pick([['Dermaga', 'Bengkel'], ['Kapal', 'Ruang Mesin Kapal'], ['Terminal Penumpang'], ['TPS Limbah B3']], i),
      induction_done: true,
      induction_date: daysAgo(randInt(6, 61)),
      induction_participants: randInt(5, 40),
      id_card_issued: true,
      documents_verified: ['Kontrak', 'BPJS Ketenagakerjaan', 'Sertifikat Kompetensi', 'JSA/HIRA'],
      special_conditions: 'Wajib lapor ke pengawas internal sebelum memulai pekerjaan setiap hari.',
    }, { status: pick(['active', 'approved', 'closed'], i), org: pick(SITES, i) });
  });
}

if (!hasRows('contractor_safety_performance') && contractorRows.length) {
  for (let back = 5; back >= 0; back--) {
    contractorRows.forEach((c, i) => {
      const manhours = randInt(4000, 22000);
      insert('contractor_safety_performance', {
        contractor_ref: c.id,
        period: monthKey(back),
        manhours,
        worker_count: randInt(10, 90),
        fatality: 0,
        lti: back === 2 && i === 1 ? 1 : 0,
        mtc: randInt(0, 2),
        fac: randInt(0, 4),
        near_miss: randInt(0, 6),
        unsafe_findings: randInt(0, 9),
        lost_days: back === 2 && i === 1 ? randInt(5, 15) : 0,
        toolbox_count: randInt(8, 26),
        training_hours: randInt(4, 40),
      }, { status: 'validated', org: pick(SITES, i), createdAt: `${monthKey(back)}-28T08:00:00.000Z` });
    });
  }
}

/* -------------------------------------------------- keselamatan pelayaran */

console.log('  Memuat rekaman keselamatan pelayaran ...');

const vesselNames = Object.keys(vesselIds);
const OK = 'Baik';
const chk = (names, badIndex = -1) => Object.fromEntries(names.map((n, i) => [n, i === badIndex ? 'Perlu Perbaikan' : OK]));

const FSC_ITEMS = ['ramp_door', 'bow_door', 'stern_door', 'door_indicator', 'ballast', 'stability', 'navigation_light', 'sound_signal', 'radar', 'gps_ais', 'vhf_radio', 'echo_sounder', 'main_engine_test', 'steering_test', 'generator', 'emergency_generator', 'bilge_pump', 'fire_pump', 'engine_room', 'bridge_equipment', 'lifejacket', 'liferaft', 'fire_extinguisher', 'vehicle_lashing', 'passenger_manifest', 'crew_complete', 'weather_check', 'sailing_clearance'];

if (!hasRows('ferry_safety_checklist')) {
  let n = 0;
  for (let back = 5; back >= 0; back--) {
    for (const name of vesselNames) {
      for (let k = 0; k < 3; k++) {
        const bad = n % 11 === 0 ? randInt(0, FSC_ITEMS.length - 1) : -1;
        const delayed = n % 17 === 0;
        const date = `${monthKey(back)}-${String(randInt(1, 28)).padStart(2, '0')}`;
        insert('ferry_safety_checklist', {
          voyage_date: date,
          departure_time: `${String(randInt(0, 23)).padStart(2, '0')}:00`,
          route: VESSELS.find((v) => v.name === name).route,
          trip_number: `TR-${randInt(1000, 9999)}`,
          ...chk(FSC_ITEMS, bad),
          items_checked: FSC_ITEMS.length,
          items_not_ok: bad >= 0 ? 1 : 0,
          deficiency_notes: bad >= 0 ? 'Terdapat satu item memerlukan perbaikan sebelum keberangkatan berikutnya.' : null,
          departure_decision: delayed ? 'Ditunda' : bad >= 0 ? 'Berangkat dengan Catatan' : 'Layak Berangkat',
          decision_reason: delayed ? 'Menunggu perbaikan dan konfirmasi kondisi cuaca.' : 'Seluruh item kritis terpenuhi.',
        }, { status: 'verified', org: VESSEL_SITE(name), createdAt: `${date}T05:00:00.000Z` });
        n += 1;
      }
    }
  }
}

if (!hasRows('vessel_safety_inspection')) {
  const ITEMS = ['hull_condition', 'watertight_doors', 'navigation_equipment', 'communication_equipment', 'main_engine', 'auxiliary_engine', 'steering_gear', 'emergency_steering', 'bilge_system', 'ballast_system', 'fire_detection', 'fire_main', 'lsa_general', 'emergency_lighting', 'escape_routes', 'accommodation', 'pollution_prevention', 'mooring_equipment', 'ramp_doors', 'vehicle_deck', 'documentation'];
  vesselNames.forEach((name, i) => {
    const date = daysAgo(randInt(15, 260));
    const def = randInt(0, 5);
    insert('vessel_safety_inspection', {
      title: `Inspeksi keselamatan ${name}`,
      inspection_date: date,
      inspection_type: pick(['Inspeksi Internal Perusahaan', 'Verifikasi ISM Internal', 'Persiapan Port State Control', 'Pasca Docking'], i),
      ...chk(ITEMS, def > 3 ? i % ITEMS.length : -1),
      items_checked: ITEMS.length,
      deficiencies: def,
      critical_deficiencies: def > 4 ? 1 : 0,
      findings: def ? 'Ditemukan ketidaksesuaian pada kelengkapan rekaman dan kondisi minor peralatan.' : 'Tidak ditemukan ketidaksesuaian berarti.',
      seaworthy: def > 4 ? 'Laik dengan Catatan' : 'Laik Laut',
      recommendation: 'Menutup temuan sebelum pelayaran berikutnya dan memperbarui rekaman pemeliharaan.',
      next_inspection: daysAhead(randInt(20, 200)),
    }, { status: 'verified', org: VESSEL_SITE(name), createdAt: `${date}T08:00:00.000Z` });
  });
}

if (!hasRows('sailing_clearance')) {
  let n = 0;
  for (let back = 3; back >= 0; back--) {
    for (const name of vesselNames) {
      const held = n % 13 === 0;
      const date = `${monthKey(back)}-${String(randInt(1, 28)).padStart(2, '0')}`;
      const v = VESSELS.find((x) => x.name === name);
      insert('sailing_clearance', {
        clearance_date: date,
        spb_number: `SPB/${randInt(1000, 9999)}/${monthKey(back)}`,
        issuing_office: pick(['KSOP Kelas I Banten', 'KSOP Kelas II Panjang', 'KSOP Tanjung Wangi', 'KSOP Gilimanuk'], n),
        departure_port: v.route.split(' - ')[0],
        destination_port: v.route.split(' - ')[1],
        departure_time: `${String(randInt(0, 23)).padStart(2, '0')}:30`,
        crew_count: randInt(20, 32),
        passenger_count: randInt(120, v.pax),
        vehicle_count: randInt(30, v.veh),
        cargo_tonnage: randInt(300, 1800),
        checklist_ref: `FSC/${new Date().getFullYear()}/${String(randInt(1, 400)).padStart(4, '0')}`,
        documents_complete: true,
        crew_certificates_valid: true,
        weather_approved: !held,
        clearance_status: held ? 'Ditunda' : 'Diterbitkan',
        hold_reason: held ? 'Gelombang tinggi melebihi batas operasi lintasan.' : null,
        actual_departure: date,
        delay_minutes: held ? randInt(60, 240) : randInt(0, 25),
      }, { status: held ? 'closed' : 'active', org: VESSEL_SITE(name), createdAt: `${date}T04:00:00.000Z` });
      n += 1;
    }
  }
}

if (!hasRows('ramp_door_inspection')) {
  const ITEMS = ['hydraulic_system', 'hydraulic_hoses', 'wire_rope_chain', 'hinge_bearing', 'locking_device', 'securing_indicator', 'rubber_seal', 'structure_deformation', 'corrosion', 'emergency_operation', 'limit_switch', 'warning_alarm', 'deck_surface'];
  vesselNames.forEach((name, i) => {
    const date = daysAgo(randInt(10, 200));
    const bad = i % 4 === 0;
    insert('ramp_door_inspection', {
      title: `Inspeksi ramp door ${name}`,
      inspection_date: date,
      door_type: pick(['Ramp Door Haluan', 'Ramp Door Buritan', 'Bow Door', 'Stern Door'], i),
      ...chk(ITEMS, bad ? 0 : -1),
      cycle_count: randInt(3000, 42000),
      hydraulic_pressure: 140 + rnd() * 40,
      operation_time_sec: randInt(45, 110),
      findings: bad ? 'Terdapat rembesan minor pada sistem hidrolik dan keausan karet perapat.' : 'Kondisi baik, seluruh interlock berfungsi.',
      result: bad ? 'Laik dengan Pembatasan' : 'Laik Operasi',
      load_test_done: i % 3 === 0,
      next_inspection: daysAhead(randInt(10, 150)),
    }, { status: 'verified', org: VESSEL_SITE(name), createdAt: `${date}T08:00:00.000Z` });
  });
}

if (!hasRows('vehicle_loading_safety')) {
  const ITEMS = ['weight_distribution', 'vehicle_lashing', 'handbrake_gear', 'engine_off', 'fuel_leak_check', 'spacing', 'access_route', 'dg_segregation', 'passenger_evacuated_deck', 'deck_ventilation', 'fire_detection_deck'];
  let n = 0;
  for (let back = 4; back >= 0; back--) {
    for (const name of vesselNames) {
      const v = VESSELS.find((x) => x.name === name);
      const total = randInt(Math.round(v.veh * 0.5), v.veh);
      const date = `${monthKey(back)}-${String(randInt(1, 28)).padStart(2, '0')}`;
      insert('vehicle_loading_safety', {
        loading_date: date,
        trip_number: `TR-${randInt(1000, 9999)}`,
        route: v.route,
        deck_capacity_sup: v.veh,
        total_vehicles: total,
        golongan_i_ii: Math.round(total * 0.25),
        golongan_iii_iv: Math.round(total * 0.35),
        golongan_v_vi: Math.round(total * 0.25),
        golongan_vii_ix: Math.round(total * 0.15),
        total_weight_ton: Math.round(total * randInt(3, 9)),
        overdimension_present: n % 7 === 0,
        overdimension_count: n % 7 === 0 ? randInt(1, 3) : 0,
        dg_vehicle_present: n % 5 === 0,
        dg_vehicle_count: n % 5 === 0 ? randInt(1, 2) : 0,
        dg_manifest_verified: n % 5 === 0,
        ...chk(ITEMS, n % 9 === 0 ? 1 : -1),
        findings: n % 9 === 0 ? 'Sebagian kendaraan belum terikat sempurna dan diperbaiki sebelum berlayar.' : 'Pemuatan sesuai ketentuan.',
        result: n % 9 === 0 ? 'Perlu Perbaikan Sebelum Berlayar' : 'Aman untuk Berlayar',
      }, { status: 'verified', org: VESSEL_SITE(name), createdAt: `${date}T06:00:00.000Z` });
      n += 1;
    }
  }
}

if (!hasRows('passenger_safety')) {
  const ITEMS = ['manifest_accuracy', 'safety_briefing', 'lifejacket_availability', 'lifejacket_demo', 'muster_station_marking', 'evacuation_route', 'emergency_lighting', 'pa_system', 'disability_access', 'seating_capacity', 'toilet_sanitation', 'no_smoking', 'passenger_deck_access', 'first_aid_ready'];
  let n = 0;
  for (let back = 4; back >= 0; back--) {
    for (const name of vesselNames) {
      const v = VESSELS.find((x) => x.name === name);
      const manifest = randInt(Math.round(v.pax * 0.4), Math.round(v.pax * (n % 12 === 0 ? 1.05 : 0.95)));
      const date = `${monthKey(back)}-${String(randInt(1, 28)).padStart(2, '0')}`;
      insert('passenger_safety', {
        voyage_date: date,
        trip_number: `TR-${randInt(1000, 9999)}`,
        manifest_count: manifest,
        actual_count: manifest,
        pax_capacity: v.pax,
        children_count: Math.round(manifest * 0.12),
        elderly_count: Math.round(manifest * 0.08),
        disability_count: randInt(0, 4),
        pregnant_count: randInt(0, 3),
        ...chk(ITEMS, n % 10 === 0 ? 8 : -1),
        briefing_duration: randInt(3, 8),
        findings: n % 10 === 0 ? 'Akses penyandang disabilitas ke gangway perlu perbaikan kemiringan.' : 'Seluruh aspek keselamatan penumpang terpenuhi.',
        result: n % 10 === 0 ? 'Memenuhi dengan Catatan' : 'Memenuhi Standar',
      }, { status: 'verified', org: VESSEL_SITE(name), createdAt: `${date}T06:30:00.000Z` });
      n += 1;
    }
  }
}

if (!hasRows('lsa_inspection')) {
  vesselNames.forEach((name, i) => {
    const v = VESSELS.find((x) => x.name === name);
    const date = daysAgo(randInt(10, 180));
    insert('lsa_inspection', {
      inspection_date: date,
      inspection_type: pick(['Bulanan', 'Triwulanan', 'Tahunan'], i),
      lifejacket_required: v.pax + 30,
      lifejacket_available: v.pax + 30 + randInt(0, 40),
      lifejacket_defect: randInt(0, 6),
      lifejacket_child: Math.round(v.pax * 0.12),
      lifejacket_condition: OK,
      liferaft_count: randInt(8, 20),
      liferaft_capacity: v.pax + 60,
      liferaft_service_due: daysAhead(randInt(-15, 300)),
      liferaft_condition: OK,
      hru_expiry: daysAhead(randInt(-10, 400)),
      lifebuoy_count: randInt(10, 20),
      lifebuoy_condition: OK,
      lifeboat_count: randInt(2, 4),
      lifeboat_condition: OK,
      lifeboat_load_test: daysAgo(randInt(60, 700)),
      immersion_suit: OK,
      pyrotechnics: OK,
      pyrotechnics_expiry: daysAhead(randInt(-20, 500)),
      epirb: OK,
      epirb_battery_expiry: daysAhead(randInt(-5, 600)),
      sart: OK,
      embarkation_ladder: OK,
      muster_list: OK,
      signage: OK,
      deficiencies: randInt(0, 4),
      findings: 'Beberapa life jacket perlu penggantian karena tali pengikat mulai getas.',
      result: i % 5 === 0 ? 'Layak dengan Catatan' : 'Lengkap & Layak',
      next_inspection: daysAhead(randInt(15, 120)),
    }, { status: 'verified', org: VESSEL_SITE(name), createdAt: `${date}T08:00:00.000Z` });
  });
}

if (!hasRows('ffa_inspection')) {
  for (let i = 0; i < 12; i++) {
    const date = daysAgo(randInt(5, 240));
    const total = randInt(20, 90);
    const expired = randInt(0, 6);
    const onVessel = i % 2 === 0;
    insert('ffa_inspection', {
      inspection_date: date,
      location_type: onVessel ? 'Kapal' : pick(['Terminal Penumpang', 'Dermaga', 'Bengkel', 'Gudang'], i),
      apar_total: total,
      apar_ok: total - expired,
      apar_expired: expired,
      apar_pressure_low: randInt(0, 3),
      apar_condition: expired ? 'Perlu Perbaikan' : OK,
      apar_accessibility: OK,
      hydrant_count: randInt(4, 18),
      hydrant_condition: OK,
      fire_pump: OK,
      emergency_fire_pump: OK,
      fire_pump_pressure: 6 + rnd() * 3,
      fixed_system: OK,
      fire_detection: OK,
      fire_damper: OK,
      fireman_outfit: OK,
      scba_test_due: daysAhead(randInt(-10, 300)),
      emergency_escape_bcba: OK,
      fire_plan: OK,
      escape_route: OK,
      assembly_point: OK,
      deficiencies: expired,
      findings: expired ? `${expired} unit APAR kedaluwarsa dan dijadwalkan penggantian.` : 'Seluruh sarana proteksi kebakaran siap digunakan.',
      result: expired > 3 ? 'Siap dengan Catatan' : 'Siap Digunakan',
      next_inspection: daysAhead(randInt(15, 120)),
    }, { status: 'verified', org: onVessel ? VESSEL_SITE(pick(vesselNames, i)) : pick(SITES, i), createdAt: `${date}T08:00:00.000Z` });
  }
}

if (!hasRows('stability_monitoring')) {
  let n = 0;
  for (let back = 3; back >= 0; back--) {
    for (const name of vesselNames) {
      const gm = 0.35 + rnd() * 0.9;
      const low = n % 14 === 0;
      const date = `${monthKey(back)}-${String(randInt(1, 28)).padStart(2, '0')}`;
      insert('stability_monitoring', {
        voyage_date: date,
        trip_number: `TR-${randInt(1000, 9999)}`,
        condition: pick(['Muatan Penuh', 'Muatan Sebagian'], n),
        displacement: randInt(1500, 5200),
        draft_fore: 3.8 + rnd() * 0.6,
        draft_aft: 4.1 + rnd() * 0.6,
        heel_angle: Number((rnd() * 2).toFixed(1)),
        gm_value: low ? 0.12 : Number(gm.toFixed(3)),
        gm_minimum: 0.15,
        free_surface_effect: Number((rnd() * 0.08).toFixed(3)),
        cargo_weight: randInt(300, 1800),
        ballast_weight: randInt(100, 700),
        fuel_weight: randInt(60, 320),
        freeboard: 1.6 + rnd() * 0.8,
        loadline_compliant: true,
        stability_booklet_used: true,
        approved_by_master: true,
        result: low ? 'Perlu Penyesuaian Muatan' : 'Stabilitas Memenuhi',
        notes: low ? 'Muatan diatur ulang sebelum keberangkatan untuk memenuhi GM minimum.' : null,
      }, { status: 'validated', org: VESSEL_SITE(name), createdAt: `${date}T05:30:00.000Z` });
      n += 1;
    }
  }
}

if (!hasRows('weather_monitoring')) {
  for (let i = 0; i < 30; i++) {
    const wave = Number((0.3 + rnd() * 3.2).toFixed(1));
    const rough = wave > 2.5;
    const date = daysAgo(randInt(1, 200));
    insert('weather_monitoring', {
      observation_date: date,
      observation_time: `${String(randInt(0, 23)).padStart(2, '0')}:00`,
      area: pick(['Selat Sunda', 'Selat Bali', 'Teluk Bone', 'Perairan Merak', 'Perairan Ketapang'], i),
      source: pick(['BMKG', 'Stasiun Meteorologi Maritim', 'Observasi Kapal'], i),
      wind_speed: Number((5 + rnd() * 28).toFixed(1)),
      wind_direction: pick(['Barat Daya', 'Timur Laut', 'Selatan', 'Barat'], i),
      wave_height: wave,
      visibility_km: Number((2 + rnd() * 10).toFixed(1)),
      current_speed: Number((0.5 + rnd() * 3).toFixed(1)),
      rainfall: Number((rnd() * 40).toFixed(1)),
      weather_condition: rough ? pick(['Hujan Lebat', 'Badai'], i) : pick(['Cerah', 'Berawan', 'Hujan Ringan'], i),
      sea_state: wave < 0.5 ? 'Tenang (0-0.5m)' : wave < 1.25 ? 'Sedang (0.5-1.25m)' : wave < 2.5 ? 'Berombak (1.25-2.5m)' : 'Kasar (2.5-4m)',
      bmkg_warning: rough,
      warning_detail: rough ? 'Peringatan dini gelombang tinggi 2,5-4 meter berlaku 24 jam ke depan.' : null,
      operational_decision: rough ? pick(['Penundaan Keberangkatan', 'Penutupan Sementara Lintasan'], i) : pick(['Operasi Normal', 'Operasi dengan Kewaspadaan'], i),
      trips_cancelled: rough ? randInt(2, 12) : 0,
      delay_hours: rough ? Number((1 + rnd() * 9).toFixed(1)) : 0,
      notes: 'Pemantauan dilakukan berkala dan dikoordinasikan dengan Syahbandar.',
    }, { status: 'validated', org: pick(SITES, i), createdAt: `${date}T06:00:00.000Z` });
  }
}

if (!hasRows('marine_incident')) {
  const MI = [
    ['Kapal menyentuh dasar saat manuver surut', 'Kapal Kandas (Grounding)', 'Less Serious Casualty'],
    ['Benturan lambung dengan fender dermaga', 'Tubrukan dengan Dermaga (Allision)', 'Marine Incident'],
    ['Blackout mesin bantu saat pelayaran', 'Kerusakan Mesin (Blackout/Breakdown)', 'Serious Casualty'],
    ['Penumpang jatuh ke laut saat naik kapal', 'Orang Jatuh ke Laut (Man Overboard)', 'Serious Casualty'],
    ['Penutupan pelabuhan akibat cuaca ekstrem', 'Penutupan Pelabuhan', 'Marine Incident'],
    ['Kegagalan sistem pengunci ramp door', 'Kegagalan Ramp Door', 'Less Serious Casualty'],
    ['Ceceran minyak dari kapal saat bunkering', 'Tumpahan Minyak dari Kapal', 'Marine Incident'],
  ];
  MI.forEach(([title, type, severity], i) => {
    const date = daysAgo(randInt(20, 330));
    const name = pick(vesselNames, i);
    insert('marine_incident', {
      title,
      incident_date: date,
      incident_time: `${String(randInt(0, 23)).padStart(2, '0')}:${String(randInt(0, 59)).padStart(2, '0')}`,
      incident_type: type,
      severity,
      position_lat: `-5° ${randInt(10, 59)}' LS`,
      position_lon: `105° ${randInt(10, 59)}' BT`,
      location_desc: pick(['Kolam Pelabuhan Merak', 'Alur Selat Sunda', 'Dermaga 3 Bakauheni', 'Perairan Ketapang'], i),
      voyage_phase: pick(['Sandar', 'Manuver di Kolam Pelabuhan', 'Alur Pelayaran', 'Lepas Sandar'], i),
      description: `${title}. Nakhoda segera mengambil tindakan pengamanan dan melaporkan kepada Syahbandar.`,
      fatality_count: 0,
      injured_count: type.includes('Man Overboard') ? 1 : 0,
      missing_count: 0,
      passengers_onboard: randInt(150, 900),
      crew_onboard: randInt(20, 30),
      vehicles_onboard: randInt(30, 160),
      pollution_occurred: type.includes('Tumpahan'),
      pollution_volume: type.includes('Tumpahan') ? randInt(20, 150) : 0,
      property_damage: randInt(0, 900) * 1e6,
      service_disruption_hours: Number((rnd() * 12).toFixed(1)),
      weather_at_time: pick(['Baik', 'Sedang', 'Buruk'], i),
      wave_height: Number((0.5 + rnd() * 2.5).toFixed(1)),
      sar_involved: type.includes('Man Overboard'),
      external_agencies: pick([['KSOP / Syahbandar'], ['KSOP / Syahbandar', 'Basarnas'], ['KSOP / Syahbandar', 'KLHK'], ['KSOP / Syahbandar', 'BKI']], i),
      reported_ksop: true,
      reported_knkt: severity === 'Serious Casualty',
      report_date: date,
      immediate_action: 'Pengamanan penumpang, pemeriksaan kondisi kapal, dan koordinasi dengan otoritas pelabuhan.',
      root_cause: 'Kombinasi faktor kondisi lingkungan dan keterbatasan pengendalian operasional.',
      human_factor: pick(['Ya - Kesalahan Navigasi', 'Tidak', 'Ya - Komunikasi', 'Ya - Kelelahan'], i),
      technical_factor: pick(['Kegagalan Mesin', 'Tidak Ada', 'Kegagalan Peralatan Navigasi', 'Pemeliharaan Tidak Memadai'], i),
      potential_likelihood: String(randInt(2, 4)),
      potential_severity: String(randInt(3, 5)),
      lesson_learned: 'Penguatan briefing pra-manuver dan verifikasi kondisi peralatan kritis sebelum berlayar.',
    }, { status: i < 5 ? 'closed' : 'investigating', org: VESSEL_SITE(name), createdAt: `${date}T12:00:00.000Z` });
  });
}

if (!hasRows('mooring_safety')) {
  const ITEMS = ['mooring_lines', 'winch', 'bollard', 'fender', 'rope_guard', 'snap_back_zone', 'crew_ppe', 'communication'];
  for (let i = 0; i < 14; i++) {
    const date = daysAgo(randInt(2, 260));
    insert('mooring_safety', {
      title: `Kegiatan ${pick(['sandar', 'lepas sandar', 'inspeksi peralatan tambat'], i)} dermaga ${randInt(1, 6)}`,
      activity_date: date,
      activity_type: pick(['Sandar (Berthing)', 'Lepas Sandar (Unberthing)', 'Inspeksi Peralatan Tambat'], i),
      berth_number: `Dermaga ${randInt(1, 6)}`,
      ...chk(ITEMS, i % 6 === 0 ? 3 : -1),
      lines_used: randInt(4, 10),
      wind_condition: pick(['Tenang', 'Sedang', 'Kencang'], i),
      current_condition: pick(['Tenang', 'Sedang', 'Kuat'], i),
      tug_assistance: i % 5 === 0,
      mooring_duration: randInt(8, 35),
      findings: i % 6 === 0 ? 'Fender dermaga mengalami keausan dan dijadwalkan penggantian.' : 'Kegiatan berjalan aman sesuai prosedur.',
      result: i % 6 === 0 ? 'Aman dengan Catatan' : 'Aman',
    }, { status: 'verified', org: pick(SITES, i), createdAt: `${date}T09:00:00.000Z` });
  }
}

if (!hasRows('cargo_securing')) {
  const ITEMS = ['lashing_equipment_condition', 'lashing_pattern', 'chock_wedge', 'deck_lashing_point', 'heavy_cargo_position', 'securing_manual_available', 'crew_competency'];
  for (let i = 0; i < 12; i++) {
    const date = daysAgo(randInt(2, 240));
    insert('cargo_securing', {
      inspection_date: date,
      trip_number: `TR-${randInt(1000, 9999)}`,
      cargo_type: pick(['Kendaraan', 'Muatan Umum', 'Alat Berat', 'Barang Berbahaya'], i),
      lashing_points_used: randInt(20, 90),
      ...chk(ITEMS, i % 7 === 0 ? 1 : -1),
      weather_forecast_considered: true,
      sea_state_expected: pick(['Tenang (0-1)', 'Sedang (2-3)', 'Berombak (4-5)'], i),
      findings: i % 7 === 0 ? 'Pola pengikatan disesuaikan ulang untuk muatan alat berat.' : 'Pengikatan sesuai Cargo Securing Manual.',
      result: i % 7 === 0 ? 'Perlu Penambahan Lashing' : 'Aman',
    }, { status: 'verified', org: VESSEL_SITE(pick(vesselNames, i)), createdAt: `${date}T06:00:00.000Z` });
  }
}

if (!hasRows('dangerous_goods')) {
  [['Pengangkutan LPG tabung', 'Kelas 2.1 - Gas Mudah Menyala', 'UN1965'], ['Pengangkutan solar dalam drum', 'Kelas 3 - Cairan Mudah Menyala', 'UN1202'], ['Pengangkutan aki basah', 'Kelas 8 - Korosif', 'UN2794'], ['Pengangkutan cat dan thinner', 'Kelas 3 - Cairan Mudah Menyala', 'UN1263']].forEach(([title, cls, un], i) => {
    const date = daysAgo(randInt(10, 250));
    insert('dangerous_goods', {
      title,
      shipment_date: date,
      trip_number: `TR-${randInt(1000, 9999)}`,
      imdg_class: cls,
      un_number: un,
      proper_shipping_name: title,
      packing_group: pick(['II - Bahaya Sedang', 'III - Bahaya Rendah'], i),
      quantity: randInt(200, 4000),
      quantity_unit: pick(['kg', 'liter'], i),
      shipper: `PT Distribusi Nusantara ${i + 1}`,
      vehicle_plate: `B ${randInt(1000, 9999)} XX`,
      dg_declaration: true,
      msds_available: true,
      placard_affixed: true,
      packaging_certified: true,
      segregation_applied: true,
      stowage_position: 'Dek kendaraan bagian buritan, jauh dari sumber panas.',
      fire_equipment_ready: true,
      crew_briefed: true,
      emergency_procedure: true,
      ksop_notified: true,
      approval_status: i === 3 ? 'Disetujui dengan Syarat' : 'Disetujui Diangkut',
      rejection_reason: i === 3 ? 'Wajib penempatan terpisah dan pengawasan khusus selama pelayaran.' : null,
      likelihood: String(randInt(2, 3)),
      severity: String(randInt(4, 5)),
    }, { status: 'closed', org: VESSEL_SITE(pick(vesselNames, i)), createdAt: `${date}T07:00:00.000Z` });
  });
}

if (!hasRows('port_inspection')) {
  const ITEMS = ['dermaga_structure', 'fender_condition', 'bollard_condition', 'movable_bridge', 'mb_hydraulic', 'gangway', 'trestle', 'apron_pavement', 'parking_area', 'terminal_building', 'waiting_room', 'toilet_facility', 'disability_facility', 'lighting_dermaga', 'lighting_terminal', 'signage_marking', 'sterile_area', 'access_control', 'cctv', 'evacuation_route', 'assembly_point', 'apar_hydrant', 'life_saving_shore', 'drainage', 'waste_facility', 'ipal', 'navigation_aid', 'electrical_installation', 'water_supply'];
  SITES.forEach((site, i) => {
    const date = daysAgo(randInt(10, 220));
    const findings = randInt(1, 8);
    insert('port_inspection', {
      title: `Inspeksi fasilitas ${PORTS[i].name}`,
      inspection_date: date,
      inspection_scope: 'Menyeluruh',
      ...chk(ITEMS, findings > 4 ? i % ITEMS.length : -1),
      items_checked: ITEMS.length,
      findings_count: findings,
      critical_findings: findings > 6 ? 1 : 0,
      findings: 'Ditemukan keausan fender, sebagian lampu dermaga mati, dan marka jalur evakuasi memudar.',
      recommendation: 'Penjadwalan perbaikan fender, penggantian lampu, dan pengecatan ulang marka.',
      next_inspection: daysAhead(randInt(30, 180)),
    }, { status: 'verified', org: site, createdAt: `${date}T08:00:00.000Z` });
  });
}

/* ------------------------------------------------- keselamatan pelabuhan */

console.log('  Memuat rekaman keselamatan pelabuhan ...');

if (!hasRows('port_safety_patrol')) {
  const ITEMS = ['sterile_area_control', 'unauthorized_person', 'evacuation_route_clear', 'apar_available', 'lighting_adequate', 'fender_bollard', 'mb_gangway', 'housekeeping', 'signage', 'barrier_railing', 'spill_free', 'waste_handling', 'vehicle_discipline', 'ppe_compliance', 'lifebuoy_shore'];
  for (let i = 0; i < 30; i++) {
    const date = daysAgo(randInt(1, 200));
    const findings = randInt(0, 5);
    insert('port_safety_patrol', {
      title: `Patroli keselamatan shift ${pick(['pagi', 'siang', 'malam'], i)}`,
      patrol_date: date,
      shift: pick(['Pagi', 'Siang', 'Malam'], i),
      ...chk(ITEMS, findings > 2 ? i % ITEMS.length : -1),
      items_checked: ITEMS.length,
      items_conform: ITEMS.length - findings,
      findings_count: findings,
      findings: findings ? 'Ditemukan hambatan pada jalur evakuasi dan pencahayaan kurang di satu titik.' : 'Seluruh area dalam kondisi terkendali.',
      immediate_action: findings ? 'Hambatan dipindahkan dan laporan diteruskan ke unit teknik.' : 'Tidak diperlukan tindakan.',
    }, { status: pick(['verified', 'completed'], i), org: pick(SITES, i), createdAt: `${date}T07:00:00.000Z` });
  }
}

if (!hasRows('crowd_management')) {
  for (let back = 5; back >= 0; back--) {
    for (const site of SITES.slice(0, 4)) {
      const peak = back === 3;
      const pax = peak ? randInt(38000, 72000) : randInt(9000, 26000);
      const date = `${monthKey(back)}-${String(randInt(1, 28)).padStart(2, '0')}`;
      insert('crowd_management', {
        record_date: date,
        period_type: peak ? 'Angkutan Lebaran' : pick(['Hari Biasa', 'Akhir Pekan', 'Libur Panjang'], back),
        peak_hour: '19:00',
        passenger_count: pax,
        vehicle_count: Math.round(pax * 0.35),
        terminal_capacity: 12000,
        queue_length_km: peak ? Number((2 + rnd() * 8).toFixed(1)) : Number((rnd() * 2).toFixed(1)),
        waiting_time_minutes: peak ? randInt(90, 360) : randInt(15, 70),
        buffer_zone_used: peak ? randInt(3, 8) : randInt(0, 2),
        congestion_level: peak ? 'Sangat Padat' : pick(['Normal', 'Padat'], back),
        delay_system_active: peak,
        additional_trip: peak,
        additional_vessel: peak ? randInt(2, 6) : 0,
        joint_command_post: peak,
        agencies_involved: peak ? ['Kepolisian', 'Dinas Perhubungan', 'TNI', 'Basarnas', 'Dinas Kesehatan'] : ['Dinas Perhubungan'],
        medical_cases: peak ? randInt(5, 30) : randInt(0, 4),
        incidents: peak ? randInt(1, 5) : randInt(0, 1),
        mitigation: 'Penerapan delay system, pembukaan kantong parkir tambahan, dan penambahan trip.',
      }, { status: 'validated', org: site, createdAt: `${date}T20:00:00.000Z` });
    }
  }
}

if (!hasRows('port_security')) {
  for (let i = 0; i < 12; i++) {
    const drill = i % 3 === 0;
    const date = daysAgo(randInt(5, 300));
    insert('port_security', {
      title: drill ? 'Latihan keamanan fasilitas pelabuhan' : `Kejadian keamanan - ${pick(['akses tidak sah', 'barang mencurigakan', 'pencurian'], i)}`,
      record_type: drill ? 'Latihan Keamanan (Drill)' : 'Kejadian Keamanan',
      event_date: date,
      security_level: 'Level 1 - Normal',
      incident_category: drill ? 'Tidak Ada Kejadian' : pick(['Akses Tidak Sah', 'Barang Mencurigakan', 'Pencurian', 'Pelanggaran Prosedur'], i),
      description: drill ? 'Latihan penanganan ancaman keamanan sesuai Port Facility Security Plan.' : 'Petugas keamanan mendeteksi kejadian dan menindaklanjuti sesuai prosedur.',
      screening_conducted: true,
      persons_screened: randInt(200, 4000),
      vehicles_screened: randInt(80, 1600),
      items_confiscated: drill ? 0 : randInt(0, 3),
      cctv_functional: true,
      access_control_functional: i % 7 !== 0,
      perimeter_intact: i % 9 !== 0,
      police_involved: !drill && i % 4 === 0,
      reported_ksop: !drill,
      action_taken: 'Pengamanan lokasi, pencatatan kejadian, dan koordinasi dengan aparat bila diperlukan.',
      recommendation: 'Penambahan titik CCTV dan penguatan patroli pada jam rawan.',
      potential_likelihood: String(randInt(2, 4)),
      potential_severity: String(randInt(2, 4)),
    }, { status: 'closed', org: pick(SITES, i), createdAt: `${date}T10:00:00.000Z` });
  }
}

if (!hasRows('port_environment_monitoring')) {
  const ITEMS = ['terminal_cleanliness', 'toilet_cleanliness', 'dermaga_cleanliness', 'parking_cleanliness', 'waste_bin_condition', 'waste_segregation', 'tps_condition', 'tps_b3_condition', 'drainage_condition', 'sea_surface', 'oil_sheen', 'ipal_operation', 'green_area', 'noise_level', 'air_quality'];
  for (let i = 0; i < 24; i++) {
    const date = daysAgo(randInt(1, 200));
    const findings = randInt(0, 4);
    insert('port_environment_monitoring', {
      record_date: date,
      shift: pick(['Pagi', 'Siang', 'Malam'], i),
      ...chk(ITEMS, findings > 2 ? i % ITEMS.length : -1),
      waste_collected_kg: randInt(300, 1600),
      findings_count: findings,
      findings: findings ? 'Tempat sampah penuh pada jam puncak dan pemilahan belum optimal.' : 'Kondisi kebersihan terjaga.',
      action_taken: 'Penambahan frekuensi pengangkutan dan sosialisasi pemilahan sampah.',
    }, { status: 'validated', org: pick(SITES, i), createdAt: `${date}T08:00:00.000Z` });
  }
}

/* ------------------------------- kelangsungan usaha, keamanan informasi, SDM */

console.log('  Memuat rekaman kelangsungan usaha & kompetensi ...');

if (!hasRows('business_impact_analysis')) {
  [['Layanan penyeberangan lintasan utama', 'Operasi Kapal', 'Kritis', 4, 2], ['Sistem ticketing daring', 'Ticketing & Reservasi', 'Kritis', 8, 4], ['Operasi movable bridge', 'Operasi Pelabuhan', 'Kritis', 6, 3], ['Layanan keuangan dan penggajian', 'Keuangan', 'Sedang', 48, 24]].forEach(([title, category, criticality, mtpd, rto], i) => {
    insert('business_impact_analysis', {
      title,
      process_category: category,
      process_description: `${title} merupakan proses yang menopang kelangsungan layanan kepada pengguna jasa.`,
      criticality,
      mtpd_hours: mtpd,
      rto_hours: rto,
      rpo_hours: Math.max(1, Math.round(rto / 2)),
      mbco: 60,
      financial_impact_daily: randInt(500, 9000) * 1e6,
      impact_operational: 'Penghentian atau penurunan kapasitas layanan penyeberangan.',
      impact_reputation: 'Keluhan publik dan sorotan media pada periode puncak.',
      impact_legal: 'Potensi teguran regulator atas tidak terpenuhinya standar pelayanan minimum.',
      dependencies: pick([['Listrik PLN', 'Kapal Operasional'], ['Sistem TI / Aplikasi', 'Jaringan Komunikasi'], ['Movable Bridge', 'Personil Kunci'], ['Sistem TI / Aplikasi']], i),
      resource_required: 'Personil inti, sistem cadangan, genset, dan koordinasi lintas instansi.',
      review_date: daysAhead(randInt(30, 300)),
    }, { status: 'monitored', org: i % 2 === 0 ? CORPORATE : pick(SITES, i) });
  });
}

if (!hasRows('business_continuity_plan')) {
  [['Rencana kelangsungan operasi menghadapi gempa dan tsunami', 'Tsunami'], ['Rencana kelangsungan layanan saat gangguan sistem TI', 'Kegagalan Sistem TI'], ['Rencana kelangsungan saat penutupan pelabuhan', 'Penutupan Pelabuhan'], ['Rencana penanganan serangan siber', 'Serangan Siber']].forEach(([title, scenario], i) => {
    insert('business_continuity_plan', {
      title,
      disruption_scenario: scenario,
      scope_covered: i % 2 === 0 ? 'Seluruh cabang dan armada' : 'Kantor pusat dan sistem informasi',
      activation_criteria: 'Gangguan yang menyebabkan penghentian layanan lebih dari batas MTPD yang ditetapkan.',
      crisis_team: 'Direktur Operasi, VP QHSE, GM Regional, Manager TI, Humas',
      response_strategy: 'Aktivasi posko krisis, pengalihan sumber daya, dan komunikasi publik terkoordinasi.',
      recovery_procedure: 'Pemulihan bertahap dimulai dari layanan kritis dengan verifikasi keselamatan sebelum operasi normal.',
      communication_plan: 'Pernyataan resmi melalui kanal korporat dan koordinasi dengan Kementerian Perhubungan.',
      alternate_site: pick(['Kantor Cabang terdekat', 'Pusat Data Cadangan', 'Posko Lapangan'], i),
      backup_resources: 'Genset cadangan, kapal pengganti, jalur komunikasi radio, dan sistem backup harian.',
      target_rto_hours: pick([4, 8, 12, 24], i),
      last_tested: daysAgo(randInt(60, 320)),
      test_result: pick(['Berhasil', 'Berhasil dengan Catatan'], i),
      next_test: daysAhead(randInt(30, 240)),
      review_date: daysAhead(randInt(60, 300)),
    }, { status: 'published', org: i % 2 === 0 ? CORPORATE : pick(SITES, i) });
  });
}

if (!hasRows('information_security')) {
  [['Percobaan phishing terhadap akun pegawai', 'Phishing', 'Sedang'], ['Kegagalan proses backup harian', 'Kegagalan Backup', 'Tinggi'], ['Akses tidak sah ke berkas bersama', 'Akses Tidak Sah', 'Sedang'], ['Kerentanan kritis pada server aplikasi', 'Kerentanan Ditemukan', 'Kritis'], ['Kehilangan laptop dinas', 'Kehilangan Perangkat', 'Sedang']].forEach(([title, type, severity], i) => {
    const date = daysAgo(randInt(10, 300));
    insert('information_security', {
      title,
      event_date: date,
      detected_date: date,
      event_type: type,
      cia_impact: pick([['Kerahasiaan (Confidentiality)'], ['Ketersediaan (Availability)'], ['Integritas (Integrity)', 'Kerahasiaan (Confidentiality)']], i),
      severity,
      affected_system: pick(['Email korporat', 'Sistem backup', 'Berkas bersama', 'Server aplikasi internal', 'Perangkat pengguna'], i),
      personal_data_involved: i === 4,
      records_affected: i === 4 ? randInt(1, 50) : 0,
      downtime_hours: Number((rnd() * 6).toFixed(1)),
      description: `${title}. Kejadian terdeteksi melalui pemantauan dan laporan pengguna.`,
      containment_action: 'Isolasi sistem terdampak, penonaktifan akun, dan pemulihan dari cadangan.',
      root_cause: 'Kelemahan konfigurasi dan kurangnya kesadaran keamanan informasi pengguna.',
      reported_authority: severity === 'Kritis',
      resolved_date: daysAgo(randInt(1, 9)),
      lesson_learned: 'Peningkatan kampanye kesadaran keamanan dan penguatan kontrol akses.',
      potential_likelihood: String(randInt(2, 4)),
      potential_severity: String(randInt(2, 5)),
    }, { status: 'closed', org: CORPORATE, createdAt: `${date}T09:00:00.000Z` });
  });
}

if (!hasRows('training_competency')) {
  const TRAINING = [
    ['Pelatihan Ahli K3 Umum', 'Sertifikasi Kompetensi', 'Ahli K3 Umum', 'Wajib Regulasi'],
    ['Pelatihan P3K di tempat kerja', 'Pelatihan Wajib Regulasi', 'P3K di Tempat Kerja', 'Wajib Regulasi'],
    ['Basic Safety Training penyegaran ABK', 'Sertifikasi Kompetensi', 'Basic Safety Training (BST)', 'Wajib Regulasi'],
    ['Pelatihan auditor internal ISO terintegrasi', 'Pelatihan Sistem Manajemen', 'Auditor Internal ISO', 'Wajib Internal'],
    ['Pelatihan HIRADC bagi supervisor', 'Pelatihan Sistem Manajemen', 'HIRADC', 'Wajib Internal'],
    ['Pelatihan penanggulangan tumpahan minyak', 'Pelatihan Darurat', 'Penanggulangan Tumpahan Minyak', 'Wajib Internal'],
    ['Induksi K3 pekerja kontraktor', 'Induksi K3', 'ISPS Code', 'Wajib Internal'],
    ['Pelatihan investigasi insiden', 'Pelatihan Teknis', 'Investigasi Insiden', 'Pengembangan'],
    ['Pelatihan keamanan informasi bagi pengguna', 'Pelatihan Teknis', 'Keamanan Informasi', 'Wajib Internal'],
    ['Pelatihan pelayanan prima petugas loket', 'Pelatihan Teknis', 'Pelayanan Prima', 'Pengembangan'],
  ];
  TRAINING.forEach(([title, category, topic, mandatory], i) => {
    const start = daysAgo(randInt(20, 330));
    const planned = randInt(15, 60);
    insert('training_competency', {
      title,
      training_category: category,
      topic,
      start_date: start,
      end_date: start,
      duration_hours: randInt(4, 40),
      provider: pick(['PJK3 Terakreditasi', 'Balai Diklat Transportasi', 'Internal Trainer', 'Lembaga Sertifikasi Profesi'], i),
      trainer: 'Instruktur bersertifikat',
      mandatory,
      planned_participants: planned,
      actual_participants: planned - randInt(0, 6),
      pretest_avg: Number((55 + rnd() * 20).toFixed(1)),
      posttest_avg: Number((78 + rnd() * 18).toFixed(1)),
      pass_count: planned - randInt(0, 5),
      certificate_issued: category.includes('Sertifikasi') || mandatory === 'Wajib Regulasi',
      certificate_valid_until: daysAhead(randInt(-20, 900)),
      cost: randInt(15, 220) * 1e6,
      effectiveness: pick(['Efektif', 'Sangat Efektif', 'Cukup'], i),
      evaluation_note: 'Peningkatan nilai post-test menunjukkan pemahaman materi yang memadai.',
    }, { status: 'closed', org: i % 3 === 0 ? CORPORATE : pick(SITES, i), createdAt: `${start}T08:00:00.000Z` });
  });
}

/* ------------------------------------------------------------------ dokumen */

console.log('  Memuat dokumen & regulasi ...');

if (!hasRows('document_control')) {
  const DOCS = [
    ['Manual Sistem Manajemen Terintegrasi', 'Level 1 - Manual', ['Terintegrasi']],
    ['Prosedur Pengendalian Dokumen dan Rekaman', 'Level 2 - Prosedur', ['ISO 9001']],
    ['Prosedur Identifikasi Bahaya dan Penilaian Risiko', 'Level 2 - Prosedur', ['ISO 45001', 'SMK3']],
    ['Prosedur Investigasi Insiden', 'Level 2 - Prosedur', ['ISO 45001']],
    ['Prosedur Pengelolaan Limbah B3', 'Level 2 - Prosedur', ['ISO 14001']],
    ['Prosedur Tanggap Darurat Pelabuhan', 'Level 2 - Prosedur', ['ISO 45001', 'ISO 22301']],
    ['Prosedur Izin Kerja', 'Level 2 - Prosedur', ['ISO 45001']],
    ['Prosedur Audit Internal', 'Level 2 - Prosedur', ['ISO 9001', 'ISO 14001', 'ISO 45001']],
    ['Prosedur Pengelolaan Kontraktor', 'Level 2 - Prosedur', ['ISO 45001']],
    ['Prosedur Keamanan Informasi', 'Level 2 - Prosedur', ['ISO 27001']],
  ];
  DOCS.forEach(([title, level, systems], i) => {
    insert('document_control', {
      title,
      doc_number: `ASDP/${level.startsWith('Level 1') ? 'MSM' : 'PRO'}/${String(i + 1).padStart(3, '0')}`,
      doc_level: level,
      management_system: systems,
      revision: String(randInt(0, 4)).padStart(2, '0'),
      effective_date: daysAgo(randInt(60, 700)),
      review_due: daysAhead(randInt(-30, 400)),
      owner_unit: 'Divisi QHSE Korporat',
      confidentiality: 'Internal',
      summary: `${title} mengatur tata cara pelaksanaan proses terkait beserta tanggung jawabnya.`,
      retention_period: '5 tahun',
    }, { status: 'published', org: CORPORATE });
  });
}

if (!hasRows('sop')) {
  [['SOP Sandar dan Lepas Sandar Kapal', 'Operasi Pelabuhan'], ['SOP Bongkar Muat Kendaraan', 'Bongkar Muat'], ['SOP Pemeriksaan Pra-Berlayar', 'Operasi Kapal'], ['SOP Penanganan Barang Berbahaya', 'Operasi Kapal'], ['SOP Pelayanan Penumpang Disabilitas', 'Ticketing & Pelayanan Penumpang'], ['SOP Pengoperasian Movable Bridge', 'Operasi Pelabuhan'], ['SOP Penanganan Keluhan Pelanggan', 'Mutu'], ['SOP Bunkering Bahan Bakar', 'Operasi Kapal']].forEach(([title, area], i) => {
    insert('sop', {
      title,
      doc_number: `ASDP/SOP/${String(i + 1).padStart(3, '0')}`,
      process_area: area,
      management_system: ['Terintegrasi'],
      revision: String(randInt(0, 3)).padStart(2, '0'),
      effective_date: daysAgo(randInt(60, 600)),
      review_due: daysAhead(randInt(-20, 400)),
      purpose: `Memastikan ${title.replace('SOP ', '').toLowerCase()} dilaksanakan secara aman, konsisten dan sesuai peraturan.`,
      scope_text: 'Berlaku untuk seluruh cabang dan armada yang melaksanakan kegiatan terkait.',
      procedure_steps: 'Persiapan, pelaksanaan, pengawasan, pencatatan dan evaluasi.',
      references: 'UU No. 17 Tahun 2008, PP No. 61 Tahun 2009, PP No. 50 Tahun 2012, ISM Code.',
      related_forms: 'Formulir checklist dan laporan harian terkait.',
      owner_unit: pick(['Divisi Operasi', 'Divisi Teknik', 'Divisi Pelayanan'], i),
    }, { status: 'published', org: CORPORATE });
  });
}

if (!hasRows('external_regulation')) {
  const REGS = [
    ['Undang-Undang tentang Pelayaran', 'UU No. 17 Tahun 2008', 'Kementerian Perhubungan', 'Pelayaran'],
    ['Peraturan Pemerintah tentang Kepelabuhanan', 'PP No. 61 Tahun 2009', 'Kementerian Perhubungan', 'Kepelabuhanan'],
    ['Peraturan Pemerintah tentang Angkutan di Perairan', 'PP No. 20 Tahun 2010', 'Kementerian Perhubungan', 'Pelayaran'],
    ['Undang-Undang tentang Keselamatan Kerja', 'UU No. 1 Tahun 1970', 'Kementerian Ketenagakerjaan', 'K3'],
    ['Penerapan Sistem Manajemen K3', 'PP No. 50 Tahun 2012', 'Kementerian Ketenagakerjaan', 'K3'],
    ['Alat Pelindung Diri', 'Permenakertrans No. 08 Tahun 2010', 'Kementerian Ketenagakerjaan', 'K3'],
    ['Panitia Pembina K3', 'Permenaker No. 04/MEN/1987', 'Kementerian Ketenagakerjaan', 'K3'],
    ['Pesawat Angkat dan Pesawat Angkut', 'Permenaker No. 08 Tahun 2020', 'Kementerian Ketenagakerjaan', 'K3'],
    ['Keselamatan dan Kesehatan Kerja Listrik', 'Permenaker No. 12 Tahun 2015', 'Kementerian Ketenagakerjaan', 'K3'],
    ['Bejana Tekanan dan Tangki Timbun', 'Permenaker No. 37 Tahun 2016', 'Kementerian Ketenagakerjaan', 'K3'],
    ['Penyelenggaraan Perlindungan dan Pengelolaan Lingkungan Hidup', 'PP No. 22 Tahun 2021', 'Kementerian LHK', 'Lingkungan'],
    ['Pengelolaan Limbah Bahan Berbahaya dan Beracun', 'PermenLHK No. 6 Tahun 2021', 'Kementerian LHK', 'Lingkungan'],
    ['Penerapan Keuangan Berkelanjutan', 'POJK No. 51/POJK.03/2017', 'OJK', 'ESG'],
    ['Manajemen Keamanan Kapal dan Fasilitas Pelabuhan', 'PM Perhubungan No. 134 Tahun 2016', 'Kementerian Perhubungan', 'Kepelabuhanan'],
    ['Pengangkutan Barang Berbahaya di Perairan', 'PM Perhubungan No. 32 Tahun 2016', 'Kementerian Perhubungan', 'Pelayaran'],
    ['Nilai Ekonomi Karbon', 'Perpres No. 98 Tahun 2021', 'Kementerian LHK', 'ESG'],
    ['Pelindungan Data Pribadi', 'UU No. 27 Tahun 2022', 'Lainnya', 'Keamanan Informasi'],
    ['Konservasi Energi', 'PP No. 33 Tahun 2023', 'Lainnya', 'Energi'],
  ];
  REGS.forEach(([title, number, issuer, domain]) => {
    insert('external_regulation', {
      title,
      reg_number: number,
      issuer,
      domain,
      issued_date: daysAgo(randInt(400, 6000)),
      effective_date: daysAgo(randInt(300, 5800)),
      status_regulation: 'Berlaku',
      summary: `${title} menjadi acuan pemenuhan persyaratan pada bidang ${domain.toLowerCase()}.`,
    }, { status: 'active', org: CORPORATE });
  });
}

/* ------------------------------------------------------------------ ringkas */

const totals = all(
  `SELECT (SELECT COUNT(*) FROM users) AS users,
          (SELECT COUNT(*) FROM audit_log) AS audits`,
)[0];

console.log(`\n  Selesai. ${created} rekaman dibuat, ${totals.users} pengguna aktif.`);
console.log('  Masuk dengan salah satu akun berikut (kata sandi sama untuk semua):\n');
for (const u of USERS) {
  console.log(`    ${u.username.padEnd(18)} ${u.role_key.padEnd(16)} ${u.full_name}`);
}
console.log(`\n    Kata sandi: ${DEMO_PASSWORD}\n`);
console.log('  Jalankan "npm start" lalu buka http://localhost:3000\n');
db.close();
