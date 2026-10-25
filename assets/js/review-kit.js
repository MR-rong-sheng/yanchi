/* ==========================================================================
   砚池 · review-kit.js —— 两个复习专区共用的小部件
   分段导航、填空自测、选择自测、答案比对、进度存取。
   约定：自测结果存在 store 的 <key> 下，形如 { [题号]: { ok, input|picked } }。
   ========================================================================== */
import { $, $$, esc, ic, store, toast } from './core.js';

/* ---------- 分段导航 ---------- */
export function tabBar(items) {
  return `<nav class="rv-tabs glass" role="tablist" aria-label="复习分区">
    ${items.map((t, i) => `
      <button role="tab" data-tab="${esc(t.id)}" aria-selected="${i === 0 ? 'true' : 'false'}">
        ${t.icon ? ic(t.icon) : ''}<span>${esc(t.label)}</span>
      </button>`).join('')}
  </nav>`;
}

export function bindTabs(root, onPick) {
  $$('[data-tab]', root).forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-tab]', root).forEach(b => b.setAttribute('aria-selected', String(b === btn)));
      onPick(btn.dataset.tab);
      toTop();          /* 换板块回到最顶端，不然新板块会从上一个板块的滚动位置中间开始显示 */
    });
  });
}

/* 回到页面最顶端：window 与 #view 两种滚动容器都照顾到（换板块、换页都调它） */
export function toTop() {
  window.scrollTo(0, 0);
  const v = document.getElementById('view');
  if (v) v.scrollTop = 0;
}

/* ---------- 答案比对 ----------
   去掉空白与标点再比：学生写「浩浩汤汤，横无际涯」和「浩浩汤汤横无际涯」都算对。
   全角半角、中英文标点一起处理，避免因为一个逗号判错。 */
const PUNCT = /[\s\u3000，。、；：？！“”‘’「」『』《》〈〉（）【】()\[\]{}<>·—…\-_,.;:?!"'`~@#$%^&*+=|\\/]/g;
export function normAns(s) {
  return String(s || '').replace(PUNCT, '').toLowerCase();
}
function isRight(item, val) {
  const v = normAns(val);
  if (!v) return false;
  if (normAns(item.a) === v) return true;
  return (item.alts || []).some(x => normAns(x) === v);
}

/* ---------- 填空自测 ---------- */
export function fillQuiz(host, { items, key, ctx, label = '自测' }) {
  const saved = store.get(key, {}) || {};

  host.innerHTML = `
    <div class="rv-quiz">
      <div class="rv-quiz__bar">
        <span class="rv-score" data-score></span>
        <div class="btn-row">
          <button class="btn btn--sm" data-check>${ic('check')}检查全部</button>
          <button class="btn btn--sm btn--ghost" data-reset>重做</button>
        </div>
      </div>
      <div class="rv-items">
        ${items.map((it, i) => `
          <article class="rv-item glass" data-id="${esc(it.id)}">
            <div class="rv-item__head">
              <span class="rv-idx">${i + 1}</span>
              <span class="rv-tag">${esc(it.课 || it.tag || '')}</span>
            </div>
            ${it.hint ? `<p class="rv-hint">${esc(it.hint)}</p>` : ''}
            <p class="rv-q rv-q--blank">${esc(it.q)}</p>
            <div class="rv-inputrow">
              <input type="text" data-input autocomplete="off" spellcheck="false"
                     aria-label="第 ${i + 1} 题填空" placeholder="写出空缺的部分" />
              <button class="btn btn--sm" data-one>对一下</button>
              <button class="btn btn--sm btn--ghost" data-show>看答案</button>
            </div>
            <div class="rv-fb" data-fb hidden></div>
          </article>`).join('')}
      </div>
    </div>`;

  const scoreEl = $('[data-score]', host);
  const itemEls = $$('.rv-item', host);

  function syncBar() {
    const done = items.filter(it => saved[it.id]).length;
    const right = items.filter(it => saved[it.id] && saved[it.id].ok).length;
    scoreEl.innerHTML = `共 <b>${items.length}</b> 题 · 已作答 <b>${done}</b> · 答对 <b>${right}</b>`
      + (done ? ` · 正确率 <b>${Math.round(right / done * 100)}%</b>` : '');
  }

  function paintFeedback(it, el) {
    const rec = saved[it.id];
    const fb = $('[data-fb]', el);
    if (!rec) { fb.hidden = true; return; }
    fb.hidden = false;
    if (rec.ok) {
      fb.className = 'rv-fb is-ok';
      fb.innerHTML = `<b>对了。</b>${esc(it.full || '')}`;
    } else {
      fb.className = 'rv-fb is-bad';
      fb.innerHTML = `<b>还差一点。</b>答案是「<em>${esc(it.a)}</em>」`
        + (it.full ? `<br><span class="rv-fb__full">${esc(it.full)}</span>` : '')
        + (it.easy ? `<br><span class="rv-fb__easy">易错：${esc(it.easy)}</span>` : '');
    }
    el.classList.toggle('is-right', !!rec.ok);
    el.classList.toggle('is-wrong', !rec.ok);
  }

  /* 恢复上次的作答：输入框回填，并把对错状态重画一遍 */
  items.forEach((it, i) => {
    const el = itemEls[i];
    const input = $('[data-input]', el);
    const rec = saved[it.id];
    if (rec && rec.input) input.value = rec.input;
    paintFeedback(it, el);
  });

  function gradeOne(index, quiet) {
    const it = items[index];
    const el = itemEls[index];
    const val = $('[data-input]', el).value.trim();
    if (!val) { if (!quiet) toast('先写点什么再对答案'); return false; }
    saved[it.id] = { ok: isRight(it, val), input: val, at: Date.now() };
    store.set(key, saved);
    paintFeedback(it, el);
    syncBar();
    return true;
  }

  host.addEventListener('click', e => {
    const el = e.target.closest('.rv-item');
    if (!el) return;
    const index = itemEls.indexOf(el);
    if (e.target.closest('[data-one]')) { gradeOne(index); return; }
    if (e.target.closest('[data-show]')) {
      const it = items[index];
      const fb = $('[data-fb]', el);
      fb.hidden = false;
      fb.className = 'rv-fb is-peek';
      fb.innerHTML = `<b>答案</b>「<em>${esc(it.a)}</em>」`
        + (it.full ? `<br><span class="rv-fb__full">${esc(it.full)}</span>` : '')
        + (it.easy ? `<br><span class="rv-fb__easy">易错：${esc(it.easy)}</span>` : '');
      ctx.track?.('review', `${label}：看答案 · ${it.课 || it.tag || ''}`);
    }
  });

  $('[data-check]', host).addEventListener('click', () => {
    let n = 0;
    items.forEach((it, i) => { if ($('[data-input]', itemEls[i]).value.trim() && gradeOne(i, true)) n++; });
    const right = items.filter(it => saved[it.id] && saved[it.id].ok).length;
    toast(n ? `已判 ${n} 题，答对 ${right} 题` : '还没有填写任何一题');
    if (n) ctx.track?.('review', `${label}：答对 ${right}/${items.length}`);
  });

  $('[data-reset]', host).addEventListener('click', () => {
    items.forEach(it => delete saved[it.id]);
    store.set(key, saved);
    items.forEach((it, i) => {
      $('[data-input]', itemEls[i]).value = '';
      itemEls[i].classList.remove('is-right', 'is-wrong');
      const fb = $('[data-fb]', itemEls[i]); fb.hidden = true;
    });
    syncBar();
    toast('已清空，重新来一遍');
  });

  syncBar();
}

/* ---------- 选择自测 ---------- */
export function choiceQuiz(host, { items, key, ctx, label = '自测' }) {
  const saved = store.get(key, {}) || {};
  const LETTER = 'ABCDEF';

  host.innerHTML = `
    <div class="rv-quiz">
      <div class="rv-quiz__bar">
        <span class="rv-score" data-score></span>
        <div class="btn-row">
          <button class="btn btn--sm btn--ghost" data-reset>重做</button>
        </div>
      </div>
      <div class="rv-items">
        ${items.map((it, i) => `
          <article class="rv-item glass" data-id="${i}">
            <div class="rv-item__head">
              <span class="rv-idx">${i + 1}</span>
              <span class="rv-tag">${esc(it.tag || '')}</span>
            </div>
            <p class="rv-q">${esc(it.q)}</p>
            <div class="rv-opts">
              ${it.opts.map((o, j) => `
                <button class="rv-opt" data-o="${j}"><i>${LETTER[j]}</i><span>${esc(o)}</span></button>`).join('')}
            </div>
            <div class="rv-fb" data-fb hidden></div>
          </article>`).join('')}
      </div>
    </div>`;

  const scoreEl = $('[data-score]', host);
  const itemEls = $$('.rv-item', host);

  function syncBar() {
    const done = items.filter((_, i) => saved[i]).length;
    const right = items.filter((_, i) => saved[i] && saved[i].ok).length;
    scoreEl.innerHTML = `共 <b>${items.length}</b> 题 · 已答 <b>${done}</b> · 答对 <b>${right}</b>`
      + (done ? ` · 正确率 <b>${Math.round(right / done * 100)}%</b>` : '');
  }

  function paint(index, reveal = false) {
    const it = items[index], el = itemEls[index], rec = saved[index];
    const opts = $$('.rv-opt', el);
    opts.forEach((b, j) => {
      b.classList.remove('is-ok', 'is-bad', 'is-dim');
      b.removeAttribute('aria-disabled');
      if (!rec) return;
      if (j === it.a) b.classList.add('is-ok');
      else if (j === rec.picked) b.classList.add('is-bad');
      else b.classList.add('is-dim');
      b.setAttribute('aria-disabled', 'true');
    });
    const fb = $('[data-fb]', el);
    if (rec) {
      fb.hidden = false;
      fb.className = 'rv-fb ' + (rec.ok ? 'is-ok' : 'is-bad');
      fb.innerHTML = `<b>${rec.ok ? '对了。' : '答案是 ' + LETTER[it.a] + '。'}</b>${esc(it.析 || '')}`;
    } else if (reveal) {
      fb.hidden = true;
    }
  }

  items.forEach((_, i) => paint(i));

  itemEls.forEach((el, index) => {
    el.addEventListener('click', e => {
      const b = e.target.closest('.rv-opt');
      if (!b || saved[index]) return;
      const picked = Number(b.dataset.o);
      saved[index] = { picked, ok: picked === items[index].a, at: Date.now() };
      store.set(key, saved);
      paint(index);
      syncBar();
    });
  });

  $('[data-reset]', host).addEventListener('click', () => {
    Object.keys(saved).forEach(k => delete saved[k]);
    store.set(key, saved);
    itemEls.forEach((_, i) => {
      $$('.rv-opt', itemEls[i]).forEach(b => { b.classList.remove('is-ok', 'is-bad', 'is-dim'); b.removeAttribute('aria-disabled'); });
      const fb = $('[data-fb]', itemEls[i]); fb.hidden = true;
    });
    syncBar();
    toast('已清空，重新来一遍');
  });

  syncBar();
}

/* ---------- 小工具 ---------- */
export function listCard(label, arr, cls = '') {
  if (!arr || !arr.length) return '';
  return `${label ? `<div class="card__label">${esc(label)}</div>` : ''}
    <div class="note-list ${cls}">
      ${arr.map(t => `<div class="note-item"><span>${esc(t)}</span></div>`).join('')}
    </div>`;
}

export function chipRow(arr) {
  return `<div class="chips">${(arr || []).map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>`;
}

export async function copyText(text, okMsg = '已复制') {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
    return true;
  } catch {
    toast('浏览器不允许复制，可以手动选中');
    return false;
  }
}
