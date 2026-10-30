@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================================
echo   小筱工作台 - 本地预览服务器
echo   浏览器自动打开 http://localhost:8080
echo   关闭此窗口即停止服务器
echo ================================================
start "" "http://localhost:8080"
"C:\Users\筱小葵sxy\.workbuddy\binaries\python\versions\3.13.12\python.exe" -m http.server 8080
pause
