/** Dashboard views. Each one is a pure function of its API payload. */
import { api, can } from './api.js';
import { h, mount, stat, spinner, emptyState, fmtNumber, fmtDecimal, fmtCurrency, fmtDate, statusBadge, riskPill } from './ui.js';
import { lineChart, barList, donut, riskHeatmap, targetBars, PALETTE } from './charts.js';

export const DASHBOARDS = [
  { key: 'executive', name: 'Executive Dashboard', icon: '📊', path: '/api/dashboard/executive', render: executive },
  { key: 'incident', name: 'Incident Dashboard', icon: '🚨', path: '/api/dashboard/incident', render: incident, requires: 'incident' },
  { key: 'risk', name: 'Risk Dashboard', icon: '⚠', path: '/api/dashboard/risk', render: risk, requires: 'risk_register' },
  { key: 'audit', name: 'Audit Dashboard', icon: '🔎', path: '/api/dashboard/audit', render: audit, requires: 'internal_audit' },
  { key: 'quality', name: 'Quality Dashboard', icon: '🎯', path: '/api/dashboard/quality', render: quality, requires: 'quality_objective' },
  { key: 'health', name: 'Health Dashboard', icon: '🩺', path: '/api/dashboard/health', render: health, requires: 'mcu' },
  { key: 'carbon', name: 'Carbon Dashboard', icon: '🌍', path: '/api/dashboard/carbon', render: carbon, requires: 'fuel_consumption' },
  { key: 'esg', name: 'ESG Dashboard', icon: '🌱', path: '/api/dashboard/esg', render: esg, requires: 'esg' },
  { key: 'vessel', name: 'Vessel Dashboard', icon: '🚢', path: '/api/dashboard/vessel', render: vessel, requires: 'vessel' },
  { key: 'port', name: 'Port Dashboard', icon: '⚓', path: '/api/dashboard/port', render: port, requires: 'port' },
  { key: 'contractor', name: 'Contractor Dashboard', icon: '🤝', path: '/api/dashboard/contractor', render: contractor, requires: 'contractor' },
  { key: 'asset', name: 'Asset Dashboard', icon: '🛠', path: '/api/dashboard/asset', render: asset, requires: 'asset' },
  { key: 'training', name: 'Training & Competency', icon: '🎓', path: '/api/dashboard/training', render: training, requires: 'training_master' },
  { key: 'bsc', name: 'Balanced Scorecard', icon: '🧭', path: '/api/dashboard/bsc', render: bsc, requires: 'quality_objective' },
  { key: 'analytics', name: 'Dashboard Analitik', icon: '🔬', path: '/api/dashboard/analytics', render: analytics },
  { key: 'subscription', name: 'Langganan & Pendapatan', icon: '💳', path: '/api/dashboard/subscription', render: subscription, platformOnly: true },
];

export async function renderDashboard(container, def) {
  mount(container, spinner('Menghitung indikator…'));
  const data = await api.get(def.path);
  mount(container,
    h('div.page-head', {},
      h('div.grow', {},
        h('h1', {}, h('span', { text: def.icon }), def.name),
        h('div.small.muted', { text: `Periode analisis ${data.year || new Date().getFullYear()} · angka mengikuti cakupan akses Anda.` }))),
    def.render(data));
}

const card = (title, ...body) => h('div.card', {}, h('h3', { text: title }), ...body);
const num = (v) => (v === null || v === undefined ? '—' : fmtNumber(v));
const dec = (v, d = 2) => (v === null || v === undefined ? '—' : fmtDecimal(v, d));

/* ------------------------------------------------------------- executive */

function executive(d) {
  const c = d.cards;
  const wrap = h('div');

  wrap.appendChild(h('div.grid.cols-4', {},
    stat('Insiden Tahun Berjalan', num(c.incidents), { sub: `${num(c.lti)} lost time · ${num(c.fatality)} fatality`, tone: c.fatality ? 'danger' : c.lti ? 'warn' : 'ok' }),
    stat('LTIFR', dec(c.ltifr, 2), { sub: 'per 1 juta jam kerja', tone: (c.ltifr ?? 0) > 1 ? 'warn' : 'ok' }),
    stat('TRIR', dec(c.trir, 2), { sub: `${num(c.manhours)} jam kerja tercatat` }),
    stat('Near Miss & Unsafe', num((c.nearMiss || 0) + (c.unsafeFindings || 0)), { sub: `${num(c.nearMiss)} near miss · ${num(c.unsafeFindings)} temuan`, tone: 'ok' }),
    stat('CAPA Terbuka', num(c.openCapa), { sub: `${num(c.overdueCapa)} melewati target`, tone: c.overdueCapa ? 'warn' : '' }),
    stat('Risiko Tinggi/Ekstrem', num(c.highRisks), { tone: c.highRisks ? 'warn' : 'ok' }),
    stat('Kepatuhan Regulasi', c.complianceRate === null ? '—' : `${dec(c.complianceRate, 1)}%`, { sub: 'daftar peraturan dievaluasi', tone: (c.complianceRate ?? 100) >= 95 ? 'ok' : 'warn' }),
    stat('Emisi GRK', dec(c.carbonTon, 1), { unit: 't CO₂e', sub: 'Scope 1 & 2 tahun berjalan' }),
    stat('Insiden Pelayaran', num(c.marineIncidents), { tone: c.marineIncidents ? 'warn' : 'ok' }),
    stat('Audit Internal', num(c.internalAudits), { sub: `${num(c.majorNc)} ketidaksesuaian mayor` }),
    stat('Keluhan Pelanggan', num(c.complaints)),
    stat('Pelatihan & Latihan Darurat', `${num(c.trainings)} / ${num(c.drills)}`, { sub: 'pelatihan · drill' }),
    stat('Kepatuhan Pelatihan Wajib', c.trainingCompliance === null ? '—' : `${dec(c.trainingCompliance, 1)}%`, {
      sub: 'pemenuhan matriks kompetensi',
      tone: (c.trainingCompliance ?? 100) >= 95 ? 'ok' : 'warn',
    }),
    stat('Sertifikat Kompetensi Kedaluwarsa', num(c.expiredCertificates), { tone: c.expiredCertificates ? 'danger' : 'ok' })));

  wrap.appendChild(h('div.grid.cols-2', { style: 'margin-top:1rem' },
    card('Tren Insiden 12 Bulan', lineChart(d.incidentTrend, { color: PALETTE[4] })),
    card('Tren Near Miss 12 Bulan', lineChart(d.nearMissTrend, { color: PALETTE[1] }))));

  wrap.appendChild(h('div.grid.cols-3', { style: 'margin-top:1rem' },
    card('Klasifikasi Insiden', barList(d.incidentByClassification, { format: num, color: PALETTE[4] })),
    card('Jenis Insiden Terbanyak', barList(d.incidentByType, { format: num })),
    card('Status CAPA', donut(d.capaByStatus?.map((r) => ({ label: r.label, value: r.value })) || [], { format: num }))));

  wrap.appendChild(h('div.grid.cols-2', { style: 'margin-top:1rem' },
    card('Peta Panas Risiko Korporat (ISO 31000)', riskHeatmap(d.riskHeatmap)),
    card('Emisi Karbon per Cakupan', donut(d.carbon?.byScope || [], { format: (v) => `${dec(v, 1)} t` }))));

  wrap.appendChild(h('div', { style: 'margin-top:1rem' }, alertsCard(d.alerts)));
  return wrap;
}

function alertsCard(alerts) {
  if (!alerts?.length) return card('⏰ Peringatan Kedaluwarsa', h('p.muted.small', { text: 'Tidak ada dokumen, sertifikat atau tindakan yang mendekati jatuh tempo.' }));
  return card('⏰ Peringatan Kedaluwarsa & Jatuh Tempo',
    h('div.table-wrap', {}, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { text: 'Modul' }), h('th', { text: 'Rekaman' }), h('th', { text: 'Item' }),
        h('th', { text: 'Tanggal' }), h('th', { text: 'Sisa Hari' }))),
      h('tbody', {}, ...alerts.map((a) => h('tr.clickable', { onclick: () => { location.hash = `#/m/${a.module}/${a.id}`; } },
        h('td.small', {}, `${a.icon} ${a.moduleName}`),
        h('td.small', {}, h('span.mono', { text: a.code }), ' ', a.label || ''),
        h('td.small', { text: a.field }),
        h('td.small.nowrap', { text: fmtDate(a.date) }),
        h('td', {}, h('span.badge', { class: a.severity === 'overdue' ? 'b-danger' : 'b-warn', text: a.severity === 'overdue' ? `Lewat ${Math.abs(a.daysLeft)} hari` : `${a.daysLeft} hari` }))))))));
}

/* --------------------------------------------------------------- incident */

function incident(d) {
  const r = d.rates;
  return h('div', {},
    h('div.grid.cols-4', {},
      stat('Fatality', num(r.fatality), { tone: r.fatality ? 'danger' : 'ok' }),
      stat('Lost Time Injury', num(r.lti), { tone: r.lti ? 'warn' : 'ok' }),
      stat('Medical Treatment', num(r.mtc)),
      stat('First Aid Case', num(r.fac)),
      stat('LTIFR', dec(r.ltifr, 2), { sub: 'per 1 juta jam kerja' }),
      stat('TRIR', dec(r.trir, 2)),
      stat('Severity Rate', dec(r.severityRate, 2), { sub: `${num(r.lostDays)} hari kerja hilang` }),
      stat('Jam Kerja', num(r.manhours))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Tren Insiden', lineChart(d.trend, { color: PALETTE[4] })),
      card('Hari Kerja Hilang', lineChart(d.lostDaysTrend, { color: PALETTE[2] }))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Klasifikasi', donut(d.byClassification, { format: num })),
      card('Jenis Insiden', barList(d.byType, { format: num })),
      card('Lokasi Kejadian', barList(d.byLocation, { format: num, color: PALETTE[1] }))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Kategori Korban', barList(d.byVictim, { format: num, color: PALETTE[3] })),
      card('Tindakan Tidak Aman', barList(d.unsafeActionByCategory, { format: num, color: PALETTE[2] })),
      card('Kondisi Tidak Aman', barList(d.unsafeConditionByCategory, { format: num, color: PALETTE[5] }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Piramida Pelaporan Keselamatan',
        barList([
          { label: 'Insiden', value: d.reportingRatio.incidents },
          { label: 'Near miss', value: d.reportingRatio.nearMiss },
          { label: 'Tindakan/kondisi tidak aman', value: d.reportingRatio.unsafe },
        ], { format: num }),
        h('p.small.muted', { style: 'margin-top:.5rem', text: 'Rasio pelaporan proaktif yang sehat menunjukkan dasar piramida jauh lebih besar dari puncaknya.' })),
      card('Tren Observasi & Toolbox Meeting',
        lineChart(d.observationTrend, { color: PALETTE[1] }),
        lineChart(d.toolboxTrend, { color: PALETTE[6] }))));
}

/* ------------------------------------------------------------------- risk */

function risk(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      ...d.byModule.map((m) => stat(m.name, num(m.total), { sub: `${num(m.high)} tinggi/ekstrem`, tone: m.high ? 'warn' : '' }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Peta Panas Risiko (Register Risiko)', riskHeatmap(d.heatmap)),
      card('Peta Panas Bahaya Kerja (HIRA)', riskHeatmap(d.hiraHeatmap))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Kategori Risiko', barList(d.byCategory, { format: num })),
      card('Tingkat Risiko Awal', donut(d.byLevel, { format: num })),
      card('Tingkat Risiko Residual', donut(d.residualByLevel, { format: num }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Bahaya Dominan pada HIRA', barList(d.hiraByHazard, { format: num, color: PALETTE[2] })),
      card('Status Perlakuan Risiko',
        barList(d.treatmentByStatus, { format: num, color: PALETTE[1] }),
        h('p.small.muted', { style: 'margin-top:.5rem', text: `${num(d.appetiteBreaches)} risiko melebihi selera risiko perusahaan.` }))),
    card('10 Risiko Tertinggi',
      d.topRisks?.length
        ? h('div.table-wrap', {}, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { text: 'Kode' }), h('th', { text: 'Risiko' }), h('th', { text: 'Kategori' }), h('th', { text: 'Nilai' }), h('th', { text: 'Tingkat' }), h('th', { text: 'Residual' }))),
          h('tbody', {}, ...d.topRisks.map((r) => h('tr.clickable', { onclick: () => { location.hash = `#/m/risk_register/${r.id}`; } },
            h('td.mono', { text: r.code }), h('td', { text: r.title }), h('td.small', { text: r.risk_category || '—' }),
            h('td', { text: num(r.risk_score) }), h('td', {}, riskPill(r.risk_level)), h('td', {}, riskPill(r.res_risk_level)))))))
        : emptyState()));
}

/* ------------------------------------------------------------------ audit */

function audit(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      stat('Audit Internal Terlaksana', `${num(d.internal.executed)} / ${num(d.internal.planned)}`, { sub: 'realisasi terhadap program' }),
      stat('Ketidaksesuaian Mayor', num(d.internal.majorNc + d.external.majorNc), { tone: (d.internal.majorNc + d.external.majorNc) ? 'warn' : 'ok' }),
      stat('Ketidaksesuaian Minor', num(d.internal.minorNc + d.external.minorNc)),
      stat('Audit Eksternal', num(d.external.total)),
      stat('CAPA Terlambat', num(d.capaOverdue), { tone: d.capaOverdue ? 'danger' : 'ok' }),
      stat('Rata-rata Progres CAPA', `${dec(d.capaAvgProgress, 0)}%`),
      stat('Observasi Audit', num(d.internal.observations)),
      stat('Tinjauan Manajemen', num(d.managementReviews))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Tren Inspeksi', lineChart(d.inspectionTrend, { color: PALETTE[1] })),
      card('Jenis Inspeksi', barList(d.inspectionByType, { format: num }))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Ketidaksesuaian per Kategori', donut(d.ncByCategory, { format: num })),
      card('Sumber Ketidaksesuaian', barList(d.ncBySource, { format: num, color: PALETTE[2] })),
      card('Status CAPA', barList(d.capaByStatus, { format: num, color: PALETTE[1] }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Audit Eksternal per Jenis', barList(d.external.byType, { format: num, color: PALETTE[3] })),
      card('Status Kepatuhan Peraturan', donut(d.complianceByStatus, { format: num }))));
}

/* ---------------------------------------------------------------- quality */

function quality(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      stat('Indikator Mutu', num(d.kpis.length)),
      stat('Keluhan Pelanggan', num(d.complaintTrend.reduce((a, r) => a + r.value, 0))),
      stat('Dokumen Terbit', num(d.documents.published), { sub: `${num(d.documents.dueReview)} jatuh tempo tinjauan`, tone: d.documents.dueReview ? 'warn' : 'ok' }),
      stat('Penghematan Perbaikan', fmtCurrency(d.improvement.saving), { sub: `${num(d.improvement.total)} inisiatif` })),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Pencapaian Sasaran Mutu & KPI', targetBars(d.kpis)),
      card('Status Pencapaian KPI', donut(d.kpiByStatus, { format: num }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Tren Keluhan Pelanggan', lineChart(d.complaintTrend, { color: PALETTE[2] })),
      card('Tren Ketidaksesuaian', lineChart(d.ncTrend, { color: PALETTE[4] }))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Kategori Keluhan', barList(d.complaintByCategory, { format: num })),
      card('Kanal Keluhan', barList(d.complaintByChannel, { format: num, color: PALETTE[1] })),
      card('Kepuasan atas Penyelesaian', donut(d.satisfaction, { format: num }))));
}

/* ----------------------------------------------------------------- health */

function health(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      stat('MCU Terlaksana', num(d.mcu.total), { sub: `${num(d.mcu.followUp)} perlu tindak lanjut` }),
      stat('Kelelahan Berisiko Tinggi', num(d.fatigue.highRisk), { tone: d.fatigue.highRisk ? 'warn' : 'ok' }),
      stat('Jam Istirahat Tidak Memenuhi', num(d.fatigue.nonCompliantRest), { sub: 'acuan STCW 10 jam/24 jam', tone: d.fatigue.nonCompliantRest ? 'warn' : 'ok' }),
      stat('Penyakit Akibat Kerja', num(d.occupationalDisease.total), { tone: d.occupationalDisease.total ? 'warn' : 'ok' }),
      stat('Kunjungan Klinik', num(d.clinic.visits), { sub: `${num(d.clinic.workRelated)} terkait pekerjaan` }),
      stat('Program Promosi Kesehatan', num(d.campaigns))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Tren MCU', lineChart(d.mcu.trend, { color: PALETTE[1] })),
      card('Tren Kunjungan Klinik', lineChart(d.clinic.trend, { color: PALETTE[2] }))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Hasil MCU', donut(d.mcu.byResult, { format: num })),
      card('Status Risiko Kelelahan', donut(d.fatigue.byRisk, { format: num })),
      card('Kategori Penyakit Akibat Kerja', barList(d.occupationalDisease.byCategory, { format: num, color: PALETTE[4] }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Kategori Pasien Klinik', barList(d.clinic.byPatientType, { format: num })),
      card('Cakupan Vaksinasi', barList(d.vaccination, { format: num, color: PALETTE[6] }))));
}

/* ----------------------------------------------------------------- carbon */

function carbon(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      stat('Total Emisi', dec(d.total, 1), { unit: 't CO₂e', sub: 'Scope 1 & 2 tahun berjalan' }),
      ...d.byScope.map((s) => stat(s.label, dec(s.value, 1), { unit: 't CO₂e' })),
      stat('Penghematan Energi', fmtCurrency(d.energyPrograms.saving), { sub: `${num(d.energyPrograms.total)} program efisiensi` }),
      stat('Emisi Dihindari', dec(d.energyPrograms.co2Avoided, 2), { unit: 't CO₂e', tone: 'ok' })),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Tren Emisi Bulanan (t CO₂e)', lineChart(d.trend, { color: PALETTE[4] })),
      card('Emisi per Sumber', barList(d.bySource, { format: (v) => `${dec(v, 1)} t`, color: PALETTE[2] }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Konsumsi Solar (liter)', lineChart(d.fuelTrend, { color: PALETTE[3], format: (v) => fmtNumber(v) })),
      card('Konsumsi Listrik (kWh)', lineChart(d.electricityTrend, { color: PALETTE[1], format: (v) => fmtNumber(v) }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Emisi per Pengguna Energi', donut(d.byConsumer, { format: num })),
      card('Faktor Emisi yang Digunakan',
        h('div.table-wrap', {}, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { text: 'Jenis Energi' }), h('th', { text: 'Faktor' }), h('th', { text: 'Satuan' }), h('th', { text: 'Sumber' }))),
          h('tbody', {}, ...d.factors.map((f) => h('tr', {},
            h('td.small', { text: f.type }), h('td.small', { text: String(f.factor) }),
            h('td.small', { text: `kg CO₂e/${f.unit}` }), h('td.small.muted', { text: f.source })))))))));
}

/* -------------------------------------------------------------------- ESG */

function esg(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      ...d.byPillar.map((p) => stat(p.label, `${dec(p.value, 1)}%`, { sub: `${num(p.count)} indikator`, tone: p.value >= 100 ? 'ok' : p.value >= 90 ? '' : 'warn' })),
      stat('Emisi GRK', dec(d.carbon.total, 1), { unit: 't CO₂e' })),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Pencapaian Indikator ESG', targetBars(d.indicators)),
      card('Kinerja Lingkungan',
        h('div.grid.cols-2', {},
          stat('Limbah Non-B3', dec(d.waste.nonB3 / 1000, 2), { unit: 'ton' }),
          stat('Limbah Didaur Ulang', dec(d.waste.recycled / 1000, 2), { unit: 'ton', tone: 'ok' }),
          stat('Limbah B3', dec(d.waste.b3, 1), { unit: 'kg/liter' }),
          stat('Tumpahan', num(d.spills.count), { sub: `${dec(d.spills.volume, 0)} liter, pulih ${dec(d.spills.recovered, 0)} liter`, tone: d.spills.count ? 'warn' : 'ok' })))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Kinerja Sosial',
        h('div.grid.cols-2', {},
          stat('Jam Pelatihan', num(d.social.trainingHours)),
          stat('Peserta Pelatihan', num(d.social.trainingParticipants)),
          stat('MCU', num(d.social.mcu)),
          stat('Keluhan Pelanggan', num(d.social.complaints)))),
      card('Tata Kelola',
        barList(d.governance.compliance, { format: num }),
        h('p.small.muted', { style: 'margin-top:.5rem', text: `${num(d.governance.securityEvents)} kejadian keamanan informasi · ${num(d.governance.contractorEvaluated)} kontraktor dievaluasi` })),
      card('Kepatuhan Baku Mutu Lingkungan',
        h('div.small.muted', { text: 'Emisi udara' }), barList(d.environmentCompliance.emission, { format: num, color: PALETTE[2] }),
        h('div.small.muted', { style: 'margin-top:.6rem', text: 'Air limbah & air laut' }), barList(d.environmentCompliance.water, { format: num, color: PALETTE[1] }))),
    card('Catatan Pelaporan',
      h('p.small.muted', { text: 'Indikator mengikuti GRI Standards dan dilaporkan dalam Laporan Keberlanjutan sesuai POJK No. 51/POJK.03/2017 serta SEOJK No. 16/SEOJK.04/2021.' })));
}

/* ----------------------------------------------------------------- vessel */

function vessel(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      stat('Armada', num(d.fleet.length)),
      stat('Checklist Pra-Berlayar', num(d.checklist.total), { sub: `${num(d.checklist.delayed)} ditunda/dibatalkan`, tone: d.checklist.delayed ? 'warn' : 'ok' }),
      stat('Inspeksi Kapal', num(d.inspections.total), { sub: `${num(d.inspections.notSeaworthy)} tidak laik laut`, tone: d.inspections.notSeaworthy ? 'danger' : 'ok' }),
      stat('Insiden Pelayaran', num(d.marineIncidents.total), { tone: d.marineIncidents.total ? 'warn' : 'ok' }),
      stat('SPB Diterbitkan', num(d.clearance.issued), { sub: `${num(d.clearance.held)} ditahan/ditunda` }),
      stat('Stabilitas Tidak Memenuhi', num(d.stability.nonCompliant), { sub: `${num(d.stability.records)} perhitungan GM`, tone: d.stability.nonCompliant ? 'warn' : 'ok' }),
      stat('Kendaraan Over Dimension', num(d.loading.overDimension), { sub: `${num(d.loading.dgShipments)} pengangkutan barang berbahaya` }),
      stat('Penumpang Melebihi Kapasitas', num(d.passenger.overCapacity), { sub: `${num(d.passenger.records)} pemeriksaan`, tone: d.passenger.overCapacity ? 'danger' : 'ok' })),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Tren Checklist Pra-Berlayar', lineChart(d.checklist.trend, { color: PALETTE[1] })),
      card('Tren Insiden Pelayaran', lineChart(d.marineIncidents.trend, { color: PALETTE[4] }))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Keputusan Keberangkatan', donut(d.checklist.byDecision, { format: num })),
      card('Jenis Insiden Pelayaran', barList(d.marineIncidents.byType, { format: num, color: PALETTE[4] })),
      card('Tingkat Keparahan', barList(d.marineIncidents.bySeverity, { format: num, color: PALETTE[2] }))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Hasil Inspeksi Ramp Door', barList(d.inspections.rampDoor, { format: num })),
      card('Hasil Inspeksi LSA', barList(d.inspections.lsa, { format: num, color: PALETTE[1] })),
      card('Hasil Inspeksi FFA', barList(d.inspections.ffa, { format: num, color: PALETTE[2] }))),
    card('Status Armada & Sertifikat',
      h('div.table-wrap', {}, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { text: 'Kapal' }), h('th', { text: 'Tipe' }), h('th', { text: 'Lintasan' }), h('th', { text: 'GT' }),
          h('th', { text: 'Status' }), h('th', { text: 'SMC' }), h('th', { text: 'ISSC' }), h('th', { text: 'Sert. Keselamatan' }), h('th', { text: 'Survey Klas' }), h('th', { text: 'Docking' }))),
        h('tbody', {}, ...d.fleet.map((v) => h('tr.clickable', { onclick: () => { location.hash = `#/m/vessel/${v.id}`; } },
          h('td', { text: v.name }), h('td.small', { text: v.vessel_type || '—' }), h('td.small', { text: v.route || '—' }),
          h('td', { text: num(v.gt) }), h('td', {}, h('span.badge', { class: v.operational_status === 'Beroperasi' ? 'b-ok' : 'b-warn', text: v.operational_status || '—' })),
          expiryCell(v.smc_expiry), expiryCell(v.issc_expiry), expiryCell(v.sertifikat_keselamatan_expiry),
          expiryCell(v.class_survey_due), expiryCell(v.docking_next))))))));
}

function expiryCell(date) {
  if (!date) return h('td.small.muted', { text: '—' });
  const days = Math.round((new Date(date) - new Date()) / 86400000);
  const cls = days < 0 ? 'b-danger' : days < 60 ? 'b-warn' : 'b-ok';
  return h('td', {}, h('span.badge', { class: cls, text: fmtDate(date) }));
}

/* ------------------------------------------------------------------- port */

function port(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      stat('Pelabuhan Dikelola', num(d.ports.length)),
      stat('Patroli Keselamatan', num(d.patrol.total), { sub: `${num(d.patrol.findings)} temuan` }),
      stat('Kesesuaian Patroli', `${dec(d.patrol.avgConformity, 1)}%`, { tone: d.patrol.avgConformity >= 90 ? 'ok' : 'warn' }),
      stat('Inspeksi Fasilitas', num(d.facility.inspections), { sub: `${num(d.facility.criticalFindings)} temuan kritis`, tone: d.facility.criticalFindings ? 'warn' : 'ok' }),
      stat('Kesesuaian Fasilitas', `${dec(d.facility.avgConformity, 1)}%`),
      stat('Kejadian Keamanan (ISPS)', num(d.security.events)),
      stat('Latihan Tanggap Darurat', num(d.emergency.drills), { sub: `${num(d.emergency.realEvents)} kejadian nyata` }),
      stat('Temuan Kebersihan', num(d.environment.housekeepingFindings))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Tren Patroli Keselamatan', lineChart(d.patrol.trend, { color: PALETTE[1] })),
      card('Tren Penumpang (Manajemen Kepadatan)', lineChart(d.crowd.passengerTrend, { color: PALETTE[0], format: (v) => fmtNumber(v) }))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Tingkat Kepadatan', donut(d.crowd.byCongestion, { format: num })),
      card('Kategori Kejadian Keamanan', barList(d.security.byCategory, { format: num, color: PALETTE[4] })),
      card('Skenario Tanggap Darurat', barList(d.emergency.byScenario, { format: num, color: PALETTE[2] }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Timbulan Limbah Non-B3 (kg)', lineChart(d.environment.wasteTrend, { color: PALETTE[6], format: (v) => fmtNumber(v) })),
      card('Timbulan Limbah B3', lineChart(d.environment.b3Trend, { color: PALETTE[4], format: (v) => fmtNumber(v) }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Kepatuhan Emisi Udara', barList(d.environment.emissionCompliance, { format: num })),
      card('Kepatuhan Air Limbah & Air Laut', barList(d.environment.waterCompliance, { format: num, color: PALETTE[1] }))),
    card('Daftar Pelabuhan',
      h('div.table-wrap', {}, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'Pelabuhan' }), h('th', { text: 'Kelas' }), h('th', { text: 'Provinsi' }), h('th', { text: 'Dermaga' }))),
        h('tbody', {}, ...d.ports.map((p) => h('tr.clickable', { onclick: () => { location.hash = `#/m/port/${p.id}`; } },
          h('td', { text: p.name }), h('td.small', { text: p.port_class || '—' }),
          h('td.small', { text: p.province || '—' }), h('td', { text: num(p.berth_count) }))))))));
}

/* ------------------------------------------------------------- contractor */

function contractor(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      stat('Kontraktor Terdaftar', num(d.contractors.length)),
      stat('Izin Aktif', num(d.permits.active), { sub: `${num(d.permits.total)} izin diterbitkan` }),
      stat('Jam Kerja Kontraktor', num(d.performance.manhours)),
      stat('LTI Kontraktor', num(d.performance.lti), { tone: d.performance.lti ? 'warn' : 'ok', sub: `${num(d.performance.fatality)} fatality` })),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Grade CSMS', donut(d.byGrade, { format: num })),
      card('Hasil Prakualifikasi', barList(d.prequalification, { format: num, color: PALETTE[1] })),
      card('Rekomendasi Evaluasi', barList(d.evaluation, { format: num, color: PALETTE[2] }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Tren LTI Kontraktor', lineChart(d.performance.trend, { color: PALETTE[4] })),
      card('Peringkat Kinerja Keselamatan', barList(d.performance.byRating, { format: num }))),
    card('Daftar Kontraktor',
      h('div.table-wrap', {}, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { text: 'Kontraktor' }), h('th', { text: 'Jenis Pekerjaan' }), h('th', { text: 'Risiko' }),
          h('th', { text: 'Skor CSMS' }), h('th', { text: 'Grade' }), h('th', { text: 'Status' }), h('th', { text: 'Akhir Kontrak' }))),
        h('tbody', {}, ...d.contractors.map((c) => h('tr.clickable', { onclick: () => { location.hash = `#/m/contractor/${c.id}`; } },
          h('td', { text: c.name }), h('td.small', { text: c.work_type || '—' }), h('td.small', { text: c.risk_category || '—' }),
          h('td', { text: dec(c.csms_score, 0) }), h('td.small', { text: c.csms_grade || '—' }),
          h('td', {}, h('span.badge', { class: c.blacklist_status === 'Aktif' ? 'b-ok' : 'b-danger', text: c.blacklist_status || '—' })),
          expiryCell(c.contract_end))))))));
}

/* ------------------------------------------------------------------ asset */

function asset(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      stat('Aset Terdaftar', num(d.assets.total)),
      stat('Inspeksi Peralatan', num(d.inspections.total), { sub: `${num(d.inspections.notFit)} tidak laik operasi`, tone: d.inspections.notFit ? 'danger' : 'ok' }),
      stat('Pemeliharaan', num(d.maintenance.total), { sub: `${dec(d.maintenance.downtime, 1)} jam downtime` }),
      stat('Biaya Pemeliharaan', fmtCurrency(d.maintenance.cost)),
      stat('Kalibrasi', num(d.calibration.total), { sub: `${num(d.calibration.outOfTolerance)} di luar toleransi`, tone: d.calibration.outOfTolerance ? 'warn' : 'ok' }),
      stat('Sertifikat Aktif', num(d.certificates.total), { sub: `${num(d.certificates.expiring.length)} mendekati jatuh tempo`, tone: d.certificates.expiring.length ? 'warn' : 'ok' })),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Aset per Kategori', barList(d.assets.byCategory, { format: num })),
      card('Kondisi Aset', donut(d.assets.byCondition, { format: num })),
      card('Kelas Kekritisan', donut(d.assets.criticalityClass, { format: num }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Tren Inspeksi Peralatan', lineChart(d.inspections.trend, { color: PALETTE[1] })),
      card('Hasil Inspeksi', barList(d.inspections.byResult, { format: num, color: PALETTE[2] }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Jenis Pemeliharaan', barList(d.maintenance.byType, { format: num })),
      card('Status Sertifikat', donut(d.certificates.byStatus, { format: num }))),
    alertsCard(d.certificates.expiring));
}

/* ------------------------------------------------ balanced scorecard (BSC) */

const scoreTone = (s) => (s === null || s === undefined ? '' : s >= 100 ? 'ok' : s >= 90 ? '' : s >= 75 ? 'warn' : 'danger');
const scoreColor = (s) => (s === null || s === undefined ? PALETTE[8] : s >= 100 ? '#12a150' : s >= 90 ? '#1189c1' : s >= 75 ? '#e0a207' : '#d13438');
const deltaChip = (d) => {
  if (d === null || d === undefined) return h('span.small.muted', { text: '—' });
  const up = d >= 0;
  return h('span.badge', { class: up ? 'b-ok' : 'b-danger', text: `${up ? '▲' : '▼'} ${fmtDecimal(Math.abs(d), 1)} poin` });
};

function bsc(d) {
  const kpiTable = (rows) => dataTable(
    [
      { label: 'Indikator' }, { label: 'Sasaran Strategis' }, { label: 'Satuan' },
      { label: 'Target', right: true }, { label: 'Realisasi', right: true },
      { label: 'Bobot', right: true }, { label: 'Pencapaian', right: true }, { label: 'Status' },
    ],
    rows,
    (k) => [
      h('td.small', { text: k.title }),
      h('td.small.muted', { text: k.strategic_objective || '—' }),
      h('td.small', { text: k.unit || '—' }),
      h('td.right', { text: dec(k.target, 2) }),
      h('td.right', { text: dec(k.actual, 2) }),
      h('td.right', { text: k.weight ? `${dec(k.weight, 0)}%` : '—' }),
      h('td.right', {}, h('strong', { text: k.achievement === null ? '—' : `${dec(k.achievement, 1)}%` })),
      badge(
        k.achievement === null ? 'b-draft'
          : k.achievement >= 100 ? 'b-ok' : k.achievement >= 90 ? 'b-progress' : k.achievement >= 75 ? 'b-warn' : 'b-danger',
        k.achievement_status || 'Belum diukur',
      ),
    ],
    { onRow: (k) => { location.hash = `#/m/quality_objective/${k.id}`; }, empty: 'Belum ada indikator pada perspektif ini.' },
  );

  // Peta strategi. Urutan lapisan tetap 1..4 seperti dikirim server; CSS yang
  // membalik tampilannya agar terbaca dari bawah ke atas.
  const map = h('div.bsc-map', {}, ...d.perspectives.map((p, i) => {
    const layer = h('div.bsc-layer', { style: `--bsc-tone:${scoreColor(p.score)}` },
      h('div', {},
        h('h4', {}, `${i + 1}. ${p.short}`, h('span.bsc-en', { text: p.en })),
        h('div.small.muted', { text: `${p.kpiCount} indikator · ${p.achieved} tercapai · ${p.atRisk} di bawah 90%` })),
      h('div', {},
        h('div.bar-track', {},
          h('div.bar-fill', { style: `width:${Math.min(p.score ?? 0, 120) / 1.2}%;background:${scoreColor(p.score)}` })),
        h('div.small.muted', { style: 'margin-top:.35rem' }, deltaChip(p.delta), ' dibanding tahun lalu')),
      h('div.bsc-score', { style: `color:${scoreColor(p.score)}` },
        p.score === null ? '—' : dec(p.score, 1),
        h('small', { text: p.grade || 'belum terukur' })));

    // Panah ditaruh SESUDAH lapisannya di DOM. Karena induknya
    // column-reverse, panah itu muncul di bawah lapisan tersebut — yaitu tepat
    // di antara dua lapisan. Menaruhnya sebelum lapisan menghasilkan satu panah
    // menggantung di paling atas dan tidak ada panah di antara dua lapisan
    // terbawah.
    return i === 0 ? layer : h('div', {}, layer, h('div.bsc-arrow', { text: '▲ menopang' }));
  }));

  const objectiveTable = dataTable(
    [{ label: 'Sasaran Strategis' }, { label: 'Perspektif' }, { label: 'Indikator', right: true }, { label: 'Tercapai', right: true }, { label: 'Skor', right: true }],
    d.objectives,
    (o) => [
      h('td.small', { text: o.objective }),
      h('td.small.muted', { text: (o.perspective || '—').replace(/^\d+ - /, '') }),
      h('td.right', { text: num(o.kpiCount) }),
      h('td.right', { text: num(o.achieved) }),
      h('td.right', {}, h('span.badge', {
        class: o.score === null ? 'b-draft' : o.score >= 100 ? 'b-ok' : o.score >= 90 ? 'b-progress' : o.score >= 75 ? 'b-warn' : 'b-danger',
        text: o.score === null ? 'belum terukur' : `${dec(o.score, 1)}%`,
      })),
    ],
    { empty: 'Belum ada sasaran strategis yang ditetapkan.' },
  );

  const ini = d.initiatives;

  return h('div', {},
    // Skor korporat berdiri sendiri: dijejerkan bersama empat perspektif dalam
    // satu baris empat kolom, yang kelima justru turun sendirian ke baris baru.
    h('div.grid', {},
      stat('Skor Kartu Skor Berimbang', d.overall === null ? '—' : dec(d.overall, 1), {
        sub: `${d.overallGrade || 'belum terukur'} · rata-rata keempat perspektif dengan bobot sama · tahun lalu ${d.overallPrevious === null ? '—' : dec(d.overallPrevious, 1)}`,
        tone: scoreTone(d.overall),
      })),
    h('div.grid.cols-4', { style: 'margin-top:1rem' },
      ...d.perspectives.map((p) => stat(p.short, p.score === null ? '—' : dec(p.score, 1), {
        sub: `${p.achieved} dari ${p.kpiCount} indikator tercapai`,
        tone: scoreTone(p.score),
      }))),

    card('Peta Strategi', map,
      h('p.small.muted', { style: 'margin-top:.8rem', text: 'Dibaca dari bawah ke atas mengikuti logika sebab-akibat Kaplan & Norton: kompetensi dan budaya menopang proses internal, proses yang andal menghasilkan kepuasan pelanggan, dan pelanggan yang loyal menghasilkan kinerja keuangan. Perspektif terbawah yang lemah akan menjatuhkan lapisan di atasnya — meski hari ini angkanya masih terlihat baik.' })),

    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Skor per Perspektif', barList(
        d.perspectives.map((p) => ({ label: p.short, value: p.score ?? 0 })),
        { format: (v) => `${dec(v, 1)}%` },
      )),
      card('Status Pencapaian Indikator', donut(d.byStatus, { format: num })),
      card('Inisiatif Strategis',
        h('div.grid.cols-2', {},
          stat('Perbaikan Berkelanjutan', num(ini.improvement), { sub: fmtCurrency(ini.improvementSaving) }),
          stat('CAPA Berjalan', num(ini.capaOpen), { tone: ini.capaOpen ? 'warn' : 'ok' }),
          stat('Perlakuan Risiko', num(ini.riskTreatment)),
          stat('Pelatihan Terjadwal', num(ini.trainingPlanned))),
        h('p.small.muted', { style: 'margin-top:.5rem', text: `${num(ini.managementReviews)} tinjauan manajemen tahun berjalan.` }))),

    card('10 Indikator Paling Tertinggal',
      dataTable(
        [{ label: 'Indikator' }, { label: 'Perspektif' }, { label: 'Target', right: true }, { label: 'Realisasi', right: true }, { label: 'Pencapaian', right: true }, { label: 'Unit Penanggung Jawab' }],
        d.laggingKpis,
        (k) => [
          h('td.small', { text: k.title }),
          h('td.small.muted', { text: (k.bsc_perspective || '—').replace(/^\d+ - /, '') }),
          h('td.right', { text: dec(k.target, 2) }),
          h('td.right', { text: dec(k.actual, 2) }),
          h('td.right', {}, h('span.badge', {
            class: k.achievement >= 100 ? 'b-ok' : k.achievement >= 90 ? 'b-progress' : k.achievement >= 75 ? 'b-warn' : 'b-danger',
            text: `${dec(k.achievement, 1)}%`,
          })),
          h('td.small.muted', { text: k.owner_unit || '—' }),
        ],
        { onRow: (k) => { location.hash = `#/m/quality_objective/${k.id}`; }, empty: 'Belum ada indikator terukur.' },
      )),

    card('Sasaran Strategis, Diurutkan dari yang Paling Tertinggal', objectiveTable),

    ...d.perspectives.map((p) => card(`${p.short} — ${p.kpiCount} indikator`, kpiTable(p.kpis))));
}

/* ------------------------------------------------------------- analitik */

function analytics(d) {
  const c = d.cards;

  const orgTable = (rows, label) => dataTable(
    // Judul kolom sengaja pendek: sembilan kolom dengan judul panjang mendorong
    // dua kolom terakhir keluar layar, dan justru itulah dua kolom yang paling
    // sering dicari — kepatuhan pelatihan dan sertifikat kedaluwarsa.
    [
      { label }, { label: 'Indeks', right: true }, { label: 'Insiden', right: true },
      { label: 'Proaktif', right: true }, { label: 'Temuan', right: true },
      { label: 'CAPA Telat', right: true }, { label: 'Keluhan', right: true },
      { label: 'Pelatihan', right: true }, { label: 'Sert. Mati', right: true },
    ],
    rows,
    (u) => [
      h('td', { text: u.name }),
      h('td.right', {}, h('span.badge', {
        class: u.index >= 70 ? 'b-ok' : u.index >= 50 ? 'b-warn' : 'b-danger',
        text: dec(u.index, 1),
      })),
      h('td.right', { text: num(u.incidents) }),
      h('td.right', { text: num(u.proactive) }),
      h('td.right', { text: num(u.findings) }),
      h('td.right', { text: num(u.capaOverdue) }),
      h('td.right', { text: num(u.complaints) }),
      h('td.right', { text: u.trainingCompliance === null ? '—' : `${dec(u.trainingCompliance, 1)}%` }),
      h('td.right', { text: num(u.expiredCerts) }),
    ],
    { empty: 'Belum ada unit yang dapat dibandingkan pada cakupan akses Anda.' },
  );

  const paretoCard = (title, p, color) => card(title,
    !p.rows.length ? emptyState() : h('div', {}, ...p.rows.map((r) => h('div', { style: 'margin-bottom:.5rem' },
      h('div.bar-row', { style: 'margin-bottom:.15rem' },
        h('span', { title: r.label, text: r.label }),
        h('div.bar-track', {}, h('div.bar-fill', { style: `width:${r.percent}%;background:${color}` })),
        h('strong', { text: String(r.value) })),
      h('div.small.muted', { text: `${dec(r.percent, 1)}% · kumulatif ${dec(r.cumulative, 1)}%` })))),
    h('p.small.muted', { style: 'margin-top:.4rem', text: `Total ${num(p.total)} rekaman.` }));

  const r = d.leadingLagging.correlation;
  const corrText = r === null
    ? 'Data belum cukup untuk menghitung hubungan antar deret (minimal tiga bulan berisi).'
    : r <= -0.5 ? `Korelasi ${fmtDecimal(r, 2)} — kuat dan berlawanan arah: bulan dengan pelaporan proaktif tinggi cenderung berinsiden rendah. Inilah pola yang diharapkan.`
      : r < -0.2 ? `Korelasi ${fmtDecimal(r, 2)} — berlawanan arah namun lemah.`
        : r < 0.2 ? `Korelasi ${fmtDecimal(r, 2)} — praktis tidak ada hubungan pada periode ini.`
          : `Korelasi ${fmtDecimal(r, 2)} — searah. Pelaporan yang naik bersamaan dengan insiden biasanya menandakan kesadaran melapor baru tumbuh setelah kejadian, bukan sebelum.`;

  return h('div', {},
    h('div.grid.cols-4', {},
      stat('Total Rekaman', num(c.totalRecords), { sub: `${num(c.activeModules)} modul terisi` }),
      stat('Rekaman 30 Hari Terakhir', num(c.recent30)),
      stat('Rasio Pelaporan Proaktif', `${dec(c.proactiveRatio, 1)}×`, {
        sub: 'laporan proaktif per satu insiden',
        tone: c.proactiveRatio >= 10 ? 'ok' : c.proactiveRatio >= 5 ? '' : 'warn',
      }),
      stat('Rekaman Tidak Bergerak', num(c.staleRecords), {
        sub: '> 30 hari masih di status awal',
        tone: c.staleRecords ? 'warn' : 'ok',
      }),
      stat('Tindakan Lewat Jatuh Tempo', num(c.overdueOpen), { tone: c.overdueOpen ? 'danger' : 'ok' }),
      stat('Rata-rata Penutupan CAPA', c.avgCapaClosure === null ? '—' : dec(c.avgCapaClosure, 1), { unit: 'hari' }),
      stat('Unit Dibandingkan', num(c.branchesCompared), { sub: 'cabang dalam cakupan akses Anda' })),

    card('Peringkat Kinerja QHSE Antar Cabang', orgTable(d.branches, 'Cabang'),
      h('p.small.muted', { style: 'margin-top:.5rem', text: 'Indeks 0–100 adalah pembanding antar unit, bukan nilai mutlak. Pelaporan proaktif menaikkan indeks — unit yang melaporkan banyak near miss sedang bekerja dengan benar, bukan sedang berkinerja buruk. Insiden, CAPA lewat jatuh tempo dan sertifikat kedaluwarsa menurunkannya.' })),

    card('Peringkat Kinerja QHSE Antar Pelabuhan', orgTable(d.ports, 'Pelabuhan')),

    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Indikator Proaktif (Leading) — Near Miss & Observasi', lineChart(d.leadingLagging.proactiveTrend, { color: PALETTE[1] })),
      card('Indikator Hasil (Lagging) — Insiden', lineChart(d.leadingLagging.incidentTrend, { color: PALETTE[4] }))),

    card('Hubungan Pelaporan Proaktif dengan Insiden',
      h('p', { text: corrText }),
      h('p.small.muted', { text: 'Korelasi bukan sebab-akibat. Angka ini menunjukkan pola yang layak ditanyakan pada rapat tinjauan, bukan kesimpulan yang bisa langsung dipakai.' })),

    card(`Perbandingan Tahun ${d.year} dengan ${d.previousYear}`,
      dataTable(
        [{ label: 'Metrik' }, { label: d.previousYear, right: true }, { label: d.year, right: true }, { label: 'Perubahan', right: true }],
        d.yearOverYear,
        (y) => [
          h('td.small', { text: y.label }),
          h('td.right', { text: num(y.previous) }),
          h('td.right', {}, h('strong', { text: num(y.current) })),
          h('td.right', {}, y.change === null
            ? h('span.small.muted', { text: '—' })
            : h('span.badge', { class: y.change > 0 ? 'b-warn' : y.change < 0 ? 'b-ok' : 'b-draft', text: `${y.change > 0 ? '+' : ''}${dec(y.change, 1)}%` })),
        ],
      ),
      h('p.small.muted', { style: 'margin-top:.5rem', text: 'Kenaikan tidak selalu buruk: naiknya near miss, inspeksi, audit dan pelatihan justru menandakan sistem berjalan. Yang perlu dibaca berpasangan adalah naiknya pelaporan proaktif berbarengan dengan turunnya insiden.' })),

    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      paretoCard('Pareto Jenis Insiden', d.pareto.incidentType, PALETTE[4]),
      paretoCard('Pareto Sumber Ketidaksesuaian', d.pareto.ncSource, PALETTE[2])),

    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      paretoCard('Pareto Kategori Keluhan Pelanggan', d.pareto.complaintCategory, PALETTE[3]),
      paretoCard('Pareto Bahaya Dominan (HIRA)', d.pareto.hazard, PALETTE[5])),

    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Kecepatan Penutupan Rekaman',
        barList(d.closure.map((x) => ({ label: x.name, value: x.days ?? 0 })), { format: (v) => `${dec(v, 1)} hari`, color: PALETTE[6] }),
        h('p.small.muted', { style: 'margin-top:.5rem', text: 'Rata-rata hari dari rekaman dibuat sampai ditutup, dihitung hanya atas rekaman yang benar-benar sudah tertutup.' })),
      card('Rekaman Tidak Bergerak per Modul',
        dataTable(
          [{ label: 'Modul' }, { label: 'Rekaman', right: true }],
          d.stale,
          (s) => [
            h('td.small', {}, `${s.icon} ${s.name}`),
            h('td.right', {}, h('span.badge.b-warn', { text: num(s.count) })),
          ],
          { onRow: (s) => { location.hash = `#/m/${s.module}`; }, empty: 'Tidak ada rekaman yang tertahan di status awal.' },
        ))),

    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('15 Modul dengan Rekaman Terbanyak', barList(d.volumeByModule, { limit: 15, format: num })),
      card('Sebaran Rekaman per Kelompok Modul', barList(d.volumeByGroup, { limit: 16, format: num, color: PALETTE[1] }))));
}

/* -------------------------------------------------- kompetensi & pelatihan */

const pct1 = (v) => (v === null || v === undefined ? '—' : `${dec(v, 1)}%`);

function training(d) {
  const c = d.cards;

  const gapTable = dataTable(
    [
      { label: 'Pegawai' }, { label: 'Jabatan' },
      { label: 'Wajib', right: true }, { label: 'Dimiliki', right: true }, { label: 'Gap', right: true },
      { label: 'Pemenuhan', right: true }, { label: 'Status' }, { label: 'Target Tutup' },
    ],
    d.topGaps,
    (g) => [
      h('td', { text: g.employee_name || '—' }),
      h('td.small', { text: g.position || '—' }),
      h('td.right', { text: num(g.required_training_count) }),
      h('td.right', { text: num(g.owned_training_count) }),
      h('td.right', {}, h('strong', { text: num(g.gap_count) })),
      h('td.right', { text: pct1(g.compliance_percent) }),
      badge(
        g.gap_status === 'Patuh Penuh' ? 'b-ok' : g.gap_status === 'Kritis' ? 'b-danger' : 'b-warn',
        g.gap_status,
      ),
      h('td.small.nowrap', { text: fmtDate(g.target_date) }),
    ],
    {
      onRow: (g) => { location.hash = `#/m/skill_gap/${g.id}`; },
      empty: 'Belum ada analisis kesenjangan kompetensi.',
    },
  );

  const certTable = dataTable(
    [{ label: 'Sertifikat' }, { label: 'Pemegang' }, { label: 'Jenis' }, { label: 'Penerbit' }, { label: 'Berlaku Sampai' }, { label: 'Sisa Hari', right: true }],
    d.expiringCertificates,
    (s) => [
      h('td.small', { text: s.certificate_name }),
      h('td.small', { text: s.employee_name || '—' }),
      h('td.small', { text: s.certificate_type || '—' }),
      h('td.small.muted', { text: s.issuer || '—' }),
      expiryCell(s.valid_until),
      h('td.right', {}, h('span.badge', {
        class: (s.days_to_expiry ?? 0) < 0 ? 'b-danger' : (s.days_to_expiry ?? 0) <= 30 ? 'b-warn' : 'b-progress',
        text: (s.days_to_expiry ?? 0) < 0 ? `Lewat ${Math.abs(s.days_to_expiry)} hari` : `${s.days_to_expiry} hari`,
      })),
    ],
    {
      onRow: (s) => { location.hash = `#/m/employee_certification/${s.id}`; },
      empty: 'Tidak ada sertifikat yang mendekati atau melewati masa berlaku.',
    },
  );

  const vendorTable = dataTable(
    [{ label: 'Lembaga Pelatihan' }, { label: 'Jenis' }, { label: 'Pelatihan', right: true }, { label: 'Peserta', right: true }, { label: 'Skor', right: true }, { label: 'Grade' }, { label: 'Akreditasi s.d.' }],
    d.vendors,
    (v) => [
      h('td.small', { text: v.name }),
      h('td.small.muted', { text: v.vendor_type || '—' }),
      h('td.right', { text: num(v.training_count) }),
      h('td.right', { text: num(v.participant_count) }),
      h('td.right', { text: dec(v.vendor_score, 1) }),
      h('td.small', { text: v.vendor_grade || '—' }),
      expiryCell(v.accreditation_expiry),
    ],
    {
      onRow: (v) => { location.hash = `#/m/training_vendor/${v.id}`; },
      empty: 'Belum ada vendor pelatihan yang dinilai.',
    },
  );

  // Nama cabang dan pelabuhan sudah memuat kata "Cabang"/"Pelabuhan", jadi
  // tingkatannya cukup jadi kolom tersendiri - bukan awalan yang mengulang.
  const complianceTable = dataTable(
    [
      { label: 'Tingkat' }, { label: 'Unit' },
      { label: 'Pegawai Dianalisis', right: true }, { label: 'Total Kesenjangan', right: true },
      { label: 'Kepatuhan', right: true },
    ],
    [
      ...d.complianceByBranch.map((r) => ({ ...r, scope: 'Cabang' })),
      ...d.complianceByPort.map((r) => ({ ...r, scope: 'Pelabuhan' })),
    ],
    (r) => [
      h('td.small.muted', { text: r.scope }),
      h('td', { text: r.label }),
      h('td.right', { text: num(r.employees) }),
      h('td.right', { text: num(r.gaps) }),
      h('td.right', {}, h('span.badge', {
        class: r.value >= 95 ? 'b-ok' : r.value >= 80 ? 'b-warn' : 'b-danger',
        text: pct1(r.value),
      })),
    ],
    { empty: 'Belum ada data kepatuhan per unit.' },
  );

  return h('div', {},
    h('div.grid.cols-4', {},
      stat('Katalog Pelatihan', num(c.catalogue), { sub: `${num(c.mandatoryCatalogue)} bersifat wajib` }),
      stat('Kepatuhan Pelatihan Wajib', pct1(c.mandatoryCompliance), {
        sub: `${num(c.gapEmployees)} pegawai belum lengkap`,
        tone: (c.mandatoryCompliance ?? 0) >= 95 ? 'ok' : (c.mandatoryCompliance ?? 0) >= 80 ? 'warn' : 'danger',
      }),
      stat('Kesenjangan Kompetensi', num(c.totalGaps), { sub: 'total pelatihan wajib belum dipenuhi', tone: c.totalGaps ? 'warn' : 'ok' }),
      stat('Sertifikat Kedaluwarsa', num(c.certificatesExpired), {
        sub: `${num(c.certificatesExpiring)} akan habis dalam 90 hari`,
        tone: c.certificatesExpired ? 'danger' : c.certificatesExpiring ? 'warn' : 'ok',
      }),
      stat('Pelatihan Tahun Ini', num(c.trainingsThisYear), { sub: `${num(c.participants)} peserta` }),
      stat('Rencana vs Realisasi', pct1(c.planAchievement), {
        sub: `${num(c.completedSchedules)} dari ${num(c.plannedSchedules)} jadwal terlaksana`,
        tone: (c.planAchievement ?? 0) >= 90 ? 'ok' : 'warn',
      }),
      stat('Jam Pelatihan per Pegawai', dec(c.hoursPerEmployee, 1), { unit: 'jam', sub: `${num(c.trainingHours)} jam keseluruhan` }),
      stat('Biaya Pelatihan', fmtCurrency(c.actualCost), { sub: `anggaran ${fmtCurrency(c.budget)}` }),
      stat('Tingkat Kehadiran', pct1(c.attendanceRate), { tone: (c.attendanceRate ?? 0) >= 90 ? 'ok' : 'warn' }),
      stat('Tingkat Kelulusan Ujian', pct1(c.examPassRate), { tone: (c.examPassRate ?? 0) >= 85 ? 'ok' : 'warn' }),
      stat('Penyelesaian Materi Daring', pct1(c.lmsCompletion), { sub: 'rata-rata seluruh materi LMS' }),
      stat('Penurunan Insiden Pasca Pelatihan', pct1(c.incidentReduction), {
        sub: 'Kirkpatrick level 4',
        tone: (c.incidentReduction ?? 0) > 0 ? 'ok' : 'warn',
      })),

    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Tren Pelaksanaan Pelatihan 12 Bulan', lineChart(d.deliveryTrend, { color: PALETTE[0] })),
      card('Tren Jam Pelatihan 12 Bulan', lineChart(d.hoursTrend, { color: PALETTE[1], format: (v) => fmtNumber(v) }))),

    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Katalog per Kategori', barList(d.byCategory, { format: num })),
      card('Sifat Pelatihan', donut(d.byMandatory, { format: num })),
      card('Metode Penyelenggaraan', barList(d.byMethod, { format: num, color: PALETTE[6] }))),

    card('Kesenjangan Kompetensi Tertinggi', gapTable,
      h('p.small.muted', { style: 'margin-top:.5rem', text: 'Selisih antara pelatihan wajib menurut matriks jabatan dan pelatihan yang dimiliki serta masih berlaku.' })),

    card('Kepatuhan Pelatihan Wajib per Cabang & Pelabuhan', complianceTable),

    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Tingkat Kompetensi Rata-rata per Divisi',
        barList(d.competencyByDivision, { format: (v) => `${dec(v, 2)} / 5` }),
        h('p.small.muted', { style: 'margin-top:.5rem', text: 'Skala 1 Beginner sampai 5 Expert, dihitung dari matriks kompetensi pegawai.' })),
      card('Status Kompetensi Pegawai', donut(d.competencyGapStatus, { format: num })),
      card('Jenis Kompetensi Dinilai', barList(d.competencyByType, { format: num, color: PALETTE[3] }))),

    card('Sertifikat Kedaluwarsa & Mendekati Jatuh Tempo', certTable,
      h('p.small.muted', { style: 'margin-top:.5rem', text: 'Peringatan otomatis dikirim 30, 14 dan 7 hari sebelum masa berlaku berakhir serta pada hari-H.' })),

    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Status Sertifikat', donut(d.certByStatus, { format: num })),
      card('Jenis Sertifikat', barList(d.certByType, { format: num, color: PALETTE[2] })),
      card('Status Pendaftaran Peserta', barList(d.registrationByStatus, { format: num, color: PALETTE[1] }))),

    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Kehadiran Peserta', donut(d.attendanceByStatus, { format: num })),
      card('Metode Pencatatan Kehadiran', barList(d.attendanceByMethod, { format: num, color: PALETTE[6] })),
      card('Status Jadwal Pelatihan', barList(d.scheduleByStatus, { format: num, color: PALETTE[3] }))),

    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Efektivitas Pelatihan (Level 3-4)',
        donut(d.effectiveness, { format: num }),
        h('p.small.muted', { style: 'margin-top:.5rem', text: `Kepuasan peserta ${pct1(c.satisfaction)} · kenaikan pengetahuan ${pct1(c.knowledgeGain)}.` })),
      card('Penerapan di Tempat Kerja', barList(d.behaviour, { format: num, color: PALETTE[5] })),
      card('Sumber Kebutuhan Pelatihan', barList(d.requestBySource, { format: num, color: PALETTE[2] }))),

    card('Kinerja Lembaga Pelatihan', vendorTable));
}

/* --------------------------------------------- langganan (khusus platform) */

const STATUS_TONE = {
  active: 'b-ok', trial: 'b-warn', past_due: 'b-danger',
  suspended: 'b-danger', ended: 'b-draft',
};
const STATUS_LABEL = {
  active: 'Aktif', trial: 'Uji Coba', past_due: 'Menunggak',
  suspended: 'Ditangguhkan', ended: 'Berhenti',
};

/**
 * Tabel data sederhana.
 * headers: [{label, right}], rows: array data, cells: (row) => [Node|string]
 */
function dataTable(headers, rows, cells, { onRow, empty = 'Belum ada data.' } = {}) {
  if (!rows?.length) return emptyState(empty);
  const head = h('tr', {}, ...headers.map((c) => h(c.right ? 'th.right' : 'th', { text: c.label })));
  const body = rows.map((row) => {
    const tr = h(onRow ? 'tr.clickable' : 'tr', onRow ? { onclick: () => onRow(row) } : {});
    for (const cell of cells(row)) {
      tr.appendChild(cell instanceof Node ? cell : h('td', { text: cell === null || cell === undefined ? '—' : String(cell) }));
    }
    return tr;
  });
  return h('div.table-wrap', {}, h('table', {}, h('thead', {}, head), h('tbody', {}, ...body)));
}

const badge = (tone, text) => h('td', {}, h('span.badge', { class: tone, text: text || '—' }));

function subscription(d) {
  const c = d.cards;

  const tenantTable = dataTable(
    [
      { label: 'Cabang' }, { label: 'Paket' }, { label: 'Status' },
      { label: 'Biaya/bulan', right: true }, { label: 'Pengguna', right: true },
      { label: 'Utilisasi', right: true }, { label: 'Tagihan Berikutnya' },
      { label: 'Kesehatan Akun' }, { label: 'NPS', right: true },
    ],
    d.tenants,
    (t) => [
      h('td', { text: t.branch || '—' }),
      h('td.small', { text: t.plan || '—' }),
      badge(STATUS_TONE[t.status] || 'b-draft', STATUS_LABEL[t.status] || t.status),
      h('td.right', { text: fmtCurrency(t.fee) }),
      h('td.right', { text: `${num(t.activeUsers)} / ${t.seats ? num(t.seats) : '∞'}` }),
      h('td.right', { text: t.utilisation ? `${dec(t.utilisation, 0)}%` : '—' }),
      h('td.small', { text: fmtDate(t.nextBilling) }),
      badge(t.health === 'Sehat' ? 'b-ok' : t.health === 'Berisiko Churn' ? 'b-danger' : 'b-warn', t.health),
      h('td.right', { text: t.nps ?? '—' }),
    ],
    { onRow: (t) => { location.hash = `#/m/subscription/${t.id}`; }, empty: 'Belum ada langganan tercatat.' },
  );

  const adoptionTable = dataTable(
    [{ label: 'Cabang' }, { label: 'Periode' }, { label: 'Pengguna Aktif', right: true }, { label: 'Skor Adopsi', right: true }, { label: 'Status' }],
    (d.adoption || []).slice(0, 12),
    (a) => [
      h('td.small', { text: a.branch_name || '—' }),
      h('td.small', { text: a.period }),
      h('td.right', { text: num(a.active_users) }),
      h('td.right', { text: a.adoption_score ? `${dec(a.adoption_score, 0)}%` : '—' }),
      badge(a.adoption_status === 'Sangat Baik' ? 'b-ok' : a.adoption_status === 'Rendah' ? 'b-danger' : 'b-warn', a.adoption_status),
    ],
  );

  const leadTable = dataTable(
    [{ label: 'Cabang / Unit' }, { label: 'Kontak' }, { label: 'Paket Diminati' }, { label: 'Status' }],
    (d.leads || []).slice(0, 12),
    (l) => [
      h('td.small', { text: l.organisation }),
      h('td.small', { text: l.contact_name }),
      h('td.small', { text: l.plan_interest || '—' }),
      badge(l.status === 'converted' ? 'b-ok' : l.status === 'lost' ? 'b-danger' : 'b-progress', l.status),
    ],
    { onRow: (l) => { location.hash = `#/m/trial_request/${l.id}`; }, empty: 'Belum ada permintaan uji coba.' },
  );

  return h('div', {},
    h('div.grid.cols-4', {},
      stat('MRR', fmtCurrency(c.mrr), { sub: 'pendapatan berulang bulanan', tone: 'ok' }),
      stat('ARR', fmtCurrency(c.arr), { sub: 'proyeksi tahunan' }),
      stat('Cabang Berlangganan', num(c.activeTenants), { sub: `${num(c.trialTenants)} dalam uji coba` }),
      stat('ARPA', fmtCurrency(c.arpa), { sub: 'rata-rata per cabang' }),
      stat('Pipeline Uji Coba', fmtCurrency(c.trialPipeline), { sub: 'potensi bila seluruhnya berlanjut' }),
      stat('Tagihan Terkumpul', fmtCurrency(c.collected), { sub: '12 bulan terakhir', tone: 'ok' }),
      stat('Piutang Berjalan', fmtCurrency(c.outstanding), { sub: `${num(c.overdueCount)} tagihan lewat jatuh tempo`, tone: c.overdueCount ? 'warn' : 'ok' }),
      stat('Churn', `${dec(c.churnRate, 1)}%`, { sub: `${num(c.churnedTenants)} cabang berhenti`, tone: c.churnedTenants ? 'warn' : 'ok' })),

    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Pendapatan Tertagih per Bulan', lineChart(d.revenueByMonth, { color: PALETTE[6], format: (v) => fmtCurrency(v) })),
      card('Umur Piutang', barList(d.aging, { format: (v) => fmtCurrency(v), color: PALETTE[2] }))),

    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card('Cabang per Paket', donut(d.byPlan, { format: num })),
      card('Status Langganan', barList(d.byStatus, { format: num, color: PALETTE[1] })),
      card('Corong Prospek', barList(d.leadFunnel, { format: num, color: PALETTE[3] }))),

    card('Portofolio Cabang', tenantTable),

    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card('Adopsi Pemakaian per Cabang', adoptionTable),
      card('Permintaan Uji Coba Terbaru', leadTable)));
}
