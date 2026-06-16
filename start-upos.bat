@echo off
REM ASCII only: Russian text breaks cmd.exe on non-UTF8 code pages.
setlocal EnableExtensions

cd /d "%~dp0"

set "PYWEB=%~dp0pyweb"
set "REQ=%PYWEB%\requirements.txt"
set "VENV_PY=%PYWEB%\.venv\Scripts\python.exe"

if not exist "%REQ%" (
  echo [UPOS] Missing file: pyweb\requirements.txt
  pause
  exit /b 1
)

if not exist "%VENV_PY%" (
  echo [UPOS] Creating Python virtual env: pyweb\.venv ...
  where py >nul 2>&1
  if not errorlevel 1 (
    py -3 -m venv "%PYWEB%\.venv"
  ) else (
    python -m venv "%PYWEB%\.venv"
  )
)

if not exist "%VENV_PY%" (
  echo [UPOS] Python not found. Install 3.11+ from https://www.python.org/downloads/
  echo       Or run: winget install Python.Python.3.12
  pause
  exit /b 1
)

echo [UPOS] Upgrading pip and installing packages from PyPI ...
"%VENV_PY%" -m pip install --upgrade pip -q
"%VENV_PY%" -m pip install -r "%REQ%"
if errorlevel 1 (
  echo [UPOS] pip install failed.
  pause
  exit /b 1
)

echo [UPOS] Starting server in a new window ...
pushd "%PYWEB%"
start "UPOS FINANCE server" cmd /k ".venv\Scripts\python.exe -m uvicorn upos.main:app --host 127.0.0.1 --port 3000 --reload --reload-dir upos"
popd

echo [UPOS] Waiting for port 3000 ...
ping -n 6 127.0.0.1 >nul

start "" "http://127.0.0.1:3000/auth"

echo.
echo [UPOS] Done. Browser opened. Server runs in window "UPOS FINANCE server".
echo       Stop server there: Ctrl+C or close that window.
echo.
pause
