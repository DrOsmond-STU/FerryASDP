/** Thin fetch wrapper plus the client-side cache of registry metadata. */

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
  moduleByKey: new Map(),
  groups: [],
  optionCache: new Map(),
};

export async function loadMeta() {
  const meta = await api.get('/api/meta');
  state.meta = meta;
  state.user = meta.user;
  state.permissions = meta.permissions || {};
  state.groups = meta.groups;
  state.moduleByKey = new Map(meta.modules.map((m) => [m.key, m]));
  state.optionCache.clear();
  return meta;
}

export const mod = (key) => state.moduleByKey.get(key);

export const can = (moduleKey, action) => !!state.permissions?.[moduleKey]?.[action];

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
