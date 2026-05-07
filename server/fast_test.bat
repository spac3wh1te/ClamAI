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
xcopy /E /Y /Q dist\* clamai-service\frontend\dist\

echo [3/3] Building Go service...
cd clamai-service
go build -tags server -o clamai-service.exe .
if %errorlevel% neq 0 (
    echo Go build failed!
    exit /b 1
)

echo.
Stop-Process -Name "ClamAI-service" -Force -ErrorAction SilentlyContinue 2>$null; Start-Sleep 1; Write-Output "Stopped"
Start-Process -FilePath ".\ClamAI-service.exe" -ArgumentList "--port","38080","--admin-port","38085","--host","0.0.0.0" -WindowStyle Hidden
echo Done: Start-Process -FilePath ".\ClamAI-service.exe" -ArgumentList "--port","38080","--admin-port","38085","--host","0.0.0.0" -WindowStyle Hidden

