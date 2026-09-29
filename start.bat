@echo off
chcp 65001 >nul
title 工作流工具台
cd /d "%~dp0"

echo.
echo   ============================================
echo    工作流工具台 正在启动...
echo   ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 没有找到 Node.js
  echo.
  echo   请先安装 Node.js：https://nodejs.org
  echo   安装后重新双击本文件即可。
  echo.
  pause
  exit /b 1
)

start "" http://localhost:8317
node server.js

echo.
echo   服务已停止。
pause
