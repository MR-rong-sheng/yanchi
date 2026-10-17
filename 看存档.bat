@echo off
chcp 65001 >nul
title 砚池 · 操作存档
cd /d "%~dp0"
echo.
echo   每个账号一份存档：.private\archive\<账号>.jsonl
echo   下面先列出所有存档文件，再让你挑一个看最近 40 条。
echo.
python -u "%~dp0serve.py" archive
echo.
set /p WHO=要看哪个账号的轨迹？（直接回车就退出）
if "%WHO%"=="" goto end
echo.
echo   —— %WHO% 的最近 40 条操作 ——
python -u "%~dp0serve.py" archive %WHO% 40
echo.
echo   完整文件在 .private\archive\%WHO%.jsonl（JSON Lines，一行一条）
:end
echo.
pause
