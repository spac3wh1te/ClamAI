@echo off
setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0"
set "OUTPUT_DIR=%PROJECT_ROOT%outputs\release"
set "FRONTEND_DIST=%PROJECT_ROOT%dist"
set "SRC_TAURI=%PROJECT_ROOT%src-tauri"
set "PROXY_SERVICE=%SRC_TAURI%\proxy-service"
set "RUST_TARGET=%SRC_TAURI%\target\release"

echo ============================================
echo ClamAI Build Script
echo ============================================
echo.

echo [1/6] Cleaning output and temp directories...
if exist "%OUTPUT_DIR%" (
    if exist "%OUTPUT_DIR%\clamai.db" (
        copy /Y "%OUTPUT_DIR%\clamai.db" "%PROJECT_ROOT%\clamai.db.bak"
    )
    if exist "%OUTPUT_DIR%\*.log" (
        copy /Y "%OUTPUT_DIR%\*.log" "%PROJECT_ROOT%\*.log.bak" 2>nul
    )
    rmdir /s /q "%OUTPUT_DIR%"
)
if exist "%SRC_TAURI%\dist" rmdir /s /q "%SRC_TAURI%\dist"
mkdir "%OUTPUT_DIR%"

echo [2/6] Building frontend...
cd /d "%PROJECT_ROOT%"
call npm run build
if errorlevel 1 (
    echo Frontend build failed!
    exit /b 1
)

echo [3/6] Copying frontend dist to src-tauri\dist...
xcopy /E /I /Y "%FRONTEND_DIST%" "%SRC_TAURI%\dist\"
if not exist "%SRC_TAURI%\dist\index.html" (
    echo ERROR: src-tauri\dist\index.html not found! Frontend not embedded.
    exit /b 1
)
echo Verified: src-tauri\dist\index.html exists

echo [4/6] Invalidating Rust build cache to force frontend re-embed...
if exist "%RUST_TARGET%\.fingerprint" (
    for /d %%d in ("%RUST_TARGET%\.fingerprint\clamai*") do (
        rmdir /s /q "%%d"
    )
)
if exist "%RUST_TARGET%\build\clamai*" (
    for /d %%d in ("%RUST_TARGET%\build\clamai*") do (
        rmdir /s /q "%%d"
    )
)

echo [5/6] Building Rust (ClamAI.exe)...
cd /d "%SRC_TAURI%"
call cargo build --release --features custom-protocol
if errorlevel 1 (
    echo Rust build failed!
    exit /b 1
)

echo [6/6] Building Go proxy (ClamAI-service.exe)...
cd /d "%PROXY_SERVICE%"
call go build -ldflags="-H windowsgui" -o ClamAI-service.exe .
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

if exist "%PROJECT_ROOT%\clamai.db.bak" (
    copy /Y "%PROJECT_ROOT%\clamai.db.bak" "%OUTPUT_DIR%\clamai.db"
    del /F /Q "%PROJECT_ROOT%\clamai.db.bak"
)

echo.
echo ============================================
echo Cleaning up build artifacts...
echo ============================================
if exist "%FRONTEND_DIST%" rmdir /s /q "%FRONTEND_DIST%"
if exist "%SRC_TAURI%\dist" rmdir /s /q "%SRC_TAURI%\dist"

echo.
echo ============================================
echo Build complete!
echo.
echo Output directory: %OUTPUT_DIR%
echo.
dir "%OUTPUT_DIR%"
echo ============================================

endlocal
