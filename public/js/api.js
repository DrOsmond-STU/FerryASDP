/** Thin fetch wrapper plus the client-side cache of registry metadata. */
import { setLang } from './i18n.js';
import { setTheme } from './theme.js';

async function request(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });

  if (res.status === 401 && !path.includes('/auth/')) {
    window.dispatchEvent(new CustomEvent('qhse:unauthorised'));
  }
  if (raw) return res;

  const payload = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(payload?.error || `Permintaan gagal (${res.status}).`);
    err.status = res.status;
    err.details = payload?.details;
    throw err;
  }
  return payload;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path) => request(path, { method: 'DELETE' }),
  raw: (path) => request(path, { raw: true }),
};

/** Shared application state - populated once at sign-in from /api/meta. */
export const state = {
  meta: null,
  user: null,
  permissions: {},
  subscription: null,
  entitled: new Set(),
  moduleByKey: new Map(),
  groups: [],
  optionCache: new Map(),
};

export async function loadMeta() {
  // Tanpa parameter lang, server memakai bahasa yang tersimpan pada akun —
  // itulah sumber kebenarannya, supaya pengguna yang berpindah perangkat tetap
  // menemukan aplikasi dalam bahasa yang ia pilih.
  const meta = await api.get('/api/meta');
  setLang(meta.lang);
  // Tema pun tersimpan pada akun, dengan alasan yang sama seperti bahasa:
  // pengguna yang memilih gelap tidak ingin memilihnya lagi di setiap
  // perangkat. `system` berarti ikut perangkat, dan itu pun sebuah pilihan.
  setTheme(meta.user?.theme || 'system');
  state.meta = meta;
  state.user = meta.user;
  state.permissions = meta.permissions || {};
  state.subscription = meta.subscription || null;
  state.entitled = new Set(meta.subscription?.entitledModules || meta.modules.map((m) => m.key));
  state.groups = meta.groups;
  state.moduleByKey = new Map(meta.modules.map((m) => [m.key, m]));
  state.optionCache.clear();
  return meta;
}

export const mod = (key) => state.moduleByKey.get(key);

export const can = (moduleKey, action) => !!state.permissions?.[moduleKey]?.[action];

/** Termasuk dalam paket langganan cabang? */
export const entitled = (moduleKey) => state.entitled.has(moduleKey);

/** Boleh dilihat pada navigasi: punya hak baca DAN termasuk paket. */
export const visible = (moduleKey) => can(moduleKey, 'view');

/** Reference dropdown values, cached because forms request them repeatedly. */
export async function options(moduleKey) {
  if (state.optionCache.has(moduleKey)) return state.optionCache.get(moduleKey);
  const promise = api.get(`/api/modules/${moduleKey}/options`)
    .then((r) => r.options || [])
    .catch(() => []);
  state.optionCache.set(moduleKey, promise);
  return promise;
}

export const invalidateOptions = (moduleKey) => state.optionCache.delete(moduleKey);

/** Users are referenced by free text in most forms; this powers the picker. */
let userListPromise = null;
export function userList() {
  if (!userListPromise) {
    userListPromise = api.get('/api/admin/users').then((r) => r.users || []).catch(() => []);
  }
  return userListPromise;
}
export const invalidateUsers = () => { userListPromise = null; };
