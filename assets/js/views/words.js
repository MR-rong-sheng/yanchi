/* 字词 —— 一座可以翻检的字库 */
import { $, $$, esc, ic, toast, store, openDrawer } from '../core.js';
import { load } from '../data.js';
import { addNote } from '../notes-store.js';

let all = [];
let pendingId = null;

/** 供其它模块（今日页 / 札记）直接跳到某一条 */
export function openById(id) { pendingId = id; }

export default {
  id: 'words', name: '字词', icon: 'words', nav: true,
  openById,                       /* 挂到路由对象上，供今日 / 课本等模块调用 */

  async mount(root, ctx) {
    all = await load('words');
    let q = '';
    let filter = 'all';
    let unit = 'all';

    root.innerHTML = `
      <section class="view-head">
        <div class="kicker">字库 · 共 ${all.length} 条</div>
        <h2>字词</h2>
        <p>先认字，再谈文。这里有两类条目：一类是为这个工具另写的字词札记，带部首、例句和用法提醒；
           另一类是九上课本各课的「读读写写」词表，按课与单元归档。</p>
      </section>

      <div class="card glass spec">
        <div class="btn-row" style="justify-content:space-between">
          <label class="field" style="flex:1;min-width:220px">
            ${ic('search')}
            <input type="search" data-q placeholder="搜字、读音、释义…" autocomplete="off" />
          </label>
          <div class="seg" data-filter>
            <button data-v="all" aria-pressed="true">全部</button>
            <button data-v="todo">未掌握</button>
            <button data-v="done">已掌握</button>
          </div>
          <label class="field" style="flex:0 1 190px;min-width:140px">
            <select data-unit>
              <option value="all">全部单元</option>
              ${[...new Set(all.map(w => w.单元).filter(Boolean))].map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>

      <div class="grid grid--3" data-grid style="margin-top:16px"></div>
      <div class="empty" data-empty hidden><b>没有匹配的字词</b>换一个关键词，或把筛选切回“全部”。</div>
    `;

    const grid = $('[data-grid]', root);
    const emptyEl = $('[data-empty]', root);
    const doneSet = () => new Set(store.get('words.done', []));

    function list() {
      const done = doneSet();
      return all.filter(w => {
        if (filter === 'done' && !done.has(w.id)) return false;
        if (filter === 'todo' && done.has(w.id)) return false;
        if (unit !== 'all' && w.单元 !== unit) return false;
        if (!q) return true;
        const s = `${w.字} ${w.音} ${w.义} ${w.例 || ''} ${w.用 || ''} ${w.课 || ''} ${w.单元 || ''} ${(w.标签 || []).join(' ')}`.toLowerCase();
        return s.includes(q);
      });
    }

    function paint() {
      const done = doneSet();
      const items = list();
      emptyEl.hidden = items.length > 0;
      grid.innerHTML = items.map(w => `
        <article class="word-card ${done.has(w.id) ? 'is-done' : ''}" data-id="${esc(w.id)}"
                 tabindex="0" role="button" aria-label="查看 ${esc(w.字)}">
          <div class="word-card__z">${esc(w.字)}</div>
          <div class="word-card__p">${esc(w.音)}</div>
          <div class="word-card__d">${esc(w.义)}</div>
          <div class="word-card__foot">
            <span class="chip">${w.部首 ? '部首 ' + esc(w.部首) : esc(w.课 || '')}</span>
            <button class="mini" data-done title="${done.has(w.id) ? '取消已掌握' : '标记已掌握'}"
                    aria-pressed="${done.has(w.id)}">${ic('check')}</button>
          </div>
        </article>
      `).join('');

      $$('.word-card', grid).forEach(card => {
        const open = () => detail(all.find(x => x.id === card.dataset.id));
        card.addEventListener('click', open);
        card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
        card.querySelector('[data-done]').addEventListener('click', e => {
          e.stopPropagation();
          const set = doneSet();
          set.has(card.dataset.id) ? set.delete(card.dataset.id) : set.add(card.dataset.id);
          store.set('words.done', [...set]);
          paint();
        });
      });
    }

    function detail(w) {
      if (!w) return;
      const done = doneSet().has(w.id);
      openDrawer({
        title: w.字,
        sub: `${w.音}${(w.部首 && Number.isFinite(w.笔画)) ? `　·　部首 ${w.部首}　·　${w.笔画} 画`
              : (w.课 ? `　·　${w.课}` : '')}`,
        html: `
          ${w.课 ? `<div class="kv"><b>课本</b><span>${esc(w.课)}${w.单元 ? '　·　' + esc(w.单元) : ''}</span></div>` : ''}
          <div class="kv"><b>释义</b><span>${esc(w.义)}</span></div>
          ${w.例 ? `<div class="kv"><b>例句</b><span>${esc(w.例)}</span></div>` : ''}
          ${w.用 ? `<div class="kv"><b>用法</b><span>${esc(w.用)}</span></div>` : ''}
          ${(w.部首 || Number.isFinite(w.笔画)) ? `<div class="kv"><b>字形</b><span>${[
            w.部首 ? `部首 ${esc(w.部首)}` : '', Number.isFinite(w.笔画) ? `${w.笔画} 画` : ''
          ].filter(Boolean).join('　·　')}</span></div>` : ''}
          ${(w.标签 || []).length ? `<div class="chips" style="margin-top:16px">${w.标签.map(t => `<span class="chip chip--accent">${esc(t)}</span>`).join('')}</div>` : ''}
        `,
        actions: [
          { label: '收入札记', icon: 'plus', kind: 'primary', onClick: ({ closeDrawer }) => {
              addNote({
                kind: 'word',
                title: w.字,
                from: `${w.音}${w.部首 ? '　部首 ' + w.部首 : (w.课 ? '　' + w.课 : '')}`,
                body: [
                  w.课 ? `课本：${w.课}` : '',
                  `释义：${w.义}`,
                  w.例 ? `例句：${w.例}` : '',
                  w.用 ? `用法：${w.用}` : '',
                ].filter(Boolean).join('\n\n'),
                tags: w.标签 || [],
              });
              toast(`「${w.字}」已收进札记`);
              closeDrawer();
            } },
          { label: done ? '取消已掌握' : '标记已掌握', icon: 'check', onClick: ({ closeDrawer }) => {
              const set = doneSet();
              set.has(w.id) ? set.delete(w.id) : set.add(w.id);
              store.set('words.done', [...set]);
              paint();
              closeDrawer();
            } },
        ],
        onClose: () => paint(),
      });
    }

    $('[data-q]', root).addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); paint(); });
    $$('[data-filter] button', root).forEach(b => b.addEventListener('click', () => {
      filter = b.dataset.v;
      $$('[data-filter] button', root).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      paint();
    }));
    $('[data-unit]', root).addEventListener('change', e => { unit = e.target.value; paint(); });

    paint();

    if (pendingId) {
      const w = all.find(x => x.id === pendingId);
      pendingId = null;
      if (w) detail(w);
    }
  },
};
