@echo off
title Location Simulator Launcher

echo Starting Location Simulator...

REM Ensure node modules are installed
if not exist "node_modules\" (
    echo [INFO] Installing required Node.js dependencies...
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
REM Run via npx to ensure local node_modules bins are found
call npx vite

pause
