@echo off
rem Stop the Synapsis dev server (whatever listens on 5410)
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5410 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force; Write-Host stopped $_.OwningProcess }"
