# Catatan Arsitektur

Dokumen ini menjelaskan keputusan rancangan yang penting untuk dipahami sebelum
mengembangkan atau mengaudit sistem.

## 1. Registry sebagai sumber kebenaran tunggal

Seluruh modul dideklarasikan pada `server/registry/*.js`. Satu deklarasi menurunkan
tujuh hal sekaligus:

| Turunan | Dihasilkan oleh |
|---|---|
| Tabel `m_<key>` beserta kolomnya | `db.js` → `migrate()` |
| Endpoint REST lengkap | `engine.js` |
| Validasi (wajib, daftar pilihan, rentang, pola) | `engine.js` → `validate()` |
| Nilai turunan | `compute.js` → `applyComputed()` |
| Alur kerja dan kewenangan transisi | `defs.js` → preset `WF`, `rbac.js` → `canTransition()` |
| Matriks hak akses bawaan | `rbac.js` → `defaultPermissions()` |
| Antarmuka daftar, formulir dan detail | `public/js/module.js` |

Menambah isian baru pada modul yang sudah ada cukup menambahkan satu baris; migrasi
kolom bersifat aditif dan berjalan otomatis saat server dinyalakan.

### Kolom bersama

Setiap tabel modul memiliki kolom berikut di luar isian yang dideklarasikan:

```
id, code, status,
region_id, branch_id, port_id, vessel_id,   -- penempatan organisasi
owner_id, source_module, source_id,         -- kepemilikan & keterkaitan CAPA
created_by, created_at, updated_by, updated_at, closed_at, deleted_at
```

Nama isian yang bertabrakan dengan kolom di atas akan menggagalkan proses migrasi
dengan pesan yang jelas — disengaja, agar kesalahan tertangkap saat pengembangan.

## 2. Dua lapis kendali akses

**Lapis 1 — kewenangan modul.** Tabel `role_permissions` menyimpan lima aksi per peran
per modul. Bawaannya dihasilkan `defaultPermissions()` dan dapat disunting administrator.
Matriks ini adalah dokumen yang akan diminta auditor.

**Lapis 2 — keamanan tingkat baris.** `scopeClause()` mengembalikan potongan SQL sesuai
cakupan peran. Potongan yang sama dipakai oleh:

- daftar rekaman (`/api/modules/:key/records`)
- statistik dan ekspor CSV
- **seluruh endpoint dashboard**

Konsistensi ini penting: agregat sering menjadi jalur kebocoran data ketika filternya
ditulis terpisah dari filter daftar.

Data master dikecualikan dari lapis 2 karena dibutuhkan sebagai rujukan pada formulir
(daftar pelabuhan, kapal, aset). Kewenangan menulisnya tetap dikendalikan lapis 1.

## 3. Nilai turunan tidak pernah dipercaya dari klien

Isian dengan properti `computed` diabaikan saat validasi masukan, lalu dihitung ulang
oleh `applyComputed()` pada setiap penulisan. Konsekuensinya:

- nilai risiko dan tingkat risiko selalu konsisten dengan kemungkinan × keparahan;
- LTIFR/TRIR kontraktor tidak dapat "diperbaiki" dari sisi klien;
- status kepatuhan penyimpanan limbah B3 mengikuti tanggal simpan sebenarnya;
- status sertifikat mengikuti masa berlaku, bukan isian manual.

Faktor emisi terpusat pada `EMISSION_FACTORS` beserta sumbernya (IPCC 2006, faktor grid
KESDM untuk sistem Jamali, DEFRA 2023), sehingga pemutakhiran cukup satu baris dan tetap
dapat ditelusuri.

## 4. Alur kerja

Alur kerja adalah daftar status berurutan; setiap status mencantumkan aksi RBAC yang
diperlukan untuk memasukinya. Status bertanda `terminal` menutup rekaman: perubahan
berikutnya hanya dapat dilakukan pemegang kewenangan `approve`. Sembilan preset
disediakan pada `defs.js` agar modul sejenis berperilaku seragam.

## 5. Antarmuka tanpa proses build

Antarmuka ditulis sebagai ES module murni dengan CSS sendiri dan grafik SVG buatan
sendiri. Tidak ada bundler, tidak ada dependensi frontend, tidak ada permintaan ke CDN —
sesuai Content-Security-Policy ketat yang diterapkan server dan memudahkan pemasangan
pada jaringan tertutup.

## 6. Basis data

`node:sqlite` (modul inti Node 22) dipilih agar tidak ada dependensi native yang perlu
dikompilasi saat pemasangan. Mode WAL diaktifkan. Untuk produksi dengan banyak pengguna
bersamaan, lapisan `db.js` merupakan satu-satunya berkas yang perlu disesuaikan bila
berpindah ke PostgreSQL — kueri dibangun dari metadata, bukan ditulis manual di 116 tempat.

## 7. Multi-tenancy & langganan

Model bisnis: satu **cabang** = satu tenant. `server/tenancy.js` menyelesaikan tiga hal:

1. **Siapa tenant-nya** - pengguna dengan `branch_id` terikat pada langganan cabang itu;
   pengguna tanpa cabang (sysadmin, corporate QHSE, auditor) adalah pengelola platform.
2. **Modul apa yang aktif** - paket menyimpan daftar *kelompok* modul, bukan daftar modul,
   sehingga modul baru otomatis masuk ke paket yang relevan tanpa penyesuaian data.
3. **Boleh menulis atau tidak** - hanya status `trial`, `active` dan `past_due` yang
   memperbolehkan perubahan data; `suspended` dan `ended` menjadi hanya-baca.

`assertEntitled()` dipanggil berdampingan dengan `assertCan()` pada setiap operasi modul
melalui satu fungsi `guard()`. Penolakan paket memakai **HTTP 402**, dibedakan dari 403
milik RBAC, agar antarmuka dapat menampilkannya sebagai ajakan peningkatan paket alih-alih
kesalahan kewenangan.

Kelompok `governance` selalu termasuk paket apa pun karena berisi data rujukan
(pelabuhan, kapal, aset) yang dibutuhkan formulir modul lain.

## 8. Pengujian

`scripts/smoke-test.js` menjalankan 100 pemeriksaan terhadap server yang berjalan, meliputi
autentikasi, batas RBAC per peran, keamanan tingkat baris, CRUD, perhitungan nilai turunan,
transisi alur kerja, keterkaitan CAPA, seluruh dashboard, ekspor, penghapusan, endpoint
publik halaman depan, pembatasan modul berdasarkan paket, dashboard komersial, serta siklus
kompetensi & pelatihan (matriks wajib, kesenjangan kompetensi, masa berlaku sertifikat dan
persetujuan berjenjang pendaftaran). Pengujian
menggunakan sesi terpisah per peran sehingga benar-benar memverifikasi perilaku produksi,
bukan sekadar memanggil fungsi internal.
