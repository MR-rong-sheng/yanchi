/* ==========================================================================
   中考复习 —— 课标 → 卷面 → 专题 → 自测 → 作文 → 易错
   目标不是多刷题，是知道每道题在考什么、按什么步骤答。
   ========================================================================== */
import { $, $$, esc, ic, toast, store } from '../core.js';
import { load } from '../data.js';
import { tabBar, bindTabs, fillQuiz, choiceQuiz, listCard, chipRow } from '../review-kit.js?v=20261025g';

const TABS = [
  { id: 'std',   label: '课标对标', icon: 'shield' },
  { id: 'map',   label: '卷面地图', icon: 'today' },
  { id: 'topic', label: '专题方法', icon: 'book' },
  { id: 'drill', label: '分项自测', icon: 'write' },
  { id: 'write', label: '作文',     icon: 'edit' },
  { id: 'trap',  label: '易错清单', icon: 'ban' },
];

const GROUPS = ['全部', '积累与运用', '古诗文', '现代文', '写作'];

let mountSeq = 0;      /* 防止并发挂载：后一次挂载顶掉前一次时，前一次不许再写 DOM */

export default {
  id: 'zhongkao', name: '中考', icon: 'flag', nav: true,

  async mount(root, ctx) {
    const seq = ++mountSeq;
    const d = await load('zhongkao');
    if (seq !== mountSeq || !root.isConnected) return;

    root.innerHTML = `
      <section class="view-head">
        <div class="kicker">复习专区 · ${esc(d.meta.basis)}</div>
        <h2>中考语文复习</h2>
        <p>按新课标的四个核心素养、六个学习任务群排的复习框架：先看清考什么，再练怎么答，最后记易错。</p>
        <div class="chips">
          <span class="chip chip--accent">${esc(d.topics.length)} 个专题</span>
          <span class="chip">${d.drill.choice.length} 道选择自测</span>
          <span class="chip">${d.drill.blank.length} 句情境默写</span>
          <span class="chip">${d.traps.音.length + d.traps.形.length} 条易错字</span>
        </div>
      </section>

      ${tabBar(TABS)}

      <div class="rv-pane" data-pane></div>

      <p class="rv-note">${esc(d.meta.note)}</p>
    `;

    const pane = $('[data-pane]', root);
    const tabsEl = $('.rv-tabs', root);
    let active = 'std';

    function paint() {
      pane.innerHTML = draw(active);
      bind(active);
    }

    bindTabs(root, id => {
      active = id;
      paint();
      if (pane.getBoundingClientRect().top < 60) tabsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    function draw(id) {
      if (id === 'std') return stdHTML();
      if (id === 'map') return mapHTML();
      if (id === 'topic') return topicHTML('全部');
      if (id === 'drill') return drillHTML();
      if (id === 'write') return writeHTML();
      return trapHTML();
    }

    function stdHTML() {
      return `
        <div class="card glass">
          <div class="card__label">四个核心素养 · 中考怎么落</div>
          <div class="rv-2col" style="margin-top:4px">
            ${d.std.core.map(c => `
              <div class="rv-core">
                <div class="rv-core__n">${esc(c.名)}</div>
                <p class="rv-core__d">${esc(c.n)}</p>
                <div class="chips">${c.考.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>
              </div>`).join('')}
          </div>
        </div>

        <div class="card glass">
          <div class="card__label">六个学习任务群 · 对应题型</div>
          <div class="rv-table">
            <table>
              <thead><tr><th>任务群</th><th>要义</th><th>怎么考</th><th>在本区怎么练</th></tr></thead>
              <tbody>
                ${d.std.groups.map(g => `
                  <tr>
                    <td><b>${esc(g.名)}</b><br><span class="chip">${esc(g.层)}</span></td>
                    <td>${esc(g.要)}</td>
                    <td>${g.题.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</td>
                    <td class="rv-eg">${esc(g.练)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card glass">
          <div class="card__label">一句话记住命题方向</div>
          <p class="rv-emotion" style="font-size:15px">题不考「你背了多少」，考「你能不能用」。所以每道题都问自己：它在什么情境里，要我做什么事。</p>
        </div>`;
    }

    function mapHTML() {
      return `
        <div class="card glass">
          <div class="card__label">卷面地图（各地不同，这是通行框架）</div>
          <div class="rv-table">
            <table>
              <thead><tr><th>板块</th><th>分值</th><th>用时</th><th>考什么</th><th>拿分要点</th></tr></thead>
              <tbody>
                ${d.map.papers.map(p => `
                  <tr>
                    <td><b>${esc(p.板块)}</b></td>
                    <td class="rv-num">${esc(p.分)}</td>
                    <td class="rv-num">${esc(p.分钟)} 分</td>
                    <td>${esc(p.考什么)}</td>
                    <td class="rv-goal">${esc(p.拿分要点)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card glass">
          <div class="card__label">三轮复习 · 什么时候做什么</div>
          <div class="rv-rounds">
            ${d.map.rounds.map((r, i) => `
              <div class="rv-round">
                <div class="rv-round__head">
                  <span class="rv-round__n">${i + 1}</span>
                  <div>
                    <div class="rv-round__t">${esc(r.轮)}</div>
                    <div class="rv-round__s">${esc(r.时间)} · ${esc(r.目标)}</div>
                  </div>
                </div>
                <div class="note-list">${r.做.map(x => `<div class="note-item"><span>${esc(x)}</span></div>`).join('')}</div>
              </div>`).join('')}
          </div>
        </div>`;
    }

    function topicHTML(group) {
      return `
        <div class="seg rv-seg" data-group>
          ${GROUPS.map(g => `<button data-v="${esc(g)}" aria-pressed="${g === group}">${esc(g)}</button>`).join('')}
        </div>
        <div data-topic-list style="margin-top:14px">${topicListHTML(group)}</div>`;
    }

    function topicListHTML(group) {
      const list = d.topics.filter(t => group === '全部' || t.组 === group);
      return list.map(t => `
        <details class="rv-det rv-det--topic glass">
          <summary>
            <span class="rv-det__t">${esc(t.名)}</span>
            <span class="rv-det__s">${esc(t.组)} · ${t.考.length} 个考查点</span>
            <span class="rv-det__go">${ic('down')}</span>
          </summary>
          <div class="rv-det__body">
            ${listCard('考查什么', t.考)}
            ${listCard('按什么步骤', t.步)}
            ${listCard('答题模板', t.模)}
            <div class="card__label">最容易丢分的地方</div>
            <div class="note-list">
              ${t.失.map(x => `<div class="note-item"><b>✕</b><span>${esc(x)}</span></div>`).join('')}
            </div>
          </div>
        </details>`).join('');
    }

    function drillHTML() {
      return `
        <div class="card glass" style="margin-bottom:16px">
          <div class="card__label">选择题 · ${d.drill.choice.length} 道</div>
          <p class="quote">点选项立刻判对错，并给解析。做错的题，先看解析再往下走，别连着刷。</p>
        </div>
        <div data-choice></div>

        <div class="card glass" style="margin:22px 0 16px">
          <div class="card__label">情境默写 · ${d.drill.blank.length} 句</div>
          <p class="quote">判分只看字，不看标点。只写空缺部分即可。</p>
        </div>
        <div data-blank></div>`;
    }

    function writeHTML() {
      return `
        <div class="card glass">
          <div class="card__label">命题趋势</div>
          <div class="note-list">
            ${d.write.trends.map(t => `
              <div class="note-item"><span class="chip chip--accent">${esc(t.标)}</span><span>${esc(t.点)}</span></div>`).join('')}
          </div>
        </div>

        <div class="card glass">
          <div class="card__label">五种题型怎么下手</div>
          <div class="rv-table">
            <table>
              <thead><tr><th>题型</th><th>下手处</th></tr></thead>
              <tbody>${d.write.types.map(t => `<tr><td class="rv-word">${esc(t.类)}</td><td>${esc(t.法)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>

        <div class="grid grid--3" style="margin-top:16px">
          ${d.write.structure.map(s => `
            <div class="card glass">
              <div class="card__label">${esc(s.式)}</div>
              <div class="note-list">${s.列.map(x => `<div class="note-item"><span>${esc(x)}</span></div>`).join('')}</div>
            </div>`).join('')}
        </div>

        <div class="card glass" style="margin-top:16px">
          <div class="card__label">素材库 · ${d.write.materials.length} 条（别背，改成你自己的）</div>
          <div class="rv-table">
            <table>
              <thead><tr><th>类</th><th>素材</th><th>可以写什么</th></tr></thead>
              <tbody>
                ${d.write.materials.map(m => `<tr><td><span class="chip">${esc(m.类)}</span></td><td>${esc(m.料)}</td><td class="rv-eg">${esc(m.用)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card glass" style="margin-top:16px">
          <div class="card__label">四种开头</div>
          <div class="note-list">
            ${d.write.openers.map(o => `
              <div class="note-item"><b>${esc(o.法)}</b><span>「${esc(o.例)}」<br><span class="rv-fb__easy">${esc(o.注)}</span></span></div>`).join('')}
          </div>
        </div>`;
    }

    function trapHTML() {
      return `
        <div class="card glass" style="margin-bottom:16px">
          <div class="card__label">易错清单 · 可以直接搜</div>
          <label class="field">
            ${ic('search')}
            <input type="search" data-trap-q placeholder="搜字、词、释义，例如「恪」「迫」" autocomplete="off" />
          </label>
          <p class="rv-tip">共 ${d.traps.音.length + d.traps.形.length} 条字音字形、${d.traps.病句.length} 类病句、${d.traps.文言.length} 个文言词。</p>
        </div>

        <div class="card glass">
          <div class="card__label">易读错的字</div>
          <div class="rv-table">
            <table><thead><tr><th>词</th><th>正确</th><th>常错</th></tr></thead>
              <tbody>${d.traps.音.map(x => `<tr data-row><td class="rv-word">${esc(x.词)}</td><td class="rv-ok">${esc(x.音)}</td><td class="rv-bad">${esc(x.错)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>

        <div class="card glass">
          <div class="card__label">易写错的字</div>
          <div class="rv-table">
            <table><thead><tr><th>正确写法</th><th>常见错写</th><th>怎么记</th></tr></thead>
              <tbody>${d.traps.形.map(x => `<tr data-row><td class="rv-ok">${esc(x.词)}</td><td class="rv-bad">${esc(x.错)}</td><td class="rv-eg">${esc(x.记)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>

        <div class="card glass">
          <div class="card__label">六类病句</div>
          <div class="rv-table">
            <table><thead><tr><th>类型</th><th>例句</th><th>怎么改</th><th>记一句</th></tr></thead>
              <tbody>${d.traps.病句.map(x => `<tr data-row><td class="rv-word">${esc(x.类)}</td><td>${esc(x.例)}</td><td>${esc(x.改)}</td><td class="rv-eg">${esc(x.记)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>

        <div class="card glass">
          <div class="card__label">文言高频词</div>
          <div class="rv-table">
            <table><thead><tr><th>词</th><th>义</th><th>例</th></tr></thead>
              <tbody>${d.traps.文言.map(x => `<tr data-row><td class="rv-word">${esc(x.词)}</td><td>${esc(x.义)}</td><td class="rv-eg">${esc(x.例)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>`;
    }

    /* ---------------- 事件 ---------------- */
    function bind(id) {
      if (id === 'topic') bindTopicSeg();
      if (id === 'drill') {
        choiceQuiz($('[data-choice]', pane), { items: d.drill.choice, key: 'zk.choice', ctx, label: '中考选择自测' });
        fillQuiz($('[data-blank]', pane), { items: d.drill.blank, key: 'zk.blank', ctx, label: '中考默写' });
      }
      if (id === 'trap') bindTrapSearch();
    }

    function bindTopicSeg() {
      const seg = $('[data-group]', pane);
      if (!seg) return;
      $$('button', seg).forEach(btn => btn.addEventListener('click', () => {
        $$('button', seg).forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        const holder = $('[data-topic-list]', pane);
        if (holder) holder.innerHTML = topicListHTML(btn.dataset.v);
        ctx.track?.('review', `中考专题：${btn.dataset.v}`);
      }));
    }

    function bindTrapSearch() {
      const q = $('[data-trap-q]', pane);
      const rows = $$('[data-row]', pane);
      q.addEventListener('input', () => {
        const kw = q.value.trim().toLowerCase();
        rows.forEach(r => {
          r.hidden = !!kw && !r.textContent.toLowerCase().includes(kw);
        });
      });
    }

    paint();
  },
};
