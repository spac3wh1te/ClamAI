package main

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var jwtSecret []byte

var (
	loginAttempts   = make(map[string]*loginAttemptInfo)
	loginAttemptsMu sync.Mutex
)

type loginAttemptInfo struct {
	count    int
	lastTime time.Time
	blocked  bool
}

const maxLoginAttempts = 5
const loginAttemptWindow = 15 * time.Minute
const loginBlockDuration = 30 * time.Minute

func getRemainingLoginAttempts(ip string) int {
	loginAttemptsMu.Lock()
	defer loginAttemptsMu.Unlock()
	info, exists := loginAttempts[ip]
	if !exists {
		return maxLoginAttempts
	}
	remaining := maxLoginAttempts - info.count
	if remaining < 0 {
		remaining = 0
	}
	return remaining
}

func clearLoginAttempts(ip string) {
	loginAttemptsMu.Lock()
	defer loginAttemptsMu.Unlock()
	delete(loginAttempts, ip)
}

func checkLoginRateLimit(ip string) bool {
	loginAttemptsMu.Lock()
	defer loginAttemptsMu.Unlock()
	now := time.Now()
	info, exists := loginAttempts[ip]
	if !exists {
		loginAttempts[ip] = &loginAttemptInfo{count: 1, lastTime: now}
		return true
	}
	if info.blocked && now.Sub(info.lastTime) < loginBlockDuration {
		return false
	}
	if info.blocked {
		delete(loginAttempts, ip)
		loginAttempts[ip] = &loginAttemptInfo{count: 1, lastTime: now}
		return true
	}
	if now.Sub(info.lastTime) > loginAttemptWindow {
		loginAttempts[ip] = &loginAttemptInfo{count: 1, lastTime: now}
		return true
	}
	info.count++
	info.lastTime = now
	if info.count > maxLoginAttempts {
		info.blocked = true
		return false
	}
	return true
}

func init() {
	safeGo(func() {
		for {
			time.Sleep(10 * time.Minute)
			loginAttemptsMu.Lock()
			now := time.Now()
			for ip, info := range loginAttempts {
				if now.Sub(info.lastTime) > loginAttemptWindow {
					delete(loginAttempts, ip)
				}
			}
			loginAttemptsMu.Unlock()
		}
	})
}

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
	var record DBAdminSecret
	if err := gormDB.Where("key = ?", "jwt_secret").First(&record).Error; err == nil && record.SecretValue != "" {
		return record.SecretValue
	}
	secret := generateAPIKey()
	gormDB.Save(&DBAdminSecret{Key: "jwt_secret", SecretValue: secret})
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
