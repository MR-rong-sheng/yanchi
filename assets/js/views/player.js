/* 播放器 —— 站内曲库（站点自带的音乐文件夹）+ 你自己导入的本地音频 */
import { $, $$, esc, ic, toast, go } from '../core.js';
import {
  P, audio, tracks, current, isPlaying, setList, toggle, next, prev, seek,
  setVolume, cycleMode, MODE_LABEL, on, addFiles, fmtTime, fmtSize, playIndex,
  buffer,
} from '../player.js';

/* ---------- 站内曲库清单 ---------- */
let LIB_CACHE = null;
async function loadLibrary() {
  if (LIB_CACHE) return LIB_CACHE;
  try {
    const r = await fetch('content/music.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    LIB_CACHE = { count: d.count || 0, total: d.total || 0, tracks: d.tracks || [], error: '' };
  } catch (e) {
    LIB_CACHE = { count: 0, total: 0, tracks: [], error: String(e.message || e) };
  }
  return LIB_CACHE;
}

/** 把曲库清单变成播放器认的曲目（src 指向 /music/ 下的文件） */
function libTracks(LIB) {
  return LIB.tracks.map(t => ({
    id: 'lib:' + t.file,
    name: t.artist ? t.artist + ' — ' + t.title : t.title,
    size: t.size,
    dur: 0,
    ext: (t.ext || '').toUpperCase(),
    src: 'music/' + encodeURIComponent(t.file),
  }));
}

/* ---------- 小胶囊（常驻，切到别的页面也能接着放） ---------- */
function paintMini() {
  const mini = document.getElementById('mini');
  if (!mini) return;
  const t = current();
  mini.hidden = !t;
  document.body.classList.toggle('has-mini', !!t);
  if (!t) return;
  document.getElementById('mini-title').textContent = t.name;
  const ratio = isFinite(audio.duration) && audio.duration ? audio.currentTime / audio.duration : 0;
  document.getElementById('mini-fill').style.width = (ratio * 100).toFixed(2) + '%';
  paintBuffer(document.querySelector('[data-mini-buf]'), buffer());
  document.getElementById('mini-toggle').innerHTML = `<svg class="ic"><use href="#i-${isPlaying() ? 'pause' : 'play'}"/></svg>`;
  mini.dataset.playing = isPlaying() ? '1' : '0';
}

export function initMini() {
  if (initMini.done) return;
  initMini.done = true;
  const mini = document.getElementById('mini');
  $('#mini-toggle').addEventListener('click', e => { e.stopPropagation(); toggle(); paintMini(); });
  const open = () => go('player');
  $('#mini-body').addEventListener('click', open);
  $('#mini-body').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });

  /* 订阅一次即可：回调只在对应元素存在时生效 */
  on(() => { paintMini(); paintView(); });
  paintMini();
}

/* 画缓冲条：
   - 拿到元数据前 / 还没开始播 → 滚动条（明确「在动」，不是死了）
   - 播放中 → 真实「已缓存 x%」，整首缓存完就隐藏
   状态标在进度条元素自己身上，卡片与小胶囊共用同一套逻辑。 */
function paintBuffer(el, s) {
  if (!el) return;
  const show = !!s && !!s.hasSrc && (s.loading || s.caching);
  el.hidden = !show;
  if (!show) return;
  const spin = !!s.loading || !s.playing;      // 没数据或没在播：走不确定动画
  const fill = el.querySelector('i');
  if (fill) {
    fill.classList.toggle('is-spin', spin);
    fill.style.width = (spin ? 38 : s.pct).toFixed(1) + '%';
  }
  const txt = el.querySelector('[data-buffer-txt]');
  if (txt) txt.textContent = s.loading ? '正在缓冲…'
    : (spin ? '缓冲中 ' + s.pct.toFixed(0) + '%' : '已缓存 ' + s.pct.toFixed(0) + '%');
}

/* ---------- 视图 ---------- */
let wired = false;

function paintView() {
  const box = document.querySelector('[data-player]');
  if (!box) return;
  const t = current();
  const playing = isPlaying();

  box.dataset.playing = playing ? '1' : '0';
  $('[data-disc]', box).classList.toggle('is-spin', playing);
  $('[data-title]', box).textContent = t ? t.name : '还没有选曲';
  $('[data-sub]', box).textContent = t
    ? `${P.index + 1} / ${P.list.length}　·　${t.dur ? fmtTime(t.dur) : '时长未知'}　·　${fmtSize(t.size)}`
    : '把音频拖进下面的框，或点「选择音频」——文件只存在这台电脑上';

  const dur = isFinite(audio.duration) ? audio.duration : (t && t.dur ? t.dur : 0);
  const cur = t ? audio.currentTime : 0;
  $('[data-fill]', box).style.width = (dur ? (cur / dur) * 100 : 0).toFixed(2) + '%';
  $('[data-cur]', box).textContent = fmtTime(cur);
  $('[data-dur]', box).textContent = fmtTime(dur);
  $('[data-toggle]', box).innerHTML = `<svg class="ic"><use href="#i-${playing ? 'pause' : 'play'}"/></svg>`;
  paintBuffer($('[data-buffer]', box), buffer());

  const mb = $('[data-mode]', box);
  mb.innerHTML = `${ic(P.mode === 'shuffle' ? 'shuffle' : P.mode === 'one' ? 'repeat' : 'repeat')}
    <span>${MODE_LABEL[P.mode]}</span>`;
  mb.dataset.mode = P.mode;
  $('[data-vol]', box).value = P.volume;

  $$('[data-i]', box).forEach(row => {
    const on2 = Number(row.dataset.i) === P.index;
    row.classList.toggle('is-current', on2);
    row.setAttribute('aria-current', on2 ? 'true' : 'false');
  });

  /* 曲库行的当前曲高亮（曲库与导入列表共用一个播放内核） */
  $$('[data-libid]', box).forEach(row => {
    const on3 = !!t && row.dataset.libid === t.id;
    row.classList.toggle('is-current', on3);
    row.setAttribute('aria-current', on3 ? 'true' : 'false');
  });
}

function buildRows() {
  const box = document.querySelector('[data-player]');
  if (!box) return;
  const list = $('[data-list]', box);
  const t = current();
  $('[data-count]', box).textContent = P.list.length
    ? `${P.list.length} 首　·　共 ${fmtSize(P.list.reduce((n, x) => n + (x.size || 0), 0))}`
    : '空';

  list.innerHTML = P.list.length ? P.list.map((x, i) => `
    <div class="prow ${t && i === P.index ? 'is-current' : ''}" data-i="${i}" role="button" tabindex="0">
      <span class="prow__no">${i + 1}</span>
      <span class="prow__main">
        <span class="prow__t">${esc(x.name)}</span>
        <span class="prow__s">${x.dur ? fmtTime(x.dur) : '时长未知'}　·　${fmtSize(x.size)}</span>
      </span>
      <button class="mini" data-del title="从列表移除">${ic('trash')}</button>
    </div>`).join('')
    : `<div class="empty" style="padding:26px 10px"><b>播放列表是空的</b>导入的音频只保存在这台电脑的浏览器里，不会上传。</div>`;
}

async function refresh() {
  const list = await tracks.all().catch(e => { toast('读取本地音频失败：' + (e.message || e)); return []; });
  list.sort((a, b) => a.addedAt - b.addedAt);
  setList(list);
  buildRows();
}

function wireSeek(box) {
  const bar = $('[data-seek]', box);
  let dragging = false;
  const at = e => {
    const r = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const dur = isFinite(audio.duration) ? audio.duration : 0;
    if (dur) seek(ratio * dur);
  };
  bar.addEventListener('pointerdown', e => {
    if (!current()) return;
    dragging = true;
    bar.setPointerCapture(e.pointerId);
    at(e);
  });
  bar.addEventListener('pointermove', e => { if (dragging) at(e); });
  const stop = () => { dragging = false; };
  bar.addEventListener('pointerup', stop);
  bar.addEventListener('pointercancel', stop);
}

export default {
  id: 'player', name: '播放', icon: 'music', nav: true,

  async mount(root, ctx) {
    root.innerHTML = `
      <section class="view-head">
        <div class="kicker">本地音乐 · 不联网</div>
        <h2>播放</h2>
        <p>站内曲库里是已经收好的整张歌单，点一首就能听；也可以把你自己的音频拖进来——
           导入的文件只存在这台电脑的浏览器里，不上传、不缓存到别处；切到诗文页也会继续放。</p>
      </section>

      <div data-player class="player">
        <article class="card glass spec player__now">
          <div class="disc" data-disc><span>砚</span></div>

          <div class="player__meta">
            <div class="player__title" data-title>还没有选曲</div>
            <div class="player__sub" data-sub></div>
          </div>

          <div class="player__bar" data-seek title="点击或拖动跳转">
            <i data-fill></i>
          </div>
          <div class="player__times"><span data-cur>0:00</span><span data-dur>0:00</span></div>

          <div class="buffer" data-buffer hidden>
            <div class="buffer__bar"><i data-buffer-fill></i></div>
            <div class="buffer__txt" data-buffer-txt>正在缓冲…</div>
          </div>

          <div class="player__ctrl">
            <button class="btn btn--sm" data-mode title="切换播放模式"></button>
            <button class="btn btn--icon" data-prev title="上一首">${ic('prev')}</button>
            <button class="btn btn--primary player__play" data-toggle title="播放 / 暂停（空格）"></button>
            <button class="btn btn--icon" data-next title="下一首">${ic('next')}</button>
            <label class="player__vol" title="音量">
              ${ic('volume')}
              <input type="range" data-vol min="0" max="1" step="0.01" />
            </label>
          </div>
          <div class="player__hint">空格播放 / 暂停　·　← → 快退快进 5 秒</div>
        </article>

        <article class="card glass spec" style="margin-top:16px">
          <div class="card__label">站内曲库 · <span data-libcount>读取中…</span></div>
          <div class="btn-row" style="justify-content:space-between;margin-bottom:10px">
            <label class="field" style="flex:1;min-width:200px">
              ${ic('search')}
              <input type="search" data-libq placeholder="搜歌手或曲名…" autocomplete="off" />
            </label>
            <button class="btn btn--sm btn--primary" data-liball>全部播放</button>
            <button class="btn btn--sm" data-libshuffle>随机播放</button>
          </div>
          <div class="list" data-lib></div>
          <div class="player__hint">曲库来自站点的 music 文件夹，点任意一首即从那里开始按顺序播放。</div>
        </article>

        <article class="card glass spec" style="margin-top:16px">
          <div class="card__label">播放列表 · <span data-count>空</span></div>
          <div class="list" data-list></div>

          <div class="drop" data-drop>
            ${ic('up')}
            <span>把音频文件拖到这里，或</span>
            <button class="btn btn--sm" data-pick>选择音频</button>
            <button class="btn btn--sm" data-demo title="播放器会用这首合成的五声音阶试一下">试听示例</button>
            <button class="btn btn--sm btn--ghost" data-clear>清空列表</button>
            <input type="file" accept="audio/*" multiple hidden data-file />
          </div>
        </article>
      </div>
    `;

    /* ---- 接线 ---- */
    $('[data-toggle]', root).addEventListener('click', () => toggle());
    $('[data-prev]', root).addEventListener('click', () => prev());
    $('[data-next]', root).addEventListener('click', () => next());
    $('[data-mode]', root).addEventListener('click', () => { cycleMode(); toast(MODE_LABEL[P.mode]); });
    $('[data-vol]', root).addEventListener('input', e => setVolume(Number(e.target.value)));
    wireSeek(root);

    /* 列表：点击播放，垃圾桶移除 */
    $('[data-list]', root).addEventListener('click', async e => {
      const del = e.target.closest('[data-del]');
      const row = e.target.closest('[data-i]');
      if (!row) return;
      const i = Number(row.dataset.i);
      if (del) {
        e.stopPropagation();
        const t = P.list[i];
        if (!t) return;
        if (!confirm(`从列表移除「${t.name}」？文件也会从本机存储里删掉。`)) return;
        await tracks.del(t.id);
        if (P.index === i) { P.index = -1; audio.pause(); audio.removeAttribute('src'); audio.load(); }
        await refresh();
        toast('已移除');
        return;
      }
      playIndex(i);
      paintView();
    });

    /* 键盘：列表行回车播放 */
    $('[data-list]', root).addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('[data-i]');
      if (!row) return;
      e.preventDefault();
      row.click();
    });

    /* 导入 */
    const file = $('[data-file]', root);
    const drop = $('[data-drop]', root);
    const ingest = async files => {
      const n = await addFiles(files);
      if (n) { await refresh(); toast(`已导入 ${n} 首`); }
    };
    $('[data-pick]', root).addEventListener('click', () => file.click());
    file.addEventListener('change', async () => { await ingest(file.files); file.value = ''; });

    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => {
      e.preventDefault(); e.stopPropagation(); drop.classList.add('is-over');
    }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => {
      e.preventDefault(); e.stopPropagation(); drop.classList.remove('is-over');
    }));
    drop.addEventListener('drop', e => ingest(e.dataTransfer && e.dataTransfer.files));

    $('[data-clear]', root).addEventListener('click', async () => {
      if (!P.list.length) return toast('列表已经是空的');
      if (!confirm(`清空全部 ${P.list.length} 首？本机存储里的音频也会一并删除。`)) return;
      audio.pause();
      await tracks.clear();
      P.index = -1;
      audio.removeAttribute('src');
      audio.load();
      await refresh();
      toast('已清空');
    });

    /* 示例音频：本站用五声音阶合成的一小段，用来确认播放器在你的设备上能不能出声 */
    $('[data-demo]', root).addEventListener('click', async e => {
      const btn = e.currentTarget;
      const exist = P.list.findIndex(x => x.name.startsWith('示例 · 五声音阶'));
      if (exist >= 0) { playIndex(exist); paintView(); return toast('已经在列表里了，直接播放'); }
      btn.disabled = true;
      try {
        const res = await fetch('assets/audio/demo.wav');
        if (!res.ok) throw new Error('示例音频读取失败（HTTP ' + res.status + '）');
        const blob = await res.blob();
        await addFiles([new File([blob], '示例 · 五声音阶.wav', { type: 'audio/wav' })]);
        await refresh();
        const i = P.list.findIndex(x => x.name.startsWith('示例 · 五声音阶'));
        if (i >= 0) playIndex(i);
        paintView();
        toast('示例音频已加入并开始播放');
      } catch (err) {
        toast('示例音频加载失败：' + (err.message || err));
      }
      btn.disabled = false;
    });

    /* ---- 首次挂载时注册全局键盘与拖放拦截 ---- */
    if (!wired) {
      wired = true;
      document.addEventListener('keydown', e => {
        if (!document.querySelector('[data-player]')) return;          // 只在播放页生效
        if (e.target.closest('input, textarea, select, [contenteditable]')) return;
        if (e.code === 'Space') { e.preventDefault(); toggle(); }
        else if (e.code === 'ArrowRight') { e.preventDefault(); seek(audio.currentTime + 5); }
        else if (e.code === 'ArrowLeft') { e.preventDefault(); seek(audio.currentTime - 5); }
      });
      /* 防止拖到页面别处时浏览器直接打开文件 */
      ['dragover', 'drop'].forEach(t => document.addEventListener(t, e => {
        if (e.target.closest('[data-drop]')) return;
        e.preventDefault();
      }));
    }

    /* ---- 站内曲库 ---- */
    const LIB = await loadLibrary();
    const libq = $('[data-libq]', root);
    const paintLib = () => {
      const q = (libq.value || '').trim().toLowerCase();
      const all = libTracks(LIB);
      const hit = all.map((t, i) => [t, i]).filter(([t]) => !q || t.name.toLowerCase().includes(q));
      $('[data-libcount]', root).textContent = LIB.error
        ? '读不出来：' + LIB.error
        : `${LIB.count} 首　·　共 ${fmtSize(LIB.total)}${q ? '　·　筛出 ' + hit.length : ''}`;
      $('[data-lib]', root).innerHTML = hit.length
        ? hit.map(([t, i]) => `
          <div class="prow" data-li="${i}" data-libid="${esc(t.id)}" role="button" tabindex="0">
            <span class="prow__no">${i + 1}</span>
            <span class="prow__main">
              <span class="prow__t">${esc(t.name)}</span>
              <span class="prow__s">${fmtSize(t.size)}${t.ext ? '　·　' + t.ext : ''}</span>
            </span>
          </div>`).join('')
        : `<div class="empty" style="padding:26px 10px"><b>${LIB.error ? '曲库读不出来' : '没有匹配的曲目'}</b>${
            LIB.error ? esc(LIB.error) : '换个关键词，或确认 music 文件夹里有音频。'}</div>`;
    };
    const playLib = i => {
      const all = libTracks(LIB);
      if (!all.length) return toast('曲库是空的');
      setList(all);
      paintLib();                       // 先重画行，再补上当前曲高亮
      playIndex(i);
      paintView();
    };
    libq.addEventListener('input', paintLib);
    $('[data-lib]', root).addEventListener('click', e => {
      const row = e.target.closest('[data-li]');
      if (row) playLib(Number(row.dataset.li));
    });
    $('[data-lib]', root).addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('[data-li]');
      if (!row) return;
      e.preventDefault();
      row.click();
    });
    $('[data-liball]', root).addEventListener('click', () => {
      playLib(0);
      toast('开始播放曲库，共 ' + LIB.count + ' 首');
    });
    $('[data-libshuffle]', root).addEventListener('click', () => {
      const all = libTracks(LIB);
      if (!all.length) return toast('曲库是空的');
      const i = Math.floor(Math.random() * all.length);
      playLib(i);
      toast('随机播放：' + all[i].name);
    });
    paintLib();

    await refresh();
    initMini();
    paintView();
  },
};
