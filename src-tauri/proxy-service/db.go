package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "github.com/lib/pq"
	_ "modernc.org/sqlite"
)

var (
	db   *sql.DB
	dbMu sync.Mutex
)

func initDB() error {
	var err error
	initDBDriver()

	if isPostgres() {
		dsn := os.Getenv("CLAMAI_DATABASE_URL")
		if dsn == "" {
			return fmt.Errorf("server mode with postgres requires CLAMAI_DATABASE_URL env var")
		}
		db, err = sql.Open("postgres", dsn)
		if err != nil {
			return fmt.Errorf("failed to open postgres: %w", err)
		}
	} else {
		dbPath := filepath.Join(getDataDir(), "clamai.db")
		log.Printf("[INFO] initDB: opening database at %s", dbPath)
		db, err = sql.Open("sqlite", dbPath)
		if err != nil {
			return fmt.Errorf("failed to open database: %w", err)
		}
		db.SetMaxOpenConns(1)
	}

	if err := createTables(); err != nil {
		return fmt.Errorf("failed to create tables: %w", err)
	}

	if err := migrateProviderKeys(); err != nil {
		log.Printf("[WARN] initDB: migration provider_keys failed (non-fatal): %v", err)
	}

	if err := migrateFromJSON(); err != nil {
		log.Printf("[WARN] initDB: migration from JSON failed (non-fatal): %v", err)
	}

	log.Printf("[INFO] initDB: database initialized successfully")
	return nil
}

func migrateProviderKeys() error {
	rows, err := db.Query("PRAGMA table_info(api_keys)")
	if err != nil {
		return err
	}
	defer rows.Close()

	hasProviderKeys := false
	for rows.Next() {
		var cid int
		var cname string
		var ctype string
		var cnotnull int
		var cdflt_value interface{}
		var cpk int
		if err := rows.Scan(&cid, &cname, &ctype, &cnotnull, &cdflt_value, &cpk); err != nil {
			continue
		}
		if cname == "provider_keys" {
			hasProviderKeys = true
			break
		}
	}
	if !hasProviderKeys {
		_, err := db.Exec("ALTER TABLE api_keys ADD COLUMN provider_keys TEXT DEFAULT '{}'")
		if err != nil {
			return fmt.Errorf("failed to add provider_keys column: %w", err)
		}
		log.Printf("[INFO] migrateProviderKeys: added provider_keys column")
	}
	return nil
}

func createTables() error {
	autoInc := dbAutoIncrement()
	stmts := []string{
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS api_keys (
			id TEXT PRIMARY KEY,
			key TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			allowed_models TEXT DEFAULT '[]',
			provider_keys TEXT DEFAULT '{}',
			created_at DATETIME NOT NULL,
			active INTEGER DEFAULT 1,
			request_count INTEGER DEFAULT 0,
			last_used DATETIME
		)`),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS request_logs (
			id %s,
			timestamp DATETIME NOT NULL,
			provider TEXT DEFAULT '',
			model TEXT DEFAULT '',
			input_tokens INTEGER DEFAULT 0,
			output_tokens INTEGER DEFAULT 0,
			latency_ms INTEGER DEFAULT 0,
			success INTEGER DEFAULT 1,
			error_message TEXT DEFAULT '',
			client_ip TEXT DEFAULT '',
			api_key_used TEXT DEFAULT '',
			status_code INTEGER DEFAULT 0,
			path TEXT DEFAULT '',
			method TEXT DEFAULT '',
			request_content TEXT DEFAULT '',
			response_content TEXT DEFAULT ''
		)`, autoInc),
		`CREATE TABLE IF NOT EXISTS stats (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			total_requests INTEGER DEFAULT 0,
			success_requests INTEGER DEFAULT 0,
			error_requests INTEGER DEFAULT 0,
			input_tokens INTEGER DEFAULT 0,
			output_tokens INTEGER DEFAULT 0,
			total_latency_ms INTEGER DEFAULT 0,
			updated_at DATETIME
		)`,
		`CREATE TABLE IF NOT EXISTS stats_by_provider (
			provider TEXT PRIMARY KEY,
			requests INTEGER DEFAULT 0,
			input_tokens INTEGER DEFAULT 0,
			output_tokens INTEGER DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS stats_by_model (
			model TEXT PRIMARY KEY,
			requests INTEGER DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS stats_daily (
			date TEXT PRIMARY KEY,
			requests INTEGER DEFAULT 0,
			input_tokens INTEGER DEFAULT 0,
			output_tokens INTEGER DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp DESC)`,
		`CREATE TABLE IF NOT EXISTS security_config (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			config_json TEXT DEFAULT '{}'
		)`,
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS security_alerts (
			id %s,
			timestamp DATETIME NOT NULL,
			direction TEXT DEFAULT 'input',
			mode TEXT DEFAULT 'block',
			trigger_type TEXT DEFAULT 'keyword',
			trigger_detail TEXT DEFAULT '',
			content_preview TEXT DEFAULT '',
			model TEXT DEFAULT '',
			provider TEXT DEFAULT '',
			api_key_used TEXT DEFAULT '',
			client_ip TEXT DEFAULT '',
			action TEXT DEFAULT 'block',
			resolved INTEGER DEFAULT 0
		)`, autoInc),
		`CREATE INDEX IF NOT EXISTS idx_security_alerts_timestamp ON security_alerts(timestamp DESC)`,
		`CREATE TABLE IF NOT EXISTS rate_limit_config (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			config_json TEXT DEFAULT '{}'
		)`,
		`CREATE TABLE IF NOT EXISTS admin_users (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			username TEXT NOT NULL,
			password_hash TEXT NOT NULL,
			role TEXT DEFAULT 'admin'
		)`,
		`CREATE TABLE IF NOT EXISTS admin_secrets (
			key TEXT PRIMARY KEY,
			secret_value TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS skills_detection_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			checked_at DATETIME NOT NULL,
			source_type TEXT DEFAULT 'text',
			source_info TEXT DEFAULT '',
			result TEXT DEFAULT '',
			risk_level TEXT DEFAULT 'unknown',
			model_used TEXT DEFAULT '',
			api_key_id TEXT DEFAULT ''
		)`,
		`CREATE INDEX IF NOT EXISTS idx_skills_detection_checked_at ON skills_detection_history(checked_at DESC)`,
		`CREATE TABLE IF NOT EXISTS profile_analysis_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			analyzed_at DATETIME NOT NULL,
			api_key_id TEXT DEFAULT '',
			time_range TEXT DEFAULT '7d',
			risk_level TEXT DEFAULT 'unknown',
			summary TEXT DEFAULT '',
			result TEXT DEFAULT '',
			model_used TEXT DEFAULT '',
			logs_analyzed INTEGER DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_profile_analysis_analyzed_at ON profile_analysis_history(analyzed_at DESC)`,
		`CREATE TABLE IF NOT EXISTS analysis_tasks (
			id TEXT PRIMARY KEY,
			task_no TEXT NOT NULL,
			name TEXT NOT NULL,
			api_key_id TEXT DEFAULT '',
			model TEXT DEFAULT '',
			time_range TEXT DEFAULT '7d',
			schedule_type TEXT DEFAULT 'once',
			interval_minutes INTEGER DEFAULT 60,
			status TEXT DEFAULT 'idle',
			last_run_at DATETIME,
			next_run_at DATETIME,
			created_at DATETIME NOT NULL,
			result_summary TEXT DEFAULT '',
			result_risk_level TEXT DEFAULT '',
			result_detail TEXT DEFAULT '',
			result_logs_analyzed INTEGER DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_analysis_tasks_status ON analysis_tasks(status)`,
		`CREATE TABLE IF NOT EXISTS refresh_tokens (
			token TEXT PRIMARY KEY,
			username TEXT NOT NULL,
			expires_at DATETIME NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
	}

	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("createTables: %q: %w", stmt[:60], err)
		}
	}

	db.Exec("ALTER TABLE security_config ADD COLUMN output_mode TEXT DEFAULT 'block'")
	db.Exec("ALTER TABLE security_config ADD COLUMN auto_ban_key INTEGER DEFAULT 0")
	db.Exec("ALTER TABLE security_alerts ADD COLUMN mode TEXT DEFAULT 'block'")
	db.Exec("ALTER TABLE security_alerts ADD COLUMN client_ip TEXT DEFAULT ''")
	db.Exec("ALTER TABLE request_logs ADD COLUMN request_content TEXT DEFAULT ''")
	db.Exec("ALTER TABLE request_logs ADD COLUMN response_content TEXT DEFAULT ''")

	return nil
}

func migrateFromJSON() error {
	dir := getDataDir()

	apiKeysPath := filepath.Join(dir, "api_keys.json")
	if _, err := os.Stat(apiKeysPath); err == nil {
		data, err := os.ReadFile(apiKeysPath)
		if err == nil {
			var keys []*APIKeyInfo
			if json.Unmarshal(data, &keys) == nil && len(keys) > 0 {
				log.Printf("[INFO] migrateFromJSON: migrating %d api_keys from JSON", len(keys))
				for _, info := range keys {
					modelsJSON, _ := json.Marshal(info.AllowedModels)
					var lastUsed interface{}
					if info.LastUsed != nil {
						lastUsed = info.LastUsed.UTC().Format(time.RFC3339)
					}
					db.Exec(`INSERT OR IGNORE INTO api_keys (id, key, name, allowed_models, created_at, active, request_count, last_used)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
						info.ID, info.Key, info.Name, string(modelsJSON),
						info.CreatedAt.UTC().Format(time.RFC3339), boolToInt(info.Active),
						info.RequestCount, lastUsed)
				}
				os.Rename(apiKeysPath, apiKeysPath+".bak")
			}
		}
	}

	statsPath := filepath.Join(dir, "stats.json")
	if _, err := os.Stat(statsPath); err == nil {
		data, err := os.ReadFile(statsPath)
		if err == nil {
			var j RequestStatsForJSON
			if json.Unmarshal(data, &j) == nil && j.TotalRequests > 0 {
				log.Printf("[INFO] migrateFromJSON: migrating stats from JSON")
				db.Exec(`INSERT OR REPLACE INTO stats (id, total_requests, success_requests, error_requests, input_tokens, output_tokens, total_latency_ms, updated_at)
					VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
					j.TotalRequests, j.SuccessRequests, j.ErrorRequests,
					j.InputTokens, j.OutputTokens, j.TotalLatencyMs,
					time.Now().UTC().Format(time.RFC3339))
				for k, v := range j.RequestsByProvider {
					td := j.TokensByProvider[k]
					db.Exec(`INSERT OR REPLACE INTO stats_by_provider (provider, requests, input_tokens, output_tokens) VALUES (?, ?, ?, ?)`,
						k, v, td.InputTokens, td.OutputTokens)
				}
				for k, v := range j.RequestsByModel {
					db.Exec(`INSERT OR REPLACE INTO stats_by_model (model, requests) VALUES (?, ?)`, k, v)
				}
				for k, v := range j.DailyStats {
					db.Exec(`INSERT OR REPLACE INTO stats_daily (date, requests, input_tokens, output_tokens) VALUES (?, ?, ?, ?)`,
						k, v.Requests, v.InputTokens, v.OutputTokens)
				}
				os.Rename(statsPath, statsPath+".bak")
			}
		}
	}

	logsPath := filepath.Join(dir, "logs.json")
	if _, err := os.Stat(logsPath); err == nil {
		data, err := os.ReadFile(logsPath)
		if err == nil {
			var logs []*RequestLog
			if json.Unmarshal(data, &logs) == nil && len(logs) > 0 {
				log.Printf("[INFO] migrateFromJSON: migrating %d logs from JSON", len(logs))
				tx, _ := db.Begin()
				for _, entry := range logs {
					tx.Exec(`INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, latency_ms, success, error_message, client_ip, api_key_used, status_code, path, method)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						entry.Timestamp.UTC().Format(time.RFC3339), entry.Provider, entry.Model,
						entry.InputTokens, entry.OutputTokens, entry.LatencyMs,
						boolToInt(entry.Success), entry.ErrorMessage, entry.ClientIP,
						entry.APIKeyUsed, entry.StatusCode, entry.Path, entry.Method)
				}
				tx.Commit()
				os.Rename(logsPath, logsPath+".bak")
			}
		}
	}

	return nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ==================== API Keys DB ====================

func dbSaveAPIKey(info *APIKeyInfo) {
	modelsJSON, _ := json.Marshal(info.AllowedModels)
	providerKeysJSON, _ := json.Marshal(info.ProviderKeys)
	var lastUsed interface{}
	if info.LastUsed != nil {
		lastUsed = info.LastUsed.UTC().Format(time.RFC3339)
	}
	_, err := db.Exec(`INSERT OR REPLACE INTO api_keys (id, key, name, allowed_models, provider_keys, created_at, active, request_count, last_used)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		info.ID, info.Key, info.Name, string(modelsJSON), string(providerKeysJSON),
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

	rows, err := db.Query("SELECT id, key, name, allowed_models, provider_keys, created_at, active, request_count, last_used FROM api_keys")
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

		if err := rows.Scan(&info.ID, &info.Key, &info.Name, &modelsJSON, &providerKeysJSON, &createdAt, &active, &info.RequestCount, &lastUsed); err != nil {
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

// ==================== Stats DB ====================

func dbSaveStats(stats *RequestStats) {
	stats.mu.Lock()
	data := stats.ToJSON()
	stats.mu.Unlock()

	db.Exec(`INSERT OR REPLACE INTO stats (id, total_requests, success_requests, error_requests, input_tokens, output_tokens, total_latency_ms, updated_at)
		VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
		data.TotalRequests, data.SuccessRequests, data.ErrorRequests,
		data.InputTokens, data.OutputTokens, data.TotalLatencyMs,
		time.Now().UTC().Format(time.RFC3339))

	for k, v := range data.RequestsByProvider {
		td := data.TokensByProvider[k]
		db.Exec(`INSERT OR REPLACE INTO stats_by_provider (provider, requests, input_tokens, output_tokens) VALUES (?, ?, ?, ?)`,
			k, v, td.InputTokens, td.OutputTokens)
	}
	for k, v := range data.RequestsByModel {
		db.Exec(`INSERT OR REPLACE INTO stats_by_model (model, requests) VALUES (?, ?)`, k, v)
	}
	for k, v := range data.DailyStats {
		db.Exec(`INSERT OR REPLACE INTO stats_daily (date, requests, input_tokens, output_tokens) VALUES (?, ?, ?, ?)`,
			k, v.Requests, v.InputTokens, v.OutputTokens)
	}
}

func dbLoadStats(stats *RequestStats) {
	stats.mu.Lock()
	defer stats.mu.Unlock()

	stats.TotalRequests = 0
	stats.SuccessRequests = 0
	stats.ErrorRequests = 0
	stats.InputTokens = 0
	stats.OutputTokens = 0
	stats.TotalLatencyMs = 0
	stats.RequestsByProvider = make(map[string]int64)
	stats.TokensByProvider = make(map[string]TokenDetail)
	stats.RequestsByModel = make(map[string]int64)
	stats.TokensByModel = make(map[string]TokenDetail)
	stats.DailyStats = make(map[string]*DailyStat)

	rows, err := db.Query(`SELECT
		COUNT(*) as total,
		SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success,
		SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors,
		COALESCE(SUM(input_tokens), 0) as input_tokens,
		COALESCE(SUM(output_tokens), 0) as output_tokens,
		COALESCE(SUM(latency_ms), 0) as total_latency,
		provider, model, DATE(timestamp) as date
		FROM request_logs
		GROUP BY provider, model, DATE(timestamp)`)
	if err != nil {
		log.Printf("[ERROR] dbLoadStats: failed to load from request_logs: %v", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var total, success, errors, inputTok, outputTok, totalLat int64
		var provider, model, date string
		if err := rows.Scan(&total, &success, &errors, &inputTok, &outputTok, &totalLat, &provider, &model, &date); err != nil {
			continue
		}
		stats.TotalRequests += total
		stats.SuccessRequests += success
		stats.ErrorRequests += errors
		stats.InputTokens += inputTok
		stats.OutputTokens += outputTok
		stats.TotalLatencyMs += totalLat
		stats.RequestsByProvider[provider] += total
		td := stats.TokensByProvider[provider]
		td.InputTokens += inputTok
		td.OutputTokens += outputTok
		stats.TokensByProvider[provider] = td
		stats.RequestsByModel[model] += total
		td2 := stats.TokensByModel[model]
		td2.InputTokens += inputTok
		td2.OutputTokens += outputTok
		stats.TokensByModel[model] = td2
		if _, ok := stats.DailyStats[date]; !ok {
			stats.DailyStats[date] = &DailyStat{}
		}
		stats.DailyStats[date].Requests += total
		stats.DailyStats[date].InputTokens += inputTok
		stats.DailyStats[date].OutputTokens += outputTok
	}

	log.Printf("[INFO] dbLoadStats: total=%d, success=%d (recalculated from request_logs)", stats.TotalRequests, stats.SuccessRequests)
}

// ==================== Logs DB ====================

func dbInsertLog(entry *RequestLog) {
	_, err := db.Exec(`INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, latency_ms, success, error_message, client_ip, api_key_used, status_code, path, method, request_content, response_content)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entry.Timestamp.UTC().Format(time.RFC3339), entry.Provider, entry.Model,
		entry.InputTokens, entry.OutputTokens, entry.LatencyMs,
		boolToInt(entry.Success), entry.ErrorMessage, entry.ClientIP,
		entry.APIKeyUsed, entry.StatusCode, entry.Path, entry.Method,
		entry.RequestContent, entry.ResponseContent)
	if err != nil {
		log.Printf("[ERROR] dbInsertLog: %v", err)
	}
}

func dbInsertBlockedLog(provider, model, clientIP, apiKeyUsed, path, method, requestContent, errorMsg string) {
	entry := &RequestLog{
		Timestamp:       time.Now(),
		Provider:        provider,
		Model:           model,
		InputTokens:     0,
		OutputTokens:    0,
		LatencyMs:       0,
		Success:         false,
		ErrorMessage:    errorMsg,
		ClientIP:        clientIP,
		APIKeyUsed:      apiKeyUsed,
		StatusCode:      403,
		Path:            path,
		Method:          method,
		RequestContent:  truncateStr(requestContent, 500),
		ResponseContent: "",
	}
	dbInsertLog(entry)
}

func truncateStr(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen])
}

const maxLogRows = 50000

func dbCleanupLogs() {
	result, err := db.Exec(`DELETE FROM request_logs WHERE id NOT IN (SELECT id FROM request_logs ORDER BY id DESC LIMIT ?)`, maxLogRows)
	if err != nil {
		log.Printf("[ERROR] dbCleanupLogs: %v", err)
		return
	}
	if n, _ := result.RowsAffected(); n > 0 {
		log.Printf("[INFO] dbCleanupLogs: purged %d old log entries", n)
	}
}

func dbLoadLogs(lb *LogBuffer) {
	rows, err := db.Query("SELECT timestamp, provider, model, input_tokens, output_tokens, latency_ms, success, error_message, client_ip, api_key_used, status_code, path, method FROM request_logs ORDER BY id ASC")
	if err != nil {
		log.Printf("[ERROR] dbLoadLogs: %v", err)
		return
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		entry := &RequestLog{}
		var ts string
		var success int
		if err := rows.Scan(&ts, &entry.Provider, &entry.Model, &entry.InputTokens, &entry.OutputTokens,
			&entry.LatencyMs, &success, &entry.ErrorMessage, &entry.ClientIP,
			&entry.APIKeyUsed, &entry.StatusCode, &entry.Path, &entry.Method); err != nil {
			continue
		}
		entry.Timestamp, _ = time.Parse(time.RFC3339, ts)
		entry.Success = success == 1
		lb.Add(entry)
		count++
	}
	log.Printf("[INFO] dbLoadLogs: loaded %d entries", count)
}

func dbGetRecentLogs(limit int) ([]*RequestLog, int) {
	var total int
	db.QueryRow("SELECT COUNT(*) FROM request_logs").Scan(&total)

	rows, err := db.Query("SELECT id, timestamp, provider, model, input_tokens, output_tokens, latency_ms, success, error_message, client_ip, api_key_used, status_code, path, method, COALESCE(request_content,''), COALESCE(response_content,'') FROM request_logs ORDER BY id DESC LIMIT ?", limit)
	if err != nil {
		log.Printf("[ERROR] dbGetRecentLogs: %v", err)
		return nil, 0
	}
	defer rows.Close()

	var logs []*RequestLog
	for rows.Next() {
		entry := &RequestLog{}
		var ts string
		var success int
		if err := rows.Scan(&entry.ID, &ts, &entry.Provider, &entry.Model, &entry.InputTokens, &entry.OutputTokens,
			&entry.LatencyMs, &success, &entry.ErrorMessage, &entry.ClientIP,
			&entry.APIKeyUsed, &entry.StatusCode, &entry.Path, &entry.Method,
			&entry.RequestContent, &entry.ResponseContent); err != nil {
			continue
		}
		entry.Timestamp, _ = time.Parse(time.RFC3339, ts)
		entry.Success = success == 1
		logs = append(logs, entry)
	}
	return logs, total
}

func dbGetLogsByAPIKey(apiKey string, limit int) ([]*RequestLog, int) {
	var total int
	db.QueryRow("SELECT COUNT(*) FROM request_logs WHERE api_key_used = ?", apiKey).Scan(&total)

	rows, err := db.Query("SELECT id, timestamp, provider, model, input_tokens, output_tokens, latency_ms, success, error_message, client_ip, api_key_used, status_code, path, method, COALESCE(request_content,''), COALESCE(response_content,'') FROM request_logs WHERE api_key_used = ? ORDER BY id DESC LIMIT ?", apiKey, limit)
	if err != nil {
		log.Printf("[ERROR] dbGetLogsByAPIKey: %v", err)
		return nil, 0
	}
	defer rows.Close()

	var logs []*RequestLog
	for rows.Next() {
		entry := &RequestLog{}
		var ts string
		var success int
		if err := rows.Scan(&entry.ID, &ts, &entry.Provider, &entry.Model, &entry.InputTokens, &entry.OutputTokens,
			&entry.LatencyMs, &success, &entry.ErrorMessage, &entry.ClientIP,
			&entry.APIKeyUsed, &entry.StatusCode, &entry.Path, &entry.Method,
			&entry.RequestContent, &entry.ResponseContent); err != nil {
			continue
		}
		entry.Timestamp, _ = time.Parse(time.RFC3339, ts)
		entry.Success = success == 1
		logs = append(logs, entry)
	}
	return logs, total
}

func dbInsertSkillsDetection(sourceType, sourceInfo, result, riskLevel, modelUsed, apiKeyID string) {
	_, err := db.Exec(`INSERT INTO skills_detection_history (checked_at, source_type, source_info, result, risk_level, model_used, api_key_id)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		time.Now().UTC().Format(time.RFC3339), sourceType, sourceInfo, result, riskLevel, modelUsed, apiKeyID)
	if err != nil {
		log.Printf("[ERROR] dbInsertSkillsDetection: %v", err)
	}
}

func dbGetSkillsDetectionHistory(limit, offset int) ([]map[string]interface{}, int) {
	var total int
	db.QueryRow("SELECT COUNT(*) FROM skills_detection_history").Scan(&total)

	rows, err := db.Query("SELECT id, checked_at, source_type, source_info, result, risk_level, model_used, api_key_id FROM skills_detection_history ORDER BY id DESC LIMIT ? OFFSET ?", limit, offset)
	if err != nil {
		log.Printf("[ERROR] dbGetSkillsDetectionHistory: %v", err)
		return nil, 0
	}
	defer rows.Close()

	var records []map[string]interface{}
	for rows.Next() {
		var id int
		var checkedAt, sourceType, sourceInfo, result, riskLevel, modelUsed, apiKeyID string
		if rows.Scan(&id, &checkedAt, &sourceType, &sourceInfo, &result, &riskLevel, &modelUsed, &apiKeyID) == nil {
			records = append(records, map[string]interface{}{
				"id":          id,
				"checked_at":  checkedAt,
				"source_type": sourceType,
				"source_info": sourceInfo,
				"result":      result,
				"risk_level":  riskLevel,
				"model_used":  modelUsed,
				"api_key_id":  apiKeyID,
			})
		}
	}
	return records, total
}

func dbInsertProfileAnalysis(apiKeyID, timeRange, riskLevel, summary, result, modelUsed string, logsAnalyzed int) {
	_, err := db.Exec(`INSERT INTO profile_analysis_history (analyzed_at, api_key_id, time_range, risk_level, summary, result, model_used, logs_analyzed)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		time.Now().UTC().Format(time.RFC3339), apiKeyID, timeRange, riskLevel, summary, result, modelUsed, logsAnalyzed)
	if err != nil {
		log.Printf("[ERROR] dbInsertProfileAnalysis: %v", err)
	}
}

func dbGetProfileAnalysisHistory(limit, offset int) ([]map[string]interface{}, int) {
	var total int
	db.QueryRow("SELECT COUNT(*) FROM profile_analysis_history").Scan(&total)

	rows, err := db.Query("SELECT id, analyzed_at, api_key_id, time_range, risk_level, summary, result, model_used, logs_analyzed FROM profile_analysis_history ORDER BY id DESC LIMIT ? OFFSET ?", limit, offset)
	if err != nil {
		log.Printf("[ERROR] dbGetProfileAnalysisHistory: %v", err)
		return nil, 0
	}
	defer rows.Close()

	var records []map[string]interface{}
	for rows.Next() {
		var id int
		var analyzedAt, apiKeyID, timeRange, riskLevel, summary, result, modelUsed string
		var logsAnalyzed int
		if rows.Scan(&id, &analyzedAt, &apiKeyID, &timeRange, &riskLevel, &summary, &result, &modelUsed, &logsAnalyzed) == nil {
			records = append(records, map[string]interface{}{
				"id":            id,
				"analyzed_at":   analyzedAt,
				"api_key_id":    apiKeyID,
				"time_range":    timeRange,
				"risk_level":    riskLevel,
				"summary":       summary,
				"result":        result,
				"model_used":    modelUsed,
				"logs_analyzed": logsAnalyzed,
			})
		}
	}
	return records, total
}

func dbDeleteProfileAnalysis(id int) error {
	_, err := db.Exec("DELETE FROM profile_analysis_history WHERE id = ?", id)
	return err
}

type DBUsageStats struct {
	TotalRequests   int64
	SuccessRequests int64
	ErrorRequests   int64
	InputTokens     int64
	OutputTokens    int64
	TotalLatencyMs  int64
	ByProvider      map[string]map[string]interface{}
	ByModel         map[string]map[string]interface{}
	DailyBreakdown  map[string]*DailyStat
	HourlyBreakdown map[string]*DailyStat
	MinuteBreakdown map[string]*DailyStat
	Granularity     string
}

func dbGetUsageStats(periodMinutes int) *DBUsageStats {
	cutoff := time.Now().Add(-time.Duration(periodMinutes) * time.Minute).UTC()

	granularity := "hour"
	if periodMinutes <= 60 {
		granularity = "minute"
	} else if periodMinutes > 60*24 {
		granularity = "day"
	}

	stats := &DBUsageStats{
		ByProvider:      make(map[string]map[string]interface{}),
		ByModel:         make(map[string]map[string]interface{}),
		DailyBreakdown:  make(map[string]*DailyStat),
		HourlyBreakdown: make(map[string]*DailyStat),
		MinuteBreakdown: make(map[string]*DailyStat),
		Granularity:     granularity,
	}

	groupBy := ""
	if granularity == "minute" {
		groupBy = "STRFTIME('%Y-%m-%d %H:%M', timestamp, 'localtime')"
	} else if granularity == "hour" {
		groupBy = "STRFTIME('%Y-%m-%d %H:00', timestamp, 'localtime')"
	} else {
		groupBy = "DATE(timestamp, 'localtime')"
	}

	query := fmt.Sprintf(`SELECT
		COUNT(*) as total,
		SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success,
		SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors,
		COALESCE(SUM(input_tokens), 0) as input_tokens,
		COALESCE(SUM(output_tokens), 0) as output_tokens,
		COALESCE(SUM(latency_ms), 0) as total_latency,
		provider,
		model,
		%s as bucket
		FROM request_logs
		WHERE timestamp >= ?
		GROUP BY provider, model, %s`, groupBy, groupBy)

	rows, err := db.Query(query, cutoff.Format(time.RFC3339))
	if err != nil {
		log.Printf("[ERROR] dbGetUsageStats: %v", err)
		return stats
	}
	defer rows.Close()

	for rows.Next() {
		var total, success, errors, inputTok, outputTok, totalLat int64
		var provider, model, bucket string
		if err := rows.Scan(&total, &success, &errors, &inputTok, &outputTok, &totalLat, &provider, &model, &bucket); err != nil {
			continue
		}
		stats.TotalRequests += total
		stats.SuccessRequests += success
		stats.ErrorRequests += errors
		stats.InputTokens += inputTok
		stats.OutputTokens += outputTok
		stats.TotalLatencyMs += totalLat

		if _, ok := stats.ByProvider[provider]; !ok {
			stats.ByProvider[provider] = map[string]interface{}{"requests": int64(0), "tokens": int64(0)}
		}
		stats.ByProvider[provider]["requests"] = stats.ByProvider[provider]["requests"].(int64) + total
		stats.ByProvider[provider]["tokens"] = stats.ByProvider[provider]["tokens"].(int64) + inputTok + outputTok

		if _, ok := stats.ByModel[model]; !ok {
			stats.ByModel[model] = map[string]interface{}{"requests": int64(0), "tokens": int64(0)}
		}
		stats.ByModel[model]["requests"] = stats.ByModel[model]["requests"].(int64) + total
		stats.ByModel[model]["tokens"] = stats.ByModel[model]["tokens"].(int64) + inputTok + outputTok

		if granularity == "minute" {
			if _, ok := stats.MinuteBreakdown[bucket]; !ok {
				stats.MinuteBreakdown[bucket] = &DailyStat{}
			}
			stats.MinuteBreakdown[bucket].Requests += total
			stats.MinuteBreakdown[bucket].InputTokens += inputTok
			stats.MinuteBreakdown[bucket].OutputTokens += outputTok
		} else if granularity == "hour" {
			if _, ok := stats.HourlyBreakdown[bucket]; !ok {
				stats.HourlyBreakdown[bucket] = &DailyStat{}
			}
			stats.HourlyBreakdown[bucket].Requests += total
			stats.HourlyBreakdown[bucket].InputTokens += inputTok
			stats.HourlyBreakdown[bucket].OutputTokens += outputTok
		} else {
			if _, ok := stats.DailyBreakdown[bucket]; !ok {
				stats.DailyBreakdown[bucket] = &DailyStat{}
			}
			stats.DailyBreakdown[bucket].Requests += total
			stats.DailyBreakdown[bucket].InputTokens += inputTok
			stats.DailyBreakdown[bucket].OutputTokens += outputTok
		}
	}

	return stats
}

type CallerTopEntry struct {
	APIKeyUsed   string `json:"api_key_used"`
	ClientIP     string `json:"client_ip"`
	Requests     int64  `json:"requests"`
	InputTokens  int64  `json:"input_tokens"`
	OutputTokens int64  `json:"output_tokens"`
}

func dbGetCallerTop10(periodMinutes int) []CallerTopEntry {
	cutoff := time.Now().Add(-time.Duration(periodMinutes) * time.Minute).UTC()
	rows, err := db.Query(`SELECT api_key_used, client_ip, COUNT(*) as cnt,
		COALESCE(SUM(input_tokens), 0) as it, COALESCE(SUM(output_tokens), 0) as ot
		FROM request_logs WHERE timestamp >= ? AND api_key_used != ''
		GROUP BY api_key_used, client_ip ORDER BY cnt DESC LIMIT 10`, cutoff.Format(time.RFC3339))
	if err != nil {
		log.Printf("[ERROR] dbGetCallerTop10: %v", err)
		return nil
	}
	defer rows.Close()

	var result []CallerTopEntry
	for rows.Next() {
		var e CallerTopEntry
		if err := rows.Scan(&e.APIKeyUsed, &e.ClientIP, &e.Requests, &e.InputTokens, &e.OutputTokens); err != nil {
			continue
		}
		result = append(result, e)
	}
	return result
}

type SecurityTokenStats struct {
	TotalChecks  int64            `json:"total_checks"`
	TotalTokens  int64            `json:"total_tokens"`
	InputTokens  int64            `json:"input_tokens"`
	OutputTokens int64            `json:"output_tokens"`
	ByType       map[string]int64 `json:"by_type"`
}

func dbGetSecurityTokenStats(periodMinutes int) *SecurityTokenStats {
	cutoff := time.Now().Add(-time.Duration(periodMinutes) * time.Minute).UTC()
	stats := &SecurityTokenStats{
		ByType: make(map[string]int64),
	}

	row := db.QueryRow(`SELECT COUNT(*),
		COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0)
		FROM request_logs WHERE timestamp >= ? AND (path = '/analysis/v1/chat/completions' OR path = '/security/semantic-check')`,
		cutoff.Format(time.RFC3339))
	row.Scan(&stats.TotalChecks, &stats.InputTokens, &stats.OutputTokens)
	stats.TotalTokens = stats.InputTokens + stats.OutputTokens

	rows, err := db.Query(`SELECT
		CASE
			WHEN path = '/security/semantic-check' THEN 'security_check'
			WHEN request_content LIKE '%"analysis_type":"user_profile%' THEN 'user_profile'
			WHEN request_content LIKE '%"analysis_type":"user_profile_task%' THEN 'user_profile_task'
			WHEN request_content LIKE '%"analysis_type":"skills_detection%' THEN 'skills_detection'
			ELSE 'other'
		END as atype,
		COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) as tok
		FROM request_logs WHERE timestamp >= ? AND (path = '/analysis/v1/chat/completions' OR path = '/security/semantic-check')
		GROUP BY atype`, cutoff.Format(time.RFC3339))
	if err != nil {
		return stats
	}
	defer rows.Close()

	for rows.Next() {
		var atype string
		var tok int64
		if rows.Scan(&atype, &tok) != nil {
			continue
		}
		stats.ByType[atype] += tok
	}
	return stats
}

func dbCreateAnalysisTask(id, taskNo, name, apiKeyID, model, timeRange, scheduleType string, intervalMinutes int) error {
	now := time.Now().UTC().Format(time.RFC3339)
	status := "idle"
	nextRun := ""
	if scheduleType == "periodic" {
		nextRun = time.Now().Add(time.Duration(intervalMinutes) * time.Minute).UTC().Format(time.RFC3339)
		status = "running"
	}
	_, err := db.Exec(`INSERT INTO analysis_tasks (id, task_no, name, api_key_id, model, time_range, schedule_type, interval_minutes, status, next_run_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, taskNo, name, apiKeyID, model, timeRange, scheduleType, intervalMinutes, status, nextRun, now)
	return err
}

func dbGetAnalysisTasks() ([]map[string]interface{}, error) {
	rows, err := db.Query("SELECT id, task_no, name, api_key_id, model, time_range, schedule_type, interval_minutes, status, last_run_at, next_run_at, created_at, result_summary, result_risk_level, result_detail, result_logs_analyzed FROM analysis_tasks ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tasks []map[string]interface{}
	for rows.Next() {
		var id, taskNo, name, apiKeyID, model, timeRange, scheduleType, status string
		var intervalMinutes int
		var lastRunAt, nextRunAt, createdAt sql.NullString
		var resultSummary, resultRiskLevel, resultDetail sql.NullString
		var resultLogsAnalyzed int
		if err := rows.Scan(&id, &taskNo, &name, &apiKeyID, &model, &timeRange, &scheduleType, &intervalMinutes, &status, &lastRunAt, &nextRunAt, &createdAt, &resultSummary, &resultRiskLevel, &resultDetail, &resultLogsAnalyzed); err != nil {
			continue
		}
		task := map[string]interface{}{
			"id":                   id,
			"task_no":              taskNo,
			"name":                 name,
			"api_key_id":           apiKeyID,
			"model":                model,
			"time_range":           timeRange,
			"schedule_type":        scheduleType,
			"interval_minutes":     intervalMinutes,
			"status":               status,
			"created_at":           createdAt,
			"result_logs_analyzed": resultLogsAnalyzed,
		}
		if lastRunAt.Valid {
			task["last_run_at"] = lastRunAt.String
		}
		if nextRunAt.Valid {
			task["next_run_at"] = nextRunAt.String
		}
		if resultSummary.Valid {
			task["result_summary"] = resultSummary.String
		}
		if resultRiskLevel.Valid {
			task["result_risk_level"] = resultRiskLevel.String
		}
		if resultDetail.Valid {
			task["result_detail"] = resultDetail.String
		}
		tasks = append(tasks, task)
	}
	return tasks, nil
}

func dbUpdateAnalysisTask(id, name, apiKeyID, model, timeRange, scheduleType string, intervalMinutes int) error {
	_, err := db.Exec(`UPDATE analysis_tasks SET name=?, api_key_id=?, model=?, time_range=?, schedule_type=?, interval_minutes=? WHERE id=?`,
		name, apiKeyID, model, timeRange, scheduleType, intervalMinutes, id)
	return err
}

func dbUpdateAnalysisTaskStatus(id, status string) error {
	if status == "running" {
		nextRun := time.Now().UTC().Format(time.RFC3339)
		_, err := db.Exec(`UPDATE analysis_tasks SET status=?, next_run_at=? WHERE id=?`, status, nextRun, id)
		return err
	}
	_, err := db.Exec(`UPDATE analysis_tasks SET status=? WHERE id=?`, status, id)
	return err
}

func dbUpdateAnalysisTaskResult(id, riskLevel, summary, detail string, logsAnalyzed int) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Exec(`UPDATE analysis_tasks SET result_risk_level=?, result_summary=?, result_detail=?, result_logs_analyzed=?, last_run_at=? WHERE id=?`,
		riskLevel, summary, detail, logsAnalyzed, now, id)
	return err
}

func dbDeleteAnalysisTask(id string) error {
	_, err := db.Exec("DELETE FROM analysis_tasks WHERE id=?", id)
	return err
}

func dbGetDuePeriodicTasks() ([]map[string]interface{}, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	rows, err := db.Query("SELECT id, task_no, name, api_key_id, model, time_range, interval_minutes FROM analysis_tasks WHERE schedule_type='periodic' AND status='running' AND next_run_at <= ?", now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tasks []map[string]interface{}
	for rows.Next() {
		var id, taskNo, name, apiKeyID, model, timeRange string
		var intervalMinutes int
		if rows.Scan(&id, &taskNo, &name, &apiKeyID, &model, &timeRange, &intervalMinutes) == nil {
			tasks = append(tasks, map[string]interface{}{
				"id": id, "task_no": taskNo, "name": name,
				"api_key_id": apiKeyID, "model": model, "time_range": timeRange,
				"interval_minutes": intervalMinutes,
			})
		}
	}
	return tasks, nil
}

func dbSetTaskNextRun(id string, intervalMinutes int) error {
	nextRun := time.Now().Add(time.Duration(intervalMinutes) * time.Minute).UTC().Format(time.RFC3339)
	_, err := db.Exec("UPDATE analysis_tasks SET next_run_at=? WHERE id=?", nextRun, id)
	return err
}
