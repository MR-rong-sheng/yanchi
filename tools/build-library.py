# -*- coding: utf-8 -*-
"""建立砚池的站内曲库：
   1) D:\\CloudMusic\\library\\  —— 用 NTFS 硬链接汇集所有可播放音频（同一分区，零额外占用）
   2) C:\\Users\\荣晟\\yanchi\\music —— junction 指向 library（站点能读，C 盘不占空间）
   3) content/music.json —— 播放器要的清单
"""
import os, json, re, subprocess, sys

SRC = r'D:\CloudMusic'
LIB = os.path.join(SRC, 'library')
SITE = r'C:\Users\荣晟\yanchi'
JUNC = os.path.join(SITE, 'music')

os.makedirs(LIB, exist_ok=True)

# ---------- 1) 收集音频（排除 library 自身，避免把硬链接当源无限递归） ----------
AUD = ('.flac', '.mp3', '.m4a', '.wav', '.ogg', '.aac', '.opus')
found = []
for d, dirs, fs in os.walk(SRC):
    dirs[:] = [x for x in dirs if os.path.join(d, x) != LIB]
    for f in fs:
        if os.path.splitext(f)[1].lower() in AUD:
            found.append(os.path.join(d, f))
print(f'源目录里可播放音频：{len(found)} 个')

# ---------- 2) 硬链接进 library（重名自动加后缀） ----------
used, linked, skipped, failed = set(), 0, 0, []
for p in found:
    base = os.path.basename(p)
    stem, ext = os.path.splitext(base)
    name = base
    n = 2
    while name.lower() in used:
        name = f'{stem} ({n}){ext}'
        n += 1
    used.add(name.lower())
    dst = os.path.join(LIB, name)
    if os.path.exists(dst):
        skipped += 1
        continue
    try:
        os.link(p, dst)          # 硬链接：同一分区的两个名字指向同一份数据
        linked += 1
    except OSError as e:
        try:                     # 跨分区等情形退回复制
            import shutil; shutil.copy2(p, dst); linked += 1
        except Exception as e2:
            failed.append((base, str(e2)))
print(f'硬链接建立：{linked}　已存在跳过：{skipped}　失败：{len(failed)}')
for b, e in failed[:5]:
    print('   失败', b, e)

# ---------- 3) junction ----------
if os.path.exists(JUNC):
    print(f'junction 已存在：{JUNC}')
else:
    r = subprocess.run(['cmd', '/c', 'mklink', '/J', JUNC, LIB], capture_output=True)
    print('mklink:', r.stdout.decode('gbk', 'ignore').strip() or r.stderr.decode('gbk', 'ignore').strip())

# ---------- 4) 清单 ----------
rows = []
for f in sorted(os.listdir(LIB)):
    p = os.path.join(LIB, f)
    if not os.path.isfile(p) or os.path.splitext(f)[1].lower() not in AUD:
        continue
    stem = os.path.splitext(f)[0]
    artist = ''
    m = re.match(r'^(.+?)\s+-\s+(.+)$', stem)
    if m:
        artist, title = m.group(1).strip(), m.group(2).strip()
    else:
        title = stem
    rows.append({'file': f, 'title': title, 'artist': artist,
                 'size': os.path.getsize(p), 'ext': os.path.splitext(f)[1][1:].lower()})

# ---------- 5) 置顶清单：content/pinned.json 里列出的排在最前（按列出顺序） ----------
PIN = os.path.join(SITE, 'content', 'pinned.json')
pins = []
if os.path.exists(PIN):
    try:
        pins = [str(x).strip() for x in json.load(open(PIN, encoding='utf-8')) if str(x).strip()]
    except Exception as e:
        print('pinned.json 读不了，忽略：', e)

def rank(r):
    for i, pin in enumerate(pins):
        if pin in (r['file'], r['title'], os.path.splitext(r['file'])[0]):
            return (0, i)
    return (1, 0)

rows.sort(key=lambda r: (rank(r), r['file'].lower()))
if pins:
    print(f'置顶 {len(pins)} 条：' + '、'.join(r['title'] for r in rows[:len(pins)]))

man = os.path.join(SITE, 'content', 'music.json')
json.dump({'count': len(rows), 'total': sum(r['size'] for r in rows), 'tracks': rows},
          open(man, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'清单写入 {man}：{len(rows)} 首，合计 {sum(r["size"] for r in rows)/2**30:.2f} GB')
print('样例：')
for r in rows[:5]:
    print(f'   {r["artist"] or "—":<22} | {r["title"][:40]:<40} | {r["size"]/2**20:6.1f} MB | {r["ext"]}')
