# ClamAI Proxy Service Tests

## Prerequisites
- Python 3.7+
- requests library: `pip install requests`
- Go 1.21+ (for unit tests)

## Quick Start

### Integration Tests (API)
1. Start the proxy service:
   ```
   ClamAI-service.exe --port 8080 --admin-port 8081
   ```
2. Run the test script:
   ```
   tests\run_tests.bat
   ```
   Or directly:
   ```
   python tests\api_tests.py
   ```

### Go Unit Tests
```
cd proxy-service
go test -v ./...
```

## What's Tested
- Health endpoint connectivity
- Auth status endpoints
- Auth protection on admin routes (401/403 for unauthenticated)
- CORS security (no wildcard origin reflection on /v1/ routes)
- Proxy route error response format (OpenAI-compatible)
- Error sanitization (no internal details leaked)
- Security/Ratelimit/Stats/Analysis/Agent route auth enforcement
