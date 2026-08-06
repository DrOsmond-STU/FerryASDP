#!/bin/bash
# ============================================================================
#  QHSE ASDP — pemasang + penjaga proses (cPanel DomaiNesia, tanpa Passenger).
#
#  Cron memanggil skrip ini. Ia mengerjakan empat hal berurutan:
#    1. memasang/memperbarui bila ~/asdp-install.request ada;
#    2. menyemai basis data bila belum ada, atau bila ~/asdp-reseed.request ada;
#    3. mematikan proses bila ~/asdp-restart.request ada;
#    4. menyalakan aplikasi bila belum/tidak berjalan.
#
#  Aman dipanggil berkali-kali: bila prosesnya hidup dan tidak ada penanda,
#  skrip ini keluar tanpa melakukan apa pun.
#
#  Satu proses melayani antarmuka DAN API pada port 3500; .htaccess di document
#  root subdomain mem-proxy seluruh permintaan ke sana.
# ============================================================================
HOME_DIR=/home/semestat
APP_DIR=$HOME_DIR/asdp-app
DATA_DIR=$HOME_DIR/asdp-data
PIDFILE=$HOME_DIR/asdp.pid
LOG=$HOME_DIR/asdp-app.log
INSTALL_LOG=$HOME_DIR/asdp-install.log
LOCKDIR=$HOME_DIR/.asdp-runner.lock

INSTALL_REQUEST=$HOME_DIR/asdp-install.request
RESEED_REQUEST=$HOME_DIR/asdp-reseed.request
RESTART_REQUEST=$HOME_DIR/asdp-restart.request

TARBALL='https://codeload.github.com/DrOsmond-STU/FerryASDP/tar.gz/refs/heads/claude/enterprise-qhse-system-02g5tx'

export PATH="$HOME_DIR/.local/share/mise/shims:$HOME_DIR/.local/bin:$PATH"

# ---------------------------------------------------------------- KUNCI ----
#  JANGAN kembali memakai `flock` pada baris cron. Sudah dicoba dan gagal
#  dengan cara yang sulit dilihat: flock memegang kunci pada sebuah file
#  descriptor, dan proses Node yang dinyalakan di langkah terakhir MEWARISI
#  descriptor itu. Selama aplikasi hidup — yaitu selamanya, karena itulah
#  tujuannya — kuncinya tidak pernah terlepas, sehingga `flock -n` pada setiap
#  putaran cron berikutnya langsung gagal dan skrip ini TIDAK PERNAH berjalan
#  lagi. Tidak ada pesan galat; pembaruan hanya diam-diam tidak pernah
#  terpasang.
#
#  Kunci direktori tidak punya masalah itu: `mkdir` bersifat atomik, tidak
#  melibatkan descriptor apa pun, dan dilepas eksplisit lewat trap. Kunci yang
#  lebih tua dari 30 menit dianggap sisa proses yang mati dan dibersihkan.
# ---------------------------------------------------------------------------
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  if [ -d "$LOCKDIR" ] && [ -z "$(find "$LOCKDIR" -maxdepth 0 -mmin -30 2>/dev/null)" ]; then
    rmdir "$LOCKDIR" 2>/dev/null && mkdir "$LOCKDIR" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCKDIR" 2>/dev/null' EXIT

# --- konfigurasi runtime -----------------------------------------------------
export PORT=3500
export QHSE_DB="$DATA_DIR/qhse.db"
export QHSE_SECURE_COOKIE=1
export QHSE_SESSION_HOURS=12
# Basis data SQLite dan Express berjalan ringan; batas heap dipatok rendah agar
# akun 1 GB tetap punya ruang untuk tiga aplikasi lain yang melayani pengunjung.
export NODE_OPTIONS="--max-old-space-size=320"

mkdir -p "$DATA_DIR"

# Log tidak boleh tumbuh selamanya di akun berkuota disk.
for f in "$LOG" "$INSTALL_LOG"; do
  if [ -f "$f" ] && [ "$(stat -c%s "$f" 2>/dev/null || echo 0)" -gt 5242880 ]; then
    tail -c 1048576 "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  fi
done

stop_app() {
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null
    sleep 3
    rm -f "$PIDFILE"
  fi
}

# --- 1. Pemasangan / pembaruan ----------------------------------------------
if [ -f "$INSTALL_REQUEST" ]; then
  {
    echo "=== $(date) memasang dari GitHub ==="
    echo "node: $(node -v 2>&1) di $(command -v node 2>&1)"
    echo "npm:  $(npm -v 2>&1)"

    TMP=$HOME_DIR/.asdp-fetch
    rm -rf "$TMP"; mkdir -p "$TMP"

    if curl -fsSL -m 180 "$TARBALL" -o "$TMP/src.tar.gz"; then
      echo "unduhan: $(stat -c%s "$TMP/src.tar.gz") byte"
      if tar -xzf "$TMP/src.tar.gz" -C "$TMP" --strip-components=1; then
        rm -f "$TMP/src.tar.gz"
        stop_app
        mkdir -p "$APP_DIR"
        # Basis data tinggal di ~/asdp-data, di luar APP_DIR, sehingga
        # pembaruan kode tidak pernah menyentuh data yang sudah ada.
        cp -a "$TMP"/. "$APP_DIR"/
        echo "berkas aplikasi disalin"

        cd "$APP_DIR" || exit 1
        echo "--- npm install ---"
        npm install --omit=dev --omit=optional --no-audit --no-fund
        echo "--- npm selesai (kode $?) ---"

        rm -rf "$TMP"
        rm -f "$INSTALL_REQUEST"
        echo "=== selesai $(date) ==="
      else
        echo "GAGAL mengekstrak tarball"
      fi
    else
      echo "GAGAL mengunduh — periksa nama branch atau visibilitas repositori."
      echo "Penanda dibiarkan; percobaan diulang pada putaran cron berikutnya."
    fi
  } >> "$INSTALL_LOG" 2>&1
fi

# --- 2. Belum ada aplikasi? Diam. -------------------------------------------
[ -f "$APP_DIR/server/index.js" ] || exit 0
[ -d "$APP_DIR/node_modules/express" ] || exit 0

# --- 3. Semai basis data -----------------------------------------------------
# Dijalankan sekali saat basis data belum ada, atau atas permintaan eksplisit.
if [ ! -f "$QHSE_DB" ] || [ -f "$RESEED_REQUEST" ]; then
  {
    echo "=== $(date) menyemai basis data ==="
    stop_app
    cd "$APP_DIR" || exit 1
    if [ -f "$RESEED_REQUEST" ]; then
      node server/seed.js --reset
    else
      node server/seed.js
    fi
    echo "--- seed selesai (kode $?) ---"
    rm -f "$RESEED_REQUEST"
  } >> "$INSTALL_LOG" 2>&1
fi

# --- 4. Diminta menyalakan ulang? -------------------------------------------
if [ -f "$RESTART_REQUEST" ]; then
  stop_app
  rm -f "$RESTART_REQUEST"
  echo "=== $(date) diminta menyala ulang ===" >> "$LOG"
fi

# --- 5. Sudah berjalan? Keluar. ---------------------------------------------
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  exit 0
fi

# --- 6. Nyalakan. ------------------------------------------------------------
#  Seluruh descriptor yang tidak dibutuhkan ditutup untuk anaknya (0<&- dan
#  keluaran diarahkan ke berkas log), supaya proses ini tidak pernah menahan
#  apa pun milik cron — pelajaran yang sama dengan catatan kunci di atas.
cd "$APP_DIR" || exit 1
echo "=== menyalakan $(date) pada port $PORT ===" >> "$LOG"
nohup node server/index.js >> "$LOG" 2>&1 0<&- &
echo $! > "$PIDFILE"
