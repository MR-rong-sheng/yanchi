/* 课本 —— 按单元列出整册的课文、写作与诵读篇目 */
import { $, $$, esc, ic, toast, store } from '../core.js';
import { load } from '../data.js';
import poemsView from './poems.js';
import writeView from './write.js';

const EDITION = '统编版九年级上册 · 2024审定版（2026 秋启用）';

/* 题名归一化：去掉书名号、括号注、并把「其一」这类去掉，方便与诗文库对上 */
function norm(s) {
  return String(s)
    .replace(/[《》「」（）()\s]/g, '')
    .replace(/其一|节选|三首|五首/g, '')
    .trim();
}

/** 一行里可能含多篇（用 · 分隔），逐个去诗文库里找 */
function findPoems(title, poems) {
  const parts = String(title).split(/[·、，]/).map(norm).filter(t => t.length >= 2);
  const hit = [];
  for (const p of poems) {
    const pn = norm(p.题);
    if (parts.some(t => pn === t || pn.startsWith(t) || t.startsWith(pn))) hit.push(p);
  }
  return hit;
}

export default {
  id: 'units', name: '课本', icon: 'book', nav: true,

  async mount(root, ctx) {
    const [units, poems, prompts] = await Promise.all([
      load('units'), load('poems'), load('prompts'),
    ]);

    /* 每篇课文能对上的诗文、能对上的写作题，都先算好 */
    const linkOf = new Map();
    const promptOf = new Map();
    units.forEach(u => {
      /* 一行含多篇的（如「诗词三首」）用 诗文 字段显式列出篇名 */
      const t = k => findPoems(k.诗文 ? k.诗文.join('·') : k.题, poems);
      u.课文.forEach(k => linkOf.set(u.id + '|' + k.no, t(k)));
      (u.其他 || []).forEach((o, i) => linkOf.set(u.id + '|o' + i, t(o)));
    });
    prompts.forEach(p => promptOf.set(norm(p.题), p));

    const totalLessons = units.reduce((n, u) => n + u.课文.length, 0);
    const linkedCount = [...linkOf.values()].reduce((n, a) => n + a.length, 0);

    let q = '';

    root.innerHTML = `
      <section class="view-head">
        <div class="kicker">课本 · ${esc(EDITION)}</div>
        <h2>课本</h2>
        <p>整册 ${units.length} 个单元、${totalLessons} 篇课文，已与诗文库打通 ${linkedCount} 篇原文。
           现代文的全文有版权，这里只给导读与要点；文言诗词的原文可以直接点开读。</p>
      </section>

      <div class="card glass spec">
        <label class="field">
          ${ic('search')}
          <input type="search" data-q placeholder="搜课文、作者、单元主题…" autocomplete="off" />
        </label>
        <div class="chips" style="margin-top:12px">
          ${units.map(u => `<span class="chip">第${'一二三四五六'[u.序号 - 1]}单元 · ${esc(u.副题)}</span>`).join('')}
        </div>
      </div>

      <div data-units style="margin-top:16px"></div>
      <div class="empty" data-empty hidden><b>没有匹配的课文</b>换一个关键词试试。</div>
    `;

    const wrap = $('[data-units]', root);
    const emptyEl = $('[data-empty]', root);

    function paint() {
      const kw = q.toLowerCase();
      let shown = 0;

      wrap.innerHTML = units.map(u => {
        const lessons = u.课文.filter(k =>
          !kw || `${k.no} ${k.题} ${k.作者} ${k.体裁} ${k.导读} ${(k.要点 || []).join('')}`.toLowerCase().includes(kw));
        if (!lessons.length && kw) return '';
        shown += lessons.length;

        return `
          <article class="card glass spec" style="margin-bottom:16px">
            <div class="card__label">第${'一二三四五六'[u.序号 - 1]}单元 · ${esc(u.主题)} · ${esc(u.副题)}</div>
            <p class="quote" style="margin-bottom:14px;font-size:14px">${esc(u.导语)}</p>

            <div class="list">
              ${lessons.map(k => {
                const links = linkOf.get(u.id + '|' + k.no) || [];
                return `
                  <button class="lesson" data-unit="${u.id}" data-no="${k.no}">
                    <span class="lesson__no">${esc(k.no)}</span>
                    <span class="lesson__main">
                      <span class="lesson__t">${esc(k.题)}</span>
                      <span class="lesson__s">${esc(k.作者)} · ${esc(k.体裁)}${links.length ? ` · 可读原文 ${links.length} 篇` : ''}</span>
                    </span>
                    <span class="chips" style="flex:0 0 auto">
                      <span class="chip ${k.精读 ? 'chip--accent' : ''}">${k.精读 ? '精读' : '自读'}</span>
                    </span>
                  </button>`;
              }).join('') || `<div class="empty">本单元没有匹配的课文</div>`}
            </div>

            <div class="list" style="margin-top:10px">
              <button class="lesson" data-write="${esc(u.写作.题)}">
                <span class="lesson__no">✎</span>
                <span class="lesson__main">
                  <span class="lesson__t">写作 · ${esc(u.写作.题)}</span>
                  <span class="lesson__s">${esc(u.写作.要点.join('　·　'))}</span>
                </span>
                <span class="row__go">${ic('right')}</span>
              </button>
              ${(u.其他 || []).map((o, i) => `
                <button class="lesson" data-unit="${u.id}" data-other="${i}">
                  <span class="lesson__no">◇</span>
                  <span class="lesson__main">
                    <span class="lesson__t">${esc(o.类型)} · ${esc(o.题)}</span>
                    <span class="lesson__s">${esc(o.说明 || '')}</span>
                  </span>
                  <span class="row__go">${ic('right')}</span>
                </button>`).join('')}
            </div>
          </article>`;
      }).join('');

      emptyEl.hidden = shown > 0 || !kw;

      /* 课文详情 */
      $$('[data-unit]', wrap).forEach(btn => btn.addEventListener('click', () => {
        const u = units.find(x => x.id === btn.dataset.unit);
        if (!u) return;
        const isOther = btn.dataset.other !== undefined;
        const item = isOther ? (u.其他 || [])[Number(btn.dataset.other)] : u.课文.find(k => k.no === btn.dataset.no);
        if (!item) return;
        const links = linkOf.get(u.id + '|' + (isOther ? 'o' + btn.dataset.other : btn.dataset.no)) || [];

        ctx.openDrawer({
          title: item.题,
          sub: `第${'一二三四五六'[u.序号 - 1]}单元${isOther ? '　·　' + item.类型 : `　·　${item.作者}　·　${item.体裁}`}`,
          html: `
            ${item.导读 ? `
              <div class="card__label">导读</div>
              <div class="analysis">${esc(item.导读)}</div>` : ''}
            ${item.说明 ? `
              <div class="card__label">说明</div>
              <div class="analysis">${esc(item.说明)}</div>` : ''}
            ${item.要点 ? `
              <hr class="hr" />
              <div class="card__label">学习要点</div>
              <div class="note-list">
                ${item.要点.map((t, i) => `<div class="note-item"><b>${i + 1}.</b><span>${esc(t)}</span></div>`).join('')}
              </div>` : ''}
            ${links.length ? `
              <hr class="hr" />
              <div class="card__label">本册诗文库中的原文</div>
              <div class="chips">
                ${links.map(p => `<span class="chip chip--accent">${esc(p.题)}</span>`).join('')}
              </div>` : ''}
            <p style="margin-top:20px;font-size:12px;color:var(--ink-4);line-height:1.9">
              现代文全文受著作权保护，本站不转载；文言与古诗词原文属公有领域，可在诗文模块完整阅读。
            </p>
          `,
          actions: links.length ? [{
            label: links.length > 1 ? `读《${links[0].题}》等 ${links.length} 篇原文` : `读《${links[0].题}》原文`,
            icon: 'book', kind: 'primary',
            onClick: ({ closeDrawer }) => {
              poemsView.openById(links[0].id);
              closeDrawer();
              ctx.go('poems');
            },
          }] : [],
        });
      }));

      /* 写作任务 */
      $$('[data-write]', wrap).forEach(btn => btn.addEventListener('click', () => {
        const title = btn.dataset.write;
        const p = promptOf.get(norm(title));
        ctx.openDrawer({
          title: '写作 · ' + title,
          sub: '本单元写作任务',
          html: p
            ? `<div class="card__label">题目</div>
               <div style="font-family:var(--font-serif);font-size:18px">${esc(p.题)}</div>
               <p class="quote" style="margin-top:12px">${esc(p.材料)}</p>
               <hr class="hr" />
               <div class="card__label">提示</div>
               <div class="note-list">${(p.提示 || []).map((t, i) => `<div class="note-item"><b>${i + 1}.</b><span>${esc(t)}</span></div>`).join('')}</div>`
            : `<p class="quote">这个写作任务还没有配套的题目，可以在写作模块里自行起笔。</p>`,
          actions: p ? [{
            label: '去写这一篇', icon: 'write', kind: 'primary',
            onClick: ({ closeDrawer }) => { writeView.openById(p.id); closeDrawer(); ctx.go('write'); },
          }] : [],
        });
      }));
    }

    $('[data-q]', root).addEventListener('input', e => { q = e.target.value.trim(); paint(); });
    paint();
  },
};
