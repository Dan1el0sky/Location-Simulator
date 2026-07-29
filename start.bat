@echo off
TITLE Location Simulator v1.0.0
COLOR 0A
CLS

echo ================================================================
echo           Location Simulator v1.0.0 Launcher
echo ================================================================
echo.

IF NOT EXIST "node_modules" (
    echo [!] First-time run detected. Installing dependencies...
    echo.
    call npm install
    IF ERRORLEVEL 1 (
        echo [X] Error installing Node dependencies. Make sure Node.js is installed.
        pause
        exit /b 1
    )
)

echo [+] Starting Location Simulator Desktop App...
echo.
call npm start

IF ERRORLEVEL 1 (
    echo.
    echo [X] Application stopped with an error code.
    pause
)
