@echo off
chcp 936 >nul
title 砚池 · 语文学习工具 (本地 8081)
cd /d "%~dp0"
echo.
echo   砚池正在启动（本机 127.0.0.1 与局域网都听）：
echo     本机   http://127.0.0.1:8081/
echo   自带服务：音频可拖进度（Range）、不列目录、多线程、全站需登录。
echo   停止：关掉这个黑窗口，或按 Ctrl+C。
echo.
start "" "http://127.0.0.1:8081/"
python -u "%~dp0serve.py" 8081 "%~dp0" wg
echo.
echo   服务已停止。
pause
