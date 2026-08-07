/**
 * Dwibahasa: Indonesia (sumber) dan Inggris.
 *
 * Bahasa Indonesia adalah sumber kebenaran. Seluruh label, opsi pilihan dan
 * nama status ditulis dalam bahasa Indonesia di dalam registry, lalu
 * diterjemahkan ke bahasa Inggris melalui kamus yang dikunci oleh teks
 * Indonesianya sendiri.
 *
 * Dua akibat penting dari keputusan itu:
 *
 *  1. Registry tidak perlu disentuh untuk menambah bahasa. Menerjemahkan satu
 *     istilah cukup menambah satu baris di kamus, dan istilah yang sama pada
 *     116 modul ikut berubah sekaligus.
 *  2. Istilah yang belum diterjemahkan **jatuh kembali ke bahasa Indonesia**,
 *     bukan menjadi kosong atau menampilkan kunci mentah. Antarmuka bisa
 *     bercampur untuk sementara, tetapi tidak pernah rusak — dan berkas
 *     `scripts/i18n-coverage.js` memperlihatkan persis apa yang masih tertinggal.
 *
 * Terjemahan dikerjakan di server, bukan di klien, supaya seluruh permukaan
 * yang dibangkitkan dari metadata — formulir, tabel, penyaring, ekspor CSV —
 * ikut berpindah bahasa tanpa satu pun perubahan di sisi antarmuka.
 */
import { EN } from './i18n/en.js';

export const LANGS = ['id', 'en'];
export const DEFAULT_LANG = 'id';

export const isLang = (v) => LANGS.includes(v);

/** Bahasa permintaan: pilihan pengguna, lalu parameter URL, lalu Accept-Language. */
export function pickLang(req) {
  const q = req?.query?.lang;
  if (isLang(q)) return q;
  if (isLang(req?.user?.language)) return req.user.language;
  const header = String(req?.headers?.['accept-language'] || '').toLowerCase();
  if (header.startsWith('en')) return 'en';
  return DEFAULT_LANG;
}

/** Satu istilah. Yang belum ada di kamus dikembalikan apa adanya. */
export function tr(text, lang = DEFAULT_LANG) {
  if (lang !== 'en' || typeof text !== 'string' || !text) return text;
  return EN[text] ?? text;
}

/**
 * Opsi pilihan bisa berupa string atau {value,label}. Yang diterjemahkan hanya
 * labelnya; `value` adalah yang tersimpan di basis data dan harus tetap sama di
 * bahasa mana pun — kalau ikut diterjemahkan, rekaman yang dibuat dalam bahasa
 * Inggris tidak akan cocok dengan penyaring dalam bahasa Indonesia.
 */
const trOption = (option, lang) => (typeof option === 'string'
  ? { value: option, label: tr(option, lang) }
  : { ...option, label: tr(option.label ?? option.value, lang) });

const trField = (field, lang) => ({
  ...field,
  label: tr(field.label, lang),
  help: field.help ? tr(field.help, lang) : field.help,
  placeholder: field.placeholder ? tr(field.placeholder, lang) : field.placeholder,
  group: field.group ? tr(field.group, lang) : field.group,
  options: field.options ? field.options.map((o) => trOption(o, lang)) : field.options,
  // Kosakata bidang terhitung dikirim dalam bentuk yang sama dengan opsi
  // pilihan — {value,label} — karena yang tersimpan pada rekaman tetap nilai
  // Indonesianya sedangkan yang dibaca pengguna adalah labelnya.
  values: field.values ? field.values.map((v) => trOption(v, lang)) : field.values,
});

/** Katalog modul yang sudah berpindah bahasa, siap dipakai antarmuka apa adanya. */
export function localiseCatalogue(catalogue, lang = DEFAULT_LANG) {
  if (lang !== 'en') return catalogue;
  return {
    groups: catalogue.groups.map((g) => ({ ...g, name: g.nameEn || g.name })),
    modules: catalogue.modules.map((m) => ({
      ...m,
      // Nama modul sudah dwibahasa sejak awal: `name` Inggris, `nameId`
      // Indonesia. Antarmuka selalu membaca `nameId`, jadi cukup ditukar.
      nameId: m.name,
      groupName: m.groupNameEn || tr(m.groupName, lang),
      fields: m.fields.map((f) => trField(f, lang)),
      workflow: m.workflow.map((s) => ({ ...s, label: tr(s.label, lang) })),
    })),
  };
}

export function localiseRoles(roles, lang = DEFAULT_LANG) {
  if (lang !== 'en') return roles;
  return roles.map((r) => ({ ...r, name: tr(r.name, lang), description: tr(r.description, lang) }));
}

export function localiseRiskBands(bands, lang = DEFAULT_LANG) {
  if (lang !== 'en') return bands;
  return bands.map((b) => ({ ...b, level: tr(b.level, lang) }));
}
