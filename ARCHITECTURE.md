# ClamAI Technical Architecture Document
## 1. Project Overview

ClamAI is an intelligent LLM gateway system that provides:
- Multi-provider model routing (OpenAI, Anthropic, Gemini, DeepSeek, etc.)
- API key management and rotation
- Rate limiting and quota control
- Security content filtering
- Usage analytics and logging
- User management
- Two deployment modes: PC Mode (local) and Server Mode (remote)

## 2. Project Structure

`
ClamAI/
|-- src/                          # React + TypeScript Frontend
|   |-- api/                      # Frontend API Layer
|   |   |-- client.ts             # HTTP client with auth token management
|   |   |-- auth.ts              # Authentication API calls
|   |   |-- setup.ts             # Setup wizard API calls
|   |   |-- config.ts            # Configuration API calls
|   |   |-- providers.ts         # Provider management API
|   |   |-- keys.ts              # API key management
|   |   |-- users.ts             # User management API
|   |   |-- stats.ts             # Statistics API
|   |   |-- security.ts           # Security features API
|   |   |-- rate-limit.ts         # Rate limiting API
|   |   |-- analysis.ts           # Analysis tasks API
|   |-- context/                  # React Context for State Management
|   |   |-- AuthContext.tsx      # Authentication state
|   |   |-- SetupContext.tsx     # Setup wizard state
|   |   |-- AppContext.tsx       # Application state
|   |   |-- UserContext.tsx      # Current user state
|   |   |-- I18nContext.tsx      # Internationalization
|   |   |-- ApiKeySecretsContext.tsx
|   |-- pages/                    # React Page Components
|   |   |-- Dashboard.tsx        # Main dashboard
|   |   |-- SetupWizard.tsx       # First-time setup wizard
|   |   |-- Login.tsx            # Login page
|   |   |-- Providers.tsx         # AI provider management
|   |   |-- Models.tsx           # Model listing
|   |   |-- ApiKeys.tsx          # API key management
|   |   |-- Settings.tsx          # Application settings
|   |   |-- Logs.tsx             # Request logs
|   |   |-- Security.tsx          # Security configuration
|   |   |-- SecuritySquare.tsx    # Security dashboard
|   |   |-- RateLimit.tsx         # Rate limit config
|   |   |-- UserManagement.tsx    # User management
|   |   |-- OAuth.tsx            # OAuth integration
|   |-- components/               # Shared UI Components
|   |   |-- Layout.tsx           # Main layout with sidebar
|   |   |-- StatusBar.tsx        # Status bar
|   |   |-- ConnectBanner.tsx     # Connection status banner
|   |-- security-apps/            # Security Analysis Apps
|   |-- lib/                     # Utility libraries
|   |-- styles/                  # CSS styles
|   |-- App.tsx                  # Root React component
|   |-- main.tsx                 # React entry point
|
|-- src-tauri/                    # Rust + Tauri Backend
|   |-- src/                     # Rust source code
|   |   |-- main.rs              # Tauri application entry
|   |   |-- commands.rs          # Tauri IPC command handlers
|   |   |-- config.rs            # Configuration management
|   |   |-- services.rs          # Service lifecycle management
|   |   |-- proxy.rs            # Proxy service spawner
|   |   |-- oauth.rs             # OAuth integration
|   |   |-- error.rs             # Error types
|   |
|   |-- proxy-service/            # Go-based Proxy Service
|   |   |-- main.go             # Entry point, routing, middleware
|   |   |-- auth.go             # Authentication and JWT handlers
|   |   |-- frontend_server.go  # WebUI serving (server mode)
|   |   |-- frontend_stub.go    # Stub when server mode disabled
|   |   |-- config_api.go       # Configuration API handlers
|   |   |-- db.go               # Database initialization
|   |   |-- db_adapter.go       # DB driver abstraction
|   |   |-- db_settings.go      # Settings helpers
|   |   |-- providers.go        # AI provider implementations
|   |   |-- proxy_client.go      # Proxy request handling
|   |   |-- security.go          # Security filtering
|   |   |-- vector.go           # Vector DB integration
|   |   |-- ratelimit.go        # Rate limiting
|   |   |-- tls.go              # TLS certificate handling
|   |   |-- go.mod              # Go module definition
|   |
|   |-- icons/                   # Application icons
|   |-- build.rs                 # Tauri build script
|   |-- Cargo.toml               # Rust dependencies
|   |-- tauri.conf.json          # Tauri configuration
|
|-- package.json                  # Node.js dependencies
|-- vite.config.ts              # Vite bundler config
|-- tsconfig.json                # TypeScript config
|-- tailwind.config.js          # Tailwind CSS config
|-- build.bat                   # Windows build script
|-- build-dev.bat               # Windows dev build
|-- _build-common.bat           # Shared build logic
|-- VERSION                     # Version file

## 3. Multi-Mode Architecture

### 3.1 PC Mode (Local)

In PC Mode, the Rust application (ClamAI.exe) spawns a local Go proxy service (ClamAI-service.exe):

`
ClamAI.exe (Rust/Tauri)
    |-- ConfigManager (JSON config file)
    |-- ServiceManager (spawns/kills proxy)
    |-- TokenStore (JWT tokens)
    |
    +--> IPC (invoke)
           |
           +--> ClamAI-service.exe (Go binary)
                    |-- Admin Port 8081 (WebUI/API)
                    |-- Proxy Port 8080 (AI tools)
`

**Flow:**
1. Rust app reads config from ~/.config/clamai/config.json
2. If deploy_mode==pc and setup_complete==true, spawns ClamAI-service.exe
3. Go service listens on configurable ports
4. Frontend communicates via Tauri IPC -> Rust -> HTTP to Go admin port

### 3.2 Server Mode (Remote)

In Server Mode, the Rust app connects to a remote running ClamAI-service instance:

`
ClamAI.exe (Rust)               Remote Server
    |-- ConfigManager              ClamAI-service.exe
    |   remote_service_url  -------> Admin API (:8081)
    |   remote_proxy_url    -------> Proxy API (:8080)
    |
    +--> TokenStore
            (manages refresh)
`

**Flow:**
1. Rust app reads config with remote URLs
2. Connects to remote admin API for management
3. AI tools connect directly to remote proxy API
4. Token refresh handled by Rust app

### 3.3 Host Binding Modes

| Host Value | PC Mode | Server Mode |
|------------|---------|------------|
| 127.0.0.1 | Local only | Localhost only |
| 0.0.0.0 | WebUI on admin port | WebUI + remote admin enabled |

**Critical**: When host=0.0.0.0, WebUI served at http://server:8081/admin/

## 4. Data Flow Paths

### 4.1 Frontend to Backend (Management)

`
Browser (React)
    |
    | HTTPS/HTTP
    v
Go Proxy Service - Admin Port (8081)
    |
    +--> adminRouter: /api/v1/*
           |
           +--> Middleware Chain:
           |       1. stripInternalHeaders
           |       2. corsMiddleware
           |       3. apiLoggingMiddleware
           |       4. rateLimitMiddleware
           |       5. adminAuthMiddleware
           |       6. securityMiddleware
           |       7. requestTrackingMiddleware
           |       8. authMiddleware
           |
           +--> Handlers: auth, config, providers, keys, users, stats, etc.
`

### 4.2 AI Tool to Proxy (Model API)

`
AI Tool (OpenAI SDK compatible)
    |
    | POST /v1/chat/completions
    | Authorization: Bearer <API_KEY>
    v
Go Proxy Service - Proxy Port (8080)
    |
    +--> router: /v1/*
           |
           +--> Middleware Chain:
           |       1. stripHeaders
           |       2. corsMiddleware
           |       3. loggingMiddleware
           |       4. rateLimitMiddleware
           |       5. securityMiddleware
           |       6. trackingMiddleware
           |       7. authMiddleware
           |
           +--> Handlers: chat/completions, embeddings, models
                  |
                  +--> Model Resolution: openai:gpt-4 -> OpenAI Provider
                         |
                         +--> External AI Provider API
`

### 4.3 Tauri IPC Flow (PC Mode)

`
React Component
    |
    | await invoke(command_name, args)
    v
Rust (Tauri) - commands.rs
    |
    +--> get_proxy_status() -> ServiceManager
    +--> complete_setup_with_config() -> Config + Spawn
    +--> start_proxy_service() -> ServiceManager
    +--> other commands...
           |
           | HTTP to Go admin port (internal)
           v
    ClamAI-service.exe (spawned)
           |
           +--> Admin API handlers
`

## 5. API Design

### 5.1 Admin API (Port 8081)

**Authentication Endpoints** (/api/v1/auth/*)

| Method | Path | Description | Auth Required |
|--------|------|-------------|---------------|
| GET | /auth/status | Check if admin initialized, mode, registration | No |
| POST | /auth/setup | Create initial admin account | No |
| POST | /auth/login | Login with username/password | No |
| POST | /auth/register | Register new user (if open) | No |
| GET | /auth/reg-open | Check if registration open | No |
| POST | /auth/token | Get token (localhost no-password) | No |
| POST | /auth/refresh | Refresh access token | No |
| GET | /auth/me | Get current user info | Yes |
| POST | /auth/change-password | Change password | Yes |

**Configuration Endpoints** (/api/v1/config/*)

| Method | Path | Description |
|--------|------|-------------|
| GET | /config | Get full configuration |
| PUT | /config | Save full configuration |
| POST | /config/reset | Reset to defaults |

**Provider Endpoints** (/api/v1/providers/*)

| Method | Path | Description |
|--------|------|-------------|
| GET | /providers | List all providers |
| POST | /providers | Add new provider |
| POST | /providers/test | Test connection |
| PUT | /providers/{name}/key | Set API key |
| PUT | /providers/{id} | Update provider |
| DELETE | /providers/{id} | Delete provider |

**API Key Endpoints** (/api/v1/api-keys/*, /api/v1/keys/*)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api-keys | List API keys |
| POST | /api-keys | Create API key |
| PUT | /api-keys/{id} | Update API key |
| DELETE | /api-keys/{id} | Delete API key |
| GET | /keys/{id}/reveal | Reveal key value |

**Stats Endpoints** (/api/v1/stats/*)

| Method | Path | Description |
|--------|------|-------------|
| GET | /stats/usage?period=N | Usage statistics |
| GET | /stats/logs | Recent request logs |
| GET | /stats/alerts | Security alert stats |
| GET | /stats/callers | Top 10 callers |
| GET | /stats/security-tokens | Token stats |

**User Endpoints** (/api/v1/users/*)

| Method | Path | Description |
|--------|------|-------------|
| GET | /users | List users |
| POST | /users | Create user |
| PUT | /users/{id} | Update user |
| DELETE | /users/{id} | Delete user |
| POST | /users/{id}/reset-password | Reset password |
| PUT | /users/settings/registration | Set registration open |

### 5.2 Proxy API (Port 8080) - OpenAI Compatible

| Method | Path | Description |
|--------|------|-------------|
| POST | /v1/chat/completions | Chat completions |
| POST | /v1/completions | Text completions |
| POST | /v1/embeddings | Embeddings |
| GET | /v1/models | List available models |
| POST | /v1/messages | Anthropic messages API |
| POST | /v1/messages/count_tokens | Count tokens |

### 5.3 Request/Response Examples

**Create API Key:**
`json
// POST /api/v1/api-keys
// Request:
{  name: my-key, allowed_models: [openai:gpt-4], provider_keys: {} }
// Response (201):
{ id: key_abc123, key: clam-sk-xxx, name: my-key }
`

**Auth Setup:**
`json
// POST /api/v1/auth/setup
// Request: { username: admin, password: secretpass123 }
// Response:
{ success: true, access_token: eyJ..., refresh_token: rt-xxx, expires_in: 7200 }
`

## 6. Authentication Flow

### 6.1 JWT Token System

- Access Token: 2 hours expiry
- Refresh Token: 30 days expiry, one-time use

**JWT Claims:**
`go
type UserClaims struct {
    UserID   string  // user id
    Username string  // username
    Role     string  // admin or user
}
`

### 6.2 Auth Middleware Flow

`
Request arrives
    |
    +--> Path in noAuthPaths? --> Yes --> Pass through
    |
    +--> Host 127.0.0.1 + localhost bypass? --> Yes --> Pass through
    |
    +--> Bearer token present?
    |       +--> Valid JWT? --> Yes --> Check admin for admin paths
    |       |                    +--> Pass or 403
    |       +--> No/Invalid --> Check API key header
    |                           +--> Matches config.APIKey? --> Yes --> Pass
    |
    +--> No valid auth --> 401 Unauthorized
`

### 6.3 Token Refresh Flow

`
1. Client sends request with expired access token
2. Gets 401 response
3. Client calls POST /auth/refresh with refresh_token
4. Server validates refresh token (not expired, not consumed)
5. Token consumed (one-time use)
6. New token pair issued
7. Client retries with new access token
`

### 6.4 Auto-Login (PC Mode Only)

Localhost access allows password-less token:
`go
// auth.go handleGetToken()
if p.config.Host ==  127.0.0.1 && isLocalhost(r) && req.Password ==  {
 return issueTokenPair(username) // No password verification
}
`

### 6.5 Auth Context (Frontend)

` ypescript
interface AuthContextType {
 token: string | null,
 isAuthenticated: boolean,
 isInitialized: boolean, // Auth check completed
 initialized: boolean, // Admin account exists
 mode: string, // pc or server
 registrationOpen: boolean,
 login, setup, register, logout, changePassword, handleAuthExpired, refreshAuth
}
`

## 7. Database Schema

### 7.1 Database Support

- Primary: SQLite (clamai.db in executable directory)
- Optional: PostgreSQL (via CLAMAI_DATABASE_URL env var, server mode)

### 7.2 Core Tables

**users** - User accounts
- id, username, display_name, password_hash, role, status, created_at, updated_at, last_login_at

**admin_users** - Legacy admin table (migrated to users)

**refresh_tokens** - Active sessions
- token (PK), username, expires_at, created_at

**system_settings** - Key-value configuration
- key (PK), value

**user_settings** - Per-user settings
- user_id, key, value (PK composite)

**providers** - AI provider configurations
- id, name, provider_type, auth_type, enabled, base_url, api_key, models, disabled_models, oauth_config, rate_limits, priority, created_by, created_at, updated_at

**model_mappings** - Model aliases
- alias (PK), provider_id, model, description

**api_keys** - Gateway API keys
- id, key, name, user_id, allowed_models, provider_keys, created_at, active, request_count, last_used

**request_logs** - Request records
- id, timestamp, provider, model, input_tokens, output_tokens, latency_ms, success, error_message, client_ip, api_key_used, status_code, path, method, request_content, response_content, user_id, api_key_id

**stats, stats_by_provider, stats_by_model, stats_daily** - Aggregated statistics

**security_config** - Security policy
- id (CHECK=1), config_json

**security_alerts** - Blocked content alerts
- id, timestamp, direction, mode, trigger_type, trigger_detail, content_preview, model, provider, api_key_used, client_ip, action, resolved

**rate_limit_config** - Rate limit rules
- id (CHECK=1), config_json

**analysis_tasks** - Scheduled analysis tasks
- id, task_no, name, api_key_id, model, time_range, schedule_type, interval_minutes, status, last_run_at, next_run_at, created_at, result_*, progress, created_by

**skills_tasks** - Skills detection tasks
- id, task_no, name, model, source_type, source_info, schedule_type, status, progress, last_run_at, created_at, result_*, created_by

**skills_detection_history** - Detection records
- id, checked_at, source_type, source_info, result, risk_level, model_used, api_key_id, created_by

**profile_analysis_history** - User profile analyses
- id, analyzed_at, api_key_id, time_range, risk_level, summary, result, model_used, logs_analyzed, created_by

**profiles** - Configuration profiles
- id, name, providers_json, mappings_json, gateway_json, advanced_json, service_json, is_active, created_at, updated_at

### 7.3 Key Relationships

`
users (1) <-- (N) api_keys         // Users create API keys
users (1) <-- (N) user_settings   // User preferences
users (1) <-- (N) refresh_tokens  // User sessions
providers (1) <-- (N) api_keys    // Keys reference providers
providers (1) <-- (N) model_mappings
api_keys (1) <-- (N) request_logs  // Logs tagged with API key
`

## 8. Build System

### 8.1 Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite |
| Desktop Shell | Tauri 1.5 (Rust) |
| Proxy Service | Go 1.21+ |
| Database | SQLite (embedded) / PostgreSQL (optional) |
| Styling | Tailwind CSS |
| State | React Context + Zustand |
| HTTP Client | Axios + Fetch |
| Routing | React Router 6 |
| Data Fetching | TanStack Query |

### 8.2 Build Commands

`ash
# Development
npm run tauri:dev        # Start Vite dev + Tauri dev
npm run dev              # Frontend only

# Production
npm run tauri:build      # Full Tauri build (frontend + Rust)
npm run build            # Frontend only (TypeScript + Vite)

# Go service standalone build
cd src-tauri/proxy-service

# WITHOUT frontend (stub):
go build -o ClamAI-service.exe

# WITH embedded frontend (server mode):
go build -tags server -o ClamAI-service.exe
`

### 8.3 CRITICAL: Go Build Tags

The Go proxy service uses build tags to control WebUI embedding:

`go
// frontend_server.go
//go:build server
// +build server
// This file compiled ONLY with -tags server

// frontend_stub.go
//go:build !server
// +build !server
// This file compiled when WITHOUT -tags server
`

### 8.4 Output Binaries

| Binary | Purpose | Built By |
|--------|---------|----------|
| ClamAI.exe | Desktop app (Rust+Tauri) | npm run tauri:build |
| ClamAI-service.exe | Proxy service (Go) | go build in proxy-service/ |

### 8.5 Frontend Embedding Path

`go
//go:embed frontend/dist/*
var frontendFS embed.FS
`

The dist folder must exist at: src-tauri/proxy-service/frontend/dist/

## 9. First-Time Setup Flow Analysis

### 9.1 Setup Wizard Steps

**Step 1: Mode Selection**
- PC Mode: Local service on this machine
- Server Mode: Connect to remote service

**Step 2: Service Configuration**

PC Mode:
- Protocol: HTTP or HTTPS (self-signed)
- Host: 127.0.0.1 (local) or 0.0.0.0 (accessible)
- Proxy Port: For AI tools (default 8080)
- Admin Port: For management (default 8081)

Server Mode:
- Admin URL: Remote admin endpoint
- Proxy URL: Remote proxy endpoint (optional)

**Step 3: Admin Initialization**
- Create admin username/password (if not exists)
- For remote already initialized: Skip

### 9.2 PC Mode First-Time Flow

`	ypescript
// SetupWizard.tsx handleComplete() for PC mode

1. completeSetup({
     deploy_mode:  pc,
     port: proxyPort,
     admin_port: adminPort,
     use_tls: protocol === https,
     host: host,
     remote_url: null,
     remote_proxy_url: null
   })
   |
   +--> Tauri invoke: complete_setup_with_config
   |
   +--> Rust: update config.json with setup_complete=true
   |
   +--> Rust: spawn ClamAI-service.exe with --host=host
   |
   +--> Go: Initialize database, start HTTP servers

2. setupAdmin(username, password)
   |
   +--> POST /api/v1/auth/setup
   |
   +--> Go: createAdmin() - hash password, insert to DB
   |
   +--> Issue JWT token pair
   |
   +--> Frontend: store tokens, setAuthenticated=true

3. onComplete() -> checkSetup() -> render main app
`

### 9.3 Server Mode First-Time Flow (Remote Deployment)

`	ypescript
// Scenario: Deploy ClamAI-service.exe on a server

1. On server: Run ClamAI-service.exe --host=0.0.0.0 --port=8080 --admin-port=8081

2. From remote PC: Open browser to http://server:8081/admin/
   - Requires Go service built with -tags server!
   - Otherwise, frontend not embedded

3. Frontend calls GET /api/v1/auth/status
   - Response: { initialized: false, mode: server }

4. Setup wizard shows Remote Mode flow

5. User enters server URL, clicks Verify
   - POST /api/v1/auth/setup (if not initialized)
   - Creates admin account

6. completeSetup() saves remote URLs to local config

7. Future logins use stored credentials + refresh tokens
`

### 9.4 Frontend Flow (App.tsx)

`	ypescript
function AppContent() {
    const { isAuthenticated, isInitialized, initialized, refreshAuth } = useAuth();
    const { setupComplete, setupChecked, connected, checkSetup } = useSetup();

    if (!isInitialized || !setupChecked) {
        return <Loading />;
    }

    if (!setupComplete) {
        return <SetupWizard onComplete={handleSetupComplete} />;
    }

    if (isAuthenticated) {
        return <MainApp />;
    }

    if (connected && !isAuthenticated) {
        return <Login />;
    }

    return <NotConnected />;
}
`

## 10. Known Blockers for Server Deployment

### 10.1 CRITICAL: WebUI Not Embedded by Default

**Problem:**
The Go proxy service only serves the WebUI when built with the server build tag:

`ash
# This does NOT include the frontend:
go build -o ClamAI-service.exe

# This DOES include the frontend:
go build -tags server -o ClamAI-service.exe
`

**Without -tags server:**
- frontend_stub.go is compiled instead of frontend_server.go
- Accessing /admin/ returns: WebUI not available (build with -tags server to enable)
- Only the API endpoints work

**Impact:**
If a user deploys ClamAI-service.exe from this repo (without rebuilding with -tags server), they CANNOT access the WebUI via browser.

### 10.2 Build Scripts Missing Server Tag

**Problem:**
The build scripts (build.bat, _build-common.bat) do NOT include the -tags server flag when building the Go service.

**Recommendation:**
Build commands should be:
`ash
cd src-tauri/proxy-service
go build -tags server -ldflags=" -s -w\ -o ClamAI-service.exe
`

### 10.3 Frontend Dist Location Requirement

**Problem:**
frontend_server.go embeds files from:
`go
//go:embed frontend/dist/*
var frontendFS embed.FS
`

This path is relative to the Go module root (src-tauri/proxy-service/).

**Requirement:**
For server mode build:
1. Run npm run build to generate frontend/dist
2. Then build Go with -tags server

### 10.4 Deployment Checklist for Server Mode

To properly deploy ClamAI-service.exe on a server:

1. [ ] Build frontend: npm run build
 - Creates src-tauri/proxy-service/frontend/dist/
2. [ ] Build Go service with server tag:
 `ash
 cd src-tauri/proxy-service
 go build -tags server -o ClamAI-service.exe
 `
3. [ ] Copy ClamAI-service.exe to server
4. [ ] Run with host=0.0.0.0 to allow external access:
 `
 ./ClamAI-service.exe --host=0.0.0.0 --port=8080 --admin-port=8081
 `
5. [ ] Open browser to http://server-ip:8081/admin/
6. [ ] Complete setup wizard to create admin account

### 10.5 Alternative: Separate Frontend Hosting

The system supports accessing the admin API directly without embedded WebUI:

- API base URL can be set via remote_service_url
- Frontend can be hosted separately (e.g., CDN, static hosting)
- This requires building the Tauri app for the frontend

### 10.6 Security Considerations for Server Deployment

When deploying with host=0.0.0.0:

1. **Use HTTPS**: Run with --ssl flag for TLS
2. **Strong Admin Password**: Ensure admin password is strong
3. **Network Segmentation**: Consider firewall rules
4. **API Key Authentication**: External AI tool requests use API keys from the database

---

## Appendix A: Key File Reference

### A.1 main.go (Go Entry)

**Key Config struct:**
`go
type Config struct {
 Port string // Proxy port (AI tools)
 AdminPort string // Admin port (WebUI/API)
 Host string // Listen address (127.0.0.1 or 0.0.0.0)
 APIKey string // Static API key (optional)
 LogLevel string // Debug/Info/Warn/Error
 ConfigPath string // Config file path
 ProxyURL string // HTTP/SOCKS5 proxy for upstream
 EnableTLS bool // Use TLS
 TLSCert string // TLS certificate path
 TLSKey string // TLS private key path
}
`

**Key Functions:**
- main() - Parse flags, init logging, create ProxyServer, start HTTP servers
- NewProxyServer() - Initialize all subsystems
- setupRoutes() - Register all HTTP handlers and middleware
- parseFlags() - Command-line argument parsing

### A.2 auth.go (Auth Middleware)

**Key Functions:**
- validateToken() - Parse and verify JWT
- adminAuthMiddleware() - Auth check for admin routes
- issueTokenPair() - Create access + refresh tokens
- consumeRefreshToken() - Validate and consume (one-time use)
- createAdmin() - Create first admin account
- checkLoginRateLimit() - Rate limit login attempts

### A.3 frontend_server.go (WebUI Serving)

`go
func (p *ProxyServer) setupFrontendRoutes() {
 isServer := p.config.Host == 0.0.0.0

 if !isServer {
 return // Skip if not server mode
 }

 // Embed and serve React app from /admin/
 sub, _ := fs.Sub(frontendFS, frontend/dist)
 fileServer := http.FileServer(http.FS(sub))

 // Rewrite /admin/api/* -> /v1/* for API calls
 // Serve index.html for SPA routing
}
`

### A.4 main.rs (Rust Tauri)

`ust
#[tokio::main]
async fn main() {
 // Initialize logging to clam-running.log

 // Create ConfigManager (loads ~/.config/clamai/config.json)
 // Create ServiceManager

 // Auto-start based on config:
 // - PC mode + setup_complete -> spawn local proxy
 // - Server mode + setup_complete -> connect to remote

 // Register Tauri commands:
 // - start_proxy_service, stop_proxy_service
 // - complete_setup_with_config
 // - get_proxy_status
 // - OAuth commands
}
`

### A.5 SetupContext.tsx (Setup State)

` ypescript
interface SetupContextType {
 setupComplete: boolean; // From config.service.setup_complete
 setupChecked: boolean; // Config fetch attempted
 deployMode: string; // pc or server
 serviceUrl: string; // Remote URL (server mode)
 connected: boolean; // Can connect to service
}

const reconnect = async (username?: string, password?: string) => {
 if (deployMode === pc) {
 // Try auto-login
 // If fails, start proxy service via Tauri
 } else {
 // Login to remote with username/password
 }
}
`

---

## Appendix B: API Response Formats

### B.1 Error Response
`json
{
 error: Error message,
 message: Detailed message
}
`

### B.2 Success Response
`json
{
 success: true,
 data: {}
}
`

### B.3 Auth Status Response
`json
{
 initialized: true,
 mode: server,
 has_api_key: false,
 registration_open: false
}
`

---

*Document generated from ClamAI codebase analysis.*
*Version: 1.0*
*Last Updated: 2026-04-27*
