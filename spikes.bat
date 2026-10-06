@echo off
cd /d "%~dp0spikes"
if not exist node_modules call npm install
start "" http://localhost:5410
call npm run dev
