package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/mux"
	"golang.org/x/crypto/bcrypt"
)

const jwtSecretEnvKey = "CLAMAI_JWT_SECRET"
const accessTokenExpiry = 2 * time.Hour
const refreshTokenExpiry = 30 * 24 * time.Hour

var jwtSecret []byte

type UserClaims struct {
	UserID   string `json:"user_id"`
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

type AdminClaims = UserClaims

func initJWTSecret() {
	secret := getOrCreateJWTSecret()
	jwtSecret = []byte(secret)
	log.Printf("[INFO] initJWTSecret: JWT secret initialized (%d bytes)", len(jwtSecret))
}

func getOrCreateJWTSecret() string {
	row := db.QueryRow(`SELECT secret_value FROM admin_secrets WHERE key = 'jwt_secret'`)
	var secret string
	if err := row.Scan(&secret); err == nil && secret != "" {
		return secret
	}
	secret = generateAPIKey()
	db.Exec(`INSERT OR REPLACE INTO admin_secrets (key, secret_value) VALUES ('jwt_secret', ?)`, secret)
	return secret
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func checkPassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func generateToken(userID, username, role string, expiry time.Duration) (string, error) {
	claims := UserClaims{
		UserID:   userID,
		Username: username,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiry)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "clamai",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func validateToken(tokenStr string) (*UserClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &UserClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return jwtSecret, nil
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := token.Claims.(*UserClaims); ok && token.Valid {
		return claims, nil
	}
	return nil, fmt.Errorf("invalid token")
}

func isValidJWT(tokenStr string) bool {
	claims, err := validateToken(tokenStr)
	if err != nil {
		return false
	}
	return claims.Role == "admin" || claims.Role == "user"
}

func adminExists() bool {
	if dbAdminExists() {
		return true
	}
	var count int
	db.QueryRow("SELECT COUNT(*) FROM admin_users").Scan(&count)
	return count > 0
}

func createAdmin(username, password string) error {
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	_, err = db.Exec(`INSERT OR REPLACE INTO admin_users (id, username, password_hash, role) VALUES (1, ?, ?, 'admin')`, username, hash)
	if err != nil {
		return err
	}
	return dbCreateUser("user_admin", username, username, hash, "admin")
}

func verifyUser(username, password string) (map[string]interface{}, error) {
	user, err := dbGetUserByUsername(username)
	if err != nil {
		return nil, err
	}
	hash, _ := user["password_hash"].(string)
	status, _ := user["status"].(string)
	if status == "disabled" {
		return nil, fmt.Errorf("account disabled")
	}
	if !checkPassword(password, hash) {
		return nil, fmt.Errorf("invalid password")
	}
	return user, nil
}

func getAdminUsername() string {
	var username string
	err := db.QueryRow("SELECT username FROM users WHERE role = 'admin' LIMIT 1").Scan(&username)
	if err == nil {
		return username
	}
	db.QueryRow("SELECT username FROM admin_users WHERE role = 'admin' LIMIT 1").Scan(&username)
	return username
}

// ==================== Refresh Token ====================

func generateRefreshTokenString() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("rt-%d%s", time.Now().UnixNano(), generateAPIKey())
	}
	return "rt-" + hex.EncodeToString(b)
}

func storeRefreshToken(username, token string) error {
	expiresAt := time.Now().Add(refreshTokenExpiry).Format("2006-01-02 15:04:05")
	_, err := db.Exec(`INSERT OR REPLACE INTO refresh_tokens (token, username, expires_at) VALUES (?, ?, ?)`,
		token, username, expiresAt)
	return err
}

func consumeRefreshToken(token string) (string, error) {
	var username string
	var expiresAt string
	err := db.QueryRow(`SELECT username, expires_at FROM refresh_tokens WHERE token = ?`, token).Scan(&username, &expiresAt)
	if err != nil {
		return "", fmt.Errorf("invalid refresh token")
	}

	exp, err := time.Parse("2006-01-02 15:04:05", expiresAt)
	if err != nil || time.Now().After(exp) {
		db.Exec(`DELETE FROM refresh_tokens WHERE token = ?`, token)
		return "", fmt.Errorf("refresh token expired")
	}

	db.Exec(`DELETE FROM refresh_tokens WHERE token = ?`, token)
	return username, nil
}

func issueTokenPairForUser(user map[string]interface{}) map[string]interface{} {
	userID, _ := user["id"].(string)
	username, _ := user["username"].(string)
	role, _ := user["role"].(string)

	accessToken, _ := generateToken(userID, username, role, accessTokenExpiry)
	refreshToken := generateRefreshTokenString()
	storeRefreshToken(username, refreshToken)

	dbUpdateUserLastLogin(userID)

	return map[string]interface{}{
		"success":       true,
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"expires_in":    int(accessTokenExpiry.Seconds()),
		"user_id":       userID,
		"username":      username,
		"role":          role,
	}
}

func issueTokenPair(username string) map[string]interface{} {
	user, err := dbGetUserByUsername(username)
	if err != nil {
		role := "admin"
		accessToken, _ := generateToken("unknown", username, role, accessTokenExpiry)
		refreshToken := generateRefreshTokenString()
		storeRefreshToken(username, refreshToken)
		return map[string]interface{}{
			"success":       true,
			"access_token":  accessToken,
			"refresh_token": refreshToken,
			"expires_in":    int(accessTokenExpiry.Seconds()),
			"username":      username,
			"role":          role,
		}
	}
	return issueTokenPairForUser(user)
}

func getUserFromRequest(r *http.Request) *UserClaims {
	tokenStr := extractBearerToken(r)
	if tokenStr == "" {
		return nil
	}
	claims, err := validateToken(tokenStr)
	if err != nil {
		return nil
	}
	return claims
}

func isAdmin(claims *UserClaims) bool {
	return claims != nil && claims.Role == "admin"
}

// ==================== Middleware ====================

var noAuthPaths = map[string]bool{
	"/api/v1/auth/status":       true,
	"/api/v1/auth/setup":        true,
	"/api/v1/auth/login":        true,
	"/api/v1/auth/register":     true,
	"/api/v1/auth/token":        true,
	"/api/v1/auth/refresh":      true,
	"/api/v1/auth/reg-open":     true,
}

func isAdminPath(path string) bool {
	return strings.HasPrefix(path, "/api/v1/users")
}

func isLocalhost(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	return host == "127.0.0.1" || host == "::1" || host == "localhost"
}

func (p *ProxyServer) adminAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/v1/") && !strings.HasPrefix(r.URL.Path, "/admin/") {
			next.ServeHTTP(w, r)
			return
		}

		if noAuthPaths[r.URL.Path] {
			next.ServeHTTP(w, r)
			return
		}

		if p.config.DeployMode == "pc" && isLocalhost(r) {
			next.ServeHTTP(w, r)
			return
		}

		if strings.HasPrefix(r.URL.Path, "/api/v1/") {
			tokenStr := extractBearerToken(r)
			if tokenStr != "" {
				claims, err := validateToken(tokenStr)
				if err == nil && claims != nil {
					if isAdminPath(r.URL.Path) && !isAdmin(claims) && r.Method != "GET" {
						http.Error(w, "Forbidden: admin only", http.StatusForbidden)
						return
					}
					ctx := r.Context()
					r = r.WithContext(contextWithUser(ctx, claims))
					next.ServeHTTP(w, r)
					return
				}
			}

			if p.config.APIKey != "" {
				authHeader := r.Header.Get("Authorization")
				expectedAuth := "Bearer " + p.config.APIKey
				if authHeader == expectedAuth {
					next.ServeHTTP(w, r)
					return
				}
			}

			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

type contextKey string

const userContextKey contextKey = "user"

func contextWithUser(ctx context.Context, claims *UserClaims) context.Context {
	return context.WithValue(ctx, userContextKey, claims)
}

func getUserFromContext(r *http.Request) *UserClaims {
	if val, ok := r.Context().Value(userContextKey).(*UserClaims); ok {
		return val
	}
	return getUserFromRequest(r)
}

func extractBearerToken(r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimPrefix(authHeader, "Bearer ")
	}
	return ""
}

// ==================== Auth HTTP Handlers ====================

func (p *ProxyServer) setupAuthRoutes(router *mux.Router) {
	router.HandleFunc("/api/v1/auth/status", p.handleAuthStatus).Methods("GET")
	router.HandleFunc("/api/v1/auth/setup", p.handleAuthSetup).Methods("POST")
	router.HandleFunc("/api/v1/auth/login", p.handleAuthLogin).Methods("POST")
	router.HandleFunc("/api/v1/auth/register", p.handleAuthRegister).Methods("POST")
	router.HandleFunc("/api/v1/auth/reg-open", p.handleRegistrationOpen).Methods("GET")
	router.HandleFunc("/api/v1/auth/change-password", p.handleChangePassword).Methods("POST")
	router.HandleFunc("/api/v1/auth/token", p.handleGetToken).Methods("POST")
	router.HandleFunc("/api/v1/auth/refresh", p.handleRefreshToken).Methods("POST")
	router.HandleFunc("/api/v1/auth/me", p.handleAuthMe).Methods("GET")
}

func (p *ProxyServer) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"initialized":       adminExists(),
		"mode":              p.config.DeployMode,
		"has_api_key":       p.config.APIKey != "",
		"registration_open": dbIsRegistrationOpen(),
	})
}

func (p *ProxyServer) handleAuthSetup(w http.ResponseWriter, r *http.Request) {
	if adminExists() {
		http.Error(w, "Admin already initialized", http.StatusConflict)
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.Username == "" || len(req.Password) < 6 {
		http.Error(w, "Username required, password min 6 chars", http.StatusBadRequest)
		return
	}
	if err := createAdmin(req.Username, req.Password); err != nil {
		http.Error(w, "Failed to create admin", http.StatusInternalServerError)
		return
	}
	dbSetRegistrationOpen(false)
	user, _ := dbGetUserByUsername(req.Username)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(issueTokenPairForUser(user))
}

func (p *ProxyServer) handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	user, err := verifyUser(req.Username, req.Password)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "用户名或密码错误",
		})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(issueTokenPairForUser(user))
}

func (p *ProxyServer) handleAuthRegister(w http.ResponseWriter, r *http.Request) {
	if !dbIsRegistrationOpen() {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "注册未开放",
		})
		return
	}
	var req struct {
		Username    string `json:"username"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.Username == "" || len(req.Password) < 6 {
		http.Error(w, "用户名必填，密码至少6位", http.StatusBadRequest)
		return
	}
	if _, err := dbGetUserByUsername(req.Username); err == nil {
		http.Error(w, "用户名已存在", http.StatusConflict)
		return
	}
	hash, _ := hashPassword(req.Password)
	id := fmt.Sprintf("user_%d", time.Now().UnixNano())
	displayName := req.DisplayName
	if displayName == "" {
		displayName = req.Username
	}
	if err := dbCreateUser(id, req.Username, displayName, hash, "user"); err != nil {
		http.Error(w, "创建用户失败", http.StatusInternalServerError)
		return
	}
	user, _ := dbGetUserByUsername(req.Username)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(issueTokenPairForUser(user))
}

func (p *ProxyServer) handleRegistrationOpen(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"open": dbIsRegistrationOpen(),
	})
}

func (p *ProxyServer) handleAuthMe(w http.ResponseWriter, r *http.Request) {
	claims := getUserFromRequest(r)
	if claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user_id":  claims.UserID,
		"username": claims.Username,
		"role":     claims.Role,
	})
}

func (p *ProxyServer) handleRefreshToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	username, err := consumeRefreshToken(req.RefreshToken)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(issueTokenPair(username))
}

func (p *ProxyServer) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	claims := getUserFromRequest(r)
	if claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	user, err := dbGetUserByID(claims.UserID)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	hash, _ := user["password_hash"].(string)
	if !checkPassword(req.OldPassword, hash) {
		http.Error(w, "旧密码错误", http.StatusUnauthorized)
		return
	}
	if len(req.NewPassword) < 6 {
		http.Error(w, "新密码至少6位", http.StatusBadRequest)
		return
	}
	newHash, _ := hashPassword(req.NewPassword)
	dbUpdateUserPassword(claims.UserID, newHash)
	w.Header().Set("Content-Type", "application/json")
	user2, _ := dbGetUserByID(claims.UserID)
	json.NewEncoder(w).Encode(issueTokenPairForUser(user2))
}

func (p *ProxyServer) handleGetToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	username := getAdminUsername()
	if username == "" {
		http.Error(w, "No admin configured", http.StatusNotFound)
		return
	}
	if p.config.DeployMode == "pc" && isLocalhost(r) && req.Password == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(issueTokenPair(username))
		return
	}
	user, err := verifyUser(username, req.Password)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid password",
		})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(issueTokenPairForUser(user))
}

// ==================== User Management Handlers ====================

func (p *ProxyServer) setupUserRoutes(api *mux.Router) {
	api.HandleFunc("/users", p.handleListUsers).Methods("GET")
	api.HandleFunc("/users", p.handleCreateUser).Methods("POST")
	api.HandleFunc("/users/{id}", p.handleUpdateUser).Methods("PUT")
	api.HandleFunc("/users/{id}", p.handleDeleteUser).Methods("DELETE")
	api.HandleFunc("/users/{id}/reset-password", p.handleResetUserPassword).Methods("POST")
	api.HandleFunc("/users/settings/registration", p.handleSetRegistrationOpen).Methods("PUT")
}

func (p *ProxyServer) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := dbListUsers()
	if err != nil {
		http.Error(w, "Failed to list users", http.StatusInternalServerError)
		return
	}
	if users == nil {
		users = []map[string]interface{}{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"users": users})
}

func (p *ProxyServer) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username    string `json:"username"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
		Role        string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.Username == "" || len(req.Password) < 6 {
		http.Error(w, "用户名必填，密码至少6位", http.StatusBadRequest)
		return
	}
	if req.Role == "" {
		req.Role = "user"
	}
	if req.Role != "admin" && req.Role != "user" {
		http.Error(w, "角色必须是 admin 或 user", http.StatusBadRequest)
		return
	}
	if _, err := dbGetUserByUsername(req.Username); err == nil {
		http.Error(w, "用户名已存在", http.StatusConflict)
		return
	}
	hash, _ := hashPassword(req.Password)
	id := fmt.Sprintf("user_%d", time.Now().UnixNano())
	displayName := req.DisplayName
	if displayName == "" {
		displayName = req.Username
	}
	if err := dbCreateUser(id, req.Username, displayName, hash, req.Role); err != nil {
		http.Error(w, "创建用户失败", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"id":      id,
		"message": "用户创建成功",
	})
}

func (p *ProxyServer) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	var req struct {
		DisplayName string `json:"display_name"`
		Role        string `json:"role"`
		Status      string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if err := dbUpdateUser(id, req.DisplayName, req.Role, req.Status); err != nil {
		http.Error(w, "更新失败", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func (p *ProxyServer) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	claims := getUserFromRequest(r)
	if claims != nil && claims.UserID == id {
		http.Error(w, "不能删除自己", http.StatusBadRequest)
		return
	}
	if err := dbDeleteUser(id); err != nil {
		http.Error(w, "删除失败", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func (p *ProxyServer) handleResetUserPassword(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	var req struct {
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if len(req.NewPassword) < 6 {
		http.Error(w, "密码至少6位", http.StatusBadRequest)
		return
	}
	hash, _ := hashPassword(req.NewPassword)
	if err := dbUpdateUserPassword(id, hash); err != nil {
		http.Error(w, "重置失败", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "密码已重置"})
}

func (p *ProxyServer) handleSetRegistrationOpen(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Open bool `json:"open"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	dbSetRegistrationOpen(req.Open)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"open":    req.Open,
	})
}
