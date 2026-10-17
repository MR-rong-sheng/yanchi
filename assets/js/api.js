/* ==========================================================================
   砚池 · api.js —— 与 serve.py 的接口打交道
   统一三件事：带上会话 Cookie、写操作带 CSRF 头、未登录自动回登录页。
   契约见 tools/API.md。
   ========================================================================== */

const WRITE_HEAD = { 'Content-Type': 'application/json', 'X-Requested-With': 'yanchi-fetch' };

/** 发一个接口请求；失败时抛 Error（带 .status 与 .data） */
export async function api(path, { method = 'GET', body = undefined } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? {} : WRITE_HEAD,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 403) {
    /* 401：会话没了 → 回登录页；403 交给调用方（可能是权限不够，不跳走） */
    if (res.status === 401) {
      const back = encodeURIComponent(location.pathname + location.search + location.hash);
      location.href = '/login.html?next=' + back;
      throw Object.assign(new Error('未登录'), { status: 401 });
    }
  }

  let data = null;
  try { data = await res.json(); } catch { /* 可能是 HTML 错误页 */ }

  if (!res.ok || (data && data.ok === false)) {
    const msg = (data && data.error) || `请求失败（HTTP ${res.status}）`;
    throw Object.assign(new Error(msg), { status: res.status, data });
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body });

/** 当前登录状态：{ user, setup, version } */
export const me = () => api('/api/me');

/** 退出登录（清掉服务端会话） */
export async function logout() {
  try { await post('/api/logout'); } catch { /* 会话可能已失效，照跳不误 */ }
  location.href = '/login.html';
}

/** 自己改密码；成功后服务端会作废所有会话，需重新登录 */
export async function changePassword(oldPw, newPw) {
  return post('/api/password', { old: oldPw, new: newPw });
}

/* ---------- 后台 ---------- */
export const admin = {
  overview: () => get('/api/admin/overview'),
  users: () => get('/api/admin/users'),
  addUser: (name, password, role) => post('/api/admin/users', { name, password, role }),
  updateUser: (id, patch) => post('/api/admin/users/update', Object.assign({ id }, patch)),
  delUser: (id) => post('/api/admin/users/delete', { id }),

  content: () => get('/api/admin/content'),
  contentGet: (name) => get('/api/admin/content/get?name=' + encodeURIComponent(name)),
  contentSave: (name, data) => post('/api/admin/content/save', { name, data }),
  contentRestore: (name, backup) => post('/api/admin/content/restore', { name, backup }),

  tracks: (q = '', offset = 0, limit = 50) =>
    get(`/api/admin/tracks?q=${encodeURIComponent(q)}&offset=${offset}&limit=${limit}`),
  trackDelete: (file) => post('/api/admin/tracks/delete', { file }),
  trackRestore: (file) => post('/api/admin/tracks/restore', { file }),
  trash: () => get('/api/admin/tracks/trash'),
  rebuild: () => post('/api/admin/tracks/rebuild'),

  sessions: () => get('/api/admin/sessions'),
  killSession: (id) => post('/api/admin/sessions/kill', { id }),
  audit: (limit = 100) => get('/api/admin/audit?limit=' + limit),
};
