/* 写作 —— 题目不是任务，是一个出口 */
import { $, $$, esc, ic, toast, store, download, stamp, countHan, countAll } from '../core.js';
import { load } from '../data.js';
import { addNote } from '../notes-store.js';

let all = [];
let activeId = null;
let pendingId = null;
export function openById(id) { pendingId = id; }

const drafts = () => store.get('drafts', {});
function saveDraft(id, text) {
  const d = drafts();
  if (text.trim()) d[id] = { text, at: Date.now() };
  else delete d[id];
  store.set('drafts', d);
}

export default {
  id: 'write', name: '写作', icon: 'write', nav: true,
  openById,                       /* 挂到路由对象上，供今日 / 课本等模块调用 */

  async mount(root, ctx) {
    all = await load('prompts');
    if (pendingId) { activeId = pendingId; pendingId = null; }
    if (!all.some(p => p.id === activeId)) activeId = null;
    activeId ? paintEditor() : paintList();

    /* ---------- 题目列表 ---------- */
    function paintList() {
      const d = drafts();
      root.innerHTML = `
        <section class="view-head">
          <div class="kicker">题目 · 共 ${all.length} 道</div>
          <h2>写作</h2>
          <p>每道题都只是起点。草稿自动存在本机，写得不好也留着——改比写重要。</p>
        </section>

        <div class="grid grid--2">
          ${all.map(p => {
            const has = d[p.id];
            return `
              <article class="card glass spec" data-id="${esc(p.id)}" style="display:flex;flex-direction:column;gap:10px">
                <div class="card__label" style="margin-bottom:2px">${esc(p.体裁)}${has ? ' · 有草稿' : ''}</div>
                <div style="font-family:var(--font-serif);font-size:19px;line-height:1.5">${esc(p.题)}</div>
                <p class="quote" style="font-size:13.5px;color:var(--ink-3)">${esc(p.材料)}</p>
                <div class="chips">${(p.标签 || []).map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
                <div class="btn-row" style="margin-top:6px">
                  <button class="btn btn--primary btn--sm" data-write>${has ? '接着写' : '写这一篇'}</button>
                  ${has ? `<span class="chip">${countHan(d[p.id].text)} 字 · ${stamp(d[p.id].at).slice(5)}</span>` : ''}
                </div>
              </article>`;
          }).join('')}
        </div>
      `;

      $$('[data-id]', root).forEach(card => card.querySelector('[data-write]')
        .addEventListener('click', () => { activeId = card.dataset.id; paintEditor(); window.scrollTo({ top: 0 }); }));
    }

    /* ---------- 写稿 ---------- */
    function paintEditor() {
      const p = all.find(x => x.id === activeId);
      if (!p) return paintList();
      const draft = drafts()[p.id];
      const text = draft ? draft.text : '';

      root.innerHTML = `
        <section class="view-head">
          <div class="kicker">${esc(p.体裁)}</div>
          <h2>${esc(p.题)}</h2>
          <p>${esc(p.材料)}</p>
        </section>

        <div class="grid grid--2">
          <div class="card glass spec">
            <div class="card__label">可以这样想</div>
            <div class="note-list">
              ${(p.提示 || []).map((t, i) => `<div class="note-item"><b>${i + 1}.</b><span>${esc(t)}</span></div>`).join('')}
            </div>
          </div>
          <div class="card glass spec">
            <div class="card__label">结构建议</div>
            <div class="note-list">
              ${(p.结构 || []).map((t, i) => `<div class="note-item"><b>${'一二三四五六'[i] || i + 1}</b><span>${esc(t)}</span></div>`).join('')}
            </div>
          </div>
        </div>

        <div class="card glass spec" style="margin-top:16px">
          <div class="card__label">草稿</div>
          <textarea class="editor" data-editor placeholder="先写第一句，不管它好不好……">${esc(text)}</textarea>
          <div class="btn-row" style="margin-top:14px">
            <button class="btn btn--primary" data-to-note>${ic('plus')}收进札记</button>
            <button class="btn" data-export>${ic('down')}导出 Markdown</button>
            <button class="btn btn--ghost" data-again>清空重写</button>
            <button class="btn btn--ghost" data-back>换一道题</button>
            <span style="font-size:12.5px;color:var(--ink-3);margin-left:auto" data-count></span>
          </div>
        </div>
      `;

      const ta = $('[data-editor]', root);
      const countEl = $('[data-count]', root);
      const showCount = () => {
        const han = countHan(ta.value), allc = countAll(ta.value);
        countEl.textContent = allc ? `${han} 个汉字 · 共 ${allc} 字符` : '还没落笔';
        countEl.textContent += draft && draft.at ? `　·　上次保存 ${stamp(draft.at)}` : '';
      };
      showCount();

      let timer;
      ta.addEventListener('input', () => {
        showCount();
        clearTimeout(timer);
        timer = setTimeout(() => { saveDraft(p.id, ta.value); }, 500);
      });
      ta.focus();

      $('[data-to-note]', root).addEventListener('click', () => {
        const body = ta.value.trim();
        if (!body) return toast('还没有内容可以收');
        saveDraft(p.id, ta.value);
        addNote({ kind: 'write', title: p.题, from: `${p.体裁}　习作`, body, tags: p.标签 || [] });
        toast('习作已存进札记');
      });

      $('[data-export]', root).addEventListener('click', () => {
        const body = ta.value.trim();
        if (!body) return toast('还没有内容可以导出');
        const md = `# ${p.题}\n\n> ${p.体裁} · 砚池习作 · ${stamp(Date.now())}\n\n${body}\n`;
        download(`砚池-${p.题}.md`, md, 'text/markdown');
        toast('已导出 .md 文件');
      });

      $('[data-again]', root).addEventListener('click', () => {
        if (!confirm('清空这篇草稿？此操作不能撤销。')) return;
        ta.value = ''; saveDraft(p.id, ''); showCount(); toast('已清空');
      });

      $('[data-back]', root).addEventListener('click', () => { activeId = null; paintList(); });
    }
  },
};
