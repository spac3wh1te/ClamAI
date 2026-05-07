package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/mux"
)

var (
	systemAnalysisConfig     SystemAnalysisConfig
	systemAnalysisConfigMu    sync.RWMutex
	systemAnalysisTaskCounter int64
)

type SystemAnalysisConfig struct {
	Enabled            bool   `json:"enabled"`
	Model              string `json:"model"`
	APIKeyID           string `json:"api_key_id"`
	TimeRange          string `json:"time_range"`
	IntervalMinutes    int    `json:"interval_minutes"`
	NotifyOnHighRisk   bool   `json:"notify_on_high_risk"`
	AutoBlockRiskLevel string `json:"auto_block_risk_level"`
}

type SystemAnalysisTask struct {
	ID                 string `json:"id"`
	TaskNo             string `json:"task_no"`
	Name               string `json:"name"`
	APIKeyID           string `json:"api_key_id"`
	Model              string `json:"model"`
	TimeRange          string `json:"time_range"`
	ScheduleType       string `json:"schedule_type"`
	IntervalMinutes    int    `json:"interval_minutes"`
	Status             string `json:"status"`
	ResultRiskLevel    string `json:"result_risk_level"`
	ResultSummary      string `json:"result_summary"`
	ResultDetail       string `json:"result_detail"`
	ResultDimensions   string `json:"result_dimensions"`
	ResultLogsAnalyzed int    `json:"result_logs_analyzed"`
	LastRunAt          string `json:"last_run_at"`
	NextRunAt          string `json:"next_run_at"`
	CreatedAt          string `json:"created_at"`
}

var proxyServerForSystemAnalysis *ProxyServer

func initSystemAnalysis() {
	proxyServerForSystemAnalysis = getProxyServer()
	row := db.QueryRow("SELECT COUNT(*) FROM system_analysis_config")
	var cnt int
	if row.Scan(&cnt) == nil && cnt == 0 {
		db.Exec(`INSERT INTO system_analysis_config (id, enabled, model, time_range, interval_minutes, notify_on_high_risk, created_at, updated_at) VALUES (1, 1, '', '', '7d', 60, 1, '', '')`)
	}
	loadSystemAnalysisConfig()
	initSystemAnalysisTaskCounter()
	go startSystemAnalysisScheduler()
}

func loadSystemAnalysisConfig() {
	row := db.QueryRow("SELECT enabled, model, api_key_id, time_range, interval_minutes, notify_on_high_risk, auto_block_risk_level FROM system_analysis_config WHERE id = 1")
	var cfg SystemAnalysisConfig
	var autoBlock sql.NullString
	err := row.Scan(&cfg.Enabled, &cfg.Model, &cfg.APIKeyID, &cfg.TimeRange, &cfg.IntervalMinutes, &cfg.NotifyOnHighRisk, &autoBlock)
	if err != nil {
		cfg.Enabled = true
		cfg.TimeRange = "7d"
		cfg.IntervalMinutes = 60
		cfg.NotifyOnHighRisk = true
	}
	if autoBlock.Valid {
		cfg.AutoBlockRiskLevel = autoBlock.String
	}
	systemAnalysisConfigMu.Lock()
	systemAnalysisConfig = cfg
	systemAnalysisConfigMu.Unlock()
	log.Printf("[INFO] loadSystemAnalysisConfig: enabled=%v model=%s interval=%dmin",
		cfg.Enabled, cfg.Model, cfg.IntervalMinutes)
}

func initSystemAnalysisTaskCounter() {
	var maxNo string
	row := db.QueryRow("SELECT COALESCE(MAX(task_no), 'S0000') FROM system_analysis_tasks")
	if row.Scan(&maxNo) == nil && len(maxNo) > 1 {
		var n int
		if _, err := fmt.Sscanf(maxNo, "S%d", &n); err == nil {
			systemAnalysisTaskCounter = int64(n)
		}
	}
}

func nextSystemTaskNo() string {
	n := atomic.AddInt64(&systemAnalysisTaskCounter, 1)
	return fmt.Sprintf("S%04d", n)
}

func startSystemAnalysisScheduler() {
	ticker := time.NewTicker(30 * time.Second)
	for range ticker.C {
		systemAnalysisConfigMu.RLock()
		cfg := systemAnalysisConfig
		systemAnalysisConfigMu.RUnlock()
		if !cfg.Enabled || cfg.Model == "" {
			continue
		}
		tasks, err := dbGetDueSystemAnalysisTasks()
		if err != nil || len(tasks) == 0 {
			continue
		}
		for _, task := range tasks {
			taskID, _ := task["id"].(string)
			safeGo(func() { executeSystemAnalysisTask(taskID, task) })
			dbSetSystemTaskNextRun(taskID, cfg.IntervalMinutes)
		}
	}
}

func dbGetDueSystemAnalysisTasks() ([]map[string]interface{}, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	rows, err := db.Query("SELECT id, task_no, name, api_key_id, model, time_range, interval_minutes FROM system_analysis_tasks WHERE schedule_type='periodic' AND status='running' AND next_run_at <= ?", now)
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

func dbSetSystemTaskNextRun(id string, intervalMinutes int) error {
	nextRun := time.Now().Add(time.Duration(intervalMinutes) * time.Minute).UTC().Format(time.RFC3339)
	_, err := db.Exec("UPDATE system_analysis_tasks SET next_run_at=? WHERE id=?", nextRun, id)
	return err
}

func executeSystemAnalysisTask(taskID string, task map[string]interface{}) {
	taskStart := time.Now()
	model, _ := task["model"].(string)
	apiKeyID, _ := task["api_key_id"].(string)
	timeRange, _ := task["time_range"].(string)
	if timeRange == "" {
		timeRange = "7d"
	}

	log.Printf("[SYS-ANALYSIS] executeSystemAnalysisTask START id=%s model=%s apiKeyID=%s", taskID, model, apiKeyID)

	if apiKeyID == "" {
		apiKeysMu.Lock()
		defer apiKeysMu.Unlock()
		for kid, k := range apiKeysByID {
			apiKeyID = kid
			_ = k
			break
		}
	}

apiKeysMu.Lock()
	gatewayKey, exists := apiKeysByID[apiKeyID]
	apiKeysMu.Unlock()
	if !exists {
		log.Printf("[SYS-ANALYSIS] ERROR id=%s API Key not found: %s", taskID, apiKeyID)
		dbUpdateSystemAnalysisTaskResult(taskID, "error", "API Key not found", "", "", 0)
		return
	}

	modelForGateway := model
	if !strings.Contains(modelForGateway, ":") {
		provider, _ := proxyServerForSystemAnalysis.resolveProvider(modelForGateway)
		if provider != nil {
			modelForGateway = provider.GetName() + ":" + modelForGateway
		}
	}

	days := 7
	switch timeRange {
	case "1d":
		days = 1
	case "3d":
		days = 3
	case "7d":
		days = 7
	case "30d":
		days = 30
	}

	logs, total := dbGetLogsByAPIKey(maskAPIKeyForLog(gatewayKey.Key), 500)

	var conversationSummary strings.Builder
	conversationSummary.WriteString(fmt.Sprintf("以下是通过该API Key的最近%d天的调用记录（共%d条），请分析调用者行为模式，识别潜在安全威胁：\n\n", days, len(logs)))

	for i, l := range logs {
		timestamp := l.Timestamp.Local().Format("2006-01-02 15:04:05")
		conversationSummary.WriteString(fmt.Sprintf("[%d] 时间=%s, 模型=%s, 提供者=%s, 输入Token=%d, 输出Token=%d, 延迟=%dms, 成功=%v, IP=%s\n",
			i+1, timestamp, l.Model, l.Provider, l.InputTokens, l.OutputTokens, l.LatencyMs, l.Success, l.ClientIP))
		if l.RequestContent != "" {
			preview := l.RequestContent
			if len(preview) > 500 {
				preview = preview[:500] + "..."
			}
			conversationSummary.WriteString(fmt.Sprintf("    请求内容: %s\n", preview))
		}
		if l.ErrorMessage != "" {
			conversationSummary.WriteString(fmt.Sprintf("    错误: %s\n", l.ErrorMessage))
		}
	}

	systemPrompt := "你是一个专业的AI网关安全分析师，专注于识别未知威胁和异常行为模式。\n\n" +
		"你的任务是分析API Key的调用历史，识别潜在的安全威胁，包括但不限于：\n" +
		"- 异常的调用频率或时间模式\n" +
		"- 不同于往常的模型使用行为\n" +
		"- 可疑的请求内容模式（可能的探测或攻击）\n" +
		"- IP地址异常分布\n" +
		"- Token消耗异常\n" +
		"- 可能的凭证滥用或泄露迹象\n\n" +
		"你必须只返回纯JSON，不要包含任何markdown格式。格式如下：\n\n" +
		"{\n" +
		"  \"risk_level\": \"低|中|高|极高\",\n" +
		"  \"summary\": \"一句话总结该API Key的整体安全状况\",\n" +
		"  \"details\": {\n" +
		"    \"call_frequency\": { \"level\": \"低|中|高|极高\", \"description\": \"调用频率分析描述\" },\n" +
		"    \"model_usage\": { \"level\": \"低|中|高|极高\", \"description\": \"模型使用分析描述\" },\n" +
		"    \"success_rate\": { \"level\": \"低|中|高|极高\", \"description\": \"成功率分析描述\" },\n" +
		"    \"request_content\": { \"level\": \"低|中|高|极高\", \"description\": \"请求内容安全分析描述\" },\n" +
		"    \"ip_distribution\": { \"level\": \"低|中|高|极高\", \"description\": \"IP分布分析描述\" },\n" +
		"    \"token_usage\": { \"level\": \"低|中|高|极高\", \"description\": \"Token消耗分析描述\" }\n" +
		"  },\n" +
		"  \"recommendations\": [\"建议1\", \"建议2\"]\n" +
		"}"

	messages := []map[string]interface{}{
		{"role": "system", "content": systemPrompt},
		{"role": "user", "content": conversationSummary.String()},
	}

	log.Printf("[SYS-ANALYSIS] id=%s fetched %d logs, calling internalChatCompletion model=%s...", taskID, len(logs), modelForGateway)
	statusCode, _, _, respBody, err := proxyServerForSystemAnalysis.internalChatCompletion(modelForGateway, messages, 0.3, 1500)
	if err != nil {
		log.Printf("[SYS-ANALYSIS] ERROR id=%s internalChatCompletion failed: %v", taskID, err)
		dbUpdateSystemAnalysisTaskResult(taskID, "error", "Analysis failed: "+err.Error(), "", "", 0)
		return
	}

	riskLevel := "unknown"
	summary := ""
	detail := ""
	dimensions := ""

	if statusCode >= 200 && statusCode < 300 {
		var resp map[string]interface{}
		if json.Unmarshal(respBody, &resp) == nil {
			contentStr := extractContentFromResp(resp)
			if contentStr != "" {
				detail = contentStr
				parsed := extractJSON(contentStr)
				if parsed != nil {
					if rl, ok := parsed["risk_level"].(string); ok {
						riskLevel = rl
					}
					if s, ok := parsed["summary"].(string); ok {
						summary = s
					}
					if det, ok := parsed["details"].(map[string]interface{}); ok {
						if dimBytes, err := json.Marshal(det); err == nil {
							dimensions = string(dimBytes)
						}
					}
				}
			}
		}
	}

	log.Printf("[SYS-ANALYSIS] DONE id=%s risk=%s summary=%.100s", taskID, riskLevel, summary)

	dbUpdateSystemAnalysisTaskResult(taskID, riskLevel, summary, detail, dimensions, total)
	durationMs := time.Since(taskStart).Milliseconds()
	dbInsertSystemAnalysisTaskHistory(taskID, riskLevel, summary, detail, dimensions, riskLevel, total, durationMs)

	systemAnalysisConfigMu.RLock()
	cfg := systemAnalysisConfig
	systemAnalysisConfigMu.RUnlock()

	if cfg.NotifyOnHighRisk && (riskLevel == "高" || riskLevel == "极高") {
		log.Printf("[SYS-ANALYSIS] HIGH RISK DETECTED task=%s risk=%s summary=%s", taskID, riskLevel, summary)
		dbInsertSecurityAlertFromSystem(taskID, riskLevel, summary, model, gatewayKey.Key, "system_analysis")
	}

	_ = cfg
}

func dbUpdateSystemAnalysisTaskResult(id, riskLevel, summary, detail, dimensions string, logsAnalyzed int) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Exec(`UPDATE system_analysis_tasks SET result_risk_level=?, result_summary=?, result_detail=?, result_dimensions=?, result_logs_analyzed=?, last_run_at=? WHERE id=?`,
		riskLevel, summary, detail, dimensions, logsAnalyzed, now, id)
	return err
}

func dbInsertSystemAnalysisTaskHistory(taskID, riskLevel, summary, detail, dimensions, status string, logsAnalyzed int, durationMs int64) {
	now := time.Now().UTC().Format(time.RFC3339)
	db.Exec(`INSERT INTO system_analysis_task_history (task_id, risk_level, summary, detail, dimensions, logs_analyzed, status, duration_ms, run_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		taskID, riskLevel, summary, detail, dimensions, logsAnalyzed, status, durationMs, now)
}

func dbInsertSecurityAlertFromSystem(taskID, riskLevel, summary, model, apiKey, triggerType string) {
	now := time.Now()
	direction := "input"
	mode := "block"
	severity := "high"
	if riskLevel == "极高" {
		severity = "critical"
	} else if riskLevel == "高" {
		severity = "high"
	} else if riskLevel == "中" {
		severity = "medium"
	} else {
		severity = "low"
	}
	contentPreview := fmt.Sprintf("[系统分析] 风险等级: %s, 摘要: %s", riskLevel, summary)
	_, err := db.Exec(`INSERT INTO security_alerts (timestamp, direction, mode, trigger_type, trigger_detail, severity, content_preview, model, api_key_used, action, resolved, client_ip)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'system')`,
		now.UTC().Format(time.RFC3339), direction, mode, triggerType, fmt.Sprintf("[系统/%s]", riskLevel), severity, contentPreview, model, maskAPIKeyForLog(apiKey), "记录告警")
	if err != nil {
		log.Printf("[ERROR] dbInsertSecurityAlertFromSystem: %v", err)
	}
}

func (p *ProxyServer) handleGetSystemAnalysisConfig(w http.ResponseWriter, r *http.Request) {
	systemAnalysisConfigMu.RLock()
	cfg := systemAnalysisConfig
	systemAnalysisConfigMu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg)
}

func (p *ProxyServer) handleUpdateSystemAnalysisConfig(w http.ResponseWriter, r *http.Request) {
	var input SystemAnalysisConfig
	if json.NewDecoder(r.Body).Decode(&input) != nil {
		http.Error(w, "invalid input", 400)
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Exec(`UPDATE system_analysis_config SET enabled=?, model=?, api_key_id=?, time_range=?, interval_minutes=?, notify_on_high_risk=?, auto_block_risk_level=?, updated_at=? WHERE id=1`,
		input.Enabled, input.Model, input.APIKeyID, input.TimeRange, input.IntervalMinutes, input.NotifyOnHighRisk, input.AutoBlockRiskLevel, now)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	loadSystemAnalysisConfig()
	ensureSystemAnalysisTask()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func ensureSystemAnalysisTask() {
	systemAnalysisConfigMu.RLock()
	cfg := systemAnalysisConfig
	systemAnalysisConfigMu.RUnlock()
	if !cfg.Enabled || cfg.Model == "" {
		return
	}
	var count int
	row := db.QueryRow("SELECT COUNT(*) FROM system_analysis_tasks WHERE created_by='__system__'")
	if row.Scan(&count) == nil && count == 0 {
		id := fmt.Sprintf("sys_%d", time.Now().UnixNano())
		taskNo := nextSystemTaskNo()
		nextRun := time.Now().Add(time.Duration(cfg.IntervalMinutes) * time.Minute).UTC().Format(time.RFC3339)
		db.Exec(`INSERT INTO system_analysis_tasks (id, task_no, name, api_key_id, model, time_range, schedule_type, interval_minutes, status, next_run_at, created_at, created_by)
			VALUES (?, ?, ?, ?, ?, ?, 'periodic', ?, 'running', ?, ?, '__system__')`,
			id, taskNo, "系统行为分析", cfg.APIKeyID, cfg.Model, cfg.TimeRange, cfg.IntervalMinutes, nextRun, time.Now().UTC().Format(time.RFC3339))
		log.Printf("[INFO] ensureSystemAnalysisTask: created system task id=%s", id)
	} else {
		db.Exec(`UPDATE system_analysis_tasks SET api_key_id=?, model=?, time_range=?, interval_minutes=?, status='running' WHERE created_by='__system__'`,
			cfg.APIKeyID, cfg.Model, cfg.TimeRange, cfg.IntervalMinutes)
	}
}

func (p *ProxyServer) handleListSystemAnalysisTasks(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, task_no, name, api_key_id, model, time_range, schedule_type, interval_minutes, status, last_run_at, next_run_at, created_at, result_risk_level, result_summary, result_detail, result_dimensions, result_logs_analyzed FROM system_analysis_tasks ORDER BY created_at DESC")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	var tasks []map[string]interface{}
	for rows.Next() {
		var id, taskNo, name, apiKeyID, model, timeRange, scheduleType, status string
		var intervalMinutes int
		var lastRunAt, nextRunAt, createdAt, resultRiskLevel, resultSummary, resultDetail, resultDimensions sql.NullString
		var resultLogsAnalyzed int
		if rows.Scan(&id, &taskNo, &name, &apiKeyID, &model, &timeRange, &scheduleType, &intervalMinutes, &status, &lastRunAt, &nextRunAt, &createdAt, &resultRiskLevel, &resultSummary, &resultDetail, &resultDimensions, &resultLogsAnalyzed) != nil {
			continue
		}
		task := map[string]interface{}{
			"id": id, "task_no": taskNo, "name": name,
			"api_key_id": apiKeyID, "model": model,
			"time_range": timeRange, "schedule_type": scheduleType,
			"interval_minutes": intervalMinutes, "status": status,
			"result_logs_analyzed": resultLogsAnalyzed,
		}
		if lastRunAt.Valid {
			task["last_run_at"] = lastRunAt.String
		}
		if nextRunAt.Valid {
			task["next_run_at"] = nextRunAt.String
		}
		if createdAt.Valid {
			task["created_at"] = createdAt.String
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
		tasks = append(tasks, task)
	}
	if tasks == nil {
		tasks = []map[string]interface{}{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"tasks": tasks})
}

func (p *ProxyServer) handleGetSystemAnalysisTaskHistory(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, risk_level, summary, detail, dimensions, logs_analyzed, status, duration_ms, run_at FROM system_analysis_task_history ORDER BY run_at DESC LIMIT 50")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	var history []map[string]interface{}
	for rows.Next() {
		var id int
		var riskLevel, summary, detail, dimensions, status, runAt string
		var logsAnalyzed int
		var durationMs int64
		if rows.Scan(&id, &riskLevel, &summary, &detail, &dimensions, &logsAnalyzed, &status, &durationMs, &runAt) != nil {
			continue
		}
		history = append(history, map[string]interface{}{
			"id": id, "risk_level": riskLevel, "summary": summary,
			"detail": detail, "dimensions": dimensions,
			"logs_analyzed": logsAnalyzed, "status": status,
			"duration_ms": durationMs, "run_at": runAt,
		})
	}
	if history == nil {
		history = []map[string]interface{}{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"history": history})
}

func (p *ProxyServer) handleTriggerSystemAnalysis(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, task_no, name, api_key_id, model, time_range, interval_minutes FROM system_analysis_tasks WHERE created_by='__system__' LIMIT 1")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	if rows.Next() {
		var id, taskNo, name, apiKeyID, model, timeRange string
		var intervalMinutes int
		if rows.Scan(&id, &taskNo, &name, &apiKeyID, &model, &timeRange, &intervalMinutes) == nil {
			task := map[string]interface{}{
				"id": id, "task_no": taskNo, "name": name,
				"api_key_id": apiKeyID, "model": model,
				"time_range": timeRange, "interval_minutes": intervalMinutes,
			}
			safeGo(func() { executeSystemAnalysisTask(id, task) })
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func (p *ProxyServer) setupSystemAnalysisRoutes(api *mux.Router) {
	api.HandleFunc("/system-analysis/config", p.handleGetSystemAnalysisConfig).Methods("GET")
	api.HandleFunc("/system-analysis/config", p.handleUpdateSystemAnalysisConfig).Methods("PUT")
	api.HandleFunc("/system-analysis/tasks", p.handleListSystemAnalysisTasks).Methods("GET")
	api.HandleFunc("/system-analysis/tasks/trigger", p.handleTriggerSystemAnalysis).Methods("POST")
	api.HandleFunc("/system-analysis/history", p.handleGetSystemAnalysisTaskHistory).Methods("GET")
}