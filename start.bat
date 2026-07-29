@echo off
title Location Simulator Launcher

echo Starting Location Simulator...

REM Ensure node modules are installed
if not exist "node_modules\" (
    echo [INFO] Installing required Node.js dependencies...
    call npm install
)

REM Ensure Python environment is setup
if not exist "venv\" (
    echo [INFO] Creating Python virtual environment...
    python -m venv venv
    call venv\Scripts\activate.bat
    echo [INFO] Installing Python dependencies...
    pip install -r src\backend\requirements.txt websockets
) else (
    call venv\Scripts\activate.bat
)

echo [INFO] Starting Location Simulator application...
REM Run via Vite + Electron
call npm run dev

pause
