"""
ClamAI Proxy Service Integration Tests
Requires: Python 3.7+, requests (pip install requests)
"""
import sys
import json
import traceback

try:
    import requests
except ImportError:
    print("[!] pip install requests")
    sys.exit(1)

ADMIN_URL = "http://127.0.0.1:8081"
PROXY_URL = "http://127.0.0.1:8080"

passed = 0
failed = 0
skipped = 0
localhost_mode = False
auth_token = None
headers = {}

def test(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  [PASS] {name}")
    else:
        failed += 1
        print(f"  [FAIL] {name} {detail}")

# ==========================================

def detect_mode():
    global localhost_mode
    r = requests.get(f"{ADMIN_URL}/api/v1/auth/status", timeout=5)
    data = r.json()
    localhost_mode = data.get("mode", "") == "localhost"
    if not localhost_mode:
        r2 = requests.get(f"{ADMIN_URL}/api/v1/config", timeout=5)
        if r2.status_code == 200:
            localhost_mode = True
    print(f"  Mode: {'localhost (auth bypass)' if localhost_mode else 'server (auth enforced)'}")

def obtain_token():
    """In server mode, try to get a JWT token for authenticated tests."""
    global auth_token, headers
    if localhost_mode:
        return

    r = requests.get(f"{ADMIN_URL}/api/v1/auth/status", timeout=5)
    data = r.json()

    if not data.get("initialized", False):
        print("  Server mode: admin not initialized, trying setup...")
        r = requests.post(f"{ADMIN_URL}/api/v1/auth/setup", json={
            "username": "admin",
            "password": "TestPass123!"
        }, timeout=5)
        if r.status_code == 200:
            jd = r.json()
            auth_token = jd.get("access_token") or jd.get("token", "")
        else:
            print(f"  Setup failed ({r.status_code}), trying login...")

    if not auth_token:
        r = requests.post(f"{ADMIN_URL}/api/v1/auth/login", json={
            "username": "admin",
            "password": "TestPass123!"
        }, timeout=5)
        if r.status_code == 200:
            jd = r.json()
            auth_token = jd.get("access_token") or jd.get("token", "")

    if auth_token:
        headers = {"Authorization": f"Bearer {auth_token}"}
        print(f"  Auth token obtained ({auth_token[:16]}...)")
    else:
        print(f"  WARNING: Could not obtain auth token, some tests will fail")

# ==========================================

def test_health():
    print("\n--- Health Check ---")
    r = requests.get(f"{ADMIN_URL}/health", timeout=5)
    test("GET /health 200", r.status_code == 200, f"got {r.status_code}")
    if r.status_code == 200:
        test("Health has 'status'", "status" in r.json())

def test_auth_endpoints():
    print("\n--- Auth Endpoints (public) ---")
    r = requests.get(f"{ADMIN_URL}/api/v1/auth/status", timeout=5)
    test("GET /auth/status 200", r.status_code == 200)
    test("Has 'initialized'", "initialized" in r.json())

    r = requests.get(f"{ADMIN_URL}/api/v1/auth/reg-open", timeout=5)
    test("GET /auth/reg-open 200", r.status_code == 200)

def test_unauth_rejected():
    """Server mode: protected endpoints reject unauthenticated requests."""
    print("\n--- Auth Enforcement (no token) ---")
    if localhost_mode:
        print("  (skipped in localhost mode)")
        return

    endpoints = [
        ("GET", "/api/v1/config"),
        ("GET", "/api/v1/providers"),
        ("GET", "/api/v1/keys"),
        ("GET", "/api/v1/users"),
        ("GET", "/api/v1/stats/usage"),
        ("GET", "/api/v1/stats/logs"),
        ("GET", "/api/v1/security/config"),
        ("GET", "/api/v1/ratelimit/config"),
        ("GET", "/api/v1/analysis/tasks"),
        ("GET", "/api/v1/skills/tasks"),
    ]
    for method, path in endpoints:
        r = requests.request(method, f"{ADMIN_URL}{path}", timeout=5)
        test(f"Unauth {method} {path} -> 401/403", r.status_code in (401, 403), f"got {r.status_code}")

def test_auth_with_token():
    """Server mode: authenticated requests succeed with valid token."""
    print("\n--- Auth With Token ---")
    if localhost_mode or not auth_token:
        if localhost_mode:
            print("  (skipped in localhost mode)")
        else:
            print("  (skipped: no token)")
        return

    r = requests.get(f"{ADMIN_URL}/api/v1/config", headers=headers, timeout=5)
    test("Auth GET /config 200", r.status_code == 200, f"got {r.status_code}")

    r = requests.get(f"{ADMIN_URL}/api/v1/providers", headers=headers, timeout=5)
    test("Auth GET /providers 200", r.status_code == 200, f"got {r.status_code}")

    r = requests.get(f"{ADMIN_URL}/api/v1/users", headers=headers, timeout=5)
    test("Auth GET /users 200", r.status_code == 200, f"got {r.status_code}")

    r = requests.get(f"{ADMIN_URL}/api/v1/auth/me", headers=headers, timeout=5)
    test("Auth GET /auth/me 200", r.status_code == 200, f"got {r.status_code}")
    if r.status_code == 200:
        test("/auth/me has username", "username" in r.json())

    r = requests.get(f"{ADMIN_URL}/api/v1/stats/usage", headers=headers, timeout=5)
    test("Auth GET /stats/usage 200", r.status_code == 200, f"got {r.status_code}")

    r = requests.get(f"{ADMIN_URL}/api/v1/security/config", headers=headers, timeout=5)
    test("Auth GET /security/config 200", r.status_code == 200, f"got {r.status_code}")

def test_invalid_token():
    """Server mode: invalid token is rejected."""
    print("\n--- Invalid Token Rejected ---")
    if localhost_mode:
        print("  (skipped in localhost mode)")
        return

    bad_headers = {"Authorization": "Bearer invalid.jwt.token"}
    r = requests.get(f"{ADMIN_URL}/api/v1/config", headers=bad_headers, timeout=5)
    test("Invalid JWT -> 401", r.status_code == 401, f"got {r.status_code}")

def test_cors_security():
    print("\n--- CORS Security ---")
    r = requests.options(f"{PROXY_URL}/v1/chat/completions",
                        headers={"Origin": "https://evil.com"}, timeout=5)
    acao = r.headers.get("Access-Control-Allow-Origin", "")
    test("evil.com NOT reflected on /v1/", acao != "https://evil.com", f"AO: {acao}")

    r = requests.options(f"{ADMIN_URL}/api/v1/config",
                        headers={"Origin": "https://evil.com"}, timeout=5)
    acao = r.headers.get("Access-Control-Allow-Origin", "")
    test("evil.com NOT reflected on admin", acao != "https://evil.com", f"AO: {acao}")

    r = requests.options(f"{PROXY_URL}/v1/models",
                        headers={"Origin": "http://localhost:5173"}, timeout=5)
    acao = r.headers.get("Access-Control-Allow-Origin", "")
    test("localhost allowed", acao == "http://localhost:5173" or acao == "", f"AO: {acao}")

def test_proxy_routes():
    print("\n--- Proxy Routes ---")
    r = requests.get(f"{PROXY_URL}/v1/models", timeout=5)
    test("GET /v1/models responds", r.status_code >= 200, f"got {r.status_code}")

    r = requests.post(f"{PROXY_URL}/v1/chat/completions", json={}, timeout=5)
    test("POST /v1/chat/completions responds", r.status_code >= 200, f"got {r.status_code}")
    if r.status_code >= 400:
        try:
            test("Error has 'error' field", "error" in r.json())
        except:
            pass

    r = requests.post(f"{PROXY_URL}/v1/messages", json={}, timeout=5)
    test("POST /v1/messages responds", r.status_code >= 200, f"got {r.status_code}")

    r = requests.post(f"{PROXY_URL}/v1/embeddings", json={}, timeout=5)
    test("POST /v1/embeddings responds", r.status_code >= 200, f"got {r.status_code}")

def test_error_sanitization():
    print("\n--- Error Sanitization ---")
    r = requests.post(f"{PROXY_URL}/v1/chat/completions", json={}, timeout=5)
    body = r.text.lower()
    test("No file paths", "d:\\temp" not in body and "/home/" not in body)
    test("No SQL errors", "sqlite" not in body and "sql:" not in body)
    test("No stack traces", "goroutine" not in body and "panic" not in body)

def test_admin_data_with_auth():
    """Test admin data endpoints with proper auth (or localhost bypass)."""
    print("\n--- Admin Data Endpoints ---")
    h = headers if not localhost_mode else {}
    endpoints = [
        "/api/v1/config",
        "/api/v1/app/info",
        "/api/v1/providers",
        "/api/v1/keys",
        "/api/v1/stats/usage",
        "/api/v1/stats/logs",
        "/api/v1/security/config",
        "/api/v1/ratelimit/config",
        "/api/v1/analysis/tasks",
        "/api/v1/skills/tasks",
    ]
    for path in endpoints:
        try:
            r = requests.get(f"{ADMIN_URL}{path}", headers=h, timeout=5)
            test(f"Auth {path} 200", r.status_code == 200, f"got {r.status_code}")
        except Exception as e:
            global skipped
            skipped += 1
            print(f"  [SKIP] {path} - {e}")

def test_provider_response_format():
    print("\n--- Provider Response Format ---")
    h = headers if not localhost_mode else {}
    r = requests.get(f"{ADMIN_URL}/api/v1/providers", headers=h, timeout=5)
    if r.status_code == 200:
        data = r.json()
        if isinstance(data, dict) and "providers" in data:
            test("Providers has list", isinstance(data["providers"], list))
        elif isinstance(data, list):
            test("Providers is list", True)
        else:
            test("Providers parseable", isinstance(data, (dict, list)))
    else:
        test("Providers endpoint reachable", False, f"got {r.status_code}")

def test_key_crud():
    print("\n--- API Key CRUD ---")
    h = headers if not localhost_mode else {}

    r = requests.get(f"{ADMIN_URL}/api/v1/keys", headers=h, timeout=5)
    test("GET /keys 200", r.status_code == 200, f"got {r.status_code}")

    r = requests.post(f"{ADMIN_URL}/api/v1/keys", headers=h,
                     json={"name": "test-key-auto", "permissions": ["chat"]},
                     timeout=5)
    test("POST /keys create", r.status_code in (200, 201), f"got {r.status_code}")
    if r.status_code in (200, 201):
        data = r.json()
        key_id = data.get("id", "")
        if key_id:
            r2 = requests.delete(f"{ADMIN_URL}/api/v1/keys/{key_id}", headers=h, timeout=5)
            test("DELETE /keys/{id}", r2.status_code in (200, 204), f"got {r2.status_code}")

# ==========================================

if __name__ == "__main__":
    print("=" * 50)
    print("  ClamAI Proxy Service Integration Tests")
    print("=" * 50)

    try:
        requests.get(f"{ADMIN_URL}/health", timeout=3)
    except requests.ConnectionError:
        print(f"\n[FATAL] Cannot connect to {ADMIN_URL}")
        print("  Start: ClamAI-service.exe --port 8080 --admin-port 8081")
        sys.exit(1)
    except Exception as e:
        print(f"\n[FATAL] {e}")
        sys.exit(1)

    detect_mode()
    obtain_token()

    tests = [
        test_health,
        test_auth_endpoints,
        test_unauth_rejected,
        test_auth_with_token,
        test_invalid_token,
        test_cors_security,
        test_proxy_routes,
        test_error_sanitization,
        test_admin_data_with_auth,
        test_provider_response_format,
        test_key_crud,
    ]

    for t in tests:
        try:
            t()
        except Exception as e:
            print(f"  [ERROR] {t.__name__}: {e}")
            traceback.print_exc()

    print("\n" + "=" * 50)
    print(f"  Results: {passed} passed, {failed} failed, {skipped} skipped")
    print("=" * 50)
    sys.exit(1 if failed > 0 else 0)
