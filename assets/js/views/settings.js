/* 设置 —— 外观、数据、以及这个框架怎么往下长 */
import { $, $$, esc, ic, toast, store, prefs, download } from '../core.js';
import { listNotes } from '../notes-store.js';

const ACCENTS = [
  { id: 'qing', name: '青', css: 'hsl(196 34% 42%)' },
  { id: 'zhe',  name: '赭', css: 'hsl(22 36% 47%)' },
  { id: 'zi',   name: '紫', css: 'hsl(270 26% 52%)' },
  { id: 'mo',   name: '墨', css: 'hsl(210 8% 38%)' },
];

export default {
  id: 'settings', name: '设置', icon: 'gear', nav: true,

  mount(root, ctx) {
    root.innerHTML = `
      <section class="view-head">
        <div class="kicker">本机偏好</div>
        <h2>设置</h2>
        <p>这里的每一项都保存在浏览器里，换台电脑就回到默认——这也是它不需要账号的原因。</p>
      </section>

      <div class="card glass spec">
        <div class="card__label">外观</div>

        <div class="settings-row">
          <div>
            <div class="t">明暗</div>
            <div class="d">日间是宣纸底，夜间是墨底。玻璃在两种底色上都会折射。</div>
          </div>
          <div class="seg" data-group="theme">
            <button data-v="light" aria-pressed="true">日间</button>
            <button data-v="dark" aria-pressed="false">夜间</button>
          </div>
        </div>

        <div class="settings-row">
          <div>
            <div class="t">强调色</div>
            <div class="d">青、赭、紫、墨四色，取自传统颜料名，全站只有这一个强调色。</div>
          </div>
          <div class="btn-row" data-group="accent">
            ${ACCENTS.map(a => `<button class="swatch" data-v="${a.id}" style="background:${a.css}" title="${a.name}" aria-label="${a.name}" aria-pressed="false"></button>`).join('')}
          </div>
        </div>

        <div class="settings-row">
          <div>
            <div class="t">字号</div>
            <div class="d">三档整体缩放，读长文时用“大”会舒服一些。</div>
          </div>
          <div class="seg" data-group="size">
            <button data-v="s">小</button>
            <button data-v="m" aria-pressed="true">中</button>
            <button data-v="l">大</button>
          </div>
        </div>
      </div>

      <div class="card glass spec" style="margin-top:16px">
        <div class="card__label">数据</div>
        <div class="settings-row">
          <div>
            <div class="t">备份</div>
            <div class="d" data-stat>—</div>
          </div>
          <div class="btn-row">
            <button class="btn" data-backup>${ic('down')}导出备份</button>
            <button class="btn" data-restore>${ic('up')}导入备份</button>
            <button class="btn btn--ghost" data-wipe>${ic('trash')}清空全部</button>
            <input type="file" accept="application/json,.json" data-file hidden />
          </div>
        </div>
      </div>

      <div class="card glass spec" style="margin-top:16px">
        <div class="card__label">关于这个框架</div>
        <div class="analysis" style="font-family:var(--font-ui);font-size:13.5px">
          <p><b>砚池 0.1</b> —— 一个语文学习工具的骨架，界面用液态玻璃做的，全部代码与文字都是为它另写的，不引用任何现成产品。</p>
          <p>内容是数据、界面是壳：改 <code>content/*.json</code> 就能换掉字库、篇目和题目，不需要动一行 JavaScript；加模块只要在
             <code>assets/js/views/</code> 里写一个导出 <code>{id, name, icon, mount}</code> 的文件，再在 <code>app.js</code> 的
             <code>ROUTES</code> 里登记，导航会自动多出一项。</p>
          <p>它有意不做的事：不做排行榜、不做打卡惩罚、不做云端同步。学习的事不需要被计时。</p>
        </div>
        <div class="chips" style="margin-top:16px">
          <span class="chip">液态玻璃外壳</span>
          <span class="chip">哈希路由</span>
          <span class="chip">内容 JSON 化</span>
          <span class="chip">localStorage 私有存储</span>
          <span class="chip">手绘 SVG 图标</span>
        </div>
      </div>
    `;

    /* ---- 外观 ---- */
    /* 注意：选择器统一用 data-group，不要用 [data-theme] —— <html> 自己就带
       data-theme 属性，那种写法会匹配到页面上所有按钮（曾因此把主题写成字号值） */
    const sync = () => {
      $$('[data-group="theme"] button', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === prefs.data.theme)));
      $$('[data-group="size"] button', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === prefs.data.size)));
      $$('[data-group="accent"] .swatch', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === prefs.data.accent)));
    };
    sync();

    $$('[data-group="theme"] button', root).forEach(b => b.addEventListener('click', () => { prefs.set('theme', b.dataset.v); sync(); ctx.render(); }));
    $$('[data-group="size"] button', root).forEach(b => b.addEventListener('click', () => { prefs.set('size', b.dataset.v); sync(); }));
    $$('[data-group="accent"] .swatch', root).forEach(b => b.addEventListener('click', () => { prefs.set('accent', b.dataset.v); sync(); }));

    /* ---- 数据 ---- */
    const stat = $('[data-stat]', root);
    const paintStat = () => {
      const notes = listNotes().length;
      const words = store.get('words.done', []).length;
      const poems = store.get('poems.done', []).length;
      const drafts = Object.keys(store.get('drafts', {})).length;
      stat.textContent = `札记 ${notes} 条 · 已掌握字词 ${words} 个 · 已背诗文 ${poems} 篇 · 草稿 ${drafts} 篇`;
    };
    paintStat();

    $('[data-backup]', root).addEventListener('click', () => {
      const payload = { app: '砚池', version: 1, at: new Date().toISOString(), data: store.dump() };
      download(`砚池备份-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
      toast('备份已导出');
    });

    const file = $('[data-file]', root);
    $('[data-restore]', root).addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        const data = obj.data || obj;
        if (!data || typeof data !== 'object') throw new Error('文件里没有可识别的数据');
        if (!confirm('导入会覆盖现有的同名字段，确定继续？')) return;
        store.restore(data);
        toast('导入完成，正在刷新');
        setTimeout(() => { prefs.apply(); ctx.go('today'); }, 700);
      } catch (e) {
        toast('导入失败：' + (e.message || e));
      }
      file.value = '';
    });

    $('[data-wipe]', root).addEventListener('click', () => {
      if (!confirm('清空本机的全部砚池数据（札记、进度、草稿、偏好）？此操作不能撤销。')) return;
      store.clear();
      prefs.data = { theme: 'light', accent: 'qing', size: 'm' };
      prefs.apply();
      toast('已恢复初始状态');
      setTimeout(() => ctx.render(), 400);
    });
  },
};
