/* ==========================================================================
   砚池 · activity.js —— 把「这个人在这台站上做了什么」记下来
   服务端负责记登录/后台动作；这里补上前端的那一半：
     · view   进了哪个模块、停留多久（换页时结算上一页）
     · click  点了什么（拿按钮的可读标签，连点只记一次）
     · prefs  改了偏好（主题/强调色/字号）
     · 其它   视图里可以自己发 ctx.track('note', '新增札记 …')
   事件先攒在内存里，每 10 秒或攒够 60 条发一次；页面隐藏/卸载时立刻补发。
   与 core.js 之间用 DOM 事件解耦（yanchi:view / yanchi:prefs / yanchi:act），
   这样谁都不必 import 谁，也不会有循环依赖。
   ========================================================================== */

const BUFFER = [];
const MAX_BUF = 60;          // 攒够这么多就发
const MAX_HOLD = 200;        // 离线时最多攒这么多，超了丢最旧的
const INTERVAL = 10000;      // 否则最多 10 秒发一次

let flushTimer = null;
let stopped = false;         // 会话没了就停，不再骚扰服务端
let started = false;
let cooldown = 0;        // 被限速后的冷却截止时间（毫秒时间戳）
let currentView = null;
let viewSince = Date.now();
let booted = false;
let lastClickKey = '';
let lastClickAt = 0;
let nameOf = id => id;

/** 记一条。ev 是事件码，d 是可读详情。 */
export function track(ev, d = '') {
  if (stopped || started === false || !ev) return;
  BUFFER.push({ ev: String(ev).slice(0, 40), d: String(d ?? '').slice(0, 300) });
  if (BUFFER.length > MAX_HOLD) BUFFER.splice(0, BUFFER.length - MAX_HOLD);
  if (BUFFER.length >= MAX_BUF) flush();
  else schedule();
}

function schedule() {
  if (flushTimer) return;
  const wait = Math.max(1500, Math.max(INTERVAL, cooldown - Date.now()));
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, wait);
}

/** 发失败时把事件放回去（离线/限速都不该丢数据，最多留 MAX_HOLD 条） */
function requeue(events) {
  BUFFER.unshift(...events);
  if (BUFFER.length > MAX_HOLD) BUFFER.splice(0, BUFFER.length - MAX_HOLD);
}

/** 把缓冲发出去。useKeepalive 用于页面即将离开时（保命发）。 */
export async function flush(useKeepalive = false) {
  if (stopped || !BUFFER.length) return 0;
  const events = BUFFER.splice(0, BUFFER.length);
  try {
    const res = await fetch('/api/activity', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: !!useKeepalive,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'yanchi-fetch' },
      body: JSON.stringify({ events }),
    });
    if (res.status === 401 || res.status === 403) { stopped = true; return 0; }   // 会话没了：彻底停
    if (res.status === 413) { return 0; }             // 这一批太大：丢掉，别撑得更大
    if (res.status === 429) {                         // 上报太频繁：退避 30 秒再发，绝不停止采集
      requeue(events);
      cooldown = Date.now() + 30000;
      schedule();
      return 0;
    }
    if (!res.ok) { requeue(events); return 0; }        // 其它错误：放回去，下次再发
    return events.length;
  } catch {
    requeue(events);                                   // 断网：放回去，下次再发
    return 0;
  }
}

/* 可点的容器。注意：不能写 [data-*]，那不是合法选择器，
   会让 closest() 每次点击都抛 SyntaxError，整条监听器当场断掉（踩过）。 */
const CLICKABLE = 'button,a,[role="button"],.btn,.row,.prow,.word-card,.chip,label,summary,'
  + '[aria-label],[title]';

/** 从被点的元素上取一个人能看懂的标签（任何异常都不许冒出去） */
function labelOf(el) {
  try {
    if (!el || typeof el.closest !== 'function') return '';
    const cand = el.closest(CLICKABLE) || el;
    const attr = cand.getAttribute
      ? (cand.getAttribute('aria-label') || cand.getAttribute('title') || '')
      : '';
    const txt = attr || cand.textContent || '';
    return String(txt).replace(/\s+/g, ' ').trim().slice(0, 40);
  } catch (e) {
    return '';
  }
}

/**
 * 启动采集。nameOf 把路由 id 翻成中文名（由 app.js 传进来）。
 */
export function initActivity(routeNameOf) {
  if (started) return;
  nameOf = routeNameOf || nameOf;
  started = true;

  /* 换页：结算上一页的停留时间 */
  window.addEventListener('yanchi:view', e => {
    const now = Date.now();
    if (currentView) {
      track('view', `${nameOf(currentView)} · 停留 ${Math.round((now - viewSince) / 1000)}s`);
    }
    currentView = (e.detail && e.detail.id) || null;
    viewSince = now;
    if (!booted) {
      booted = true;
      track('boot', `打开站点 · ${navigator.platform || ''} ${(navigator.language || '')}`.trim());
    }
  });

  /* 偏好改动 */
  window.addEventListener('yanchi:prefs', e => {
    const d = e.detail || {};
    track('prefs', `${d.k} → ${d.v}`);
  });

  /* 视图自己发的动作 */
  window.addEventListener('yanchi:act', e => {
    const d = e.detail || {};
    if (d.ev) track(d.ev, d.d);
  });

  /* 点击：只记有人可读标签的，连点只记一次。
     整段包在 try 里：一个坏标签不能让采集从此失效。 */
  document.addEventListener('click', e => {
    try {
      const label = labelOf(e.target);
      if (!label) return;
      const where = currentView ? nameOf(currentView) : '';
      const key = where + '|' + label;
      const t = Date.now();
      if (key === lastClickKey && t - lastClickAt < 900) return;
      lastClickKey = key;
      lastClickAt = t;
      track('click', (where ? where + ' · ' : '') + label);
    } catch (err) {
      console.warn('yanchi 活动采集：这次点击没记上', err);
    }
  }, true);

  /* 立刻把缓冲发出去（自检脚本与「退出登录」用它） */
  window.addEventListener('yanchi:flush', () => { flush(false); });

  /* 页面要走的时候，把剩下的补发出去 */
  const bye = () => { flush(true); };
  window.addEventListener('pagehide', bye);
  document.addEventListener('visibilitychange', () => { if (document.hidden) bye(); });
  window.addEventListener('beforeunload', bye);
}

/** 退出登录等场景：先发完再走 */
export async function flushNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  return flush(true);
}
