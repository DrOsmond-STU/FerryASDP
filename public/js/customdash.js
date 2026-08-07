/**
 * Dashboard kustom: penampil dan penyunting.
 *
 * Penyunting bekerja pada salinan tata letak di memori. Tidak ada yang tersimpan
 * sampai tombol Simpan ditekan, sehingga menutup halaman di tengah penyuntingan
 * tidak pernah merusak dashboard yang sedang dipakai orang lain.
 *
 * Seret-lepas memakai HTML5 Drag and Drop bawaan peramban — bukan pustaka luar,
 * karena Content-Security-Policy aplikasi ini melarang skrip dari luar.
 */
import { api } from './api.js';
import {
  h, mount, clear, toast, modal, confirmDialog, spinner, emptyState, statusBadge,
  fmtNumber, fmtDecimal, fmtDate,
} from './ui.js';
import { lineChart, barList, donut, riskHeatmap, PALETTE } from './charts.js';
import { t, tp } from './i18n.js';

const num = (v) => (v === null || v === undefined ? '—' : fmtNumber(v));
const dec = (v, d = 2) => (v === null || v === undefined ? '—' : fmtDecimal(v, d));

/** Bawaan gaya sebuah widget baru. */
/**
 * Warna latar SENGAJA kosong pada bawaannya.
 *
 * Widget yang warnanya belum pernah dipilih harus ikut tema — latar putih
 * yang dipatok akan tetap putih ketika seluruh halaman berpindah ke mode
 * gelap, dan papan itu berubah menjadi deretan kartu terang yang menyilaukan
 * di atas bidang gelap. Yang dipilih administrator tetap dihormati apa
 * adanya; yang tidak pernah dipilih mengikuti palet.
 */
const DEFAULT_STYLE = () => ({
  accent: '#1189c1',
  gradient: true,
  gradientFrom: null,
  gradientTo: null,
  gradientAngle: 135,
  opacity: 1,
  textColor: null,
  titleColor: null,
  radius: 16,
  shadow: true,
  border: true,
});

let sources = null;
const loadSources = async () => {
  if (!sources) sources = await api.get('/api/custom-dashboards/sources');
  return sources;
};

/* ------------------------------------------------------------ gaya widget */

/**
 * Warna teks yang terbaca di atas warna latar tertentu.
 *
 * Diperlukan karena warna latar widget adalah nilai mutlak yang dipilih
 * administrator, sementara warna teks bawaan mengikuti tema terang/gelap
 * peramban. Tanpa perhitungan ini, memilih latar gelap pada tema terang
 * menghasilkan tulisan gelap di atas gelap — tidak terbaca sama sekali, dan
 * pembuatnya baru menyadarinya setelah dashboard itu dipakai orang lain.
 *
 * Ambang 0,55 pada luminansi relatif (WCAG) memisahkan latar yang membutuhkan
 * teks terang dari yang membutuhkan teks gelap.
 */
function readableOn(...colours) {
  const rgb = colours.map(parseHex).filter(Boolean);
  if (!rgb.length) return null;
  const mix = rgb.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]).map((v) => v / rgb.length);
  const lin = mix.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return luminance > 0.55 ? '#16283a' : '#f2f8fd';
}

function parseHex(v) {
  if (typeof v !== 'string') return null;
  const hex = v.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (full.length < 6) return null;
  const n = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Latar yang benar-benar dipilih administrator, bukan bawaan yang ikut tema. */
const chosenBackground = (s) => s.gradientFrom || s.gradientTo || null;

/**
 * Warna teks efektif sebuah widget: pilihan pengguna, kontras otomatis
 * terhadap latar yang dipilihnya, atau — bila latarnya ikut tema — tidak
 * ditentukan sama sekali supaya ikut warna teks tema.
 */
export function widgetText(style = {}) {
  const s = { ...DEFAULT_STYLE(), ...style };
  const auto = chosenBackground(s)
    ? (s.gradient ? readableOn(s.gradientFrom || s.gradientTo, s.gradientTo || s.gradientFrom) : readableOn(s.gradientFrom))
    : null;
  return { text: s.textColor || auto, title: s.titleColor || s.textColor || auto };
}

/**
 * Gaya disusun sebagai style inline, bukan kelas CSS: setiap widget punya
 * kombinasi warnanya sendiri dan jumlahnya tidak terbatas, sehingga membuat
 * satu kelas per kombinasi tidak mungkin.
 */
function widgetStyle(w) {
  const s = { ...DEFAULT_STYLE(), ...(w.style || {}) };
  const bits = [
    `grid-column:span ${Math.max(2, Math.min(w.layout?.span || 6, 12))}`,
    `border-radius:${s.radius}px`,
    `opacity:${s.opacity}`,
    `--w-accent:${s.accent}`,
  ];
  const chosen = chosenBackground(s);
  if (!chosen) bits.push('background:var(--q-gradient-surface)');
  else if (s.gradient) {
    bits.push(`background:linear-gradient(${s.gradientAngle}deg, ${s.gradientFrom || chosen} 0%, ${s.gradientTo || chosen} 100%)`);
  } else bits.push(`background:${chosen}`);
  if (!s.shadow) bits.push('box-shadow:none');
  if (!s.border) bits.push('border-color:transparent');
  const colours = widgetText(s);
  if (colours.text) bits.push(`color:${colours.text}`);
  const height = w.layout?.height;
  if (height && height !== 'auto') bits.push(`min-height:${height}px`);
  return bits.join(';');
}

/* -------------------------------------------------------- isi tiap widget */

function widgetBody(w, data) {
  if (!data) return h('div.empty', { text: t('Belum dihitung.') });
  if (!data.ok) return h('div.alert.warn', { text: data.reason || 'Widget tidak dapat ditampilkan.' });

  const accent = w.style?.accent || PALETTE[0];

  switch (data.kind) {
    case 'note':
      return h('div', { style: 'white-space:pre-wrap', text: data.body || '—' });

    case 'stat':
      return h('div.widget-figure', {},
        h('strong', { style: `color:${accent}`, text: dec(data.value, Number.isInteger(data.value) ? 0 : 2) }),
        data.unit ? h('span.small.muted', { text: data.unit }) : null);

    case 'line':
      return lineChart(data.series || [], { color: accent });

    case 'bar':
      return barList(data.rows || [], { color: accent, format: num });

    case 'donut':
      return donut(data.rows || [], { format: num });

    case 'heatmap':
      return riskHeatmap(data.grid);

    case 'table': {
      if (!data.rows?.length) return emptyState();
      const cols = data.columns || [];
      return h('div.table-wrap', {}, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { text: t('Kode') }), h('th', { text: t('Status') }),
          ...cols.map((c) => h('th', { text: c.label })))),
        h('tbody', {}, ...data.rows.map((r) => h('tr.clickable', {
          onclick: () => { location.hash = `#/m/${data.module}/${r.id}`; },
        },
          h('td.mono.small', { text: r.code || '—' }),
          h('td', {}, statusBadge(r.status)),
          ...cols.map((c) => h('td.small', { text: formatCell(c, r[c.name]) })))))));
    }

    default:
      return h('div.empty', { text: t('Jenis widget tidak dikenal.') });
  }
}

function formatCell(col, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (col.type === 'date' || col.type === 'datetime') return fmtDate(value);
  if (col.type === 'number' || col.type === 'currency') return fmtNumber(value);
  if (col.type === 'bool') return value ? 'Ya' : 'Tidak';
  return String(value).slice(0, 80);
}

/* ------------------------------------------------------------- penampilan */

export async function renderCustomDashboard(container, key) {
  mount(container, spinner('Memuat dashboard…'));
  const def = await api.get(`/api/custom-dashboards/${key}`);
  const dataById = new Map((def.data || []).map((d) => [d.id, d]));
  const editable = def.canEdit;

  const head = h('div.page-head', {},
    h('div.grow', {},
      h('h1', {}, h('span', { text: def.icon || '📌' }), def.name),
      h('div.small.muted', { text: def.description || `${def.layout.length} ${t('widget')} · ${t('disusun manual')}` })),
    editable
      ? h('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap' },
        h('button.btn-primary', { onclick: () => openEditor(container, def), text: t('✎ Sunting dashboard') }),
        h('button.btn-danger', {
          onclick: () => deleteDashboard(def.key, def.name, () => { location.hash = '#/dashboard/executive'; }),
          text: t('Hapus'),
        }))
      : null);

  const grid = h('div.dash-grid', {}, ...def.layout.map((w) => h('article.card.widget', { style: widgetStyle(w) },
    h('h3', { style: `color:${widgetText(w.style).title || 'inherit'}`, text: w.title }),
    widgetBody(w, dataById.get(w.id)))));

  mount(container, head, def.layout.length ? grid : emptyState('Dashboard ini belum memiliki widget.'));
}

/* -------------------------------------------------------------- penyunting */

/**
 * Penyunting bekerja pada `draft`, salinan dalam memori. Setiap perubahan
 * menggambar ulang papan dan menghitung ulang widget yang berubah sumbernya.
 */
function openEditor(container, def) {
  const draft = {
    name: def.name,
    icon: def.icon,
    description: def.description,
    published: def.published,
    layout: JSON.parse(JSON.stringify(def.layout || [])),
  };
  const dataById = new Map((def.data || []).map((d) => [d.id, d]));
  let selectedId = draft.layout[0]?.id || null;
  let dragFrom = null;

  const board = h('div.dash-grid.editing');
  const panel = h('aside.widget-panel');
  const root = h('div.editor-layout', {}, board, panel);

  const head = h('div.page-head', {},
    h('div.grow', {},
      h('h1', {}, h('span', { text: '✎' }), `${t('Menyunting')}: ${def.name}`),
      h('div.small.muted', { text: t('Seret kepala widget untuk memindahkan. Klik widget untuk mengubah warna, ukuran dan sumber datanya.') })),
    h('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap' },
      h('button', { onclick: () => addWidget(), text: t('＋ Tambah widget') }),
      h('button', { onclick: () => dashboardSettings(), text: t('⚙ Pengaturan') }),
      h('button', { onclick: () => renderCustomDashboard(container, def.key), text: t('Batal') }),
      h('button.btn-primary', { onclick: save, text: t('💾 Simpan') })));

  mount(container, head, root);
  redraw();

  /* --------------------------------------------------------------- papan */

  function redraw() {
    clear(board);
    if (!draft.layout.length) {
      board.appendChild(h('div.empty', { style: 'grid-column:span 12', text: t('Belum ada widget. Tekan “Tambah widget”.') }));
    }
    draft.layout.forEach((w, index) => board.appendChild(widgetCard(w, index)));
    drawPanel();
  }

  function widgetCard(w, index) {
    const card = h('article.card.widget.widget-edit', {
      style: widgetStyle(w),
      class: w.id === selectedId ? 'selected' : '',
      onclick: () => { selectedId = w.id; redraw(); },
    });

    // Hanya kepalanya yang dapat diseret. Bila seluruh kartu draggable, memilih
    // teks di dalam widget menjadi mustahil.
    const handle = h('div.widget-handle', { draggable: 'true', title: t('Seret untuk memindahkan') },
      h('span.grip', { text: '⠿' }),
      h('strong', { style: `color:${widgetText(w.style).title || 'inherit'}`, text: w.title }),
      h('span.spacer'),
      h('button.btn-ghost.small', {
        title: t('Gandakan'),
        onclick: (e) => { e.stopPropagation(); duplicate(index); },
        text: '⧉',
      }),
      h('button.btn-ghost.small', {
        title: t('Hapus widget'),
        onclick: (e) => { e.stopPropagation(); draft.layout.splice(index, 1); selectedId = draft.layout[0]?.id || null; redraw(); },
        text: '✕',
      }));

    handle.addEventListener('dragstart', (e) => {
      dragFrom = index;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox menolak memulai seret tanpa data apa pun pada dataTransfer.
      e.dataTransfer.setData('text/plain', String(index));
    });
    handle.addEventListener('dragend', () => {
      dragFrom = null;
      card.classList.remove('dragging');
      board.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
    });

    card.addEventListener('dragover', (e) => {
      if (dragFrom === null || dragFrom === index) return;
      e.preventDefault();
      card.classList.add('drop-target');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragFrom === null || dragFrom === index) return;
      const [moved] = draft.layout.splice(dragFrom, 1);
      draft.layout.splice(index, 0, moved);
      selectedId = moved.id;
      dragFrom = null;
      redraw();
    });

    card.appendChild(handle);
    card.appendChild(widgetBody(w, dataById.get(w.id)));
    return card;
  }

  function duplicate(index) {
    const copy = JSON.parse(JSON.stringify(draft.layout[index]));
    copy.id = `w${Date.now().toString(36)}`;
    copy.title = `${copy.title} (salinan)`;
    draft.layout.splice(index + 1, 0, copy);
    selectedId = copy.id;
    refresh(copy).then(redraw);
  }

  /* ------------------------------------------------------------- panel */

  function drawPanel() {
    clear(panel);
    const w = draft.layout.find((x) => x.id === selectedId);
    if (!w) {
      panel.appendChild(h('div.empty', { text: t('Pilih satu widget untuk menyuntingnya.') }));
      return;
    }
    const s = { ...DEFAULT_STYLE(), ...(w.style || {}) };
    w.style = s;

    const apply = () => redraw();
    const applyAndRefresh = () => refresh(w).then(redraw);

    panel.appendChild(h('h3', { text: t('Widget terpilih') }));

    panel.appendChild(field('Judul', h('input', {
      value: w.title,
      oninput: (e) => { w.title = e.target.value; },
      onchange: apply,
    })));

    /* ---- ukuran ---- */
    panel.appendChild(h('h4', { text: `2 & 3. ${t('Ukuran')}` }));
    panel.appendChild(field(`${t('Lebar')} — ${w.layout.span} ${t('dari 12 kolom')}`, slider(2, 12, 1, w.layout.span, (v, label) => {
      w.layout.span = v;
      label.textContent = `${t('Lebar')} — ${v} ${t('dari 12 kolom')}`;
      redrawStyleOnly();
    })));

    const autoHeight = w.layout.height === 'auto';
    panel.appendChild(field('Tinggi', h('div', {},
      h('label.checkbox', {},
        h('input', {
          type: 'checkbox',
          checked: autoHeight,
          onchange: (e) => { w.layout.height = e.target.checked ? 'auto' : 260; drawPanel(); redrawStyleOnly(); },
        }),
        h('span.small', { text: t('Menyesuaikan isi') })),
      autoHeight ? null : slider(80, 900, 20, Number(w.layout.height) || 260, (v) => {
        w.layout.height = v;
        redrawStyleOnly();
      }))));

    /* ---- warna ---- */
    panel.appendChild(h('h4', { text: `1. ${t('Warna, gradasi & transparansi')}` }));
    panel.appendChild(field('Warna aksen (grafik & angka)', colour(s.accent, (v) => { s.accent = v; apply(); })));

    panel.appendChild(field('Gradasi', h('div', {},
      h('label.checkbox', {},
        h('input', {
          type: 'checkbox',
          checked: s.gradient,
          onchange: (e) => { s.gradient = e.target.checked; drawPanel(); redrawStyleOnly(); },
        }),
        h('span.small', { text: t('Gunakan gradasi dua warna') })))));

    panel.appendChild(field(t(s.gradient ? 'Warna awal gradasi' : 'Warna latar'), colour(s.gradientFrom || '#ffffff', (v) => { s.gradientFrom = v; redrawStyleOnly(); })));
    if (s.gradient) {
      panel.appendChild(field(t('Warna akhir gradasi'), colour(s.gradientTo || '#eef5fa', (v) => { s.gradientTo = v; redrawStyleOnly(); })));
      panel.appendChild(field(`${t('Sudut gradasi')} — ${s.gradientAngle}°`, slider(0, 360, 5, s.gradientAngle, (v, label) => {
        s.gradientAngle = v;
        label.textContent = `${t('Sudut gradasi')} — ${v}°`;
        redrawStyleOnly();
      })));
    }

    // Jalan kembali dari warna tetap ke warna yang ikut tema. Tanpa tombol ini
    // sekali warna dipilih, widget itu selamanya terang — termasuk ketika
    // seluruh papan dibaca dalam mode gelap.
    panel.appendChild(field(t('Latar'), h('button.btn-sm', {
      type: 'button',
      disabled: !chosenBackground(s),
      onclick: () => { s.gradientFrom = null; s.gradientTo = null; drawPanel(); redrawStyleOnly(); },
      text: chosenBackground(s) ? t('Kembalikan mengikuti tema') : t('Sedang mengikuti tema'),
    })));

    panel.appendChild(field(`${t('Transparansi')} — ${Math.round(s.opacity * 100)}%`, slider(15, 100, 5, Math.round(s.opacity * 100), (v, label) => {
      s.opacity = v / 100;
      label.textContent = `${t('Transparansi')} — ${v}%`;
      redrawStyleOnly();
    })));

    panel.appendChild(field('Warna teks', h('div', { style: 'display:flex;gap:.4rem;align-items:center' },
      colour(s.textColor || '#1b2a3b', (v) => { s.textColor = v; redrawStyleOnly(); }),
      h('button.btn-ghost.small', { onclick: () => { s.textColor = null; drawPanel(); redrawStyleOnly(); }, text: t('Bawaan tema') }))));

    panel.appendChild(field('Warna judul', h('div', { style: 'display:flex;gap:.4rem;align-items:center' },
      colour(s.titleColor || '#0b6d9b', (v) => { s.titleColor = v; redrawStyleOnly(); }),
      h('button.btn-ghost.small', { onclick: () => { s.titleColor = null; drawPanel(); redrawStyleOnly(); }, text: t('Bawaan tema') }))));

    panel.appendChild(field(`${t('Kelengkungan sudut')} — ${s.radius}px`, slider(0, 40, 1, s.radius, (v, label) => {
      s.radius = v;
      label.textContent = `${t('Kelengkungan sudut')} — ${v}px`;
      redrawStyleOnly();
    })));

    panel.appendChild(h('div', { style: 'display:flex;gap:1rem;flex-wrap:wrap;margin:.4rem 0 .8rem' },
      h('label.checkbox', {}, h('input', {
        type: 'checkbox', checked: s.shadow, onchange: (e) => { s.shadow = e.target.checked; redrawStyleOnly(); },
      }), h('span.small', { text: t('Bayangan') })),
      h('label.checkbox', {}, h('input', {
        type: 'checkbox', checked: s.border, onchange: (e) => { s.border = e.target.checked; redrawStyleOnly(); },
      }), h('span.small', { text: t('Garis tepi') }))));

    panel.appendChild(h('div', { style: 'display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:1rem' },
      ...PRESETS.map((p) => h('button.btn-ghost.small', {
        title: p.name,
        style: `background:linear-gradient(135deg, ${p.from} 0%, ${p.to} 100%);border-color:${p.accent}`,
        onclick: () => {
          Object.assign(s, { gradient: true, gradientFrom: p.from, gradientTo: p.to, accent: p.accent, gradientAngle: 135 });
          drawPanel();
          redrawStyleOnly();
        },
        text: p.name,
      }))));

    /* ---- sumber data ---- */
    panel.appendChild(h('h4', { text: t('Sumber data') }));
    panel.appendChild(h('button', { style: 'width:100%', onclick: () => editSource(w, applyAndRefresh), text: `${kindName(w.kind)} — ${t('ubah sumber')}` }));
    panel.appendChild(h('p.small.muted', { text: sourceSummary(w) }));
  }

  /**
   * Menggambar ulang hanya atribut style tiap kartu.
   * Menggambar ulang seluruh papan pada setiap gerakan penggeser akan
   * mematikan fokus penggeser itu sendiri, sehingga seretannya terputus.
   */
  function redrawStyleOnly() {
    const cards = board.querySelectorAll('.widget-edit');
    draft.layout.forEach((w, i) => {
      const card = cards[i];
      if (!card) return;
      card.setAttribute('style', widgetStyle(w));
      const title = card.querySelector('.widget-handle strong');
      if (title) {
        title.textContent = w.title;
        title.style.color = widgetText(w.style).title || '';
      }
    });
  }

  /* --------------------------------------------------------- tambah widget */

  async function addWidget() {
    const catalogue = await loadSources();
    const w = {
      id: `w${Date.now().toString(36)}`,
      title: t('Widget baru'),
      kind: 'stat',
      body: '',
      source: { module: catalogue.modules[0]?.key, metric: 'count', period: 'year', limit: 10 },
      layout: { span: 3, height: 'auto' },
      style: DEFAULT_STYLE(),
    };
    editSource(w, async () => {
      draft.layout.push(w);
      selectedId = w.id;
      await refresh(w);
      redraw();
    }, true);
  }

  /* ------------------------------------------------------------ sumber data */

  function editSource(w, done, isNew = false) {
    loadSources().then((catalogue) => {
      const working = JSON.parse(JSON.stringify(w));
      const form = h('div');

      const titleInput = h('input', { value: working.title, oninput: (e) => { working.title = e.target.value; } });
      const kindSelect = h('select', {
        onchange: (e) => {
          working.kind = e.target.value;
          const kind = catalogue.kinds.find((k) => k.key === working.kind);
          working.source.metric = kind.metrics[0];
          build();
        },
      }, ...catalogue.kinds.map((k) => h('option', { value: k.key, selected: k.key === working.kind, text: `${k.icon} ${k.name}` })));

      const detail = h('div');
      form.appendChild(h('div.field', {}, h('label', { text: t('Judul widget') }), titleInput));
      form.appendChild(h('div.field', {}, h('label', { text: t('Bentuk tampilan') }), kindSelect));
      form.appendChild(detail);

      function build() {
        clear(detail);
        if (working.kind === 'note') {
          detail.appendChild(h('div.field', {}, h('label', { text: t('Isi catatan') }),
            h('textarea', { rows: 5, value: working.body || '', oninput: (e) => { working.body = e.target.value; } })));
          return;
        }
        if (working.kind === 'heatmap') {
          detail.appendChild(h('p.small.muted', { text: t('Peta panas menghimpun seluruh register risiko dan HIRA yang boleh Anda lihat. Tidak ada pengaturan tambahan.') }));
          return;
        }

        const kind = catalogue.kinds.find((k) => k.key === working.kind);
        const modSelect = h('select', { onchange: (e) => { working.source.module = e.target.value; build(); } },
          ...catalogue.modules.map((m) => h('option', { value: m.key, selected: m.key === working.source.module, text: `${m.icon} ${m.name}` })));
        detail.appendChild(h('div.field', {}, h('label', { text: t('Modul sumber') }), modSelect));

        const mod = catalogue.modules.find((m) => m.key === working.source.module) || catalogue.modules[0];

        /**
         * Menyetel nilai awal sebuah pilihan ke opsi pertama bila yang tersimpan
         * tidak ada dalam daftar. Tanpa ini, pengguna yang menerima pilihan
         * bawaan tanpa menyentuh dropdown-nya mengirim nilai kosong, dan server
         * menolak widgetnya dengan pesan "kolom tidak dikenal" — padahal
         * layarnya jelas memperlihatkan sebuah kolom terpilih. Sama pentingnya
         * saat modul diganti: kolom milik modul lama harus gugur.
         */
        const ensure = (key, options) => {
          if (!options.some((o) => o.name === working.source[key])) {
            working.source[key] = options[0]?.name ?? null;
          }
          return working.source[key];
        };

        if (kind.metrics.length > 1) {
          detail.appendChild(h('div.field', {}, h('label', { text: t('Cara menghitung') }),
            h('select', { onchange: (e) => { working.source.metric = e.target.value; build(); } },
              ...kind.metrics.map((m) => h('option', { value: m, selected: m === working.source.metric, text: METRIC_LABEL[m] })))));
        } else {
          working.source.metric = kind.metrics[0];
        }

        if (['sum', 'avg'].includes(working.source.metric)) {
          if (!mod.numericFields.length) {
            detail.appendChild(h('div.alert.warn', { text: `${mod.name} tidak memiliki kolom angka yang dapat dijumlahkan.` }));
          }
          detail.appendChild(pick('Kolom angka', mod.numericFields, ensure('field', mod.numericFields), (v) => { working.source.field = v; }));
        }
        if (working.source.metric === 'groupBy') {
          detail.appendChild(pick('Dikelompokkan menurut', mod.groupFields, ensure('groupField', mod.groupFields), (v) => { working.source.groupField = v; }));
        }
        if (working.source.metric === 'trend') {
          detail.appendChild(pick('Kolom tanggal', mod.dateFields, ensure('dateField', mod.dateFields), (v) => { working.source.dateField = v; }));
          const aggOptions = [{ name: '', label: t('Hitung jumlah rekaman') }, ...mod.numericFields];
          detail.appendChild(pick('Menjumlahkan kolom (opsional)', aggOptions, ensure('aggField', aggOptions) || '', (v) => { working.source.aggField = v || null; }));
        }
        if (['count', 'sum', 'avg', 'groupBy'].includes(working.source.metric)) {
          const periodOptions = [{ name: '', label: t('Tidak menyaring periode') }, ...mod.dateFields];
          detail.appendChild(pick('Kolom tanggal untuk penyaring periode', periodOptions,
            ensure('dateField', periodOptions) || '', (v) => { working.source.dateField = v || null; }));
          detail.appendChild(h('div.field', {}, h('label', { text: t('Periode') }),
            h('select', { onchange: (e) => { working.source.period = e.target.value; } },
              h('option', { value: 'all', selected: working.source.period !== 'year', text: t('Seluruh periode') }),
              h('option', { value: 'year', selected: working.source.period === 'year', text: t('Tahun berjalan saja') }))));
        }
        if (['groupBy', 'list'].includes(working.source.metric)) {
          detail.appendChild(h('div.field', {}, h('label', { text: t('Jumlah baris maksimum') }),
            h('input', { type: 'number', min: 1, max: 30, value: working.source.limit || 10, oninput: (e) => { working.source.limit = Number(e.target.value); } })));
        }
      }

      build();

      modal({
        title: isNew ? 'Tambah widget' : 'Sumber data widget',
        body: form,
        actions: [{
          label: isNew ? 'Tambahkan' : 'Terapkan',
          class: 'btn-primary',
          onClick: async (close) => {
            const preview = await api.post('/api/custom-dashboards/preview', { widget: working });
            if (!preview.result?.ok) {
              toast(preview.result?.reason || 'Widget belum dapat dihitung.', 'err');
              return;
            }
            Object.assign(w, working);
            dataById.set(w.id, { id: w.id, ...preview.result });
            close();
            done();
          },
        }],
      });
    });
  }

  async function refresh(w) {
    const preview = await api.post('/api/custom-dashboards/preview', { widget: w }).catch(() => null);
    if (preview?.result) dataById.set(w.id, { id: w.id, ...preview.result });
  }

  /* ---------------------------------------------------------- pengaturan */

  function dashboardSettings() {
    const name = h('input', { value: draft.name });
    const icon = h('input', { value: draft.icon || '📌', maxlength: 4 });
    const desc = h('textarea', { rows: 2, value: draft.description || '' });
    const published = h('input', { type: 'checkbox', checked: draft.published !== false });
    modal({
      title: t('Pengaturan dashboard'),
      body: h('div', {},
        h('div.field.required', {}, h('label', { text: t('Nama') }), name),
        h('div.field', {}, h('label', { text: t('Ikon') }), icon),
        h('div.field', {}, h('label', { text: t('Keterangan') }), desc),
        h('label.checkbox', {}, published, h('span.small', { text: t('Tampilkan untuk seluruh pengguna') }))),
      actions: [{
        label: t('Terapkan'),
        class: 'btn-primary',
        onClick: (close) => {
          draft.name = name.value.trim() || draft.name;
          draft.icon = icon.value.trim() || '📌';
          draft.description = desc.value.trim();
          draft.published = published.checked;
          close();
          redraw();
        },
      }],
    });
  }

  /* --------------------------------------------------------------- simpan */

  async function save() {
    try {
      await api.put(`/api/custom-dashboards/${def.key}`, {
        name: draft.name,
        icon: draft.icon,
        description: draft.description,
        published: draft.published,
        layout: draft.layout,
      });
      toast('Dashboard tersimpan.', 'ok');
      window.dispatchEvent(new CustomEvent('qhse:dashboards-changed'));
      await renderCustomDashboard(container, def.key);
    } catch (err) {
      toast(err.message, 'err');
    }
  }
}

/* ------------------------------------------------------------- pembantu UI */

const METRIC_LABEL = {
  count: 'Menghitung jumlah rekaman',
  sum: 'Menjumlahkan sebuah kolom',
  avg: 'Merata-ratakan sebuah kolom',
  groupBy: 'Mengelompokkan menurut kolom',
  trend: 'Tren 12 bulan',
  list: 'Rekaman terbaru',
  risk: 'Peta panas risiko',
  none: 'Tanpa data',
};

const PRESETS = [
  { name: 'Biru', from: '#ffffff', to: '#e6f2fa', accent: '#1189c1' },
  { name: 'Laut', from: '#0b2740', to: '#1189c1', accent: '#4bcbfb' },
  { name: 'Hijau', from: '#ffffff', to: '#e4f6ec', accent: '#12a150' },
  { name: 'Jingga', from: '#ffffff', to: '#fdf0e0', accent: '#f7941d' },
  { name: 'Merah', from: '#ffffff', to: '#fbe9ea', accent: '#d13438' },
  { name: 'Ungu', from: '#ffffff', to: '#f0eafb', accent: '#7c3aed' },
];

const kindName = (key) => ({
  stat: 'Angka ringkas', line: 'Grafik garis', bar: 'Peringkat batang',
  donut: 'Grafik donat', table: 'Tabel rekaman', heatmap: 'Peta panas risiko', note: 'Catatan',
}[key] || key);

function sourceSummary(w) {
  if (w.kind === 'note') return 'Teks bebas.';
  if (w.kind === 'heatmap') return 'Seluruh register risiko dan HIRA dalam cakupan akses Anda.';
  const s = w.source || {};
  const bits = [s.module, METRIC_LABEL[s.metric]];
  if (s.field) bits.push(s.field);
  if (s.groupField) bits.push(`per ${s.groupField}`);
  if (s.period === 'year') bits.push('tahun berjalan');
  return bits.filter(Boolean).join(' · ');
}

const field = (label, control) => {
  const el = h('div.field', {}, h('label', { text: label }), control);
  return el;
};

/** Penggeser yang melaporkan nilainya sambil digeser, bukan setelah dilepas. */
function slider(min, max, step, value, onInput) {
  const input = h('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => {
    const label = input.closest('.field')?.querySelector('label');
    onInput(Number(input.value), label || document.createElement('span'));
  });
  return input;
}

function colour(value, onChange) {
  const input = h('input', { type: 'color', value: normaliseHex(value) });
  input.addEventListener('input', () => onChange(input.value));
  return input;
}

/** <input type=color> menolak nilai selain #rrggbb. */
function normaliseHex(v) {
  if (typeof v !== 'string') return '#1189c1';
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  if (/^#[0-9a-fA-F]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return '#1189c1';
}

function pick(label, options, value, onChange) {
  return h('div.field', {}, h('label', { text: label }),
    h('select', { onchange: (e) => onChange(e.target.value) },
      ...options.map((o) => h('option', { value: o.name, selected: o.name === value, text: o.label }))));
}

/* ------------------------------------------------- daftar & pembuatan baru */

export async function listCustomDashboards() {
  return api.get('/api/custom-dashboards').catch(() => ({ dashboards: [], canEdit: false }));
}

export function newDashboardDialog(onCreated) {
  const name = h('input', { placeholder: t('Dashboard Direksi') });
  const icon = h('input', { value: '📌', maxlength: 4 });
  const desc = h('textarea', { rows: 2, placeholder: t('Ringkasan singkat isi dashboard ini.') });
  modal({
    title: t('Dashboard baru'),
    body: h('div', {},
      h('div.field.required', {}, h('label', { text: t('Nama dashboard') }), name),
      h('div.field', {}, h('label', { text: t('Ikon') }), icon),
      h('div.field', {}, h('label', { text: t('Keterangan') }), desc),
      h('p.small.muted', { text: t('Setelah dibuat, dashboard akan langsung terbuka dalam mode penyuntingan.') })),
    actions: [{
      label: t('Buat'),
      class: 'btn-primary',
      onClick: async (close) => {
        if (!name.value.trim()) return toast('Nama dashboard wajib diisi.', 'err');
        try {
          const res = await api.post('/api/custom-dashboards', {
            name: name.value.trim(), icon: icon.value.trim() || '📌', description: desc.value.trim(), layout: [],
          });
          close();
          window.dispatchEvent(new CustomEvent('qhse:dashboards-changed'));
          onCreated(res.key);
        } catch (err) {
          toast(err.message, 'err');
        }
      },
    }],
  });
}

export function deleteDashboard(key, name, onDeleted) {
  confirmDialog(
    tp('Dashboard “{name}” beserta seluruh widget-nya akan dihapus. Data rekaman tidak terpengaruh.', { name }),
    async () => {
      try {
        await api.del(`/api/custom-dashboards/${key}`);
        toast('Dashboard dihapus.', 'ok');
        window.dispatchEvent(new CustomEvent('qhse:dashboards-changed'));
        onDeleted?.();
      } catch (err) {
        toast(err.message, 'err');
      }
    },
  );
}
