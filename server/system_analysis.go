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
	systemAnalysisConfig       SystemAnalysisConfig
	systemAnalysisConfigMu     sync.RWMutex
	systemAnalysisTaskCounter  int64
	systemAnalysisRunning      int32
)

type SystemAnalysisConfig struct {
	Enabled            bool   `json:"enabled"`
	Model              string `json:"model"`
	APIKeyID           string `json:"api_key_id"`
	TimeRange          string `json:"time_range"`
	IntervalMinutes    int    `json:"interval_minutes"`
	NotifyOnHighRisk   bool   `json:"notify_on_high_risk"`
	AutoBlockRiskLevel string `json:"auto_block_risk_level"`
	SystemPrompt       string `json:"system_prompt"`
}

const defaultSystemPrompt = `你是一个专业的AI网关安全分析师，专注于识别未知威胁和异常行为模式。

你的任务是分析API Key的调用历史，识别潜在的安全威胁，包括但不限于：
- 异常的调用频率或时间模式
- 不同于往常的模型使用行为
- 可疑的请求内容模式（可能的探测或攻击）
- IP地址异常分布
- Token消耗异常
- 可能的凭证滥用或泄露迹象

你必须只返回纯JSON，不要包含任何markdown格式。格式如下：

{
  "risk_level": "低|中|高|极高",
  "summary": "一句话总结该API Key的整体安全状况",
  "details": {
    "call_frequency": { "level": "低|中|高|极高", "description": "调用频率分析描述" },
    "model_usage": { "level": "低|中|高|极高", "description": "模型使用分析描述" },
    "success_rate": { "level": "低|中|高|极高", "description": "成功率分析描述" },
    "request_content": { "level": "低|中|高|极高", "description": "请求内容安全分析描述" },
    "ip_distribution": { "level": "低|中|高|极高", "description": "IP分布分析描述" },
    "token_usage": { "level": "低|中|高|极高", "description": "Token消耗分析描述" }
  },
  "recommendations": ["建议1", "建议2"]
}`

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
	var cnt int64
	gormDB.Table("system_analysis_config").Count(&cnt)
	if cnt == 0 {
		gormDB.Create(&DBSystemAnalysisConfig{
			ID:              1,
			Enabled:         true,
			Model:           "",
			TimeRange:       "7d",
			IntervalMinutes: 60,
			NotifyOnHigh:    true,
		})
		log.Printf("[INFO] initSystemAnalysis: created default config row")
	}
	loadSystemAnalysisConfig()
	initSystemAnalysisTaskCounter()
	go startSystemAnalysisScheduler()
}

func loadSystemAnalysisConfig() {
	var record DBSystemAnalysisConfig
	err := gormDB.Where("id = 1").First(&record).Error
	var cfg SystemAnalysisConfig
	if err != nil {
		cfg.Enabled = true
		cfg.TimeRange = "7d"
		cfg.IntervalMinutes = 60
		cfg.NotifyOnHighRisk = true
		cfg.SystemPrompt = defaultSystemPrompt
	} else {
		cfg.Enabled = record.Enabled
		cfg.Model = record.Model
		cfg.APIKeyID = record.APIKeyID
		cfg.TimeRange = record.TimeRange
		cfg.IntervalMinutes = record.IntervalMinutes
		cfg.NotifyOnHighRisk = record.NotifyOnHigh
		cfg.AutoBlockRiskLevel = record.AutoBlockRisk
		cfg.SystemPrompt = record.SystemPrompt
	}
	if cfg.SystemPrompt == "" {
		cfg.SystemPrompt = defaultSystemPrompt
	}
	systemAnalysisConfigMu.Lock()
	systemAnalysisConfig = cfg
	systemAnalysisConfigMu.Unlock()
	log.Printf("[INFO] loadSystemAnalysisConfig: enabled=%v model=%s interval=%dmin promptLen=%d",
		cfg.Enabled, cfg.Model, cfg.IntervalMinutes, len(cfg.SystemPrompt))
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
	nextRun := formatTimeUTC(time.Now().Add(time.Duration(intervalMinutes) * time.Minute))
	_, err := db.Exec("UPDATE system_analysis_tasks SET next_run_at=? WHERE id=?", nextRun, id)
	return err
}

func executeSystemAnalysisTask(taskID string, task map[string]interface{}) {
	taskStart := time.Now()
	model, _ := task["model"].(string)
	timeRange, _ := task["time_range"].(string)
	if timeRange == "" {
		timeRange = "7d"
	}

	log.Printf("[SYS-ANALYSIS] executeSystemAnalysisTask START id=%s model=%s timeRange=%s", taskID, model, timeRange)

	if model == "" {
		log.Printf("[SYS-ANALYSIS] ERROR id=%s model is empty, aborting", taskID)
		dbUpdateSystemAnalysisTaskResult(taskID, "error", "未配置分析模型", "", "", 0)
		return
	}

	modelForGateway := model
	if !strings.Contains(modelForGateway, ":") {
		provider, _ := proxyServerForSystemAnalysis.resolveProvider(modelForGateway)
		if provider != nil {
			modelForGateway = provider.GetName() + ":" + modelForGateway
			log.Printf("[SYS-ANALYSIS] id=%s resolved model to %s", taskID, modelForGateway)
		} else {
			log.Printf("[SYS-ANALYSIS] WARN id=%s could not resolve provider for model=%s, using as-is", taskID, model)
		}
	}

	apiKeysMu.Lock()
	type keyEntry struct {
		ID  string
		Key string
	}
	var allKeys []keyEntry
	for kid, k := range apiKeysByID {
		allKeys = append(allKeys, keyEntry{ID: kid, Key: k.Key})
	}
	apiKeysMu.Unlock()

	if len(allKeys) == 0 {
		log.Printf("[SYS-ANALYSIS] ERROR id=%s no API keys found", taskID)
		dbUpdateSystemAnalysisTaskResult(taskID, "error", "No API keys found", "", "", 0)
		return
	}

	log.Printf("[SYS-ANALYSIS] executeSystemAnalysisTask START id=%s model=%s keys=%d", taskID, modelForGateway, len(allKeys))

	systemAnalysisConfigMu.RLock()
	cfg := systemAnalysisConfig
	systemAnalysisConfigMu.RUnlock()

	systemPrompt := cfg.SystemPrompt
	if systemPrompt == "" {
		systemPrompt = defaultSystemPrompt
	}

	type keyResult struct {
		APIKeyID      string
		APIKeyName    string
		RiskLevel     string
		Summary       string
		Detail        string
		Dimensions    string
		LogsCount     int
		NewLogs       int
		Skipped       bool
		LastLogID     int64
		ThreatScore   int
		ThreatSignals string
		Analyzed      bool
	}

	var keyResults []keyResult
	var maxRisk string
	totalLogs := 0
	riskOrder := map[string]int{"低": 1, "中": 2, "高": 3, "极高": 4}
	skippedCount := 0

	for _, k := range allKeys {
		lastLogID := getLastAnalyzedLogID(k.ID)
		logs, _ := dbGetLogsByAPIKeyAfterID(maskAPIKeyForLog(k.Key), lastLogID, 500)

		apiKeysMu.Lock()
		keyName := ""
		if info, ok := apiKeysByID[k.ID]; ok {
			keyName = info.Name
		}
		apiKeysMu.Unlock()

		if len(logs) == 0 {
			if lastLogID > 0 {
				skippedCount++
				keyResults = append(keyResults, keyResult{
					APIKeyID:   k.ID,
					APIKeyName: keyName,
					RiskLevel:  "低",
					Summary:    "无新增日志，跳过分析",
					LogsCount:  0,
					NewLogs:    0,
					Skipped:    true,
					LastLogID:  lastLogID,
				})
			}
			continue
		}

		var maxID int64
		for _, l := range logs {
			if l.ID > maxID {
				maxID = l.ID
			}
		}

		threatScore, threatSignals := scoreThreat(logs, k.ID)
		signalsJSON, _ := json.Marshal(threatSignals)
		analyzeThreshold := 30
		shouldAnalyze := threatScore >= analyzeThreshold || len(logs) == 0

		if len(logs) == 0 {
			if lastLogID > 0 {
				skippedCount++
				keyResults = append(keyResults, keyResult{
					APIKeyID:      k.ID,
					APIKeyName:    keyName,
					RiskLevel:     "低",
					Summary:       "无新增日志，跳过分析",
					LogsCount:     0,
					NewLogs:       0,
					Skipped:       true,
					LastLogID:     lastLogID,
					ThreatScore:   threatScore,
					ThreatSignals: string(signalsJSON),
					Analyzed:      false,
				})
			}
			continue
		}

		var buf strings.Builder
		buf.WriteString(fmt.Sprintf("以下是通过该API Key(%s)的新增调用记录（共%d条，自上次分析后新增），请分析调用者行为模式，识别潜在安全威胁：\n\n", k.ID, len(logs)))
		for i, l := range logs {
			timestamp := l.Timestamp.Local().Format("2006-01-02 15:04:05")
			buf.WriteString(fmt.Sprintf("[%d] 时间=%s, 模型=%s, 提供者=%s, 输入Token=%d, 输出Token=%d, 延迟=%dms, 成功=%v, IP=%s\n",
				i+1, timestamp, l.Model, l.Provider, l.InputTokens, l.OutputTokens, l.LatencyMs, l.Success, l.ClientIP))
			if l.RequestContent != "" {
				preview := l.RequestContent
				if len(preview) > 500 {
					preview = preview[:500] + "..."
				}
				buf.WriteString(fmt.Sprintf("    请求内容: %s\n", preview))
			}
			if l.ErrorMessage != "" {
				buf.WriteString(fmt.Sprintf("    错误: %s\n", l.ErrorMessage))
			}
		}

		if !shouldAnalyze {
			maxRiskThis := "低"
			if threatScore >= 20 {
				maxRiskThis = "中"
			}
			if threatScore >= 35 {
				maxRiskThis = "高"
			}
			skippedCount++
			summaryText := fmt.Sprintf("威胁评分 %d（低于阈值%d），自动跳过AI深度分析", threatScore, analyzeThreshold)
			if len(threatSignals) > 0 {
				summaryText += fmt.Sprintf("。命中规则: %d项", len(threatSignals))
			}
			keyResults = append(keyResults, keyResult{
				APIKeyID:      k.ID,
				APIKeyName:    keyName,
				RiskLevel:     maxRiskThis,
				Summary:       summaryText,
				LogsCount:     len(logs),
				NewLogs:       len(logs),
				Skipped:       false,
				LastLogID:     maxID,
				ThreatScore:   threatScore,
				ThreatSignals: string(signalsJSON),
				Analyzed:      false,
			})
			totalLogs += len(logs)
			if riskOrder[maxRiskThis] > riskOrder[maxRisk] {
				maxRisk = maxRiskThis
			}
			continue
		}

		messages := []map[string]interface{}{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": buf.String()},
		}

		log.Printf("[SYS-ANALYSIS] id=%s calling internalChatCompletion for key=%s model=%s logs=%d...", taskID, k.ID, modelForGateway, len(logs))
		statusCode, _, _, respBody, err := proxyServerForSystemAnalysis.internalChatCompletion(modelForGateway, messages, 0.3, 1500)
		if err != nil || statusCode < 200 || statusCode >= 300 {
			log.Printf("[SYS-ANALYSIS] WARN id=%s key=%s analysis failed: err=%v status=%d bodyLen=%d", taskID, k.ID, err, statusCode, len(respBody))
			continue
		}

		var resp map[string]interface{}
		if json.Unmarshal(respBody, &resp) != nil {
			continue
		}
		contentStr := extractContentFromResp(resp)
		if contentStr == "" {
			continue
		}
		parsed := extractJSON(contentStr)
		if parsed == nil {
			continue
		}

		rl, _ := parsed["risk_level"].(string)
		s, _ := parsed["summary"].(string)
		dimsJSON := ""
		if det, ok := parsed["details"].(map[string]interface{}); ok {
			if dimBytes, err := json.Marshal(det); err == nil {
				dimsJSON = string(dimBytes)
			}
		}
		if rl == "" {
			rl = "低"
		}

		apiKeysMu.Lock()
		keyName = ""
		if info, ok := apiKeysByID[k.ID]; ok {
			keyName = info.Name
		}
		apiKeysMu.Unlock()

		keyResults = append(keyResults, keyResult{
			APIKeyID:      k.ID,
			APIKeyName:    keyName,
			RiskLevel:     rl,
			Summary:       s,
			Detail:        contentStr,
			Dimensions:    dimsJSON,
			LogsCount:     len(logs),
			NewLogs:       len(logs),
			Skipped:       false,
			LastLogID:     maxID,
			ThreatScore:   threatScore,
			ThreatSignals: string(signalsJSON),
			Analyzed:      true,
		})
		totalLogs += len(logs)
		if riskOrder[rl] > riskOrder[maxRisk] {
			maxRisk = rl
		}
	}

	if maxRisk == "" {
		maxRisk = "低"
	}

	var allSummaries []string
	analyzedCount := 0
	skippedCount = 0
	maxThreatScore := 0
	for _, kr := range keyResults {
		if kr.Analyzed {
			allSummaries = append(allSummaries, fmt.Sprintf("[%s] %s", kr.APIKeyName, kr.Summary))
			analyzedCount++
		} else {
			skippedCount++
		}
		if kr.ThreatScore > maxThreatScore {
			maxThreatScore = kr.ThreatScore
		}
	}
	summary := fmt.Sprintf("已深度分析 %d 个Key，自动评分 %d 个（共%d条日志），最高风险: %s", analyzedCount, skippedCount, totalLogs, maxRisk)
	if len(allSummaries) > 0 {
		summary += "。各Key摘要: " + strings.Join(allSummaries, "; ")
	}
	if len(summary) > 2000 {
		summary = summary[:2000]
	}

	detailJSON, _ := json.Marshal(keyResults)

	log.Printf("[SYS-ANALYSIS] DONE id=%s risk=%s keys=%d logs=%d", taskID, maxRisk, len(keyResults), totalLogs)

	dbUpdateSystemAnalysisTaskResult(taskID, maxRisk, summary, string(detailJSON), "", totalLogs)
	durationMs := time.Since(taskStart).Milliseconds()

	var topThreatSignals []ThreatSignal
	for _, kr := range keyResults {
		if kr.ThreatScore > 0 {
			var signals []ThreatSignal
			if json.Unmarshal([]byte(kr.ThreatSignals), &signals) == nil {
				topThreatSignals = append(topThreatSignals, signals...)
			}
		}
	}
	historySignalsJSON, _ := json.Marshal(topThreatSignals[:min(len(topThreatSignals), 10)])

	historyID := dbInsertSystemAnalysisTaskHistory(taskID, maxRisk, summary, string(detailJSON), "", maxRisk, totalLogs, durationMs, maxThreatScore, string(historySignalsJSON), analyzedCount, skippedCount)

	runAt := formatTimeNow()
	for _, kr := range keyResults {
		gormDB.Create(&DBSystemAnalysisKeyResult{
			TaskID:        taskID,
			HistoryID:     historyID,
			APIKeyID:      kr.APIKeyID,
			APIKeyName:    kr.APIKeyName,
			RiskLevel:     kr.RiskLevel,
			Summary:       kr.Summary,
			Detail:        kr.Detail,
			Dimensions:    kr.Dimensions,
			LogsCount:     kr.LogsCount,
			NewLogs:       kr.NewLogs,
			RunAt:         runAt,
			Skipped:       kr.Skipped,
			LastLogID:     kr.LastLogID,
			ThreatScore:   kr.ThreatScore,
			ThreatSignals: kr.ThreatSignals,
			Analyzed:      kr.Analyzed,
		})
	}

	systemAnalysisConfigMu.RLock()
	notifyCfg := systemAnalysisConfig
	systemAnalysisConfigMu.RUnlock()

	if notifyCfg.NotifyOnHighRisk && (maxRisk == "高" || maxRisk == "极高") {
		log.Printf("[SYS-ANALYSIS] HIGH RISK DETECTED task=%s risk=%s", taskID, maxRisk)
	}

	_ = notifyCfg
}

func dbUpdateSystemAnalysisTaskResult(id, riskLevel, summary, detail, dimensions string, logsAnalyzed int) error {
	now := formatTimeNow()
	_, err := db.Exec(`UPDATE system_analysis_tasks SET result_risk_level=?, result_summary=?, result_detail=?, result_dimensions=?, result_logs_analyzed=?, last_run_at=? WHERE id=?`,
		riskLevel, summary, detail, dimensions, logsAnalyzed, now, id)
	return err
}

func dbInsertSystemAnalysisTaskHistory(taskID, riskLevel, summary, detail, dimensions, status string, logsAnalyzed int, durationMs int64, threatScore int, threatSignals string, analyzedCount, skippedCount int) int64 {
	record := DBSystemAnalysisTaskHistory{
		TaskID:        taskID,
		RiskLevel:     riskLevel,
		Summary:       summary,
		Detail:        detail,
		Dimensions:    dimensions,
		LogsAnalyzed:  logsAnalyzed,
		Status:        status,
		DurationMs:    durationMs,
		ThreatScore:   threatScore,
		ThreatSignals: threatSignals,
		AnalyzedCount: analyzedCount,
		SkippedCount: skippedCount,
		RunAt:         time.Now().UTC(),
	}
	gormDB.Create(&record)
	return record.ID
}

func getLastAnalyzedLogID(apiKeyID string) int64 {
	var result DBSystemAnalysisKeyResult
	if err := gormDB.Where("api_key_id = ? AND skipped = false", apiKeyID).Order("id DESC").First(&result).Error; err != nil {
		return 0
	}
	return result.LastLogID
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
		formatTimeUTC(now), direction, mode, triggerType, fmt.Sprintf("[系统/%s]", riskLevel), severity, contentPreview, model, maskAPIKeyForLog(apiKey), "记录告警")
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
	input.APIKeyID = ""
	log.Printf("[SYS-ANALYSIS] updateConfig: enabled=%v model=%s timeRange=%s interval=%d notify=%v",
		input.Enabled, input.Model, input.TimeRange, input.IntervalMinutes, input.NotifyOnHighRisk)
	now := time.Now().UTC()
	var count int64
	gormDB.Table("system_analysis_config").Count(&count)
	log.Printf("[SYS-ANALYSIS] updateConfig: table has %d rows before update", count)

	record := DBSystemAnalysisConfig{
		ID:              1,
		Enabled:         input.Enabled,
		Model:           input.Model,
		APIKeyID:        input.APIKeyID,
		TimeRange:       input.TimeRange,
		IntervalMinutes: input.IntervalMinutes,
		NotifyOnHigh:    input.NotifyOnHighRisk,
		AutoBlockRisk:   input.AutoBlockRiskLevel,
		SystemPrompt:    input.SystemPrompt,
		UpdatedAt:       now,
	}
	result := gormDB.Save(&record)
	log.Printf("[SYS-ANALYSIS] updateConfig Save: rowsAffected=%d error=%v", result.RowsAffected, result.Error)

	var verify DBSystemAnalysisConfig
	gormDB.Where("id = 1").First(&verify)
	log.Printf("[SYS-ANALYSIS] updateConfig verify: model=%s enabled=%v", verify.Model, verify.Enabled)
	if result.Error != nil {
		log.Printf("[SYS-ANALYSIS] updateConfig DB ERROR: %v", result.Error)
		http.Error(w, result.Error.Error(), 500)
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
		nextRun := formatTimeUTC(time.Now().Add(time.Duration(cfg.IntervalMinutes) * time.Minute))
		db.Exec(`INSERT INTO system_analysis_tasks (id, task_no, name, api_key_id, model, time_range, schedule_type, interval_minutes, status, next_run_at, created_at, created_by)
			VALUES (?, ?, ?, ?, ?, ?, 'periodic', ?, 'running', ?, ?, '__system__')`,
			id, taskNo, "系统行为分析", cfg.APIKeyID, cfg.Model, cfg.TimeRange, cfg.IntervalMinutes, nextRun, formatTimeNow())
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
	rows, err := db.Query("SELECT id, risk_level, summary, detail, dimensions, logs_analyzed, status, duration_ms, run_at FROM system_analysis_task_history ORDER BY id DESC LIMIT 50")
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
	if !atomic.CompareAndSwapInt32(&systemAnalysisRunning, 0, 1) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "分析任务正在执行中，请稍候"})
		return
	}

	finish := func() { atomic.StoreInt32(&systemAnalysisRunning, 0) }

	rows, err := db.Query("SELECT id, task_no, name, api_key_id, model, time_range, interval_minutes FROM system_analysis_tasks WHERE created_by='__system__' LIMIT 1")
	if err != nil {
		log.Printf("[SYS-ANALYSIS] trigger ERROR query tasks: %v", err)
		finish()
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	if rows.Next() {
		var id, taskNo, name, apiKeyID, model, timeRange string
		var intervalMinutes int
		if rows.Scan(&id, &taskNo, &name, &apiKeyID, &model, &timeRange, &intervalMinutes) == nil {
			if model == "" {
				log.Printf("[SYS-ANALYSIS] trigger SKIP: model is empty for task %s", id)
				finish()
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未配置分析模型，请先保存配置"})
				return
			}
			task := map[string]interface{}{
				"id": id, "task_no": taskNo, "name": name,
				"api_key_id": apiKeyID, "model": model,
				"time_range": timeRange, "interval_minutes": intervalMinutes,
			}
			log.Printf("[SYS-ANALYSIS] trigger: starting task id=%s model=%s", id, model)
			safeGo(func() { defer finish(); executeSystemAnalysisTask(id, task) })
		}
	} else {
		log.Printf("[SYS-ANALYSIS] trigger: no __system__ task found, ensuring one exists")
		ensureSystemAnalysisTask()
		rows2, err2 := db.Query("SELECT id, task_no, name, api_key_id, model, time_range, interval_minutes FROM system_analysis_tasks WHERE created_by='__system__' LIMIT 1")
		if err2 == nil {
			if rows2.Next() {
				var id, taskNo, name, apiKeyID, model, timeRange string
				var intervalMinutes int
				if rows2.Scan(&id, &taskNo, &name, &apiKeyID, &model, &timeRange, &intervalMinutes) == nil {
					if model == "" {
						rows2.Close()
						w.Header().Set("Content-Type", "application/json")
						json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未配置分析模型，请先保存配置"})
						return
					}
					task := map[string]interface{}{
						"id": id, "task_no": taskNo, "name": name,
						"api_key_id": apiKeyID, "model": model,
						"time_range": timeRange, "interval_minutes": intervalMinutes,
					}
					log.Printf("[SYS-ANALYSIS] trigger: starting created task id=%s model=%s", id, model)
					safeGo(func() { defer finish(); executeSystemAnalysisTask(id, task) })
				}
			}
			rows2.Close()
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func (p *ProxyServer) handleGetDefaultPrompt(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"prompt": defaultSystemPrompt})
}

func (p *ProxyServer) handleGetKeyResults(w http.ResponseWriter, r *http.Request) {
	riskFilter := r.URL.Query().Get("risk")
	historyFilter := r.URL.Query().Get("history_id")
	var results []DBSystemAnalysisKeyResult
	q := gormDB.Order("id DESC")
	if riskFilter != "" {
		q = q.Where("risk_level = ?", riskFilter)
	}
	if historyFilter != "" {
		q = q.Where("history_id = ?", historyFilter)
	}
	if err := q.Find(&results).Error; err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

		grouped := map[string][]map[string]interface{}{}
	for _, r := range results {
		rl := r.RiskLevel
		if rl == "" {
			rl = "低"
		}
		entry := map[string]interface{}{
			"id":             r.ID,
			"task_id":        r.TaskID,
			"history_id":     r.HistoryID,
			"api_key_id":     r.APIKeyID,
			"api_key_name":   r.APIKeyName,
			"risk_level":     rl,
			"summary":        r.Summary,
			"detail":         r.Detail,
			"dimensions":     r.Dimensions,
			"logs_count":     r.LogsCount,
			"new_logs":       r.NewLogs,
			"run_at":         r.RunAt,
			"skipped":        r.Skipped,
			"threat_score":   r.ThreatScore,
			"threat_signals": r.ThreatSignals,
			"analyzed":       r.Analyzed,
		}
		grouped[rl] = append(grouped[rl], entry)
	}

	order := []string{"极高", "高", "中", "低"}
	ordered := make(map[string][]map[string]interface{})
	for _, k := range order {
		if v, ok := grouped[k]; ok {
			ordered[k] = v
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"results": ordered, "total": len(results)})
}

func (p *ProxyServer) handleAnalysisStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"running": atomic.LoadInt32(&systemAnalysisRunning) == 1,
	})
}

func (p *ProxyServer) setupSystemAnalysisRoutes(api *mux.Router) {
	api.HandleFunc("/system-analysis/config", p.handleGetSystemAnalysisConfig).Methods("GET")
	api.HandleFunc("/system-analysis/config", p.handleUpdateSystemAnalysisConfig).Methods("PUT")
	api.HandleFunc("/system-analysis/config/default-prompt", p.handleGetDefaultPrompt).Methods("GET")
	api.HandleFunc("/system-analysis/tasks", p.handleListSystemAnalysisTasks).Methods("GET")
	api.HandleFunc("/system-analysis/tasks/trigger", p.handleTriggerSystemAnalysis).Methods("POST")
	api.HandleFunc("/system-analysis/history", p.handleGetSystemAnalysisTaskHistory).Methods("GET")
	api.HandleFunc("/system-analysis/key-results", p.handleGetKeyResults).Methods("GET")
	api.HandleFunc("/system-analysis/status", p.handleAnalysisStatus).Methods("GET")
}