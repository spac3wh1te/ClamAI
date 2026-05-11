@echo off
setlocal

cd /d "%~dp0.."

echo [1/3] Building frontend...
call npm run build
if %errorlevel% neq 0 (
    echo Frontend build failed!
    exit /b 1
)

echo [2/3] Copying frontend to service...
xcopy /E /Y /Q dist\* server\frontend\dist\

echo [3/3] Building Go service...
cd server
go build -tags server -o ClamAI-Server.exe .
if %errorlevel% neq 0 (
    echo Go build failed!
    exit /b 1
)

echo.
taskkill /f /im ClamAI-Server.exe >nul 2>nul & timeout /t 1 /nobreak >nul & echo Stopped
start /b "" ".\ClamAI-Server.exe" --port 38080 --admin-port 38085 --host 0.0.0.0

