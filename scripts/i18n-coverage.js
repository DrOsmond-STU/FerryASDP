/**
 * Laporan cakupan terjemahan.
 *
 *   node scripts/i18n-coverage.js            ringkasan
 *   node scripts/i18n-coverage.js --missing  daftar istilah yang belum diterjemahkan
 *
 * Dijalankan terhadap registry, bukan terhadap tangkapan layar: apa pun yang
 * ditambahkan ke registry esok hari otomatis ikut terhitung di sini.
 */
import { MODULES, GROUPS } from '../server/registry/index.js';
import { EN } from '../server/i18n/en.js';
import { ROLES } from '../server/rbac.js';
import { RISK_BANDS } from '../server/compute.js';

const showMissing = process.argv.includes('--missing');

/** Istilah yang sudah berbahasa Inggris atau netral tidak perlu diterjemahkan. */
const NEUTRAL = /^[\s\d.,:/()\-+%°²³×–—]*$/;

/*
 * Sebagian besar isi registry sudah berbahasa Inggris atau netral: kode standar
 * (ISO 9001:2015), akronim maritim (BST, SCRB, LTI), nama lembaga, dan istilah
 * serapan. Menghitungnya sebagai "belum diterjemahkan" akan membuat laporan ini
 * berbohong ke arah yang salah — seolah pekerjaannya jauh lebih besar daripada
 * yang sebenarnya.
 *
 * Penandanya dibuat konservatif: sebuah istilah dianggap butuh terjemahan bila
 * memuat SATU SAJA kata Indonesia. Salah menganggap butuh lebih aman daripada
 * salah menganggap selesai.
 */
const ID_WORDS = /(?:^|[^a-z])(?:nama|tanggal|jumlah|nilai|tingkat|kategori|jenis|catatan|nomor|lokasi|hasil|waktu|biaya|kode|petugas|pegawai|jabatan|penanggung|jawab|berlaku|sampai|mulai|selesai|kerja|kerjanya|keselamatan|kesehatan|lingkungan|risiko|bahaya|kejadian|temuan|tindakan|perbaikan|pelatihan|kapal|pelabuhan|cabang|wilayah|dokumen|laporan|sasaran|pengelolaan|penilaian|pemeriksaan|kegiatan|keterangan|uraian|rencana|realisasi|jam|hari|bulan|tahun|dan|atau|yang|dari|untuk|bila|pada|oleh|dengan|sudah|belum|tidak|ada|lain|lainnya|dalam|akan|dapat|harus|wajib|rata|ulang|awal|akhir|terakhir|baru|lama|besar|kecil|tinggi|rendah|sedang|baik|buruk|aman|darurat|kerusakan|kecelakaan|penumpang|kendaraan|muatan|awak|nakhoda|dermaga|limbah|air|udara|energi|listrik|bahan|alat|mesin|ruang|unit|divisi|departemen|seksi|kantor|pusat|kelas|golongan|surat|izin|sertifikat|masa|periode|frekuensi|durasi|metode|cara|sumber|dasar|acuan|peraturan|klausul|pasal|butir|urutan|prioritas|bobot|persen|persentase|luas|panjang|lebar|berat|suhu|tekanan|kecepatan|arah|posisi|foto|berkas|lampiran|tautan|isi|judul|ringkasan|kesimpulan|rekomendasi|saran|usulan|permintaan|persetujuan|verifikasi|pengesahan|penutupan|pembukaan|pendaftaran|kehadiran|peserta|instruktur|penyelenggara|lembaga|kontraktor|pemasok|pelanggan|pengguna|jasa|layanan|mutu|kepuasan|keluhan|diisi|dipilih|dibuat|diterima|ditolak|disetujui|ditutup|dibatalkan|berjalan|menunggu|milik|sendiri|seluruh|setiap|antar|per|ke|di|se)(?:$|[^a-z])/i;

const needsTranslation = (text) => ID_WORDS.test(text);

const buckets = {
  'Label isian': new Map(),
  'Opsi pilihan': new Map(),
  'Status alur kerja': new Map(),
  'Kelompok modul': new Map(),
  'Bantuan & placeholder': new Map(),
  'Peran & tingkat risiko': new Map(),
};

/*
 * Istilah yang TIDAK dikenali penanda namun juga tidak ada di kamus. Penanda
 * konservatif punya sisi buruk yang tidak terlihat: istilah Indonesia yang
 * kebetulan tidak memuat satu pun kata dalam daftar — "Investigasi",
 * "Tervalidasi", "Tindak Lanjut" — jatuh ke luar hitungan sama sekali, dan
 * laporannya menulis 100% padahal istilah itu tetap tampil bahasa Indonesia.
 * Dikumpulkan terpisah supaya tidak ada yang bersembunyi di balik angka.
 */
const unflagged = new Map();

const add = (bucket, text) => {
  if (typeof text !== 'string' || !text.trim() || NEUTRAL.test(text)) return;
  if (!needsTranslation(text)) {
    if (EN[text] === undefined) unflagged.set(text, (unflagged.get(text) || 0) + 1);
    return;
  }
  buckets[bucket].set(text, (buckets[bucket].get(text) || 0) + 1);
};

for (const g of GROUPS) add('Kelompok modul', g.name);
for (const r of ROLES) { add('Peran & tingkat risiko', r.name); add('Peran & tingkat risiko', r.description); }
for (const b of RISK_BANDS) add('Peran & tingkat risiko', b.level);

for (const m of MODULES) {
  for (const s of m.workflow) add('Status alur kerja', s.label);
  for (const f of m.fields) {
    add('Label isian', f.label);
    if (f.help) add('Bantuan & placeholder', f.help);
    if (f.placeholder) add('Bantuan & placeholder', f.placeholder);
    if (f.group) add('Label isian', f.group);
    for (const o of f.options || []) add('Opsi pilihan', typeof o === 'string' ? o : (o.label ?? o.value));
  }
}

let totalUnique = 0;
let totalDone = 0;
let totalUses = 0;
let usesDone = 0;

console.log('\n  Cakupan terjemahan Indonesia → Inggris\n');
console.log(`  ${'Bagian'.padEnd(26)} ${'unik'.padStart(6)} ${'selesai'.padStart(8)} ${'cakupan'.padStart(9)}  ${'kemunculan'.padStart(11)}`);
console.log(`  ${'-'.repeat(26)} ${'-'.repeat(6)} ${'-'.repeat(8)} ${'-'.repeat(9)}  ${'-'.repeat(11)}`);

const missing = [];
for (const [name, map] of Object.entries(buckets)) {
  const entries = [...map.entries()];
  const done = entries.filter(([text]) => EN[text] !== undefined);
  const uses = entries.reduce((a, [, n]) => a + n, 0);
  const doneUses = done.reduce((a, [text]) => a + map.get(text), 0);
  totalUnique += entries.length;
  totalDone += done.length;
  totalUses += uses;
  usesDone += doneUses;
  const pct = entries.length ? ((done.length / entries.length) * 100).toFixed(1) : '100.0';
  const usePct = uses ? ((doneUses / uses) * 100).toFixed(1) : '100.0';
  console.log(`  ${name.padEnd(26)} ${String(entries.length).padStart(6)} ${String(done.length).padStart(8)} ${`${pct}%`.padStart(9)}  ${`${usePct}%`.padStart(11)}`);
  for (const [text, n] of entries) if (EN[text] === undefined) missing.push({ bucket: name, text, n });
}

console.log(`  ${'-'.repeat(26)} ${'-'.repeat(6)} ${'-'.repeat(8)} ${'-'.repeat(9)}  ${'-'.repeat(11)}`);
const pct = ((totalDone / totalUnique) * 100).toFixed(1);
const usePct = ((usesDone / totalUses) * 100).toFixed(1);
console.log(`  ${'TOTAL'.padEnd(26)} ${String(totalUnique).padStart(6)} ${String(totalDone).padStart(8)} ${`${pct}%`.padStart(9)}  ${`${usePct}%`.padStart(11)}`);
console.log(`\n  Kamus memuat ${Object.keys(EN).length} entri.`);
console.log('  Istilah tanpa terjemahan tetap tampil dalam bahasa Indonesia.');
if (unflagged.size) {
  console.log(`\n  Selain itu ${unflagged.size} istilah di luar deteksi juga belum ada di kamus.`);
  console.log('  Periksa sendiri: sebagian memang sudah berbahasa Inggris, sebagian tidak.');
}
console.log();

if (showMissing) {
  missing.sort((a, b) => b.n - a.n || a.text.localeCompare(b.text));
  console.log(`  ${missing.length} istilah belum diterjemahkan:\n`);
  for (const m of missing) console.log(`  ${String(m.n).padStart(3)}×  [${m.bucket}]  ${m.text}`);
  if (unflagged.size) {
    console.log(`\n  ${unflagged.size} istilah di luar deteksi, belum di kamus:\n`);
    for (const [text, n] of [...unflagged].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      console.log(`  ${String(n).padStart(3)}×  ${text}`);
    }
  }
  console.log();
}

process.exit(0);
