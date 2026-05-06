package main

import (
	"database/sql"
	"log"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/bytedance/sonic"
	"github.com/cloudflare/ahocorasick"
)

var keywordCategories = []string{"pornography", "violence", "politics", "terrorism", "sensitive_data"}
var keywordCategoryLabels = map[string]string{
	"pornography":    "涉黄",
	"violence":       "涉暴",
	"politics":       "涉政",
	"terrorism":      "涉恐",
	"sensitive_data": "敏感数据",
}

type DirectionConfig struct {
	Enabled           bool     `json:"enabled"`
	Mode              string   `json:"mode"`
	KeywordEnabled    bool     `json:"keyword_enabled"`
	KeywordCategories []string `json:"keyword_categories"`
	SemanticEnabled   bool     `json:"semantic_enabled"`
	VectorEnabled     bool     `json:"vector_enabled"`
}

type SecurityConfig struct {
	Enabled           bool                              `json:"enabled"`
	Input             DirectionConfig                   `json:"input"`
	Output            DirectionConfig                   `json:"output"`
	Keywords          []string                          `json:"keywords"`
	KeywordByLevel    map[string][]string               `json:"keyword_by_level"`
	KeywordByCategory map[string]map[string][]string    `json:"keyword_by_category"`
	KeywordLevels     []string                          `json:"keyword_levels"`
	BlockMessage      string                            `json:"block_message"`
	SemanticModel     string                            `json:"semantic_model"`
	SemanticThreshold float64                           `json:"semantic_threshold"`
	SemanticPrompt    string                            `json:"semantic_prompt"`
	AutoBanKey        bool                              `json:"auto_ban_key"`
}

type SecurityAlert struct {
	Timestamp      time.Time `json:"timestamp"`
	Direction      string    `json:"direction"`
	Mode           string    `json:"mode"`
	TriggerType    string    `json:"trigger_type"`
	TriggerDetail  string    `json:"trigger_detail"`
	ContentPreview string    `json:"content_preview"`
	Model          string    `json:"model"`
	APIKeyUsed     string    `json:"api_key_used"`
	ClientIP       string    `json:"client_ip"`
	Action         string    `json:"action"`
}

var (
	secConfig      SecurityConfig
	secConfigMu    sync.Mutex
	compiledRegexps []*regexp.Regexp
	regexpsMu      sync.Mutex

	acMatchers   map[string]*ahocorasick.Matcher
	acDicts      map[string][]string
	acLevelForIdx map[string][]string
	acBuildMu    sync.Mutex
)

var securityCategories = []string{"sensitive_data", "pornography", "violence", "politics", "terrorism"}

var defaultSemanticSystemPrompt = `你是一个内容安全分类引擎。你的唯一任务是对输入内容进行安全分类评分。

你必须严格回复一个JSON对象，不要回复任何其他内容。格式如下：
{"sensitive_data":{"d":false,"c":0.0},"pornography":{"d":false,"c":0.0},"violence":{"d":false,"c":0.0},"politics":{"d":false,"c":0.0},"terrorism":{"d":false,"c":0.0}}

分类定义：
- sensitive_data: 个人隐私泄露、身份证号、手机号、银行卡号、密码、密钥等敏感数据
- pornography: 色情、裸露、性暗示、性行为描写
- violence: 暴力、血腥、虐待、自残、凶杀
- politics: 政治敏感、颠覆国家、分裂、敏感政治人物或事件
- terrorism: 恐怖主义、极端主义、炸弹制造、煽动恐怖活动

每个字段：
- d: boolean，是否检测到该类别
- c: float 0.0-1.0，置信度，0.0表示完全无关，1.0表示非常确定

只输出JSON，不要输出任何解释或额外文本。`

func rebuildMatchers(cfg *SecurityConfig) {
	regexpsMu.Lock()
	defer regexpsMu.Unlock()

	compiledRegexps = make([]*regexp.Regexp, 0, len(cfg.Keywords))
	for _, kw := range cfg.Keywords {
		if kw == "" {
			continue
		}
		var buf strings.Builder
		for _, ch := range kw {
			if ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch > 127 {
				buf.WriteRune(ch)
			} else {
				buf.WriteString(regexp.QuoteMeta(string(ch)))
			}
		}
		pattern := "(?i)" + buf.String()
		if re, err := regexp.Compile(pattern); err == nil {
			compiledRegexps = append(compiledRegexps, re)
		} else {
			escaped := "(?i)" + regexp.QuoteMeta(kw)
			if re2, err2 := regexp.Compile(escaped); err2 == nil {
				compiledRegexps = append(compiledRegexps, re2)
			}
		}
	}

	acBuildMu.Lock()
	defer acBuildMu.Unlock()
	acMatchers = make(map[string]*ahocorasick.Matcher)
	acDicts = make(map[string][]string)
	acLevelForIdx = make(map[string][]string)

	enabledLevels := make(map[string]bool)
	for _, lvl := range cfg.KeywordLevels {
		enabledLevels[lvl] = true
	}

	if cfg.KeywordByCategory == nil || len(cfg.KeywordByCategory) == 0 {
		if cfg.KeywordByLevel != nil && len(cfg.KeywordByLevel) > 0 {
			cfg.KeywordByCategory = map[string]map[string][]string{
				"sensitive_data": cfg.KeywordByLevel,
			}
			log.Printf("[INFO] rebuildMatchers: migrated legacy KeywordByLevel to KeywordByCategory")
		} else {
			return
		}
	}

	for cat, levelMap := range cfg.KeywordByCategory {
		allWords := []string{}
		allLevels := []string{}

		for level, kws := range levelMap {
			if !enabledLevels[level] {
				continue
			}
			for _, kw := range kws {
				if kw == "" {
					continue
				}
				var buf strings.Builder
				for _, ch := range kw {
					if ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch > 127 {
						buf.WriteRune(ch)
					}
				}
				if buf.Len() > 0 {
					allWords = append(allWords, buf.String())
					allLevels = append(allLevels, level)
				}
			}
		}

		if len(allWords) == 0 {
			continue
		}

		matcher := ahocorasick.NewStringMatcher(allWords)
		acMatchers[cat] = matcher
		acDicts[cat] = allWords
		acLevelForIdx[cat] = allLevels
		log.Printf("[INFO] AC matcher built for category=%s with %d keywords (levels=%v)", cat, len(allWords), cfg.KeywordLevels)
	}
}

func normalizeKeywordLevels(levels []string, order []string) []string {
	set := make(map[string]bool, len(levels))
	for _, l := range levels {
		set[l] = true
	}
	var result []string
	for _, l := range order {
		if set[l] {
			result = append(result, l)
		}
	}
	for _, l := range levels {
		if !set[l] {
			result = append(result, l)
		}
	}
	return result
}

func rebuildRegexps(keywords []string) {
	cfg := &SecurityConfig{
		Keywords: keywords,
		KeywordByLevel: map[string][]string{"high": keywords},
		KeywordByCategory: map[string]map[string][]string{
			"sensitive_data": {"high": keywords},
		},
		KeywordLevels: []string{"critical", "high", "medium", "low"},
	}
	rebuildMatchers(cfg)
}

func defaultSecurityConfig() SecurityConfig {
	return SecurityConfig{
		Input: DirectionConfig{
			Enabled:           true,
			Mode:              "block",
			KeywordEnabled:    true,
			KeywordCategories: []string{"pornography", "violence", "politics", "terrorism", "sensitive_data"},
			SemanticEnabled:   false,
			VectorEnabled:     false,
		},
		Output: DirectionConfig{
			Enabled:           true,
			Mode:              "block",
			KeywordEnabled:    true,
			KeywordCategories: []string{"pornography", "violence", "politics", "terrorism", "sensitive_data"},
			SemanticEnabled:   false,
			VectorEnabled:     false,
		},
		Keywords:       []string{},
		KeywordLevels:  []string{"critical", "high", "medium", "low"},
		BlockMessage:   "抱歉，您的内容涉及敏感信息，已被安全策略拦截。",
		SemanticThreshold: 0.8,
	}
}

func dbLoadSecurityConfig() SecurityConfig {
	cfg := defaultSecurityConfig()

	row := db.QueryRow(`SELECT config_json FROM security_config WHERE id = 1`)
	var configJSON string
	err := row.Scan(&configJSON)
	if err != nil {
		if err != sql.ErrNoRows {
			log.Printf("[WARN] dbLoadSecurityConfig: %v", err)
		}
		return cfg
	}

	if err := sonic.Unmarshal([]byte(configJSON), &cfg); err != nil {
		log.Printf("[WARN] dbLoadSecurityConfig: parse error: %v", err)
		return defaultSecurityConfig()
	}

	if cfg.Keywords == nil {
		cfg.Keywords = []string{}
	}
	if cfg.BlockMessage == "" {
		cfg.BlockMessage = "抱歉，您的内容涉及敏感信息，已被安全策略拦截。"
	}
	allLevels := []string{"critical", "high", "medium", "low"}
	if cfg.KeywordLevels == nil {
		cfg.KeywordLevels = allLevels
	}

	if cfg.KeywordByCategory == nil && cfg.KeywordByLevel != nil && len(cfg.KeywordByLevel) > 0 {
		cfg.KeywordByCategory = map[string]map[string][]string{
			"sensitive_data": cfg.KeywordByLevel,
		}
		log.Printf("[INFO] dbLoadSecurityConfig: migrated KeywordByLevel to KeywordByCategory")
		cfg.KeywordByLevel = nil
	}

	if cfg.KeywordByCategory != nil {
		levelSet := make(map[string]bool, len(cfg.KeywordLevels))
		for _, l := range cfg.KeywordLevels {
			levelSet[l] = true
		}
		needSave := false
		for _, levelMap := range cfg.KeywordByCategory {
			for lvl, kws := range levelMap {
				if len(kws) > 0 && !levelSet[lvl] {
					cfg.KeywordLevels = append(cfg.KeywordLevels, lvl)
					levelSet[lvl] = true
					needSave = true
					log.Printf("[INFO] dbLoadSecurityConfig: auto-added keyword_level '%s' (keywords exist)", lvl)
				}
			}
		}
		if needSave {
			cfg.KeywordLevels = normalizeKeywordLevels(cfg.KeywordLevels, allLevels)
			dbSaveSecurityConfig(&cfg)
			log.Printf("[INFO] dbLoadSecurityConfig: saved updated keyword_levels=%v", cfg.KeywordLevels)
		}
	}

	if cfg.Input.KeywordCategories == nil || len(cfg.Input.KeywordCategories) == 0 {
		cfg.Input.KeywordCategories = []string{"sensitive_data"}
	}
	if cfg.Output.KeywordCategories == nil || len(cfg.Output.KeywordCategories) == 0 {
		cfg.Output.KeywordCategories = []string{"sensitive_data"}
	}

	rebuildMatchers(&cfg)
	log.Printf("[INFO] dbLoadSecurityConfig: enabled=%v, levels=%v, input_cats=%v, output_cats=%v",
		cfg.Enabled, cfg.KeywordLevels, cfg.Input.KeywordCategories, cfg.Output.KeywordCategories)
	return cfg
}

func dbSaveSecurityConfig(cfg *SecurityConfig) {
	configJSON, _ := sonic.Marshal(cfg)
	_, err := db.Exec(`INSERT OR REPLACE INTO security_config (id, config_json) VALUES (1, ?)`, string(configJSON))
	if err != nil {
		log.Printf("[ERROR] dbSaveSecurityConfig: %v", err)
	}
	rebuildMatchers(cfg)
}

func dbInsertAlert(alert *SecurityAlert) {
	_, err := db.Exec(`INSERT INTO security_alerts
		(timestamp, direction, mode, trigger_type, trigger_detail, content_preview, model, api_key_used, client_ip, action, resolved)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
		alert.Timestamp.UTC().Format(time.RFC3339), alert.Direction, alert.Mode,
		alert.TriggerType, alert.TriggerDetail, alert.ContentPreview,
		alert.Model, alert.APIKeyUsed, alert.ClientIP, alert.Action)
	if err != nil {
		log.Printf("[ERROR] dbInsertAlert: %v", err)
	}
}

func dbGetAlerts(limit, offset int, resolved *int) ([]map[string]interface{}, int) {
	var total int
	query := "SELECT COUNT(*) FROM security_alerts"
	if resolved != nil {
		query += " WHERE resolved = ?"
	}
	db.QueryRow(query, *resolved).Scan(&total)

	rows, err := db.Query(`SELECT id, timestamp, direction, mode, trigger_type, trigger_detail, content_preview, model, api_key_used, client_ip, action, resolved
		FROM security_alerts ORDER BY id DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		log.Printf("[ERROR] dbGetAlerts: %v", err)
		return nil, 0
	}
	defer rows.Close()

	var alerts []map[string]interface{}
	for rows.Next() {
		var id int
		var ts, direction, mode, triggerType, triggerDetail, contentPreview, model, apiKeyUsed, clientIP, action string
		var resolvedVal int
		rows.Scan(&id, &ts, &direction, &mode, &triggerType, &triggerDetail, &contentPreview, &model, &apiKeyUsed, &clientIP, &action, &resolvedVal)
		alerts = append(alerts, map[string]interface{}{
			"id":              id,
			"timestamp":       ts,
			"direction":       direction,
			"mode":            mode,
			"trigger_type":    triggerType,
			"trigger_detail":  triggerDetail,
			"content_preview": contentPreview,
			"model":           model,
			"api_key_used":    apiKeyUsed,
			"client_ip":       clientIP,
			"action":          action,
			"resolved":        resolvedVal,
		})
	}
	return alerts, total
}
