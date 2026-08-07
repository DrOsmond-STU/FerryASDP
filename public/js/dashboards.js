/** Dashboard views. Each one is a pure function of its API payload. */
import { api, can } from './api.js';
import { h, mount, stat, spinner, emptyState, fmtNumber, fmtDecimal, fmtCurrency, fmtDate, statusBadge, riskPill } from './ui.js';
import { lineChart, barList, donut, riskHeatmap, targetBars, PALETTE } from './charts.js';
import { t, tp, lang } from './i18n.js';

export const DASHBOARDS = [
  { key: 'executive', name: 'Dashboard Eksekutif', icon: '📊', path: '/api/dashboard/executive', render: executive },
  { key: 'incident', name: 'Dashboard Insiden', icon: '🚨', path: '/api/dashboard/incident', render: incident, requires: 'incident' },
  { key: 'risk', name: 'Dashboard Risiko', icon: '⚠', path: '/api/dashboard/risk', render: risk, requires: 'risk_register' },
  { key: 'audit', name: 'Dashboard Audit', icon: '🔎', path: '/api/dashboard/audit', render: audit, requires: 'internal_audit' },
  { key: 'quality', name: 'Dashboard Mutu', icon: '🎯', path: '/api/dashboard/quality', render: quality, requires: 'quality_objective' },
  { key: 'health', name: 'Dashboard Kesehatan Kerja', icon: '🩺', path: '/api/dashboard/health', render: health, requires: 'mcu' },
  { key: 'carbon', name: 'Dashboard Jejak Karbon', icon: '🌍', path: '/api/dashboard/carbon', render: carbon, requires: 'fuel_consumption' },
  { key: 'esg', name: 'Dashboard ESG', icon: '🌱', path: '/api/dashboard/esg', render: esg, requires: 'esg' },
  { key: 'vessel', name: 'Dashboard Kapal', icon: '🚢', path: '/api/dashboard/vessel', render: vessel, requires: 'vessel' },
  { key: 'port', name: 'Dashboard Pelabuhan', icon: '⚓', path: '/api/dashboard/port', render: port, requires: 'port' },
  { key: 'contractor', name: 'Dashboard Kontraktor', icon: '🤝', path: '/api/dashboard/contractor', render: contractor, requires: 'contractor' },
  { key: 'asset', name: 'Dashboard Aset', icon: '🛠', path: '/api/dashboard/asset', render: asset, requires: 'asset' },
  { key: 'training', name: 'Pelatihan & Kompetensi', icon: '🎓', path: '/api/dashboard/training', render: training, requires: 'training_master' },
  { key: 'bsc', name: 'Balanced Scorecard', icon: '🧭', path: '/api/dashboard/bsc', render: bsc, requires: 'quality_objective' },
  { key: 'analytics', name: 'Dashboard Analitik', icon: '🔬', path: '/api/dashboard/analytics', render: analytics },
  { key: 'subscription', name: 'Langganan & Pendapatan', icon: '💳', path: '/api/dashboard/subscription', render: subscription, platformOnly: true },
];

export async function renderDashboard(container, def) {
  mount(container, spinner(t('Menghitung indikator…')));
  const data = await api.get(def.path);
  mount(container,
    h('div.page-head', {},
      h('div.grow', {},
        h('h1', {}, h('span', { text: def.icon }), t(def.name)),
        h('div.small.muted', {
          text: `${t('Periode analisis')} ${data.year || new Date().getFullYear()} · ${t('angka mengikuti cakupan akses Anda.')}`,
        }))),
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
    stat(t('Insiden Tahun Berjalan'), num(c.incidents), { sub: tp('{lti} lost time · {fatality} fatality', { lti: num(c.lti), fatality: num(c.fatality) }), tone: c.fatality ? 'danger' : c.lti ? 'warn' : 'ok' }),
    stat(t('LTIFR'), dec(c.ltifr, 2), { sub: t('per 1 juta jam kerja'), tone: (c.ltifr ?? 0) > 1 ? 'warn' : 'ok' }),
    stat(t('TRIR'), dec(c.trir, 2), { sub: tp('{n} jam kerja tercatat', { n: num(c.manhours) }) }),
    stat(t('Near Miss & Unsafe'), num((c.nearMiss || 0) + (c.unsafeFindings || 0)), { sub: tp('{nm} near miss · {temuan} temuan', { nm: num(c.nearMiss), temuan: num(c.unsafeFindings) }), tone: 'ok' }),
    stat(t('CAPA Terbuka'), num(c.openCapa), { sub: tp('{n} melewati target', { n: num(c.overdueCapa) }), tone: c.overdueCapa ? 'warn' : '' }),
    stat(t('Risiko Tinggi/Ekstrem'), num(c.highRisks), { tone: c.highRisks ? 'warn' : 'ok' }),
    stat(t('Kepatuhan Regulasi'), c.complianceRate === null ? '—' : `${dec(c.complianceRate, 1)}%`, { sub: t('daftar peraturan dievaluasi'), tone: (c.complianceRate ?? 100) >= 95 ? 'ok' : 'warn' }),
    stat(t('Emisi GRK'), dec(c.carbonTon, 1), { unit: 't CO₂e', sub: t('Scope 1 & 2 tahun berjalan') }),
    stat(t('Insiden Pelayaran'), num(c.marineIncidents), { tone: c.marineIncidents ? 'warn' : 'ok' }),
    stat(t('Audit Internal'), num(c.internalAudits), { sub: tp('{n} ketidaksesuaian mayor', { n: num(c.majorNc) }) }),
    stat(t('Keluhan Pelanggan'), num(c.complaints)),
    stat(t('Pelatihan & Latihan Darurat'), `${num(c.trainings)} / ${num(c.drills)}`, { sub: t('pelatihan · drill') }),
    stat(t('Kepatuhan Pelatihan Wajib'), c.trainingCompliance === null ? '—' : `${dec(c.trainingCompliance, 1)}%`, {
      sub: t('pemenuhan matriks kompetensi'),
      tone: (c.trainingCompliance ?? 100) >= 95 ? 'ok' : 'warn',
    }),
    stat(t('Sertifikat Kompetensi Kedaluwarsa'), num(c.expiredCertificates), { tone: c.expiredCertificates ? 'danger' : 'ok' })));

  wrap.appendChild(h('div.grid.cols-2', { style: 'margin-top:1rem' },
    card(t('Tren Insiden 12 Bulan'), lineChart(d.incidentTrend, { color: PALETTE[4] })),
    card(t('Tren Near Miss 12 Bulan'), lineChart(d.nearMissTrend, { color: PALETTE[1] }))));

  wrap.appendChild(h('div.grid.cols-3', { style: 'margin-top:1rem' },
    card(t('Klasifikasi Insiden'), barList(d.incidentByClassification, { format: num, color: PALETTE[4] })),
    card(t('Jenis Insiden Terbanyak'), barList(d.incidentByType, { format: num })),
    card(t('Status CAPA'), donut(d.capaByStatus?.map((r) => ({ label: r.label, value: r.value })) || [], { format: num }))));

  wrap.appendChild(h('div.grid.cols-2', { style: 'margin-top:1rem' },
    card(t('Peta Panas Risiko Korporat (ISO 31000)'), riskHeatmap(d.riskHeatmap)),
    card(t('Emisi Karbon per Cakupan'), donut(d.carbon?.byScope || [], { format: (v) => `${dec(v, 1)} t` }))));

  wrap.appendChild(h('div', { style: 'margin-top:1rem' }, alertsCard(d.alerts)));
  return wrap;
}

function alertsCard(alerts) {
  if (!alerts?.length) return card(t('⏰ Peringatan Kedaluwarsa'), h('p.muted.small', { text: t('Tidak ada dokumen, sertifikat atau tindakan yang mendekati jatuh tempo.') }));
  return card(t('⏰ Peringatan Kedaluwarsa & Jatuh Tempo'),
    h('div.table-wrap', {}, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { text: t('Modul') }), h('th', { text: t('Rekaman') }), h('th', { text: t('Item') }),
        h('th', { text: t('Tanggal') }), h('th', { text: t('Sisa Hari') }))),
      h('tbody', {}, ...alerts.map((a) => h('tr.clickable', { onclick: () => { location.hash = `#/m/${a.module}/${a.id}`; } },
        h('td.small', {}, `${a.icon} ${a.moduleName}`),
        h('td.small', {}, h('span.mono', { text: a.code }), ' ', a.label || ''),
        h('td.small', { text: a.field }),
        h('td.small.nowrap', { text: fmtDate(a.date) }),
        h('td', {}, h('span.badge', { class: a.severity === 'overdue' ? 'b-danger' : 'b-warn', text: a.severity === 'overdue' ? tp('Lewat {n} hari', { n: Math.abs(a.daysLeft) }) : tp('{n} hari', { n: a.daysLeft }) }))))))));
}

/* --------------------------------------------------------------- incident */

function incident(d) {
  const r = d.rates;
  return h('div', {},
    h('div.grid.cols-4', {},
      stat(t('Fatality'), num(r.fatality), { tone: r.fatality ? 'danger' : 'ok' }),
      stat(t('Lost Time Injury'), num(r.lti), { tone: r.lti ? 'warn' : 'ok' }),
      stat(t('Medical Treatment'), num(r.mtc)),
      stat(t('First Aid Case'), num(r.fac)),
      stat(t('LTIFR'), dec(r.ltifr, 2), { sub: t('per 1 juta jam kerja') }),
      stat(t('TRIR'), dec(r.trir, 2)),
      stat(t('Severity Rate'), dec(r.severityRate, 2), { sub: tp('{n} hari kerja hilang', { n: num(r.lostDays) }) }),
      stat(t('Jam Kerja'), num(r.manhours))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Tren Insiden'), lineChart(d.trend, { color: PALETTE[4] })),
      card(t('Hari Kerja Hilang'), lineChart(d.lostDaysTrend, { color: PALETTE[2] }))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Klasifikasi'), donut(d.byClassification, { format: num })),
      card(t('Jenis Insiden'), barList(d.byType, { format: num })),
      card(t('Lokasi Kejadian'), barList(d.byLocation, { format: num, color: PALETTE[1] }))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Kategori Korban'), barList(d.byVictim, { format: num, color: PALETTE[3] })),
      card(t('Tindakan Tidak Aman'), barList(d.unsafeActionByCategory, { format: num, color: PALETTE[2] })),
      card(t('Kondisi Tidak Aman'), barList(d.unsafeConditionByCategory, { format: num, color: PALETTE[5] }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Piramida Pelaporan Keselamatan'),
        barList([
          { label: t('Insiden'), value: d.reportingRatio.incidents },
          { label: t('Near miss'), value: d.reportingRatio.nearMiss },
          { label: t('Tindakan/kondisi tidak aman'), value: d.reportingRatio.unsafe },
        ], { format: num }),
        h('p.small.muted', { style: 'margin-top:.5rem', text: t('Rasio pelaporan proaktif yang sehat menunjukkan dasar piramida jauh lebih besar dari puncaknya.') })),
      card(t('Tren Observasi & Toolbox Meeting'),
        lineChart(d.observationTrend, { color: PALETTE[1] }),
        lineChart(d.toolboxTrend, { color: PALETTE[6] }))));
}

/* ------------------------------------------------------------------- risk */

function risk(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      ...d.byModule.map((m) => stat(m.name, num(m.total), { sub: tp('{n} tinggi/ekstrem', { n: num(m.high) }), tone: m.high ? 'warn' : '' }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Peta Panas Risiko (Register Risiko)'), riskHeatmap(d.heatmap)),
      card(t('Peta Panas Bahaya Kerja (HIRA)'), riskHeatmap(d.hiraHeatmap))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Kategori Risiko'), barList(d.byCategory, { format: num })),
      card(t('Tingkat Risiko Awal'), donut(d.byLevel, { format: num })),
      card(t('Tingkat Risiko Residual'), donut(d.residualByLevel, { format: num }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Bahaya Dominan pada HIRA'), barList(d.hiraByHazard, { format: num, color: PALETTE[2] })),
      card(t('Status Perlakuan Risiko'),
        barList(d.treatmentByStatus, { format: num, color: PALETTE[1] }),
        h('p.small.muted', { style: 'margin-top:.5rem', text: tp('{n} risiko melebihi selera risiko perusahaan.', { n: num(d.appetiteBreaches) }) }))),
    card(t('10 Risiko Tertinggi'),
      d.topRisks?.length
        ? h('div.table-wrap', {}, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { text: t('Kode') }), h('th', { text: t('Risiko') }), h('th', { text: t('Kategori') }), h('th', { text: t('Nilai') }), h('th', { text: t('Tingkat') }), h('th', { text: t('Residual') }))),
          h('tbody', {}, ...d.topRisks.map((r) => h('tr.clickable', { onclick: () => { location.hash = `#/m/risk_register/${r.id}`; } },
            h('td.mono', { text: r.code }), h('td', { text: r.title }), h('td.small', { text: r.risk_category || '—' }),
            h('td', { text: num(r.risk_score) }), h('td', {}, riskPill(r.risk_level)), h('td', {}, riskPill(r.res_risk_level)))))))
        : emptyState()));
}

/* ------------------------------------------------------------------ audit */

function audit(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      stat(t('Audit Internal Terlaksana'), `${num(d.internal.executed)} / ${num(d.internal.planned)}`, { sub: t('realisasi terhadap program') }),
      stat(t('Ketidaksesuaian Mayor'), num(d.internal.majorNc + d.external.majorNc), { tone: (d.internal.majorNc + d.external.majorNc) ? 'warn' : 'ok' }),
      stat(t('Ketidaksesuaian Minor'), num(d.internal.minorNc + d.external.minorNc)),
      stat(t('Audit Eksternal'), num(d.external.total)),
      stat(t('CAPA Terlambat'), num(d.capaOverdue), { tone: d.capaOverdue ? 'danger' : 'ok' }),
      stat(t('Rata-rata Progres CAPA'), `${dec(d.capaAvgProgress, 0)}%`),
      stat(t('Observasi Audit'), num(d.internal.observations)),
      stat(t('Tinjauan Manajemen'), num(d.managementReviews))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Tren Inspeksi'), lineChart(d.inspectionTrend, { color: PALETTE[1] })),
      card(t('Jenis Inspeksi'), barList(d.inspectionByType, { format: num }))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Ketidaksesuaian per Kategori'), donut(d.ncByCategory, { format: num })),
      card(t('Sumber Ketidaksesuaian'), barList(d.ncBySource, { format: num, color: PALETTE[2] })),
      card(t('Status CAPA'), barList(d.capaByStatus, { format: num, color: PALETTE[1] }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Audit Eksternal per Jenis'), barList(d.external.byType, { format: num, color: PALETTE[3] })),
      card(t('Status Kepatuhan Peraturan'), donut(d.complianceByStatus, { format: num }))));
}

/* ---------------------------------------------------------------- quality */

function quality(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      stat(t('Indikator Mutu'), num(d.kpis.length)),
      stat(t('Keluhan Pelanggan'), num(d.complaintTrend.reduce((a, r) => a + r.value, 0))),
      stat(t('Dokumen Terbit'), num(d.documents.published), { sub: tp('{n} jatuh tempo tinjauan', { n: num(d.documents.dueReview) }), tone: d.documents.dueReview ? 'warn' : 'ok' }),
      stat(t('Penghematan Perbaikan'), fmtCurrency(d.improvement.saving), { sub: tp('{n} inisiatif', { n: num(d.improvement.total) }) })),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Pencapaian Sasaran Mutu & KPI'), targetBars(d.kpis)),
      card(t('Status Pencapaian KPI'), donut(d.kpiByStatus, { format: num }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Tren Keluhan Pelanggan'), lineChart(d.complaintTrend, { color: PALETTE[2] })),
      card(t('Tren Ketidaksesuaian'), lineChart(d.ncTrend, { color: PALETTE[4] }))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Kategori Keluhan'), barList(d.complaintByCategory, { format: num })),
      card(t('Kanal Keluhan'), barList(d.complaintByChannel, { format: num, color: PALETTE[1] })),
      card(t('Kepuasan atas Penyelesaian'), donut(d.satisfaction, { format: num }))));
}

/* ----------------------------------------------------------------- health */

function health(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      stat(t('MCU Terlaksana'), num(d.mcu.total), { sub: tp('{n} perlu tindak lanjut', { n: num(d.mcu.followUp) }) }),
      stat(t('Kelelahan Berisiko Tinggi'), num(d.fatigue.highRisk), { tone: d.fatigue.highRisk ? 'warn' : 'ok' }),
      stat(t('Jam Istirahat Tidak Memenuhi'), num(d.fatigue.nonCompliantRest), { sub: t('acuan STCW 10 jam/24 jam'), tone: d.fatigue.nonCompliantRest ? 'warn' : 'ok' }),
      stat(t('Penyakit Akibat Kerja'), num(d.occupationalDisease.total), { tone: d.occupationalDisease.total ? 'warn' : 'ok' }),
      stat(t('Kunjungan Klinik'), num(d.clinic.visits), { sub: tp('{n} terkait pekerjaan', { n: num(d.clinic.workRelated) }) }),
      stat(t('Program Promosi Kesehatan'), num(d.campaigns))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Tren MCU'), lineChart(d.mcu.trend, { color: PALETTE[1] })),
      card(t('Tren Kunjungan Klinik'), lineChart(d.clinic.trend, { color: PALETTE[2] }))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Hasil MCU'), donut(d.mcu.byResult, { format: num })),
      card(t('Status Risiko Kelelahan'), donut(d.fatigue.byRisk, { format: num })),
      card(t('Kategori Penyakit Akibat Kerja'), barList(d.occupationalDisease.byCategory, { format: num, color: PALETTE[4] }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Kategori Pasien Klinik'), barList(d.clinic.byPatientType, { format: num })),
      card(t('Cakupan Vaksinasi'), barList(d.vaccination, { format: num, color: PALETTE[6] }))));
}

/* ----------------------------------------------------------------- carbon */

function carbon(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      stat(t('Total Emisi'), dec(d.total, 1), { unit: 't CO₂e', sub: t('Scope 1 & 2 tahun berjalan') }),
      ...d.byScope.map((s) => stat(s.label, dec(s.value, 1), { unit: 't CO₂e' })),
      stat(t('Penghematan Energi'), fmtCurrency(d.energyPrograms.saving), { sub: tp('{n} program efisiensi', { n: num(d.energyPrograms.total) }) }),
      stat(t('Emisi Dihindari'), dec(d.energyPrograms.co2Avoided, 2), { unit: 't CO₂e', tone: 'ok' })),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Tren Emisi Bulanan (t CO₂e)'), lineChart(d.trend, { color: PALETTE[4] })),
      card(t('Emisi per Sumber'), barList(d.bySource, { format: (v) => `${dec(v, 1)} t`, color: PALETTE[2] }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Konsumsi Solar (liter)'), lineChart(d.fuelTrend, { color: PALETTE[3], format: (v) => fmtNumber(v) })),
      card(t('Konsumsi Listrik (kWh)'), lineChart(d.electricityTrend, { color: PALETTE[1], format: (v) => fmtNumber(v) }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Emisi per Pengguna Energi'), donut(d.byConsumer, { format: num })),
      card(t('Faktor Emisi yang Digunakan'),
        h('div.table-wrap', {}, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { text: t('Jenis Energi') }), h('th', { text: t('Faktor') }), h('th', { text: t('Satuan') }), h('th', { text: t('Sumber') }))),
          h('tbody', {}, ...d.factors.map((f) => h('tr', {},
            h('td.small', { text: f.type }), h('td.small', { text: String(f.factor) }),
            h('td.small', { text: `kg CO₂e/${t(f.unit)}` }), h('td.small.muted', { text: f.source })))))))));
}

/* -------------------------------------------------------------------- ESG */

function esg(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      ...d.byPillar.map((p) => stat(p.label, `${dec(p.value, 1)}%`, { sub: tp('{n} indikator', { n: num(p.count) }), tone: p.value >= 100 ? 'ok' : p.value >= 90 ? '' : 'warn' })),
      stat(t('Emisi GRK'), dec(d.carbon.total, 1), { unit: 't CO₂e' })),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Pencapaian Indikator ESG'), targetBars(d.indicators)),
      card(t('Kinerja Lingkungan'),
        h('div.grid.cols-2', {},
          stat(t('Limbah Non-B3'), dec(d.waste.nonB3 / 1000, 2), { unit: t('ton') }),
          stat(t('Limbah Didaur Ulang'), dec(d.waste.recycled / 1000, 2), { unit: t('ton'), tone: 'ok' }),
          stat(t('Limbah B3'), dec(d.waste.b3, 1), { unit: t('kg/liter') }),
          stat(t('Tumpahan'), num(d.spills.count), { sub: tp('{volume} liter, pulih {pulih} liter', { volume: dec(d.spills.volume, 0), pulih: dec(d.spills.recovered, 0) }), tone: d.spills.count ? 'warn' : 'ok' })))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Kinerja Sosial'),
        h('div.grid.cols-2', {},
          stat(t('Jam Pelatihan'), num(d.social.trainingHours)),
          stat(t('Peserta Pelatihan'), num(d.social.trainingParticipants)),
          stat(t('MCU'), num(d.social.mcu)),
          stat(t('Keluhan Pelanggan'), num(d.social.complaints)))),
      card(t('Tata Kelola'),
        barList(d.governance.compliance, { format: num }),
        h('p.small.muted', { style: 'margin-top:.5rem', text: tp('{kejadian} kejadian keamanan informasi · {kontraktor} kontraktor dievaluasi', { kejadian: num(d.governance.securityEvents), kontraktor: num(d.governance.contractorEvaluated) }) })),
      card(t('Kepatuhan Baku Mutu Lingkungan'),
        h('div.small.muted', { text: t('Emisi udara') }), barList(d.environmentCompliance.emission, { format: num, color: PALETTE[2] }),
        h('div.small.muted', { style: 'margin-top:.6rem', text: t('Air limbah & air laut') }), barList(d.environmentCompliance.water, { format: num, color: PALETTE[1] }))),
    card(t('Catatan Pelaporan'),
      h('p.small.muted', { text: t('Indikator mengikuti GRI Standards dan dilaporkan dalam Laporan Keberlanjutan sesuai POJK No. 51/POJK.03/2017 serta SEOJK No. 16/SEOJK.04/2021.') })));
}

/* ----------------------------------------------------------------- vessel */

function vessel(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      stat(t('Armada'), num(d.fleet.length)),
      stat(t('Checklist Pra-Berlayar'), num(d.checklist.total), { sub: tp('{n} ditunda/dibatalkan', { n: num(d.checklist.delayed) }), tone: d.checklist.delayed ? 'warn' : 'ok' }),
      stat(t('Inspeksi Kapal'), num(d.inspections.total), { sub: tp('{n} tidak laik laut', { n: num(d.inspections.notSeaworthy) }), tone: d.inspections.notSeaworthy ? 'danger' : 'ok' }),
      stat(t('Insiden Pelayaran'), num(d.marineIncidents.total), { tone: d.marineIncidents.total ? 'warn' : 'ok' }),
      stat(t('SPB Diterbitkan'), num(d.clearance.issued), { sub: tp('{n} ditahan/ditunda', { n: num(d.clearance.held) }) }),
      stat(t('Stabilitas Tidak Memenuhi'), num(d.stability.nonCompliant), { sub: tp('{n} perhitungan GM', { n: num(d.stability.records) }), tone: d.stability.nonCompliant ? 'warn' : 'ok' }),
      stat(t('Kendaraan Over Dimension'), num(d.loading.overDimension), { sub: tp('{n} pengangkutan barang berbahaya', { n: num(d.loading.dgShipments) }) }),
      stat(t('Penumpang Melebihi Kapasitas'), num(d.passenger.overCapacity), { sub: tp('{n} pemeriksaan', { n: num(d.passenger.records) }), tone: d.passenger.overCapacity ? 'danger' : 'ok' })),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Tren Checklist Pra-Berlayar'), lineChart(d.checklist.trend, { color: PALETTE[1] })),
      card(t('Tren Insiden Pelayaran'), lineChart(d.marineIncidents.trend, { color: PALETTE[4] }))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Keputusan Keberangkatan'), donut(d.checklist.byDecision, { format: num })),
      card(t('Jenis Insiden Pelayaran'), barList(d.marineIncidents.byType, { format: num, color: PALETTE[4] })),
      card(t('Tingkat Keparahan'), barList(d.marineIncidents.bySeverity, { format: num, color: PALETTE[2] }))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Hasil Inspeksi Ramp Door'), barList(d.inspections.rampDoor, { format: num })),
      card(t('Hasil Inspeksi LSA'), barList(d.inspections.lsa, { format: num, color: PALETTE[1] })),
      card(t('Hasil Inspeksi FFA'), barList(d.inspections.ffa, { format: num, color: PALETTE[2] }))),
    card(t('Status Armada & Sertifikat'),
      h('div.table-wrap', {}, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { text: t('Kapal') }), h('th', { text: t('Tipe') }), h('th', { text: t('Lintasan') }), h('th', { text: 'GT' }),
          h('th', { text: t('Status') }), h('th', { text: 'SMC' }), h('th', { text: 'ISSC' }), h('th', { text: t('Sert. Keselamatan') }), h('th', { text: t('Survey Klas') }), h('th', { text: t('Docking') }))),
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
      stat(t('Pelabuhan Dikelola'), num(d.ports.length)),
      stat(t('Patroli Keselamatan'), num(d.patrol.total), { sub: tp('{n} temuan', { n: num(d.patrol.findings) }) }),
      stat(t('Kesesuaian Patroli'), `${dec(d.patrol.avgConformity, 1)}%`, { tone: d.patrol.avgConformity >= 90 ? 'ok' : 'warn' }),
      stat(t('Inspeksi Fasilitas'), num(d.facility.inspections), { sub: tp('{n} temuan kritis', { n: num(d.facility.criticalFindings) }), tone: d.facility.criticalFindings ? 'warn' : 'ok' }),
      stat(t('Kesesuaian Fasilitas'), `${dec(d.facility.avgConformity, 1)}%`),
      stat(t('Kejadian Keamanan (ISPS)'), num(d.security.events)),
      stat(t('Latihan Tanggap Darurat'), num(d.emergency.drills), { sub: tp('{n} kejadian nyata', { n: num(d.emergency.realEvents) }) }),
      stat(t('Temuan Kebersihan'), num(d.environment.housekeepingFindings))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Tren Patroli Keselamatan'), lineChart(d.patrol.trend, { color: PALETTE[1] })),
      card(t('Tren Penumpang (Manajemen Kepadatan)'), lineChart(d.crowd.passengerTrend, { color: PALETTE[0], format: (v) => fmtNumber(v) }))),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Tingkat Kepadatan'), donut(d.crowd.byCongestion, { format: num })),
      card(t('Kategori Kejadian Keamanan'), barList(d.security.byCategory, { format: num, color: PALETTE[4] })),
      card(t('Skenario Tanggap Darurat'), barList(d.emergency.byScenario, { format: num, color: PALETTE[2] }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Timbulan Limbah Non-B3 (kg)'), lineChart(d.environment.wasteTrend, { color: PALETTE[6], format: (v) => fmtNumber(v) })),
      card(t('Timbulan Limbah B3'), lineChart(d.environment.b3Trend, { color: PALETTE[4], format: (v) => fmtNumber(v) }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Kepatuhan Emisi Udara'), barList(d.environment.emissionCompliance, { format: num })),
      card(t('Kepatuhan Air Limbah & Air Laut'), barList(d.environment.waterCompliance, { format: num, color: PALETTE[1] }))),
    card(t('Daftar Pelabuhan'),
      h('div.table-wrap', {}, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: t('Pelabuhan') }), h('th', { text: t('Kelas') }), h('th', { text: t('Provinsi') }), h('th', { text: t('Dermaga') }))),
        h('tbody', {}, ...d.ports.map((p) => h('tr.clickable', { onclick: () => { location.hash = `#/m/port/${p.id}`; } },
          h('td', { text: p.name }), h('td.small', { text: p.port_class || '—' }),
          h('td.small', { text: p.province || '—' }), h('td', { text: num(p.berth_count) }))))))));
}

/* ------------------------------------------------------------- contractor */

function contractor(d) {
  return h('div', {},
    h('div.grid.cols-4', {},
      stat(t('Kontraktor Terdaftar'), num(d.contractors.length)),
      stat(t('Izin Aktif'), num(d.permits.active), { sub: tp('{n} izin diterbitkan', { n: num(d.permits.total) }) }),
      stat(t('Jam Kerja Kontraktor'), num(d.performance.manhours)),
      stat(t('LTI Kontraktor'), num(d.performance.lti), { tone: d.performance.lti ? 'warn' : 'ok', sub: tp('{n} fatality', { n: num(d.performance.fatality) }) })),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Grade CSMS'), donut(d.byGrade, { format: num })),
      card(t('Hasil Prakualifikasi'), barList(d.prequalification, { format: num, color: PALETTE[1] })),
      card(t('Rekomendasi Evaluasi'), barList(d.evaluation, { format: num, color: PALETTE[2] }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Tren LTI Kontraktor'), lineChart(d.performance.trend, { color: PALETTE[4] })),
      card(t('Peringkat Kinerja Keselamatan'), barList(d.performance.byRating, { format: num }))),
    card(t('Daftar Kontraktor'),
      h('div.table-wrap', {}, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { text: t('Kontraktor') }), h('th', { text: t('Jenis Pekerjaan') }), h('th', { text: t('Risiko') }),
          h('th', { text: t('Skor CSMS') }), h('th', { text: t('Grade') }), h('th', { text: t('Status') }), h('th', { text: t('Akhir Kontrak') }))),
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
      stat(t('Aset Terdaftar'), num(d.assets.total)),
      stat(t('Inspeksi Peralatan'), num(d.inspections.total), { sub: tp('{n} tidak laik operasi', { n: num(d.inspections.notFit) }), tone: d.inspections.notFit ? 'danger' : 'ok' }),
      stat(t('Pemeliharaan'), num(d.maintenance.total), { sub: tp('{n} jam downtime', { n: dec(d.maintenance.downtime, 1) }) }),
      stat(t('Biaya Pemeliharaan'), fmtCurrency(d.maintenance.cost)),
      stat(t('Kalibrasi'), num(d.calibration.total), { sub: tp('{n} di luar toleransi', { n: num(d.calibration.outOfTolerance) }), tone: d.calibration.outOfTolerance ? 'warn' : 'ok' }),
      stat(t('Sertifikat Aktif'), num(d.certificates.total), { sub: tp('{n} mendekati jatuh tempo', { n: num(d.certificates.expiring.length) }), tone: d.certificates.expiring.length ? 'warn' : 'ok' })),
    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Aset per Kategori'), barList(d.assets.byCategory, { format: num })),
      card(t('Kondisi Aset'), donut(d.assets.byCondition, { format: num })),
      card(t('Kelas Kekritisan'), donut(d.assets.criticalityClass, { format: num }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Tren Inspeksi Peralatan'), lineChart(d.inspections.trend, { color: PALETTE[1] })),
      card(t('Hasil Inspeksi'), barList(d.inspections.byResult, { format: num, color: PALETTE[2] }))),
    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Jenis Pemeliharaan'), barList(d.maintenance.byType, { format: num })),
      card(t('Status Sertifikat'), donut(d.certificates.byStatus, { format: num }))),
    alertsCard(d.certificates.expiring));
}

/* ------------------------------------------------ balanced scorecard (BSC) */

const scoreTone = (s) => (s === null || s === undefined ? '' : s >= 100 ? 'ok' : s >= 90 ? '' : s >= 75 ? 'warn' : 'danger');
const scoreColor = (s) => (s === null || s === undefined ? PALETTE[8] : s >= 100 ? '#12a150' : s >= 90 ? '#1189c1' : s >= 75 ? '#e0a207' : '#d13438');
const deltaChip = (d) => {
  if (d === null || d === undefined) return h('span.small.muted', { text: '—' });
  const up = d >= 0;
  return h('span.badge', { class: up ? 'b-ok' : 'b-danger', text: tp('{arah} {nilai} poin', { arah: up ? '▲' : '▼', nilai: fmtDecimal(Math.abs(d), 1) }) });
};

/** Perspektif BSC datang dwibahasa dari server; sisi mana yang di depan
 *  ditentukan bahasa yang sedang dipakai. */
const layerName = (p) => (lang() === 'en' ? p.en : p.short);
const layerAlt = (p) => (lang() === 'en' ? p.short : p.en);

function bsc(d) {
  const kpiTable = (rows) => dataTable(
    [
      { label: t('Indikator') }, { label: t('Sasaran Strategis') }, { label: t('Satuan') },
      { label: t('Target'), right: true }, { label: t('Realisasi'), right: true },
      { label: t('Bobot'), right: true }, { label: t('Pencapaian'), right: true }, { label: t('Status') },
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
        t(k.achievement_status || 'Belum diukur'),
      ),
    ],
    { onRow: (k) => { location.hash = `#/m/quality_objective/${k.id}`; }, empty: t('Belum ada indikator pada perspektif ini.') },
  );

  // Peta strategi. Urutan lapisan tetap 1..4 seperti dikirim server; CSS yang
  // membalik tampilannya agar terbaca dari bawah ke atas.
  const map = h('div.bsc-map', {}, ...d.perspectives.map((p, i) => {
    const layer = h('div.bsc-layer', { style: `--bsc-tone:${scoreColor(p.score)}` },
      h('div', {},
        // Nama perspektif sudah dwibahasa dari server (`short` Indonesia, `en`
        // Inggris). Yang sedang tidak dipakai ditampilkan sebagai keterangan —
        // istilah Kaplan & Norton sering dicari dalam bahasa aslinya.
        h('h4', {}, `${i + 1}. ${layerName(p)}`, h('span.bsc-en', { text: layerAlt(p) })),
        h('div.small.muted', { text: tp('{jumlah} indikator · {tercapai} tercapai · {risiko} di bawah 90%', { jumlah: p.kpiCount, tercapai: p.achieved, risiko: p.atRisk }) })),
      h('div', {},
        h('div.bar-track', {},
          h('div.bar-fill', { style: `width:${Math.min(p.score ?? 0, 120) / 1.2}%;background:${scoreColor(p.score)}` })),
        h('div.small.muted', { style: 'margin-top:.35rem' }, deltaChip(p.delta), ` ${t('dibanding tahun lalu')}`)),
      h('div.bsc-score', { style: `color:${scoreColor(p.score)}` },
        p.score === null ? '—' : dec(p.score, 1),
        h('small', { text: t(p.grade || 'belum terukur') })));

    // Panah ditaruh SESUDAH lapisannya di DOM. Karena induknya
    // column-reverse, panah itu muncul di bawah lapisan tersebut — yaitu tepat
    // di antara dua lapisan. Menaruhnya sebelum lapisan menghasilkan satu panah
    // menggantung di paling atas dan tidak ada panah di antara dua lapisan
    // terbawah.
    return i === 0 ? layer : h('div', {}, layer, h('div.bsc-arrow', { text: t('▲ menopang') }));
  }));

  const objectiveTable = dataTable(
    [{ label: t('Sasaran Strategis') }, { label: t('Perspektif') }, { label: t('Indikator'), right: true }, { label: t('Tercapai'), right: true }, { label: t('Skor'), right: true }],
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
    { empty: t('Belum ada sasaran strategis yang ditetapkan.') },
  );

  const ini = d.initiatives;

  return h('div', {},
    // Skor korporat berdiri sendiri: dijejerkan bersama empat perspektif dalam
    // satu baris empat kolom, yang kelima justru turun sendirian ke baris baru.
    h('div.grid', {},
      stat(t('Skor Kartu Skor Berimbang'), d.overall === null ? '—' : dec(d.overall, 1), {
        sub: tp('{grade} · rata-rata keempat perspektif dengan bobot sama · tahun lalu {lalu}', {
          grade: t(d.overallGrade || 'belum terukur'),
          lalu: d.overallPrevious === null ? '—' : dec(d.overallPrevious, 1),
        }),
        tone: scoreTone(d.overall),
      })),
    h('div.grid.cols-4', { style: 'margin-top:1rem' },
      ...d.perspectives.map((p) => stat(layerName(p), p.score === null ? '—' : dec(p.score, 1), {
        sub: tp('{tercapai} dari {jumlah} indikator tercapai', { tercapai: p.achieved, jumlah: p.kpiCount }),
        tone: scoreTone(p.score),
      }))),

    card(t('Peta Strategi'), map,
      h('p.small.muted', { style: 'margin-top:.8rem', text: t('Dibaca dari bawah ke atas mengikuti logika sebab-akibat Kaplan & Norton: kompetensi dan budaya menopang proses internal, proses yang andal menghasilkan kepuasan pelanggan, dan pelanggan yang loyal menghasilkan kinerja keuangan. Perspektif terbawah yang lemah akan menjatuhkan lapisan di atasnya — meski hari ini angkanya masih terlihat baik.') })),

    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Skor per Perspektif'), barList(
        d.perspectives.map((p) => ({ label: layerName(p), value: p.score ?? 0 })),
        { format: (v) => `${dec(v, 1)}%` },
      )),
      card(t('Status Pencapaian Indikator'), donut(d.byStatus, { format: num })),
      card(t('Inisiatif Strategis'),
        h('div.grid.cols-2', {},
          stat(t('Perbaikan Berkelanjutan'), num(ini.improvement), { sub: fmtCurrency(ini.improvementSaving) }),
          stat(t('CAPA Berjalan'), num(ini.capaOpen), { tone: ini.capaOpen ? 'warn' : 'ok' }),
          stat(t('Perlakuan Risiko'), num(ini.riskTreatment)),
          stat(t('Pelatihan Terjadwal'), num(ini.trainingPlanned))),
        h('p.small.muted', { style: 'margin-top:.5rem', text: tp('{n} tinjauan manajemen tahun berjalan.', { n: num(ini.managementReviews) }) }))),

    card(t('10 Indikator Paling Tertinggal'),
      dataTable(
        [{ label: t('Indikator') }, { label: t('Perspektif') }, { label: t('Target'), right: true }, { label: t('Realisasi'), right: true }, { label: t('Pencapaian'), right: true }, { label: t('Unit Penanggung Jawab') }],
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
        { onRow: (k) => { location.hash = `#/m/quality_objective/${k.id}`; }, empty: t('Belum ada indikator terukur.') },
      )),

    card(t('Sasaran Strategis, Diurutkan dari yang Paling Tertinggal'), objectiveTable),

    ...d.perspectives.map((p) => card(tp('{perspektif} — {n} indikator', { perspektif: layerName(p), n: p.kpiCount }), kpiTable(p.kpis))));
}

/* ------------------------------------------------------------- analitik */

function analytics(d) {
  const c = d.cards;

  const orgTable = (rows, label) => dataTable(
    // Judul kolom sengaja pendek: sembilan kolom dengan judul panjang mendorong
    // dua kolom terakhir keluar layar, dan justru itulah dua kolom yang paling
    // sering dicari — kepatuhan pelatihan dan sertifikat kedaluwarsa.
    [
      { label }, { label: t('Indeks'), right: true }, { label: t('Insiden'), right: true },
      { label: t('Proaktif'), right: true }, { label: t('Temuan'), right: true },
      { label: t('CAPA Telat'), right: true }, { label: t('Keluhan'), right: true },
      { label: t('Pelatihan'), right: true }, { label: t('Sert. Mati'), right: true },
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
    { empty: t('Belum ada unit yang dapat dibandingkan pada cakupan akses Anda.') },
  );

  const paretoCard = (title, p, color) => card(title,
    !p.rows.length ? emptyState() : h('div', {}, ...p.rows.map((r) => h('div', { style: 'margin-bottom:.5rem' },
      h('div.bar-row', { style: 'margin-bottom:.15rem' },
        h('span', { title: r.label, text: r.label }),
        h('div.bar-track', {}, h('div.bar-fill', { style: `width:${r.percent}%;background:${color}` })),
        h('strong', { text: String(r.value) })),
      h('div.small.muted', { text: tp('{persen}% · kumulatif {kumulatif}%', { persen: dec(r.percent, 1), kumulatif: dec(r.cumulative, 1) }) })))),
    h('p.small.muted', { style: 'margin-top:.4rem', text: tp('Total {n} rekaman.', { n: num(p.total) }) }));

  const r = d.leadingLagging.correlation;
  const corrText = r === null
    ? t('Data belum cukup untuk menghitung hubungan antar deret (minimal tiga bulan berisi).')
    : tp(r <= -0.5 ? 'Korelasi {r} — kuat dan berlawanan arah: bulan dengan pelaporan proaktif tinggi cenderung berinsiden rendah. Inilah pola yang diharapkan.'
      : r < -0.2 ? 'Korelasi {r} — berlawanan arah namun lemah.'
        : r < 0.2 ? 'Korelasi {r} — praktis tidak ada hubungan pada periode ini.'
          : 'Korelasi {r} — searah. Pelaporan yang naik bersamaan dengan insiden biasanya menandakan kesadaran melapor baru tumbuh setelah kejadian, bukan sebelum.',
    { r: fmtDecimal(r, 2) });

  return h('div', {},
    h('div.grid.cols-4', {},
      stat(t('Total Rekaman'), num(c.totalRecords), { sub: tp('{n} modul terisi', { n: num(c.activeModules) }) }),
      stat(t('Rekaman 30 Hari Terakhir'), num(c.recent30)),
      stat(t('Rasio Pelaporan Proaktif'), `${dec(c.proactiveRatio, 1)}×`, {
        sub: t('laporan proaktif per satu insiden'),
        tone: c.proactiveRatio >= 10 ? 'ok' : c.proactiveRatio >= 5 ? '' : 'warn',
      }),
      stat(t('Rekaman Tidak Bergerak'), num(c.staleRecords), {
        sub: t('> 30 hari masih di status awal'),
        tone: c.staleRecords ? 'warn' : 'ok',
      }),
      stat(t('Tindakan Lewat Jatuh Tempo'), num(c.overdueOpen), { tone: c.overdueOpen ? 'danger' : 'ok' }),
      stat(t('Rata-rata Penutupan CAPA'), c.avgCapaClosure === null ? '—' : dec(c.avgCapaClosure, 1), { unit: t('hari') }),
      stat(t('Unit Dibandingkan'), num(c.branchesCompared), { sub: t('cabang dalam cakupan akses Anda') })),

    card(t('Peringkat Kinerja QHSE Antar Cabang'), orgTable(d.branches, t('Cabang')),
      h('p.small.muted', { style: 'margin-top:.5rem', text: t('Indeks 0–100 adalah pembanding antar unit, bukan nilai mutlak. Pelaporan proaktif menaikkan indeks — unit yang melaporkan banyak near miss sedang bekerja dengan benar, bukan sedang berkinerja buruk. Insiden, CAPA lewat jatuh tempo dan sertifikat kedaluwarsa menurunkannya.') })),

    card(t('Peringkat Kinerja QHSE Antar Pelabuhan'), orgTable(d.ports, t('Pelabuhan'))),

    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Indikator Proaktif (Leading) — Near Miss & Observasi'), lineChart(d.leadingLagging.proactiveTrend, { color: PALETTE[1] })),
      card(t('Indikator Hasil (Lagging) — Insiden'), lineChart(d.leadingLagging.incidentTrend, { color: PALETTE[4] }))),

    card(t('Hubungan Pelaporan Proaktif dengan Insiden'),
      h('p', { text: corrText }),
      h('p.small.muted', { text: t('Korelasi bukan sebab-akibat. Angka ini menunjukkan pola yang layak ditanyakan pada rapat tinjauan, bukan kesimpulan yang bisa langsung dipakai.') })),

    card(tp('Perbandingan Tahun {tahun} dengan {pembanding}', { tahun: d.year, pembanding: d.previousYear }),
      dataTable(
        [{ label: t('Metrik') }, { label: d.previousYear, right: true }, { label: d.year, right: true }, { label: t('Perubahan'), right: true }],
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
      h('p.small.muted', { style: 'margin-top:.5rem', text: t('Kenaikan tidak selalu buruk: naiknya near miss, inspeksi, audit dan pelatihan justru menandakan sistem berjalan. Yang perlu dibaca berpasangan adalah naiknya pelaporan proaktif berbarengan dengan turunnya insiden.') })),

    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      paretoCard(t('Pareto Jenis Insiden'), d.pareto.incidentType, PALETTE[4]),
      paretoCard(t('Pareto Sumber Ketidaksesuaian'), d.pareto.ncSource, PALETTE[2])),

    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      paretoCard(t('Pareto Kategori Keluhan Pelanggan'), d.pareto.complaintCategory, PALETTE[3]),
      paretoCard(t('Pareto Bahaya Dominan (HIRA)'), d.pareto.hazard, PALETTE[5])),

    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Kecepatan Penutupan Rekaman'),
        barList(d.closure.map((x) => ({ label: x.name, value: x.days ?? 0 })), { format: (v) => tp('{n} hari', { n: dec(v, 1) }), color: PALETTE[6] }),
        h('p.small.muted', { style: 'margin-top:.5rem', text: t('Rata-rata hari dari rekaman dibuat sampai ditutup, dihitung hanya atas rekaman yang benar-benar sudah tertutup.') })),
      card(t('Rekaman Tidak Bergerak per Modul'),
        dataTable(
          [{ label: t('Modul') }, { label: t('Rekaman'), right: true }],
          d.stale,
          (s) => [
            h('td.small', {}, `${s.icon} ${s.name}`),
            h('td.right', {}, h('span.badge.b-warn', { text: num(s.count) })),
          ],
          { onRow: (s) => { location.hash = `#/m/${s.module}`; }, empty: t('Tidak ada rekaman yang tertahan di status awal.') },
        ))),

    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('15 Modul dengan Rekaman Terbanyak'), barList(d.volumeByModule, { limit: 15, format: num })),
      card(t('Sebaran Rekaman per Kelompok Modul'), barList(d.volumeByGroup, { limit: 16, format: num, color: PALETTE[1] }))));
}

/* -------------------------------------------------- kompetensi & pelatihan */

const pct1 = (v) => (v === null || v === undefined ? '—' : `${dec(v, 1)}%`);

function training(d) {
  const c = d.cards;

  const gapTable = dataTable(
    [
      { label: t('Pegawai') }, { label: t('Jabatan') },
      { label: t('Wajib'), right: true }, { label: t('Dimiliki'), right: true }, { label: t('Gap'), right: true },
      { label: t('Pemenuhan'), right: true }, { label: t('Status') }, { label: t('Target Tutup') },
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
        t(g.gap_status),
      ),
      h('td.small.nowrap', { text: fmtDate(g.target_date) }),
    ],
    {
      onRow: (g) => { location.hash = `#/m/skill_gap/${g.id}`; },
      empty: t('Belum ada analisis kesenjangan kompetensi.'),
    },
  );

  const certTable = dataTable(
    [{ label: t('Sertifikat') }, { label: t('Pemegang') }, { label: t('Jenis') }, { label: t('Penerbit') }, { label: t('Berlaku Sampai') }, { label: t('Sisa Hari'), right: true }],
    d.expiringCertificates,
    (s) => [
      h('td.small', { text: s.certificate_name }),
      h('td.small', { text: s.employee_name || '—' }),
      h('td.small', { text: s.certificate_type || '—' }),
      h('td.small.muted', { text: s.issuer || '—' }),
      expiryCell(s.valid_until),
      h('td.right', {}, h('span.badge', {
        class: (s.days_to_expiry ?? 0) < 0 ? 'b-danger' : (s.days_to_expiry ?? 0) <= 30 ? 'b-warn' : 'b-progress',
        text: (s.days_to_expiry ?? 0) < 0 ? tp('Lewat {n} hari', { n: Math.abs(s.days_to_expiry) }) : tp('{n} hari', { n: s.days_to_expiry }),
      })),
    ],
    {
      onRow: (s) => { location.hash = `#/m/employee_certification/${s.id}`; },
      empty: t('Tidak ada sertifikat yang mendekati atau melewati masa berlaku.'),
    },
  );

  const vendorTable = dataTable(
    [{ label: t('Lembaga Pelatihan') }, { label: t('Jenis') }, { label: t('Pelatihan'), right: true }, { label: t('Peserta'), right: true }, { label: t('Skor'), right: true }, { label: t('Grade') }, { label: t('Akreditasi s.d.') }],
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
      empty: t('Belum ada vendor pelatihan yang dinilai.'),
    },
  );

  // Nama cabang dan pelabuhan sudah memuat kata "Cabang"/"Pelabuhan", jadi
  // tingkatannya cukup jadi kolom tersendiri - bukan awalan yang mengulang.
  const complianceTable = dataTable(
    [
      { label: t('Tingkat') }, { label: t('Unit') },
      { label: t('Pegawai Dianalisis'), right: true }, { label: t('Total Kesenjangan'), right: true },
      { label: t('Kepatuhan'), right: true },
    ],
    [
      ...d.complianceByBranch.map((r) => ({ ...r, scope: t('Cabang') })),
      ...d.complianceByPort.map((r) => ({ ...r, scope: t('Pelabuhan') })),
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
    { empty: t('Belum ada data kepatuhan per unit.') },
  );

  return h('div', {},
    h('div.grid.cols-4', {},
      stat(t('Katalog Pelatihan'), num(c.catalogue), { sub: tp('{n} bersifat wajib', { n: num(c.mandatoryCatalogue) }) }),
      stat(t('Kepatuhan Pelatihan Wajib'), pct1(c.mandatoryCompliance), {
        sub: tp('{n} pegawai belum lengkap', { n: num(c.gapEmployees) }),
        tone: (c.mandatoryCompliance ?? 0) >= 95 ? 'ok' : (c.mandatoryCompliance ?? 0) >= 80 ? 'warn' : 'danger',
      }),
      stat(t('Kesenjangan Kompetensi'), num(c.totalGaps), { sub: t('total pelatihan wajib belum dipenuhi'), tone: c.totalGaps ? 'warn' : 'ok' }),
      stat(t('Sertifikat Kedaluwarsa'), num(c.certificatesExpired), {
        sub: tp('{n} akan habis dalam 90 hari', { n: num(c.certificatesExpiring) }),
        tone: c.certificatesExpired ? 'danger' : c.certificatesExpiring ? 'warn' : 'ok',
      }),
      stat(t('Pelatihan Tahun Ini'), num(c.trainingsThisYear), { sub: tp('{n} peserta', { n: num(c.participants) }) }),
      stat(t('Rencana vs Realisasi'), pct1(c.planAchievement), {
        sub: tp('{selesai} dari {rencana} jadwal terlaksana', { selesai: num(c.completedSchedules), rencana: num(c.plannedSchedules) }),
        tone: (c.planAchievement ?? 0) >= 90 ? 'ok' : 'warn',
      }),
      stat(t('Jam Pelatihan per Pegawai'), dec(c.hoursPerEmployee, 1), { unit: t('jam'), sub: tp('{n} jam keseluruhan', { n: num(c.trainingHours) }) }),
      stat(t('Biaya Pelatihan'), fmtCurrency(c.actualCost), { sub: tp('anggaran {nilai}', { nilai: fmtCurrency(c.budget) }) }),
      stat(t('Tingkat Kehadiran'), pct1(c.attendanceRate), { tone: (c.attendanceRate ?? 0) >= 90 ? 'ok' : 'warn' }),
      stat(t('Tingkat Kelulusan Ujian'), pct1(c.examPassRate), { tone: (c.examPassRate ?? 0) >= 85 ? 'ok' : 'warn' }),
      stat(t('Penyelesaian Materi Daring'), pct1(c.lmsCompletion), { sub: t('rata-rata seluruh materi LMS') }),
      stat(t('Penurunan Insiden Pasca Pelatihan'), pct1(c.incidentReduction), {
        sub: t('Kirkpatrick level 4'),
        tone: (c.incidentReduction ?? 0) > 0 ? 'ok' : 'warn',
      })),

    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Tren Pelaksanaan Pelatihan 12 Bulan'), lineChart(d.deliveryTrend, { color: PALETTE[0] })),
      card(t('Tren Jam Pelatihan 12 Bulan'), lineChart(d.hoursTrend, { color: PALETTE[1], format: (v) => fmtNumber(v) }))),

    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Katalog per Kategori'), barList(d.byCategory, { format: num })),
      card(t('Sifat Pelatihan'), donut(d.byMandatory, { format: num })),
      card(t('Metode Penyelenggaraan'), barList(d.byMethod, { format: num, color: PALETTE[6] }))),

    card(t('Kesenjangan Kompetensi Tertinggi'), gapTable,
      h('p.small.muted', { style: 'margin-top:.5rem', text: t('Selisih antara pelatihan wajib menurut matriks jabatan dan pelatihan yang dimiliki serta masih berlaku.') })),

    card(t('Kepatuhan Pelatihan Wajib per Cabang & Pelabuhan'), complianceTable),

    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Tingkat Kompetensi Rata-rata per Divisi'),
        barList(d.competencyByDivision, { format: (v) => `${dec(v, 2)} / 5` }),
        h('p.small.muted', { style: 'margin-top:.5rem', text: t('Skala 1 Beginner sampai 5 Expert, dihitung dari matriks kompetensi pegawai.') })),
      card(t('Status Kompetensi Pegawai'), donut(d.competencyGapStatus, { format: num })),
      card(t('Jenis Kompetensi Dinilai'), barList(d.competencyByType, { format: num, color: PALETTE[3] }))),

    card(t('Sertifikat Kedaluwarsa & Mendekati Jatuh Tempo'), certTable,
      h('p.small.muted', { style: 'margin-top:.5rem', text: t('Peringatan otomatis dikirim 30, 14 dan 7 hari sebelum masa berlaku berakhir serta pada hari-H.') })),

    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Status Sertifikat'), donut(d.certByStatus, { format: num })),
      card(t('Jenis Sertifikat'), barList(d.certByType, { format: num, color: PALETTE[2] })),
      card(t('Status Pendaftaran Peserta'), barList(d.registrationByStatus, { format: num, color: PALETTE[1] }))),

    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Kehadiran Peserta'), donut(d.attendanceByStatus, { format: num })),
      card(t('Metode Pencatatan Kehadiran'), barList(d.attendanceByMethod, { format: num, color: PALETTE[6] })),
      card(t('Status Jadwal Pelatihan'), barList(d.scheduleByStatus, { format: num, color: PALETTE[3] }))),

    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Efektivitas Pelatihan (Level 3-4)'),
        donut(d.effectiveness, { format: num }),
        h('p.small.muted', { style: 'margin-top:.5rem', text: tp('Kepuasan peserta {puas} · kenaikan pengetahuan {naik}.', { puas: pct1(c.satisfaction), naik: pct1(c.knowledgeGain) }) })),
      card(t('Penerapan di Tempat Kerja'), barList(d.behaviour, { format: num, color: PALETTE[5] })),
      card(t('Sumber Kebutuhan Pelatihan'), barList(d.requestBySource, { format: num, color: PALETTE[2] }))),

    card(t('Kinerja Lembaga Pelatihan'), vendorTable));
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
      { label: t('Cabang') }, { label: t('Paket') }, { label: t('Status') },
      { label: t('Biaya/bulan'), right: true }, { label: t('Pengguna'), right: true },
      { label: t('Utilisasi'), right: true }, { label: t('Tagihan Berikutnya') },
      { label: t('Kesehatan Akun') }, { label: t('NPS'), right: true },
    ],
    d.tenants,
    (row) => [
      h('td', { text: row.branch || '—' }),
      h('td.small', { text: row.plan || '—' }),
      badge(STATUS_TONE[row.status] || 'b-draft', t(STATUS_LABEL[row.status] || row.status)),
      h('td.right', { text: fmtCurrency(row.fee) }),
      h('td.right', { text: `${num(row.activeUsers)} / ${row.seats ? num(row.seats) : '∞'}` }),
      h('td.right', { text: row.utilisation ? `${dec(row.utilisation, 0)}%` : '—' }),
      h('td.small', { text: fmtDate(row.nextBilling) }),
      badge(row.health === 'Sehat' ? 'b-ok' : row.health === 'Berisiko Churn' ? 'b-danger' : 'b-warn', t(row.health)),
      h('td.right', { text: row.nps ?? '—' }),
    ],
    { onRow: (row) => { location.hash = `#/m/subscription/${row.id}`; }, empty: t('Belum ada langganan tercatat.') },
  );

  const adoptionTable = dataTable(
    [{ label: t('Cabang') }, { label: t('Periode') }, { label: t('Pengguna Aktif'), right: true }, { label: t('Skor Adopsi'), right: true }, { label: t('Status') }],
    (d.adoption || []).slice(0, 12),
    (a) => [
      h('td.small', { text: a.branch_name || '—' }),
      h('td.small', { text: a.period }),
      h('td.right', { text: num(a.active_users) }),
      h('td.right', { text: a.adoption_score ? `${dec(a.adoption_score, 0)}%` : '—' }),
      badge(a.adoption_status === 'Sangat Baik' ? 'b-ok' : a.adoption_status === 'Rendah' ? 'b-danger' : 'b-warn', t(a.adoption_status)),
    ],
  );

  const leadTable = dataTable(
    [{ label: t('Cabang / Unit') }, { label: t('Kontak') }, { label: t('Paket Diminati') }, { label: t('Status') }],
    (d.leads || []).slice(0, 12),
    (l) => [
      h('td.small', { text: l.organisation }),
      h('td.small', { text: l.contact_name }),
      h('td.small', { text: l.plan_interest || '—' }),
      badge(l.status === 'converted' ? 'b-ok' : l.status === 'lost' ? 'b-danger' : 'b-progress', l.status),
    ],
    { onRow: (l) => { location.hash = `#/m/trial_request/${l.id}`; }, empty: t('Belum ada permintaan uji coba.') },
  );

  return h('div', {},
    h('div.grid.cols-4', {},
      stat(t('MRR'), fmtCurrency(c.mrr), { sub: t('pendapatan berulang bulanan'), tone: 'ok' }),
      stat(t('ARR'), fmtCurrency(c.arr), { sub: t('proyeksi tahunan') }),
      stat(t('Cabang Berlangganan'), num(c.activeTenants), { sub: tp('{n} dalam uji coba', { n: num(c.trialTenants) }) }),
      stat(t('ARPA'), fmtCurrency(c.arpa), { sub: t('rata-rata per cabang') }),
      stat(t('Pipeline Uji Coba'), fmtCurrency(c.trialPipeline), { sub: t('potensi bila seluruhnya berlanjut') }),
      stat(t('Tagihan Terkumpul'), fmtCurrency(c.collected), { sub: t('12 bulan terakhir'), tone: 'ok' }),
      stat(t('Piutang Berjalan'), fmtCurrency(c.outstanding), { sub: tp('{n} tagihan lewat jatuh tempo', { n: num(c.overdueCount) }), tone: c.overdueCount ? 'warn' : 'ok' }),
      stat(t('Churn'), `${dec(c.churnRate, 1)}%`, { sub: tp('{n} cabang berhenti', { n: num(c.churnedTenants) }), tone: c.churnedTenants ? 'warn' : 'ok' })),

    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Pendapatan Tertagih per Bulan'), lineChart(d.revenueByMonth, { color: PALETTE[6], format: (v) => fmtCurrency(v) })),
      card(t('Umur Piutang'), barList(d.aging, { format: (v) => fmtCurrency(v), color: PALETTE[2] }))),

    h('div.grid.cols-3', { style: 'margin-top:1rem' },
      card(t('Cabang per Paket'), donut(d.byPlan, { format: num })),
      card(t('Status Langganan'), barList(d.byStatus, { format: num, color: PALETTE[1] })),
      card(t('Corong Prospek'), barList(d.leadFunnel, { format: num, color: PALETTE[3] }))),

    card(t('Portofolio Cabang'), tenantTable),

    h('div.grid.cols-2', { style: 'margin-top:1rem' },
      card(t('Adopsi Pemakaian per Cabang'), adoptionTable),
      card(t('Permintaan Uji Coba Terbaru'), leadTable)));
}
