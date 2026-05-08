package main

import (
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/bytedance/sonic"
	"github.com/gorilla/mux"
)

type ThreatRule struct {
	ID          int64    `json:"id"`
	ThreatType  string   `json:"threat_type"`
	Name        string   `json:"name"`
	Patterns    []string `json:"patterns"`
	Severity    string   `json:"severity"`
	Enabled     bool     `json:"enabled"`
	CreatedAt   string   `json:"created_at"`
	UpdatedAt   string   `json:"updated_at"`
}

type ThreatTypeConfig struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

var (
	threatMatchers   map[string][]*regexp.Regexp
	threatRuleIds    map[string][]int64
	threatMatchersMu sync.RWMutex
)

var ThreatTypes = []ThreatTypeConfig{
	{ID: "hacker_attack", Label: "黑客攻击", Description: "SQL注入、命令注入、路径遍历、SSRF等攻击行为"},
	{ID: "jailbreak", Label: "模型越狱", Description: "Prompt注入、角色扮演越狱、系统提示提取等绕过手法"},
	{ID: "adversarial", Label: "对抗攻击", Description: "编码绕过、混淆攻击、多语言混合绕过等对抗性威胁"},
	{ID: "malicious_gen", Label: "恶意内容生成", Description: "钓鱼邮件、恶意代码、虚假信息等恶意生成行为"},
}

func seedDefaultThreatRules() {
	var count int64
	gormDB.Model(&DBThreatRule{}).Count(&count)
	if count > 0 {
		return
	}

	type seed struct {
		threatType string
		name       string
		patterns   []string
		severity   string
	}

	seeds := []seed{
		{"hacker_attack", "SQL 注入", []string{
			`(?i)(union\s+(all\s+)?select)`,
			`(?i)(or\s+1\s*=\s*1)`,
			`(?i)(drop\s+table)`,
			`(?i)(insert\s+into)`,
			`(?i)(delete\s+from)`,
			`(?i)(;\s*select\s+)`,
			`(?i)('\s*or\s+'[^']*'\s*=\s*')`,
		}, "critical"},
		{"hacker_attack", "命令注入", []string{
			`(?i)(;\s*rm\s+-rf)`,
			`(?i)(\|\s*cat\s+/etc/passwd)`,
			`(?i)(\|\s*sh\b)`,
			`(?i)(\|\s*bash\b)`,
			`(?i)(;\s*wget\s+)`,
			`(?i)(;\s*curl\s+)`,
			"`[^`]*`",
		}, "critical"},
		{"hacker_attack", "路径遍历", []string{
			`\.\./\.\./`,
			`/etc/passwd`,
			`/proc/self/`,
			`/proc/version`,
			`(?i)(\.\.[\\/]){2,}`,
		}, "high"},
		{"jailbreak", "Prompt 注入", []string{
			`(?i)(ignore\s+(all\s+)?previous\s+instructions)`,
			`(?i)(disregard\s+(all\s+)?previous)`,
			`(?i)(forget\s+(all\s+)?(your|previous)\s+(instructions|rules))`,
			`(?i)(new\s+instructions?\s*:)`,
			`(?i)(override\s+(your|the)\s+(safety|security|content)\s+(policy|filter|guidelines))`,
			`(?i)(bypass\s+(your|the)\s+(safety|security|content)\s+(filter|policy))`,
		}, "critical"},
		{"jailbreak", "角色扮演越狱", []string{
			`(?i)(you\s+are\s+now\s+DAN)`,
			`(?i)(act\s+as\s+(if\s+)?you\s+have\s+no\s+(rules|restrictions|filter))`,
			`(?i)(pretend\s+you\s+are\s+(an?\s+)?(evil|unfiltered|unrestricted|uncensored))`,
			`(?i)(roleplay\s+as\s+(an?\s+)?(evil|unfiltered|unrestricted|uncensored|harmful))`,
			`(?i)(simulate\s+(an?\s+)?(evil|unfiltered|uncensored)\s+(AI|assistant|character))`,
			`(?i)(jailbreak(ed)?\s+(mode|prompt|GPT))`,
		}, "high"},
		{"jailbreak", "系统提示提取", []string{
			`(?i)(what\s+(are|were)\s+your\s+(system|initial)\s+(instructions|prompt))`,
			`(?i)(repeat\s+(your|the)\s+(system|initial)\s+(prompt|instructions))`,
			`(?i)(show\s+me\s+your\s+(system|initial)\s+(prompt|instructions))`,
			`(?i)(output\s+your\s+(system|initial)\s+prompt)`,
			`(?i)(reveal\s+your\s+(system|initial)\s+(prompt|instructions))`,
		}, "medium"},
		{"adversarial", "编码绕过", []string{
			`(?i)(base64\s*decode\s*\()`,
			`(?i)(atob\s*\()`,
			`(?i)(fromCharCode)`,
			`(?i)(\\x[0-9a-f]{2}){5,}`,
			`(?i)(\\u[0-9a-f]{4}){5,}`,
			`(?i)(rot13)`,
		}, "high"},
		{"adversarial", "混淆攻击", []string{
			`(?i)(l33t\s+speak)`,
			`(?i)(z\w*g\w*r\w*i)`,
			`(?i)((\w)\s*(\w)\s*(\w)\s*(\w)\s*(\w)\s*(\w)\s*(\w)\s*(\w)){3,}`,
		}, "medium"},
		{"malicious_gen", "钓鱼邮件生成", []string{
			`(?i)(write\s+(an?\s+)?(phishing|scam|fraud)\s+(email|letter|message))`,
			`(?i)(create\s+(an?\s+)?(phishing|scam)\s+(email|page|site))`,
			`(?i)(draft\s+(an?\s+)?(phishing|social\s+engineering)\s+(email|message))`,
			`(?i)(fake\s+(login|bank|paypal|amazon)\s+(page|site|email))`,
		}, "critical"},
		{"malicious_gen", "恶意代码生成", []string{
			`(?i)(write\s+(an?\s+)?(malware|ransomware|trojan|virus|rootkit|keylogger))`,
			`(?i)(create\s+(an?\s+)?(exploit|backdoor|payload))`,
			`(?i)(generate\s+(malicious|evil)\s+(code|script|payload))`,
			`(?i)(how\s+to\s+(hack|crack|exploit)\s+)`,
		}, "critical"},
	}

	for _, s := range seeds {
		patternsJSON, _ := sonic.Marshal(s.patterns)
		gormDB.Create(&DBThreatRule{
			ThreatType:   s.threatType,
			Name:         s.name,
			PatternsJSON: string(patternsJSON),
			Severity:     s.severity,
			Enabled:      true,
		})
	}
	log.Printf("[INFO] seedDefaultThreatRules: seeded %d default threat rules", len(seeds))
}

func loadThreatRules() {
	threatMatchersMu.Lock()
	defer threatMatchersMu.Unlock()

	threatMatchers = make(map[string][]*regexp.Regexp)
	threatRuleIds = make(map[string][]int64)

	var dbRules []DBThreatRule
	if err := gormDB.Where("enabled = ?", true).Find(&dbRules).Error; err != nil {
		log.Printf("[ERROR] loadThreatRules: %v", err)
		return
	}

	for _, rule := range dbRules {
		var patterns []string
		if sonic.Unmarshal([]byte(rule.PatternsJSON), &patterns) != nil {
			continue
		}
		for _, p := range patterns {
			if re, err := regexp.Compile(p); err == nil {
				threatMatchers[rule.ThreatType] = append(threatMatchers[rule.ThreatType], re)
				threatRuleIds[rule.ThreatType] = append(threatRuleIds[rule.ThreatType], rule.ID)
			}
		}
	}

	for t := range threatMatchers {
		log.Printf("[INFO] loadThreatRules: %s: %d matchers", t, len(threatMatchers[t]))
	}
}

func checkThreatRules(content string) (bool, string, string, string) {
	threatMatchersMu.RLock()
	defer threatMatchersMu.RUnlock()

	for tType, matchers := range threatMatchers {
		for _, re := range matchers {
			if re.MatchString(content) {
				match := re.FindString(content)
				return true, tType, "high", match
			}
		}
	}
	return false, "", "", ""
}

func (p *ProxyServer) setupThreatRoutes(api *mux.Router) {
	api.HandleFunc("/threats/rules", p.handleListThreatRules).Methods("GET")
	api.HandleFunc("/threats/rules", p.handleCreateThreatRule).Methods("POST")
	api.HandleFunc("/threats/rules/{id}", p.handleUpdateThreatRule).Methods("PUT")
	api.HandleFunc("/threats/rules/{id}", p.handleDeleteThreatRule).Methods("DELETE")
	api.HandleFunc("/threats/stats", p.handleThreatStats).Methods("GET")
}

func (p *ProxyServer) handleListThreatRules(w http.ResponseWriter, r *http.Request) {
	threatType := r.URL.Query().Get("type")

	q := gormDB.Model(&DBThreatRule{}).Order("threat_type, id")
	if threatType != "" {
		q = q.Where("threat_type = ?", threatType)
	}

	var dbRules []DBThreatRule
	if err := q.Find(&dbRules).Error; err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	var rules []map[string]interface{}
	for _, rule := range dbRules {
		var patterns []string
		sonic.Unmarshal([]byte(rule.PatternsJSON), &patterns)

		rules = append(rules, map[string]interface{}{
			"id":          rule.ID,
			"threat_type": rule.ThreatType,
			"name":        rule.Name,
			"patterns":    patterns,
			"severity":    rule.Severity,
			"enabled":     rule.Enabled,
			"created_at":  rule.CreatedAt,
			"updated_at":  rule.UpdatedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"rules": rules})
}

func (p *ProxyServer) handleCreateThreatRule(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ThreatType string   `json:"threat_type"`
		Name       string   `json:"name"`
		Patterns   []string `json:"patterns"`
		Severity   string   `json:"severity"`
		Enabled    bool     `json:"enabled"`
	}
	if json.NewDecoder(r.Body).Decode(&input) != nil {
		http.Error(w, "invalid input", 400)
		return
	}
	if input.Severity == "" {
		input.Severity = "high"
	}

	patternsJSON, _ := sonic.Marshal(input.Patterns)
	rule := DBThreatRule{
		ThreatType:   input.ThreatType,
		Name:         input.Name,
		PatternsJSON: string(patternsJSON),
		Severity:     input.Severity,
		Enabled:      input.Enabled,
	}
	if err := gormDB.Create(&rule).Error; err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	loadThreatRules()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"id": rule.ID, "success": true})
}

func (p *ProxyServer) handleUpdateThreatRule(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	var input struct {
		ThreatType string   `json:"threat_type"`
		Name       string   `json:"name"`
		Patterns   []string `json:"patterns"`
		Severity   string   `json:"severity"`
		Enabled    bool     `json:"enabled"`
	}
	if json.NewDecoder(r.Body).Decode(&input) != nil {
		http.Error(w, "invalid input", 400)
		return
	}

	patternsJSON, _ := sonic.Marshal(input.Patterns)
	gormDB.Model(&DBThreatRule{}).Where("id = ?", id).Updates(map[string]interface{}{
		"threat_type":   input.ThreatType,
		"name":          input.Name,
		"patterns_json": string(patternsJSON),
		"severity":      input.Severity,
		"enabled":       input.Enabled,
		"updated_at":    formatTimeNow(),
	})

	loadThreatRules()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func (p *ProxyServer) handleDeleteThreatRule(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	gormDB.Where("id = ?", id).Delete(&DBThreatRule{})
	loadThreatRules()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func (p *ProxyServer) handleThreatStats(w http.ResponseWriter, r *http.Request) {
	period := 1440
	if d := r.URL.Query().Get("period"); d != "" {
		if parsed, err := time.ParseDuration(d + "m"); err == nil {
			_ = parsed
		}
		if p2, err := strconv.Atoi(r.URL.Query().Get("period")); err == nil && p2 > 0 {
			period = p2
		}
	}
	cutoff := time.Now().Add(-time.Duration(period) * time.Minute).UTC()

	type alertGroup struct {
		TriggerType string
		Cnt         int
	}
	var alertGroups []alertGroup
	gormDB.Model(&DBSecurityAlert{}).
		Select("trigger_type, COUNT(*) as cnt").
		Where("timestamp >= ? AND trigger_type LIKE ?", cutoff.Format(time.RFC3339), "threat:%").
		Group("trigger_type").
		Find(&alertGroups)

	byType := make(map[string]int)
	total := 0
	for _, ag := range alertGroups {
		shortType := strings.TrimPrefix(ag.TriggerType, "threat:")
		byType[shortType] = ag.Cnt
		total += ag.Cnt
	}

	type ruleCount struct {
		ThreatType string `json:"threat_type"`
		Total      int    `json:"total"`
		Enabled    int    `json:"enabled"`
	}
	var ruleCounts []ruleCount
	gormDB.Model(&DBThreatRule{}).
		Select("threat_type, COUNT(*) as total, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled").
		Group("threat_type").
		Find(&ruleCounts)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"by_type":     byType,
		"total":       total,
		"rule_counts": ruleCounts,
	})
}
