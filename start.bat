@echo off
title Location Simulator Launcher

echo Starting Location Simulator...

REM Ensure node modules are installed properly
if not exist "node_modules\vite\bin\vite.js" (
    echo [INFO] Node dependencies are missing or incomplete. Installing...
    call npm install
)

REM Ensure Python environment is setup and fully installed
if not exist "venv\" (
    echo [INFO] Creating Python virtual environment...
    python -m venv venv
)

if not exist "venv\.installed" (
    echo [INFO] Installing Python dependencies...
    call venv\Scripts\activate.bat
    call pip install -r src\backend\requirements.txt websockets

    if %ERRORLEVEL% EQU 0 (
        echo. > venv\.installed
        echo [INFO] Python dependencies installed successfully.
    ) else (
        echo ========================================================
        echo [ERROR] Failed to install Python dependencies.
        echo It looks like you are missing Microsoft Visual C++ Build Tools.
        echo Please download and install them from:
        echo https://visualstudio.microsoft.com/visual-cpp-build-tools/
        echo Or pre-install the failing wheel manually.
        echo ========================================================
        pause
        exit /b 1
    )
) else (
    call venv\Scripts\activate.bat
)

echo [INFO] Starting Location Simulator application...
REM Run vite directly via node to bypass Windows pathing bugs
node node_modules\vite\bin\vite.js

pause
