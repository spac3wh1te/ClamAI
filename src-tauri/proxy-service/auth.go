package main

import (
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
const defaultTokenExpiry = 24 * time.Hour

var jwtSecret []byte

type AdminClaims struct {
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

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

func generateToken(username, role string, expiry time.Duration) (string, error) {
	claims := AdminClaims{
		Username: username,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiry)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "aiproxy",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func validateToken(tokenStr string) (*AdminClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &AdminClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return jwtSecret, nil
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := token.Claims.(*AdminClaims); ok && token.Valid {
		return claims, nil
	}
	return nil, fmt.Errorf("invalid token")
}

func adminExists() bool {
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
	return err
}

func verifyAdmin(username, password string) bool {
	var hash string
	err := db.QueryRow("SELECT password_hash FROM admin_users WHERE username = ? AND role = 'admin'", username).Scan(&hash)
	if err != nil {
		return false
	}
	return checkPassword(password, hash)
}

var noAuthPaths = map[string]bool{
	"/api/v1/auth/status": true,
	"/api/v1/auth/setup":  true,
	"/api/v1/auth/login":  true,
	"/api/v1/auth/token":  true,
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
			if p.config.APIKey != "" {
				authHeader := r.Header.Get("Authorization")
				expectedAuth := "Bearer " + p.config.APIKey
				if authHeader == expectedAuth {
					next.ServeHTTP(w, r)
					return
				}
			}

			tokenStr := extractBearerToken(r)
			if tokenStr != "" {
				claims, err := validateToken(tokenStr)
				if err == nil && claims != nil {
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
	router.HandleFunc("/api/v1/auth/change-password", p.handleChangePassword).Methods("POST")
	router.HandleFunc("/api/v1/auth/token", p.handleGetToken).Methods("POST")
}

func (p *ProxyServer) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"initialized": adminExists(),
		"mode":        p.config.DeployMode,
		"has_api_key": p.config.APIKey != "",
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
	token, _ := generateToken(req.Username, "admin", defaultTokenExpiry)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"token":   token,
	})
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
	if !verifyAdmin(req.Username, req.Password) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Invalid credentials",
		})
		return
	}
	token, _ := generateToken(req.Username, "admin", defaultTokenExpiry)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"token":   token,
	})
}

func (p *ProxyServer) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	tokenStr := extractBearerToken(r)
	if tokenStr == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	claims, err := validateToken(tokenStr)
	if err != nil || claims == nil {
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
	if !verifyAdmin(claims.Username, req.OldPassword) {
		http.Error(w, "Invalid old password", http.StatusUnauthorized)
		return
	}
	if len(req.NewPassword) < 6 {
		http.Error(w, "New password min 6 chars", http.StatusBadRequest)
		return
	}
	hash, _ := hashPassword(req.NewPassword)
	db.Exec("UPDATE admin_users SET password_hash = ? WHERE username = ?", hash, claims.Username)
	token, _ := generateToken(claims.Username, "admin", defaultTokenExpiry)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"token":   token,
	})
}

func (p *ProxyServer) handleGetToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	var username string
	var hash string
	err := db.QueryRow("SELECT username, password_hash FROM admin_users WHERE role = 'admin' LIMIT 1").Scan(&username, &hash)
	if err != nil {
		http.Error(w, "No admin configured", http.StatusNotFound)
		return
	}
	if !checkPassword(req.Password, hash) {
		http.Error(w, "Invalid password", http.StatusUnauthorized)
		return
	}
	token, _ := generateToken(username, "admin", defaultTokenExpiry*7)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"token":   token,
	})
}
