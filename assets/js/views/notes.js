/* 札记 —— 工具真正的沉淀处 */
import { $, $$, esc, ic, toast, store, download, openDrawer, stamp } from '../core.js';
import { listNotes, addNote, removeNote, toMarkdown, KIND_LABEL } from '../notes-store.js';

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  }
}

export default {
  id: 'notes', name: '札记', icon: 'notes', nav: true,

  mount(root, ctx) {
    let kind = 'all';

    root.innerHTML = `
      <section class="view-head">
        <div class="kicker">本地笔记本</div>
        <h2>札记</h2>
        <p>字词、诗文、习作、随手一句，都归到这里。所有内容只写在这台电脑的浏览器存储里。</p>
      </section>

      <div class="card glass spec">
        <div class="btn-row" style="justify-content:space-between">
          <div class="seg" data-filter>
            <button data-v="all" aria-pressed="true">全部</button>
            <button data-v="word">字词</button>
            <button data-v="poem">诗文</button>
            <button data-v="write">习作</button>
            <button data-v="free">随笔</button>
          </div>
          <div class="btn-row">
            <button class="btn btn--primary" data-new>${ic('plus')}写一条</button>
            <button class="btn" data-export>${ic('down')}导出</button>
            <button class="btn btn--ghost" data-clear>${ic('trash')}清空</button>
          </div>
        </div>
      </div>

      <div class="card glass spec" style="margin-top:16px">
        <div class="list" data-list></div>
      </div>
    `;

    const listEl = $('[data-list]', root);

    function paint() {
      const items = listNotes().filter(n => kind === 'all' || n.kind === kind);
      if (!items.length) {
        listEl.innerHTML = `<div class="empty"><b>还没有札记</b>在字词或诗文里点“收入札记”，或在今日页写下几句话。</div>`;
        return;
      }
      listEl.innerHTML = items.map(n => `
        <button class="row" data-id="${esc(n.id)}">
          <span class="chip chip--accent" style="flex:0 0 auto">${esc(KIND_LABEL[n.kind] || n.kind)}</span>
          <span class="row__main">
            <span class="row__t" style="display:block;font-family:var(--font-serif)">${esc(n.title || '（无题）')}</span>
            <span class="row__s" style="display:block;white-space:normal;line-height:1.7;max-height:3.4em;overflow:hidden">${esc(n.body.replace(/\n/g, ' '))}</span>
          </span>
          <span class="row__s" style="flex:0 0 auto;color:var(--ink-4)">${esc(stamp(n.at).slice(5))}</span>
        </button>
      `).join('');

      $$('[data-id]', listEl).forEach(row => row.addEventListener('click', () => {
        const n = listNotes().find(x => x.id === row.dataset.id);
        if (n) detail(n);
      }));
    }

    function detail(n) {
      openDrawer({
        title: n.title || '（无题）',
        sub: `${KIND_LABEL[n.kind] || n.kind}${n.from ? '　·　' + n.from : ''}　·　${stamp(n.at)}`,
        html: `<div style="white-space:pre-wrap;font-family:var(--font-serif);font-size:15px;line-height:2.1">${esc(n.body)}</div>`,
        actions: [
          { label: '复制', icon: 'book', onClick: async ({ closeDrawer }) => {
              (await copy(`${n.title}\n\n${n.body}`)) ? toast('已复制到剪贴板') : toast('复制失败，可以手动选中');
              closeDrawer();
            } },
          { label: '删除', icon: 'trash', onClick: ({ closeDrawer }) => {
              if (!confirm(`删除「${n.title || '无题'}」？`)) return;
              removeNote(n.id); closeDrawer(); paint(); toast('已删除');
            } },
        ],
      });
    }

    $('[data-new]', root).addEventListener('click', () => {
      openDrawer({
        title: '写一条札记',
        sub: '只存在本机',
        html: `
          <label class="field" style="border-radius:var(--r-sm);margin-bottom:12px">
            <input type="text" id="n-title" placeholder="标题（可留空）" autocomplete="off" />
          </label>
          <textarea class="editor" id="n-body" style="min-height:220px" placeholder="想到什么就写什么……"></textarea>
        `,
        actions: [
          { label: '保存', icon: 'check', kind: 'primary', onClick: ({ closeDrawer }) => {
              const title = ($('#n-title').value || '').trim();
              const body = ($('#n-body').value || '').trim();
              if (!body) return toast('内容还是空的');
              addNote({ kind: 'free', title: title || '随笔', body, from: '手写' });
              closeDrawer(); paint(); toast('已保存');
            } },
        ],
      });
      setTimeout(() => $('#n-body')?.focus(), 60);
    });

    $('[data-export]', root).addEventListener('click', () => {
      const list = listNotes();
      if (!list.length) return toast('还没有札记可以导出');
      download(`砚池札记-${new Date().toISOString().slice(0, 10)}.md`, toMarkdown(list), 'text/markdown');
      toast(`已导出 ${list.length} 条札记`);
    });

    $('[data-clear]', root).addEventListener('click', () => {
      const n = listNotes().length;
      if (!n) return toast('已经是空的');
      if (!confirm(`清空全部 ${n} 条札记？此操作不能撤销，建议先导出。`)) return;
      store.set('notes', []); paint(); toast('已清空');
    });

    $$('[data-filter] button', root).forEach(b => b.addEventListener('click', () => {
      kind = b.dataset.v;
      $$('[data-filter] button', root).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      paint();
    }));

    paint();
  },
};
