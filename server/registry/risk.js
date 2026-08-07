/**
 * GROUP H - Risk Management (ISO 31000:2018)
 */
import { m, f, req, sel, num, dt, txt, WF, riskFields, residualFields } from './defs.js';

export const group = { code: 'H', key: 'risk', name: 'Risk Management', nameId: 'Manajemen Risiko', icon: '⚠' };

const TREATMENT = ['Menghindari Risiko (Avoid)', 'Mengurangi Kemungkinan', 'Mengurangi Dampak', 'Membagi / Mengalihkan (Transfer)', 'Menerima Risiko (Accept)', 'Mengambil Risiko untuk Peluang'];

const riskBase = (extra = []) => [
  req('title', 'Nama Risiko'),
  txt('risk_description', 'Uraian Risiko', { required: true }),
  txt('cause', 'Penyebab Risiko'),
  txt('consequence', 'Konsekuensi / Dampak'),
  ...extra,
  ...riskFields(),
  txt('existing_control', 'Pengendalian Saat Ini'),
  sel('control_effectiveness', 'Efektivitas Pengendalian', ['Sangat Efektif', 'Efektif', 'Cukup', 'Lemah', 'Tidak Ada']),
  sel('treatment_option', 'Opsi Perlakuan Risiko', TREATMENT),
  txt('treatment_plan', 'Rencana Perlakuan'),
  ...residualFields(),
  f('risk_owner', 'Pemilik Risiko', 'user', { required: true }),
  dt('review_date', 'Tanggal Tinjauan', { alert: 'expiry' }),
  sel('risk_appetite', 'Kesesuaian dengan Selera Risiko', ['Dalam Selera Risiko', 'Di Ambang Batas', 'Melebihi Selera Risiko']),
];

export default [
  m({
    key: 'risk_register',
    name: 'Risk Register',
    nameId: 'Register Risiko Terpadu',
    icon: '📕',
    codePrefix: 'RSK',
    scope: 'any',
    workflow: WF.RISK,
    capa: true,
    standards: ['ISO 31000:2018 §6.5'],
    fields: riskBase([
      sel('risk_category', 'Kategori Risiko', [
        'Strategis', 'Operasional', 'Keuangan', 'Kepatuhan & Hukum', 'Keselamatan (K3)',
        'Keselamatan Pelayaran', 'Lingkungan', 'Keamanan Informasi', 'Reputasi',
        'Sumber Daya Manusia', 'Aset & Infrastruktur', 'Rantai Pasok', 'Bencana Alam',
      ], { required: true }),
      sel('risk_source', 'Sumber Identifikasi', ['Workshop Risiko', 'Audit', 'Insiden', 'HIRA', 'Analisis Data', 'Perubahan Regulasi', 'Masukan Pemangku Kepentingan']),
      f('objective_affected', 'Sasaran yang Terdampak'),
    ]),
  }),

  m({
    key: 'corporate_risk',
    name: 'Corporate Risk',
    nameId: 'Risiko Korporat',
    icon: '🏢',
    codePrefix: 'CRSK',
    scope: 'corporate',
    workflow: WF.RISK,
    capa: true,
    standards: ['ISO 31000:2018'],
    regulations: ['Permen BUMN No. PER-2/MBU/03/2023 tentang Tata Kelola BUMN'],
    fields: riskBase([
      sel('risk_category', 'Kategori Risiko Korporat', ['Strategis', 'Keuangan', 'Kepatuhan', 'Reputasi', 'Tata Kelola', 'Transformasi Digital', 'Keberlanjutan/ESG', 'Geopolitik & Regulasi'], { required: true }),
      f('strategic_objective', 'Sasaran Strategis Terkait'),
      num('financial_impact', 'Estimasi Dampak Finansial (IDR)', { type: 'currency' }),
      f('escalated_to_board', 'Dieskalasi ke Direksi/Komisaris', 'bool'),
    ]),
  }),

  m({
    key: 'operational_risk',
    name: 'Operational Risk',
    nameId: 'Risiko Operasional',
    icon: '⚙',
    codePrefix: 'ORSK',
    scope: 'any',
    workflow: WF.RISK,
    capa: true,
    standards: ['ISO 31000:2018'],
    fields: riskBase([
      sel('process_area', 'Area Proses', ['Operasi Kapal', 'Operasi Pelabuhan', 'Bongkar Muat', 'Ticketing', 'Pemeliharaan', 'Bunkering', 'Logistik', 'Pelayanan Penumpang', 'Teknologi Informasi']),
      f('kpi_affected', 'KPI Terdampak'),
      num('downtime_hours', 'Estimasi Downtime (jam)', { step: 0.1 }),
    ]),
  }),

  m({
    key: 'port_risk',
    name: 'Port Risk',
    nameId: 'Risiko Pelabuhan',
    icon: '⚓',
    codePrefix: 'PRSK',
    scope: 'port',
    workflow: WF.RISK,
    capa: true,
    standards: ['ISO 31000:2018'],
    regulations: ['PP No. 61 Tahun 2009 tentang Kepelabuhanan', 'ISPS Code Part A - Port Facility Security Assessment'],
    fields: riskBase([
      sel('risk_area', 'Area Risiko Pelabuhan', [
        'Dermaga & Fender', 'Movable Bridge', 'Gangway', 'Area Antrian Kendaraan',
        'Terminal Penumpang', 'Alur Pelayaran & Kolam Pelabuhan', 'Sisi Darat (Landside)',
        'Keamanan Fasilitas (ISPS)', 'Utilitas & Listrik', 'Pengelolaan Limbah', 'Kepadatan Puncak (Peak Season)',
      ], { required: true }),
      f('affects_public', 'Berdampak pada Publik/Penumpang', 'bool'),
      num('daily_exposure', 'Rata-rata Orang Terpapar per Hari'),
    ]),
  }),

  m({
    key: 'vessel_risk',
    name: 'Vessel Risk',
    nameId: 'Risiko Kapal',
    icon: '🚢',
    codePrefix: 'VRSK',
    scope: 'vessel',
    workflow: WF.RISK,
    capa: true,
    standards: ['ISO 31000:2018', 'ISM Code §1.2.2'],
    regulations: ['UU No. 17 Tahun 2008 tentang Pelayaran', 'SOLAS'],
    fields: riskBase([
      sel('risk_area', 'Area Risiko Kapal', [
        'Navigasi & Olah Gerak', 'Permesinan', 'Stabilitas & Muatan', 'Ramp Door / Bow Door',
        'Kebakaran di Kapal', 'Keselamatan Penumpang', 'Awak Kapal & Kompetensi',
        'Cuaca & Gelombang', 'Sandar & Lepas Sandar', 'Bunkering', 'Barang Berbahaya (DG)',
        'Pencemaran dari Kapal',
      ], { required: true }),
      sel('ism_element', 'Elemen ISM Code Terkait', ['1 - Umum', '2 - Kebijakan', '3 - Tanggung Jawab Perusahaan', '5 - Tanggung Jawab Nakhoda', '6 - Sumber Daya & Personil', '7 - Operasi Kapal', '8 - Kesiapan Darurat', '9 - Laporan Ketidaksesuaian', '10 - Pemeliharaan Kapal', '12 - Verifikasi Internal']),
      f('affects_seaworthiness', 'Berpengaruh pada Kelaiklautan', 'bool'),
    ]),
  }),

  m({
    key: 'risk_treatment',
    name: 'Risk Treatment',
    nameId: 'Rencana Perlakuan Risiko',
    icon: '🩹',
    codePrefix: 'RTP',
    scope: 'any',
    workflow: WF.CAPA,
    standards: ['ISO 31000:2018 §6.5.3'],
    fields: [
      req('title', 'Judul Perlakuan Risiko'),
      f('risk_ref', 'Kode Risiko Terkait', 'text', { required: true }),
      sel('treatment_option', 'Opsi Perlakuan', TREATMENT, { required: true }),
      txt('treatment_description', 'Uraian Tindakan', { required: true }),
      f('pic', 'Penanggung Jawab', 'user', { required: true }),
      dt('start_date', 'Mulai'),
      dt('due_date', 'Target Selesai', { required: true, alert: 'due' }),
      num('budget', 'Anggaran (IDR)', { type: 'currency' }),
      num('realization', 'Realisasi Biaya (IDR)', { type: 'currency' }),
      num('progress', 'Progres (%)', { min: 0, max: 100 }),
      txt('kpi_indicator', 'Indikator Keberhasilan'),
      txt('effectiveness_review', 'Evaluasi Efektivitas'),
      sel('residual_acceptable', 'Risiko Residual Dapat Diterima', ['Ya', 'Tidak', 'Perlu Perlakuan Tambahan']),
    ],
  }),
];
