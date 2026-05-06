package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"time"
)

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

var noAuthPaths = map[string]bool{
	"/api/v1/auth/status":   true,
	"/api/v1/auth/setup":    true,
	"/api/v1/auth/login":    true,
	"/api/v1/auth/register": true,
	"/api/v1/auth/token":    true,
	"/api/v1/auth/refresh":  true,
	"/api/v1/auth/reg-open": true,
	"/api/v1/app/info":      true,
	"/vite.svg":             true,
	"/favicon.ico":          true,
}

var noAuthPrefixes = []string{
	"/admin/",
	"/assets/",
}

func isNoAuthPath(path string) bool {
	if noAuthPaths[path] {
		return true
	}
	for _, prefix := range noAuthPrefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

func isAdminPath(path string) bool {
	adminPrefixes := []string{
		"/api/v1/providers",
		"/api/v1/api-keys",
		"/api/v1/keys",
		"/api/v1/stats/usage",
		"/api/v1/stats/alerts",
		"/api/v1/stats/callers",
		"/api/v1/stats/security-tokens",
		"/api/v1/users",
		"/api/v1/security/config",
		"/api/v1/security/alerts",
		"/api/v1/security/vectors",
		"/api/v1/ratelimit/",
		"/api/v1/proxy/test",
		"/api/v1/agent/",
	}
	for _, prefix := range adminPrefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
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
		path := r.URL.Path
		log.Printf("[AUTH] adminAuthMiddleware: path=%s, method=%s, host=%s", path, r.Method, p.config.Host)

		if !strings.HasPrefix(path, "/api/v1/") && !strings.HasPrefix(path, "/admin/") {
			next.ServeHTTP(w, r)
			return
		}

		if isNoAuthPath(path) {
			log.Printf("[AUTH] path=%s: no-auth path, passing through", path)
			next.ServeHTTP(w, r)
			return
		}

		if p.config.Host == "127.0.0.1" && isLocalhost(r) {
			log.Printf("[AUTH] path=%s: 127.0.0.1 + localhost, bypassing auth", path)
			next.ServeHTTP(w, r)
			return
		}

		if strings.HasPrefix(path, "/admin/") {
			if strings.HasPrefix(path, "/admin/api/") {
				log.Printf("[AUTH] path=%s: /admin/api/*, checking auth", path)
			} else {
				log.Printf("[AUTH] path=%s: /admin/ static content, allowing without auth", path)
				next.ServeHTTP(w, r)
				return
			}
			tokenStr := extractBearerToken(r)
			if tokenStr != "" {
				claims, err := validateToken(tokenStr)
				if err == nil && claims != nil {
					log.Printf("[AUTH] path=%s: token valid, user=%s role=%s", path, claims.Username, claims.Role)
					ctx := r.Context()
					r = r.WithContext(contextWithUser(ctx, claims))
					next.ServeHTTP(w, r)
					return
				}
				log.Printf("[AUTH] path=%s: token invalid or expired", path)
			} else {
				log.Printf("[AUTH] path=%s: no token provided", path)
			}
			log.Printf("[AUTH] path=%s: returning Unauthorized for /admin/api/*", path)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		if strings.HasPrefix(path, "/api/v1/") {
			tokenStr := extractBearerToken(r)
			if tokenStr != "" {
				claims, err := validateToken(tokenStr)
				if err == nil && claims != nil {
					if isAdminPath(path) && !isAdmin(claims) {
						log.Printf("[AUTH] path=%s: admin-only path, user %s is not admin", path, claims.Username)
						http.Error(w, "Forbidden: admin only", http.StatusForbidden)
						return
					}
					log.Printf("[AUTH] path=%s: token valid, user=%s role=%s", path, claims.Username, claims.Role)
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
					if isAdminPath(path) {
						log.Printf("[AUTH] path=%s: API key auth OK for admin path", path)
						next.ServeHTTP(w, r)
						return
					}
					log.Printf("[AUTH] path=%s: API key auth OK", path)
					next.ServeHTTP(w, r)
					return
				}
			}

			log.Printf("[AUTH] path=%s: no valid auth found, returning Unauthorized", path)
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

func userIDForQuery(r *http.Request) string {
	claims := getUserFromContext(r)
	if claims == nil || isAdmin(claims) {
		return ""
	}
	return claims.UserID
}

func requireTaskOwnership(w http.ResponseWriter, r *http.Request, taskID string, taskTable string) bool {
	uid := userIDForQuery(r)
	if uid == "" {
		return true
	}
	allowedTables := map[string]bool{"analysis_tasks": true, "skills_tasks": true}
	if !allowedTables[taskTable] {
		http.Error(w, "Invalid task type", http.StatusBadRequest)
		return false
	}
	var owner string
	err := db.QueryRow("SELECT created_by FROM "+taskTable+" WHERE id = ?", taskID).Scan(&owner)
	if err != nil {
		http.Error(w, "Task not found", http.StatusNotFound)
		return false
	}
	if owner != "" && owner != uid {
		http.Error(w, "Forbidden: not your task", http.StatusForbidden)
		return false
	}
	return true
}

func extractBearerToken(r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimPrefix(authHeader, "Bearer ")
	}
	return ""
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

func generateRefreshTokenString() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("rt-%d%s", time.Now().UnixNano(), generateAPIKey())
	}
	return "rt-" + hex.EncodeToString(b)
}

func storeRefreshToken(username, token string) error {
	expiresAt := time.Now().Add(refreshTokenExpiry).UTC().Format(time.RFC3339)
	_, err := db.Exec(`INSERT OR REPLACE INTO refresh_tokens (token, username, expires_at) VALUES (?, ?, ?)`,
		token, username, expiresAt)
	return err
}

func consumeRefreshToken(token string) (string, error) {
	tx, err := db.Begin()
	if err != nil {
		return "", fmt.Errorf("internal error")
	}
	defer tx.Rollback()

	var username string
	var expiresAt string
	err = tx.QueryRow(`SELECT username, expires_at FROM refresh_tokens WHERE token = ?`, token).Scan(&username, &expiresAt)
	if err != nil {
		return "", fmt.Errorf("invalid refresh token")
	}

	exp, err := time.Parse(time.RFC3339, expiresAt)
	if err != nil || time.Now().After(exp) {
		tx.Exec(`DELETE FROM refresh_tokens WHERE token = ?`, token)
		tx.Commit()
		return "", fmt.Errorf("refresh token expired")
	}

	result, err := tx.Exec(`DELETE FROM refresh_tokens WHERE token = ?`, token)
	if err != nil {
		return "", fmt.Errorf("internal error")
	}
	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return "", fmt.Errorf("refresh token already consumed")
	}

	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("internal error")
	}
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
		log.Printf("[WARN] issueTokenPair: user %q not found, refusing token issuance", username)
		return map[string]interface{}{
			"success": false,
			"error":   "user not found",
		}
	}
	return issueTokenPairForUser(user)
}
