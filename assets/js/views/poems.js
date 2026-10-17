/* 诗文 —— 读，注释，标一句“背下来了” */
import { $, $$, esc, ic, toast, store, openDrawer } from '../core.js';
import { load } from '../data.js';
import { addNote } from '../notes-store.js';

let all = [];
let pendingId = null;
export function openById(id) { pendingId = id; }

/* 诗、词、曲按行居中；文（文言散文）按段左对齐、首行缩进 */
const isVerse = p => !p.类 || p.类 === '诗' || p.类 === '词' || p.类 === '曲';

/** 把一篇诗文的正文渲染成 HTML */
export function bodyHTML(p) {
  if (isVerse(p)) {
    return `<div class="poem"><div class="poem__lines">
      ${p.原文.map(l => `<span>${esc(l)}</span>`).join('')}
    </div></div>`;
  }
  return `<div class="paper">${p.原文.map(seg => `<p>${esc(seg)}</p>`).join('')}</div>`;
}

export default {
  id: 'poems', name: '诗文', icon: 'poems', nav: true,
  openById,                       /* 挂到路由对象上，供今日 / 课本等模块调用 */

  async mount(root, ctx) {
    all = await load('poems');
    let q = '';
    let onlyTodo = false;
    let unit = 'all';

    const unitsOf = [...new Set(all.map(p => p.单元 || '其他'))];

    root.innerHTML = `
      <section class="view-head">
        <div class="kicker">篇目 · 共 ${all.length} 篇</div>
        <h2>诗文</h2>
        <p>文言与古诗词原文属公有领域，这里放的是完整原文；注释与编者按都是为这个工具另写的，不搬现成的教辅。</p>
      </section>

      <div class="card glass spec">
        <div class="btn-row" style="justify-content:space-between">
          <label class="field" style="flex:1;min-width:190px">
            ${ic('search')}
            <input type="search" data-q placeholder="搜篇名、作者、句子…" autocomplete="off" />
          </label>
          <label class="field" style="flex:0 1 190px;min-width:140px">
            <select data-unit>
              <option value="all">全部单元</option>
              ${unitsOf.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('')}
            </select>
          </label>
          <div class="seg" data-filter>
            <button data-v="all" aria-pressed="true">全部</button>
            <button data-v="todo">还没背</button>
          </div>
        </div>
      </div>

      <div class="grid grid--2" data-grid style="margin-top:16px"></div>
    `;

    const grid = $('[data-grid]', root);
    const doneSet = () => new Set(store.get('poems.done', []));

    function list() {
      const done = doneSet();
      return all.filter(p => {
        if (onlyTodo && done.has(p.id)) return false;
        if (unit !== 'all' && (p.单元 || '其他') !== unit) return false;
        if (!q) return true;
        const s = `${p.题} ${p.作者} ${p.朝代} ${p.体裁 || ''} ${p.原文.join('')} ${(p.标签 || []).join(' ')}`.toLowerCase();
        return s.includes(q);
      });
    }

    function paint() {
      const done = doneSet();
      const items = list();
      grid.innerHTML = items.length ? items.map(p => `
        <button class="row glass spec" style="border-radius:var(--r);padding:16px 18px;align-items:flex-start" data-id="${esc(p.id)}">
          <div class="row__main">
            <div class="row__t" style="font-family:var(--font-serif);font-size:17px">《${esc(p.题)}》</div>
            <div class="row__s" style="letter-spacing:.1em">${esc(p.朝代)} · ${esc(p.作者)}${p.体裁 ? ' · ' + esc(p.体裁) : ''}</div>
            <div class="row__s" style="margin-top:8px;white-space:normal;font-family:var(--font-serif);color:var(--ink-2)">
              ${esc(String(p.原文[0]).slice(0, 36))}${String(p.原文[0]).length > 36 ? '……' : ''}
            </div>
            <div class="chips" style="margin-top:12px">
              ${done.has(p.id) ? `<span class="chip chip--accent">${ic('check')}已背</span>` : ''}
              ${p.单元 ? `<span class="chip">${esc(p.单元)}</span>` : ''}
              ${(p.标签 || []).slice(0, 3).map(t => `<span class="chip">${esc(t)}</span>`).join('')}
            </div>
          </div>
          <span class="row__go">${ic('right')}</span>
        </button>
      `).join('') : `<div class="empty" style="grid-column:1/-1"><b>这里暂时是空的</b>换个关键词，或把筛选条件放宽。</div>`;

      $$('[data-id]', grid).forEach(row => row.addEventListener('click', () => detail(all.find(x => x.id === row.dataset.id))));
    }

    function detail(p) {
      if (!p) return;
      const done = doneSet().has(p.id);
      openDrawer({
        title: `《${p.题}》`,
        sub: `${p.朝代} · ${p.作者}${p.单元 ? '　·　' + p.单元 : ''}${done ? '　·　已背' : ''}`,
        html: `
          ${bodyHTML(p)}
          ${p.节选说明 ? `<p style="margin-top:14px;font-size:12px;color:var(--ink-4);line-height:1.9">${esc(p.节选说明)}</p>` : ''}
          ${(p.注释 || []).length ? `
            <hr class="hr" />
            <div class="card__label">注释</div>
            <div class="note-list">
              ${p.注释.map(n => `<div class="note-item"><b>${esc(n.词)}</b><span>${esc(n.释)}</span></div>`).join('')}
            </div>` : ''}
          ${(p.析 || []).length ? `
            <hr class="hr" />
            <div class="card__label">编者按</div>
            <div class="analysis">${p.析.map(t => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
          ${(p.名句 || []).length ? `
            <hr class="hr" />
            <div class="card__label">名句</div>
            <div class="note-list">${p.名句.map(t => `<div class="note-item"><b>·</b><span>${esc(t)}</span></div>`).join('')}</div>` : ''}
          <div class="chips" style="margin-top:18px">
            ${(p.标签 || []).map(t => `<span class="chip chip--accent">${esc(t)}</span>`).join('')}
            ${p.来源 ? `<span class="chip" title="${esc(p.来源)}">原文已核对</span>` : ''}
          </div>
        `,
        actions: [
          { label: '收入札记', icon: 'plus', kind: 'primary', onClick: ({ closeDrawer }) => {
              addNote({
                kind: 'poem', title: `《${p.题}》`, from: `${p.朝代} · ${p.作者}`,
                body: `${p.原文.join('\n')}\n\n——\n${(p.析 || []).join('\n\n')}`,
                tags: p.标签 || [],
              });
              toast('全篇已收进札记');
              closeDrawer();
            } },
          { label: done ? '取消已背' : '背下来了', icon: 'check', onClick: ({ closeDrawer }) => {
              const set = doneSet();
              set.has(p.id) ? set.delete(p.id) : set.add(p.id);
              store.set('poems.done', [...set]);
              paint();
              toast(done ? '已取消标记' : '记下了，之后还会遇见它');
              closeDrawer();
            } },
        ],
        onClose: () => paint(),
      });
    }

    $('[data-q]', root).addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); paint(); });
    $('[data-unit]', root).addEventListener('change', e => { unit = e.target.value; paint(); });
    $$('[data-filter] button', root).forEach(b => b.addEventListener('click', () => {
      onlyTodo = b.dataset.v === 'todo';
      $$('[data-filter] button', root).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      paint();
    }));

    paint();

    if (pendingId) {
      const p = all.find(x => x.id === pendingId);
      pendingId = null;
      if (p) detail(p);
    }
  },
};
