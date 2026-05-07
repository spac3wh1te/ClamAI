package main

import (
	"database/sql"
	"fmt"
	"log"
	"time"
)

func truncateStr(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen])
}

const maxLogRows = 50000

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
		COALESCE(NULLIF(provider, ''), upstream_provider) as provider, model, DATE(timestamp, 'localtime') as date
		FROM request_logs
		GROUP BY COALESCE(NULLIF(provider, ''), upstream_provider), model, DATE(timestamp, 'localtime')`)
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

func dbInsertLog(entry *RequestLog) {
	isProxy := 0
	if entry.IsProxyCall {
		isProxy = 1
	}
	_, err := db.Exec(`INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, latency_ms, success, error_message, client_ip, api_key_used, status_code, path, method, request_content, response_content, user_id, api_key_id, is_proxy_call, upstream_request_headers, upstream_response_headers, upstream_provider, upstream_model)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entry.Timestamp.UTC().Format(time.RFC3339), entry.Provider, entry.Model,
		entry.InputTokens, entry.OutputTokens, entry.LatencyMs,
		boolToInt(entry.Success), entry.ErrorMessage, entry.ClientIP,
		entry.APIKeyUsed, entry.StatusCode, entry.Path, entry.Method,
		entry.RequestContent, entry.ResponseContent, entry.UserID, entry.APIKeyID,
		isProxy, entry.UpstreamReqHeaders, entry.UpstreamRespHeaders,
		entry.UpstreamProvider, entry.UpstreamModel)
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
	cols := "id, timestamp, provider, model, input_tokens, output_tokens, latency_ms, success, error_message, client_ip, api_key_used, status_code, path, method, COALESCE(request_content,''), COALESCE(response_content,''), COALESCE(user_id,''), COALESCE(api_key_id,''), COALESCE(is_proxy_call,0), COALESCE(upstream_request_headers,''), COALESCE(upstream_response_headers,''), COALESCE(upstream_request_body,''), COALESCE(upstream_response_body,''), COALESCE(upstream_provider,''), COALESCE(upstream_model,'')"
	if userID != "" {
		db.QueryRow("SELECT COUNT(*) FROM request_logs WHERE user_id = ?", userID).Scan(&total)
		rows, err = db.Query("SELECT "+cols+" FROM request_logs WHERE user_id = ? ORDER BY id DESC LIMIT ?", userID, limit)
	} else {
		db.QueryRow("SELECT COUNT(*) FROM request_logs").Scan(&total)
		rows, err = db.Query("SELECT "+cols+" FROM request_logs ORDER BY id DESC LIMIT ?", limit)
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
		var isProxyCall int
		if err := rows.Scan(&entry.ID, &ts, &entry.Provider, &entry.Model, &entry.InputTokens, &entry.OutputTokens,
			&entry.LatencyMs, &success, &entry.ErrorMessage, &entry.ClientIP,
			&entry.APIKeyUsed, &entry.StatusCode, &entry.Path, &entry.Method,
			&entry.RequestContent, &entry.ResponseContent, &entry.UserID, &entry.APIKeyID,
			&isProxyCall, &entry.UpstreamReqHeaders, &entry.UpstreamRespHeaders,
			&entry.UpstreamReqBody, &entry.UpstreamRespBody,
			&entry.UpstreamProvider, &entry.UpstreamModel); err != nil {
			continue
		}
		entry.Timestamp, _ = time.Parse(time.RFC3339, ts)
		entry.Success = success == 1
		entry.IsProxyCall = isProxyCall == 1
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

	providerExpr := "COALESCE(NULLIF(provider, ''), upstream_provider)"
	query := fmt.Sprintf(`SELECT
		COUNT(*) as total,
		SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success,
		SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors,
		COALESCE(SUM(input_tokens), 0) as input_tokens,
		COALESCE(SUM(output_tokens), 0) as output_tokens,
		COALESCE(SUM(latency_ms), 0) as total_latency,
		%s as provider,
		model,
		%s as bucket
		FROM request_logs
		WHERE timestamp >= ?
		GROUP BY %s, model, %s`, providerExpr, groupBy, providerExpr, groupBy)

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
			stats.ByProvider[provider] = map[string]interface{}{"requests": int64(0), "tokens": int64(0), "success": int64(0)}
		}
		if v, ok := stats.ByProvider[provider]["requests"].(int64); ok {
			stats.ByProvider[provider]["requests"] = v + total
		} else {
			stats.ByProvider[provider]["requests"] = total
		}
		if v, ok := stats.ByProvider[provider]["success"].(int64); ok {
			stats.ByProvider[provider]["success"] = v + success
		} else {
			stats.ByProvider[provider]["success"] = success
		}
		if v, ok := stats.ByProvider[provider]["tokens"].(int64); ok {
			stats.ByProvider[provider]["tokens"] = v + inputTok + outputTok
		} else {
			stats.ByProvider[provider]["tokens"] = inputTok + outputTok
		}

		if _, ok := stats.ByModel[model]; !ok {
			stats.ByModel[model] = map[string]interface{}{"requests": int64(0), "tokens": int64(0)}
		}
		if v, ok := stats.ByModel[model]["requests"].(int64); ok {
			stats.ByModel[model]["requests"] = v + total
		} else {
			stats.ByModel[model]["requests"] = total
		}
		if v, ok := stats.ByModel[model]["tokens"].(int64); ok {
			stats.ByModel[model]["tokens"] = v + inputTok + outputTok
		} else {
			stats.ByModel[model]["tokens"] = inputTok + outputTok
		}

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
			WHEN request_content LIKE '%"analysis_type":"agent_deep_check%' THEN 'agent_deep_check'
			WHEN request_content LIKE '%"analysis_type":"user_profile_task%' THEN 'user_profile_task'
			WHEN request_content LIKE '%"analysis_type":"user_profile%' THEN 'user_profile'
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
