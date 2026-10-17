/* 今日 —— 一天只给一个字、一首诗、一道题 */
import { $, esc, ic, toast, store, dayKey } from '../core.js';
import { load, pick, greeting, weekday } from '../data.js';
import { addNote, listNotes } from '../notes-store.js';
import wordsView from './words.js';
import poemsView from './poems.js';
import writeView from './write.js';

export default {
  id: 'today', name: '今日', icon: 'today', nav: true,

  async mount(root, ctx) {
    const [words, poems, prompts] = await Promise.all([load('words'), load('poems'), load('prompts')]);
    const key = dayKey();
    const w = pick(words, 'word', key);
    const p = pick(poems, 'poem', key);
    const pr = pick(prompts, 'prompt', key);

    const wDone = new Set(store.get('words.done', []));
    const pDone = new Set(store.get('poems.done', []));
    const noteCount = listNotes().length;
    const todayNote = store.get('today.note', { key: '', text: '' });
    const kept = todayNote.key === key ? todayNote.text : '';

    const pct = (a, b) => Math.round((a / Math.max(1, b)) * 100);

    /* 读音/部首/笔画：课本词表里的词条没有部首笔画（143 条里 119 条没有），
       以前无条件拼 String(w.笔画) 会直接显示「undefined 画」——按存在与否拼。 */
    const wMeta = [esc(w.音),
      w.部首 ? `部首 ${esc(w.部首)}` : '',
      Number.isFinite(w.笔画) ? `${w.笔画} 画` : '',
      (!w.部首 && !Number.isFinite(w.笔画) && w.课) ? esc(w.课) : ''
    ].filter(Boolean).join('　·　');

    root.innerHTML = `
      <section class="view-head">
        <div class="kicker">${esc(key)} · 星期${weekday()}</div>
        <h2>${esc(greeting())}</h2>
        <p>这里不给排名、不给积分，一天只放三样东西：一个字，一首诗，一道题。</p>
      </section>

      <div class="hero">
        <article class="card glass spec">
          <div class="card__label">一日一字</div>
          <div class="zi-big" style="font-size:${w.字.length > 1 ? 'clamp(38px,7vw,56px)' : 'clamp(58px,11vw,86px)'}">${esc(w.字)}</div>
          <div class="word-card__p" style="margin-top:10px">${wMeta}</div>
          <p class="quote" style="margin-top:14px">${esc(w.义)}</p>
          ${w.例 ? `<p class="quote" style="margin-top:10px;color:var(--ink-3)">例　${esc(w.例)}</p>` : ''}
          <div class="btn-row" style="margin-top:auto;padding-top:22px">
            <button class="btn btn--primary" data-open-word>细看这个字</button>
            <button class="btn ${wDone.has(w.id) ? '' : 'btn--ghost'}" data-toggle-word>${ic('check')}${wDone.has(w.id) ? '已掌握' : '标为已掌握'}</button>
          </div>
        </article>

        <article class="card glass spec">
          <div class="card__label">进度</div>
          <div class="grid grid--3" style="gap:12px">
            <div class="metric"><div class="n">${wDone.size}<span style="font-size:13px;color:var(--ink-3)">/${words.length}</span></div><div class="k">字词</div>
              <div class="progress" style="margin-top:8px"><i style="width:${pct(wDone.size, words.length)}%"></i></div></div>
            <div class="metric"><div class="n">${pDone.size}<span style="font-size:13px;color:var(--ink-3)">/${poems.length}</span></div><div class="k">诗文</div>
              <div class="progress" style="margin-top:8px"><i style="width:${pct(pDone.size, poems.length)}%"></i></div></div>
            <div class="metric"><div class="n">${noteCount}</div><div class="k">札记</div>
              <div class="progress" style="margin-top:8px"><i style="width:${Math.min(100, noteCount * 4)}%"></i></div></div>
          </div>
        </article>
      </div>

      <div class="grid grid--2" style="margin-top:16px">
        <article class="card glass spec">
          <div class="card__label">一日一诗</div>
          <div style="font-family:var(--font-serif);font-size:19px">《${esc(p.题)}》</div>
          <div class="poem__meta" style="text-align:left;letter-spacing:.1em">${esc(p.朝代)} · ${esc(p.作者)}</div>
          <div class="poem__lines" style="text-align:left;font-size:16px;line-height:2.3;margin-top:14px">
            ${p.原文.slice(0, 2).map(l => `<span>${esc(l)}</span>`).join('')}
          </div>
          <div class="btn-row" style="margin-top:18px">
            <button class="btn" data-open-poem>读全篇</button>
          </div>
        </article>

        <article class="card glass spec">
          <div class="card__label">今天可以写什么</div>
          <div style="font-family:var(--font-serif);font-size:19px">${esc(pr.题)}</div>
          <p class="quote" style="margin-top:12px;font-size:14px">${esc(pr.材料)}</p>
          <div class="chips" style="margin-top:14px">
            <span class="chip">${esc(pr.体裁)}</span>
            ${(pr.标签 || []).map(t => `<span class="chip">${esc(t)}</span>`).join('')}
          </div>
          <div class="btn-row" style="margin-top:18px">
            <button class="btn btn--primary" data-goto-write>去写这一篇</button>
          </div>
        </article>
      </div>

      <article class="card glass spec" style="margin-top:16px">
        <div class="card__label">今日小记</div>
        <textarea class="editor" data-note placeholder="此刻想到的一句话、一个句子、一个疑问……">${esc(kept)}</textarea>
        <div class="btn-row" style="margin-top:14px">
          <button class="btn btn--primary" data-save-note>${ic('check')}存进札记</button>
          <button class="btn btn--ghost" data-clear-note>清空</button>
          <span style="font-size:12.5px;color:var(--ink-3)" data-count>${kept.length ? ctx.countHan(kept) + ' 字' : ''}</span>
        </div>
      </article>
    `;

    /* ---- 交互 ---- */
    const ta = $('[data-note]', root);
    const countEl = $('[data-count]', root);
    let saveTimer;
    ta.addEventListener('input', () => {
      countEl.textContent = ctx.countHan(ta.value) ? ctx.countHan(ta.value) + ' 字' : '';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => store.set('today.note', { key, text: ta.value }), 400);
    });

    $('[data-save-note]', root).addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) return toast('先写点什么吧');
      addNote({ kind: 'free', title: `${key} 小记`, body: text, from: '今日小记' });
      store.set('today.note', { key, text: '' });
      ta.value = ''; countEl.textContent = '';
      toast('已经存进札记了');
    });

    $('[data-clear-note]', root).addEventListener('click', () => {
      ta.value = ''; countEl.textContent = '';
      store.set('today.note', { key, text: '' });
      toast('已清空');
    });

    $('[data-toggle-word]', root).addEventListener('click', e => {
      const set = new Set(store.get('words.done', []));
      set.has(w.id) ? set.delete(w.id) : set.add(w.id);
      store.set('words.done', [...set]);
      ctx.render();
    });

    $('[data-open-word]', root).addEventListener('click', () => { wordsView.openById(w.id); ctx.go('words'); });
    $('[data-open-poem]', root).addEventListener('click', () => { poemsView.openById(p.id); ctx.go('poems'); });
    $('[data-goto-write]', root).addEventListener('click', () => { writeView.openById(pr.id); ctx.go('write'); });
  },
};
