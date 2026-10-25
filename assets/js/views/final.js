/* ==========================================================================
   期末复习 —— 九年级全册（九上见「期中」专区，这里是九下 + 跨册回看）
   一张卷子该拿的分，按「地图 → 清单 → 自测 → 方法 → 作文」摆开。
   ========================================================================== */
import { $, $$, esc, ic, toast, store, download } from '../core.js';
import { load } from '../data.js';
import { tabBar, bindTabs, fillQuiz, listCard, chipRow, copyText } from '../review-kit.js';

const TABS = [
  { id: 'map',    label: '考点地图', icon: 'today' },
  { id: 'know',   label: '知识清单', icon: 'book' },
  { id: 'dict',   label: '默写自测', icon: 'write' },
  { id: 'wenyan', label: '文言突破', icon: 'poems' },
  { id: 'poem',   label: '诗歌鉴赏', icon: 'poems' },
  { id: 'book',   label: '整本书',   icon: 'notes' },
  { id: 'read',   label: '阅读方法', icon: 'search' },
  { id: 'write',  label: '作文',     icon: 'edit' },
];

const PLAN_KEY = 'final9.plan';

let mountSeq = 0;      /* 防止并发挂载：后一次挂载顶掉前一次时，前一次不许再写 DOM */

export default {
  id: 'final', name: '期末', icon: 'log', nav: true,

  async mount(root, ctx) {
    const seq = ++mountSeq;
    const d = await load('final9');
    if (seq !== mountSeq || !root.isConnected) return;

    root.innerHTML = `
      <section class="view-head">
        <div class="kicker">复习专区 · ${esc(d.meta.range)}</div>
        <h2>九年级期末复习</h2>
        <p>${esc(d.meta.basis)}</p>
        <p style="margin-top:6px;color:var(--ink-3);font-size:12.5px">
          九上全册的逐篇清单、47 句默写、60 个实词在「期中」专区；这里收九下，以及期末最容易跨册混考的那几条。
        </p>
        <div class="chips">
          ${d.units.map((u, i) => `<span class="chip ${i < 3 ? 'chip--accent' : ''}">${esc(u.名)}</span>`).join('')}
          <span class="chip">整本书阅读 · ${d.books.map(b => esc(b.书)).join('、')}</span>
        </div>
      </section>

      ${tabBar(TABS)}

      <div class="rv-pane" data-pane></div>

      <p class="rv-note">${esc(d.meta.note)}</p>
    `;

    const pane = $('[data-pane]', root);
    const tabsEl = $('.rv-tabs', root);
    let active = 'map';

    function paint() {
      pane.innerHTML = draw(active);
      bind(active);
    }

    bindTabs(root, id => {
      active = id;
      paint();
      /* 从页面下方切分区时，把视线带回分区顶部（sticky 顶栏下面） */
      if (pane.getBoundingClientRect().top < 60) tabsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    /* ---------------- 各分区的内容 ---------------- */
    function draw(id) {
      if (id === 'map') return mapHTML();
      if (id === 'know') return knowHTML();
      if (id === 'dict') return dictHTML();
      if (id === 'wenyan') return wenyanHTML();
      if (id === 'poem') return poemHTML();
      if (id === 'book') return bookHTML();
      if (id === 'read') return readHTML();
      return writeHTML();
    }

    function mapHTML() {
      const plan = store.get(PLAN_KEY, {}) || {};
      return `
        <div class="card glass">
          <div class="card__label">卷面怎么分（${d.meta.score || 140} 分卷 · 参考）</div>
          <div class="rv-table">
            <table>
              <thead><tr><th>部分</th><th>分值</th><th>建议用时</th><th>考什么</th><th>目标</th></tr></thead>
              <tbody>
                ${d.map.papers.map(p => `
                  <tr>
                    <td><b>${esc(p.部分)}</b></td>
                    <td class="rv-num">${esc(p.分)}</td>
                    <td class="rv-num">${esc(p.分钟)} 分</td>
                    <td>${esc(p.内容.join('、'))}</td>
                    <td class="rv-goal">${esc(p.目标)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="grid grid--2" style="margin-top:16px">
          <div class="card glass">
            <div class="card__label">三条战术</div>
            <div class="note-list">
              ${d.map.tactics.map((t, i) => `
                <div class="note-item">
                  <b>${i + 1}.</b>
                  <span><b class="rv-strong">${esc(t.t)}</b><br>${esc(t.d)}</span>
                </div>`).join('')}
            </div>
          </div>
          <div class="card glass">
            <div class="card__label">新课标带来的变化</div>
            <div class="note-list">
              ${d.map.trends.map(t => `
                <div class="note-item">
                  <span class="chip chip--accent">${esc(t.标)}</span>
                  <span>${esc(t.点)}</span>
                </div>`).join('')}
            </div>
          </div>
        </div>

        <div class="card glass" style="margin-top:16px">
          <div class="card__label">${d.plan.length} 天计划 · 每天 40 分钟（勾选记在本机）</div>
          <div class="rv-plan" data-plan>
            ${d.plan.map((p, i) => `
              <label class="rv-day ${plan[i] ? 'is-done' : ''}">
                <input type="checkbox" data-day="${i}" ${plan[i] ? 'checked' : ''} />
                <span class="rv-day__box" aria-hidden="true">${ic('check')}</span>
                <span class="rv-day__body">
                  <span class="rv-day__t"><b>${esc(p.day)}</b><i>${esc(p.focus)}</i></span>
                  <span class="rv-day__list">${p.tasks.map(t => `<span>· ${esc(t)}</span>`).join('')}</span>
                  <span class="rv-day__check">过关标准：${esc(p.check)}</span>
                </span>
              </label>`).join('')}
          </div>
          <div class="rv-plan__foot" data-plan-foot></div>
        </div>`;
    }

    function knowHTML() {
      return `
        <div class="btn-row" style="justify-content:space-between;margin-bottom:14px">
          <div class="chips">
            ${d.units.map(u => `<span class="chip">${esc(u.名)}</span>`).join('')}
          </div>
          <div class="btn-row">
            <button class="btn btn--sm btn--ghost" data-expand>${ic('down')}全部展开</button>
            <button class="btn btn--sm btn--ghost" data-print>${ic('log')}打印清单</button>
            <button class="btn btn--sm btn--ghost" data-md>${ic('down')}导出 Markdown</button>
          </div>
        </div>

        ${d.units.map(u => `
          <div class="card glass" style="margin-bottom:16px">
            <div class="card__label">${esc(u.名)}</div>
            <p class="quote" style="font-size:13.5px">${esc(u.intro)}</p>
            ${chipRow(u.groups.map(g => '任务群 · ' + g))}
            <div class="rv-dets">
              ${u.lessons.map(k => `
                <details class="rv-det">
                  <summary>
                    <span class="rv-det__t">${esc(k.题)}</span>
                    <span class="rv-det__s">${esc(k.作者)} · ${esc(k.body)}</span>
                    <span class="rv-det__go">${ic('down')}</span>
                  </summary>
                  <div class="rv-det__body">
                    ${listCard('文学常识', k.常识)}
                    ${k.必背 && k.必背.length ? `
                      <div class="card__label">必背</div>
                      <div class="rv-quotes">${k.必背.map(q => `<p class="rv-quote">${esc(q)}</p>`).join('')}</div>` : ''}
                    ${listCard('考点', k.考点)}
                    ${k.易错 && k.易错.length ? `
                      <div class="card__label">易错</div>
                      <div class="chips">${k.易错.map(x => `<span class="chip chip--accent">${esc(x)}</span>`).join('')}</div>` : ''}
                  </div>
                </details>`).join('')}
            </div>
          </div>`).join('')}`;
    }

    function dictHTML() {
      return `
        <div class="card glass" style="margin-bottom:16px">
          <div class="card__label">默写自测 · ${d.dictation.length} 题</div>
          <p class="quote">先自己写，再对答案。判分只看字，不看标点：标点写不写都算对，字写错就算错。</p>
          <p class="rv-tip">只写空缺部分就行。例如「衔远山，吞长江，____，____」，填「浩浩汤汤，横无际涯」。</p>
          <p class="rv-tip">前 28 题是第 1—3 单元（旧版期中范围），后 19 题是第 4—6 单元；只考前三单元的话，后面可以先放着。</p>
        </div>
        <div data-quiz></div>`;
    }

    function wenyanHTML() {
      return `
        <div class="card glass">
          <div class="card__label">高频实词 · ${d.wenyan.实词.length} 个</div>
          <div class="rv-table">
            <table>
              <thead><tr><th>词</th><th>义</th><th>例句</th></tr></thead>
              <tbody>
                ${d.wenyan.实词.map(w => `
                  <tr><td class="rv-word">${esc(w.词)}</td><td>${esc(w.义)}</td><td class="rv-eg">${esc(w.例)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card glass">
          <div class="card__label">虚词 · 只抓这 6 个</div>
          <div class="rv-table">
            <table>
              <thead><tr><th>词</th><th>用法</th><th>例句</th></tr></thead>
              <tbody>
                ${d.wenyan.虚词.map(w => `
                  <tr><td class="rv-word">${esc(w.词)}</td><td>${esc(w.用法)}</td><td class="rv-eg">${esc(w.例)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="grid grid--2" style="margin-top:16px">
          <div class="card glass">
            <div class="card__label">词类活用</div>
            <div class="note-list">
              ${d.wenyan.活用.map(w => `
                <div class="note-item">
                  <b class="rv-word">${esc(w.词)}</b>
                  <span>${esc(w.活用)}，${esc(w.义)}<br><span class="rv-eg">${esc(w.原)}</span></span>
                </div>`).join('')}
            </div>
          </div>
          <div class="card glass">
            <div class="card__label">古今异义</div>
            <div class="note-list">
              ${d.wenyan.古今.map(w => `
                <div class="note-item">
                  <b class="rv-word">${esc(w.词)}</b>
                  <span>古：${esc(w.古)}　今：${esc(w.今)}<br><span class="rv-eg">${esc(w.例)}</span></span>
                </div>`).join('')}
            </div>
          </div>
        </div>

        <div class="card glass" style="margin-top:16px">
          <div class="card__label">句子翻译 · ${d.wenyan.翻译.length} 句</div>
          <p class="quote">先自己译一遍再看答案。翻译的标准是「字字落实」，不是「意思差不多」。</p>
          <div class="rv-dets">
            ${d.wenyan.翻译.map((t, i) => `
              <details class="rv-det">
                <summary>
                  <span class="rv-det__t">${i + 1}. ${esc(t.原)}</span>
                  <span class="rv-det__go">${ic('down')}</span>
                </summary>
                <div class="rv-det__body">
                  <p class="rv-quote">${esc(t.译)}</p>
                  <div class="chips">${t.点.map(x => `<span class="chip chip--accent">${esc(x)}</span>`).join('')}</div>
                </div>
              </details>`).join('')}
          </div>
        </div>`;
    }

    function poemHTML() {
      return `
        <div class="card glass" style="margin-bottom:16px">
          <div class="card__label">诗歌鉴赏 · 六首必考</div>
          <p class="quote">鉴赏题只答三样：写了什么（意象）、怎么写的（手法）、为什么写（情感）。三样少一样就丢分。</p>
        </div>
        ${d.poems.map(p => `
          <div class="card glass" style="margin-bottom:16px">
            <div class="rv-poem__head">
              <div>
                <div class="rv-poem__t">${esc(p.题)}</div>
                <div class="rv-poem__s">${esc(p.作者)}</div>
              </div>
              <div class="chips">${p.意象.slice(0, 4).map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>
            </div>
            ${listCard('手法', p.手法)}
            <div class="card__label">情感</div>
            <p class="rv-emotion">${esc(p.情感)}</p>
            <div class="card__label">名句</div>
            <div class="rv-quotes">
              ${p.名句.map(q => `
                <p class="rv-quote"><b>${esc(q.句)}</b><br><span class="rv-fb__easy">${esc(q.析)}</span></p>`).join('')}
            </div>
            ${listCard('常见问法', p.考法)}
          </div>`).join('')}`;
    }

    function bookHTML() {
      return `
        <div class="card glass" style="margin-bottom:16px">
          <div class="card__label">整本书阅读 · 两本</div>
          <p class="quote">新版教材把「名著导读」改成了「整本书阅读」，每册推荐两本：九上是《简·爱》与《唐诗三百首》。
             旧版九上的《艾青诗选》《水浒传》已经不在这一册里了。</p>
        </div>
        ${d.books.map(b => `
          <div class="card glass" style="margin-bottom:16px">
            <div class="card__label">${esc(b.tag)}</div>
            <div class="rv-poem__head" style="margin-bottom:8px">
              <div>
                <div class="rv-poem__t">${esc(b.书)}</div>
                <div class="rv-poem__s">${esc(b.作者)}</div>
              </div>
            </div>
            <p class="rv-emotion" style="font-size:13.5px;font-weight:400">${esc(b.point)}</p>
            ${listCard('要记住的', b.keys)}
            ${listCard('考点', b.kao)}
            <div class="card__label" style="margin-top:14px">自测 · 先自己说一遍，再展开</div>
            <div class="rv-dets">
              ${b.quiz.map((q, i) => `
                <details class="rv-det">
                  <summary>
                    <span class="rv-det__t">${i + 1}. ${esc(q.q)}</span>
                    <span class="rv-det__go">${ic('down')}</span>
                  </summary>
                  <div class="rv-det__body"><p class="rv-quote">${esc(q.a)}</p></div>
                </details>`).join('')}
            </div>
          </div>`).join('')}`;
    }

    function readHTML() {
      return d.reading.map(r => `
        <div class="card glass" style="margin-bottom:16px">
          <div class="card__label">${esc(r.文体)} · 答题路径</div>
          <div class="rv-steps">
            ${r.path.map((s, i) => `
              <div class="rv-step">
                <span class="rv-step__n">${i + 1}</span>
                <div>
                  <div class="rv-step__t">${esc(s.step)}</div>
                  <div class="rv-step__d">${esc(s.do)}</div>
                  <div class="rv-step__tip">${esc(s.tip)}</div>
                </div>
              </div>`).join('')}
          </div>
          <details class="rv-det" style="margin-top:14px">
            <summary>
              <span class="rv-det__t">看一道例题</span>
              <span class="rv-det__go">${ic('down')}</span>
            </summary>
            <div class="rv-det__body">
              <p class="rv-quote"><b>问：</b>${esc(r.example.题)}</p>
              <p class="rv-quote"><b>答：</b>${esc(r.example.答)}</p>
              <div class="chips"><span class="chip chip--accent">${esc(r.example.point)}</span></div>
            </div>
          </details>
        </div>`).join('');
    }

    function writeHTML() {
      return d.writing.map((w, i) => `
        <div class="card glass" style="margin-bottom:16px">
          <div class="card__label">${esc(w.type)}</div>
          <div class="rv-poem__t" style="margin-bottom:6px">${esc(w.题)}</div>
          <div class="chips">${w.req.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>

          <div class="card__label" style="margin-top:16px">审题</div>
          <p class="rv-emotion" style="font-size:13.5px;font-weight:400">${esc(w.审题)}</p>

          ${listCard('提纲', w.outline)}
          <div class="card__label" style="margin-top:14px">素材</div>
          <div class="note-list">
            ${w.materials.map(m => `
              <div class="note-item"><b>·</b><span>${esc(m.料)}<br><span class="rv-fb__easy">${esc(m.用)}</span></span></div>`).join('')}
          </div>
          <div class="card__label" style="margin-top:14px">开头示范</div>
          <p class="rv-quote">${esc(w.opening)}</p>

          <div class="btn-row" style="margin-top:14px">
            <button class="btn btn--sm btn--ghost" data-copy="${i}">${ic('edit')}复制提纲</button>
          </div>
        </div>`).join('');
    }

    /* ---------------- 事件绑定 ---------------- */
    function bind(id) {
      if (id === 'map') bindPlan();
      if (id === 'know') bindKnow();
      if (id === 'dict') {
        fillQuiz($('[data-quiz]', pane), { items: d.dictation, key: 'final9.dict', ctx, label: '期末默写' });
      }
      if (id === 'write') bindWrite();
    }

    function bindPlan() {
      const plan = store.get(PLAN_KEY, {}) || {};
      const foot = $('[data-plan-foot]', pane);
      const paintFoot = () => {
        const done = d.plan.filter((_, i) => plan[i]).length;
        foot.innerHTML = `<div class="rv-bar"><i style="width:${Math.round(done / d.plan.length * 100)}%"></i></div>
          <span>已完成 <b>${done}</b> / ${d.plan.length} 天${done === d.plan.length ? ' · 可以上考场了' : ''}</span>`;
      };
      $$('[data-day]', pane).forEach(box => box.addEventListener('change', () => {
        const i = Number(box.dataset.day);
        if (box.checked) plan[i] = true; else delete plan[i];
        store.set(PLAN_KEY, plan);
        box.closest('.rv-day').classList.toggle('is-done', box.checked);
        paintFoot();
        ctx.track?.('review', `期末计划：${box.checked ? '完成' : '取消'} ${d.plan[i].day}`);
      }));
      paintFoot();
    }

    function bindKnow() {
      let open = false;
      const btn = $('[data-expand]', pane);
      btn.addEventListener('click', () => {
        open = !open;
        $$('.rv-det', pane).forEach(el => { el.open = open; });
        btn.innerHTML = open ? `${ic('up')}全部收起` : `${ic('down')}全部展开`;
      });
      $('[data-print]', pane).addEventListener('click', () => {
        /* 打印前把折叠全部打开，否则打出来只有标题 */
        $$('.rv-det', pane).forEach(el => { el.open = true; });
        toast('正在准备打印，在打印对话框里选「另存为 PDF」也行');
        setTimeout(() => window.print(), 120);
      });
      $('[data-md]', pane).addEventListener('click', () => {
        const lines = ['# 九年级期末复习 · 知识清单', '', `范围：${d.meta.range}`, ''];
        d.units.forEach(u => {
          lines.push(`## ${u.名}`, '', u.intro, '');
          u.lessons.forEach(k => {
            lines.push(`### ${k.题}（${k.作者} · ${k.body}）`, '');
            lines.push('常识：' + k.常识.join('；'), '');
            if (k.必背 && k.必背.length) lines.push('必背：' + k.必背.join(' / '), '');
            lines.push('考点：');
            k.考点.forEach(t => lines.push('- ' + t));
            if (k.易错 && k.易错.length) lines.push('', '易错：' + k.易错.join('；'));
            lines.push('');
          });
        });
        download('九年级期末复习-知识清单.md', lines.join('\n'), 'text/markdown');
        toast('已导出 Markdown');
        ctx.track?.('review', '期末：导出知识清单');
      });
    }

    function bindWrite() {
      $$('[data-copy]', pane).forEach(btn => btn.addEventListener('click', () => {
        const w = d.writing[Number(btn.dataset.copy)];
        const text = [`${w.题}（${w.type}）`, '', '审题：' + w.审题, '', '提纲：', ...w.outline.map((x, i) => `${i + 1}. ${x}`)].join('\n');
        copyText(text, '提纲已复制，可以粘到写作里');
      }));
    }

    paint();
  },
};
