@echo off
setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0"
set "OUTPUT_DIR=%PROJECT_ROOT%outputs\debug"
set "FRONTEND_DIST=%PROJECT_ROOT%dist"
set "SRC_TAURI=%PROJECT_ROOT%src-tauri"
set "PROXY_SERVICE=%SRC_TAURI%\proxy-service"
set "RUST_TARGET=%SRC_TAURI%\target\debug"

echo ============================================
echo ClamAI Dev Build Script
echo ============================================
echo.

echo [1/5] Cleaning output directory...
if exist "%OUTPUT_DIR%" rmdir /s /q "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%"

echo [2/5] Building frontend...
cd /d "%PROJECT_ROOT%"
call npm run build
if errorlevel 1 (
    echo Frontend build failed!
    exit /b 1
)

echo [3/5] Copying frontend dist to src-tauri\dist...
xcopy /E /I /Y "%FRONTEND_DIST%" "%SRC_TAURI%\dist\"
if not exist "%SRC_TAURI%\dist\index.html" (
    echo ERROR: src-tauri\dist\index.html not found! Frontend not embedded.
    exit /b 1
)
echo Verified: src-tauri\dist\index.html exists

echo [4/5] Building Rust debug (ClamAI.exe)...
cd /d "%SRC_TAURI%"
call cargo build --features custom-protocol
if errorlevel 1 (
    echo Rust build failed!
    exit /b 1
)

echo [5/5] Building Go proxy (ClamAI-service.exe)...
cd /d "%PROXY_SERVICE%"
call go build -o ClamAI-service.exe .
if errorlevel 1 (
    echo Go proxy build failed!
    exit /b 1
)

echo.
echo ============================================
echo Copying binaries to output directory...
echo ============================================

copy /Y "%RUST_TARGET%\ClamAI.exe" "%OUTPUT_DIR%\ClamAI.exe"
copy /Y "%PROXY_SERVICE%\ClamAI-service.exe" "%OUTPUT_DIR%\ClamAI-service.exe"

echo.
echo ============================================
echo Cleaning up temp dist...
echo ============================================
if exist "%FRONTEND_DIST%" rmdir /s /q "%FRONTEND_DIST%"
if exist "%SRC_TAURI%\dist" rmdir /s /q "%SRC_TAURI%\dist"

echo.
echo ============================================
echo Dev build complete!
echo.
echo Output directory: %OUTPUT_DIR%
echo.
dir "%OUTPUT_DIR%"
echo ============================================

endlocal
