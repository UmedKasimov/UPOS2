@echo off

cd /d "%~dp0"

if not exist .venv ( python -m venv .venv )

call .venv\Scripts\activate.bat

pip install -q -r requirements.txt

python -m uvicorn upos.main:app --reload --reload-dir upos --host 127.0.0.1 --port 3000

