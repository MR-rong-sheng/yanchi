# -*- coding: utf-8 -*-
"""开机自启：登录时拉起砚池服务 + 公网隧道，并在启动文件夹放一个快捷方式。
   卸载：删掉启动文件夹里的「砚池.lnk」即可（本脚本 --remove 也能删）。"""
import os, subprocess, sys, textwrap

D = r'C:\Users\荣晟\yanchi'
BAT = os.path.join(D, '开机自启.bat')
STARTUP = os.path.join(os.environ['APPDATA'], r'Microsoft\Windows\Start Menu\Programs\Startup')
LNK = os.path.join(STARTUP, '砚池.lnk')

CONTENT = r'''@echo off
chcp 936 >nul
rem 砚池 · 开机自启：先把本地服务拉起来，再拉公网隧道。
rem 不想开机自启：删掉启动文件夹里的「砚池.lnk」即可（或运行 python tools\autostart.py --remove）。
cd /d "%~dp0"

rem 已经在跑就不重复起
curl -s -o NUL -m 3 http://127.0.0.1:8081/ && goto tunnel
start "yanchi-serve" /min cmd /c "python -u "%~dp0serve.py" 8081 "%~dp0""
"%SystemRoot%\System32\PING.EXE" -n 4 127.0.0.1 >NUL

:tunnel
if not exist "%USERPROFILE%\.ssh\id_ed25519" goto end
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='ssh.exe'\" | Where-Object { $_.CommandLine -like '*serveo.net*' } | Measure-Object | Select-Object -ExpandProperty Count" > "%TEMP%\_yc.txt" 2>NUL
set /p N=<"%TEMP%\_yc.txt"
if not "%N%"=="0" goto end
start "yanchi-tunnel" /min cmd /c ""%~dp0隧道守护.cmd""

:end
'''


def install():
    open(BAT, 'w', encoding='gbk', newline='\r\n').write(CONTENT)
    os.makedirs(STARTUP, exist_ok=True)
    ps = textwrap.dedent(f'''
        $w = New-Object -ComObject WScript.Shell
        $s = $w.CreateShortcut("{LNK}")
        $s.TargetPath = "{BAT}"
        $s.WorkingDirectory = "{D}"
        $s.WindowStyle = 7
        $s.Description = "砚池：本地服务 + 公网隧道"
        $s.Save()
        Write-Host "shortcut ok"
    ''')
    r = subprocess.run(['powershell', '-NoProfile', '-Command', ps],
                       capture_output=True, text=True, encoding='utf-8', errors='ignore')
    print('写入:', BAT, os.path.getsize(BAT), 'bytes')
    print('快捷方式:', LNK)
    print('exe 存在:', os.path.exists(LNK), '|', (r.stdout or '').strip())


def remove():
    for p in (LNK,):
        if os.path.exists(p):
            os.remove(p)
            print('已删除', p)
    print('自启已关闭（服务和隧道进程仍在跑，需另行停止）')


if __name__ == '__main__':
    remove() if '--remove' in sys.argv else install()
