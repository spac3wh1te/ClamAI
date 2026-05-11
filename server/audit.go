package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"
)

type DBAuditLog struct {
	ID        int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime;index:idx_audit_created"`
	Username  string    `json:"username" gorm:"size:128;index:idx_audit_username"`
	Action    string    `json:"action" gorm:"size:64;index:idx_audit_action"`
	Target    string    `json:"target" gorm:"size:256"`
	Detail    string    `json:"detail" gorm:"type:text"`
	SourceIP  string    `json:"source_ip" gorm:"column:source_ip;size:64"`
}

func (DBAuditLog) TableName() string { return "audit_logs" }

func auditLog(r *http.Request, action, target, detail string) {
	username := ""
	if claims := getUserFromContext(r); claims != nil {
		username = claims.Username
	} else if isLocalhost(r) {
		username = "localhost"
	}
	entry := DBAuditLog{
		Username: username,
		Action:   action,
		Target:   target,
		Detail:   detail,
		SourceIP: getClientIP(r),
	}
	if err := gormDB.Create(&entry).Error; err != nil {
		log.Printf("[ERROR] auditLog: %v", err)
	}
}

func (p *ProxyServer) handleAuditLogs(w http.ResponseWriter, r *http.Request) {
	limit := 100
	offset := 0
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 {
		if l > 1000 {
			l = 1000
		}
		limit = l
	}
	if o, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && o >= 0 {
		offset = o
	}

	query := gormDB.Model(&DBAuditLog{})
	if username := r.URL.Query().Get("username"); username != "" {
		query = query.Where("username = ?", username)
	}
	if action := r.URL.Query().Get("action"); action != "" {
		query = query.Where("action = ?", action)
	}
	if search := r.URL.Query().Get("search"); search != "" {
		query = query.Where("target LIKE ? OR detail LIKE ?", "%"+search+"%", "%"+search+"%")
	}

	var total int64
	query.Count(&total)

	var logs []DBAuditLog
	query.Order("id DESC").Offset(offset).Limit(limit).Find(&logs)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"logs":  logs,
		"total": total,
	})
}

func (p *ProxyServer) setupAuditRoutes(api *mux.Router) {
	api.HandleFunc("/audit/logs", p.handleAuditLogs).Methods("GET")
}
