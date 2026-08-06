# Pemasangan di cPanel DomaiNesia — `asdp.semestateknologiutama.com`

Berkas di direktori ini adalah **salinan** dari yang berjalan di server. Aslinya
hanya ada di `/home/semestat/` dan akan hilang seluruhnya bila akun hosting itu
dibersihkan.

## Status per 6 Agustus 2026

| Bagian | Keadaan |
|---|---|
| Proses aplikasi (Express, port 3500) | **berjalan** — RSS 68,8 MB |
| Basis data SQLite | **tersemai** — 1.426 rekaman, 12 pengguna |
| Jalur publik lewat Apache | **200** pada `/`, `/api/health`, `/api/public/plans`, aset statis |
| Redirect HTTP → HTTPS | **301** |
| Alur masuk lewat URL publik | **200** (login, `/api/meta`, dashboard langganan) |

## Bentuk pemasangan

Satu proses Node melayani antarmuka **dan** API sekaligus, berbeda dari aplikasi
dua-proses di akun yang sama. Karena itu `.htaccess` hanya butuh satu aturan
proxy tanpa pemotongan awalan.

```
Apache (subdomain)  ──[P]──►  127.0.0.1:3500  ──►  ~/asdp-data/qhse.db
        │                          │
   ~/asdp.semestateknologiutama.com/.htaccess    ~/asdp-app  (kode)
```

| Jalur | Isi |
|---|---|
| `~/asdp-app` | kode aplikasi (hasil `curl` tarball GitHub + `npm install`) |
| `~/asdp-data` | basis data SQLite — **di luar** `asdp-app`, sehingga pembaruan kode tidak pernah menyentuh data |
| `~/asdp.semestateknologiutama.com` | document root, sengaja hanya berisi `.htaccess` |
| `~/asdp-runner.sh` | pemasang + penjaga proses |
| `~/asdp-live-check.sh` | pemeriksaan dari sisi server |
| `~/asdp-app.log`, `~/asdp-install.log`, `~/asdp-live.log` | log, dipangkas sendiri pada 5 MB |

## Kenapa aplikasi ini muat, padahal API aplikasi lain tidak

Akun ini berbatas `lve_pmem` **1024 MB keras**, dan tiga aplikasi lain sudah
memakai ratusan MB untuk melayani pengunjung sungguhan. Aplikasi QHSE ASDP
terukur **68,8 MB RSS** saat melayani seluruh rute — muat dengan sangat lapang.

Tiga keputusan rancangan yang membuatnya demikian, dan semuanya diambil sebelum
target pemasangan diketahui:

| Keputusan | Akibat di server ini |
|---|---|
| `node:sqlite` (modul inti Node) | tidak ada ORM, tidak ada engine native, tidak ada `prisma generate` yang butuh >1 GB |
| Antarmuka tanpa proses build | tidak ada `next build`, jadi tidak menabrak batas `lvenproc = 150` |
| Hanya satu dependensi (`express`) | `npm install` selesai **1 detik**, 68 paket |

Batas heap tetap dipatok `--max-old-space-size=320` di runner: bukan karena
dibutuhkan, tetapi agar satu kebocoran memori di kemudian hari tidak pernah
menjadi masalah bagi tiga aplikasi lain di akun yang sama.

## Jadwal cron — kenapa menit ganjil ini

Akun ini menjalankan cron milik empat aplikasi lain pada `*/6, */7, */9, */10`
ditambah daftar tetap `1,11,21…`, `3,13,23…`, `6,16,26…` dan `8,18,28…`.
Menit yang **tidak pernah** dipakai satu pun dari mereka: `2, 4, 5, 15, 17, 19,
22, 25, 29, 32, 34, 37, 39, 44, 47, 52, 55, 57`.

| Cron | Jadwal | Guna |
|---|---|---|
| `asdp-runner.sh` | `2,15,25,37,47,57` | pasang bila diminta, semai bila perlu, nyalakan bila mati |
| `asdp-live-check.sh` | `22,52` | dijalankan hanya bila penanda `~/asdp-live.request` ada |

## Pelajaran mahal: `flock` mematikan runner tanpa satu pun pesan

Baris cron runner **pernah** dibungkus `flock -n /home/semestat/.asdp.lock`.
Terlihat benar, dan bekerja tepat satu kali.

`flock` memegang kuncinya pada sebuah **file descriptor**. Langkah terakhir
runner menyalakan proses Node di latar belakang, dan proses itu **mewarisi
descriptor tersebut**. Selama aplikasi hidup — yaitu selamanya, karena memang
itu tujuannya — kuncinya tidak pernah terlepas. Akibatnya `flock -n` pada
setiap putaran cron berikutnya langsung gagal, dan runner **tidak pernah
berjalan lagi**.

Yang membuatnya mahal: tidak ada yang merah. Cron tetap terjadwal, skripnya
tetap ada, aplikasinya tetap melayani pengunjung. Yang hilang hanya
kemampuannya memasang pembaruan — penanda `asdp-install.request` menumpuk
tanpa pernah dikerjakan, dan `asdp-install.log` diam di entri terakhir yang
berhasil. Gejalanya persis sama dengan "cron belum sempat jalan".

Gantinya kunci direktori di dalam skrip: `mkdir` bersifat atomik, tidak
melibatkan descriptor apa pun, dan dilepas eksplisit lewat `trap ... EXIT`.
Kunci yang lebih tua dari 30 menit dianggap sisa proses yang mati lalu
dibersihkan. Proses Node juga dinyalakan dengan `0<&-` agar tidak menahan
descriptor apa pun milik cron.

Kalau suatu saat runner ini terlihat "tidak jalan" padahal cron terpasang,
periksa `~/.asdp-runner.lock` lebih dulu.

## Penanda

Semuanya berkas kosong di `~`, dihapus sendiri setelah dikerjakan.

| Penanda | Guna |
|---|---|
| `asdp-install.request` | unduh ulang kode dari GitHub, `npm install`, nyalakan ulang |
| `asdp-seed.request` | penyemaian **aditif** — hanya mengisi modul yang tabelnya masih kosong |
| `asdp-reseed.request` | **hapus** basis data lalu semai ulang dari awal |
| `asdp-restart.request` | matikan proses; putaran cron berikutnya menyalakannya |
| `asdp-live.request` | jalankan pemeriksaan, hasil ke `~/asdp-live.log` |

Memperbarui aplikasi setelah `git push`:

```bash
touch ~/asdp-install.request     # tunggu satu putaran cron
touch ~/asdp-live.request        # lalu periksa hasilnya
```

## Cara memasang ulang dari nol

1. Salin `asdp-runner.sh` dan `asdp-live-check.sh` ke `/home/semestat/`.
2. Salin `htaccess` menjadi `.htaccess` di document root subdomain.
3. Pasang dua cron di atas.
4. `touch ~/asdp-install.request`, tunggu satu putaran, pantau `~/asdp-install.log`.

Basis data disemai otomatis pada putaran yang sama bila `~/asdp-data/qhse.db`
belum ada — tidak ada langkah manual tambahan.

### Kenapa pemasangan selalu menyusul dengan penyemaian aditif

Versi baru dapat membawa modul baru. Tabelnya memang dibuat sendiri oleh
`migrate()` saat server menyala, tetapi **isinya kosong** — dan basis data yang
sudah ada tidak pernah disemai lagi, sehingga modul baru akan tampil hampa
padahal aplikasinya sehat. Gejalanya menyesatkan: dashboard baru merespons 200
dengan seluruh angka nol.

Karena itu langkah pemasangan menaruh `asdp-seed.request`, dan `server/seed.js`
menjaga setiap blok dengan `hasRows()`: tabel yang sudah berisi dilewati, hanya
yang kosong yang diisi. Data cabang yang sudah ada tidak tersentuh.

## Yang perlu diubah sebelum dipakai sungguhan

Pemasangan ini adalah **lingkungan demonstrasi**, bukan produksi:

- Kata sandi seluruh akun demo sama dan tercantum di README repositori. Ganti
  `QHSE_SEED_PASSWORD` sebelum menyemai, atau ubah kata sandi tiap akun setelah
  pemasangan.
- SQLite satu berkas cocok untuk demonstrasi dan puluhan pengguna bersamaan.
  Untuk beban sungguhan lintas cabang, pindahkan `server/db.js` ke PostgreSQL —
  itu satu-satunya berkas yang perlu disesuaikan.
- Tidak ada pencadangan otomatis. `~/asdp-data/qhse.db` perlu masuk jadwal
  cadangan akun sebelum ada data sungguhan di dalamnya.
