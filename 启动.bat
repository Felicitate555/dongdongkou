@echo off
setlocal
cd /d "%~dp0"

set "PYEXE=%~dp0.venv\Scripts\python.exe"
if not exist "%PYEXE%" (
    set "PYEXE=%~dp0venv\Scripts\python.exe"
)
if not exist "%PYEXE%" (
    where py >nul 2>nul
    if not errorlevel 1 (
        py -3 -m venv venv
    ) else (
        where python >nul 2>nul
        if errorlevel 1 (
            echo [ERROR] Python 3.10 or newer was not found.
            pause
            exit /b 1
        )
        python -m venv venv
    )
)

if not exist "%PYEXE%" (
    echo [ERROR] Failed to create the virtual environment.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:8787/api/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if not errorlevel 1 (
    echo [INFO] The service is already running.
    start "" http://127.0.0.1:8787
    echo [INFO] Leave the service window open while using the app.
    pause
    exit /b 0
)

if not exist "static\models\face_landmarker.task" (
    echo [ERROR] Missing static\models\face_landmarker.task.
    pause
    exit /b 1
)

echo [INFO] Checking Python dependencies. The first run may take a while.
"%PYEXE%" -m pip install -r requirements.txt -q --disable-pip-version-check
if errorlevel 1 echo [WARN] Dependency installation reported an error.
"%PYEXE%" -c "import fastapi, pydantic_core"
if errorlevel 1 (
    echo [ERROR] Python dependencies are incomplete. See the error above.
    pause
    exit /b 1
)

echo [INFO] Starting the service in a separate window.
start "DongDongKou Server" "%PYEXE%" "%~dp0run.py"
echo [INFO] Waiting for the service to become ready.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(90); do { try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:8787/api/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch { }; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
    echo [ERROR] The service did not become ready. Check the DongDongKou Server window.
    pause
    exit /b 1
)

echo [INFO] The app is ready at http://127.0.0.1:8787
start "" http://127.0.0.1:8787
echo [INFO] Keep the DongDongKou Server window open while using the app.
pause
endlocal
