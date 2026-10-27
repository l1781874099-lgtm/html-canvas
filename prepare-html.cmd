@echo off
chcp 65001 >nul
if "%~1"=="" (
  echo 请把 HTML 文件拖到这个 prepare-html.cmd 上。
  pause
  exit /b 1
)
node "%~dp0prepare-html.cjs" "%~f1"
if errorlevel 1 pause
