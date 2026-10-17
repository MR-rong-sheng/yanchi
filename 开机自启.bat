@echo off
chcp 936 >nul
rem 砚池 · 开机自启：只拉本地服务（公网穿透已停用，不再自动连 serveo）。
rem 不想开机自启：删掉启动文件夹里的「砚池.lnk」即可。
cd /d "%~dp0"
curl -s -o NUL -m 3 http://127.0.0.1:8081/ && goto end
start "yanchi-serve" /min cmd /c "python -u "%~dp0serve.py" 8081 "%~dp0" wg"
:end
