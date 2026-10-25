@echo off
chcp 936 >nul
title 砚池 · 语文学习工具 · 开机自启
cd /d "%~dp0"
start "yanchi-serve" /min cmd /c "python -u serve.py 8081 . wg"
exit
