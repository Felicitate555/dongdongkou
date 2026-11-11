@echo off
chcp 65001 >nul
title 动动口 · 外网临时隧道
cd /d %~dp0

set "PORT=8787"
set "LOCAL=http://127.0.0.1:%PORT%"

echo [1] 检查本机服务 %LOCAL% ...
powershell -NoProfile -Command "try { $h=Invoke-WebRequest '%LOCAL%/api/health' -UseBasicParsing -TimeoutSec 2; $j=$h.Content | ConvertFrom-Json; if ($h.StatusCode -eq 200 -and $j.deployment_mode -eq 'public' -and -not $j.system_control) { exit 0 } else { exit 3 } } catch { exit 1 }"
if errorlevel 1 (
    echo [安全阻止] 服务未启动，或仍处于本机模式。
    echo 请先以 DDK_DEPLOYMENT_MODE=public 重启服务，再运行本脚本。
    echo 公网模式会强制禁用服务器鼠标和键盘控制。
    pause
    exit /b 1
)

where cloudflared >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 cloudflared。安装：
    echo   winget install Cloudflare.cloudflared
    echo 或下载: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    pause
    exit /b 1
)

echo [2] 启动 Cloudflare Quick Tunnel（无需账号，HTTPS 公网地址）...
echo     浏览器摄像头需要 HTTPS —— 请把下方 https://*.trycloudflare.com 发给对方
echo     检查已确认服务处于 public 模式，系统鼠标/键盘 API 已禁用
echo.
cloudflared tunnel --url %LOCAL%
pause
