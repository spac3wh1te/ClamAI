package main

import (
	"database/sql"
	"encoding/json"
	"time"
)

type DBUser struct {
	ID           string     `gorm:"primaryKey;size:64"`
	Username     string     `gorm:"uniqueIndex;size:128;not null"`
	DisplayName  string     `gorm:"size:256"`
	PasswordHash string     `gorm:"column:password_hash;size:256"`
	Role         string     `gorm:"size:32;default:user"`
	Status       string     `gorm:"size:32;default:active"`
	CreatedAt    time.Time  `gorm:"autoCreateTime"`
	UpdatedAt    time.Time  `gorm:"autoUpdateTime"`
	LastLoginAt  *time.Time
}

func (DBUser) TableName() string { return "users" }

type DBProvider struct {
	ID             string    `gorm:"primaryKey;size:64"`
	Name           string    `gorm:"uniqueIndex;size:128"`
	ProviderType   string    `gorm:"column:provider_type;size:64"`
	AuthType       string    `gorm:"column:auth_type;size:32"`
	Enabled        bool      `gorm:"default:true"`
	BaseURL        string    `gorm:"column:base_url;size:512"`
	APIKey         string    `gorm:"column:api_key;size:1024"`
	Models         string    `gorm:"type:text"`
	DisabledModels string    `gorm:"column:disabled_models;type:text"`
	OAuthConfig    string    `gorm:"column:oauth_config;type:text"`
	RateLimits     string    `gorm:"column:rate_limits;type:text"`
	Priority       int       `gorm:"default:0"`
	CreatedBy      string    `gorm:"column:created_by;size:64;index"`
	CreatedAt      time.Time `gorm:"autoCreateTime"`
	UpdatedAt      time.Time `gorm:"autoUpdateTime"`
}

func (DBProvider) TableName() string { return "providers" }

type DBAPIKey struct {
	ID            string     `gorm:"primaryKey;size:64"`
	Key           string     `gorm:"uniqueIndex;size:256"`
	Name          string     `gorm:"size:256"`
	UserID        string     `gorm:"column:user_id;size:64;index"`
	AllowedModels string     `gorm:"column:allowed_models;type:text"`
	ProviderKeys  string     `gorm:"column:provider_keys;type:text"`
	CreatedAt     time.Time  `gorm:"autoCreateTime"`
	Active        bool       `gorm:"default:true"`
	RequestCount  int64
	LastUsed      *time.Time
	LastSynced    *time.Time
}

func (DBAPIKey) TableName() string { return "api_keys" }

func (k *DBAPIKey) GetAllowedModels() []string {
	if k.AllowedModels == "" || k.AllowedModels == "null" {
		return nil
	}
	var models []string
	json.Unmarshal([]byte(k.AllowedModels), &models)
	return models
}

func (k *DBAPIKey) SetAllowedModels(models []string) {
	b, _ := json.Marshal(models)
	k.AllowedModels = string(b)
}

func (k *DBAPIKey) GetProviderKeys() map[string]string {
	if k.ProviderKeys == "" || k.ProviderKeys == "null" {
		return map[string]string{}
	}
	m := map[string]string{}
	json.Unmarshal([]byte(k.ProviderKeys), &m)
	return m
}

func (k *DBAPIKey) SetProviderKeys(m map[string]string) {
	if m == nil {
		m = map[string]string{}
	}
	b, _ := json.Marshal(m)
	k.ProviderKeys = string(b)
}

type DBRequestLog struct {
	ID                  int64     `gorm:"primaryKey;autoIncrement"`
	Timestamp           time.Time `gorm:"index:idx_request_logs_timestamp,sort:desc"`
	Provider            string    `gorm:"size:64"`
	Model               string    `gorm:"size:256"`
	InputTokens         int
	OutputTokens        int
	LatencyMs           int64
	Success             bool
	ErrorMessage        string    `gorm:"size:1024"`
	ClientIP            string    `gorm:"column:client_ip;size:64"`
	APIKeyUsed          string    `gorm:"column:api_key_used;size:128"`
	StatusCode          int
	Path                string    `gorm:"size:512"`
	Method              string    `gorm:"size:16"`
	RequestContent      string    `gorm:"type:text"`
	ResponseContent     string    `gorm:"type:text"`
	UserID              string    `gorm:"column:user_id;size:64;index"`
	APIKeyID            string    `gorm:"column:api_key_id;size:64"`
	IsProxyCall         bool      `gorm:"column:is_proxy_call;default:false"`
	CallType            string    `gorm:"column:call_type;size:32;default:''"`
	UpstreamReqHeaders  string    `gorm:"column:upstream_request_headers;type:text"`
	UpstreamRespHeaders string    `gorm:"column:upstream_response_headers;type:text"`
	UpstreamReqBody     string    `gorm:"column:upstream_request_body;type:text"`
	UpstreamRespBody    string    `gorm:"column:upstream_response_body;type:text"`
	UpstreamProvider    string    `gorm:"column:upstream_provider;size:64"`
	UpstreamModel       string    `gorm:"column:upstream_model;size:256"`
}

func (DBRequestLog) TableName() string { return "request_logs" }

type DBSecurityAlert struct {
	ID             int64     `gorm:"primaryKey;autoIncrement"`
	Timestamp      time.Time `gorm:"index:idx_security_alerts_timestamp,sort:desc"`
	Direction      string    `gorm:"size:16"`
	Mode           string    `gorm:"size:16;default:block"`
	TriggerType    string    `gorm:"column:trigger_type;size:64"`
	TriggerDetail  string    `gorm:"column:trigger_detail;size:512"`
	ContentPreview string    `gorm:"type:text"`
	Model          string    `gorm:"size:256"`
	Provider       string    `gorm:"size:64"`
	APIKeyUsed     string    `gorm:"column:api_key_used;size:128"`
	ClientIP       string    `gorm:"column:client_ip;size:64"`
	Action         string    `gorm:"size:32"`
	Resolved       bool      `gorm:"default:false"`
	Severity       string    `gorm:"size:16"`
	UserID         string    `gorm:"column:user_id;size:64;index"`
}

func (DBSecurityAlert) TableName() string { return "security_alerts" }

type DBThreatRule struct {
	ID           int64     `gorm:"primaryKey;autoIncrement"`
	ThreatType   string    `gorm:"column:threat_type;size:64;index:idx_threat_rules_type"`
	Name         string    `gorm:"size:256"`
	PatternsJSON string    `gorm:"column:patterns_json;type:text"`
	Severity     string    `gorm:"size:16"`
	Enabled      bool      `gorm:"default:true"`
	CreatedAt    time.Time `gorm:"autoCreateTime"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime"`
}

func (DBThreatRule) TableName() string { return "threat_rules" }

type DBSecurityConfig struct {
	ID         int    `gorm:"primaryKey;check:id = 1"`
	ConfigJSON string `gorm:"column:config_json;type:text"`
	OutputMode string `gorm:"column:output_mode;size:32;default:block"`
	AutoBanKey bool   `gorm:"column:auto_ban_key;default:false"`
}

func (DBSecurityConfig) TableName() string { return "security_config" }

type DBRateLimitConfig struct {
	ID         int    `gorm:"primaryKey;check:id = 1"`
	ConfigJSON string `gorm:"column:config_json;type:text"`
}

func (DBRateLimitConfig) TableName() string { return "rate_limit_config" }

type DBSystemSetting struct {
	Key   string `gorm:"primaryKey;size:256"`
	Value string `gorm:"type:text"`
}

func (DBSystemSetting) TableName() string { return "system_settings" }

type DBUserSetting struct {
	UserID string `gorm:"primaryKey;size:64"`
	Key    string `gorm:"primaryKey;size:256"`
	Value  string `gorm:"type:text"`
}

func (DBUserSetting) TableName() string { return "user_settings" }

type DBAdminSecret struct {
	Key         string `gorm:"primaryKey;size:256"`
	SecretValue string `gorm:"column:secret_value;size:512"`
}

func (DBAdminSecret) TableName() string { return "admin_secrets" }

type DBRefreshToken struct {
	Token     string    `gorm:"primaryKey;size:256"`
	Username  string    `gorm:"size:128;index"`
	ExpiresAt time.Time `gorm:"column:expires_at"`
	CreatedAt time.Time `gorm:"autoCreateTime"`
}

func (DBRefreshToken) TableName() string { return "refresh_tokens" }

type DBModelMapping struct {
	Alias       string `gorm:"primaryKey;size:256"`
	ProviderID  string `gorm:"column:provider_id;size:64"`
	Model       string `gorm:"size:256"`
	Description string `gorm:"size:512"`
	CreatedBy   string `gorm:"column:created_by;size:64;index"`
}

func (DBModelMapping) TableName() string { return "model_mappings" }

type DBProfile struct {
	ID             string    `gorm:"primaryKey;size:64"`
	Name           string    `gorm:"size:256"`
	ProvidersJSON  string    `gorm:"column:providers_json;type:text"`
	MappingsJSON   string    `gorm:"column:mappings_json;type:text"`
	GatewayJSON    string    `gorm:"column:gateway_json;type:text"`
	AdvancedJSON   string    `gorm:"column:advanced_json;type:text"`
	ServiceJSON    string    `gorm:"column:service_json;type:text"`
	IsActive       bool      `gorm:"column:is_active;default:false"`
	CreatedBy      string    `gorm:"column:created_by;size:64;index"`
	CreatedAt      time.Time `gorm:"autoCreateTime"`
	UpdatedAt      time.Time `gorm:"autoUpdateTime"`
}

func (DBProfile) TableName() string { return "profiles" }

type DBSkillsDetectionHistory struct {
	ID         int64     `gorm:"primaryKey;autoIncrement"`
	CheckedAt  time.Time `gorm:"column:checked_at;index:idx_skills_detection_checked_at,sort:desc"`
	SourceType string    `gorm:"column:source_type;size:64"`
	SourceInfo string    `gorm:"column:source_info;type:text"`
	Result     string    `gorm:"type:text"`
	RiskLevel  string    `gorm:"column:risk_level;size:32"`
	ModelUsed  string    `gorm:"column:model_used;size:256"`
	APIKeyID   string    `gorm:"column:api_key_id;size:64"`
	CreatedBy  string    `gorm:"column:created_by;size:64;index"`
}

func (DBSkillsDetectionHistory) TableName() string { return "skills_detection_history" }

type DBProfileAnalysisHistory struct {
	ID           int64     `gorm:"primaryKey;autoIncrement"`
	AnalyzedAt   time.Time `gorm:"column:analyzed_at;index:idx_profile_analysis_analyzed_at,sort:desc"`
	APIKeyID     string    `gorm:"column:api_key_id;size:64"`
	TimeRange    string    `gorm:"column:time_range;size:64"`
	RiskLevel    string    `gorm:"column:risk_level;size:32"`
	Summary      string    `gorm:"type:text"`
	Result       string    `gorm:"type:text"`
	ModelUsed    string    `gorm:"column:model_used;size:256"`
	LogsAnalyzed int       `gorm:"column:logs_analyzed"`
	CreatedBy    string    `gorm:"column:created_by;size:64;index"`
}

func (DBProfileAnalysisHistory) TableName() string { return "profile_analysis_history" }

type DBAnalysisTask struct {
	ID              string     `gorm:"primaryKey;size:64"`
	TaskNo          string     `gorm:"column:task_no;size:64"`
	Name            string     `gorm:"size:256"`
	APIKeyID        string     `gorm:"column:api_key_id;size:64"`
	Model           string     `gorm:"size:256"`
	TimeRange       string     `gorm:"column:time_range;size:64"`
	ScheduleType    string     `gorm:"column:schedule_type;size:32"`
	IntervalMinutes int        `gorm:"column:interval_minutes"`
	Status          string     `gorm:"size:32;index:idx_analysis_tasks_status"`
	LastRunAt       *time.Time `gorm:"column:last_run_at"`
	NextRunAt       *time.Time `gorm:"column:next_run_at"`
	CreatedAt       time.Time  `gorm:"autoCreateTime"`
	ResultSummary   string     `gorm:"column:result_summary;type:text"`
	ResultRiskLevel string     `gorm:"column:result_risk_level;size:32"`
	ResultDetail    string     `gorm:"column:result_detail;type:text"`
	ResultDims      string     `gorm:"column:result_dimensions;type:text"`
	ResultLogsCount int        `gorm:"column:result_logs_analyzed"`
	Progress        string     `gorm:"type:text"`
	CreatedBy       string     `gorm:"column:created_by;size:64;index"`
}

func (DBAnalysisTask) TableName() string { return "analysis_tasks" }

type DBAnalysisTaskHistory struct {
	ID           int64     `gorm:"primaryKey;autoIncrement"`
	TaskID       string    `gorm:"column:task_id;size:64;index:idx_analysis_task_history_task"`
	RiskLevel    string    `gorm:"column:risk_level;size:32"`
	Summary      string    `gorm:"type:text"`
	Detail       string    `gorm:"type:text"`
	Dimensions   string    `gorm:"type:text"`
	LogsAnalyzed int       `gorm:"column:logs_analyzed"`
	Status       string    `gorm:"size:32"`
	DurationMs   int64     `gorm:"column:duration_ms"`
	RunAt        time.Time `gorm:"column:run_at"`
	CreatedBy    string    `gorm:"column:created_by;size:64;index"`
}

func (DBAnalysisTaskHistory) TableName() string { return "analysis_task_history" }

type DBSkillsTask struct {
	ID           string     `gorm:"primaryKey;size:64"`
	TaskNo       string     `gorm:"column:task_no;size:64"`
	Name         string     `gorm:"size:256"`
	Model        string     `gorm:"size:256"`
	SourceType   string     `gorm:"column:source_type;size:64"`
	SourceInfo   string     `gorm:"column:source_info;type:text"`
	ScheduleType string     `gorm:"column:schedule_type;size:32"`
	Status       string     `gorm:"size:32;index:idx_skills_tasks_status"`
	Progress     string     `gorm:"type:text"`
	LastRunAt    *time.Time `gorm:"column:last_run_at"`
	CreatedAt    time.Time  `gorm:"autoCreateTime"`
	RiskLevel    string     `gorm:"column:result_risk_level;size:32"`
	Summary      string     `gorm:"column:result_summary;type:text"`
	Detail       string     `gorm:"column:result_detail;type:text"`
	Dimensions   string     `gorm:"column:result_dimensions;type:text"`
	CreatedBy    string     `gorm:"column:created_by;size:64;index"`
}

func (DBSkillsTask) TableName() string { return "skills_tasks" }

type DBSkillsTaskHistory struct {
	ID         int64     `gorm:"primaryKey;autoIncrement"`
	TaskID     string    `gorm:"column:task_id;size:64;index:idx_skills_task_history_task"`
	RiskLevel  string    `gorm:"column:risk_level;size:32"`
	Summary    string    `gorm:"type:text"`
	Detail     string    `gorm:"type:text"`
	Dimensions string    `gorm:"type:text"`
	Status     string    `gorm:"size:32"`
	DurationMs int64     `gorm:"column:duration_ms"`
	RunAt      time.Time `gorm:"column:run_at"`
	CreatedBy  string    `gorm:"column:created_by;size:64;index"`
}

func (DBSkillsTaskHistory) TableName() string { return "skills_task_history" }

type DBSystemAnalysisConfig struct {
	ID              int       `gorm:"primaryKey;check:id = 1"`
	Enabled         bool
	Model           string `gorm:"size:256"`
	APIKeyID        string `gorm:"column:api_key_id;size:64"`
	TimeRange       string `gorm:"column:time_range;size:64"`
	IntervalMinutes int    `gorm:"column:interval_minutes"`
	NotifyOnHigh    bool   `gorm:"column:notify_on_high_risk"`
	AutoBlockRisk   string `gorm:"column:auto_block_risk_level;size:32"`
	SystemPrompt    string `gorm:"column:system_prompt;type:text"`
	CreatedAt       time.Time `gorm:"autoCreateTime"`
	UpdatedAt       time.Time `gorm:"autoUpdateTime"`
}

func (DBSystemAnalysisConfig) TableName() string { return "system_analysis_config" }

type DBSystemAnalysisTask struct {
	ID              string     `gorm:"primaryKey;size:64"`
	TaskNo          string     `gorm:"column:task_no;size:64"`
	Name            string     `gorm:"size:256"`
	APIKeyID        string     `gorm:"column:api_key_id;size:64"`
	Model           string     `gorm:"size:256"`
	TimeRange       string     `gorm:"column:time_range;size:64"`
	ScheduleType    string     `gorm:"column:schedule_type;size:32"`
	IntervalMinutes int        `gorm:"column:interval_minutes"`
	Status          string     `gorm:"size:32;index:idx_sat_status_next"`
	RiskLevel       string     `gorm:"column:result_risk_level;size:32"`
	Summary         string     `gorm:"column:result_summary;type:text"`
	Detail          string     `gorm:"column:result_detail;type:text"`
	Dimensions      string     `gorm:"column:result_dimensions;type:text"`
	LogsAnalyzed    int        `gorm:"column:result_logs_analyzed"`
	LastRunAt       *time.Time `gorm:"column:last_run_at"`
	NextRunAt       *time.Time `gorm:"column:next_run_at;index:idx_sat_status_next"`
	CreatedAt       time.Time  `gorm:"autoCreateTime"`
	CreatedBy       string     `gorm:"column:created_by;size:64;default:__system__"`
}

func (DBSystemAnalysisTask) TableName() string { return "system_analysis_tasks" }

type DBSystemAnalysisTaskHistory struct {
	ID             int64     `gorm:"primaryKey;autoIncrement"`
	TaskID         string    `gorm:"column:task_id;size:64;index:idx_sath_task"`
	RiskLevel      string    `gorm:"column:risk_level;size:32"`
	Summary        string    `gorm:"type:text"`
	Detail         string    `gorm:"type:text"`
	Dimensions     string    `gorm:"type:text"`
	LogsAnalyzed   int       `gorm:"column:logs_analyzed"`
	ThreatScore    int       `gorm:"column:threat_score;default:0"`
	ThreatSignals  string    `gorm:"column:threat_signals;type:text"`
	AnalyzedCount  int       `gorm:"column:analyzed_count;default:0"`
	SkippedCount   int       `gorm:"column:skipped_count;default:0"`
	Status         string    `gorm:"size:32"`
	DurationMs     int64     `gorm:"column:duration_ms"`
	RunAt          time.Time `gorm:"column:run_at"`
}

func (DBSystemAnalysisTaskHistory) TableName() string { return "system_analysis_task_history" }

type DBSystemAnalysisKeyResult struct {
	ID            int64  `gorm:"primaryKey;autoIncrement"`
	TaskID        string `gorm:"column:task_id;size:64;index:idx_sakr_task"`
	HistoryID     int64  `gorm:"column:history_id;index:idx_sakr_hist"`
	APIKeyID      string `gorm:"column:api_key_id;size:64"`
	APIKeyName    string `gorm:"column:api_key_name;size:256"`
	RiskLevel     string `gorm:"column:risk_level;size:32"`
	Summary       string `gorm:"type:text"`
	Detail        string `gorm:"type:text"`
	Dimensions    string `gorm:"type:text"`
	LogsCount     int    `gorm:"column:logs_count"`
	NewLogs       int    `gorm:"column:new_logs"`
	RunAt         string `gorm:"column:run_at;size:64"`
	Skipped       bool   `gorm:"column:skipped;default:false"`
	LastLogID     int64  `gorm:"column:last_log_id;default:0"`
	ThreatScore   int    `gorm:"column:threat_score;default:0"`
	ThreatSignals string `gorm:"column:threat_signals;type:text"`
	Analyzed      bool   `gorm:"column:analyzed;default:true"`
}

func (DBSystemAnalysisKeyResult) TableName() string { return "system_analysis_key_results" }

type DBStat struct {
	ID              int       `gorm:"primaryKey;check:id = 1"`
	TotalRequests   int64     `gorm:"column:total_requests"`
	SuccessRequests int64     `gorm:"column:success_requests"`
	ErrorRequests   int64     `gorm:"column:error_requests"`
	InputTokens     int64     `gorm:"column:input_tokens"`
	OutputTokens    int64     `gorm:"column:output_tokens"`
	TotalLatencyMs  int64     `gorm:"column:total_latency_ms"`
	UpdatedAt       time.Time `gorm:"column:updated_at"`
}

func (DBStat) TableName() string { return "stats" }

type DBStatByProvider struct {
	Provider     string `gorm:"primaryKey;size:128"`
	Requests     int64
	InputTokens  int64 `gorm:"column:input_tokens"`
	OutputTokens int64 `gorm:"column:output_tokens"`
}

func (DBStatByProvider) TableName() string { return "stats_by_provider" }

type DBStatByModel struct {
	Model    string `gorm:"primaryKey;size:256"`
	Requests int64
}

func (DBStatByModel) TableName() string { return "stats_by_model" }

type DBStatDaily struct {
	Date        string `gorm:"primaryKey;size:32"`
	Requests    int64
	InputTokens int64 `gorm:"column:input_tokens"`
	OutputTokens int64 `gorm:"column:output_tokens"`
}

func (DBStatDaily) TableName() string { return "stats_daily" }

type DBAdminUser struct {
	ID           int    `gorm:"primaryKey;check:id = 1"`
	Username     string `gorm:"size:128"`
	PasswordHash string `gorm:"column:password_hash;size:256"`
	Role         string `gorm:"size:32"`
}

func (DBAdminUser) TableName() string { return "admin_users" }

func nullTimeToPtr(ns sql.NullString) *time.Time {
	if !ns.Valid || ns.String == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, ns.String)
	if err != nil {
		return nil
	}
	return &t
}
