# 砚池 · 后台接口契约（v2.0）

服务端：`serve.py`（Python 标准库，无第三方依赖）。
所有接口返回 JSON；出错时 `{"ok":false,"error":"..."}`，HTTP 状态码 400/401/403/404/409/413/429/500。

## 约定

- 会话：登录成功后下发 HttpOnly Cookie `yanchi_sid`（SameSite=Lax，**会话级**：不写 Max-Age，
  关掉浏览器即失效）；服务端另有 **12 小时闲置过期**与 30 天上限。
- **所有写操作（POST）必须带请求头** `X-Requested-With: yanchi-fetch`；缺了返回 403（防 CSRF）。
  带 `Origin` 头时其 host 必须与请求 Host 一致，否则 403。
- 请求体：`Content-Type: application/json`，UTF-8，上限 8 MB。
- 时间一律为 Unix 秒（整数）。

## 公开接口（无需登录）

### GET /api/me
```json
{"ok":true,"user":{"id":1,"name":"砚","role":"admin"},"setup":false,"version":"2.0"}
```
- 未登录：`{"ok":true,"user":null,...}`（HTTP 200，前端据此跳登录页）
- `setup:true` 表示系统还没有任何账号，前端应引导创建管理员。

### POST /api/setup  `{name, password}`
仅在系统无账号时可用。成功后自动登录并返回 `{"ok":true,"user":{...}}`。
已有账号时返回 409 `{"ok":false,"error":"已经初始化过了"}`。

### POST /api/login  `{name, password}`
成功：`{"ok":true,"user":{...}}` + Set-Cookie。
失败：401 `{"ok":false,"error":"用户名或密码不正确"}`（不区分账号不存在/密码错）。
连续失败过多：429 `{"ok":false,"error":"尝试次数过多，请 X 分钟后再试"}`。

### POST /api/logout
清除会话，返回 `{"ok":true}`。

## 需登录

### GET /api/me（同上，返回当前用户）
### POST /api/password  `{old, new}`
改自己的密码；成功后旧会话全部失效（当前会话也会失效，前端需回登录页）。
`new` 少于 6 位返回 400。

## 后台接口（仅 role=admin，否则 403）

### GET /api/admin/overview
```json
{"ok":true,"site":{"version":"2.0","python":"3.14.7","uptime":1234,"started_at":1699999999},
 "tracks":{"count":249,"total":18930000000},
 "users":{"total":3,"enabled":3,"admins":1},
 "sessions":{"active":2},
 "disk":[{"name":"C:","free":1,"total":2},{"name":"D:","free":3,"total":4}],
 "logins":[{"name":"砚","last_login":1699999999,"last_ip":"127.0.0.1"}]}
```

### GET /api/admin/users
```json
{"ok":true,"users":[{"id":1,"name":"砚","role":"admin","disabled":false,
  "created_at":1,"last_login":1,"last_ip":"127.0.0.1","online":true}]}
```

### POST /api/admin/users  `{name, password, role}`  role ∈ admin|user
201 创建。重名 409。用户名规则：2–24 字符，不能含空白/`:`/`/`。

### POST /api/admin/users/update  `{id, role?, disabled?, password?}`
任一字段可选。**不能把最后一个管理员降级或停用**（409）。

### POST /api/admin/users/delete  `{id}`
不能删自己，不能删最后一个管理员（409）。

### GET /api/admin/content
```json
{"ok":true,"files":[{"name":"words","size":42578,"count":143,"mtime":1,"backups":3}]}
```
`name` ∈ `units|words|poems|prompts`；`count` 为顶层数组长度（对象则 null）。

### GET /api/admin/content/get?name=words
```json
{"ok":true,"name":"words","data":{...},"backups":[{"file":"words.1699999999.json","ts":1,"size":1}]}
```

### POST /api/admin/content/save  `{name, data}`
写入前自动备份到 `.private/backup/`（保留最近 10 份），原子替换（`.tmp` → `os.replace`）。
`data` 必须是合法 JSON 值且不超 4 MB。返回 `{"ok":true,"count":143,"bytes":42578}`。

### POST /api/admin/content/restore  `{name, backup}`
从备份文件恢复，返回同 save。

### GET /api/admin/tracks?q=&offset=&limit=
`q` 匹配曲名或艺术家（不区分大小写）；`limit` 默认 50，上限 200。
```json
{"ok":true,"count":249,"total":18930000000,"tracks":[{"file":"A - B.flac","title":"B","artist":"A","size":1,"ext":"flac"}]}
```
数据源：`content/music.json`。

### POST /api/admin/tracks/delete  `{file}`
把该曲目**移入回收站**：`D:\yanchi-trash\`（同分区 rename，可恢复），
同时删掉它在 `D:\CloudMusic` 各处的同 inode 硬链接（否则重建清单会把它捞回来），
然后重扫库目录刷新 `content/music.json`。
```json
{"ok":true,"moved":"D:\\yanchi-trash\\X.flac","unlinked":["D:\\CloudMusic\\X.flac"],"count":248}
```

### POST /api/admin/tracks/restore  `{file}`
从回收站放回 `D:\CloudMusic\library\`，刷新清单。

### GET /api/admin/tracks/trash
```json
{"ok":true,"items":[{"file":"X.flac","size":1,"ts":1}]}
```

### POST /api/admin/tracks/rebuild
运行 `tools/build-library.py`（把 `D:\CloudMusic` 里的新音频补进库并重写清单）。
```json
{"ok":true,"count":249,"output":"…脚本输出…"}
```

### GET /api/admin/sessions
```json
{"ok":true,"sessions":[{"id":"a1b2c3d4e5f6","user":"砚","created_at":1,"last_seen":1,"ip":"1.2.3.4","ua":"…","current":true}]}
```

### POST /api/admin/sessions/kill  `{id}`
踢下线。

### GET /api/admin/audit?limit=100
```json
{"ok":true,"items":[{"ts":1,"name":"砚","action":"login.ok","detail":"127.0.0.1","ip":"127.0.0.1"}]}
```
`action` 取值：`login.ok` `login.fail` `login.lock` `logout` `setup` `user.add`
`user.update` `user.delete` `passwd.self` `content.save` `content.restore`
`track.delete` `track.restore` `track.rebuild` `session.kill` `gate.deny`。

## 开发/自检用的临时直通

存在 `.private/dev.token` 时（`python serve.py dev on` 生成，`dev off` 删除，**默认不存在**）：

- 页面请求 `GET /任意.html?dev=<token>`：自动以 `dev`（管理员）身份登录并 302 去掉 `dev` 参数，
  之后靠 Cookie 正常工作。自检脚本用这个进站。
- 接口请求带 `X-Yanchi-Dev: <token>`：直接以 `dev` 管理员身份调用。

`.private/dev.token` 不在站点根暴露（`.private/` 整目录 404），但**验完必须 `dev off`**，
否则等于给公网留了一把万能钥匙。

## 静态访问规则

- 任何路径段以 `.` 开头 → 404。
- 永久 404：`/serve.py`、`/README.md`、`/tools/*`、`/*.bat`、`/*.cmd`、`/content/backup/*`。
- 免登录白名单：`/login.html`、`/assets/js/login.js`、`/assets/css/auth.css`、`/assets/css/glass.css`、`/favicon.ico`。
- 其余一律要登录：文档类请求（无扩展名或 `.html`）未登录 → 302 `/login.html?next=<路径>`；
  资源类（js/css/json/音频）未登录 → 401 JSON。
- 目录不列（404），音频支持 Range（206）。

## 操作存档（每个账号一份）

- 位置：`.private/archive/<账号>.jsonl`；单份超过 4 MB 轮转成 `<账号>.1.jsonl`（只留一代）。
- 格式：**JSON Lines**，一行一条，字段固定：

```json
{"t":1791347016,"ts":"2026-10-07 12:36:56","u":"rongsheng","ev":"login.ok",
 "d":"rongsheng","ip":"223.104.146.194","ua":"Mozilla/5.0 …"}
```

| 字段 | 含义 |
|---|---|
| `t` | 服务端收到这条的时间（Unix 秒） |
| `ts` | 同一时间的本地可读字符串（给人用 `sort`/`grep` 看的） |
| `u` | 账号名（未登录的请求记成 `（未登录）`） |
| `ev` | 事件码，见下表 |
| `d` | 详情（自由文本，最长 600 字） |
| `ip` / `ua` | 来源地址 / 浏览器标识（UA 截 120 字） |

服务端事件与前端上报写进**同一个文件**，按 `t` 排序就是这个人完整的站内轨迹。

### 事件码

| 来源 | ev | 含义 |
|---|---|---|
| 服务端 | `server` | `d` 里是 `动作码 · 详情`，动作码同后台「记录」页（`login.ok` `logout` `user.add` `content.save` `track.delete` `settings` …） |
| 服务端 | `register` | 自助注册成功 |
| 服务端 | `ai.chat` `ai.fail` `ai.config` | AI 老师：问答（问的前 80 字 + 回答字数）、失败原因、配置改动 |
| 前端 | `view` | 进入了某个模块，`d` 形如 `字词 · 停留 42s` |
| 前端 | `click` | 点了可交互元素，`d` 形如 `播放/暂停 · 播放器` |
| 前端 | `prefs` | 改了偏好（主题/强调色/字号） |
| 前端 | `word` `poem` `note` `write` `play` `export` `import` `search` | 各模块的关键动作，`d` 自由文本 |
| 前端 | `boot` | 打开站点（会话开始） |

### GET /api/me（新增字段）
```json
{"ok":true,"user":{...},"setup":false,"register":true,"version":"2.0"}
```
`register:true` 表示当前允许自助注册（登录页据此显示「创建账号」按钮）。

### POST /api/activity  `{events:[{ev,d}, …]}`
需登录。一次最多 200 条；每会话每分钟最多 30 批（超了 429，前端会退避 30 秒后重发，不会丢事件）。逐条落进该账号的存档，返回 `{"ok":true,"taken":N}`。

### POST /api/register  `{name, password}`
自助注册（`allow_register` 为关时 403）。用户名 2–24 字、密码至少 6 位；成功后自动登录，
新账号角色固定为 `user`（永远不是管理员）。同一 IP 10 分钟内最多 5 次。

### GET /api/admin/archive
```json
{"ok":true,"files":[{"user":"rongsheng","file":"rongsheng.jsonl","lines":128,
  "bytes":24310,"mtime":1791347016}]}
```

### GET /api/admin/archive/get?user=rongsheng&tail=200
返回该账号存档的最后 N 行（解析好的对象数组，`items`）。

### POST /api/admin/settings  `{"allow_register": true|false}`
开关自助注册，返回当前设置。



## AI 老师（DeepSeek 代理）

右下角「师」那个入口的接口。**Key 只在服务端**（`.private/ai.json`），浏览器永远拿不到；
所有问答都经服务端转发，并带每人每分钟 / 每天的次数上限，避免公网上被人拿去刷余额。

### 配置（只对管理员开放）

配置文件 `.private/ai.json`（`.private/` 在 `.gitignore` 里）：

```json
{"api_key":"sk-…","base_url":"https://api.deepseek.com","model":"deepseek-chat",
 "enabled":true,"temperature":0.6,"max_tokens":1200,"system":""}
```

- `api_key` 为空时回落环境变量 `DEEPSEEK_API_KEY`。
- 改完立刻生效（每个请求都重读），不需要重启。
- 命令行也能配：`python serve.py ai [status] | ai key sk-… | ai model deepseek-chat | ai on|off | ai test`。
- `ai test` 会真的发一句话，用来验证 Key 和网络通不通。

### GET /api/ai/status（需登录）

```json
{"ok":true,"ready":true,"enabled":true,"model":"deepseek-chat","reason":""}
```
管理员额外拿到 `base_url` `key_tail` `max_tokens` `temperature`。
`ready:false` 时面板会显示提示条并把发送挡下来（不会发出请求）。

### POST /api/ai/chat（需登录）

```json
{"messages":[{"role":"user","content":"「池」这个字怎么讲？"}],
 "context":{"page":"字词","selection":"砚池里存着一汪清水"},
 "stream":true}
```

- `messages` 只接受 `user` / `assistant`；**`system` 由服务端拼**，客户端塞不进来。
- `context.page` / `context.selection` 会作为「此刻的上下文」附在系统提示词尾部
  （学生说「这段」「这句」时模型能对上原文），两者都裁长度。
- 单条 ≤ 6000 字，一次最多 30 条，合计 ≤ 24000 字；超了 413。
- 限流：每人每分钟 20 次、每天 300 次，超了 429（进程内计数，重启清零）。

`stream:true`（默认）返回 `text/event-stream`，且因为不带 Content-Length 会关掉这条连接：

```
data: {"delta":"「"}
data: {"delta":"池"}
data: {"done":true,"chars":38,"model":"deepseek-chat"}
```

出错时是 JSON（不是 SSE）：
`503` 没配 Key / 已关闭 · `429` 太频繁 · `502` 连不上 DeepSeek · `401` 上游 Key 无效 · `402` 余额不足 · `400` 模型名不对。
`stream:false` 则直接返回 `{"ok":true,"answer":"…","model":"…"}`，方便命令行和自检用。

### GET /api/admin/ai · POST /api/admin/ai

`GET` 返回同 `status`（管理员版）。`POST` 接受任意子集：

```json
{"api_key":"sk-…","model":"deepseek-chat","base_url":"https://api.deepseek.com",
 "enabled":true,"max_tokens":1200,"temperature":0.6,"system":"","clear_key":false}
```

- `api_key` 传空字符串表示「不改」，要清空请用 `"clear_key": true`。
- Key 必须 `sk-` 开头且 ≥ 20 位，否则 400。
- 改动会写一条 `ai.config` 审计。
