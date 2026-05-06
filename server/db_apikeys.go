package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"time"
)

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func dbSaveAPIKey(info *APIKeyInfo) {
	modelsJSON, _ := json.Marshal(info.AllowedModels)
	providerKeysJSON, _ := json.Marshal(info.ProviderKeys)
	var lastUsed interface{}
	if info.LastUsed != nil {
		lastUsed = info.LastUsed.UTC().Format(time.RFC3339)
	}
	_, err := db.Exec(`INSERT OR REPLACE INTO api_keys (id, key, name, user_id, allowed_models, provider_keys, created_at, active, request_count, last_used)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		info.ID, info.Key, info.Name, info.UserID, string(modelsJSON), string(providerKeysJSON),
		info.CreatedAt.UTC().Format(time.RFC3339), boolToInt(info.Active),
		info.RequestCount, lastUsed)
	if err != nil {
		log.Printf("[ERROR] dbSaveAPIKey: %v", err)
	}
}

func dbDeleteAPIKey(id string) {
	db.Exec("DELETE FROM api_keys WHERE id = ?", id)
}

func dbUpdateAPIKeyUsage(id string, requestCount int64, lastUsed time.Time) {
	db.Exec("UPDATE api_keys SET request_count = ?, last_used = ? WHERE id = ?",
		requestCount, lastUsed.UTC().Format(time.RFC3339), id)
}

func dbLoadAPIKeys() (map[string]*APIKeyInfo, map[string]*APIKeyInfo) {
	keys := make(map[string]*APIKeyInfo)
	byID := make(map[string]*APIKeyInfo)

	rows, err := db.Query("SELECT id, key, name, COALESCE(user_id,'') as user_id, allowed_models, provider_keys, created_at, active, request_count, last_used FROM api_keys")
	if err != nil {
		log.Printf("[ERROR] dbLoadAPIKeys: %v", err)
		return keys, byID
	}
	defer rows.Close()

	for rows.Next() {
		info := &APIKeyInfo{}
		var modelsJSON string
		var providerKeysJSON string
		var createdAt string
		var active int
		var lastUsed sql.NullString

		if err := rows.Scan(&info.ID, &info.Key, &info.Name, &info.UserID, &modelsJSON, &providerKeysJSON, &createdAt, &active, &info.RequestCount, &lastUsed); err != nil {
			log.Printf("[ERROR] dbLoadAPIKeys scan: %v", err)
			continue
		}

		json.Unmarshal([]byte(modelsJSON), &info.AllowedModels)
		json.Unmarshal([]byte(providerKeysJSON), &info.ProviderKeys)
		if info.ProviderKeys == nil {
			info.ProviderKeys = make(map[string]string)
		}
		info.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
		info.Active = active == 1
		if lastUsed.Valid {
			t, _ := time.Parse(time.RFC3339, lastUsed.String)
			info.LastUsed = &t
		}

		keys[info.Key] = info
		byID[info.ID] = info
	}

	log.Printf("[INFO] dbLoadAPIKeys: loaded %d keys", len(keys))
	return keys, byID
}
