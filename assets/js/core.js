/* ==========================================================================
   砚池 · core.js —— 框架内核
   提供：DOM 助手 / 本地存储 / 偏好 / 哈希路由 / 抽屉 / 提示条 / 导出
   任何新模块只需要：define({id,name,icon,nav,mount}) 就能挂进来。
   ========================================================================== */

/* ---------- DOM ---------- */
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** 转义用户输入，任何插进 innerHTML 的文本都要过这一道 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** 内联图标（精灵定义在 index.html） */
export function ic(name, cls = 'ic') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- 本地存储（全部走 yanchi: 前缀） ---------- */
const NS = 'yanchi:';
const lsKey = k => NS + k;

export const store = {
  get(k, fallback = null) {
    try {
      const raw = localStorage.getItem(lsKey(k));
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(k, v) {
    try { localStorage.setItem(lsKey(k), JSON.stringify(v)); return true; }
    catch { toast('写入本机存储失败（可能已满或被浏览器限制）'); return false; }
  },
  del(k) { localStorage.removeItem(lsKey(k)); },
  dump() {
    const out = {};
    for (const k of Object.keys(localStorage)) if (k.startsWith(NS)) out[k.slice(NS.length)] = localStorage.getItem(k);
    return out;
  },
  restore(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('数据格式不正确');
    Object.keys(obj).forEach(k => localStorage.setItem(lsKey(k), obj[k]));
  },
  clear() {
    Object.keys(localStorage).filter(k => k.startsWith(NS)).forEach(k => localStorage.removeItem(k));
  },
};

/* ---------- 偏好（主题 / 强调色 / 字号） ---------- */
/* 只接受白名单内的取值：这几个属性直接写到 <html> 上，
   一旦混进非法值，选择器（如 [data-theme]）就会连带匹配整页，很难查 */
const ALLOWED = {
  theme: ['light', 'dark'],
  accent: ['qing', 'zhe', 'zi', 'mo'],
  size: ['s', 'm', 'l'],
};

export const prefs = {
  data: Object.assign({ theme: 'light', accent: 'qing', size: 'm' }, store.get('prefs', {})),
  apply() {
    const h = document.documentElement;
    for (const k of ['theme', 'accent', 'size']) {
      if (ALLOWED[k].includes(this.data[k])) h.setAttribute('data-' + k, this.data[k]);
    }
  },
  set(k, v) {
    if (!ALLOWED[k] || !ALLOWED[k].includes(v)) return false;   // 拒绝非法值
    this.data[k] = v;
    this.apply();
    store.set('prefs', this.data);
    window.dispatchEvent(new CustomEvent('yanchi:prefs', { detail: { k, v } }));
    return true;
  },
  toggleTheme() { this.set('theme', this.data.theme === 'dark' ? 'light' : 'dark'); },
};

/* ---------- 提示条 ---------- */
let toastTimer;
export function toast(msg, ms = 2600) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

/* ---------- 抽屉 ---------- */
let onDrawerClose = null;
export function openDrawer({ title = '', sub = '', html = '', actions = [], onClose = null }) {
  const drawer = $('#drawer'), scrim = $('#scrim');
  onDrawerClose = onClose;

  drawer.innerHTML = `
    <div class="drawer__head">
      <div>
        <div class="drawer__title">${esc(title)}</div>
        ${sub ? `<div class="drawer__sub">${esc(sub)}</div>` : ''}
      </div>
      <button class="icon-btn" data-close title="关闭">${ic('close')}</button>
    </div>
    <hr class="hr" />
    <div class="drawer__body">${html}</div>
    ${actions.length ? `<div class="btn-row" style="margin-top:22px">${
      actions.map((a, i) => `<button class="btn ${a.kind === 'primary' ? 'btn--primary' : ''}"
        data-act="${i}">${a.icon ? ic(a.icon) : ''}${esc(a.label)}</button>`).join('')
    }</div>` : ''}
  `;

  drawer.hidden = false;
  scrim.hidden = false;
  document.body.style.overflow = 'hidden';

  drawer.querySelector('[data-close]').onclick = closeDrawer;
  scrim.onclick = closeDrawer;
  $$('[data-act]', drawer).forEach(btn => {
    btn.onclick = () => {
      const a = actions[Number(btn.dataset.act)];
      bindRipple(btn);
      a?.onClick?.({ closeDrawer, redraw: () => openDrawer({ title, sub, html, actions, onClose }) });
    };
  });
  document.addEventListener('keydown', escClose);
}

export function closeDrawer() {
  const drawer = $('#drawer'), scrim = $('#scrim');
  if (drawer.hidden) return;
  drawer.hidden = true;
  scrim.hidden = true;
  document.body.style.overflow = '';
  document.removeEventListener('keydown', escClose);
  onDrawerClose?.();
  onDrawerClose = null;
}
function escClose(e) { if (e.key === 'Escape') closeDrawer(); }

/* ---------- 按钮涟漪 ---------- */
export function bindRipple(btn) {
  btn.addEventListener('pointerdown', e => {
    const r = btn.getBoundingClientRect();
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.left = (e.clientX - r.left) + 'px';
    dot.style.top  = (e.clientY - r.top) + 'px';
    btn.appendChild(dot);
    requestAnimationFrame(() => { dot.style.transform = 'scale(22)'; dot.style.opacity = '0'; });
    setTimeout(() => dot.remove(), 620);
  });
}

/* ---------- 导出 / 下载 ---------- */
export function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ---------- 文本统计 ---------- */
export const countHan = t => (String(t).match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
export const countAll = t => String(t).replace(/\s/g, '').length;

/* ---------- 日期 ---------- */
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function stamp(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- 当前登录用户（由 app.js 启动时填入） ---------- */
export const session = {
  user: null,
  set(u) {
    this.user = u || null;
    buildNav();
    paintUserChip();
    return this.user;
  },
  isAdmin() { return !!this.user && this.user.role === 'admin'; },
};

/* ---------- 哈希路由 ---------- */
const routes = new Map();
let viewEl = null, navEl = null, ctx = null;

export function define(route) { routes.set(route.id, route); }

export function go(id) {
  if (location.hash === '#/' + id) render();
  else location.hash = '#/' + id;
}

export function currentId() {
  const id = location.hash.replace(/^#\/?/, '').trim();
  return routes.has(id) ? id : 'today';
}

/* 导航对谁可见：nav:true 所有人；nav:'admin' 只有管理员 */
export function visibleRoutes() {
  return [...routes.values()].filter(r =>
    r.name && r.nav !== false && (r.nav !== 'admin' || session.isAdmin()));
}

export function buildNav() {
  navEl.innerHTML = '';
  visibleRoutes().forEach(r => {
    const a = document.createElement('a');
    a.href = '#/' + r.id;
    a.innerHTML = `${ic(r.icon)}<span>${esc(r.name)}</span>`;
    navEl.appendChild(a);
  });
}

function markNav(id) {
  $$('a', navEl).forEach(a => {
    const on = a.getAttribute('href') === '#/' + id;
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
}

/* 顶栏右上角的账号按钮：显示当前用户名，管理员带一个小盾牌 */
function paintUserChip() {
  const btn = $('#btn-user');
  if (!btn) return;
  const u = session.user;
  btn.classList.toggle('is-admin', session.isAdmin());
  btn.title = u ? `${u.name}${u.role === 'admin' ? ' · 管理员' : ''}（点开账号菜单）` : '账号';
  btn.setAttribute('aria-label', btn.title);
  const label = $('#user-chip-name');
  if (label) label.textContent = u ? u.name : '—';
}

export async function render() {
  const id = currentId();
  const route = routes.get(id);
  closeDrawer();
  markNav(id);
  if (route && route.role === 'admin' && !session.isAdmin()) {
    viewEl.innerHTML = '<div class="card glass"><div class="empty"><b>这个模块需要管理员权限</b>'
      + '当前账号没有后台权限，换管理员账号登录后再来。</div></div>';
    return;
  }
  viewEl.innerHTML = '';
  viewEl.scrollTop = 0;
  window.scrollTo({ top: 0 });
  try {
    await route.mount(viewEl, ctx);
    viewEl.dataset.entering = '1';
    setTimeout(() => { viewEl.dataset.entering = ''; }, 560);
  } catch (err) {
    viewEl.innerHTML = `<div class="card glass"><div class="empty"><b>这个模块没能打开</b>${
      esc(err && err.message ? err.message : String(err))}</div></div>`;
    console.error(err);
  }
  /* 广播「换到哪一页了」：activity.js 据此记轨迹，不需要互相 import */
  window.dispatchEvent(new CustomEvent('yanchi:view', { detail: { id } }));
  viewEl.focus({ preventScroll: true });
}

export function start() {
  viewEl = $('#view');
  navEl = $('#nav');
  ctx = { go, store, toast, prefs, session, openDrawer, closeDrawer, render, ic, esc, download, dayKey, countHan, countAll, stamp, uid,
          /* 视图想让人在存档里看到自己干了什么，就调 ctx.track('note', '新增札记 …') */
          track: (ev, d) => window.dispatchEvent(new CustomEvent('yanchi:act', { detail: { ev, d } })) };

  // 玻璃表面跟随鼠标的高光
  document.addEventListener('pointermove', e => {
    for (const el of $$('.glass, .word-card, .btn')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (e.clientX < r.left - 100 || e.clientX > r.right + 100 ||
          e.clientY < r.top - 100 || e.clientY > r.bottom + 100) continue;
      el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      el.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }
  }, { passive: true });

  buildNav();
  window.addEventListener('hashchange', render);
  render();

  // 页脚速览
  const stat = $('#foot-stat');
  const refresh = () => {
    const notes = store.get('notes', []).length;
    const words = store.get('words.done', []).length;
    const poems = store.get('poems.done', []).length;
    stat.textContent = `札记 ${notes} 条 · 已掌握字词 ${words} 个 · 已背诗文 ${poems} 篇`;
  };
  refresh();
  setInterval(refresh, 2000);
  return ctx;
}
