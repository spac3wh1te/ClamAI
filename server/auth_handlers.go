package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/gorilla/mux"
)

func (p *ProxyServer) setupAuthRoutes(router *mux.Router) {
	router.HandleFunc("/auth/status", p.handleAuthStatus).Methods("GET")
	router.HandleFunc("/auth/setup", p.handleAuthSetup).Methods("POST")
	router.HandleFunc("/auth/login", p.handleAuthLogin).Methods("POST")
	router.HandleFunc("/auth/register", p.handleAuthRegister).Methods("POST")
	router.HandleFunc("/auth/reg-open", p.handleRegistrationOpen).Methods("GET")
	router.HandleFunc("/auth/change-password", p.handleChangePassword).Methods("POST")
	router.HandleFunc("/auth/token", p.handleGetToken).Methods("POST")
	router.HandleFunc("/auth/refresh", p.handleRefreshToken).Methods("POST")
	router.HandleFunc("/auth/me", p.handleAuthMe).Methods("GET")
	router.HandleFunc("/auth/sessions", p.handleListSessions).Methods("GET")
	router.HandleFunc("/auth/sessions/{token}", p.handleRevokeSession).Methods("DELETE")
}

func (p *ProxyServer) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	isServer := p.config.Host == "0.0.0.0"
	deployMode := "pc"
	if isServer {
		deployMode = "server"
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"initialized":       adminExists(),
		"mode":              deployMode,
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
	if req.Username == "" || len(req.Password) < 8 {
		http.Error(w, "Username required, password min 8 chars", http.StatusBadRequest)
		return
	}
	hasUpper := false
	hasDigit := false
	for _, c := range req.Password {
		if c >= 'A' && c <= 'Z' {
			hasUpper = true
		}
		if c >= '0' && c <= '9' {
			hasDigit = true
		}
	}
	if !hasUpper || !hasDigit {
		http.Error(w, "Password must contain uppercase letter and digit", http.StatusBadRequest)
		return
	}
	if err := createAdmin(req.Username, req.Password); err != nil {
		http.Error(w, "Failed to create admin", http.StatusInternalServerError)
		return
	}
	dbSetSetting("service.setup_complete", "true")
	dbSetRegistrationOpen(false)
	user, _ := dbGetUserByUsername(req.Username)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(issueTokenPairForUser(user))
}

func (p *ProxyServer) handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if !checkLoginRateLimit(host) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":    false,
			"error":      "登录尝试次数过多，请30分钟后再试",
			"retry_after": 1800,
		})
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
	user, err := verifyUser(req.Username, req.Password)
	if err != nil {
		remaining := getRemainingLoginAttempts(host)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":    false,
			"error":      "用户名或密码错误",
			"remaining":  remaining,
		})
		return
	}
	clearLoginAttempts(host)
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
	if req.Username == "" || len(req.Password) < 8 {
		http.Error(w, "用户名必填，密码至少8位", http.StatusBadRequest)
		return
	}
	for _, c := range req.Username {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-') {
			http.Error(w, "用户名只能包含字母、数字、下划线和连字符", http.StatusBadRequest)
			return
		}
	}
	if len(req.Username) > 32 {
		http.Error(w, "用户名最长32位", http.StatusBadRequest)
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
			"error":   "Token refresh failed",
		})
		return
	}
	result := issueTokenPair(username)
	if success, _ := result["success"].(bool); !success {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(result)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
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
	if len(req.NewPassword) < 8 {
		http.Error(w, "新密码至少8位", http.StatusBadRequest)
		return
	}
	hasUpper := false
	hasDigit := false
	for _, c := range req.NewPassword {
		if c >= 'A' && c <= 'Z' {
			hasUpper = true
		}
		if c >= '0' && c <= '9' {
			hasDigit = true
		}
	}
	if !hasUpper || !hasDigit {
		http.Error(w, "密码必须包含大写字母和数字", http.StatusBadRequest)
		return
	}
	newHash, _ := hashPassword(req.NewPassword)
	dbUpdateUserPassword(claims.UserID, newHash)
	gormDB.Where("username = ?", claims.Username).Delete(&DBRefreshToken{})
	w.Header().Set("Content-Type", "application/json")
	user2, _ := dbGetUserByID(claims.UserID)
	json.NewEncoder(w).Encode(issueTokenPairForUser(user2))
}

func (p *ProxyServer) handleListSessions(w http.ResponseWriter, r *http.Request) {
	claims := getUserFromRequest(r)
	if claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	username := claims.Username
	isAdminUser := claims.Role == "admin"

	var tokens []DBRefreshToken
	if isAdminUser {
		gormDB.Order("created_at DESC").Find(&tokens)
	} else {
		gormDB.Where("username = ?", username).Order("created_at DESC").Find(&tokens)
	}

	sessions := make([]map[string]interface{}, 0, len(tokens))
	for _, t := range tokens {
		sessions = append(sessions, map[string]interface{}{
			"token_preview": maskAPIKey(t.Token),
			"username":      t.Username,
			"expires_at":    t.ExpiresAt.UTC().Format(time.RFC3339),
			"created_at":    t.CreatedAt.UTC().Format(time.RFC3339),
			"is_expired":    time.Now().After(t.ExpiresAt),
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"sessions": sessions})
}

func (p *ProxyServer) handleRevokeSession(w http.ResponseWriter, r *http.Request) {
	claims := getUserFromRequest(r)
	if claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	tokenHash := mux.Vars(r)["token"]
	if tokenHash == "" {
		http.Error(w, "missing token", http.StatusBadRequest)
		return
	}

	var rt DBRefreshToken
	if err := gormDB.Where("token LIKE ?", tokenHash+"%").First(&rt).Error; err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	if claims.Role != "admin" && rt.Username != claims.Username {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	gormDB.Where("token = ?", rt.Token).Delete(&DBRefreshToken{})
	auditLog(r, "session.revoke", maskAPIKey(rt.Token), "username="+rt.Username)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
