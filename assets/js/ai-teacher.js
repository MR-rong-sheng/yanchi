/* ==========================================================================
   砚池 · ai-teacher.js —— 右下角的 AI 老师
   一个常驻的浮动入口 + 一块玻璃对话面板。真正调模型发生在 serve.py
   （POST /api/ai/chat），Key 只在服务端，浏览器永远看不到。
   对话存在 localStorage['yanchi:ai.chat']，换页不丢，清空就清空。
   ========================================================================== */
import { $, $$, esc, ic, toast, store, session, currentId, visibleRoutes } from './core.js';

const LS = 'ai.chat';
const KEEP = 40;                    // 最多留多少条（user+assistant 合计）
const GREET = '我是砚池的语文老师。字词、诗文、阅读、写作，哪儿卡住了就把原文发我，我陪你顺一遍。';
const QUICK = [
  { label: '讲讲这个词', fill: '请讲讲「」这个词：本义、常见引申义，各给一个例句。', caret: 3 },
  { label: '这句诗什么意思', fill: '「」这句什么意思？先讲字面上的意思，再说它在全篇里的位置。', caret: 1 },
  { label: '帮我改一句', fill: '帮我改这句话，只指出最值得改的一两处，说清为什么：\n' },
  { label: '出题考我', fill: '围绕「」出一道小题考我，先别给答案。', caret: 3 },
];

const state = {
  open: false, busy: false, unread: false,
  msgs: [],            // { role:'user'|'assistant', content:string, at:number }
  status: null,        // /api/ai/status 的返回
  ctrl: null,          // AbortController
  streamEl: null,      // 正在长出来的那条气泡
};

/* 选中的原文：点「发送」时浏览器的选区往往已经被按钮抢走（点一下别处就塌了），
   所以在 selectionchange 里先记一份，发问时优先用「还在的选区」，其次用这份缓存。 */
let selCache = { text: '', at: 0 };
const SEL_TTL = 8 * 60 * 1000;

/* ---------- 存读 ---------- */
function load() {
  const saved = store.get(LS, null);
  const msgs = saved && Array.isArray(saved.msgs) ? saved.msgs : [];
  state.msgs = msgs
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content)
    .slice(-KEEP);
}
function save() {
  store.set(LS, { msgs: state.msgs.slice(-KEEP), at: Date.now() });
}

/* ---------- 极简 markdown：只认粗体、行内码、代码块、列表 ---------- */
function mdLite(src) {
  const code = [];
  let s = String(src).replace(/```([\s\S]*?)```/g, (_, c) => {
    code.push(c.replace(/^[A-Za-z0-9+#]*\n/, ''));
    return '\u0000' + (code.length - 1) + '\u0000';
  });
  s = esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push('<ul>' + list.join('') + '</ul>'); list = null; } };
  for (const raw of s.split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const pre = line.match(/^\u0000(\d+)\u0000$/);
    if (pre) { flush(); out.push('<pre><code>' + esc(code[+pre[1]]) + '</code></pre>'); continue; }
    const li = line.match(/^(?:[-*·]|\d+[.、)])\s+(.*)$/);
    if (li) { (list = list || []).push('<li>' + li[1] + '</li>'); continue; }
    flush();
    out.push('<p>' + line + '</p>');
  }
  flush();
  return out.join('');
}

/* ---------- 搭建 ---------- */
function build() {
  if (document.getElementById('ai-fab')) return;

  const fab = document.createElement('button');
  fab.id = 'ai-fab';
  fab.type = 'button';
  fab.className = 'ai-fab';
  fab.innerHTML = ic('teacher') + '<span class="ai-fab__dot" aria-hidden="true"></span>';
  fab.title = '问 AI 老师';
  fab.setAttribute('aria-label', '打开 AI 老师');
  document.body.appendChild(fab);

  const panel = document.createElement('section');
  panel.id = 'ai-panel';
  panel.className = 'ai-panel glass';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'AI 老师');
  panel.innerHTML = `
    <header class="ai-head">
      <span class="ai-head__mark" aria-hidden="true">师</span>
      <div class="ai-head__t"><b>AI 老师</b><i id="ai-model">DeepSeek</i></div>
      <button class="icon-btn ai-head__btn" id="ai-clear" type="button" title="清空这次对话" aria-label="清空对话">${ic('trash')}</button>
      <button class="icon-btn ai-head__btn" id="ai-close" type="button" title="收起" aria-label="收起">${ic('close')}</button>
    </header>
    <div class="ai-log" id="ai-log" role="log" aria-live="polite"></div>
    <div class="ai-quick" id="ai-quick"></div>
    <form class="ai-form" id="ai-form" autocomplete="off">
      <textarea id="ai-text" rows="1" maxlength="4000"
        placeholder="问老师点什么…（Enter 发送）"></textarea>
      <button class="ai-send" id="ai-send" type="submit" title="发送" aria-label="发送">${ic('right')}</button>
    </form>
    <div class="ai-foot" id="ai-tip">内容由 DeepSeek 生成，只作参考。</div>
  `;
  document.body.appendChild(panel);

  const quick = $('#ai-quick');
  QUICK.forEach(q => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ai-chip';
    b.textContent = q.label;
    b.addEventListener('click', () => {
      const ta = $('#ai-text');
      ta.value = q.fill;
      ta.focus();
      const at = typeof q.caret === 'number' ? q.caret : q.fill.length;
      ta.setSelectionRange(at, at);
      autoGrow();
    });
    quick.appendChild(b);
  });
}

/* ---------- 气泡 ---------- */
function bubbleEl(m) {
  const wrap = document.createElement('div');
  wrap.className = 'ai-msg ai-msg--' + (m.role === 'user' ? 'user' : 'bot');
  const body = document.createElement('div');
  body.className = 'ai-bubble';
  if (m.role === 'user') {
    body.textContent = m.content;
  } else {
    body.innerHTML = mdLite(m.content);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'ai-copy';
    copy.title = '复制这条回答';
    copy.textContent = '复制';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(m.content);
        copy.textContent = '已复制';
      } catch { copy.textContent = '复制失败'; }
      setTimeout(() => { copy.textContent = '复制'; }, 1600);
    });
    wrap.appendChild(body);
    const ava = document.createElement('span');
    ava.className = 'ai-ava';
    ava.setAttribute('aria-hidden', 'true');
    ava.textContent = '师';
    wrap.prepend(ava);
    wrap.appendChild(copy);
    return wrap;
  }
  wrap.appendChild(body);
  return wrap;
}

function noteEl(text, kind = '') {
  const el = document.createElement('div');
  el.className = 'ai-note' + (kind ? ' ai-note--' + kind : '');
  el.textContent = text;
  return el;
}

function paintLog() {
  const log = $('#ai-log');
  if (!log) return;
  log.innerHTML = '';
  if (!state.msgs.length) {
    const hello = { role: 'assistant', content: GREET };
    log.appendChild(bubbleEl(hello));
    const hint = hintText();
    if (hint) log.appendChild(noteEl(hint, state.status && state.status.ready === false ? 'warn' : ''));
  } else {
    state.msgs.forEach(m => log.appendChild(bubbleEl(m)));
    if (state.status && !state.status.ready && hintText()) log.prepend(noteEl(hintText(), 'warn'));
  }
  scrollDown(true);
}

function hintText() {
  if (!state.status) return '';
  if (state.status.ready) return '';
  if (!state.status.enabled) return 'AI 老师现在是关着的 —— ' + (session.isAdmin() ? '在「设置 → AI 老师」里打开即可。' : '请让管理员打开。');
  return '还差一步：' + (session.isAdmin()
    ? '在「设置 → AI 老师」里填一次 DeepSeek 的 API Key，这儿的老师就上岗了。'
    : '管理员还没配好 API Key，先自己读一读，稍后再来问。');
}

function scrollDown(force) {
  const log = $('#ai-log');
  if (!log) return;
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
  if (force || near) log.scrollTop = log.scrollHeight;
}

/* ---------- 开合 ---------- */
function openPanel() {
  const panel = $('#ai-panel');
  if (!panel) return;
  panel.hidden = false;
  document.body.classList.add('ai-open');
  state.open = true;
  state.unread = false;
  $('#ai-fab').classList.remove('has-dot');
  if (!state.status) refreshStatus();      // 状态没拿到过就再问一次
  paintLog();                              // 每次打开按最新状态重画：提示条、切页前新收的消息都能跟上
  requestAnimationFrame(() => {
    const ta = $('#ai-text');
    if (ta) { ta.focus({ preventScroll: true }); autoGrow(); }
    scrollDown(true);
  });
}

function closePanel() {
  const panel = $('#ai-panel');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  document.body.classList.remove('ai-open');
  state.open = false;
}

function togglePanel() { state.open ? closePanel() : openPanel(); }

function autoGrow() {
  const ta = $('#ai-text');
  if (!ta) return;
  ta.style.height = 'auto';
  // box-sizing:border-box 下 style.height 含内边距与边框，scrollHeight 不含边框 —— 不补这 2px 就会一直挂着滚动条
  ta.style.height = Math.min(ta.scrollHeight + 2, 132) + 'px';
  ta.style.overflowY = ta.scrollHeight > 132 ? 'auto' : 'hidden';
}

/* ---------- 状态 ---------- */
async function refreshStatus() {
  try {
    const res = await fetch('/api/ai/status', { credentials: 'same-origin' });
    state.status = await res.json();
  } catch {
    state.status = null;
  }
  const model = $('#ai-model');
  if (model) {
    model.textContent = state.status && state.status.model ? state.status.model : 'DeepSeek';
    model.title = state.status && state.status.ready ? '已接上 DeepSeek' : '还没接上';
  }
  if (state.open) paintLog();
}

/* ---------- 发问 ---------- */
function pageName() {
  const id = currentId();
  const r = visibleRoutes().find(x => x.id === id);
  return r ? r.name : id;
}

function selectionText() {
  try {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return '';
    const t = sel.toString().trim();
    return t.length >= 2 ? t.slice(0, 400) : '';
  } catch { return ''; }
}

function currentSelection() {
  const live = selectionText();
  if (live) { selCache = { text: live, at: Date.now() }; return live; }
  if (selCache.text && Date.now() - selCache.at < SEL_TTL) return selCache.text;
  return '';
}

function setBusy(busy) {
  state.busy = busy;
  const btn = $('#ai-send');
  const ta = $('#ai-text');
  if (btn) {
    btn.classList.toggle('is-stop', busy);
    btn.innerHTML = busy ? '<span class="ai-stop" aria-hidden="true"></span>' : ic('right');
    btn.title = busy ? '停下' : '发送';
    btn.setAttribute('aria-label', btn.title);
  }
  if (ta) ta.disabled = busy;
  document.body.classList.toggle('ai-busy', busy);
}

async function ask(text) {
  text = String(text || '').trim();
  if (!text || state.busy) return;
  if (state.status && state.status.ready === false) {
    toast(hintText() || 'AI 老师还没配好');
    return;
  }

  const sel = currentSelection();
  if (!selectionText()) selCache = { text: '', at: 0 };   // 用掉就扔，别在下一问里偷偷带上一段旧原文
  const log = $('#ai-log');
  if (log && log.querySelector('.ai-note')) log.querySelector('.ai-note').remove();

  state.msgs.push({ role: 'user', content: text, at: Date.now() });
  save();
  log.appendChild(bubbleEl(state.msgs[state.msgs.length - 1]));

  const holder = document.createElement('div');
  holder.className = 'ai-msg ai-msg--bot is-live';
  holder.innerHTML = '<span class="ai-ava" aria-hidden="true">师</span>'
    + '<div class="ai-bubble"><span class="ai-dots" aria-label="正在想"><i></i><i></i><i></i></span></div>';
  log.appendChild(holder);
  scrollDown(true);
  setBusy(true);

  const bubble = holder.querySelector('.ai-bubble');
  let acc = '';
  let painted = 0;
  let raf = 0;
  const paint = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      bubble.innerHTML = mdLite(acc) + '<span class="ai-caret" aria-hidden="true"></span>';
      scrollDown(false);
    });
  };

  state.ctrl = new AbortController();
  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      credentials: 'same-origin',
      signal: state.ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'yanchi-fetch' },
      body: JSON.stringify({
        messages: state.msgs.slice(-KEEP).map(m => ({ role: m.role, content: m.content })),
        context: { page: pageName(), selection: sel },
      }),
    });

    const ctype = res.headers.get('Content-Type') || '';
    if (!res.ok || !res.body || ctype.indexOf('event-stream') < 0) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch { /* 非 JSON */ }
      if (res.status === 401) {
        location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.hash);
      }
      throw new Error(msg);
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let cut;
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        for (const line of chunk.split('\n')) {
          if (line.slice(0, 5) !== 'data:') continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let ev;
          try { ev = JSON.parse(payload); } catch { continue; }
          if (ev.error) throw new Error(ev.error);
          if (ev.delta) {
            acc += ev.delta;
            if (acc.length - painted > 2) { painted = acc.length; paint(); }
          }
        }
      }
    }

    if (!acc.trim()) throw new Error('老师这次没说出话来，再问一遍试试');
    state.msgs.push({ role: 'assistant', content: acc, at: Date.now() });
    save();
    holder.classList.remove('is-live');
    bubble.innerHTML = mdLite(acc);
    // 补上「复制」按钮
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'ai-copy';
    copy.textContent = '复制';
    copy.title = '复制这条回答';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(acc); copy.textContent = '已复制'; }
      catch { copy.textContent = '复制失败'; }
      setTimeout(() => { copy.textContent = '复制'; }, 1600);
    });
    holder.appendChild(copy);
    if (!state.open) { state.unread = true; const fab = $('#ai-fab'); if (fab) fab.classList.add('has-dot'); }
    refreshStatus();            // 顺手把「没配 Key」的提示收掉
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || /abort/i.test(err.message || ''));
    holder.remove();
    if (aborted) {
      if (acc.trim()) {
        state.msgs.push({ role: 'assistant', content: acc, at: Date.now() });
        save();
        log.appendChild(bubbleEl(state.msgs[state.msgs.length - 1]));
      }
      log.appendChild(noteEl('停了 —— 这一段没收完。'));
    } else {
      log.appendChild(noteEl('没能问到老师：' + (err.message || err), 'warn'));
      // 用户那条已经进历史了；留一个「重发」的出口，别让人重打一遍
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'ai-chip ai-chip--retry';
      retry.textContent = '再试一次';
      retry.addEventListener('click', () => { retry.remove(); ask(text); });
      log.appendChild(retry);
    }
    scrollDown(true);
  } finally {
    state.ctrl = null;
    setBusy(false);
    scrollDown(true);
  }
}

/* ---------- 绑定 ---------- */
function bind() {
  const fab = $('#ai-fab'), panel = $('#ai-panel');
  fab.addEventListener('click', togglePanel);
  $('#ai-close').addEventListener('click', closePanel);

  $('#ai-clear').addEventListener('click', () => {
    if (!state.msgs.length) return;
    if (!confirm('清空这次和老师的对话？（本机记录，不能恢复）')) return;
    if (state.ctrl) state.ctrl.abort();
    state.msgs = [];
    save();
    paintLog();
    toast('对话已清空');
  });

  const form = $('#ai-form'), ta = $('#ai-text');
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (state.busy) { if (state.ctrl) state.ctrl.abort(); return; }
    const v = ta.value;
    if (!v.trim()) return;
    ta.value = '';
    autoGrow();
    ask(v);
  });
  ta.addEventListener('input', autoGrow);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.open) closePanel();
  });

  // 选区缓存：点发送按钮那一下，页面选区往往就塌了 —— 在它还活着的时候记一份
  document.addEventListener('selectionchange', () => {
    const t = selectionText();
    if (t) selCache = { text: t, at: Date.now() };
  });

  // 详情抽屉是模态的：它一开，老师先让位（两块玻璃叠在一起没法看）
  const scrim = $('#scrim');
  if (scrim) {
    const syncDrawer = () => {
      const isOpen = !scrim.hidden;
      document.body.classList.toggle('has-drawer', isOpen);
      if (isOpen) closePanel();
    };
    new MutationObserver(syncDrawer).observe(scrim, { attributes: true, attributeFilter: ['hidden'] });
    syncDrawer();
  }

  // 点面板外部不关（对话时容易误触），但点遮罩似的空白处也不该带走输入 —— 只认 × 和 Esc。
  panel.addEventListener('transitionend', () => scrollDown(true));
}

/* ---------- 入口 ---------- */
export function initAiTeacher() {
  if (!session.user) return;                 // 没登录就别挂个空壳
  load();
  build();
  bind();
  paintLog();
  refreshStatus();
}
