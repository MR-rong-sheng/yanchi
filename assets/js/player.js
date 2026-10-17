/* ==========================================================================
   砚池 · player.js —— 播放器内核
   音频全部来自用户自己导入的本地文件，存在 IndexedDB 里，不联网、不上传。
   对外暴露：tracks（增删查）、P（状态）、toggle/next/prev/seek/...、on(订阅)
   ========================================================================== */
import { store, toast } from './core.js';

const DB_NAME = 'yanchi-audio', DB_VER = 1, OS = 'tracks';
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('这台浏览器不支持 IndexedDB'));
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains(OS)) d.createObjectStore(OS, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function run(mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction(OS, mode);
    const req = fn(t.objectStore(OS));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export const tracks = {
  all:   () => run('readonly',  s => s.getAll()),
  add:   rec => run('readwrite', s => s.put(rec)),
  del:   id => run('readwrite', s => s.delete(id)),
  clear: () => run('readwrite', s => s.clear()),
};

/* ---------- 状态 ---------- */
export const audio = new Audio();
audio.preload = 'metadata';

export const P = {
  list: [],            // [{id, name, size, type, dur, blob}]
  index: -1,
  mode:  store.get('player.mode', 'all'),        // all | one | shuffle
  volume: store.get('player.volume', 0.8),
  url: null,           // 当前曲目的 objectURL（导入的）或 http URL（站内曲库）
  urlBlob: false,      // 上一个 src 是不是自己造的 objectURL，决定切歌时要不要 revoke
};
audio.volume = P.volume;

const subs = new Set();
export const on = fn => { subs.add(fn); return () => subs.delete(fn); };
export const emit = (type, data) => subs.forEach(fn => { try { fn(type, data); } catch (e) { console.error(e); } });

export const current = () => (P.index >= 0 ? P.list[P.index] : null);
export const isPlaying = () => !audio.paused && !audio.ended && audio.readyState > 0;

/* ---------- 载入一首 ---------- */
function loadIndex(i, { autoplay = true } = {}) {
  if (!P.list.length) { P.index = -1; return; }
  P.index = (i + P.list.length) % P.list.length;
  const t = P.list[P.index];
  if (P.urlBlob && P.url) URL.revokeObjectURL(P.url);      // 只回收自己造的 objectURL
  P.urlBlob = !!t.blob;
  P.url = t.blob ? URL.createObjectURL(t.blob) : t.src;    // 曲库曲目直接走 URL：边下边播、能拖进度
  audio.src = P.url;
  audio.load();
  store.set('player.last', t.id);
  emit('track', t);
  if (autoplay) audio.play().catch(() => { /* 没有用户手势时浏览器会拒绝，忽略 */ });
}

export function setList(list, { keepCurrent = true, autoplay = false } = {}) {
  const oldId = keepCurrent && current() ? current().id : null;
  P.list = list;
  const i = oldId ? list.findIndex(x => x.id === oldId) : -1;
  if (i >= 0) { P.index = i; emit('track', current()); }
  else if (list.length) loadIndex(0, { autoplay });
  else { P.index = -1; audio.removeAttribute('src'); audio.load(); emit('track', null); }
  emit('list');
}

/* ---------- 控制 ---------- */
export const play  = () => { if (current()) audio.play().catch(e => toast('播放失败：' + (e.message || e))); };
export const pause = () => audio.pause();
export const toggle = () => (isPlaying() ? pause() : (current() ? play() : toast('先导入一首音频吧')));

export const next = () => {
  if (!P.list.length) return;
  if (P.mode === 'shuffle' && P.list.length > 1) {
    let i;
    do { i = Math.floor(Math.random() * P.list.length); } while (i === P.index);
    loadIndex(i);
  } else loadIndex(P.index + 1);
};
export const prev = () => {
  if (!P.list.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }   // 先回到本曲开头，和常见播放器一致
  P.mode === 'shuffle' ? next() : loadIndex(P.index - 1);
};
export const seek = sec => {
  if (!isFinite(audio.duration)) return;
  audio.currentTime = Math.max(0, Math.min(audio.duration, sec));
  emit('time');
};
export const setVolume = v => {
  P.volume = Math.max(0, Math.min(1, v));
  audio.volume = P.volume;
  store.set('player.volume', P.volume);
  emit('volume');
};
export const setMode = m => {
  P.mode = ['all', 'one', 'shuffle'].includes(m) ? m : 'all';
  store.set('player.mode', P.mode);
  emit('mode');
};
export const cycleMode = () => {
  const order = ['all', 'one', 'shuffle'];
  setMode(order[(order.indexOf(P.mode) + 1) % order.length]);
  return P.mode;
};
export const MODE_LABEL = { all: '列表循环', one: '单曲循环', shuffle: '随机播放' };

/** 直接播第 i 首（列表行点击用） */
export const playIndex = i => loadIndex(i);

/* ---------- 事件接线（只接一次） ---------- */
['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'volumechange'].forEach(t =>
  audio.addEventListener(t, () => {
    if (t === 'ended') { if (P.mode === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); } else next(); }
    emit(t === 'timeupdate' ? 'time' : t);
  }));

/* ---------- 缓冲 / 缓存进度 ----------
   手机通过隧道拉电脑上的 FLAC，一首几十 MB 要下很久。浏览器此时既不报进度也不报错，
   看起来就像卡死。这里把「拿到多少」暴露出去：loading=还没拿到第一批数据，
   pct=整首已缓存百分比（buffered 末点 / 时长），供播放页与小胶囊画进度条。 */
let _bufLoading = false, _bufPct = -1;
export function buffer() {
  const d = audio.duration;
  let end = 0;
  try { if (audio.buffered && audio.buffered.length) end = audio.buffered.end(audio.buffered.length - 1); } catch (e) { }
  const hasSrc = !!audio.currentSrc;
  const pct = (isFinite(d) && d > 0) ? Math.min(100, (end / d) * 100) : 0;
  return {
    hasSrc,
    pct,
    loading: hasSrc && !audio.paused && audio.readyState < 3,   // 首字节还没到
    playing: hasSrc && !audio.paused && audio.readyState > 0,   // 真的在播（决定画百分比还是滚动条）
    caching: hasSrc && pct < 99.5,                              // 还没整首缓存完
    ahead: Math.max(0, end - (audio.currentTime || 0)),
  };
}
function emitBuffer() {
  const st = buffer();
  const flipped = st.loading !== _bufLoading || (st.pct >= 99.5) !== (_bufPct >= 99.5);
  if (flipped || Math.abs(st.pct - _bufPct) >= 0.4) {
    _bufLoading = st.loading; _bufPct = st.pct;
    emit('buffer', st);
  }
}
['progress', 'suspend', 'waiting', 'stalled', 'playing', 'canplay', 'canplaythrough',
 'loadedmetadata', 'emptied', 'error', 'seeking', 'seeked', 'pause', 'play']
  .forEach(t => audio.addEventListener(t, () => emitBuffer()));

/* 系统级媒体控制（锁屏 / 耳机按键），不支持就跳过 */
function mediaSession() {
  if (!('mediaSession' in navigator)) return;
  const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch {} };
  set('play', () => play());
  set('pause', () => pause());
  set('previoustrack', () => prev());
  set('nexttrack', () => next());
}
on((t, d) => {
  if (t !== 'track') return;
  if ('mediaSession' in navigator && d) {
    /* 锁屏/耳机上显示的来源：曲库曲目与你自己导入的分开写，手机上才看得明白 */
    const fromLib = typeof d.id === 'string' && d.id.startsWith('lib:');
    navigator.mediaSession.metadata = new MediaMetadata({
      title: d.name,
      artist: fromLib ? '砚池 · 站内曲库' : '砚池 · 本地导入',
    });
  }
  mediaSession();
});

/* ---------- 导入文件 ---------- */
export async function addFiles(fileList) {
  const files = [...fileList].filter(f => f && (f.type.startsWith('audio/') || /\.(mp3|m4a|wav|flac|ogg|aac|opus|wma)$/i.test(f.name)));
  if (!files.length) { toast('没有可用的音频文件'); return 0; }
  let n = 0;
  for (const f of files) {
    const dur = await readDuration(f);
    await tracks.add({
      id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: f.name.replace(/\.[^.]+$/, ''),
      type: f.type || 'audio/*',
      size: f.size,
      dur,
      addedAt: Date.now(),
      blob: f,
    });
    n++;
  }
  return n;
}

/** 读时长：用一个临时 Audio 读元数据，读完就 revoke */
function readDuration(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = v => { URL.revokeObjectURL(url); a.removeAttribute('src'); resolve(v); };
    const timer = setTimeout(() => done(0), 6000);
    a.addEventListener('loadedmetadata', () => { clearTimeout(timer); done(isFinite(a.duration) ? a.duration : 0); });
    a.addEventListener('error', () => { clearTimeout(timer); done(0); });
    a.src = url;
  });
}

export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

export function fmtSize(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}
