package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
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

	if err := migrateAPIKeysUserID(); err != nil {
		log.Printf("[WARN] initDB: migration api_keys_user_id failed (non-fatal): %v", err)
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

func migrateAPIKeysUserID() error {
	rows, err := db.Query("PRAGMA table_info(api_keys)")
	if err != nil {
		return err
	}
	defer rows.Close()

	hasUserID := false
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
		if cname == "user_id" {
			hasUserID = true
			break
		}
	}
	if !hasUserID {
		_, err := db.Exec("ALTER TABLE api_keys ADD COLUMN user_id TEXT DEFAULT ''")
		if err != nil {
			return fmt.Errorf("failed to add user_id column: %w", err)
		}
		log.Printf("[INFO] migrateAPIKeysUserID: added user_id column")
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
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL UNIQUE,
			display_name TEXT DEFAULT '',
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'user',
			status TEXT NOT NULL DEFAULT 'active',
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL,
			last_login_at DATETIME
		)`,
		`CREATE TABLE IF NOT EXISTS system_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL DEFAULT ''
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
			result_dimensions TEXT DEFAULT '',
			result_logs_analyzed INTEGER DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_analysis_tasks_status ON analysis_tasks(status)`,
		`CREATE TABLE IF NOT EXISTS skills_tasks (
			id TEXT PRIMARY KEY,
			task_no TEXT NOT NULL,
			name TEXT NOT NULL,
			model TEXT DEFAULT '',
			source_type TEXT DEFAULT 'text',
			source_info TEXT DEFAULT '',
			schedule_type TEXT DEFAULT 'once',
			status TEXT DEFAULT 'idle',
			progress TEXT DEFAULT '',
			last_run_at DATETIME,
			created_at DATETIME NOT NULL,
			result_risk_level TEXT DEFAULT '',
			result_summary TEXT DEFAULT '',
			result_detail TEXT DEFAULT '',
			result_dimensions TEXT DEFAULT ''
		)`,
		`CREATE INDEX IF NOT EXISTS idx_skills_tasks_status ON skills_tasks(status)`,
		`CREATE TABLE IF NOT EXISTS skills_task_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			task_id TEXT NOT NULL,
			risk_level TEXT DEFAULT '',
			summary TEXT DEFAULT '',
			detail TEXT DEFAULT '',
			dimensions TEXT DEFAULT '',
			status TEXT DEFAULT '',
			duration_ms INTEGER DEFAULT 0,
			run_at DATETIME NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_skills_task_history_task ON skills_task_history(task_id)`,
		`CREATE TABLE IF NOT EXISTS analysis_task_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			task_id TEXT NOT NULL,
			risk_level TEXT DEFAULT '',
			summary TEXT DEFAULT '',
			detail TEXT DEFAULT '',
			dimensions TEXT DEFAULT '',
			logs_analyzed INTEGER DEFAULT 0,
			status TEXT DEFAULT '',
			duration_ms INTEGER DEFAULT 0,
			run_at DATETIME NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_analysis_task_history_task ON analysis_task_history(task_id)`,
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
	db.Exec("ALTER TABLE request_logs ADD COLUMN user_id TEXT DEFAULT ''")
	db.Exec("ALTER TABLE request_logs ADD COLUMN api_key_id TEXT DEFAULT ''")
	db.Exec("ALTER TABLE analysis_tasks ADD COLUMN result_dimensions TEXT DEFAULT ''")
	db.Exec("ALTER TABLE analysis_tasks ADD COLUMN progress TEXT DEFAULT ''")

	db.Exec("ALTER TABLE analysis_tasks ADD COLUMN created_by TEXT DEFAULT ''")
	db.Exec("ALTER TABLE analysis_task_history ADD COLUMN created_by TEXT DEFAULT ''")
	db.Exec("ALTER TABLE skills_tasks ADD COLUMN created_by TEXT DEFAULT ''")
	db.Exec("ALTER TABLE skills_task_history ADD COLUMN created_by TEXT DEFAULT ''")
	db.Exec("ALTER TABLE skills_detection_history ADD COLUMN created_by TEXT DEFAULT ''")
	db.Exec("ALTER TABLE profile_analysis_history ADD COLUMN created_by TEXT DEFAULT ''")

	migrateAdminToUsers()

	return nil
}

func migrateAdminToUsers() {
	var count int
	db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if count > 0 {
		return
	}

	var adminCount int
	db.QueryRow("SELECT COUNT(*) FROM admin_users").Scan(&adminCount)
	if adminCount == 0 {
		return
	}

	var username, passwordHash string
	var role string
	err := db.QueryRow("SELECT username, password_hash, role FROM admin_users WHERE id = 1").Scan(&username, &passwordHash, &role)
	if err != nil {
		log.Printf("[WARN] migrateAdminToUsers: failed to read admin_users: %v", err)
		return
	}

	adminID := "user_admin"
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = db.Exec(`INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
		adminID, username, username, passwordHash, "admin", now, now)
	if err != nil {
		log.Printf("[WARN] migrateAdminToUsers: failed to insert admin into users: %v", err)
		return
	}

	log.Printf("[INFO] migrateAdminToUsers: migrated admin user '%s' to users table", username)
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
		provider, model, DATE(timestamp, 'localtime') as date
		FROM request_logs
		GROUP BY provider, model, DATE(timestamp, 'localtime')`)
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
	_, err := db.Exec(`INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, latency_ms, success, error_message, client_ip, api_key_used, status_code, path, method, request_content, response_content, user_id, api_key_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entry.Timestamp.UTC().Format(time.RFC3339), entry.Provider, entry.Model,
		entry.InputTokens, entry.OutputTokens, entry.LatencyMs,
		boolToInt(entry.Success), entry.ErrorMessage, entry.ClientIP,
		entry.APIKeyUsed, entry.StatusCode, entry.Path, entry.Method,
		entry.RequestContent, entry.ResponseContent, entry.UserID, entry.APIKeyID)
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

func dbGetRecentLogs(limit int, userID string) ([]*RequestLog, int) {
	var total int
	var rows *sql.Rows
	var err error
	if userID != "" {
		// Normal user: only see their own logs (matched by user_id from JWT or API key's user_id)
		db.QueryRow("SELECT COUNT(*) FROM request_logs WHERE user_id = ?", userID).Scan(&total)
		rows, err = db.Query("SELECT id, timestamp, provider, model, input_tokens, output_tokens, latency_ms, success, error_message, client_ip, api_key_used, status_code, path, method, COALESCE(request_content,''), COALESCE(response_content,''), COALESCE(user_id,''), COALESCE(api_key_id,'') FROM request_logs WHERE user_id = ? ORDER BY id DESC LIMIT ?", userID, limit)
	} else {
		// Admin or no auth: return all logs
		db.QueryRow("SELECT COUNT(*) FROM request_logs").Scan(&total)
		rows, err = db.Query("SELECT id, timestamp, provider, model, input_tokens, output_tokens, latency_ms, success, error_message, client_ip, api_key_used, status_code, path, method, COALESCE(request_content,''), COALESCE(response_content,''), COALESCE(user_id,''), COALESCE(api_key_id,'') FROM request_logs ORDER BY id DESC LIMIT ?", limit)
	}
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
			&entry.RequestContent, &entry.ResponseContent, &entry.UserID, &entry.APIKeyID); err != nil {
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

func dbInsertSkillsDetection(sourceType, sourceInfo, result, riskLevel, modelUsed, apiKeyID, createdBy string) {
	_, err := db.Exec(`INSERT INTO skills_detection_history (checked_at, source_type, source_info, result, risk_level, model_used, api_key_id, created_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		time.Now().UTC().Format(time.RFC3339), sourceType, sourceInfo, result, riskLevel, modelUsed, apiKeyID, createdBy)
	if err != nil {
		log.Printf("[ERROR] dbInsertSkillsDetection: %v", err)
	}
}

func dbGetSkillsDetectionHistory(limit, offset int, userID string) ([]map[string]interface{}, int) {
	var total int
	if userID != "" {
		db.QueryRow("SELECT COUNT(*) FROM skills_detection_history WHERE created_by = ? OR created_by = ''", userID).Scan(&total)
	} else {
		db.QueryRow("SELECT COUNT(*) FROM skills_detection_history").Scan(&total)
	}

	var rows *sql.Rows
	var err error
	if userID != "" {
		rows, err = db.Query("SELECT id, checked_at, source_type, source_info, result, risk_level, model_used, api_key_id FROM skills_detection_history WHERE created_by = ? OR created_by = '' ORDER BY id DESC LIMIT ? OFFSET ?", userID, limit, offset)
	} else {
		rows, err = db.Query("SELECT id, checked_at, source_type, source_info, result, risk_level, model_used, api_key_id FROM skills_detection_history ORDER BY id DESC LIMIT ? OFFSET ?", limit, offset)
	}
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

func dbInsertProfileAnalysis(apiKeyID, timeRange, riskLevel, summary, result, modelUsed string, logsAnalyzed int, createdBy string) {
	_, err := db.Exec(`INSERT INTO profile_analysis_history (analyzed_at, api_key_id, time_range, risk_level, summary, result, model_used, logs_analyzed, created_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		time.Now().UTC().Format(time.RFC3339), apiKeyID, timeRange, riskLevel, summary, result, modelUsed, logsAnalyzed, createdBy)
	if err != nil {
		log.Printf("[ERROR] dbInsertProfileAnalysis: %v", err)
	}
}

func dbGetProfileAnalysisHistory(limit, offset int, userID string) ([]map[string]interface{}, int) {
	var total int
	if userID != "" {
		db.QueryRow("SELECT COUNT(*) FROM profile_analysis_history WHERE created_by = ? OR created_by = ''", userID).Scan(&total)
	} else {
		db.QueryRow("SELECT COUNT(*) FROM profile_analysis_history").Scan(&total)
	}

	var rows *sql.Rows
	var err error
	if userID != "" {
		rows, err = db.Query("SELECT id, analyzed_at, api_key_id, time_range, risk_level, summary, result, model_used, logs_analyzed FROM profile_analysis_history WHERE created_by = ? OR created_by = '' ORDER BY id DESC LIMIT ? OFFSET ?", userID, limit, offset)
	} else {
		rows, err = db.Query("SELECT id, analyzed_at, api_key_id, time_range, risk_level, summary, result, model_used, logs_analyzed FROM profile_analysis_history ORDER BY id DESC LIMIT ? OFFSET ?", limit, offset)
	}
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

func dbCreateAnalysisTask(id, taskNo, name, apiKeyID, model, timeRange, scheduleType string, intervalMinutes int, createdBy string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	status := "idle"
	nextRun := ""
	if scheduleType == "periodic" {
		nextRun = time.Now().Add(time.Duration(intervalMinutes) * time.Minute).UTC().Format(time.RFC3339)
		status = "running"
	}
	_, err := db.Exec(`INSERT INTO analysis_tasks (id, task_no, name, api_key_id, model, time_range, schedule_type, interval_minutes, status, next_run_at, created_at, created_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, taskNo, name, apiKeyID, model, timeRange, scheduleType, intervalMinutes, status, nextRun, now, createdBy)
	return err
}

func dbGetAnalysisTasks(userID string) ([]map[string]interface{}, error) {
	query := "SELECT id, task_no, name, api_key_id, model, time_range, schedule_type, interval_minutes, status, last_run_at, next_run_at, created_at, result_summary, result_risk_level, result_detail, result_dimensions, result_logs_analyzed, progress FROM analysis_tasks"
	var rows *sql.Rows
	var err error
	if userID != "" {
		rows, err = db.Query(query+" WHERE created_by = ? OR created_by = '' ORDER BY created_at DESC", userID)
	} else {
		rows, err = db.Query(query + " ORDER BY created_at DESC")
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tasks []map[string]interface{}
	for rows.Next() {
		var id, taskNo, name, apiKeyID, model, timeRange, scheduleType, status string
		var intervalMinutes int
		var lastRunAt, nextRunAt, createdAt sql.NullString
		var resultSummary, resultRiskLevel, resultDetail, resultDimensions sql.NullString
		var resultLogsAnalyzed int
		var progress sql.NullString
		if err := rows.Scan(&id, &taskNo, &name, &apiKeyID, &model, &timeRange, &scheduleType, &intervalMinutes, &status, &lastRunAt, &nextRunAt, &createdAt, &resultSummary, &resultRiskLevel, &resultDetail, &resultDimensions, &resultLogsAnalyzed, &progress); err != nil {
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
		if resultDimensions.Valid && resultDimensions.String != "" {
			task["result_dimensions"] = resultDimensions.String
		}
		if progress.Valid {
			task["progress"] = progress.String
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
		_, err := db.Exec(`UPDATE analysis_tasks SET status=?, next_run_at=?, progress='正在分析...' WHERE id=?`, status, nextRun, id)
		return err
	}
	_, err := db.Exec(`UPDATE analysis_tasks SET status=? WHERE id=?`, status, id)
	return err
}

func dbUpdateAnalysisTaskProgress(id, progress string) error {
	_, err := db.Exec(`UPDATE analysis_tasks SET progress=? WHERE id=?`, progress, id)
	return err
}

func dbUpdateAnalysisTaskResult(id, riskLevel, summary, detail, dimensions string, logsAnalyzed int) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Exec(`UPDATE analysis_tasks SET result_risk_level=?, result_summary=?, result_detail=?, result_dimensions=?, result_logs_analyzed=?, last_run_at=? WHERE id=?`,
		riskLevel, summary, detail, dimensions, logsAnalyzed, now, id)
	return err
}

func dbDeleteAnalysisTask(id, userID string) error {
	if userID != "" {
		_, err := db.Exec("DELETE FROM analysis_tasks WHERE id=? AND (created_by=? OR created_by='')", id, userID)
		return err
	}
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

var skillsTaskCounter int64

func nextSkillsTaskNo() string {
	n := atomic.AddInt64(&skillsTaskCounter, 1)
	return fmt.Sprintf("SK%04d", n)
}

func dbCreateSkillsTask(id, taskNo, name, model, sourceType, sourceInfo, scheduleType string, createdBy string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Exec(`INSERT INTO skills_tasks (id, task_no, name, model, source_type, source_info, schedule_type, status, created_at, created_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)`,
		id, taskNo, name, model, sourceType, sourceInfo, scheduleType, now, createdBy)
	return err
}

func dbGetSkillsTasks(userID string) ([]map[string]interface{}, error) {
	query := "SELECT id, task_no, name, model, source_type, source_info, schedule_type, status, progress, last_run_at, created_at, result_risk_level, result_summary, result_detail, result_dimensions, created_by FROM skills_tasks"
	var rows *sql.Rows
	var err error
	if userID != "" {
		rows, err = db.Query(query+" WHERE created_by = ? OR created_by = '' ORDER BY created_at DESC", userID)
	} else {
		rows, err = db.Query(query + " ORDER BY created_at DESC")
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tasks []map[string]interface{}
	for rows.Next() {
var id, taskNo, name, model, sourceType, sourceInfo, scheduleType, status string
	var lastRunAt, createdAt, createdBy sql.NullString
	var resultRiskLevel, resultSummary, resultDetail, resultDimensions, progress sql.NullString
	if err := rows.Scan(&id, &taskNo, &name, &model, &sourceType, &sourceInfo, &scheduleType, &status, &progress, &lastRunAt, &createdAt, &resultRiskLevel, &resultSummary, &resultDetail, &resultDimensions, &createdBy); err != nil {
			continue
		}
		task := map[string]interface{}{
			"id": id, "task_no": taskNo, "name": name, "model": model,
			"source_type": sourceType, "source_info": sourceInfo,
			"schedule_type": scheduleType, "status": status, "created_at": createdAt,
		}
		if createdBy.Valid {
			task["created_by"] = createdBy.String
		}
		if lastRunAt.Valid {
			task["last_run_at"] = lastRunAt.String
		}
		if resultRiskLevel.Valid {
			task["result_risk_level"] = resultRiskLevel.String
		}
		if resultSummary.Valid {
			task["result_summary"] = resultSummary.String
		}
		if resultDetail.Valid {
			task["result_detail"] = resultDetail.String
		}
		if resultDimensions.Valid && resultDimensions.String != "" {
			task["result_dimensions"] = resultDimensions.String
		}
		if progress.Valid {
			task["progress"] = progress.String
		}
		tasks = append(tasks, task)
	}
	return tasks, nil
}

func dbUpdateSkillsTaskResult(id, riskLevel, summary, detail, dimensions string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Exec(`UPDATE skills_tasks SET result_risk_level=?, result_summary=?, result_detail=?, result_dimensions=?, last_run_at=?, status='idle', progress='' WHERE id=?`,
		riskLevel, summary, detail, dimensions, now, id)
	return err
}

func dbUpdateSkillsTaskStatus(id, status string) error {
	_, err := db.Exec(`UPDATE skills_tasks SET status=?, progress='正在检测...' WHERE id=?`, status, id)
	return err
}

func dbDeleteSkillsTask(id, userID string) error {
	if userID != "" {
		_, err := db.Exec("DELETE FROM skills_tasks WHERE id=? AND (created_by=? OR created_by='')", id, userID)
		return err
	}
	_, err := db.Exec("DELETE FROM skills_tasks WHERE id=?", id)
	return err
}

// ==================== Users DB ====================

func dbCreateUser(id, username, displayName, passwordHash, role string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Exec(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
		id, username, displayName, passwordHash, role, now, now)
	return err
}

func dbGetUserByUsername(username string) (map[string]interface{}, error) {
	row := db.QueryRow("SELECT id, username, display_name, password_hash, role, status, created_at, updated_at, last_login_at FROM users WHERE username = ?", username)
	var id, uname, displayName, hash, role, status string
	var createdAt, updatedAt string
	var lastLogin sql.NullString
	if err := row.Scan(&id, &uname, &displayName, &hash, &role, &status, &createdAt, &updatedAt, &lastLogin); err != nil {
		return nil, err
	}
	user := map[string]interface{}{
		"id": id, "username": uname, "display_name": displayName,
		"password_hash": hash, "role": role, "status": status,
		"created_at": createdAt, "updated_at": updatedAt,
	}
	if lastLogin.Valid {
		user["last_login_at"] = lastLogin.String
	}
	return user, nil
}

func dbGetUserByID(id string) (map[string]interface{}, error) {
	row := db.QueryRow("SELECT id, username, display_name, password_hash, role, status, created_at, updated_at, last_login_at FROM users WHERE id = ?", id)
	var uid, uname, displayName, hash, role, status string
	var createdAt, updatedAt string
	var lastLogin sql.NullString
	if err := row.Scan(&uid, &uname, &displayName, &hash, &role, &status, &createdAt, &updatedAt, &lastLogin); err != nil {
		return nil, err
	}
	user := map[string]interface{}{
		"id": uid, "username": uname, "display_name": displayName,
		"password_hash": hash, "role": role, "status": status,
		"created_at": createdAt, "updated_at": updatedAt,
	}
	if lastLogin.Valid {
		user["last_login_at"] = lastLogin.String
	}
	return user, nil
}

func dbListUsers() ([]map[string]interface{}, error) {
	rows, err := db.Query("SELECT id, username, display_name, role, status, created_at, updated_at, last_login_at FROM users ORDER BY created_at ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []map[string]interface{}
	for rows.Next() {
		var id, username, displayName, role, status string
		var createdAt, updatedAt string
		var lastLogin sql.NullString
		if err := rows.Scan(&id, &username, &displayName, &role, &status, &createdAt, &updatedAt, &lastLogin); err != nil {
			continue
		}
		user := map[string]interface{}{
			"id": id, "username": username, "display_name": displayName,
			"role": role, "status": status, "created_at": createdAt, "updated_at": updatedAt,
		}
		if lastLogin.Valid {
			user["last_login_at"] = lastLogin.String
		}
		users = append(users, user)
	}
	return users, nil
}

func dbUpdateUser(id, displayName, role, status string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Exec(`UPDATE users SET display_name=?, role=?, status=?, updated_at=? WHERE id=?`,
		displayName, role, status, now, id)
	return err
}

func dbUpdateUserPassword(id, passwordHash string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Exec(`UPDATE users SET password_hash=?, updated_at=? WHERE id=?`, passwordHash, now, id)
	return err
}

func dbUpdateUserLastLogin(id string) {
	now := time.Now().UTC().Format(time.RFC3339)
	db.Exec(`UPDATE users SET last_login_at=? WHERE id=?`, now, id)
}

func dbDeleteUser(id string) error {
	_, err := db.Exec("DELETE FROM users WHERE id=?", id)
	return err
}

func dbUserExists() bool {
	var count int
	db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	return count > 0
}

func dbAdminExists() bool {
	var count int
	db.QueryRow("SELECT COUNT(*) FROM users WHERE role = 'admin'").Scan(&count)
	return count > 0
}

func dbAnyUserExists() bool {
	var count int
	db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	return count > 0
}

// ==================== System Settings DB ====================

func dbGetSystemSetting(key string) string {
	var val string
	err := db.QueryRow("SELECT value FROM system_settings WHERE key = ?", key).Scan(&val)
	if err != nil {
		return ""
	}
	return val
}

func dbSetSystemSetting(key, value string) {
	db.Exec(`INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)`, key, value)
}

func dbIsRegistrationOpen() bool {
	return dbGetSystemSetting("registration_open") == "true"
}

func dbSetRegistrationOpen(open bool) {
	val := "false"
	if open {
		val = "true"
	}
	dbSetSystemSetting("registration_open", val)
}

func dbUpdateSkillsTask(id, name, model, sourceType, sourceInfo string) error {
	_, err := db.Exec(`UPDATE skills_tasks SET name=?, model=?, source_type=?, source_info=? WHERE id=?`,
		name, model, sourceType, sourceInfo, id)
	return err
}

func dbInsertSkillsTaskHistory(taskID, riskLevel, summary, detail, dimensions, status string, durationMs int64) {
	now := time.Now().UTC().Format(time.RFC3339)
	db.Exec(`INSERT INTO skills_task_history (task_id, risk_level, summary, detail, dimensions, status, duration_ms, run_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		taskID, riskLevel, summary, detail, dimensions, status, durationMs, now)
}

func dbGetSkillsTaskHistory(taskID string) ([]map[string]interface{}, error) {
	rows, err := db.Query(`SELECT id, risk_level, summary, detail, dimensions, status, duration_ms, run_at FROM skills_task_history WHERE task_id=? ORDER BY run_at DESC LIMIT 50`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []map[string]interface{}
	for rows.Next() {
		var id int
		var riskLevel, summary, detail, dimensions, status, runAt string
		var durationMs int64
		if err := rows.Scan(&id, &riskLevel, &summary, &detail, &dimensions, &status, &durationMs, &runAt); err != nil {
			continue
		}
		results = append(results, map[string]interface{}{
			"id": id, "risk_level": riskLevel, "summary": summary, "detail": detail,
			"dimensions": dimensions, "status": status, "duration_ms": durationMs, "run_at": runAt,
		})
	}
	return results, nil
}

func dbInsertAnalysisTaskHistory(taskID, riskLevel, summary, detail, dimensions, status string, logsAnalyzed int, durationMs int64) {
	now := time.Now().UTC().Format(time.RFC3339)
	db.Exec(`INSERT INTO analysis_task_history (task_id, risk_level, summary, detail, dimensions, logs_analyzed, status, duration_ms, run_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		taskID, riskLevel, summary, detail, dimensions, logsAnalyzed, status, durationMs, now)
}

func dbGetAnalysisTaskHistory(taskID string) ([]map[string]interface{}, error) {
	rows, err := db.Query(`SELECT id, risk_level, summary, detail, dimensions, logs_analyzed, status, duration_ms, run_at FROM analysis_task_history WHERE task_id=? ORDER BY run_at DESC LIMIT 50`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []map[string]interface{}
	for rows.Next() {
		var id int
		var riskLevel, summary, detail, dimensions, status, runAt string
		var logsAnalyzed int
		var durationMs int64
		if err := rows.Scan(&id, &riskLevel, &summary, &detail, &dimensions, &logsAnalyzed, &status, &durationMs, &runAt); err != nil {
			continue
		}
		results = append(results, map[string]interface{}{
			"id": id, "risk_level": riskLevel, "summary": summary, "detail": detail,
			"dimensions": dimensions, "logs_analyzed": logsAnalyzed, "status": status, "duration_ms": durationMs, "run_at": runAt,
		})
	}
	return results, nil
}
