/**
 * Tema tampilan: terang, gelap, atau ikut perangkat.
 *
 * Paletnya sendiri sudah ada di app.css dalam tiga bentuk — bawaan `:root`
 * (terang), `@media (prefers-color-scheme: dark)`, dan dua blok tegas
 * `:root[data-theme='light']` / `:root[data-theme='dark']`. Berkas ini hanya
 * memutuskan atribut mana yang dipasang pada elemen akar.
 *
 * `system` BUKAN nilai ketiga dari sebuah sakelar dua arah, melainkan
 * penolakan memilih: atributnya dilepas sama sekali sehingga media query
 * yang mengambil alih, dan tampilan ikut berubah sendiri ketika perangkat
 * berpindah ke mode gelap pada sore hari. Menyimpannya sebagai 'light' saat
 * itu terang akan mematikan perilaku tersebut tanpa disadari pengguna.
 */

const THEMES = ['system', 'light', 'dark'];
const KEY = 'qhse-theme';

let current = 'system';

export const themes = () => [...THEMES];

/** Preferensi yang dipilih pengguna: 'system' | 'light' | 'dark'. */
export const theme = () => current;

/** Tema yang benar-benar tampak saat ini, setelah 'system' diterjemahkan. */
export const effectiveTheme = () => (current === 'system' ? systemTheme() : current);

const systemTheme = () => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

export function setTheme(next) {
  current = THEMES.includes(next) ? next : 'system';
  if (current === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = current;
  try { localStorage.setItem(KEY, current); } catch { /* mode privat */ }
  return current;
}

/**
 * Tema tersimpan di peramban. Dibaca sebelum profil pengguna termuat supaya
 * halaman depan dan detik-detik pertama aplikasi tidak berkedip terang lebih
 * dulu bagi pengguna yang memilih gelap.
 */
export function storedTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    return THEMES.includes(saved) ? saved : null;
  } catch {
    return null;
  }
}

// Dijalankan saat modul dimuat — sedini mungkin, sebelum kerangka digambar.
setTheme(storedTheme() || 'system');
