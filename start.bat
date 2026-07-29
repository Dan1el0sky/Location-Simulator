@echo off
TITLE Location Simulator v1.0.0
COLOR 0A
CLS

echo ================================================================
echo           Location Simulator v1.0.0 Launcher
echo ================================================================
echo.

IF NOT EXIST "node_modules" (
    echo [!] First-time run detected. Installing Node dependencies...
    echo.
    call npm install
    IF ERRORLEVEL 1 (
        echo [X] Error installing Node dependencies. Make sure Node.js is installed.
        pause
        exit /b 1
    )
)

echo [+] Checking Python backend dependencies (pymobiledevice3)...
python -m pip install -r src\backend\requirements.txt >nul 2>&1
IF ERRORLEVEL 1 (
    echo [!] Warning: Could not automatically pip install pymobiledevice3.
)

echo.
echo [+] Starting Location Simulator Desktop App...
echo.
call npm start

IF ERRORLEVEL 1 (
    echo.
    echo [X] Application stopped with an error code.
    pause
)
