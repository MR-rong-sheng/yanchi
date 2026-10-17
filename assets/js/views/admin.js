/* ==========================================================================
   砚池 · views/admin.js —— 后台管理
   五个标签页：概览 / 账号 / 内容 / 曲库 / 记录；切换不刷新整页。
   数据全部经 api.js（admin），失败时抛出带 .status 的 Error；
   服务端返回的中文错误原样 toast，不在前面自行拦截。
   只依赖 ../api.js 与挂载时传入的 ctx。
   ========================================================================== */
import { admin as API, me as fetchMe, get, post } from '../api.js';

/* 动作码 → 中文标签（记录页用） */
const ACTION_LABEL = {
  'login.ok': '登录成功',
  'login.fail': '登录失败',
  'login.lock': '登录被限速',
  'logout': '退出',
  'setup': '初始化',
  'user.add': '新建账号',
  'user.update': '改账号',
  'user.delete': '删账号',
  'passwd.self': '改密',
  'content.save': '保存内容',
  'content.restore': '还原内容',
  'track.delete': '曲目入回收站',
  'track.restore': '曲目放回',
  'track.rebuild': '重建清单',
  'session.kill': '踢下线',
  'gate.deny': '门禁拦截',
  'error': '内部错误',
};

const ROLE_LABEL = { admin: '管理员', user: '普通' };

/* 事件码 → 中文标签（操作存档用；未知码原样显示） */
const EVENT_LABEL = {
  server: '服务端',
  register: '注册',
  view: '进页',
  click: '点击',
  prefs: '改偏好',
  word: '字词',
  poem: '诗文',
  note: '札记',
  write: '写作',
  play: '播放',
  export: '导出',
  import: '导入',
  search: '搜索',
  boot: '打开站点',
};

/* ---------- 格式化小工具 ---------- */
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
function fmtSize(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  let x = Number(n), i = 0;
  while (x >= 1024 && i < BYTE_UNITS.length - 1) { x /= 1024; i++; }
  return (i === 0 ? String(x) : x.toFixed(x >= 100 ? 0 : 1)) + ' ' + BYTE_UNITS[i];
}
function fmtUptime(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} 天 ${h} 小时`;
  if (h) return `${h} 小时 ${m} 分`;
  return `${m} 分 ${sec % 60} 秒`;
}
/** 从 JSON 解析错误里尽量还原到行号 */
function jsonErrLine(text, err) {
  const raw = (err && err.message) || String(err);
  const m = /position\s+(\d+)/i.exec(raw);
  if (!m) return raw;
  const line = String(text).slice(0, Number(m[1])).split('\n').length;
  return `第 ${line} 行附近：${raw}`;
}
function describeShape(data) {
  if (Array.isArray(data)) return `${data.length} 条（数组）`;
  if (data && typeof data === 'object') return `${Object.keys(data).length} 个键（对象）`;
  return typeof data;
}

export default {
  id: 'admin', name: '管理', icon: 'shield',
  nav: 'admin',        // 仅管理员在顶栏可见（路由注册由 app.js 负责）
  role: 'admin',       // 仅管理员可进

  async mount(root, ctx) {
    const { esc, ic, toast, openDrawer, closeDrawer, stamp, download } = ctx;
    const $ = (s, r = root) => r.querySelector(s);
    const $$ = (s, r = root) => Array.from(r.querySelectorAll(s));
    const $d = (s) => document.querySelector(s);          // 抽屉在 root 之外，用全局查询

    const TABS = [
      { id: 'overview', label: '概览', icon: 'db' },
      { id: 'users',    label: '账号', icon: 'users' },
      { id: 'content',  label: '内容', icon: 'book' },
      { id: 'tracks',   label: '曲库', icon: 'music' },
      { id: 'logs',     label: '记录', icon: 'log' },
    ];

    /* ---- 骨架 ---- */
    root.innerHTML = `
      <section class="view-head" data-admin="1">
        <div class="kicker">仅管理员</div>
        <h2>后台管理</h2>
        <p>曲库、账号、内容与操作记录都在这里。写操作有服务端守着底线，出错时会把原因原样告诉你。</p>
      </section>

      <div class="admin-tabs" data-tabs role="tablist">
        ${TABS.map(t => `<button class="seg__btn" data-tab="${t.id}" role="tab" aria-pressed="false">${ic(t.icon)}<span>${esc(t.label)}</span></button>`).join('')}
      </div>

      <div class="admin-panel" data-panel></div>
    `;

    const panel = $('[data-panel]', root);

    function syncTabs() {
      $$('[data-tab]', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    }
    $$('[data-tab]', root).forEach(b => b.addEventListener('click', () => {
      if (b.dataset.tab === tab) return;
      tab = b.dataset.tab;
      syncTabs();
      paintTab();
    }));

    let tab = 'overview';

    function loading() {
      panel.innerHTML = `<div class="card glass spec"><div class="empty">载入中…</div></div>`;
    }
    function fail(e) {
      panel.innerHTML = `<div class="card glass spec"><div class="empty"><b>读取失败</b>${esc((e && e.message) || String(e))}</div></div>`;
    }

    async function paintTab() {
      loading();
      try {
        if (tab === 'overview') await paintOverview();
        else if (tab === 'users') await paintAccounts();
        else if (tab === 'content') await paintContent();
        else if (tab === 'tracks') await paintLibrary();
        else if (tab === 'logs') await paintRecords();
      } catch (e) { fail(e); }
    }

    /* ============================================================
       1 · 概览
       ============================================================ */
    async function paintOverview() {
      const d = await API.overview();
      const site = d.site || {}, tracks = d.tracks || {}, users = d.users || {};
      const sess = d.sessions || {}, disk = d.disk || [], logins = d.logins || [];

      const stat = (k, v, s, accent) => `
        <div class="card glass spec admin-stat${accent ? ' admin-stat--accent' : ''}">
          <div class="k">${esc(k)}</div>
          <div class="v">${esc(v)}</div>
          ${s ? `<div class="s">${esc(s)}</div>` : ''}
        </div>`;

      panel.innerHTML = `
        <div class="card glass spec" style="margin-bottom:16px">
          <div class="card__label">概览</div>
          <div class="metric">
            <div class="n">${tracks.count ?? 0}</div>
            <div class="k">曲库曲目</div>
          </div>
        </div>

        <div class="admin-stats">
          ${stat('曲库', `${tracks.count ?? 0} 首`, `共 ${fmtSize(tracks.total)}`)}
          ${stat('账号', `${users.total ?? 0} 个`, `启用 ${users.enabled ?? 0} · 管理员 ${users.admins ?? 0}`)}
          ${stat('在线会话', `${sess.active ?? 0}`, '当前有效登录', true)}
          ${disk.map(x => stat(`${x.name} 剩余`, fmtSize(x.free), `共 ${fmtSize(x.total)}`)).join('')}
        </div>

        <div class="card glass spec" style="margin-top:16px">
          <div class="card__label">服务</div>
          <div class="admin-kv"><b>版本</b><span>砚池 ${esc(site.version || '—')}${site.dev_open ? '　<span class="badge badge--warn">dev 直通已开启</span>' : ''}</span></div>
          <div class="admin-kv"><b>Python</b><span>${esc(site.python || '—')}</span></div>
          <div class="admin-kv"><b>运行时长</b><span>${esc(fmtUptime(site.uptime))}${site.started_at ? '　·　启动于 ' + esc(stamp(site.started_at * 1000)) : ''}</span></div>
        </div>

        <div class="card glass spec">
          <div class="card__label">最近登录</div>
          <div class="admin-scroll">
            ${logins.length ? `
              <table class="admin-table">
                <thead><tr><th>账号</th><th>时间</th><th>来源 IP</th></tr></thead>
                <tbody>
                  ${logins.map(l => `
                    <tr>
                      <td class="name">${esc(l.name)}</td>
                      <td class="num muted">${esc(l.last_login ? stamp(l.last_login * 1000) : '—')}</td>
                      <td class="num muted">${esc(l.last_ip || '—')}</td>
                    </tr>`).join('')}
                </tbody>
              </table>` : `<div class="empty"><b>还没有登录记录</b>一旦有人登录，这里会列出最近 8 次。</div>`}
          </div>
        </div>
      `;
    }

    /* ============================================================
       2 · 账号
       ============================================================ */
    function openPwDrawer(u) {
      openDrawer({
        title: '修改密码',
        sub: `账号：${u.name}`,
        html: `
          <label class="field" style="border-radius:var(--r-sm);margin-bottom:12px">
            <input type="password" id="pw-new" placeholder="新密码（至少 6 位）" autocomplete="new-password" />
          </label>
          <p style="font-size:12.5px;color:var(--ink-3);line-height:1.9">改密后该账号的所有会话都会失效，需要重新登录。</p>
        `,
        actions: [{
          label: '保存', icon: 'check', kind: 'primary',
          onClick: async ({ closeDrawer }) => {
            const pw = ($d('#pw-new') && $d('#pw-new').value) || '';
            if (pw.length < 6) return toast('密码至少 6 位');
            try {
              await API.updateUser(u.id, { password: pw });
              closeDrawer(); toast(`已修改「${u.name}」的密码`); await paintAccounts();
            } catch (e) { toast(e.message); }
          },
        }],
      });
      setTimeout(() => $d('#pw-new') && $d('#pw-new').focus(), 60);
    }

    async function paintAccounts() {
      const [d, info] = await Promise.all([API.users(), fetchMe().catch(() => null)]);
      const users = d.users || [];
      const allowReg = !!(info && info.register);

      panel.innerHTML = `
        <div class="card glass spec">
          <div class="card__label">账号 · <span>${users.length} 个</span></div>
          <div class="btn-row" style="justify-content:flex-end;margin-bottom:10px">
            <button class="btn btn--primary" data-add>${ic('plus')}新建账号</button>
          </div>
          <div class="admin-scroll">
            <table class="admin-table">
              <thead><tr>
                <th>名字</th><th>角色</th><th>状态</th><th>上次登录</th><th>IP</th><th>在线</th>
                <th class="cell-actions">操作</th>
              </tr></thead>
              <tbody>
                ${users.map(u => `
                  <tr data-uid="${u.id}">
                    <td class="name">${esc(u.name)}</td>
                    <td><span class="badge${u.role === 'admin' ? ' badge--accent' : ''}">${esc(ROLE_LABEL[u.role] || u.role)}</span></td>
                    <td>${u.disabled ? '<span class="badge badge--off">已停用</span>' : '<span class="badge badge--ok">启用</span>'}</td>
                    <td class="num muted">${esc(u.last_login ? stamp(u.last_login * 1000) : '从未')}</td>
                    <td class="num muted">${esc(u.last_ip || '—')}</td>
                    <td>${u.online ? '<span class="dot-live"></span>在线' : '<span class="muted">离线</span>'}</td>
                    <td class="cell-actions">
                      <button class="btn btn--sm" data-act="role" data-id="${u.id}">${u.role === 'admin' ? '降为普通' : '设为管理员'}</button>
                      <button class="btn btn--sm" data-act="pw" data-id="${u.id}">${ic('key')}改密</button>
                      <button class="btn btn--sm" data-act="toggle" data-id="${u.id}">${u.disabled ? '启用' : '停用'}</button>
                      <button class="btn btn--sm btn--ghost" data-act="del" data-id="${u.id}">${ic('trash')}删除</button>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card glass spec">
          <div class="card__label">自助注册</div>
          <div class="admin-toggle">
            <label class="admin-switch">
              <input type="checkbox" data-register${allowReg ? ' checked' : ''} />
              <span class="admin-switch__track"><span class="admin-switch__dot"></span></span>
              <span class="admin-switch__text">允许自助注册</span>
            </label>
            <span class="badge${allowReg ? ' badge--ok' : ' badge--off'}" data-regbadge>${allowReg ? '已开启' : '已关闭'}</span>
          </div>
          <p class="admin-warn">${ic('ban')}<span><b>打开后，任何能打开公网地址的人都能自己建号</b>。新账号只能看前台、进不了后台，但仍会占用一个账号位并出现在「记录 · 操作存档」里；拿不准就保持关闭。</span></p>
        </div>
      `;

      const byId = (id) => users.find(u => String(u.id) === String(id));

      /* 自助注册开关：从 /api/me 的 register 读初值，切换即写回服务端 */
      const regBox = $('[data-register]', root);
      if (regBox) regBox.addEventListener('change', async () => {
        const want = regBox.checked;
        regBox.disabled = true;
        try {
          const r = await post('/api/admin/settings', { allow_register: want });
          const on = !!(r.settings && r.settings.allow_register);
          regBox.checked = on;
          const bd = $('[data-regbadge]', root);
          if (bd) { bd.textContent = on ? '已开启' : '已关闭'; bd.className = 'badge' + (on ? ' badge--ok' : ' badge--off'); }
          toast(on ? '已允许自助注册' : '已关闭自助注册');
        } catch (e) {
          regBox.checked = !want;                 // 写回失败：开关回到真实状态
          toast('设置失败：' + e.message);
        } finally { regBox.disabled = false; }
      });

      $('[data-add]', root).addEventListener('click', () => {
        openDrawer({
          title: '新建账号',
          sub: '用户名 2–24 字符，不含空格与 : /',
          html: `
            <label class="field" style="border-radius:var(--r-sm);margin-bottom:12px">
              <input type="text" id="ac-name" placeholder="用户名" autocomplete="off" />
            </label>
            <label class="field" style="border-radius:var(--r-sm);margin-bottom:12px">
              <input type="password" id="ac-pw" placeholder="密码（至少 6 位）" autocomplete="new-password" />
            </label>
            <label class="field" style="border-radius:var(--r-sm)">
              <select id="ac-role">
                <option value="user">普通账号</option>
                <option value="admin">管理员</option>
              </select>
            </label>
          `,
          actions: [{
            label: '创建', icon: 'check', kind: 'primary',
            onClick: async ({ closeDrawer }) => {
              const name = (($d('#ac-name') && $d('#ac-name').value) || '').trim();
              const pw = ($d('#ac-pw') && $d('#ac-pw').value) || '';
              const role = ($d('#ac-role') && $d('#ac-role').value) || 'user';
              if (!name) return toast('请填写用户名');
              if (pw.length < 6) return toast('密码至少 6 位');
              try {
                await API.addUser(name, pw, role);
                closeDrawer(); toast(`已创建账号「${name}」`); await paintAccounts();
              } catch (e) { toast(e.message); }
            },
          }],
        });
        setTimeout(() => $d('#ac-name') && $d('#ac-name').focus(), 60);
      });

      $$('[data-act]', root).forEach(btn => btn.addEventListener('click', async () => {
        const u = byId(btn.dataset.id);
        if (!u) return;
        const act = btn.dataset.act;
        try {
          if (act === 'role') {
            const next = u.role === 'admin' ? 'user' : 'admin';
            if (!confirm(`把「${u.name}」的角色改为「${ROLE_LABEL[next]}」？`)) return;
            await API.updateUser(u.id, { role: next });
            toast(`「${u.name}」现在${ROLE_LABEL[next]}`); await paintAccounts();
          } else if (act === 'pw') {
            openPwDrawer(u);
          } else if (act === 'toggle') {
            const dis = !u.disabled;
            if (dis && !confirm(`停用「${u.name}」？其所有会话会立即失效，将无法登录。`)) return;
            await API.updateUser(u.id, { disabled: dis });
            toast(dis ? `已停用「${u.name}」` : `已启用「${u.name}」`); await paintAccounts();
          } else if (act === 'del') {
            if (!confirm(`删除账号「${u.name}」？\n\n· 该账号的会话会立即失效；\n· 删除后无法登录，也不能恢复。\n\n确定继续？`)) return;
            await API.delUser(u.id);
            toast(`已删除「${u.name}」`); await paintAccounts();
          }
        } catch (e) { toast(e.message); }
      }));
    }

    /* ============================================================
       3 · 内容
       ============================================================ */
    let contentList = null;         // API.content() 的文件清单
    let contentName = null;         // 当前选中的文件
    let contentBackups = [];        // 当前文件的备份

    async function openContent(name) {
      const d = await API.contentGet(name);
      contentName = name;
      contentBackups = d.backups || [];
      const ed = $('[data-editor]', root);
      ed.value = JSON.stringify(d.data, null, 2);
      const meta = $('[data-cmeta]', root);
      if (meta) {
        const info = (contentList || []).find(f => f.name === name) || {};
        const count = d.data && d.data.length !== undefined ? d.data.length : (d.data && typeof d.data === 'object' ? Object.keys(d.data).length : null);
        meta.innerHTML =
          `<span>条目：<b>${esc(count === null ? '—' : count)}</b></span>` +
          `<span>文件大小：<b>${esc(fmtSize(info.size))}</b></span>` +
          `<span>备份：<b>${contentBackups.length}</b> 份</span>` +
          (info.mtime ? `<span>改动于：<b>${esc(stamp(info.mtime * 1000))}</b></span>` : '');
      }
      $$('[data-pick]', root).forEach(b => {
        b.className = 'btn btn--sm' + (b.dataset.name === name ? ' btn--primary' : '');
      });
    }

    async function paintContent() {
      if (!contentList) contentList = (await API.content()).files || [];

      panel.innerHTML = `
        <div class="card glass spec">
          <div class="card__label">内容文件</div>
          <div class="admin-pick">
            ${contentList.map(f => `<button class="btn btn--sm" data-pick data-name="${esc(f.name)}">${esc(f.name)} <span class="badge">${esc(f.count === null || f.count === undefined ? '—' : f.count)}</span></button>`).join('')}
          </div>
          <div class="admin-meta" style="margin-top:14px" data-cmeta></div>
        </div>

        <div class="card glass spec">
          <div class="btn-row" style="justify-content:space-between;margin-bottom:12px">
            <div class="btn-row">
              <button class="btn btn--sm" data-validate>${ic('check')}校验</button>
              <button class="btn btn--sm" data-format>${ic('edit')}格式化</button>
            </div>
            <div class="btn-row">
              <button class="btn btn--sm" data-restore>${ic('up')}还原备份</button>
              <button class="btn btn--sm btn--primary" data-save>${ic('down')}保存</button>
            </div>
          </div>
          <textarea class="admin-editor" data-editor spellcheck="false" wrap="off"></textarea>
        </div>
      `;

      const editor = $('[data-editor]', root);
      const first = contentName && contentList.some(f => f.name === contentName) ? contentName : (contentList[0] && contentList[0].name);
      if (first) await openContent(first);
      else editor.value = '';

      $$('[data-pick]', root).forEach(b => b.addEventListener('click', async () => {
        try { await openContent(b.dataset.name); }
        catch (e) { toast(e.message); }
      }));

      /* 本地校验通过才允许写回 */
      const parseLocal = () => {
        try { return { ok: true, data: JSON.parse(editor.value) }; }
        catch (e) { return { ok: false, err: jsonErrLine(editor.value, e) }; }
      };

      $('[data-validate]', root).addEventListener('click', () => {
        const r = parseLocal();
        if (!r.ok) return toast('校验未通过：' + r.err);
        toast('校验通过：' + describeShape(r.data));
      });

      $('[data-format]', root).addEventListener('click', () => {
        const r = parseLocal();
        if (!r.ok) return toast('格式化失败：' + r.err);
        editor.value = JSON.stringify(r.data, null, 2);
        toast('已格式化');
      });

      $('[data-save]', root).addEventListener('click', async () => {
        const r = parseLocal();
        if (!r.ok) return toast('保存前校验未通过：' + r.err);   // 不把坏 JSON 写进去
        try {
          const res = await API.contentSave(contentName, r.data);
          toast(`已保存 ${contentName}：${res.count ?? '—'} 条 · ${fmtSize(res.bytes)}`);
          contentList = null;                                   // 刷新文件清单里的条目数/大小
          await paintContent();
        } catch (e) { toast(e.message); }
      });

      $('[data-restore]', root).addEventListener('click', () => {
        if (!contentBackups.length) return toast('这个文件还没有备份');
        openDrawer({
          title: '还原备份',
          sub: `${contentName} · 共 ${contentBackups.length} 份`,
          html: `
            <label class="field" style="border-radius:var(--r-sm)">
              <select id="bk-sel">
                ${contentBackups.map(b => `<option value="${esc(b.file)}">${esc(b.file)}　·　${esc(fmtSize(b.size))}</option>`).join('')}
              </select>
            </label>
            <div class="admin-meta" style="margin-top:12px">
              ${contentBackups.map(b => `<span>${esc(stamp(b.ts * 1000))}</span>`).join('')}
            </div>
            <p style="font-size:12.5px;color:var(--ink-3);margin-top:14px;line-height:1.9">还原会用所选备份覆盖当前内容；覆盖前服务端会再自动备份一次。</p>
          `,
          actions: [{
            label: '还原', icon: 'up', kind: 'primary',
            onClick: async ({ closeDrawer }) => {
              const bk = $d('#bk-sel') && $d('#bk-sel').value;
              if (!bk) return toast('请选择一份备份');
              if (!confirm(`用备份「${bk}」覆盖 ${contentName} 的当前内容？`)) return;
              try {
                const res = await API.contentRestore(contentName, bk);
                closeDrawer();
                toast(`已还原：${res.count ?? '—'} 条 · ${fmtSize(res.bytes)}`);
                contentList = null;
                await openContent(contentName);
              } catch (e) { toast(e.message); }
            },
          }],
        });
      });
    }

    /* ============================================================
       4 · 曲库
       ============================================================ */
    const lib = { q: '', offset: 0, limit: 50, matched: 0, count: 0, total: 0 };

    async function fillTracks() {
      const rows = $('[data-rows]', root);
      const pager = $('[data-pager]', root);
      const countEl = $('[data-count]', root);
      if (!rows) return;
      try {
        const d = await API.tracks(lib.q, lib.offset, lib.limit);
        lib.matched = d.matched ?? 0;
        lib.count = d.count ?? 0;
        lib.total = d.total ?? 0;
        const tracks = d.tracks || [];

        if (countEl) countEl.textContent = `${lib.count} 首　·　共 ${fmtSize(lib.total)}${lib.q ? '　·　筛出 ' + lib.matched : ''}`;

        rows.innerHTML = tracks.length ? tracks.map(t => `
          <tr>
            <td class="cell-t name" title="${esc(t.title)}">${esc(t.title)}</td>
            <td class="cell-t muted" title="${esc(t.artist || '')}">${esc(t.artist || '—')}</td>
            <td class="num muted">${esc(fmtSize(t.size))}</td>
            <td class="cell-actions"><button class="btn btn--sm btn--ghost" data-del="${esc(t.file)}">${ic('trash')}移入回收站</button></td>
          </tr>`).join('')
          : `<tr><td colspan="4"><div class="empty"><b>${lib.q ? '没有匹配的曲目' : '曲库是空的'}</b>${lib.q ? '换个关键词试试。' : ''}</div></td></tr>`;

        /* 分页 */
        if (pager) {
          const start = lib.matched ? lib.offset + 1 : 0;
          const end = Math.min(lib.offset + tracks.length, lib.matched);
          const prevOff = Math.max(0, lib.offset - lib.limit);
          const nextOff = lib.offset + lib.limit;
          pager.innerHTML = `
            <span>第 ${start}–${end} / 共 ${lib.matched} 条</span>
            <span class="grow"></span>
            <label class="field" style="border-radius:999px;padding:5px 12px">
              <select data-limit>
                ${[50, 100, 200].map(n => `<option value="${n}"${n === lib.limit ? ' selected' : ''}>每页 ${n}</option>`).join('')}
              </select>
            </label>
            <button class="btn btn--sm" data-prev ${prevOff >= lib.offset ? 'disabled' : ''}>${ic('up')}上一页</button>
            <button class="btn btn--sm" data-next ${nextOff >= lib.matched ? 'disabled' : ''}>下一页${ic('right')}</button>
          `;
          const prev = $('[data-prev]', pager), next = $('[data-next]', pager);
          if (prev) prev.addEventListener('click', () => { lib.offset = prevOff; fillTracks(); });
          if (next) next.addEventListener('click', () => { lib.offset = nextOff; fillTracks(); });
          const lim = $('[data-limit]', pager);
          if (lim) lim.addEventListener('change', () => { lib.limit = Number(lim.value); lib.offset = 0; fillTracks(); });
        }

        /* 行内删除 */
        $$('[data-del]', rows).forEach(btn => btn.addEventListener('click', async () => {
          const file = btn.dataset.del;
          if (!confirm(`把「${file}」移入回收站？\n\n· 会同时删掉库目录里的同文件链接；\n· 之后可在回收站「放回」。`)) return;
          try {
            const r = await API.trackDelete(file);
            toast(`已移入回收站（现 ${r.count} 首）`);
            await fillTracks(); await fillTrash();
            contentList = null;    // 曲库变了，内容页的条目数也过时
          } catch (e) { toast(e.message); }
        }));
      } catch (e) { toast('读取曲库失败：' + e.message); }
    }

    async function fillTrash() {
      const box = $('[data-trash]', root);
      const cnt = $('[data-trashcount]', root);
      if (!box) return;
      try {
        const d = await API.trash();
        const items = d.items || [];
        if (cnt) cnt.textContent = `${items.length} 项`;
        box.innerHTML = items.length ? `
          <table class="admin-table">
            <thead><tr><th>文件</th><th>大小</th><th>移入时间</th><th class="cell-actions">操作</th></tr></thead>
            <tbody>
              ${items.map(it => `
                <tr>
                  <td class="cell-t" title="${esc(it.file)}">${esc(it.file)}</td>
                  <td class="num muted">${esc(fmtSize(it.size))}</td>
                  <td class="num muted">${esc(it.ts ? stamp(it.ts * 1000) : '—')}</td>
                  <td class="cell-actions"><button class="btn btn--sm" data-put="${esc(it.file)}">${ic('up')}放回</button></td>
                </tr>`).join('')}
            </tbody>
          </table>`
          : `<div class="empty"><b>回收站是空的</b>被移出的曲目会先落到这里，可随时放回。</div>`;

        $$('[data-put]', box).forEach(btn => btn.addEventListener('click', async () => {
          const file = btn.dataset.put;
          if (!confirm(`把「${file}」放回曲库？`)) return;
          try {
            const r = await API.trackRestore(file);
            toast(`已放回（现 ${r.count} 首）`);
            await fillTracks(); await fillTrash();
            contentList = null;
          } catch (e) { toast(e.message); }
        }));
      } catch (e) { toast('读取回收站失败：' + e.message); }
    }

    async function paintLibrary() {
      panel.innerHTML = `
        <div class="card glass spec">
          <div class="card__label">曲库 · <span data-count>…</span></div>
          <div class="btn-row" style="margin-bottom:10px">
            <label class="field" style="flex:1;min-width:220px">
              ${ic('search')}
              <input type="search" data-q placeholder="搜曲名或艺术家…" autocomplete="off" />
            </label>
            <button class="btn btn--sm" data-rebuild>${ic('repeat')}重建清单</button>
          </div>
          <div class="admin-out" data-out></div>
          <div class="admin-scroll">
            <table class="admin-table">
              <thead><tr><th>曲名</th><th>艺术家</th><th>大小</th><th class="cell-actions">操作</th></tr></thead>
              <tbody data-rows><tr><td colspan="4"><div class="empty">载入中…</div></td></tr></tbody>
            </table>
          </div>
          <div class="admin-pager" data-pager></div>
        </div>

        <div class="card glass spec">
          <div class="card__label">回收站 · <span data-trashcount>…</span></div>
          <div data-trash><div class="empty">载入中…</div></div>
        </div>
      `;

      /* 搜索：防抖 300ms */
      let deb;
      $('[data-q]', root).addEventListener('input', e => {
        clearTimeout(deb);
        const v = e.target.value.trim();
        deb = setTimeout(() => { lib.q = v; lib.offset = 0; fillTracks(); }, 300);
      });

      /* 重建清单：进 loading 态，跑完把脚本输出摘要显示出来 */
      $('[data-rebuild]', root).addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        const out = $('[data-out]', root);
        if (!confirm('重建曲库清单？会扫描 D:\\CloudMusic 把新音频补进库，可能需要十几秒。')) return;
        const old = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `${ic('repeat')}重建中…`;
        out.textContent = '正在运行 tools/build-library.py …';
        try {
          const r = await API.rebuild();
          const lines = String(r.output || '').trim().split('\n');
          const tail = lines.slice(-14).join('\n');
          out.textContent = `完成：清单现 ${r.count} 首\n\n${tail || '（脚本没有输出）'}`;
          toast(`重建完成，共 ${r.count} 首`);
          lib.offset = 0;
          contentList = null;
          await fillTracks(); await fillTrash();
        } catch (e) {
          out.textContent = '重建失败：' + e.message;
          toast('重建失败：' + e.message);
        } finally {
          btn.disabled = false;
          btn.innerHTML = old;
        }
      });

      await fillTracks();
      await fillTrash();
    }

    /* ============================================================
       5 · 记录
       ============================================================ */
    async function paintRecords() {
      const [sd, ad] = await Promise.all([API.sessions(), API.audit(100)]);
      const sessions = sd.sessions || [];
      const items = ad.items || [];

      panel.innerHTML = `
        <div class="card glass spec">
          <div class="card__label">在线会话 · <span>${sessions.length} 个</span></div>
          <div class="admin-scroll">
            ${sessions.length ? `
              <table class="admin-table">
                <thead><tr><th>用户</th><th>来源 IP</th><th>最后活动</th><th>UA 摘要</th><th class="cell-actions">操作</th></tr></thead>
                <tbody>
                  ${sessions.map(s => `
                    <tr>
                      <td class="name">${esc(s.user)}${s.current ? '　<span class="badge badge--accent">当前</span>' : ''}</td>
                      <td class="num muted">${esc(s.ip || '—')}</td>
                      <td class="num muted">${esc(s.last_seen ? stamp(s.last_seen * 1000) : '—')}</td>
                      <td class="cell-t muted" title="${esc(s.ua || '')}">${esc(s.ua || '—')}</td>
                      <td class="cell-actions">
                        <button class="btn btn--sm btn--ghost" data-kill="${esc(s.id)}">${ic('ban')}踢下线</button>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>` : `<div class="empty"><b>没有在线会话</b>除你自己以外还有谁在线，会显示在这里。</div>`}
          </div>
        </div>

        <div class="card glass spec">
          <div class="card__label">操作记录 · 最近 100 条</div>
          <div class="admin-scroll">
            ${items.length ? `
              <table class="admin-table">
                <thead><tr><th>时间</th><th>账号</th><th>动作</th><th>详情</th><th>IP</th></tr></thead>
                <tbody>
                  ${items.map(a => `
                    <tr>
                      <td class="num muted">${esc(a.ts ? stamp(a.ts * 1000) : '—')}</td>
                      <td class="name">${esc(a.name || '—')}</td>
                      <td><span class="badge">${esc(ACTION_LABEL[a.action] || a.action || '—')}</span></td>
                      <td class="cell-t muted" title="${esc(a.detail || '')}">${esc(a.detail || '')}</td>
                      <td class="num muted">${esc(a.ip || '—')}</td>
                    </tr>`).join('')}
                </tbody>
              </table>` : `<div class="empty"><b>还没有操作记录</b>登录、改动、后台操作都会记在这里。</div>`}
          </div>
        </div>

        <div class="card glass spec">
          <div class="card__label">操作存档 · <span data-archivecount>…</span></div>
          <p class="admin-note">每个账号一份站内轨迹（服务端动作与前台点击合在一起）。「看最近 50 条」翻最近的记录，「下载」导出 JSONL。</p>
          <div data-archive><div class="empty">载入中…</div></div>
        </div>
      `;

      fillArchive();

      $$('[data-kill]', root).forEach(btn => btn.addEventListener('click', async () => {
        const id = btn.dataset.kill;
        if (!confirm(`把会话「${id}」踢下线？对方需重新登录。`)) return;
        try {
          const r = await API.killSession(id);
          toast(`已踢下线（${r.killed ?? 0} 个会话）`);
          await paintRecords();
        } catch (e) { toast(e.message); }
      }));
    }

    /* 操作存档 · 按账号列出（GET /api/admin/archive） */
    async function fillArchive() {
      const box = $('[data-archive]', root);
      const cnt = $('[data-archivecount]', root);
      if (!box) return;
      try {
        const d = await get('/api/admin/archive');
        const files = d.files || [];
        if (cnt) cnt.textContent = `${files.length} 份`;
        box.innerHTML = files.length ? `
          <div class="admin-scroll">
            <table class="admin-table">
              <thead><tr><th>账号</th><th>行数</th><th>大小</th><th>更新时间</th><th class="cell-actions">操作</th></tr></thead>
              <tbody>
                ${files.map(f => `
                  <tr>
                    <td class="name">${esc(f.user)}</td>
                    <td class="num muted">${esc(f.lines ?? 0)}</td>
                    <td class="num muted">${esc(fmtSize(f.bytes))}</td>
                    <td class="num muted">${esc(f.mtime ? stamp(f.mtime * 1000) : '—')}</td>
                    <td class="cell-actions">
                      <button class="btn btn--sm" data-arch-view="${esc(f.user)}">${ic('log')}看最近 50 条</button>
                      <button class="btn btn--sm btn--ghost" data-arch-dl="${esc(f.user)}">${ic('down')}下载</button>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : `<div class="empty"><b>还没有存档</b>等有人登录或在前台操作，这里会按账号各列一份。</div>`;

        $$('[data-arch-view]', box).forEach(btn =>
          btn.addEventListener('click', () => openArchiveDrawer(btn.dataset.archView)));
        $$('[data-arch-dl]', box).forEach(btn =>
          btn.addEventListener('click', () => downloadArchive(btn.dataset.archDl, btn)));
      } catch (e) {
        box.innerHTML = `<div class="empty"><b>读取存档失败</b>${esc(e.message)}</div>`;
      }
    }

    /* 操作存档 · 抽屉里看最近 50 条（新的在上面） */
    async function openArchiveDrawer(user) {
      let items = [];
      try {
        const d = await get('/api/admin/archive/get?user=' + encodeURIComponent(user) + '&tail=50');
        items = d.items || [];
      } catch (e) {
        return openDrawer({
          title: `操作存档 · ${user}`, sub: '读取失败',
          html: `<div class="empty"><b>读不出来</b>${esc(e.message)}</div>`,
        });
      }
      const rows = items.slice().reverse().map(it => `
        <tr>
          <td class="num muted">${esc(it.ts || (it.t ? stamp(it.t * 1000) : '—'))}</td>
          <td title="${esc(it.ev || '')}"><span class="badge">${esc(EVENT_LABEL[it.ev] || it.ev || '—')}</span></td>
          <td class="cell-t muted" title="${esc(it.d || '')}">${esc(it.d || '—')}</td>
          <td class="num muted">${esc(it.ip || '—')}</td>
        </tr>`).join('');
      openDrawer({
        title: `操作存档 · ${user}`,
        sub: `最近 ${items.length} 条 · 新的在上面`,
        html: items.length ? `
          <div class="admin-scroll" style="max-height:58vh;overflow:auto">
            <table class="admin-table">
              <thead><tr><th>时间</th><th>事件</th><th>详情</th><th>IP</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>` : `<div class="empty"><b>这段存档是空的</b>暂时没有可看的记录。</div>`,
      });
    }

    /* 操作存档 · 导出 JSONL（tail=500，前端拼文本） */
    async function downloadArchive(user, btn) {
      if (btn) btn.disabled = true;
      try {
        const d = await get('/api/admin/archive/get?user=' + encodeURIComponent(user) + '&tail=500');
        const items = d.items || [];
        if (!items.length) { toast('这个账号还没有存档内容'); return; }
        const text = items.map(it => JSON.stringify(it)).join('\n') + '\n';
        download(`${user}.jsonl`, text, 'application/x-ndjson');
        toast(`已导出「${user}」的 ${items.length} 条存档`);
      } catch (e) { toast('下载失败：' + e.message); }
      finally { if (btn) btn.disabled = false; }
    }

    /* ---- 启动 ---- */
    syncTabs();
    await paintTab();
  },
};
