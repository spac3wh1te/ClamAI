@echo off
setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0"
set "SRC_TAURI=%PROJECT_ROOT%src-tauri"
set "PROXY_SERVICE=%SRC_TAURI%\proxy-service"
set "FRONTEND_DIST=%PROJECT_ROOT%dist"

REM ---- args: %1=BUILD_CONFIG (release|debug), %2..=targets ----
set "BUILD_CONFIG=%~1"
shift

if "%BUILD_CONFIG%"=="release" (
    set "CARGO_FLAG=--release"
    set "RUST_TARGET_DIR=release"
) else (
    set "CARGO_FLAG="
    set "RUST_TARGET_DIR=debug"
)

set "OUT_ROOT=%PROJECT_ROOT%outputs\%BUILD_CONFIG%"
set "BUILD_SERVICE_ONLY=0"
set "TARGET_LIST="

if "%~1"=="" (
    set "TARGET_LIST=x86_64-win x86_64-linux arm64-win arm64-linux"
    goto :start_build
)

:parse_args
if "%~1"=="" goto :start_build
if /i "%~1"=="all" (
    set "TARGET_LIST=x86_64-win x86_64-linux arm64-win arm64-linux"
    shift
    goto :parse_args
)
if /i "%~1"=="service" (
    set "BUILD_SERVICE_ONLY=1"
    shift
    goto :parse_args
)
set "TARGET_LIST=!TARGET_LIST! %~1"
shift
goto :parse_args

:start_build

echo ============================================
echo   ClamAI Build ^(%BUILD_CONFIG%^)
echo ============================================
echo   Output: outputs\%BUILD_CONFIG%\{x86_64,arm64}\
echo.

REM ============================================================
REM  Step 1: Build frontend
REM ============================================================
if "!BUILD_SERVICE_ONLY!"=="0" (
    echo [1/3] Building frontend...
    cd /d "%PROJECT_ROOT%"
    call npm run build
    if errorlevel 1 (
        echo Frontend build failed!
        exit /b 1
    )

    REM ============================================================
    REM  Step 2: Build Rust (Tauri desktop - current platform only)
    REM  Rust toolchain only supports current platform, output goes to x86_64
    REM ============================================================
    echo [2/3] Building Rust ^(current platform, %BUILD_CONFIG%^)...

    if exist "%SRC_TAURI%\dist" rmdir /s /q "%SRC_TAURI%\dist"
    xcopy /E /I /Y "%FRONTEND_DIST%" "%SRC_TAURI%\dist\"
    if not exist "%SRC_TAURI%\dist\index.html" (
        echo ERROR: src-tauri\dist\index.html not found!
        exit /b 1
    )

    cd /d "%SRC_TAURI%"
    call cargo build !CARGO_FLAG! --features custom-protocol
    if errorlevel 1 (
        echo Rust build failed!
        exit /b 1
    )
    echo   - Rust OK
    cd /d "%PROJECT_ROOT%"
) else (
    echo [1/3] Skipping frontend (service-only)
    echo [2/3] Skipping Rust   (service-only)
)

REM ============================================================
REM  Step 3: Build Go service for each target
REM ============================================================
echo [3/3] Building Go service...

for %%T in (!TARGET_LIST!) do (
    call :build_target "%%T"
    if errorlevel 1 (
        echo ERROR: Build failed for target %%T
        exit /b 1
    )
)

echo.
echo ============================================
echo   Build complete! ^(%BUILD_CONFIG%^)
echo ============================================
echo.
echo Output:
for /d %%a in ("%OUT_ROOT%\*") do (
    echo   %%~nxa:
    for %%f in ("%%a\ClamAI*") do echo     %%~nxf  ^(%%~zf bytes^)
    echo.
)

endlocal
exit /b 0

REM ============================================================
REM  Subroutine: build_target
REM  Target: x86_64-win | x86_64-linux | arm64-win | arm64-linux
REM ============================================================
:build_target
set "TGT=%~1"

if "%TGT%"=="x86_64-win" (
    set "B_GOOS=windows"
    set "B_GOARCH=amd64"
    set "B_OUT=ClamAI-service.exe"
    set "B_ARCHDIR=x86_64"
    set "B_COPY_RUST=1"
)
if "%TGT%"=="x86_64-linux" (
    set "B_GOOS=linux"
    set "B_GOARCH=amd64"
    set "B_OUT=ClamAI-service"
    set "B_ARCHDIR=x86_64"
    set "B_COPY_RUST=0"
)
if "%TGT%"=="arm64-win" (
    set "B_GOOS=windows"
    set "B_GOARCH=arm64"
    set "B_OUT=ClamAI-service.exe"
    set "B_ARCHDIR=arm64"
    set "B_COPY_RUST=0"
)
if "%TGT%"=="arm64-linux" (
    set "B_GOOS=linux"
    set "B_GOARCH=arm64"
    set "B_OUT=ClamAI-service"
    set "B_ARCHDIR=arm64"
    set "B_COPY_RUST=0"
)

if not defined B_GOOS (
    echo   WARNING: unknown target '%TGT%', skipping
    exit /b 0
)

set "B_DIR=%OUT_ROOT%\%B_ARCHDIR%"

if "%BUILD_CONFIG%"=="release" if "%B_GOOS%"=="windows" (
    set "B_LDFLAGS=-H windowsgui"
) else (
    set "B_LDFLAGS="
)

echo   - %TGT% = %B_GOOS%/%B_GOARCH% -^> %B_ARCHDIR%\%B_OUT%

if not exist "%B_DIR%" mkdir "%B_DIR%"

if exist "%B_DIR%\clamai.db" (
    copy /Y "%B_DIR%\clamai.db" "%B_DIR%\clamai.db.bak" >nul 2>&1
)

setlocal
set CGO_ENABLED=0
set GOOS=%B_GOOS%
set GOARCH=%B_GOARCH%
pushd "%PROXY_SERVICE%"
go build -ldflags="%B_LDFLAGS%" -o "%B_DIR%\%B_OUT%" .
popd
endlocal

if errorlevel 1 (
    echo     ERROR: Go build failed
    exit /b 1
)
echo     OK

if exist "%B_DIR%\clamai.db.bak" (
    copy /Y "%B_DIR%\clamai.db.bak" "%B_DIR%\clamai.db" >nul 2>&1
    del /F /Q "%B_DIR%\clamai.db.bak" >nul 2>&1
)

if "!BUILD_SERVICE_ONLY!"=="0" if "%B_COPY_RUST%"=="1" (
    copy /Y "%SRC_TAURI%\target\!RUST_TARGET_DIR!\ClamAI.exe" "%B_DIR%\ClamAI.exe" >nul
    echo     Copied ClamAI.exe
)

set "B_GOOS="
set "B_GOARCH="
set "B_OUT="
set "B_DIR="
set "B_ARCHDIR="
set "B_LDFLAGS="
set "B_COPY_RUST="

exit /b 0
