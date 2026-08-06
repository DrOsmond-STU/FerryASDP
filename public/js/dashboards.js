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
    stat('Pelatihan & Latihan Darurat', `${num(c.trainings)} / ${num(c.drills)}`, { sub: 'pelatihan · drill' })));

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
