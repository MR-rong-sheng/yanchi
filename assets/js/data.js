/* ==========================================================================
   砚池 · data.js —— 内容层
   框架把“内容”和“界面”分开：所有素材都是 content/*.json，
   改内容不用动一行代码，换掉这三个文件就是一个新工具。
   ========================================================================== */

const cache = new Map();

/** 载入一份内容文件，失败时给出人话错误 */
export async function load(name) {
  if (cache.has(name)) return cache.get(name);
  const data = await fetchJson(name, 0);
  cache.set(name, data);
  return data;
}

/* 取内容 JSON。会话刚失效或刚登录还没生效时会 401：
   等一下重试一次，再不行就明确回登录页 —— 不要让首屏只显示「读取失败」，
   用户看到的就是「poems.json 读取失败」那种无头无尾的报错。 */
async function fetchJson(name, attempt) {
  const res = await fetch(`content/${name}.json`, { cache: 'no-store', credentials: 'same-origin' });
  if (res.status === 401 || res.status === 403) {
    if (attempt < 1) {
      await new Promise(r => setTimeout(r, 500));
      return fetchJson(name, attempt + 1);
    }
    const back = encodeURIComponent(location.pathname + location.search + location.hash);
    location.replace('/login.html?next=' + back);
    throw new Error('登录状态已失效，正在回到登录页…');
  }
  if (!res.ok) throw new Error(`内容文件 content/${name}.json 读取失败（HTTP ${res.status}）`);
  return res.json();
}

export const FILES = { words: 'words', poems: 'poems', prompts: 'prompts' };

/** 轻量字符串散列，用来做“按天/按主题”的确定性抽取 */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** 同一天、同一 salt 永远抽出同一条 —— 不做“随机刷新”，让工具安定下来 */
export function pick(list, salt, dateKey) {
  if (!list || !list.length) return null;
  return list[hash(`${dateKey}::${salt}`) % list.length];
}

/** 一天里抽同样的一批（供“今日”页使用） */
export function pickSet(list, salt, dateKey, n = 3) {
  if (!list || !list.length) return [];
  const out = [], used = new Set();
  let i = 0;
  while (out.length < Math.min(n, list.length) && i < list.length * 4) {
    const idx = hash(`${dateKey}::${salt}::${i}`) % list.length;
    if (!used.has(idx)) { used.add(idx); out.push(list[idx]); }
    i++;
  }
  return out;
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5)  return '夜深了，读两行就好';
  if (h < 11) return '早上好，先认一个字';
  if (h < 14) return '中午好，读一首短诗';
  if (h < 18) return '下午好，把想到的记下来';
  if (h < 22) return '晚上好，写几句再收工';
  return '夜安，慢慢读';
}

export function weekday(d = new Date()) {
  return '日一二三四五六'[d.getDay()];
}

/** 常用检索：把一条内容拼成可搜索的字符串 */
export function haystack(obj) {
  return Object.values(obj).map(v => Array.isArray(v) ? v.join('') : String(v ?? '')).join(' ').toLowerCase();
}
