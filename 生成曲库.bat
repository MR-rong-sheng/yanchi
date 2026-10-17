@echo off
chcp 65001 >nul
title 砚池 · 重建曲库清单
cd /d "%~dp0"
echo.
echo   正在扫描音乐目录、补建硬链接、重写 content\music.json …
echo.
python -u "%~dp0tools\build-library.py"
echo.
echo   完成后刷新播放页即可看到新曲目。
pause
