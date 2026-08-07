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
  for path in /api/health /api/public/plans / /js/landing.js /js/customdash.js /js/i18n.js; do
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

  # Modul baru tidak cukup diperiksa dengan kode 200: tabel yang baru dibuat
  # menjawab 200 dengan seluruh angka nol. Karena itu isi jawabannya ikut
  # dicetak — kalau penyemaian aditif tidak jalan, terlihat di sini.
  echo
  echo "--- kompetensi & pelatihan (kelompok P) ---"
  echo "dashboard pelatihan: $(curl -s -m 25 -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE_PUBLIC/api/dashboard/training")"
  echo "kartu: $(curl -s -m 25 -b "$JAR" "$BASE_PUBLIC/api/dashboard/training" | head -c 420)"
  echo
  echo "katalog: $(curl -s -m 25 -b "$JAR" "$BASE_PUBLIC/api/modules/training_master/records?size=1" | head -c 90)"
  echo "matriks: $(curl -s -m 25 -b "$JAR" "$BASE_PUBLIC/api/modules/training_matrix/records?size=1" | head -c 90)"
  echo "gap:     $(curl -s -m 25 -b "$JAR" "$BASE_PUBLIC/api/modules/skill_gap/records?size=1" | head -c 90)"
  echo "sertif:  $(curl -s -m 25 -b "$JAR" "$BASE_PUBLIC/api/modules/employee_certification/records?size=1" | head -c 90)"

  # Kartu skor yang indikatornya belum bertanda perspektif akan menjawab 200
  # dengan empat perspektif kosong. Skor dan jumlah indikatornya ikut dicetak.
  echo
  echo "--- kartu skor berimbang & analitik ---"
  echo "dashboard bsc: $(curl -s -m 25 -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE_PUBLIC/api/dashboard/bsc")"
  curl -s -m 25 -b "$JAR" "$BASE_PUBLIC/api/dashboard/bsc" \
    | sed -e 's/,"kpis":\[[^]]*\]//g' | head -c 700
  echo
  echo "dashboard analitik: $(curl -s -m 25 -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE_PUBLIC/api/dashboard/analytics")"
  echo "kartu: $(curl -s -m 25 -b "$JAR" "$BASE_PUBLIC/api/dashboard/analytics" | head -c 320)"
  echo
  echo "kpi ber-perspektif: $(curl -s -m 25 -b "$JAR" "$BASE_PUBLIC/api/modules/quality_objective/records?size=1" | head -c 90)"

  # Dashboard kustom disimpan sebagai data. Yang dicetak bukan hanya kode 200
  # melainkan jumlah widget dan hasil hitung tiap widget, karena tata letak yang
  # tersimpan tanpa data terhitung akan tetap menjawab 200 dengan papan kosong.
  echo
  echo "--- dashboard kustom ---"
  echo "daftar: $(curl -s -m 25 -b "$JAR" "$BASE_PUBLIC/api/custom-dashboards" | head -c 240)"
  echo
  echo "isi: $(curl -s -m 25 -b "$JAR" "$BASE_PUBLIC/api/custom-dashboards/ringkasan-direksi" \
    | sed -e 's/"layout":\[.*\],"theme"/"layout":[..],"theme"/' | head -c 620)"
  echo
  echo "katalog sumber widget: $(curl -s -m 25 -b "$JAR" "$BASE_PUBLIC/api/custom-dashboards/sources" | head -c 120)"

  # Dwibahasa diperiksa dengan membandingkan jawaban yang sama pada dua bahasa.
  # Kalau kamusnya tidak terpasang, keduanya akan tampil identik — dan itu
  # tidak dapat dibedakan dari "sudah jalan" bila hanya kode 200 yang dilihat.
  echo
  echo "--- dwibahasa ---"
  for L in id en; do
    M=$(curl -s -m 40 -b "$JAR" "$BASE_PUBLIC/api/meta?lang=$L")
    echo "[$L] $(echo "$M" | grep -o '"lang":"[a-z]*"' | head -1)"
    echo "[$L] modul    : $(echo "$M" | grep -o '"key":"incident","name":"[^"]*","nameId":"[^"]*"' | head -1)"
    echo "[$L] kelompok : $(echo "$M" | grep -o '"code":"A","key":"governance","name":"[^"]*"' | head -1)"
    echo "[$L] peran    : $(echo "$M" | grep -o '"key":"sysadmin","level":1,"name":"[^"]*"' | head -1)"
  done
  rm -f "$JAR"

  echo
  echo "--- halaman depan dwibahasa (tanpa sesi) ---"
  # Halaman depan dilihat sebelum ada sesi, jadi bahasanya dikirim sebagai
  # parameter. Kalau dua bahasa menjawab teks yang sama persis, kamusnya tidak
  # terpasang - dan itu tidak terlihat dari kode 200 saja.
  for L in id en; do
    O=$(curl -s -m 25 "$BASE_PUBLIC/api/public/overview?lang=$L")
    P=$(curl -s -m 25 "$BASE_PUBLIC/api/public/plans?lang=$L")
    echo "[$L] kelompok A : $(echo "$O" | grep -o '"code":"A","key":"governance","name":"[^"]*"' | head -1)"
    echo "[$L] regulator  : $(echo "$O" | grep -o '"name":"[^"]*","items"' | head -1)"
    echo "[$L] paket      : $(echo "$P" | grep -o '"tagline":"[^"]*"' | head -1)"
    echo "[$L] dukungan   : $(echo "$P" | grep -o '"supportLevel":"[^"]*"' | head -1)"
  done

  echo
  echo "--- label dashboard ikut berpindah bahasa ---"
  JAR2=$(mktemp)
  curl -s -m 25 -c "$JAR2" -o /dev/null -X POST "$BASE_PUBLIC/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"corporate.qhse","password":"Asdp#2026Qhse"}'
  for L in id en; do
    echo "[$L] jenis insiden : $(curl -s -m 25 -b "$JAR2" "$BASE_PUBLIC/api/dashboard/incident?lang=$L" | grep -o '"byType":\[[^]]*\]' | head -c 150)"
    echo "[$L] status KPI    : $(curl -s -m 25 -b "$JAR2" "$BASE_PUBLIC/api/dashboard/bsc?lang=$L" | grep -o '"byStatus":\[[^]]*\]' | head -c 150)"
  done
  rm -f "$JAR2"

  echo
  echo "--- berkas antarmuka sakelar bahasa ---"
  echo "ui.js memuat languageSwitch : $(curl -s -m 25 "$BASE_PUBLIC/js/ui.js" | grep -c 'languageSwitch')"
  echo "app.js memasang di bilah atas: $(curl -s -m 25 "$BASE_PUBLIC/js/app.js" | grep -c 'languageSwitch(switchLanguage)')"
  echo "landing.js memasang sakelar  : $(curl -s -m 25 "$BASE_PUBLIC/js/landing.js" | grep -c 'languageSwitch(')"
  echo "app.css memuat .langswitch   : $(curl -s -m 25 "$BASE_PUBLIC/css/app.css" | grep -c 'langswitch')"

  echo
  echo "--- header keamanan (publik) ---"
  curl -s -m 25 -D - -o /dev/null "$BASE_PUBLIC/" | grep -iE '^(HTTP/|content-security-policy|x-frame-options|x-content-type-options|referrer-policy|strict-transport)' | head -8

  echo
  echo "=== selesai $(date) ==="
} >> "$LOG" 2>&1
