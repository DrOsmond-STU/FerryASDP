/**
 * GROUP O - Subscription & Billing (model SaaS)
 *
 * Setiap cabang ASDP adalah satu tenant yang berlangganan bulanan. Paket
 * menentukan kelompok modul yang aktif dan batas jumlah pengguna; status
 * langganan menentukan apakah cabang masih boleh menulis data.
 */
import { m, f, req, sel, num, dt, txt, WF, PRIORITY } from './defs.js';

export const group = { code: 'O', key: 'saas', name: 'Langganan & Penagihan', icon: '💳' };

/** Kelompok modul yang dapat dimasukkan ke dalam sebuah paket. */
export const GROUP_OPTIONS = [
  { value: 'governance', label: 'A. Governance & Master Data' },
  { value: 'document', label: 'B. Document Management' },
  { value: 'quality', label: 'C. Quality Management' },
  { value: 'health', label: 'D. Health Management' },
  { value: 'safety', label: 'E. Occupational Safety' },
  { value: 'environment', label: 'F. Environment & Energy' },
  { value: 'audit', label: 'G. Audit & Compliance' },
  { value: 'risk', label: 'H. Risk Management' },
  { value: 'assetsafety', label: 'I. Asset Safety' },
  { value: 'contractorsafety', label: 'J. Contractor Safety' },
  { value: 'maritime', label: 'K. Maritime Safety' },
  { value: 'portsafety', label: 'M. Port Safety (ASDP)' },
  { value: 'continuity', label: 'N. Continuity, Energy & Security' },
  { value: 'training', label: 'P. Competency & Training Management' },
];

/** Siklus hidup langganan - dipakai sebagai workflow modul subscription. */
const WF_SUBSCRIPTION = [
  { key: 'trial', label: 'Uji Coba', requires: 'create', initial: true },
  { key: 'active', label: 'Aktif', requires: 'approve' },
  { key: 'past_due', label: 'Menunggak', requires: 'edit' },
  { key: 'suspended', label: 'Ditangguhkan', requires: 'approve' },
  { key: 'ended', label: 'Berhenti', requires: 'approve', terminal: true, negative: true },
];

/** Siklus tagihan. */
const WF_INVOICE = [
  { key: 'draft', label: 'Draft', requires: 'create', initial: true },
  { key: 'issued', label: 'Diterbitkan', requires: 'edit' },
  { key: 'paid', label: 'Lunas', requires: 'approve', terminal: true },
  { key: 'overdue', label: 'Jatuh Tempo', requires: 'edit' },
  { key: 'void', label: 'Dibatalkan', requires: 'approve', terminal: true, negative: true },
];

/** Perjalanan calon pelanggan dari halaman depan sampai berlangganan. */
const WF_LEAD = [
  { key: 'new', label: 'Permintaan Baru', requires: 'create', initial: true },
  { key: 'contacted', label: 'Dihubungi', requires: 'edit' },
  { key: 'demo', label: 'Demo Terjadwal', requires: 'edit' },
  { key: 'trial', label: 'Uji Coba Berjalan', requires: 'edit' },
  { key: 'converted', label: 'Berlangganan', requires: 'approve', terminal: true },
  { key: 'lost', label: 'Tidak Dilanjutkan', requires: 'approve', terminal: true, negative: true },
];

export default [
  m({
    key: 'subscription_plan',
    name: 'Subscription Plan',
    nameId: 'Paket Langganan',
    master: true,
    platformOnly: true,
    scope: 'corporate',
    orgFields: [],
    codePrefix: 'PKT',
    icon: '🏷',
    workflow: WF.RECORD,
    fields: [
      req('name', 'Nama Paket'),
      f('tagline', 'Tagline'),
      num('sort_order', 'Urutan Tampil'),
      num('monthly_price', 'Harga Bulanan per Cabang (IDR)', { type: 'currency', required: true }),
      num('annual_price', 'Harga Tahunan per Cabang (IDR)', { type: 'currency', help: 'Umumnya setara 10 bulan - hemat 2 bulan.' }),
      num('annual_saving_percent', 'Penghematan Tahunan (%)', { computed: 'annualSaving', readonly: true }),
      num('max_users', 'Batas Pengguna', { help: 'Kosongkan atau isi 0 untuk tanpa batas.' }),
      num('storage_gb', 'Kuota Penyimpanan (GB)'),
      sel('included_groups', 'Kelompok Modul Termasuk', GROUP_OPTIONS, { type: 'multiselect', required: true }),
      num('module_count', 'Jumlah Modul Aktif', { readonly: true, help: 'Dihitung dari kelompok modul yang termasuk.' }),
      sel('support_level', 'Tingkat Dukungan', ['Email (hari kerja)', 'Email & Telepon (hari kerja)', 'Prioritas 24/7 dengan Account Manager']),
      f('sla_uptime', 'SLA Ketersediaan', { placeholder: '99,5%' }),
      f('onboarding_included', 'Termasuk Pendampingan Implementasi', 'bool'),
      f('training_included', 'Termasuk Pelatihan Pengguna', 'bool'),
      f('api_access', 'Akses Integrasi API', 'bool'),
      f('dedicated_report', 'Laporan Kustom & Analitik Lanjutan', 'bool'),
      f('highlights', 'Sorotan Fitur', 'multiselect', {
        options: [
          'Dashboard eksekutif & ESG', 'Checklist pra-berlayar digital', 'Keselamatan muat kendaraan',
          'Manajemen insiden pelayaran', 'Peta panas risiko ISO 31000', 'Perhitungan jejak karbon otomatis',
          'Peringatan kedaluwarsa sertifikat', 'Jejak audit menyeluruh', 'Ekspor laporan regulator',
          'Manajemen kepadatan angkutan puncak', 'Kelola kontraktor (CSMS)', 'Kelangsungan usaha (BCM)',
          'Matriks pelatihan wajib per jabatan', 'Pembelajaran daring & ujian kompetensi',
        ],
      }),
      f('is_public', 'Ditampilkan di Halaman Depan', 'bool'),
      f('recommended', 'Paket Direkomendasikan', 'bool'),
      txt('description', 'Deskripsi Paket'),
    ],
  }),

  m({
    key: 'subscription',
    name: 'Branch Subscription',
    nameId: 'Langganan Cabang',
    scope: 'branch',
    codePrefix: 'SUB',
    icon: '📶',
    workflow: WF_SUBSCRIPTION,
    tenantVisible: true,
    fields: [
      req('plan', 'Paket Langganan', 'plan'),
      dt('start_date', 'Tanggal Mulai', { required: true }),
      dt('trial_end', 'Akhir Masa Uji Coba', { alert: 'expiry' }),
      sel('billing_cycle', 'Siklus Penagihan', ['Bulanan', 'Tahunan'], { required: true }),
      num('list_price', 'Harga Dasar per Bulan (IDR)', { type: 'currency', required: true }),
      num('discount_percent', 'Diskon (%)', { min: 0, max: 100 }),
      num('effective_fee', 'Biaya Efektif per Bulan (IDR)', { type: 'currency', computed: 'effectiveFee', readonly: true }),
      num('mrr', 'Monthly Recurring Revenue (IDR)', { type: 'currency', computed: 'effectiveFee', readonly: true }),
      num('user_seats', 'Kuota Pengguna', { required: true }),
      num('active_users', 'Pengguna Aktif'),
      num('seat_utilization', 'Utilisasi Kuota (%)', { computed: 'seatUtilization', readonly: true }),
      dt('next_billing_date', 'Tagihan Berikutnya', { alert: 'expiry' }),
      dt('contract_end', 'Akhir Kontrak', { alert: 'expiry' }),
      f('auto_renew', 'Perpanjangan Otomatis', 'bool'),
      f('po_number', 'Nomor PO / Kontrak Cabang'),
      f('account_manager', 'Account Manager', 'user'),
      sel('onboarding_status', 'Status Implementasi', ['Belum Dimulai', 'Migrasi Data', 'Pelatihan Pengguna', 'Berjalan Penuh']),
      dt('go_live_date', 'Tanggal Go Live'),
      sel('health_status', 'Kesehatan Akun', ['Sehat', 'Perlu Perhatian', 'Berisiko Churn']),
      num('nps_score', 'Skor NPS Terakhir', { min: -100, max: 100 }),
      txt('notes', 'Catatan Akun'),
    ],
  }),

  m({
    key: 'invoice',
    name: 'Subscription Invoice',
    nameId: 'Tagihan Langganan',
    scope: 'branch',
    codePrefix: 'INV',
    icon: '🧾',
    workflow: WF_INVOICE,
    tenantVisible: true,
    fields: [
      req('invoice_number', 'Nomor Tagihan'),
      f('subscription_ref', 'Langganan', 'subscription'),
      req('period', 'Periode (YYYY-MM)', 'text', { placeholder: '2026-01', pattern: '^\\d{4}-\\d{2}$' }),
      dt('issue_date', 'Tanggal Terbit', { required: true }),
      dt('due_date', 'Jatuh Tempo', { required: true, alert: 'due' }),
      f('plan_name', 'Paket'),
      num('quantity_months', 'Jumlah Bulan', { default: 1 }),
      num('subtotal', 'Subtotal (IDR)', { type: 'currency', required: true }),
      num('discount', 'Diskon (IDR)', { type: 'currency' }),
      num('tax_amount', 'PPN 11% (IDR)', { type: 'currency', computed: 'invoiceTax', readonly: true }),
      num('total', 'Total Tagihan (IDR)', { type: 'currency', computed: 'invoiceTotal', readonly: true }),
      dt('paid_date', 'Tanggal Pembayaran'),
      num('paid_amount', 'Jumlah Dibayar (IDR)', { type: 'currency' }),
      sel('payment_method', 'Metode Pembayaran', ['Transfer Bank', 'Virtual Account', 'Kartu Kredit Korporat', 'Potong Anggaran Cabang']),
      f('payment_ref', 'Referensi Pembayaran'),
      num('days_overdue', 'Umur Tunggakan (hari)', { computed: 'daysOverdue', readonly: true }),
      f('tax_invoice_number', 'Nomor Faktur Pajak'),
      txt('notes', 'Catatan'),
    ],
  }),

  m({
    key: 'subscription_usage',
    name: 'Subscription Usage',
    nameId: 'Pemakaian Langganan',
    scope: 'branch',
    codePrefix: 'USG',
    icon: '📈',
    workflow: WF.MONITORING,
    tenantVisible: true,
    fields: [
      req('period', 'Periode (YYYY-MM)', 'text', { placeholder: '2026-01', pattern: '^\\d{4}-\\d{2}$' }),
      num('licensed_users', 'Kuota Pengguna'),
      num('active_users', 'Pengguna Aktif', { required: true }),
      num('seat_utilization', 'Utilisasi Kuota (%)', { computed: 'usageSeatUtilization', readonly: true }),
      num('logins', 'Jumlah Sesi Masuk'),
      num('records_created', 'Rekaman Dibuat'),
      num('modules_used', 'Modul Digunakan'),
      num('modules_available', 'Modul Tersedia dalam Paket'),
      num('adoption_score', 'Skor Adopsi (%)', { computed: 'adoptionScore', readonly: true }),
      sel('adoption_status', 'Status Adopsi', ['Sangat Baik', 'Baik', 'Perlu Pendampingan', 'Rendah'], { computed: 'adoptionStatus' }),
      num('storage_mb', 'Penyimpanan Terpakai (MB)'),
      f('top_module', 'Modul Paling Aktif'),
      num('support_tickets', 'Tiket Dukungan'),
      txt('notes', 'Catatan Customer Success'),
    ],
  }),

  m({
    key: 'trial_request',
    name: 'Trial Request',
    nameId: 'Permintaan Uji Coba',
    platformOnly: true,
    scope: 'corporate',
    orgFields: ['region', 'branch'],
    codePrefix: 'LEAD',
    icon: '✉',
    workflow: WF_LEAD,
    fields: [
      req('organisation', 'Nama Cabang / Unit'),
      req('contact_name', 'Nama Penanggung Jawab'),
      f('position', 'Jabatan'),
      req('email', 'Surel'),
      f('phone', 'Telepon'),
      sel('plan_interest', 'Paket yang Diminati', ['Esensial', 'Profesional', 'Maritim Enterprise', 'Belum Menentukan']),
      num('employee_count', 'Perkiraan Jumlah Pengguna'),
      sel('priority_area', 'Kebutuhan Utama', [
        'Keselamatan Pelayaran & Checklist Kapal', 'Keselamatan Kerja (K3) & SMK3',
        'Pengelolaan Lingkungan & Limbah B3', 'Mutu & Kepuasan Pelanggan',
        'Manajemen Risiko & Audit', 'Pelaporan ESG & Keberlanjutan', 'Pengelolaan Aset & Sertifikat',
      ]),
      txt('message', 'Kebutuhan / Pertanyaan'),
      sel('source', 'Sumber', ['Halaman Depan Aplikasi', 'Rapat Koordinasi', 'Rujukan Cabang Lain', 'Sosialisasi Kantor Pusat', 'Lainnya']),
      dt('request_date', 'Tanggal Permintaan'),
      f('assigned_to', 'Ditangani Oleh', 'user'),
      dt('follow_up_date', 'Rencana Tindak Lanjut', { alert: 'due' }),
      sel('qualification', 'Kualifikasi', PRIORITY),
      txt('outcome_note', 'Catatan Hasil'),
    ],
  }),
];
