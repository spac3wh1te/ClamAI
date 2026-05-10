@echo off
setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0"
set "SRC_TAURI=%PROJECT_ROOT%src-tauri"
set "PROXY_SERVICE=%PROJECT_ROOT%server"

set "BUILD_DIR=%PROJECT_ROOT%_build"
set "RUST_BUILD=%BUILD_DIR%\rust"
set "GO_BUILD=%BUILD_DIR%\go"

REM ---- args: %1=BUILD_CONFIG (release|debug), %2..=targets ----
set "BUILD_CONFIG=%~1"
shift

set "OUT_ROOT=%PROJECT_ROOT%outputs\%BUILD_CONFIG%"

if "%BUILD_CONFIG%"=="release" (
    set "CARGO_FLAG=--release"
    set "RUST_TARGET_DIR=release"
) else (
    set "CARGO_FLAG="
    set "RUST_TARGET_DIR=debug"
)

set "BUILD_SERVICE_ONLY=0"
set "TARGET_LIST="
set "BUMP_VERSION=0"

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
if /i "%~1"=="--bump-version" (
    set "BUMP_VERSION=1"
    shift
    goto :parse_args
)
set "TARGET_LIST=!TARGET_LIST! %~1"
shift
goto :parse_args

:start_build

REM ============================================================
REM  Clean build directories
REM ============================================================
if exist "%BUILD_DIR%" (
    echo Cleaning build directories...
    rmdir /s /q "%BUILD_DIR%"
)
if exist "%OUT_ROOT%" (
    echo Cleaning output directory...
    rmdir /s /q "%OUT_ROOT%"
)
mkdir "%BUILD_DIR%"
mkdir "%RUST_BUILD%"
mkdir "%GO_BUILD%"
echo.

REM ============================================================
REM  Version: read VERSION file (bump only in CI via --bump-version)
REM ============================================================
if not exist "%PROJECT_ROOT%VERSION" (
    echo 0.1.0> "%PROJECT_ROOT%VERSION"
)
set /p BUILD_VERSION=<%PROJECT_ROOT%VERSION
if not "!BUMP_VERSION!"=="1" goto :skip_bump
for /f "tokens=1,2,3 delims=." %%a in ("!BUILD_VERSION!") do (
    set /a V_PATCH=%%c + 1
    set "BUILD_VERSION=%%a.%%b.!V_PATCH!"
)
echo !BUILD_VERSION!> "%PROJECT_ROOT%VERSION"
echo   Version bumped to !BUILD_VERSION!
:skip_bump

echo ============================================
echo   ClamAI v!BUILD_VERSION! Build ^(%BUILD_CONFIG%^)
echo ============================================
echo   Build:   _build\rust, _build\go
echo   Output:  outputs\%BUILD_CONFIG%
echo.

REM ============================================================
REM  Step 1: Build frontend
REM ============================================================
if not "%BUILD_SERVICE_ONLY%"=="0" goto :skip_frontend
echo [1/3] Building frontend...
cd /d "%PROJECT_ROOT%"
call npm run build
if errorlevel 1 (
    echo Frontend build failed
    exit /b 1
)

REM ============================================================
REM  Step 2: Build Rust (Tauri desktop - current platform only)
REM ============================================================
echo [2/3] Building Rust (current platform, %BUILD_CONFIG%)...

cd /d "%SRC_TAURI%"
set CARGO_TARGET_DIR=%RUST_BUILD%\target
call cargo build !CARGO_FLAG! --features custom-protocol
if errorlevel 1 (
    echo Rust build failed
    exit /b 1
)
echo   - Rust OK
cd /d "%PROJECT_ROOT%"
goto :step3

:skip_frontend
echo [1/3] Skipping frontend (service-only)
echo [2/3] Skipping Rust   (service-only)

:step3

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
echo   Build complete - v%BUILD_VERSION% ^(%BUILD_CONFIG%^)
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
set "GO_STAGE=%GO_BUILD%\%B_GOOS%_%B_GOARCH%"
if not exist "!GO_STAGE!" mkdir "!GO_STAGE!"

REM Copy frontend dist for embed (server build requires it)
if exist "%PROJECT_ROOT%dist" (
    if not exist "%PROXY_SERVICE%\frontend" mkdir "%PROXY_SERVICE%\frontend"
    xcopy /E /I /Y "%PROJECT_ROOT%dist" "%PROXY_SERVICE%\frontend\dist\"
)

pushd "%PROXY_SERVICE%"
go build -ldflags="%B_LDFLAGS% -X main.BuildVersion=%BUILD_VERSION%" -tags server -o "!GO_STAGE!\%B_OUT%" .
popd
if errorlevel 1 (
    echo     ERROR: Go build failed
    endlocal
    exit /b 1
)
echo     OK

REM Copy Go service binary to output directory
copy /Y "!GO_STAGE!\%B_OUT%" "%B_DIR%\%B_OUT%" >nul
echo     Copied %B_OUT% to outputs

if exist "%B_DIR%\clamai.db.bak" (
    copy /Y "%B_DIR%\clamai.db.bak" "%B_DIR%\clamai.db" >nul 2>&1
    del /F /Q "%B_DIR%\clamai.db.bak" >nul 2>&1
)

if "!BUILD_SERVICE_ONLY!"=="0" if "%B_COPY_RUST%"=="1" (
    copy /Y "%RUST_BUILD%\target\%RUST_TARGET_DIR%\clamai.exe" "%B_DIR%\ClamAI.exe" >nul
    echo     Copied ClamAI.exe
)

endlocal

exit /b 0
