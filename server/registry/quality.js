/**
 * GROUP C - Quality Management (ISO 9001:2015)
 */
import { m, f, req, sel, num, dt, txt, WF, PRIORITY } from './defs.js';

export const group = { code: 'C', key: 'quality', name: 'Quality Management', icon: '🎯' };

const ROOT_CAUSE_METHOD = ['5 Why', 'Fishbone (Ishikawa)', 'Fault Tree Analysis', 'FMEA', 'Pareto', 'Brainstorming Terstruktur'];

/**
 * Empat perspektif Balanced Scorecard (Kaplan & Norton). Berawalan angka agar
 * urutan sebab-akibatnya terbaca sendiri dan dapat diurutkan tanpa tabel
 * pemetaan terpisah: pembelajaran menopang proses, proses melayani pelanggan,
 * pelanggan menghasilkan kinerja keuangan.
 */
const BSC_PERSPECTIVES = [
  { value: '1 - Pembelajaran & Pertumbuhan', label: '1 - Pembelajaran & Pertumbuhan (Learning & Growth)' },
  { value: '2 - Proses Bisnis Internal', label: '2 - Proses Bisnis Internal (Internal Business Process)' },
  { value: '3 - Pelanggan', label: '3 - Pelanggan (Customer)' },
  { value: '4 - Keuangan', label: '4 - Keuangan (Financial)' },
];

export default [
  m({
    key: 'quality_objective',
    name: 'Quality Objective & KPI',
    nameId: 'Sasaran Mutu & KPI',
    icon: '📈',
    codePrefix: 'KPI',
    scope: 'any',
    workflow: WF.MONITORING,
    standards: ['ISO 9001:2015 §6.2', 'ISO 45001:2018 §6.2', 'ISO 14001:2015 §6.2'],
    fields: [
      req('title', 'Nama Indikator'),
      sel('perspective', 'Perspektif QHSE', ['Mutu', 'K3', 'Lingkungan', 'Energi', 'Aset', 'Keamanan Informasi', 'Keselamatan Pelayaran', 'Pelayanan Pelanggan']),
      sel('bsc_perspective', 'Perspektif Balanced Scorecard', BSC_PERSPECTIVES, {
        group: 'Balanced Scorecard',
        help: 'Menentukan lapisan indikator ini pada peta strategi.',
      }),
      f('strategic_objective', 'Sasaran Strategis', 'text', {
        group: 'Balanced Scorecard',
        placeholder: 'Meningkatkan keandalan jadwal penyeberangan',
      }),
      num('weight', 'Bobot dalam Perspektif (%)', {
        group: 'Balanced Scorecard', min: 0, max: 100,
        help: 'Kosongkan bila seluruh indikator dalam perspektif ini berbobot sama.',
      }),
      num('weighted_score', 'Skor Terbobot', { computed: 'weightedScore', readonly: true, group: 'Balanced Scorecard' }),
      f('strategic_initiative', 'Inisiatif Strategis', 'textarea', { group: 'Balanced Scorecard' }),
      req('period', 'Periode', 'text', { placeholder: '2026-01 atau 2026' }),
      sel('frequency', 'Frekuensi Pengukuran', ['Harian', 'Mingguan', 'Bulanan', 'Triwulanan', 'Semesteran', 'Tahunan']),
      f('formula', 'Formula Perhitungan'),
      f('unit', 'Satuan'),
      num('target', 'Target', { required: true, step: 0.01 }),
      num('actual', 'Realisasi', { step: 0.01 }),
      sel('polarity', 'Arah Pencapaian', ['Semakin Tinggi Semakin Baik', 'Semakin Rendah Semakin Baik']),
      num('achievement', 'Pencapaian (%)', { computed: 'kpiAchievement', readonly: true }),
      f('achievement_status', 'Status Pencapaian', 'text', { computed: 'kpiStatus', readonly: true }),
      f('owner_unit', 'Unit Penanggung Jawab'),
      txt('analysis', 'Analisis Pencapaian'),
      txt('improvement_plan', 'Rencana Perbaikan'),
    ],
  }),

  m({
    key: 'customer_complaint',
    name: 'Customer Complaint',
    nameId: 'Keluhan Pelanggan',
    icon: '💬',
    codePrefix: 'CMP',
    scope: 'any',
    workflow: WF.REPORT,
    capa: true,
    standards: ['ISO 9001:2015 §9.1.2', 'ISO 10002'],
    regulations: ['UU No. 17 Tahun 2008 - Standar Pelayanan Minimal Angkutan Penyeberangan'],
    fields: [
      req('title', 'Ringkasan Keluhan'),
      dt('complaint_date', 'Tanggal Keluhan', { required: true }),
      sel('channel', 'Kanal Keluhan', ['Loket', 'Call Center 191', 'Email', 'Media Sosial', 'Kotak Saran', 'Aplikasi Ferizy', 'Surat Resmi', 'Media Massa', 'Lapor.go.id']),
      f('customer_name', 'Nama Pelanggan'),
      f('customer_contact', 'Kontak Pelanggan'),
      sel('category', 'Kategori', [
        'Keterlambatan Jadwal', 'Ketersediaan Tiket', 'Kebersihan Kapal', 'Kebersihan Pelabuhan',
        'Fasilitas Penumpang', 'Keselamatan', 'Sikap Petugas', 'Sistem Ticketing Online',
        'Antrian Kendaraan', 'Tarif', 'Aksesibilitas Disabilitas', 'Kehilangan Barang', 'Lainnya',
      ], { required: true }),
      sel('severity', 'Tingkat Dampak', PRIORITY),
      txt('description', 'Uraian Keluhan', { required: true }),
      txt('immediate_response', 'Respons Awal'),
      dt('response_date', 'Tanggal Respons'),
      num('response_hours', 'Waktu Respons (jam)'),
      txt('resolution', 'Penyelesaian'),
      dt('resolved_date', 'Tanggal Selesai'),
      sel('customer_satisfaction', 'Kepuasan Atas Penyelesaian', ['Sangat Puas', 'Puas', 'Cukup', 'Tidak Puas', 'Belum Dikonfirmasi']),
      f('recurring', 'Keluhan Berulang', 'bool'),
    ],
  }),

  m({
    key: 'non_conformity',
    name: 'Non Conformity',
    nameId: 'Ketidaksesuaian',
    icon: '⚠',
    codePrefix: 'NCR',
    scope: 'any',
    workflow: WF.REPORT,
    capa: true,
    standards: ['ISO 9001:2015 §10.2', 'ISO 45001:2018 §10.2', 'ISO 14001:2015 §10.2'],
    fields: [
      req('title', 'Judul Ketidaksesuaian'),
      dt('found_date', 'Tanggal Ditemukan', { required: true }),
      sel('source', 'Sumber Temuan', ['Audit Internal', 'Audit Eksternal', 'Inspeksi', 'Keluhan Pelanggan', 'Insiden', 'Pemantauan Proses', 'Sertifikasi', 'Pemeriksaan Regulator', 'Manajemen Review']),
      sel('system_ref', 'Sistem Manajemen', ['ISO 9001', 'ISO 14001', 'ISO 45001', 'ISO 27001', 'ISO 50001', 'ISO 55001', 'ISO 22301', 'SMK3', 'ISM Code', 'ISPS Code']),
      f('clause_ref', 'Klausul / Pasal'),
      sel('category', 'Kategori', ['Mayor', 'Minor', 'Observasi', 'Peluang Perbaikan'], { required: true }),
      txt('description', 'Uraian Ketidaksesuaian', { required: true }),
      txt('evidence', 'Bukti Objektif'),
      txt('immediate_action', 'Koreksi Segera'),
      sel('root_cause_method', 'Metode Analisis Akar Masalah', ROOT_CAUSE_METHOD),
      txt('root_cause', 'Akar Masalah'),
      f('pic', 'Penanggung Jawab', 'user'),
      dt('due_date', 'Batas Waktu Penyelesaian', { alert: 'due' }),
      dt('closed_date', 'Tanggal Ditutup'),
      f('effectiveness_verified', 'Efektivitas Terverifikasi', 'bool'),
    ],
  }),

  m({
    key: 'capa',
    name: 'Corrective Action (CAPA)',
    nameId: 'Tindakan Korektif',
    icon: '🔧',
    codePrefix: 'CAR',
    scope: 'any',
    workflow: WF.CAPA,
    standards: ['ISO 9001:2015 §10.2', 'ISO 45001:2018 §10.2'],
    fields: [
      req('title', 'Judul Tindakan'),
      f('source_ref', 'Rekaman Sumber', 'text', { readonly: true, help: 'Terisi otomatis bila dibuat dari rekaman lain.' }),
      sel('source_type', 'Sumber Tindakan', ['Ketidaksesuaian', 'Insiden', 'Near Miss', 'Temuan Audit', 'Keluhan Pelanggan', 'Inspeksi', 'Evaluasi Kepatuhan', 'Manajemen Review', 'Analisis Risiko']),
      txt('problem_statement', 'Pernyataan Masalah', { required: true }),
      sel('root_cause_method', 'Metode Analisis', ROOT_CAUSE_METHOD),
      txt('root_cause', 'Akar Masalah'),
      txt('action_plan', 'Rencana Tindakan', { required: true }),
      sel('action_hierarchy', 'Hirarki Pengendalian', ['Eliminasi', 'Substitusi', 'Rekayasa Teknik', 'Administratif', 'APD'], { help: 'ISO 45001:2018 §8.1.2' }),
      f('pic', 'Penanggung Jawab', 'user', { required: true }),
      dt('due_date', 'Target Selesai', { required: true, alert: 'due' }),
      dt('completed_date', 'Tanggal Selesai'),
      num('progress', 'Progres (%)', { min: 0, max: 100 }),
      txt('verification_result', 'Hasil Verifikasi Efektivitas'),
      f('verified_by', 'Diverifikasi Oleh', 'user'),
      dt('verified_date', 'Tanggal Verifikasi'),
      num('cost', 'Biaya Realisasi (IDR)', { type: 'currency' }),
    ],
  }),

  m({
    key: 'preventive_action',
    name: 'Preventive Action',
    nameId: 'Tindakan Pencegahan',
    icon: '🛡',
    codePrefix: 'PAR',
    scope: 'any',
    workflow: WF.CAPA,
    standards: ['ISO 9001:2015 §6.1', 'ISO 31000:2018'],
    fields: [
      req('title', 'Judul Tindakan Pencegahan'),
      txt('potential_issue', 'Potensi Masalah', { required: true }),
      sel('trigger', 'Pemicu', ['Analisis Tren', 'Penilaian Risiko', 'Pembelajaran Insiden Eksternal', 'Perubahan Regulasi', 'Benchmarking', 'Masukan Pekerja']),
      txt('preventive_plan', 'Rencana Pencegahan', { required: true }),
      f('pic', 'Penanggung Jawab', 'user', { required: true }),
      dt('due_date', 'Target Selesai', { alert: 'due' }),
      num('progress', 'Progres (%)', { min: 0, max: 100 }),
      txt('effectiveness', 'Evaluasi Efektivitas'),
    ],
  }),

  m({
    key: 'continuous_improvement',
    name: 'Continuous Improvement',
    nameId: 'Perbaikan Berkelanjutan',
    icon: '🚀',
    codePrefix: 'CI',
    scope: 'any',
    workflow: WF.CAPA,
    standards: ['ISO 9001:2015 §10.3'],
    fields: [
      req('title', 'Judul Inisiatif'),
      sel('method', 'Metode', ['PDCA', 'Kaizen', 'Lean', 'Six Sigma (DMAIC)', 'Gugus Kendali Mutu', 'Inovasi Digital', 'Sistem Saran']),
      sel('area', 'Area Perbaikan', ['Mutu Layanan', 'Keselamatan', 'Lingkungan', 'Efisiensi Energi', 'Produktivitas', 'Biaya', 'Waktu Sandar', 'Kepuasan Pelanggan', 'Digitalisasi']),
      txt('current_condition', 'Kondisi Saat Ini'),
      txt('proposed_improvement', 'Usulan Perbaikan', { required: true }),
      txt('expected_benefit', 'Manfaat yang Diharapkan'),
      num('estimated_saving', 'Estimasi Penghematan (IDR/tahun)', { type: 'currency' }),
      num('realized_saving', 'Penghematan Terealisasi (IDR)', { type: 'currency' }),
      f('proposer', 'Pengusul', 'user'),
      f('pic', 'Penanggung Jawab', 'user'),
      dt('due_date', 'Target Implementasi', { alert: 'due' }),
      num('progress', 'Progres (%)', { min: 0, max: 100 }),
      f('replicated', 'Direplikasi ke Unit Lain', 'bool'),
    ],
  }),
];
