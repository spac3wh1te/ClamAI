package main

import (
	"database/sql"
	"time"
)

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

func dbGetSkillsTaskByID(taskID string) (map[string]interface{}, error) {
	row := db.QueryRow(`SELECT id, task_no, name, model, source_type, source_info, schedule_type, status, progress, last_run_at, created_at, result_risk_level, result_summary, result_detail, result_dimensions, created_by FROM skills_tasks WHERE id = ?`, taskID)
	var id, taskNo, name, model, sourceType, sourceInfo, scheduleType, status string
	var lastRunAt, createdAt, createdBy sql.NullString
	var resultRiskLevel, resultSummary, resultDetail, resultDimensions, progress sql.NullString
	if err := row.Scan(&id, &taskNo, &name, &model, &sourceType, &sourceInfo, &scheduleType, &status, &progress, &lastRunAt, &createdAt, &resultRiskLevel, &resultSummary, &resultDetail, &resultDimensions, &createdBy); err != nil {
		return nil, err
	}
	task := map[string]interface{}{
		"id": id, "task_no": taskNo, "name": name, "model": model,
		"source_type": sourceType, "source_info": sourceInfo,
		"schedule_type": scheduleType, "status": status,
		"created_at": createdAt.String, "created_by": createdBy.String,
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
	return task, nil
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

func dbUpdateAnalysisTask(id, name, apiKeyID, model, timeRange, scheduleType string, intervalMinutes int) error {
	_, err := db.Exec(`UPDATE analysis_tasks SET name=?, api_key_id=?, model=?, time_range=?, schedule_type=?, interval_minutes=? WHERE id=?`,
		name, apiKeyID, model, timeRange, scheduleType, intervalMinutes, id)
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
	progress := ""
	if status == "running" {
		progress = "正在检测..."
	}
	_, err := db.Exec(`UPDATE skills_tasks SET status=?, progress=? WHERE id=?`, status, progress, id)
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
