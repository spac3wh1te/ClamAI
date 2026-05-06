@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   ClamAI Proxy Service Integration Tests
echo ========================================
echo.

set PROXY_PORT=8080
set ADMIN_PORT=8081
set ADMIN_URL=http://127.0.0.1:%ADMIN_PORT%
set PROXY_URL=http://127.0.0.1:%PROXY_PORT%

echo [1/3] Checking if proxy service is running...
curl -s -o nul -w "%%{http_code}" %ADMIN_URL%/health > %TEMP%\health.txt 2>&1
set /p HEALTH=<%TEMP%\health.txt
if "%HEALTH%"=="200" (
    echo   [OK] Service is running on ports %PROXY_PORT%/%ADMIN_PORT%
) else (
    echo   [FAIL] Service not responding. Start it first: ClamAI-service.exe
    echo   Expected: http://127.0.0.1:%ADMIN_PORT%/health to return 200
    exit /b 1
)
echo.

echo [2/3] Running API tests...
python tests\api_tests.py
if %errorlevel% neq 0 (
    echo.
    echo [FAIL] Some tests failed!
    exit /b 1
)
echo.
echo [3/3] All tests passed!
