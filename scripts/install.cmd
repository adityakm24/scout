@echo off
REM ============================================================================
REM Scout Agent Installer for Windows (CMD wrapper)
REM ============================================================================
REM This batch file launches the PowerShell installer that sits next to it, for
REM users running CMD. From a clone of the repository:
REM   scripts\install.cmd
REM
REM Or, from PowerShell:
REM   .\scripts\install.ps1
REM ============================================================================

echo.
echo  Scout Agent Installer
echo  Launching PowerShell installer...
echo.

powershell -ExecutionPolicy ByPass -NoProfile -File "%~dp0install.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  Installation failed. Please try running PowerShell directly:
    echo    powershell -ExecutionPolicy ByPass -File "%~dp0install.ps1"
    echo.
    pause
    exit /b 1
)
