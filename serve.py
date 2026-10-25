#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""砚池 · 自带服务（v2.0：静态 + 账号 + 后台）

在 v1 的三件事（Range / 不列目录 / 多线程）之上，补上：
  4. 账号密码：PBKDF2-SHA256 加盐哈希，服务端会话（Cookie 只携带随机令牌，库里存的是它的哈希）
  5. 全站门禁：除登录页外一律要登录；公网隧道因此不再是裸奔状态
  6. 后台接口：用户管理 / 内容编辑 / 曲库管理 / 会话与操作记录（见 tools/API.md）

用法：
    python serve.py                     启动（127.0.0.1:8081，站点根 = 本文件所在目录）
    python serve.py 8081 <目录>          指定端口与根目录
    python serve.py users               列出账号
    python serve.py adduser <名> [--admin]
    python serve.py passwd <名>
    python serve.py deluser <名>
    python serve.py dev on|off          自检用的临时直通开关（默认关）
    python serve.py ai [status|key|model|on|off|test]   AI 老师（DeepSeek）的配置与连通性测试
    python serve.py archive [账号] [N]   看操作存档（不带参数=列出所有存档）
    python serve.py kick                清掉全部登录会话
"""
import os
import sys
import json
import time
import shutil
import sqlite3
import secrets
import hashlib
import hmac
import mimetypes
import functools
import socket
import threading
import subprocess
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from urllib.parse import urlparse, parse_qs, urlencode
import urllib.request
import urllib.error

# ---------------------------------------------------------------- 常量与路径
BASE = os.path.dirname(os.path.abspath(__file__))
PRIV = os.path.join(BASE, '.private')
DBPATH = os.path.join(PRIV, 'yanchi.db')
BACKUP = os.path.join(PRIV, 'backup')
DEVTOK = os.path.join(PRIV, 'dev.token')
TRASH = r'D:\yanchi-trash'
ARCHIVE = os.path.join(PRIV, 'archive')      # 每个账号一份操作存档（JSON Lines）
ARCHIVE_MAX = 4 * 1024 * 1024                # 单份存档超过 4 MB 就轮转成 .1
CONTENT = os.path.join(BASE, 'content')
LIBDIR = r'D:\CloudMusic\library'
SRCROOT = r'D:\CloudMusic'          # 曲库的源目录（重建清单时扫这里）

VERSION = '2.0'
# 运行中的代码指纹：重启后拿 /api/me 的 build 和磁盘上 serve.py 的哈希对一下就知有没有跑上新代码
try:
    BUILD = hashlib.sha256(open(os.path.abspath(__file__), 'rb').read()).hexdigest()[:8]
except Exception:
    BUILD = 'unknown'
COOKIE = 'yanchi_sid'
SESSION_DAYS = 30
SESSION_IDLE_HOURS = 12        # 闲置多久算掉线（手机端关浏览器未必清 Cookie，靠这条兜住）
PBKDF2_ITERS = 180000
MAX_BODY = 8 * 1024 * 1024
MAX_CONTENT = 4 * 1024 * 1024
CONTENT_NAMES = ('units', 'words', 'poems', 'prompts')
AUDIO_EXT = ('.flac', '.mp3', '.m4a', '.wav', '.ogg', '.aac', '.opus')
STARTED = time.time()

PUBLIC_PATHS = {
    '/login.html',
    '/assets/js/login.js',
    '/assets/css/auth.css',
    '/assets/css/glass.css',
    '/favicon.ico',
}
DENY_PATHS = {'/serve.py', '/README.md', '/_probe.html', '/tools'}

EXTRA_TYPES = {
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.opus': 'audio/ogg',
    '.webmanifest': 'application/manifest+json',
    '.json': 'application/json; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
}

# ---------------------------------------------------------------- 数据库
_local = threading.local()


def db():
    """每线程一条连接（ThreadingHTTPServer 下各线程独立，互不阻塞）。"""
    c = getattr(_local, 'conn', None)
    if c is None:
        os.makedirs(PRIV, exist_ok=True)
        c = sqlite3.connect(DBPATH, timeout=15)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA journal_mode=WAL')
        c.execute('PRAGMA busy_timeout=8000')
        _local.conn = c
    return c


SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login INTEGER,
  last_ip TEXT
);
CREATE TABLE IF NOT EXISTS sessions(
  tok TEXT PRIMARY KEY,
  uid INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen INTEGER,
  ip TEXT,
  ua TEXT
);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  name TEXT,
  action TEXT,
  detail TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS ix_audit_ts ON audit(ts DESC);
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT
);
"""


def init_db():
    c = db()
    c.executescript(SCHEMA)
    c.commit()


def now():
    return int(time.time())


# ---------------------------------------------------------------- 密码
def hash_pw(pw):
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), salt, PBKDF2_ITERS)
    return f'pbkdf2_sha256${PBKDF2_ITERS}${salt.hex()}${dk.hex()}'


def verify_pw(pw, stored):
    try:
        algo, iters, salt, want = stored.split('$')
        if algo != 'pbkdf2_sha256':
            return False
        dk = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), bytes.fromhex(salt), int(iters))
        return hmac.compare_digest(dk.hex(), want)
    except Exception:
        return False


def name_ok(n):
    return bool(n) and 2 <= len(n) <= 24 and not any(ch.isspace() or ch in ':/\\' for ch in n)


# ---------------------------------------------------------------- 用户 / 会话
def user_by_name(name):
    return db().execute('SELECT * FROM users WHERE name=?', (name,)).fetchone()


def user_by_id(uid):
    return db().execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()


def user_count():
    return db().execute('SELECT COUNT(*) n FROM users').fetchone()['n']


def admin_count(alive_only=True):
    q = "SELECT COUNT(*) n FROM users WHERE role='admin'" + (" AND disabled=0" if alive_only else "")
    return db().execute(q).fetchone()['n']


def create_user(name, pw, role='user'):
    c = db()
    cur = c.execute('INSERT INTO users(name,pw,role,disabled,created_at) VALUES(?,?,?,0,?)',
                    (name, hash_pw(pw), role, now()))
    c.commit()
    return cur.lastrowid


def set_pw(uid, pw):
    c = db()
    c.execute('UPDATE users SET pw=? WHERE id=?', (hash_pw(pw), uid))
    c.commit()


def audit(action, detail='', name=None, ip=None, ua=None, ev=None, archive=True):
    """审计表 + 该账号的存档文件各记一条（表用于后台速览，存档是给人看的完整轨迹）。"""
    try:
        c = db()
        c.execute('INSERT INTO audit(ts,name,action,detail,ip) VALUES(?,?,?,?,?)',
                  (now(), name, action, detail[:500], ip))
        c.commit()
    except Exception:
        pass
    # 匿名被门禁挡下的请求只留在审计表：公网被扫时不该灌满存档文件
    if archive and not (name is None and action == 'gate.deny'):
        archive_write(name or '（未登录）', ev or 'server', f'{action} · {detail}', ip, ua)


def new_session(uid, ip, ua):
    tok = secrets.token_urlsafe(32)
    h = hashlib.sha256(tok.encode()).hexdigest()
    t = now()
    c = db()
    c.execute('INSERT INTO sessions(tok,uid,created_at,expires_at,last_seen,ip,ua) VALUES(?,?,?,?,?,?,?)',
              (h, uid, t, t + SESSION_DAYS * 86400, t, ip, (ua or '')[:200]))
    c.commit()
    return tok


def session_user(tok):
    """令牌 → 用户；顺带刷新 last_seen（5 分钟一次，别每个请求都写库）。"""
    if not tok:
        return None
    h = hashlib.sha256(tok.encode()).hexdigest()
    c = db()
    r = c.execute("""SELECT s.tok, s.expires_at, s.last_seen, u.id, u.name, u.role, u.disabled
                     FROM sessions s JOIN users u ON u.id=s.uid WHERE s.tok=?""", (h,)).fetchone()
    if not r:
        return None
    if (r['disabled'] or r['expires_at'] < now()
            or (r['last_seen'] or 0) < now() - SESSION_IDLE_HOURS * 3600):
        c.execute('DELETE FROM sessions WHERE tok=?', (h,))
        c.commit()
        return None
    if (r['last_seen'] or 0) < now() - 300:
        c.execute('UPDATE sessions SET last_seen=? WHERE tok=?', (now(), h))
        c.commit()
    return {'id': r['id'], 'name': r['name'], 'role': r['role'], 'sid': r['tok']}


def drop_session(tok):
    c = db()
    c.execute('DELETE FROM sessions WHERE tok=?', (hashlib.sha256(tok.encode()).hexdigest(),))
    c.commit()


def drop_user_sessions(uid):
    c = db()
    c.execute('DELETE FROM sessions WHERE uid=?', (uid,))
    c.commit()


def dev_token():
    try:
        with open(DEVTOK, encoding='utf-8') as f:
            return f.read().strip() or None
    except OSError:
        return None


def ensure_dev_user():
    r = user_by_name('dev')
    if not r:
        uid = create_user('dev', secrets.token_urlsafe(24), 'admin')
        r = user_by_id(uid)
    return r


# ---------------------------------------------------------------- 设置项
def setting_get(key, default=None):
    r = db().execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return r['value'] if r else default


def setting_set(key, value):
    c = db()
    c.execute('INSERT INTO settings(key,value) VALUES(?,?) '
              'ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, str(value)))
    c.commit()


# ---------------------------------------------------------------- AI 老师（DeepSeek 代理）
# 密钥只落 .private/ai.json（.private/ 已在 .gitignore 里）：不进仓库、不进浏览器、不进共享库。
# 之所以必须走服务端代理：浏览器里放 Key 等于公开（任何访客 F12 就能抄走并刷你的余额）。
AICFG = os.path.join(PRIV, 'ai.json')
AI_DEFAULT_BASE = 'https://api.deepseek.com'
AI_DEFAULT_MODEL = 'deepseek-chat'
AI_TIMEOUT = 150          # 模型偶尔慢，给足；但客户端断开就立刻停
AI_MSG_MAX = 30           # 一次最多带多少条历史
AI_CHARS_MAX = 6000       # 单条消息上限
AI_TOTAL_MAX = 24000      # 整轮提示词上限
AI_RATE_MIN = 20          # 每分钟最多问几次
AI_DAY_MAX = 300          # 每人每天最多几轮（防跑飞账单）

AI_SYS = """你是「砚池」里的语文老师。砚池是一位学生自己用的语文学习工具：字词、古诗文、现代文阅读、写作。
回答请守住这几条：
1. 先给结论或一句点拨，再展开；能用三句说清就别写十条。
2. 讲字要讲本义、常见引申义，各配一个短例句；讲诗句先落在字面上，再讲它在全篇里的位置，不空谈意境。
3. 学生拿自己的句子或作文来改，只指出最值得改的一两处，说清错在哪、怎么改成更好，不要整篇代写。
4. 记不准的出处、作者年代、版本异文，直说「记不准」，不要编。
5. 用简体中文，语气像坐在旁边的老师：平和、具体，不夸张，不用表情符号，不用「亲」「宝子」这类称呼。
6. 不主动塞答题模板和套路；学生明确要考试技巧时再给。
7. 拿不准学生问的是哪段原文时，先问清，不要臆测。"""

_AI_HITS = {}             # uid -> [时间戳]，每分钟限流（进程内，重启即清）
_AI_DAY = {}              # uid -> [日期字符串, 次数]
_ai_lock = threading.Lock()


def ai_cfg():
    """读 AI 配置：.private/ai.json 优先，环境变量 DEEPSEEK_API_KEY 兜底。每次请求都读，改完即时生效。"""
    cfg = {'api_key': '', 'base_url': AI_DEFAULT_BASE, 'model': AI_DEFAULT_MODEL,
           'enabled': True, 'temperature': 0.6, 'max_tokens': 1200, 'system': ''}
    try:
        with open(AICFG, encoding='utf-8') as f:
            saved = json.load(f)
        if isinstance(saved, dict):
            for k in ('api_key', 'base_url', 'model', 'enabled', 'temperature', 'max_tokens', 'system'):
                if k in saved and saved[k] is not None:
                    cfg[k] = saved[k]
    except FileNotFoundError:
        pass
    except Exception as e:
        sys.stderr.write(f'[ai] 配置文件读不出来，用默认值：{e}\n')
    if not cfg.get('api_key'):
        cfg['api_key'] = os.environ.get('DEEPSEEK_API_KEY', '')
    cfg['enabled'] = bool(cfg['enabled'])
    cfg['max_tokens'] = max(64, min(4096, int(cfg.get('max_tokens') or 1200)))
    try:
        cfg['temperature'] = max(0.0, min(1.5, float(cfg.get('temperature', 0.6))))
    except Exception:
        cfg['temperature'] = 0.6
    cfg['base_url'] = (cfg.get('base_url') or AI_DEFAULT_BASE).rstrip('/')
    cfg['model'] = (cfg.get('model') or AI_DEFAULT_MODEL).strip()
    return cfg


def ai_save(patch):
    """合并写入 ai.json（原子替换 + 收紧权限）。空字符串表示「不改这个字段」。"""
    cur = {}
    try:
        with open(AICFG, encoding='utf-8') as f:
            cur = json.load(f) or {}
    except Exception:
        cur = {}
    if not isinstance(cur, dict):
        cur = {}
    for k in ('api_key', 'base_url', 'model', 'temperature', 'max_tokens', 'system', 'enabled'):
        if k in patch and patch[k] is not None:
            if k == 'api_key' and patch[k] == '':
                continue                     # 没填就保持原 Key，避免误清
            cur[k] = patch[k]
    if patch.get('clear_key'):
        cur['api_key'] = ''
    os.makedirs(PRIV, exist_ok=True)
    tmp = AICFG + '.tmp'
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(cur, f, ensure_ascii=False, indent=1)
    os.replace(tmp, AICFG)
    try:
        os.chmod(AICFG, 0o600)
    except Exception:
        pass
    return cur


def ai_status(cfg, admin=False):
    out = {'ok': True, 'ready': bool(cfg['api_key']) and cfg['enabled'],
           'enabled': cfg['enabled'], 'model': cfg['model'],
           'reason': ('' if cfg['api_key'] else '还没填 API Key') if cfg['enabled'] else 'AI 老师已关闭'}
    if admin:
        out['base_url'] = cfg['base_url']
        out['key_tail'] = cfg['api_key'][-4:] if cfg['api_key'] else ''
        out['max_tokens'] = cfg['max_tokens']
        out['temperature'] = cfg['temperature']
    return out


def ai_throttle(uid):
    """每人每分钟/每天限次。超了抛 429 —— 公网上一条被抄走的会话也不至于把余额刷穿。"""
    now = time.time()
    today = time.strftime('%Y-%m-%d')
    with _ai_lock:
        hits = [t for t in _AI_HITS.get(int(uid), []) if now - t < 60]
        if len(hits) >= AI_RATE_MIN:
            raise ApiError(429, f'问得有点急，喘口气再来（每分钟最多 {AI_RATE_MIN} 次）')
        hits.append(now)
        _AI_HITS[int(uid)] = hits
        day = _AI_DAY.get(int(uid))
        if not day or day[0] != today:
            day = [today, 0]
        if day[1] >= AI_DAY_MAX:
            _AI_DAY[int(uid)] = day
            raise ApiError(429, f'今天的额度用完了（{AI_DAY_MAX} 次），明天再来')
        day[1] += 1
        _AI_DAY[int(uid)] = day


def ai_error_text(code, raw):
    """把上游错误翻成学生看得懂的一句话（不泄露 Key，也不吐整段 JSON）。"""
    msg = ''
    try:
        j = json.loads(raw)
        msg = str((j.get('error') or {}).get('message') or j.get('message') or '')
    except Exception:
        msg = (raw or '')[:200]
    if code in (401, 403):
        return 'API Key 不对或没有权限（管理员在「设置 → AI 老师」里核对一下）'
    if code == 402:
        return 'DeepSeek 账户余额不够了，充值后再试'
    if code == 429:
        return 'DeepSeek 那边说请求太频繁，等几秒再问'
    if code == 404:
        return '模型名或接口地址不对：' + (msg or 'HTTP 404')
    if code == 400:
        return '这次的请求被拒了：' + (msg or 'HTTP 400')
    if code >= 500:
        return 'DeepSeek 服务端出错了（HTTP %d），过一会儿再试' % code
    return (msg or '上游返回 HTTP %d' % code)[:220]


# ---------------------------------------------------------------- 操作存档（每个账号一份）
# 文件：.private/archive/<账号>.jsonl —— 一行一条，JSON Lines，字段固定：
#   t   Unix 秒（服务端收到的时间）      ts  本地时间字符串（人看的）
#   u   账号名                           ev  事件码
#   d   详情（自由文本，最多 600 字）     ip  来源地址
#   ua  浏览器标识前 120 字
# 服务端事件（登录、后台改动…）与前端上报（进了哪一页、点了什么…）写进同一个文件，
# 按 t 排序即可还原这个人在站内的完整轨迹；单份超过 4 MB 轮转成 <账号>.1.jsonl（只留一代）。
def safe_user(name):
    n = re.sub(r'[^\w\u4e00-\u9fff.-]', '_', str(name or '')).strip('._')[:40]
    return n or 'anonymous'


def archive_path(name):
    return os.path.join(ARCHIVE, safe_user(name) + '.jsonl')


def archive_write(who, ev, detail='', ip=None, ua=None):
    try:
        os.makedirs(ARCHIVE, exist_ok=True)
        p = archive_path(who)
        if os.path.exists(p) and os.path.getsize(p) > ARCHIVE_MAX:
            os.replace(p, p[:-6] + '.1.jsonl')
        line = json.dumps({'t': now(), 'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
                           'u': str(who or ''), 'ev': str(ev or ''),
                           'd': str(detail or '')[:600], 'ip': ip or '',
                           'ua': (ua or '')[:120]}, ensure_ascii=False)
        with open(p, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass


def archive_files():
    out = []
    if os.path.isdir(ARCHIVE):
        for x in sorted(os.listdir(ARCHIVE)):
            if not x.endswith('.jsonl'):
                continue
            p = os.path.join(ARCHIVE, x)
            try:
                n = 0
                with open(p, encoding='utf-8', errors='ignore') as f:
                    for _ in f:
                        n += 1
                out.append({'user': x[:-6], 'file': x, 'lines': n,
                            'bytes': os.path.getsize(p), 'mtime': int(os.path.getmtime(p))})
            except OSError:
                pass
    out.sort(key=lambda r: -r['mtime'])
    return out


def archive_tail(name, n=200):
    p = archive_path(name)
    if not os.path.isfile(p):
        raise ApiError(404, '没有这个账号的存档')
    with open(p, encoding='utf-8', errors='ignore') as f:
        lines = [l.rstrip('\n') for l in f]
    return lines[-max(1, n):]


# ---------------------------------------------------------------- 上报限速（前端活动）
ACT = {}
ACT_WINDOW = 60
ACT_MAX = 30          # 每个会话每分钟最多 30 批


def activity_over(me):
    key = me.get('sid') or me.get('name') or '?'
    with LOCK:
        rec = [t for t in ACT.get(key, []) if t > time.time() - ACT_WINDOW]
        if len(rec) >= ACT_MAX:
            ACT[key] = rec
            return True
        rec.append(time.time())
        ACT[key] = rec
    return False

# ---------------------------------------------------------------- 曲库
def read_manifest():
    try:
        with open(os.path.join(CONTENT, 'music.json'), encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'count': 0, 'total': 0, 'tracks': []}


def write_manifest():
    """只扫库目录重写 content/music.json —— 与 tools/build-library.py 第 4 步同格式。"""
    rows = []
    if os.path.isdir(LIBDIR):
        for f in sorted(os.listdir(LIBDIR)):
            p = os.path.join(LIBDIR, f)
            if not os.path.isfile(p) or os.path.splitext(f)[1].lower() not in AUDIO_EXT:
                continue
            stem = os.path.splitext(f)[0]
            artist, title = '', stem
            if ' - ' in stem:
                artist, title = stem.split(' - ', 1)
                artist, title = artist.strip(), title.strip()
            rows.append({'file': f, 'title': title, 'artist': artist,
                         'size': os.path.getsize(p), 'ext': os.path.splitext(f)[1][1:].lower()})
    man = {'count': len(rows), 'total': sum(r['size'] for r in rows), 'tracks': rows}
    tmp = os.path.join(CONTENT, 'music.json.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(man, f, ensure_ascii=False, indent=1)
    os.replace(tmp, os.path.join(CONTENT, 'music.json'))
    return man


def walk_src():
    """曲库源目录里的音频（跳过 library 自身，避免把硬链接当源）。"""
    for d, dirs, fs in os.walk(SRCROOT):
        dirs[:] = [x for x in dirs if os.path.join(d, x) != LIBDIR]
        for f in fs:
            if os.path.splitext(f)[1].lower() in AUDIO_EXT:
                yield os.path.join(d, f)


# ---------------------------------------------------------------- 内容文件
class ApiError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code
        self.msg = msg


def content_path(name):
    if name not in CONTENT_NAMES:
        raise ApiError(400, '不认识的内容文件')
    return os.path.join(CONTENT, name + '.json')


def read_content(name):
    with open(content_path(name), encoding='utf-8') as f:
        return json.load(f)


def count_items(data):
    if isinstance(data, list):
        return len(data)
    if isinstance(data, dict):
        for v in data.values():
            if isinstance(v, list):
                return len(v)
    return None


def save_content(name, data, actor, ip):
    """备份 → 原子替换。备份留在 .private/backup/，最多 10 份。"""
    raw = json.dumps(data, ensure_ascii=False, indent=1)
    if len(raw.encode('utf-8')) > MAX_CONTENT:
        raise ApiError(413, '内容超过 4 MB 上限')
    os.makedirs(BACKUP, exist_ok=True)
    p = content_path(name)
    if os.path.exists(p):
        try:
            shutil.copy2(p, os.path.join(BACKUP, f'{name}.{now()}.json'))
        except OSError:
            pass
        olds = sorted([x for x in os.listdir(BACKUP) if x.startswith(name + '.')])
        for x in olds[:-10]:
            try:
                os.remove(os.path.join(BACKUP, x))
            except OSError:
                pass
    tmp = p + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(raw)
    os.replace(tmp, p)
    audit('content.save', f'{name} · {count_items(data)} 条 · {len(raw.encode("utf-8"))} B', actor, ip)
    return {'count': count_items(data), 'bytes': len(raw.encode('utf-8'))}


# ---------------------------------------------------------------- 登录失败限速
FAILS = {}
LOCK = threading.Lock()
WINDOW = 600
MAX_FAIL = 5


def locked_for(key):
    with LOCK:
        rec = FAILS.get(key)
        if not rec:
            return 0
        rec = [t for t in rec if t > time.time() - WINDOW]
        FAILS[key] = rec
        if len(rec) >= MAX_FAIL:
            return int(WINDOW - (time.time() - rec[-1])) + 1
    return 0


def note_fail(key):
    with LOCK:
        FAILS.setdefault(key, []).append(time.time())


def clear_fail(key):
    with LOCK:
        FAILS.pop(key, None)


# ---------------------------------------------------------------- 请求处理
class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'YanChi/2.0'

    # ---- 基础工具 ----
    def client_ip(self):
        fwd = self.headers.get('X-Forwarded-For') or self.headers.get('CF-Connecting-IP')
        if fwd:
            return fwd.split(',')[0].strip()
        return self.client_address[0] if self.client_address else '-'

    def user(self):
        """当前登录用户。

        注意：一个 handler 实例会服务**同一条 keep-alive 连接上的多个请求**，所以
        **绝不能把结果缓存在 self 上**——按实例缓存会让登录前后的身份串在一起
        （真实症状：普通账号登录后显示成管理员；刚登录又被当成未登录 → 弹回登录页、
        内容清单 401）。也正因为不缓存，闲置过期/踢下线/禁用才会立刻生效。
        库里就一条带索引的 SELECT，比这类 bug 便宜得多。"""
        ck = SimpleCookie(self.headers.get('Cookie'))
        m = ck.get(COOKIE)
        u = session_user(m.value) if m else None
        if not u:
            tok = self.headers.get('X-Yanchi-Dev')
            dt = dev_token()
            if tok and dt and hmac.compare_digest(tok, dt):
                r = ensure_dev_user()
                u = {'id': r['id'], 'name': 'dev', 'role': 'admin', 'sid': 'dev'}
        return u

    def send_json(self, obj, code=200, cookie=None):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def redirect(self, to, cookie=None):
        self.send_response(302)
        self.send_header('Location', to)
        self.send_header('Content-Length', '0')
        self.send_header('Cache-Control', 'no-store')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()

    def cookie_for(self, tok):
        # 会话级 Cookie：**不写 Max-Age**，关掉浏览器就没了（用户反馈「关了浏览器还一直登录着」）。
        # 服务端仍保留 30 天上限，只用于清理陈旧会话行。
        return f'{COOKIE}={tok}; Path=/; HttpOnly; SameSite=Lax'

    def killed_cookie(self):
        return f'{COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'

    def read_json(self):
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            n = 0
        if n <= 0:
            return {}
        if n > MAX_BODY:
            raise ApiError(413, '请求体过大')
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode('utf-8'))
        except Exception:
            raise ApiError(400, '请求体不是合法 JSON')

    # ---- 门禁 ----
    def deny(self, path):
        segs = [s for s in path.split('/') if s]
        if any(s.startswith('.') for s in segs):
            return True
        if path in DENY_PATHS or path.startswith('/tools/'):
            return True
        if path.lower().endswith(('.bat', '.cmd', '.py', '.md')):
            return True
        return False

    def gate(self, path):
        """返回 True 表示放行；否则已写好响应。"""
        if self.deny(path):
            self.send_error(404, 'Not Found')
            return False
        if path in PUBLIC_PATHS:
            return True
        if self.user():
            return True
        # .html 也算“文档”：否则未登录访问 /index.html 会拿到一坨 401 JSON 而不是跳登录页
        is_doc = path == '/' or path.endswith('.html') or not os.path.splitext(path)[1]
        if is_doc:
            audit('gate.deny', path, None, self.client_ip())
            self.redirect('/login.html?next=' + path)
        else:
            self.send_json({'ok': False, 'error': '未登录'}, 401)
        return False

    # ---- 静态 ----
    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        if ext in EXTRA_TYPES:
            return EXTRA_TYPES[ext]
        return mimetypes.guess_type(path)[0] or 'application/octet-stream'

    def list_directory(self, path):
        self.send_error(404, 'Not Found')
        return None

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            for idx in ('index.html', 'index.htm'):
                cand = os.path.join(path, idx)
                if os.path.isfile(cand):
                    path = cand
                    break
            else:
                self.send_error(404, 'Not Found')
                return None
        if not os.path.isfile(path):
            self.send_error(404, 'Not Found')
            return None
        try:
            f = open(path, 'rb')
        except OSError:
            self.send_error(404, 'Not Found')
            return None

        fs = os.fstat(f.fileno())
        size = fs.st_size
        ctype = self.guess_type(path)

        # Range：音频边下边播、拖进度条
        start, end, partial = 0, size - 1, False
        rng = self.headers.get('Range')
        if rng and rng.startswith('bytes=') and size > 0:
            spec = rng[len('bytes='):].split(',')[0].strip()
            try:
                if spec.startswith('-'):
                    start = max(0, size - int(spec[1:]))
                else:
                    a, _, b = spec.partition('-')
                    start = int(a)
                    if b.strip():
                        end = min(int(b), size - 1)
                if 0 <= start <= end < size:
                    partial = True
                else:
                    f.close()
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{size}')
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return None
            except ValueError:
                pass

        self.send_response(206 if partial else 200)
        self.send_header('Content-Type', ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Last-Modified', self.date_time_string(fs.st_mtime))
        self.send_header('X-Content-Type-Options', 'nosniff')
        # 页面与内容清单不缓存：后台改完刷新即见，登出后也不留可读缓存
        _ext = os.path.splitext(path)[1].lower()
        if path.endswith(('.html', '.json')):
            _cc = 'no-store'
        elif _ext in ('.css', '.js', '.mjs'):
            # 自己改样式/脚本时，手机上不该等一小时缓存过期：每次都带 Last-Modified 校验
            _cc = 'no-cache'
        else:
            _cc = 'private, max-age=3600'          # 音频、图片、字体照旧缓存
        self.send_header('Cache-Control', _cc)
        self.send_header('ETag', '"%d-%d"' % (int(fs.st_mtime), size))
        if partial:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.send_header('Content-Length', str(end - start + 1))
        else:
            self.send_header('Content-Length', str(size))
        self.end_headers()

        if partial:
            if self.command != 'HEAD':
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(256 * 1024, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
            f.close()
            return None
        return f

    # ---- 入口 ----
    def do_GET(self):
        u = urlparse(self.path)
        if u.path.startswith('/api/'):
            return self.api('GET', u.path)
        # 自检直通：?dev=<token> → 自动登录并抹掉该参数
        qs = parse_qs(u.query, keep_blank_values=True)
        if 'dev' in qs:
            dt = dev_token()
            if dt and hmac.compare_digest(qs['dev'][0], dt):
                r = ensure_dev_user()
                s = new_session(r['id'], self.client_ip(), 'dev-token')
                rest = {k: v[0] for k, v in qs.items() if k != 'dev'}
                q = urlencode(rest)
                self.redirect(u.path + (('?' + q) if q else ''), cookie=self.cookie_for(s))
                return
        if not self.gate(u.path):
            return
        super().do_GET()

    def do_HEAD(self):
        u = urlparse(self.path)
        if u.path.startswith('/api/'):
            return self.api('HEAD', u.path)
        if not self.gate(u.path):
            return
        super().do_HEAD()

    def do_POST(self):
        self.api('POST', urlparse(self.path).path)

    # ---- 接口 ----
    def api(self, method, path):
        try:
            if method == 'POST':
                # CSRF：跨站表单无法自定义这个头
                if self.headers.get('X-Requested-With') != 'yanchi-fetch':
                    raise ApiError(403, '缺少 X-Requested-With 头')
                org = self.headers.get('Origin')
                if org:
                    host = (urlparse(org).netloc or '').lower()
                    if host and host != (self.headers.get('Host') or '').lower():
                        raise ApiError(403, '来源不匹配')
            body = self.read_json() if method == 'POST' else {}
        except ApiError as e:
            audit('gate.deny', f'{path} · {e.msg}', None, self.client_ip())
            return self.send_json({'ok': False, 'error': e.msg}, e.code)

        ip = self.client_ip()
        ua = self.headers.get('User-Agent', '')
        me = self.user()
        try:
            # AI 老师自己写响应（流式），不走 route() 的 JSON 返回
            if method == 'POST' and path == '/api/ai/chat':
                return self.ai_chat(body, me, ip, ua)
            res, code, cookie = self.route(method, path, body, me, ip, ua)
        except ApiError as e:
            return self.send_json({'ok': False, 'error': e.msg}, e.code)
        except Exception as e:                      # 兜底：500 也不吐堆栈
            audit('error', f'{path} · {e}', me and me['name'], ip)
            return self.send_json({'ok': False, 'error': f'服务器内部错误：{e}'}, 500)
        return self.send_json(res, code, cookie)

    def need_admin(self, me):
        if not me:
            raise ApiError(401, '请先登录')
        if me['role'] != 'admin':
            raise ApiError(403, '需要管理员权限')
        return me

    # ---- AI 老师：DeepSeek 代理（密钥不出服务端） ----
    def ai_prompt(self, body, cfg):
        """洗一遍前端来的消息，拼上服务端系统提示词。客户端永远无法注入 system。"""
        raw = body.get('messages')
        if not isinstance(raw, list) or not raw:
            raise ApiError(400, '没有要问的内容')
        msgs, total = [], 0
        for m in raw[-AI_MSG_MAX:]:
            if not isinstance(m, dict):
                continue
            role, content = m.get('role'), m.get('content')
            if role not in ('user', 'assistant') or not isinstance(content, str):
                continue
            content = content.strip()
            if not content:
                continue
            if len(content) > AI_CHARS_MAX:
                content = content[:AI_CHARS_MAX] + '…'
            total += len(content)
            msgs.append({'role': role, 'content': content})
        if not msgs or msgs[-1]['role'] != 'user':
            raise ApiError(400, '最后一条得是你的问题')
        if total > AI_TOTAL_MAX:
            raise ApiError(413, '这一段太长了，分几次问吧')
        sys_txt = AI_SYS
        if (cfg.get('system') or '').strip():
            sys_txt += '\n\n【这位学生的额外交代】' + str(cfg['system']).strip()[:1200]
        ctx = body.get('context') if isinstance(body.get('context'), dict) else {}
        page = str(ctx.get('page') or '').strip()[:40]
        sel = str(ctx.get('selection') or '').strip()[:400]
        bits = []
        if page:
            bits.append('学生此刻在「%s」页。' % page)
        if sel:
            bits.append('页面上被选中的原文是：\n"""\n%s\n"""\n'
                        '（学生说的「这段」「这句」多半指它，可以据此理解。）' % sel)
        if bits:
            sys_txt += '\n\n【此刻的上下文】' + ''.join(bits)
        return [{'role': 'system', 'content': sys_txt}] + msgs

    def sse(self, obj):
        """写一条 SSE 事件；客户端已经断开就返回 False（不要再读上游了）。"""
        try:
            self.wfile.write(b'data: ' + json.dumps(obj, ensure_ascii=False).encode('utf-8') + b'\n\n')
            self.wfile.flush()
            return True
        except (BrokenPipeError, ConnectionResetError, OSError):
            return False

    def ai_chat(self, body, me, ip, ua):
        """POST /api/ai/chat：校验 → 限流 → 转发 DeepSeek → 流式回吐。自己写响应，返回 None。"""
        if not me:
            raise ApiError(401, '请先登录')
        cfg = ai_cfg()
        if not cfg['enabled']:
            raise ApiError(503, 'AI 老师现在是关着的（管理员可在「设置 → AI 老师」里打开）')
        if not cfg['api_key']:
            raise ApiError(503, '还没填 DeepSeek 的 API Key（管理员在「设置 → AI 老师」里填一次即可）')
        prompt = self.ai_prompt(body, cfg)
        ai_throttle(me['id'])
        want_stream = body.get('stream') is not False
        q_prev = prompt[-1]['content'].replace('\n', ' ')[:80]

        payload = {'model': cfg['model'], 'messages': prompt, 'stream': want_stream,
                   'temperature': cfg['temperature'], 'max_tokens': cfg['max_tokens']}
        req = urllib.request.Request(
            cfg['base_url'] + '/chat/completions',
            data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
            headers={'Content-Type': 'application/json',
                     'Accept': 'text/event-stream' if want_stream else 'application/json',
                     'Authorization': 'Bearer ' + cfg['api_key']},
            method='POST')
        try:
            resp = urllib.request.urlopen(req, timeout=AI_TIMEOUT)
        except urllib.error.HTTPError as e:
            txt = ai_error_text(e.code, e.read().decode('utf-8', 'replace'))
            audit('ai.fail', f'HTTP {e.code} · {txt} · 问：{q_prev}', me['name'], ip, ua)
            raise ApiError(e.code if e.code in (400, 401, 402, 404, 429) else 502, txt)
        except Exception as e:
            audit('ai.fail', f'{type(e).__name__}: {e} · 问：{q_prev}', me['name'], ip, ua)
            raise ApiError(502, f'连不上 DeepSeek（{type(e).__name__}），先看看本机网络')

        # 非流式：给命令行 / 自检用，一条 JSON 拿全部答案
        if not want_stream:
            raw = resp.read().decode('utf-8', 'replace')
            resp.close()
            try:
                j = json.loads(raw)
                answer = j['choices'][0]['message']['content']
            except Exception:
                text = ai_error_text(502, raw)
                audit('ai.fail', f'解析失败 · {text}', me['name'], ip, ua)
                raise ApiError(502, text)
            audit('ai.chat', f'问：{q_prev} · 答 {len(answer)} 字 · {cfg["model"]}', me['name'], ip, ua)
            return self.send_json({'ok': True, 'answer': answer, 'model': cfg['model']})

        # 流式：上游 SSE → 逐段转发（前端边收边显示，不用干等十几秒）
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Accel-Buffering', 'no')
        self.send_header('Connection', 'close')       # 没有 Content-Length，HTTP/1.1 只能断开收尾
        self.end_headers()
        self.close_connection = True

        parts, alive, err = [], True, ''
        try:
            for raw_line in resp:
                line = raw_line.decode('utf-8', 'replace').strip()
                if not line.startswith('data:'):
                    continue
                data = line[5:].strip()
                if not data:
                    continue
                if data == '[DONE]':
                    break
                try:
                    ev = json.loads(data)
                except Exception:
                    continue
                if ev.get('error'):
                    err = ai_error_text(502, json.dumps(ev, ensure_ascii=False))
                    break
                for ch in (ev.get('choices') or []):
                    delta = (ch.get('delta') or {}).get('content')
                    if delta:
                        parts.append(delta)
                        if not self.sse({'delta': delta}):
                            alive = False
                            break
                if not alive:
                    break
        except (BrokenPipeError, ConnectionResetError):
            alive = False
        except Exception as e:
            err = f'读到一半断了（{type(e).__name__}）'
        finally:
            try:
                resp.close()
            except Exception:
                pass

        answer = ''.join(parts)
        if alive:
            self.sse({'error': err} if err else {'done': True, 'chars': len(answer),
                                                 'model': cfg['model']})
        audit('ai.chat' if answer else 'ai.fail',
              f'问：{q_prev} · 答 {len(answer)} 字' + (f' · {err}' if err else '')
              + ('' if alive else ' · 客户端提前断开'),
              me['name'], ip, ua)
        return None

    def route(self, method, path, body, me, ip, ua):
        # ---------------- 公开 ----------------
        if path == '/api/me':
            detail = None
            if me:
                r = user_by_id(me['id'])
                detail = {'id': r['id'], 'name': r['name'], 'role': r['role'], 'last_login': r['last_login']}
            return {'ok': True, 'user': detail, 'setup': user_count() == 0,
                    'register': setting_get('allow_register', '1') == '1',
                    'version': VERSION, 'build': BUILD}, 200, None

        if path == '/api/setup' and method == 'POST':
            if user_count() > 0:
                raise ApiError(409, '已经初始化过了，请直接登录')
            name = str(body.get('name') or '').strip()
            pw = str(body.get('password') or '')
            if not name_ok(name):
                raise ApiError(400, '用户名需 2–24 字符，且不含空格与 : / \\')
            if len(pw) < 6:
                raise ApiError(400, '密码至少 6 位')
            uid = create_user(name, pw, 'admin')
            tok = new_session(uid, ip, ua)
            audit('setup', name, name, ip)
            return {'ok': True, 'user': {'id': uid, 'name': name, 'role': 'admin'}}, 200, self.cookie_for(tok)

        if path == '/api/login' and method == 'POST':
            name = str(body.get('name') or '').strip()
            pw = str(body.get('password') or '')
            key = name.lower()
            wait = locked_for(key)
            if wait:
                audit('login.lock', f'{name} · 还要等 {wait}s', name, ip)
                raise ApiError(429, f'尝试次数太多，请 {max(1, wait // 60)} 分钟后再试')
            r = user_by_name(name)
            if not r or r['disabled'] or not verify_pw(pw, r['pw']):
                note_fail(key)
                # 账号不存在时只记审计表，不建存档文件：否则乱试用户名就能造出一堆空文件
                audit('login.fail', name, name if r else None, ip, archive=bool(r))
                raise ApiError(401, '用户名或密码不正确')
            clear_fail(key)
            c = db()
            c.execute('UPDATE users SET last_login=?, last_ip=? WHERE id=?', (now(), ip, r['id']))
            c.commit()
            tok = new_session(r['id'], ip, ua)
            audit('login.ok', name, name, ip)
            return {'ok': True, 'user': {'id': r['id'], 'name': r['name'], 'role': r['role']}}, 200, self.cookie_for(tok)

        if path == '/api/logout' and method == 'POST':
            if me:
                drop_session(me['sid'])
                audit('logout', me['name'], me['name'], ip)
            return {'ok': True}, 200, self.killed_cookie()

        # ---------------- 需登录 ----------------
        if path == '/api/password' and method == 'POST':
            if not me:
                raise ApiError(401, '请先登录')
            old, new = str(body.get('old') or ''), str(body.get('new') or '')
            r = user_by_id(me['id'])
            if not verify_pw(old, r['pw']):
                audit('passwd.fail', me['name'], me['name'], ip)
                raise ApiError(400, '原密码不正确')
            if len(new) < 6:
                raise ApiError(400, '新密码至少 6 位')
            set_pw(me['id'], new)
            drop_user_sessions(me['id'])
            audit('passwd.self', me['name'], me['name'], ip)
            return {'ok': True, 'relogin': True}, 200, self.killed_cookie()

        if path == '/api/register' and method == 'POST':
            if setting_get('allow_register', '1') != '1':
                raise ApiError(403, '站长关掉了自助注册，找管理员开一个账号吧')
            name = str(body.get('name') or '').strip()
            pw = str(body.get('password') or '')
            if not name_ok(name):
                raise ApiError(400, '用户名需 2–24 字符，且不含空格与 : / \\')
            if len(pw) < 6:
                raise ApiError(400, '密码至少 6 位')
            if user_by_name(name):
                raise ApiError(409, '这个用户名已经有人用了')
            rkey = 'reg:' + ip
            if locked_for(rkey):
                raise ApiError(429, '这个网络注册得太频繁了，稍后再试')
            note_fail(rkey)
            uid = create_user(name, pw, 'user')
            tok = new_session(uid, ip, ua)
            audit('register', f'{name} · 自助注册', name, ip, ua, ev='register')
            return {'ok': True, 'user': {'id': uid, 'name': name, 'role': 'user'}}, 201, self.cookie_for(tok)

        if path == '/api/activity' and method == 'POST':
            if not me:
                raise ApiError(401, '请先登录')
            evs = body.get('events')
            if not isinstance(evs, list) or not evs:
                raise ApiError(400, 'events 必须是非空数组')
            if len(evs) > 200:
                raise ApiError(413, '一次最多上报 200 条')
            if activity_over(me):
                raise ApiError(429, '上报太频繁')
            taken = 0
            for e in evs[:200]:
                if not isinstance(e, dict):
                    continue
                ev = str(e.get('ev') or '').strip()[:40]
                if not ev:
                    continue
                d = e.get('d')
                if not isinstance(d, str):
                    d = json.dumps(d, ensure_ascii=False) if d is not None else ''
                archive_write(me['name'], ev, d, ip, ua)
                taken += 1
            return {'ok': True, 'taken': taken}, 200, None

        # ---------------- AI 老师 ----------------
        if path == '/api/ai/status' and method == 'GET':
            if not me:
                raise ApiError(401, '请先登录')
            return ai_status(ai_cfg(), admin=me['role'] == 'admin'), 200, None

        if not path.startswith('/api/admin/'):
            raise ApiError(404, '没有这个接口')

        # ---------------- 后台 ----------------
        if path == '/api/admin/ai' and method == 'GET':
            self.need_admin(me)
            return ai_status(ai_cfg(), admin=True), 200, None

        if path == '/api/admin/ai' and method == 'POST':
            self.need_admin(me)
            patch = {}
            if 'api_key' in body:
                k = str(body.get('api_key') or '').strip()
                if k and (not k.startswith('sk-') or len(k) < 20):
                    raise ApiError(400, 'DeepSeek 的 Key 一般以 sk- 开头，再核对一下')
                patch['api_key'] = k
            if 'model' in body:
                m = str(body.get('model') or '').strip()
                if not m or len(m) > 60 or not re.match(r'^[A-Za-z0-9._:-]+$', m):
                    raise ApiError(400, '模型名只能是字母数字和 . _ : -')
                patch['model'] = m
            if 'base_url' in body:
                b = str(body.get('base_url') or '').strip().rstrip('/')
                if b and not b.startswith(('https://', 'http://')):
                    raise ApiError(400, '接口地址要以 http:// 或 https:// 开头')
                patch['base_url'] = b or AI_DEFAULT_BASE
            if 'enabled' in body:
                patch['enabled'] = bool(body['enabled'])
            if 'clear_key' in body:
                patch['clear_key'] = bool(body['clear_key'])
            if 'system' in body:
                patch['system'] = str(body.get('system') or '')[:1200]
            if 'max_tokens' in body:
                try:
                    patch['max_tokens'] = int(body['max_tokens'])
                except Exception:
                    raise ApiError(400, 'max_tokens 要是整数')
            if 'temperature' in body:
                try:
                    patch['temperature'] = float(body['temperature'])
                except Exception:
                    raise ApiError(400, 'temperature 要是数字')
            ai_save(patch)
            cfg = ai_cfg()
            said = []
            if 'api_key' in patch:
                said.append('Key ' + ('已更新' if patch['api_key'] else '未改'))
            if 'clear_key' in patch and patch['clear_key']:
                said.append('Key 已清除')
            if 'model' in patch:
                said.append('模型 → ' + patch['model'])
            if 'enabled' in patch:
                said.append('开关 → ' + ('开' if patch['enabled'] else '关'))
            if 'base_url' in patch:
                said.append('地址 → ' + patch['base_url'])
            audit('ai.config', '；'.join(said) or '无变化', me['name'], ip, ua)
            return ai_status(cfg, admin=True), 200, None

        if path == '/api/admin/overview':
            self.need_admin(me)
            man = read_manifest()
            u = db().execute('SELECT COUNT(*) t, SUM(disabled=0) e, SUM(role="admin") a FROM users').fetchone()
            disk = []
            for d in ('C:\\', 'D:\\'):
                try:
                    t = shutil.disk_usage(d)
                    disk.append({'name': d[:2], 'free': t.free, 'total': t.total})
                except OSError:
                    pass
            logins = [dict(r) for r in db().execute(
                'SELECT name, last_login, last_ip FROM users WHERE last_login IS NOT NULL '
                'ORDER BY last_login DESC LIMIT 8')]
            return {'ok': True,
                    'site': {'version': VERSION, 'python': sys.version.split()[0],
                             'uptime': int(time.time() - STARTED), 'started_at': int(STARTED),
                             'dev_open': bool(dev_token())},
                    'tracks': {'count': man.get('count', 0), 'total': man.get('total', 0)},
                    'users': {'total': u['t'] or 0, 'enabled': u['e'] or 0, 'admins': u['a'] or 0},
                    'sessions': {'active': db().execute(
                        'SELECT COUNT(*) n FROM sessions WHERE expires_at>?', (now(),)).fetchone()['n']},
                    'disk': disk, 'logins': logins}, 200, None

        if path == '/api/admin/users' and method == 'GET':
            self.need_admin(me)
            rows = db().execute("""SELECT u.id,u.name,u.role,u.disabled,u.created_at,u.last_login,u.last_ip,
                                   (SELECT COUNT(*) FROM sessions s WHERE s.uid=u.id AND s.expires_at>?) online
                                   FROM users u ORDER BY u.id""", (now(),)).fetchall()
            return {'ok': True, 'users': [{'id': r['id'], 'name': r['name'], 'role': r['role'],
                                           'disabled': bool(r['disabled']), 'created_at': r['created_at'],
                                           'last_login': r['last_login'], 'last_ip': r['last_ip'],
                                           'online': bool(r['online'])} for r in rows]}, 200, None

        if path == '/api/admin/users' and method == 'POST':
            self.need_admin(me)
            name = str(body.get('name') or '').strip()
            pw = str(body.get('password') or '')
            role = 'admin' if body.get('role') == 'admin' else 'user'
            if not name_ok(name):
                raise ApiError(400, '用户名需 2–24 字符，且不含空格与 : / \\')
            if len(pw) < 6:
                raise ApiError(400, '密码至少 6 位')
            if user_by_name(name):
                raise ApiError(409, '这个用户名已经存在')
            uid = create_user(name, pw, role)
            audit('user.add', f'{name} · {role}', me['name'], ip)
            return {'ok': True, 'id': uid}, 201, None

        if path == '/api/admin/users/update' and method == 'POST':
            self.need_admin(me)
            r = user_by_id(int(body.get('id') or 0))
            if not r:
                raise ApiError(404, '没有这个账号')
            changes = []
            if 'role' in body:
                role = 'admin' if body['role'] == 'admin' else 'user'
                if role != 'admin' and r['role'] == 'admin' and admin_count() <= 1:
                    raise ApiError(409, '这是最后一个管理员，不能降级')
                db().execute('UPDATE users SET role=? WHERE id=?', (role, r['id']))
                changes.append('角色→' + role)
            if 'disabled' in body:
                dis = 1 if body['disabled'] else 0
                if dis and r['role'] == 'admin' and admin_count() <= 1:
                    raise ApiError(409, '这是最后一个管理员，不能停用')
                if dis and r['id'] == me['id']:
                    raise ApiError(409, '不能停用自己')
                db().execute('UPDATE users SET disabled=? WHERE id=?', (dis, r['id']))
                if dis:
                    drop_user_sessions(r['id'])
                changes.append('停用' if dis else '启用')
            if body.get('password'):
                pw = str(body['password'])
                if len(pw) < 6:
                    raise ApiError(400, '密码至少 6 位')
                set_pw(r['id'], pw)
                drop_user_sessions(r['id'])
                changes.append('改密')
            db().commit()
            audit('user.update', f"{r['name']} · {'、'.join(changes) or '无变化'}", me['name'], ip)
            return {'ok': True}, 200, None

        if path == '/api/admin/users/delete' and method == 'POST':
            self.need_admin(me)
            r = user_by_id(int(body.get('id') or 0))
            if not r:
                raise ApiError(404, '没有这个账号')
            if r['id'] == me['id']:
                raise ApiError(409, '不能删掉当前登录的账号')
            if r['role'] == 'admin' and admin_count() <= 1:
                raise ApiError(409, '这是最后一个管理员，不能删')
            drop_user_sessions(r['id'])
            db().execute('DELETE FROM users WHERE id=?', (r['id'],))
            db().commit()
            audit('user.delete', r['name'], me['name'], ip)
            return {'ok': True}, 200, None

        if path == '/api/admin/content' and method == 'GET':
            self.need_admin(me)
            files = []
            for n in CONTENT_NAMES:
                p = content_path(n)
                if not os.path.exists(p):
                    continue
                try:
                    cnt = count_items(read_content(n))
                except Exception:
                    cnt = None
                bks = os.listdir(BACKUP) if os.path.isdir(BACKUP) else []
                files.append({'name': n, 'size': os.path.getsize(p), 'count': cnt,
                              'mtime': int(os.path.getmtime(p)),
                              'backups': len([x for x in bks if x.startswith(n + '.')])})
            return {'ok': True, 'files': files}, 200, None

        if path == '/api/admin/content/get' and method == 'GET':
            self.need_admin(me)
            qs = parse_qs(urlparse(self.path).query)
            name = (qs.get('name') or [''])[0]
            data = read_content(name)
            bks = []
            if os.path.isdir(BACKUP):
                for x in sorted([x for x in os.listdir(BACKUP) if x.startswith(name + '.')], reverse=True):
                    bks.append({'file': x, 'ts': int(os.path.getmtime(os.path.join(BACKUP, x))),
                                'size': os.path.getsize(os.path.join(BACKUP, x))})
            return {'ok': True, 'name': name, 'data': data, 'backups': bks}, 200, None

        if path == '/api/admin/content/save' and method == 'POST':
            self.need_admin(me)
            name = str(body.get('name') or '')
            if 'data' not in body:
                raise ApiError(400, '缺少 data')
            r = save_content(name, body['data'], me['name'], ip)
            return {'ok': True, **r}, 200, None

        if path == '/api/admin/content/restore' and method == 'POST':
            self.need_admin(me)
            name = str(body.get('name') or '')
            bk = os.path.basename(str(body.get('backup') or ''))
            if name not in CONTENT_NAMES or not bk.startswith(name + '.') or not bk.endswith('.json'):
                raise ApiError(400, '备份文件不合法')
            p = os.path.join(BACKUP, bk)
            if not os.path.exists(p):
                raise ApiError(404, '没有这份备份')
            with open(p, encoding='utf-8') as f:
                data = json.load(f)
            r = save_content(name, data, me['name'], ip)
            audit('content.restore', f'{name} ← {bk}', me['name'], ip)
            return {'ok': True, **r}, 200, None

        if path == '/api/admin/tracks' and method == 'GET':
            self.need_admin(me)
            qs = parse_qs(urlparse(self.path).query)
            q = (qs.get('q') or [''])[0].strip().lower()
            try:
                off = max(0, int((qs.get('offset') or ['0'])[0] or 0))
                lim = min(200, max(1, int((qs.get('limit') or ['50'])[0] or 50)))
            except ValueError:
                off, lim = 0, 50
            man = read_manifest()
            rows = man.get('tracks', [])
            if q:
                rows = [r for r in rows if q in r['file'].lower() or q in (r.get('artist') or '').lower()]
            return {'ok': True, 'count': man.get('count', 0), 'total': man.get('total', 0),
                    'matched': len(rows), 'offset': off, 'tracks': rows[off:off + lim]}, 200, None

        if path == '/api/admin/tracks/delete' and method == 'POST':
            self.need_admin(me)
            f = os.path.basename(str(body.get('file') or ''))
            p = os.path.join(LIBDIR, f)
            if not f or not os.path.isfile(p):
                raise ApiError(404, '库里没有这首')
            ino = os.stat(p).st_ino
            unlinked = []
            # 先摘掉源目录里的同 inode 硬链接，否则重建清单会把它再捞回来
            for sp in walk_src():
                try:
                    if os.stat(sp).st_ino == ino:
                        os.remove(sp)
                        unlinked.append(sp)
                except OSError:
                    pass
            os.makedirs(TRASH, exist_ok=True)
            dst = os.path.join(TRASH, f)
            if os.path.exists(dst):
                dst = os.path.join(TRASH, f'{now()}-{f}')
            os.replace(p, dst)              # 同分区 rename：秒移，不占额外空间
            man = write_manifest()
            audit('track.delete', f'{f} → 回收站（摘掉 {len(unlinked)} 个源链接）', me['name'], ip)
            return {'ok': True, 'moved': dst, 'unlinked': unlinked, 'count': man['count']}, 200, None

        if path == '/api/admin/tracks/restore' and method == 'POST':
            self.need_admin(me)
            f = os.path.basename(str(body.get('file') or ''))
            src = os.path.join(TRASH, f)
            if not os.path.isfile(src):
                raise ApiError(404, '回收站里没有这个文件')
            os.makedirs(LIBDIR, exist_ok=True)
            os.replace(src, os.path.join(LIBDIR, f))
            man = write_manifest()
            audit('track.restore', f, me['name'], ip)
            return {'ok': True, 'count': man['count']}, 200, None

        if path == '/api/admin/tracks/trash' and method == 'GET':
            self.need_admin(me)
            items = []
            if os.path.isdir(TRASH):
                for x in sorted(os.listdir(TRASH)):
                    p = os.path.join(TRASH, x)
                    if os.path.isfile(p):
                        items.append({'file': x, 'size': os.path.getsize(p), 'ts': int(os.path.getmtime(p))})
            return {'ok': True, 'items': items}, 200, None

        if path == '/api/admin/tracks/rebuild' and method == 'POST':
            self.need_admin(me)
            script = os.path.join(BASE, 'tools', 'build-library.py')
            try:
                r = subprocess.run([sys.executable, '-u', script], cwd=BASE, capture_output=True, timeout=900)
            except subprocess.TimeoutExpired:
                raise ApiError(500, '重建超时（15 分钟）')
            out = (r.stdout or b'').decode('utf-8', 'ignore') + (r.stderr or b'').decode('utf-8', 'ignore')
            man = read_manifest()
            audit('track.rebuild', f"清单 {man.get('count')} 首", me['name'], ip)
            return {'ok': True, 'count': man.get('count', 0), 'output': out[-4000:]}, 200, None

        if path == '/api/admin/sessions' and method == 'GET':
            self.need_admin(me)
            rows = db().execute("""SELECT s.tok,s.created_at,s.last_seen,s.ip,s.ua,u.name
                                   FROM sessions s JOIN users u ON u.id=s.uid
                                   WHERE s.expires_at>? ORDER BY s.last_seen DESC""", (now(),)).fetchall()
            return {'ok': True, 'sessions': [{'id': r['tok'][:12], 'user': r['name'],
                                              'created_at': r['created_at'], 'last_seen': r['last_seen'],
                                              'ip': r['ip'], 'ua': (r['ua'] or '')[:90],
                                              'current': bool(me.get('sid') and r['tok'] == me['sid'])}
                                             for r in rows]}, 200, None

        if path == '/api/admin/sessions/kill' and method == 'POST':
            self.need_admin(me)
            sid = str(body.get('id') or '')
            if len(sid) < 8:
                raise ApiError(400, '会话标识不合法')
            c = db()
            rows = c.execute('SELECT tok FROM sessions WHERE tok LIKE ?', (sid + '%',)).fetchall()
            for r in rows:
                c.execute('DELETE FROM sessions WHERE tok=?', (r['tok'],))
            c.commit()
            audit('session.kill', f'{sid}（{len(rows)} 个）', me['name'], ip)
            return {'ok': True, 'killed': len(rows)}, 200, None

        if path == '/api/admin/audit' and method == 'GET':
            self.need_admin(me)
            qs = parse_qs(urlparse(self.path).query)
            try:
                lim = min(500, max(1, int((qs.get('limit') or ['100'])[0] or 100)))
            except ValueError:
                lim = 100
            rows = db().execute('SELECT ts,name,action,detail,ip FROM audit ORDER BY id DESC LIMIT ?',
                                (lim,)).fetchall()
            return {'ok': True, 'items': [dict(r) for r in rows]}, 200, None

        if path == '/api/admin/archive' and method == 'GET':
            self.need_admin(me)
            return {'ok': True, 'files': archive_files()}, 200, None

        if path == '/api/admin/archive/get' and method == 'GET':
            self.need_admin(me)
            qs = parse_qs(urlparse(self.path).query)
            user = (qs.get('user') or [''])[0]
            try:
                tail = min(500, max(1, int((qs.get('tail') or ['200'])[0] or 200)))
            except ValueError:
                tail = 200
            items = []
            for line in archive_tail(user, tail):
                try:
                    items.append(json.loads(line))
                except Exception:
                    items.append({'raw': line})
            return {'ok': True, 'user': safe_user(user), 'tail': tail, 'items': items}, 200, None

        if path == '/api/admin/settings' and method == 'POST':
            self.need_admin(me)
            changes = []
            if 'allow_register' in body:
                v = '1' if body['allow_register'] else '0'
                setting_set('allow_register', v)
                changes.append('允许自助注册 → ' + ('开' if v == '1' else '关'))
            audit('settings', '；'.join(changes) or '无变化', me['name'], ip, ua)
            return {'ok': True,
                    'settings': {'allow_register': setting_get('allow_register', '1') == '1'}}, 200, None

        raise ApiError(404, '没有这个接口')

    def log_message(self, fmt, *args):
        # 只留一行紧凑日志，且不要把音频请求刷屏
        p = args[0] if args else ''
        if isinstance(p, str) and any(p.endswith(e) for e in ('.flac', '.mp3', '.m4a', '.wav', '.ogg')):
            return
        sys.stderr.write('[%s] %s\n' % (self.log_date_time_string(), fmt % args))


# ---------------------------------------------------------------- 命令行
def prompt_pw(twice=True):
    import getpass
    a = getpass.getpass('密码：')
    if len(a) < 6:
        print('太短了（至少 6 位）')
        sys.exit(1)
    if twice and a != getpass.getpass('再输一次：'):
        print('两次不一致')
        sys.exit(1)
    return a


def cli(argv):
    init_db()
    cmd = argv[0]
    if cmd == 'users':
        rows = db().execute('SELECT id,name,role,disabled,created_at,last_login,last_ip FROM users ORDER BY id').fetchall()
        if not rows:
            print('还没有任何账号（打开站点会引导创建管理员）')
        for r in rows:
            last = time.strftime('%Y-%m-%d %H:%M', time.localtime(r['last_login'])) if r['last_login'] else '从未'
            print(f"#{r['id']:<3} {r['name']:<14} {r['role']:<6} {'停用' if r['disabled'] else '正常'}"
                  f"  上次登录：{last}  {r['last_ip'] or ''}")
        return 0
    if cmd == 'adduser':
        if len(argv) < 2:
            print('用法：python serve.py adduser <用户名> [--admin]')
            return 1
        name = argv[1]
        role = 'admin' if '--admin' in argv else 'user'
        if not name_ok(name):
            print('用户名需 2–24 字符，且不含空格与 : / \\')
            return 1
        if user_by_name(name):
            print('已存在')
            return 1
        pw = prompt_pw()
        print('已创建 #%d %s（%s）' % (create_user(name, pw, role), name, role))
        audit('user.add', f'{name} · {role} · 命令行', 'cli', 'local')
        return 0
    if cmd == 'passwd':
        if len(argv) < 2:
            print('用法：python serve.py passwd <用户名>')
            return 1
        r = user_by_name(argv[1])
        if not r:
            print('没有这个账号')
            return 1
        set_pw(r['id'], prompt_pw())
        drop_user_sessions(r['id'])
        audit('passwd.self', f"{r['name']} · 命令行", 'cli', 'local')
        print('已改密，旧会话已全部失效')
        return 0
    if cmd == 'deluser':
        if len(argv) < 2:
            print('用法：python serve.py deluser <用户名>')
            return 1
        r = user_by_name(argv[1])
        if not r:
            print('没有这个账号')
            return 1
        if r['role'] == 'admin' and admin_count(False) <= 1:
            print('这是最后一个管理员，不能删')
            return 1
        drop_user_sessions(r['id'])
        db().execute('DELETE FROM users WHERE id=?', (r['id'],))
        db().commit()
        print('已删除', r['name'])
        return 0
    if cmd == 'kick':
        n = db().execute('SELECT COUNT(*) n FROM sessions').fetchone()['n']
        db().execute('DELETE FROM sessions')
        db().commit()
        print(f'已清掉 {n} 个会话')
        return 0
    if cmd == 'archive':
        if len(argv) > 1 and argv[1] != 'list':
            who = argv[1]
            n = int(argv[2]) if len(argv) > 2 and argv[2].isdigit() else 50
            try:
                lines = archive_tail(who, n)
            except ApiError as e:
                print(f'  {e.msg}（看过的账号名可以在上一步的列表里找）')
                return 0
            for line in lines:
                try:
                    r = json.loads(line)
                    print(f"{r.get('ts','')}  {str(r.get('ev','')):<10} {str(r.get('d',''))[:90]}"
                          f"   [{r.get('ip','')}]")
                except Exception:
                    print(line)
            return 0
        files = archive_files()
        if not files:
            print('还没有任何存档（有人登录或操作后就会开始记）')
        for f in files:
            print(f"{f['user']:<20} {f['lines']:>7} 行 {f['bytes'] / 1024:>9.1f} KB  "
                  f"{time.strftime('%Y-%m-%d %H:%M', time.localtime(f['mtime']))}  "
                  f"→ {os.path.join(ARCHIVE, f['file'])}")
        return 0
    if cmd == 'ai':
        cfg = ai_cfg()
        sub = argv[1] if len(argv) > 1 else 'status'
        if sub == 'status':
            print('AI 老师：', '可以用' if ai_status(cfg)['ready'] else '还没配好（' + ai_status(cfg)['reason'] + '）')
            print('  模型：', cfg['model'])
            print('  地址：', cfg['base_url'])
            print('  Key ：', ('…' + cfg['api_key'][-4:]) if cfg['api_key'] else '（空）')
            print('  开关：', '开' if cfg['enabled'] else '关')
            print('  档位：', f"max_tokens={cfg['max_tokens']} temperature={cfg['temperature']}")
            print('  配置：', AICFG)
            return 0
        if sub == 'key':
            if len(argv) < 3:
                print('用法：python serve.py ai key sk-xxxx')
                return 1
            ai_save({'api_key': argv[2].strip()})
            print('已写入 Key（只落', AICFG, '）')
            return 0
        if sub == 'model':
            if len(argv) < 3:
                print('用法：python serve.py ai model deepseek-chat')
                return 1
            ai_save({'model': argv[2].strip()})
            print('模型已设为', ai_cfg()['model'])
            return 0
        if sub in ('on', 'off'):
            ai_save({'enabled': sub == 'on'})
            print('AI 老师已' + ('打开' if sub == 'on' else '关闭'))
            return 0
        if sub == 'test':
            if not cfg['api_key']:
                print('还没填 Key：python serve.py ai key sk-xxxx')
                return 1
            payload = json.dumps({'model': cfg['model'], 'max_tokens': 200, 'stream': False,
                                  'messages': [{'role': 'system', 'content': AI_SYS},
                                               {'role': 'user', 'content': '用一句话说说你能帮学生做什么。'}]},
                                 ensure_ascii=False).encode('utf-8')
            req = urllib.request.Request(cfg['base_url'] + '/chat/completions', data=payload,
                                         headers={'Content-Type': 'application/json',
                                                  'Authorization': 'Bearer ' + cfg['api_key']},
                                         method='POST')
            try:
                with urllib.request.urlopen(req, timeout=AI_TIMEOUT) as r:
                    j = json.loads(r.read().decode('utf-8', 'replace'))
                print('通了，模型', j.get('model') or cfg['model'])
                print('  回答：', (j['choices'][0]['message']['content'] or '').strip())
                print('  用量：', j.get('usage') or '—')
                return 0
            except urllib.error.HTTPError as e:
                print('失败：', ai_error_text(e.code, e.read().decode('utf-8', 'replace')))
                return 1
            except Exception as e:
                print('失败：', type(e).__name__, e)
                return 1
        print('用法：python serve.py ai [status|key <sk-…>|model <名>|on|off|test]')
        return 1
    if cmd == 'dev':
        os.makedirs(PRIV, exist_ok=True)
        if len(argv) > 1 and argv[1] == 'on':
            tok = secrets.token_urlsafe(24)
            with open(DEVTOK, 'w', encoding='utf-8') as f:
                f.write(tok)
            print('直通已开启，令牌写入', DEVTOK)
            print('自检地址示例： http://127.0.0.1:8081/_selftest.html?dev=' + tok)
        else:
            if os.path.exists(DEVTOK):
                os.remove(DEVTOK)
            print('直通已关闭（.private/dev.token 已删除）')
            # 光删令牌不够：临时管理员账号、它的会话、它的存档都会留在库里/盘上（踩过：
            # 后台账号列表里多出一个能登录的 dev 管理员）。
            try:
                r = user_by_name('dev')
                if r:
                    c = db()
                    c.execute('DELETE FROM sessions WHERE uid=?', (r['id'],))
                    c.execute('DELETE FROM users WHERE id=?', (r['id'],))
                    c.commit()
                    print('  已删除临时账号 dev 及其会话')
                f = os.path.join(ARCHIVE, 'dev.jsonl')
                if os.path.exists(f):
                    os.remove(f)
                    print('  已删除 dev 的存档 dev.jsonl')
            except Exception as e:
                print('  清理 dev 时出错（不影响直通关闭）：', e)
        return 0
    print(__doc__)
    return 1


# ---------------------------------------------------------------- 启动
class DualStackServer(ThreadingHTTPServer):
    """双栈监听（绑 IPv6 通配 ::，同时接受 IPv4 映射连接）。

    为什么需要：serveo 的 WireGuard 隧道把公网流量送到 peer 的 **IPv6** 地址，
    官方明确写了「只绑 127.0.0.1 或 0.0.0.0 的纯 IPv4 监听收不到隧道流量」。
    双栈就能一次覆盖三边：本机 IPv4、局域网 IPv4、WireGuard 的 IPv6。
    """
    address_family = socket.AF_INET6

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)   # 允许 IPv4 映射
        except Exception:
            pass
        super().server_bind()


def lan_ips():
    """本机在局域网里的 IPv4（挑出来给手机用；回环与 169.254 自动排除）"""
    ips = []
    try:
        import socket as _s
        for info in _s.getaddrinfo(_s.gethostname(), None, _s.AF_INET):
            ip = info[4][0]
            if ip.startswith('127.') or ip.startswith('169.254.'):
                continue
            if ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    return ips


def main():
    port = 8081
    directory = BASE
    rest = list(sys.argv[1:])
    if rest and not rest[0].isdigit():
        return cli(rest)
    if rest and rest[0].isdigit():
        port = int(rest.pop(0))
    if rest:
        directory = rest.pop(0)

    # 绑定地址：默认只听本机。
    #   lan → IPv4 0.0.0.0（局域网 IPv4 可访问）
    #   wg  → 双栈 ::（IPv6 + IPv4 都听）—— serveo 的 WireGuard 隧道必须走这条，
    #         因为它把流量送到 peer 的 IPv6 地址；同时也覆盖本机与局域网的 IPv4。
    mode = os.environ.get('SITE_BIND', '').strip().lower()
    if 'wg' in rest or 'all' in rest or mode in ('wg', 'all', 'dual'):
        mode = 'wg'
    elif 'lan' in rest or mode == 'lan':
        mode = 'lan'
    else:
        mode = ''
    for tok in ('wg', 'all', 'lan'):
        while tok in rest:
            rest.remove(tok)
    if mode == 'wg':
        host, srv_cls = '::', DualStackServer
    elif mode == 'lan':
        host, srv_cls = '0.0.0.0', ThreadingHTTPServer
    else:
        host, srv_cls = '127.0.0.1', ThreadingHTTPServer

    init_db()
    handler = functools.partial(Handler, directory=directory)
    httpd = srv_cls((host, port), handler)
    httpd.daemon_threads = True
    print(f'砚池 · 服务已启动  http://127.0.0.1:{port}/  （根目录：{directory}）', flush=True)
    if mode == 'wg':
        print(f'       双栈监听 {host}:{port}（IPv6 + IPv4）', flush=True)
        for ip in lan_ips():
            print(f'       局域网： http://{ip}:{port}/', flush=True)
        print(f'       WireGuard： https://wg-<peer地址去冒号>-{port}.serveousercontent.com  （隧道连着就能开）', flush=True)
    elif mode == 'lan':
        for ip in lan_ips():
            print(f'       局域网： http://{ip}:{port}/   ← 同一个 Wi-Fi 下的手机用这个', flush=True)
    print(f'账号：{user_count()} 个' + ('（还没有账号，首次打开会引导创建管理员）' if user_count() == 0 else ''), flush=True)
    print('Range 已支持 · 目录列表已关闭 · 全站需登录 · Ctrl+C 停止', flush=True)
    if dev_token():
        print('⚠ 自检直通处于开启状态（.private/dev.token 存在），验完请执行：python serve.py dev off', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止', flush=True)


if __name__ == '__main__':
    main()
