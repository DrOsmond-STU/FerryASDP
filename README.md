# Enterprise Integrated QHSE Management System

**PT ASDP Indonesia Ferry (Persero)**

Satu platform digital yang mengelola Quality, Health, Occupational Safety, Environment,
Maritime Safety, Port Safety, Operational Risk, Asset Safety, Contractor Safety,
Compliance, Audit dan Management Review — **93 modul fungsional dalam 13 kelompok**,
terintegrasi dengan standar ISO dan regulasi Indonesia yang berlaku.

---

## Menjalankan aplikasi

```bash
npm install          # hanya memerlukan Express; basis data memakai node:sqlite bawaan Node 22
npm run seed         # memuat master data, 11 akun demo dan ±1.350 rekaman contoh
npm start            # http://localhost:3000
npm run check        # 59 pemeriksaan end-to-end terhadap server yang sedang berjalan
```

Prasyarat: **Node.js 22.5 atau lebih baru** (menggunakan modul inti `node:sqlite`,
sehingga tidak ada dependensi native yang perlu dikompilasi).

`npm run reset` menghapus basis data lama lalu memuat ulang data awal.

### Akun demo

Seluruh akun memakai kata sandi yang sama: `Asdp#2026Qhse`
(ubah melalui `QHSE_SEED_PASSWORD` sebelum menjalankan seed).

| Level | Nama pengguna | Peran | Cakupan akses |
|---|---|---|---|
| 1 | `admin` | Administrator Sistem | Nasional, seluruh konfigurasi |
| 2 | `corporate.qhse` | Corporate QHSE | Nasional |
| 3 | `regional.qhse` | Regional/Branch QHSE | Regional I – Sumatera |
| 4 | `port.manager` | Port Manager | Pelabuhan Merak |
| 5 | `nakhoda` | Vessel Master | KMP Portlink III |
| 6 | `dept.head` | Department Head | Cabang Merak |
| 7 | `supervisor` | Supervisor | Pelabuhan Merak |
| 8 | `operator` | Petugas/Operator | Rekaman sendiri |
| 9 | `kontraktor` | Kontraktor | Modul terbatas, rekaman sendiri |
| 10 | `auditor` | Auditor Internal & Eksternal | Nasional, hanya baca |

Masuk sebagai peran berbeda memperlihatkan bagaimana RBAC dan row-level security bekerja:
angka pada dashboard yang sama akan berbeda mengikuti cakupan pengguna.

---

## Arsitektur

Aplikasi dibangun **berbasis metadata**: setiap modul dideklarasikan sebagai data pada
registry, lalu satu mesin generik menurunkan skema basis data, REST API, validasi,
alur kerja, hak akses dan antarmuka dari deklarasi tersebut.

```
server/
  registry/          deklarasi 93 modul (defs.js berisi helper & preset workflow)
  db.js              node:sqlite — skema dibangkitkan dari registry, migrasi aditif
  rbac.js            10 level peran, matriks hak akses, klausa row-level security
  auth.js            scrypt, sesi httpOnly, penguncian akun, kebijakan kata sandi
  compute.js         seluruh nilai turunan (LTIFR, CO2e, matriks risiko, CSMS, GM …)
  engine.js          REST generik: CRUD, workflow, komentar, lampiran, CAPA, ekspor CSV
  dashboards.js      12 dashboard analitik, dihitung melalui filter akses yang sama
  admin.js           pengguna, matriks hak akses, jejak audit, informasi sistem
  index.js           bootstrap Express, header keamanan, penyajian antarmuka
  seed.js            master data + rekaman contoh yang realistis

public/
  js/api.js          klien REST + cache metadata
  js/module.js       daftar, formulir dan detail rekaman — generik untuk semua modul
  js/dashboards.js   12 tampilan dashboard
  js/charts.js       grafik SVG tanpa pustaka pihak ketiga
  js/admin.js        layar administrasi
  css/app.css        tema terang & gelap
```

Menambah modul baru = menambah satu deklarasi pada `server/registry/`.
Tabel, endpoint, validasi, hak akses, formulir dan tampilan daftar mengikuti otomatis.

### Mengapa metadata-driven

93 modul dengan rata-rata 20 isian berarti sekitar 1.900 definisi field. Menulis
CRUD manual untuk masing-masing modul akan menghasilkan ribuan baris kode berulang
yang mustahil dijaga konsistensinya. Dengan pendekatan ini, aturan seperti
"setiap perubahan tercatat pada jejak audit" atau "nilai risiko tidak boleh dikirim
dari klien" ditegakkan **satu kali** untuk seluruh modul.

---

## Cakupan standar

| Standar | Penerapan dalam sistem |
|---|---|
| **ISO 9001:2015** | Pengendalian dokumen, SOP, instruksi kerja, sasaran mutu & KPI, keluhan pelanggan, ketidaksesuaian, CAPA, tindakan pencegahan, perbaikan berkelanjutan, tinjauan manajemen |
| **ISO 14001:2015** | Limbah B3 & non-B3, emisi udara, air limbah & air laut, pemantauan RKL-RPL, tumpahan, jejak karbon, ESG |
| **ISO 45001:2018** | Insiden, near miss, unsafe action/condition, HIRA, JSA, izin kerja, toolbox meeting, observasi keselamatan, tanggap darurat, MCU, kelelahan, PAK, klinik, vaksinasi |
| **ISO 31000:2018** | Register risiko terpadu, risiko korporat/operasional/pelabuhan/kapal, perlakuan risiko, matriks 5×5 dengan risiko residual |
| **ISO 55001:2014** | Daftar aset, inspeksi peralatan, kalibrasi, pemeliharaan, sertifikat statutori, kekritisan aset (MTBF/MTTR) |
| **ISO 50001:2018** | Konsumsi energi & BBM, tinjauan energi, SEU, EnPI, program efisiensi |
| **ISO 22301:2019** | Business Impact Analysis (MTPD/RTO/RPO), rencana kelangsungan usaha, pengujian rencana |
| **ISO 27001:2022** | Kejadian keamanan informasi, klasifikasi informasi, jejak audit, kontrol akses, kebijakan kata sandi, penguncian akun |
| **ISO 19011:2018** | Audit internal & eksternal, program audit, temuan, tindak lanjut |
| **ISM Code / SOLAS / LSA & FSS Code** | Inspeksi keselamatan kapal, checklist pra-berlayar, LSA, FFA, stabilitas, ramp door |
| **IMDG Code / CSS Code** | Barang berbahaya, pengikatan muatan, keselamatan muat kendaraan |
| **ISPS Code** | Keamanan fasilitas pelabuhan, security level, kontrol akses |
| **GRI Standards / SASB / TCFD** | Indikator ESG, asurans, pengungkapan keberlanjutan |
| **ISO 14064-1 / GHG Protocol** | Jejak karbon Scope 1, 2 dan 3 |

## Cakupan regulasi Indonesia

**Kementerian Perhubungan** — UU No. 17/2008 (Pelayaran), PP No. 61/2009 (Kepelabuhanan),
PP No. 20/2010 (Angkutan di Perairan), PM No. 82/2014 (Surat Persetujuan Berlayar),
PM No. 134/2016 (Keamanan Kapal & Fasilitas Pelabuhan), PM No. 32/2016 (Barang Berbahaya
di Perairan), SOP Syahbandar dan SOP pelabuhan penyeberangan.

**Kementerian Ketenagakerjaan** — UU No. 1/1970, PP No. 50/2012 (SMK3, termasuk skor dan
tingkat pencapaian penerapan), Permenakertrans No. 08/2010 (APD), Permenaker No. 04/MEN/1987
(P2K3), No. 08/2020 (Pesawat Angkat & Angkut), No. 12/2015 (Listrik), No. 37/2016
(Bejana Tekan), No. 15/2008 (P3K), No. 09/2016 (Kerja di Ketinggian),
No. 03/MEN/1998 (Pelaporan Kecelakaan), Kepmenaker No. 186/1999 (Penanggulangan Kebakaran).

**KLHK** — PP No. 22/2021 (baku mutu emisi, air limbah, limbah B3), PermenLHK No. 6/2021
(pengelolaan limbah B3, batas simpan 90 hari), PermenLHK No. 5/2014, PermenLHK No. 11/2021,
Kepmen LH No. 51/2004 (baku mutu air laut), AMDAL/UKL-UPL dan pelaporan RKL-RPL semesteran,
Perpres No. 98/2021 (Nilai Ekonomi Karbon), Perpres No. 109/2006 (tumpahan minyak).

**Lainnya** — POJK No. 51/POJK.03/2017 dan SEOJK No. 16/SEOJK.04/2021 (Laporan Keberlanjutan),
UU No. 27/2022 (Pelindungan Data Pribadi), PP No. 33/2023 (Konservasi Energi),
Peraturan BKI (klasifikasi kapal), UU No. 8/2016 (Penyandang Disabilitas),
MARPOL Annex I/IV/V/VI, STCW (jam istirahat awak kapal).

---

## Modul

| Kelompok | Jumlah | Isi |
|---|---|---|
| **A. Governance & Master Data** | 10 | Profil perusahaan, regional, cabang, pelabuhan, kapal, struktur organisasi, pegawai, aset, jam kerja, kontraktor |
| **B. Document Management** | 8 | Pengendalian dokumen, SOP, instruksi kerja, formulir, regulasi eksternal, legal register, revisi, matriks distribusi |
| **C. Quality Management** | 6 | Sasaran mutu & KPI, keluhan pelanggan, ketidaksesuaian, CAPA, tindakan pencegahan, perbaikan berkelanjutan |
| **D. Health Management** | 6 | MCU, manajemen kelelahan, penyakit akibat kerja, klinik, vaksinasi, promosi kesehatan |
| **E. Occupational Safety** | 10 | Insiden, near miss, unsafe action, unsafe condition, HIRA, JSA, izin kerja, toolbox meeting, observasi keselamatan, tanggap darurat |
| **F. Environment & Energy** | 9 | Limbah non-B3, limbah B3, emisi udara, kualitas air, konsumsi energi, jejak karbon, ESG, pemantauan lingkungan, tumpahan |
| **G. Audit & Compliance** | 5 | Audit internal, audit eksternal, inspeksi umum, audit kepatuhan, tinjauan manajemen |
| **H. Risk Management** | 6 | Register risiko, risiko korporat, operasional, pelabuhan, kapal, perlakuan risiko |
| **I. Asset Safety** | 5 | Inspeksi peralatan, kalibrasi, pemeliharaan, sertifikat statutori, kekritisan aset |
| **J. Contractor Safety** | 4 | Prakualifikasi CSMS, evaluasi kinerja, izin masuk & induksi, kinerja keselamatan |
| **K. Maritime Safety** | 15 | Inspeksi keselamatan kapal, checklist pra-berlayar, SPB, mooring, ramp door, muat kendaraan, keselamatan penumpang, pengikatan muatan, barang berbahaya, LSA, FFA, stabilitas, cuaca, insiden pelayaran, inspeksi fasilitas pelabuhan |
| **M. Port Safety (ASDP)** | 4 | Patroli keselamatan pelabuhan, manajemen kepadatan & angkutan puncak, keamanan ISPS, kebersihan & lingkungan pelabuhan |
| **N. Continuity, Energy & Security** | 5 | Business Impact Analysis, rencana kelangsungan usaha, tinjauan energi, keamanan informasi, pelatihan & kompetensi |

### Yang membedakan dari QHSE manufaktur

Kelompok **K** dan **M** dirancang khusus untuk operator kapal penyeberangan dan pelabuhan:

- **Checklist pra-berlayar** dengan 28 item kritis (ramp door, bow door, stern door,
  indikator pengunci di anjungan, ballast, stabilitas, lampu navigasi, pompa bilga,
  pompa kebakaran, ruang mesin, peralatan anjungan, manifest, SPB) dan keputusan
  keberangkatan yang terekam.
- **Keselamatan muat kendaraan** — kapasitas dek dalam SUP, distribusi beban, golongan
  kendaraan I–IX, kendaraan over dimension, kendaraan pengangkut B3, lashing, penguncian,
  ventilasi dek.
- **Keselamatan penumpang** — manifest versus hasil hitung aktual, deteksi kelebihan
  kapasitas otomatis, muster station, briefing, aksesibilitas disabilitas.
- **Insiden pelayaran** — kandas, tubrukan, allision, kebakaran kapal, man overboard,
  tumpahan minyak, kegagalan mesin/kemudi/ramp door, cuaca ekstrem, penutupan pelabuhan,
  dengan klasifikasi IMO dan pelaporan KSOP/KNKT.
- **Stabilitas kapal** — GM aktual versus GM minimum, trim, sarat rata-rata, lambung timbul,
  dengan status kepatuhan yang dihitung sistem.
- **Port safety** — kondisi fender, bollard, movable bridge, gangway, area steril,
  jalur evakuasi, APAR pelabuhan dan pencahayaan dermaga.
- **Manajemen kepadatan** — angkutan lebaran dan Nataru: panjang antrian, waktu tunggu,
  delay system, kantong parkir, posko terpadu lintas instansi.

---

## Kemampuan lintas modul

**Alur kerja berjenjang** — sembilan preset (pelaporan, dokumen, inspeksi, CAPA, izin kerja,
risiko, monitoring, rekaman, sederhana). Setiap transisi status memerlukan kewenangan
tertentu, sehingga persetujuan tidak dapat dilewati.

**Nilai turunan dihitung di server** — LTIFR, TRIR, severity rate, matriks risiko 5×5
beserta risiko residual, emisi CO₂e dari faktor emisi IPCC/KESDM/DEFRA, tingkat daur ulang,
lama simpan limbah B3 terhadap batas 90 hari, skor dan grade CSMS, pencapaian KPI dua arah
(semakin tinggi/semakin rendah semakin baik), GM terhadap batas minimum, utilisasi kapasitas
kendaraan dan penumpang, kepatuhan jam istirahat STCW, status sertifikat terhadap masa berlaku.
Nilai `computed` tidak pernah diterima dari klien.

**Keterkaitan CAPA** — rekaman apa pun (insiden, temuan audit, ketidaksesuaian, keluhan,
inspeksi, evaluasi kepatuhan) dapat menurunkan tindakan korektif yang tertaut balik ke sumbernya,
lengkap dengan hirarki pengendalian ISO 45001 §8.1.2.

**Peringatan kedaluwarsa** — seluruh isian bertanda `alert` (sertifikat kapal, izin lingkungan,
izin TPS B3, suket Disnaker, kalibrasi, HRU life raft, pyrotechnics, baterai EPIRB, jadwal
tinjauan dokumen, target CAPA) dipindai lintas modul dan ditampilkan dengan sisa hari.

**Jejak audit** — setiap pembuatan, perubahan (beserta daftar kolom yang berubah), transisi
status, penghapusan, ekspor, unggah lampiran dan percobaan login tercatat.

**Ekspor CSV** — setiap modul dapat diekspor mengikuti filter yang sedang aktif, dengan BOM
UTF-8 agar terbaca benar di Microsoft Excel.

---

## Hak akses

Sepuluh level sesuai tata kelola ASDP. Dua pertanyaan dijawab terpisah:

1. **Apa yang boleh dilakukan peran terhadap suatu modul?** — matriks
   `lihat / buat / ubah / setujui / hapus` per modul, dapat disunting administrator
   melalui antarmuka dan dapat dikembalikan ke bawaan sistem.
2. **Baris mana yang boleh dilihat pengguna?** — klausa cakupan (nasional, regional,
   cabang, pelabuhan, kapal, atau rekaman sendiri) diterapkan pada daftar, statistik
   **dan seluruh dashboard**, sehingga tidak ada kebocoran data melalui agregat.

Data master (pelabuhan, kapal, aset, kontraktor) tetap terbaca lintas cakupan karena
dibutuhkan sebagai rujukan pada formulir; kewenangan menulisnya tetap dibatasi.

## Keamanan

- Kata sandi di-hash dengan **scrypt** dan salt acak per pengguna.
- Token sesi disimpan sebagai **digest SHA-256** — basis data yang bocor tidak dapat
  dipakai ulang sebagai sesi aktif.
- Cookie `httpOnly`, `SameSite=Strict`, opsi `Secure` melalui `QHSE_SECURE_COOKIE=1`.
- Penguncian akun 15 menit setelah 5 percobaan gagal.
- Kebijakan kata sandi: minimal 10 karakter dengan huruf besar, huruf kecil dan angka.
- Content-Security-Policy ketat, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`.
- Seluruh kueri memakai *prepared statement*; nama kolom hanya berasal dari registry,
  tidak pernah dari masukan pengguna.

## Konfigurasi

| Variabel | Bawaan | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port HTTP |
| `QHSE_DB` | `data/qhse.db` | Lokasi berkas basis data |
| `QHSE_SESSION_HOURS` | `12` | Masa berlaku sesi |
| `QHSE_SECURE_COOKIE` | – | Setel `1` bila dilayani melalui HTTPS |
| `QHSE_SEED_PASSWORD` | `Asdp#2026Qhse` | Kata sandi awal akun demo |

---

## Catatan penerapan

Data contoh bersifat ilustratif dan dibangkitkan secara deterministik untuk keperluan
demonstrasi; nama pelabuhan, kapal, cabang serta angka kinerja **bukan** data operasional
PT ASDP Indonesia Ferry (Persero) yang sebenarnya. Sebelum digunakan pada lingkungan
produksi, sekurang-kurangnya diperlukan: integrasi dengan sistem kepegawaian dan
Ferizy, penyesuaian faktor emisi dan baku mutu pada dokumen lingkungan tiap pelabuhan,
penetapan matriks hak akses definitif oleh pemilik proses, serta migrasi ke basis data
terkelola dengan pencadangan berkala.
