#!/bin/bash
# ============================================================================
#  QHSE ASDP — pemeriksaan dari sisi server.
#
#  Menguji dua lapis secara terpisah supaya penyebab kegagalan langsung
#  terlihat: proses Node pada 127.0.0.1:3500, dan jalur publik lewat Apache.
#  Bila yang lokal 200 tetapi yang publik bukan, masalahnya ada pada .htaccess
#  atau modul proxy Apache — bukan pada aplikasinya.
#
#  Dipicu oleh penanda ~/asdp-live.request, hasilnya ke ~/asdp-live.log.
# ============================================================================
LOG=/home/semestat/asdp-live.log
BASE_LOCAL=http://127.0.0.1:3500
BASE_PUBLIC=https://asdp.semestateknologiutama.com

: > "$LOG"
{
  echo "=== $(date) ==="
  echo
  echo "--- proses ---"
  if [ -f /home/semestat/asdp.pid ] && kill -0 "$(cat /home/semestat/asdp.pid)" 2>/dev/null; then
    PID=$(cat /home/semestat/asdp.pid)
    echo "berjalan, pid $PID"
    echo "RSS: $(awk '/VmRSS/{print $2" "$3}' /proc/"$PID"/status 2>/dev/null)"
  else
    echo "TIDAK berjalan"
  fi

  echo
  echo "--- langsung ke proses Node (127.0.0.1:3500) ---"
  for path in /api/health /api/public/plans /api/public/overview / /css/app.css /js/landing.js; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$BASE_LOCAL$path")
    echo "$code  $path"
  done

  echo
  echo "--- lewat Apache (URL publik) ---"
  for path in /api/health /api/public/plans / /js/landing.js; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 25 "$BASE_PUBLIC$path")
    echo "$code  $path"
  done

  echo
  echo "--- redirect HTTP -> HTTPS ---"
  curl -s -o /dev/null -w 'kode %{http_code} -> %{redirect_url}\n' -m 25 "http://asdp.semestateknologiutama.com/"

  echo
  echo "--- isi /api/health (publik) ---"
  curl -s -m 25 "$BASE_PUBLIC/api/health"
  echo

  echo
  echo "--- alur masuk lengkap (publik) ---"
  JAR=$(mktemp)
  LOGIN=$(curl -s -m 25 -c "$JAR" -o /dev/null -w '%{http_code}' \
    -X POST "$BASE_PUBLIC/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"corporate.qhse","password":"Asdp#2026Qhse"}')
  echo "login: $LOGIN"
  echo "meta:  $(curl -s -m 25 -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE_PUBLIC/api/meta")"
  echo "dashboard langganan: $(curl -s -m 25 -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE_PUBLIC/api/dashboard/subscription")"
  echo "MRR: $(curl -s -m 25 -b "$JAR" "$BASE_PUBLIC/api/dashboard/subscription" | head -c 160)"
  rm -f "$JAR"

  echo
  echo "--- header keamanan (publik) ---"
  curl -s -m 25 -D - -o /dev/null "$BASE_PUBLIC/" | grep -iE '^(HTTP/|content-security-policy|x-frame-options|x-content-type-options|referrer-policy|strict-transport)' | head -8

  echo
  echo "=== selesai $(date) ==="
} >> "$LOG" 2>&1
