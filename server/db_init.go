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
)

var (
	db   *sql.DB
	dbMu sync.Mutex
)

func initDB() error {
	if err := initGormDB(); err != nil {
		return fmt.Errorf("initGormDB: %w", err)
	}

	if err := migrateFromJSON(); err != nil {
		log.Printf("[WARN] initDB: migration from JSON failed (non-fatal): %v", err)
	}

	migrateAdminToUsers()
	backfillSeverity()

	log.Printf("[INFO] initDB: database initialized successfully")
	initTaskCounters()

	seedDefaultThreatRules()
	loadThreatRules()

	return nil
}

func backfillSeverity() {
	rows, err := db.Query("SELECT id, trigger_type, trigger_detail FROM security_alerts WHERE severity = '' OR severity IS NULL")
	if err != nil {
		return
	}
	type row struct {
		id            int64
		triggerType   string
		triggerDetail string
	}
	var updates []row
	for rows.Next() {
		var r row
		if rows.Scan(&r.id, &r.triggerType, &r.triggerDetail) == nil {
			updates = append(updates, r)
		}
	}
	rows.Close()

	for _, r := range updates {
		sev := severityFromTrigger(r.triggerType, r.triggerDetail)
		if sev != "" {
			db.Exec("UPDATE security_alerts SET severity = ? WHERE id = ?", sev, r.id)
		}
	}
	if len(updates) > 0 {
		log.Printf("[INFO] backfillSeverity: updated %d alerts", len(updates))
	}
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

func migrateAPIKeysLastSynced() error {
	rows, err := db.Query("PRAGMA table_info(api_keys)")
	if err != nil {
		return err
	}
	defer rows.Close()
	hasLastSynced := false
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull int
		var dfltValue interface{}
		var pk int
		rows.Scan(&cid, &name, &ctype, &notnull, &dfltValue, &pk)
		if name == "last_synced" {
			hasLastSynced = true
			break
		}
	}
	if !hasLastSynced {
		_, err := db.Exec("ALTER TABLE api_keys ADD COLUMN last_synced DATETIME")
		if err != nil {
			return fmt.Errorf("failed to add last_synced column: %w", err)
		}
		log.Printf("[INFO] migrateAPIKeysLastSynced: added last_synced column")
	}
	return nil
}

func migrateRequestLogsColumns() error {
	cols := map[string]string{
		"is_proxy_call":      "INTEGER DEFAULT 0",
		"call_type":          "TEXT DEFAULT ''",
		"upstream_request_headers":  "TEXT DEFAULT ''",
		"upstream_response_headers": "TEXT DEFAULT ''",
		"upstream_request_body":    "TEXT DEFAULT ''",
		"upstream_response_body":    "TEXT DEFAULT ''",
		"upstream_provider":  "TEXT DEFAULT ''",
		"upstream_model":     "TEXT DEFAULT ''",
	}
	for colName, colDef := range cols {
		rows, err := db.Query("PRAGMA table_info(request_logs)")
		if err != nil {
			return err
		}
		hasCol := false
		for rows.Next() {
			var cid int
			var cname string
			var ctype string
			var cnotnull int
			var cdflt_value interface{}
			var cpk int
			if err := rows.Scan(&cid, &cname, &ctype, &cnotnull, &cdflt_value, &cpk); err != nil {
				rows.Close()
				continue
			}
			if cname == colName {
				hasCol = true
				break
			}
		}
		rows.Close()
		if !hasCol {
			_, err := db.Exec(fmt.Sprintf("ALTER TABLE request_logs ADD COLUMN %s %s", colName, colDef))
			if err != nil {
				log.Printf("[WARN] migrateRequestLogsColumns: failed to add %s: %v", colName, err)
			} else {
				log.Printf("[INFO] migrateRequestLogsColumns: added %s", colName)
			}
		}
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
		`CREATE TABLE IF NOT EXISTS threat_rules (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			threat_type TEXT NOT NULL,
			name TEXT NOT NULL,
			patterns_json TEXT NOT NULL,
			severity TEXT DEFAULT 'high',
			enabled INTEGER DEFAULT 1,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_threat_rules_type ON threat_rules(threat_type)`,
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
		`CREATE TABLE IF NOT EXISTS providers (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			provider_type TEXT NOT NULL,
			auth_type TEXT DEFAULT 'apikey',
			enabled INTEGER DEFAULT 1,
			base_url TEXT DEFAULT '',
			api_key TEXT DEFAULT '',
			models TEXT DEFAULT '[]',
			disabled_models TEXT DEFAULT '[]',
			oauth_config TEXT DEFAULT '',
			rate_limits TEXT DEFAULT '',
			priority INTEGER DEFAULT 0,
			created_by TEXT DEFAULT '',
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS model_mappings (
			alias TEXT PRIMARY KEY,
			provider_id TEXT NOT NULL,
			model TEXT NOT NULL,
			description TEXT DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS profiles (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			providers_json TEXT DEFAULT '{}',
			mappings_json TEXT DEFAULT '{}',
			gateway_json TEXT DEFAULT '{}',
			advanced_json TEXT DEFAULT '{}',
			service_json TEXT DEFAULT '{}',
			is_active INTEGER DEFAULT 0,
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS system_analysis_config (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			enabled INTEGER DEFAULT 1,
			model TEXT DEFAULT '',
			api_key_id TEXT DEFAULT '',
			time_range TEXT DEFAULT '7d',
			interval_minutes INTEGER DEFAULT 60,
			notify_on_high_risk INTEGER DEFAULT 1,
			auto_block_risk_level TEXT DEFAULT '',
			created_at TEXT DEFAULT '',
			updated_at TEXT DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS system_analysis_tasks (
			id TEXT PRIMARY KEY,
			task_no TEXT NOT NULL,
			name TEXT NOT NULL,
			api_key_id TEXT DEFAULT '',
			model TEXT DEFAULT '',
			time_range TEXT DEFAULT '7d',
			schedule_type TEXT DEFAULT 'once',
			interval_minutes INTEGER DEFAULT 60,
			status TEXT DEFAULT 'idle',
			result_risk_level TEXT DEFAULT '',
			result_summary TEXT DEFAULT '',
			result_detail TEXT DEFAULT '',
			result_dimensions TEXT DEFAULT '',
			result_logs_analyzed INTEGER DEFAULT 0,
			last_run_at TEXT DEFAULT '',
			next_run_at TEXT DEFAULT '',
			created_at TEXT DEFAULT '',
			created_by TEXT DEFAULT '__system__'
		)`,
		`CREATE INDEX IF NOT EXISTS idx_sat_status_next ON system_analysis_tasks(status, next_run_at)`,
		`CREATE TABLE IF NOT EXISTS system_analysis_task_history (
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
		`CREATE INDEX IF NOT EXISTS idx_sath_task ON system_analysis_task_history(task_id)`,
		`CREATE TABLE IF NOT EXISTS user_settings (
			user_id TEXT NOT NULL,
			key TEXT NOT NULL,
			value TEXT NOT NULL DEFAULT '',
			PRIMARY KEY (user_id, key)
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
	db.Exec("ALTER TABLE security_alerts ADD COLUMN severity TEXT DEFAULT ''")

	backfillSeverity()

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
