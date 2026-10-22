@echo off
rem Double-click launcher: runs the patch script with a process-only execution policy bypass.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-cmdb-patch.ps1" %*
pause
