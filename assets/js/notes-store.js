/* ==========================================================================
   砚池 · notes-store.js —— 札记（本地笔记本）
   字词、诗文、随笔三处都可以往这里投递，统一成一种条目。
   ========================================================================== */
import { store, uid } from './core.js';

export const listNotes = () => store.get('notes', []);

export function addNote({ kind = 'free', title = '', body = '', from = '', tags = [] }) {
  const list = listNotes();
  const note = { id: uid(), kind, title, body, from, tags, at: Date.now() };
  list.unshift(note);
  store.set('notes', list);
  return note;
}

export function updateNote(id, patch) {
  const list = listNotes();
  const i = list.findIndex(n => n.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, at: Date.now() };
  store.set('notes', list);
  return list[i];
}

export function removeNote(id) {
  store.set('notes', listNotes().filter(n => n.id !== id));
}

export function noteExists(kind, title, from) {
  return listNotes().some(n => n.kind === kind && n.title === title && n.from === from);
}

export const KIND_LABEL = { word: '字词', poem: '诗文', free: '随笔', write: '习作' };

/** 全部札记导出成一份 Markdown */
export function toMarkdown(list = listNotes()) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const head = `# 砚池札记\n\n> 导出于 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} · 共 ${list.length} 条\n`;
  if (!list.length) return head + '\n（还没有札记。）\n';

  const groups = {};
  list.forEach(n => { (groups[n.kind] = groups[n.kind] || []).push(n); });

  let out = head;
  for (const [kind, items] of Object.entries(groups)) {
    out += `\n## ${KIND_LABEL[kind] || kind}\n`;
    items.forEach(n => {
      out += `\n### ${n.title || '（无题）'}\n`;
      if (n.from) out += `*${n.from}*\n`;
      out += `\n${n.body}\n`;
      out += `\n<sub>${new Date(n.at).toLocaleString('zh-CN')}</small>\n`;
    });
  }
  return out;
}
