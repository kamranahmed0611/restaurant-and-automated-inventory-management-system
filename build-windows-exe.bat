@echo off
title Muchachos POS - Windows Installer Builder
color 0A

echo ======================================================================
echo           MUCHACHOS POS - WINDOWS INSTALLER BUILD SCRIPT
echo ======================================================================
echo.

echo [1/3] Building Next.js Standalone Production Server...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo.
    echo [ERROR] Next.js build failed! Aborting.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/3] Preparing Standalone Embed Assets (.next/standalone)...
node scripts/prepare-standalone.js
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo.
    echo [ERROR] Standalone asset preparation failed! Aborting.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [3/3] Packaging Windows Executable (.exe) with Electron Builder...
call npx electron-builder --win
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo.
    echo [ERROR] Electron Builder failed! Aborting.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ======================================================================
echo   SUCCESS! MUCHACHOS WINDOWS INSTALLER CREATED!
echo   Installer location: dist-electron\Muchachos POS Setup 0.1.0.exe
echo ======================================================================
echo.
pause
