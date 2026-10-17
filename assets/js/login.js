/* ==========================================================================
   砚池 · login.js —— 登录 / 首次初始化页
   只被 login.html 加载；不 import 任何站点模块，用到的都在本文件里自带。
   契约见 tools/API.md：写操作必须带 X-Requested-With: yanchi-fetch（否则 403）。
   ========================================================================== */

const HEAD_GET = { 'X-Requested-With': 'yanchi-fetch' };
const HEAD_POST = { 'Content-Type': 'application/json', 'X-Requested-With': 'yanchi-fetch' };

const $ = (id) => document.getElementById(id);

const dom = {
  card: $('card'),
  paneLoad: $('pane-load'),
  paneForm: $('pane-form'),
  paneDown: $('pane-down'),
  downMsg: $('down-msg'),
  retry: $('retry'),
  title: $('title'),
  sub: $('sub'),
  form: $('form'),
  name: $('name'),
  pass: $('pass'),
  confirm: $('confirm'),
  confirmWrap: $('confirm-wrap'),
  eye: $('eye'),
  eyeUse: $('eye-use'),
  msg: $('msg'),
  submit: $('submit'),
  toRegister: $('to-register'),
  toLogin: $('to-login'),
};

const state = { mode: 'load', busy: false, register: false };

/* --------------------------------------------------------------------------
   ?next= ：只接受“以单个 / 开头”的站内路径，挡掉 //host 与 /\host 这类开放重定向
   -------------------------------------------------------------------------- */
function readNext() {
  let raw = '';
  try {
    raw = new URLSearchParams(location.search).get('next') || '';
  } catch (e) {
    raw = '';
  }
  if (raw.charAt(0) !== '/') return '/';          // 必须站内绝对路径
  if (raw.charAt(1) === '/' || raw.charAt(1) === '\\') return '/';  // 协议相对 / 反斜杠绕过
  if (raw.indexOf('\\') !== -1) return '/';        // 任何位置的反斜杠都不信任
  if (/[\u0000-\u001f\u007f]/.test(raw)) return '/'; // 控制字符
  return raw;
}

/* --------------------------------------------------------------------------
   请求：统一带上 CSRF 头与同源 Cookie
   -------------------------------------------------------------------------- */
async function req(path, opts = {}) {
  const method = opts.method || 'GET';
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? HEAD_GET : HEAD_POST,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* 可能是 HTML 错误页，data 保持 null */
  }
  return { res, data };
}

/* --------------------------------------------------------------------------
   面板与状态
   -------------------------------------------------------------------------- */
function show(pane) {
  [dom.paneLoad, dom.paneForm, dom.paneDown].forEach((p) => {
    p.hidden = p !== pane;
  });
}

function clearMsg() {
  dom.msg.hidden = true;
  dom.msg.textContent = '';
}

function showMsg(text) {
  dom.msg.textContent = text;
  dom.msg.hidden = false;
  /* 轻微抖动提醒；无动态偏好时 CSS 会关掉 */
  dom.card.removeAttribute('data-shake');
  void dom.card.offsetWidth; // 强制重排，让动画能再次触发
  dom.card.setAttribute('data-shake', '');
}

dom.card.addEventListener('animationend', (e) => {
  if (e.animationName === 'authShake') dom.card.removeAttribute('data-shake');
});

function setMode(mode) {
  state.mode = mode;
  if (mode === 'setup') {
    document.title = '砚池 · 创建管理员账号';
    dom.title.textContent = '创建管理员账号';
    dom.sub.textContent = '这是砚池第一次启动，池子里还没有人。留下名字与密码，你就成了它的管理员，往后用它登录。';
    dom.confirmWrap.hidden = false;
    dom.confirm.value = '';
    dom.pass.setAttribute('autocomplete', 'new-password');
    dom.submit.textContent = '创建并进入';
  } else if (mode === 'register') {
    document.title = '砚池 · 创建账号';
    dom.title.textContent = '创建账号';
    dom.sub.textContent = '取一个名字与密码，注册后就能用它登录；新账号是普通成员。';
    dom.confirmWrap.hidden = false;
    dom.confirm.value = '';
    dom.pass.setAttribute('autocomplete', 'new-password');
    dom.submit.textContent = '注册并进入';
  } else {
    document.title = '砚池 · 登录';
    dom.title.textContent = '登录';
    dom.sub.textContent = '回到你的砚池，继续读写。';
    dom.confirmWrap.hidden = true;
    dom.confirm.value = '';
    dom.pass.setAttribute('autocomplete', 'current-password');
    dom.submit.textContent = '登录';
  }
  dom.form.setAttribute('data-mode', mode);
  updateAltButtons();
  show(dom.paneForm);
  clearMsg();
  focusFirst();
}

/* 次要按钮的显隐：登录态且允许注册才给「创建账号」；注册态给「返回登录」 */
function updateAltButtons() {
  dom.toRegister.hidden = !(state.mode === 'login' && state.register === true);
  dom.toLogin.hidden = state.mode !== 'register';
}

function focusFirst() {
  requestAnimationFrame(() => {
    try {
      dom.name.focus({ preventScroll: true });
    } catch (e) {
      dom.name.focus();
    }
  });
}

function showDown() {
  /* 只给一句自己写的友好话；不回显服务端原始错误（可能是英文或内部信息） */
  dom.downMsg.textContent =
    '服务暂时没有响应。也许它正在重启，也许网络断开了。稍等片刻再刷新，就能回到登录。';
  show(dom.paneDown);
}

function setBusy(on, label) {
  state.busy = on;
  dom.submit.disabled = on;
  dom.submit.setAttribute('aria-busy', on ? 'true' : 'false');
  if (label) {
    dom.submit.textContent = label;
  } else {
    dom.submit.textContent =
      state.mode === 'setup' ? '创建并进入' : state.mode === 'register' ? '注册并进入' : '登录';
  }
}

/* --------------------------------------------------------------------------
   本地校验：与 serve.py 的规则一致（用户名 2–24、不含空白与 : / \，密码至少 6 位）
   -------------------------------------------------------------------------- */
function nameOk(n) {
  if (typeof n !== 'string' || n.length < 2 || n.length > 24) return false;
  for (const ch of n) {
    if (/\s/.test(ch) || ch === ':' || ch === '/' || ch === '\\') return false;
  }
  return true;
}

/* --------------------------------------------------------------------------
   提交
   -------------------------------------------------------------------------- */
async function onSubmit(ev) {
  ev.preventDefault();
  if (state.busy) return;

  const mode = state.mode;
  const name = dom.name.value.trim();
  const pw = dom.pass.value;

  clearMsg();

  if (mode === 'setup' || mode === 'register') {
    if (!nameOk(name)) return showMsg('用户名需 2–24 个字符，且不含空格与 : / \\');
    if (pw.length < 6) return showMsg('密码至少 6 位');
    if (dom.confirm.value !== pw) return showMsg('两次输入的密码不一致，请再确认一次');
  } else {
    if (!name) return showMsg('请填写用户名');
    if (!pw) return showMsg('请填写密码');
  }

  const endpoint = mode === 'setup' ? '/api/setup' : mode === 'register' ? '/api/register' : '/api/login';
  const busyLabel = mode === 'setup' ? '正在创建…' : mode === 'register' ? '正在注册…' : '正在登录…';

  let leaving = false;
  setBusy(true, busyLabel);

  try {
    const { res, data } = await req(endpoint, {
      method: 'POST',
      body: { name, password: pw },
    });

    if (data && data.ok === true) {
      leaving = true;
      setBusy(true, '已登录，正在进入…');
      location.replace(readNext());
      return;
    }

    /* 初始化竞态：别处已经建好账号了 → 先切到登录模式，再把提示挂上去
       （顺序不能反：boot() 内部会 clearMsg，先提示就会被清掉） */
    if (mode === 'setup' && res.status === 409) {
      await boot();
      showMsg('池子里已经有账号了，已切到登录，请直接登录。');
      return;
    }

    /* 自助注册被站长关掉（403）：就地把「创建账号」入口收起来，避免反复撞墙 */
    if (mode === 'register' && res.status === 403) {
      state.register = false;
      updateAltButtons();
    }

    let text = (data && data.error) || '';
    if (!text) {
      if (res.status === 401) text = '用户名或密码不正确';
      else if (res.status === 429) text = '尝试次数太多，请稍后再试';
      else if (res.status === 403) text = '站长暂时关闭了自助注册';
      else if (res.status === 409) text = '这个用户名已经有人用了，换一个吧';
      else if (res.status === 400) text = '填写的内容不合要求，请检查后重试';
      else if (res.status >= 500) text = '服务出了点问题，请稍后重试';
      else text = '没能完成请求（HTTP ' + res.status + '），请稍后重试';
    }
    showMsg(text);
  } catch (e) {
    showMsg('网络似乎断开了，没能连上服务。检查一下再试。');
  } finally {
    if (!leaving) setBusy(false);
  }
}

/* --------------------------------------------------------------------------
   密码明文切换
   -------------------------------------------------------------------------- */
dom.eye.addEventListener('click', () => {
  const showing = dom.pass.type === 'text';
  const nextType = showing ? 'password' : 'text';
  dom.pass.type = nextType;
  /* 注册/初始化态有确认框，一并跟随明文切换 */
  if (!dom.confirmWrap.hidden) dom.confirm.type = nextType;
  dom.eye.setAttribute('aria-pressed', String(!showing));
  const label = showing ? '显示密码' : '隐藏密码';
  dom.eye.setAttribute('aria-label', label);
  dom.eye.setAttribute('title', label);
  dom.eyeUse.setAttribute('href', showing ? '#i-eye' : '#i-eye-off');
  try {
    dom.pass.focus({ preventScroll: true });
  } catch (e) {
    dom.pass.focus();
  }
});

/* --------------------------------------------------------------------------
   登录 ⇄ 注册 切换
   -------------------------------------------------------------------------- */
dom.toRegister.addEventListener('click', () => setMode('register'));
dom.toLogin.addEventListener('click', () => setMode('login'));

/* --------------------------------------------------------------------------
   启动：先问 /api/me，决定是登录还是首次初始化
   -------------------------------------------------------------------------- */
async function boot() {
  state.mode = 'load';
  clearMsg();
  dom.card.removeAttribute('data-shake');
  show(dom.paneLoad);

  try {
    const { res, data } = await req('/api/me');
    if (!data || data.ok !== true) {
      showDown();
      return;
    }
    if (data.user) {
      /* 已经登录过了，直接去该去的地方 */
      location.replace(readNext());
      return;
    }
    state.register = data.register === true;
    setMode(data.setup ? 'setup' : 'login');
  } catch (e) {
    showDown();
  }
}

dom.form.addEventListener('submit', onSubmit);
dom.retry.addEventListener('click', boot);

/* 桌面端：玻璃卡片的镜面反光随指针走（移动端无指针，自然跳过） */
window.addEventListener(
  'pointermove',
  (e) => {
    const r = dom.card.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dom.card.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 100).toFixed(2) + '%');
    dom.card.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 100).toFixed(2) + '%');
  },
  { passive: true }
);

boot();
