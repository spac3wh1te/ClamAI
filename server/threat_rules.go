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
	var count int
	db.QueryRow("SELECT COUNT(*) FROM threat_rules").Scan(&count)
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
		db.Exec(`INSERT INTO threat_rules (threat_type, name, patterns_json, severity, enabled) VALUES (?, ?, ?, ?, 1)`,
			s.threatType, s.name, string(patternsJSON), s.severity)
	}
	log.Printf("[INFO] seedDefaultThreatRules: seeded %d default threat rules", len(seeds))
}

func loadThreatRules() {
	threatMatchersMu.Lock()
	defer threatMatchersMu.Unlock()

	threatMatchers = make(map[string][]*regexp.Regexp)
	threatRuleIds = make(map[string][]int64)

	rows, err := db.Query("SELECT id, threat_type, patterns_json FROM threat_rules WHERE enabled = 1")
	if err != nil {
		log.Printf("[ERROR] loadThreatRules: %v", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id int64
		var threatType, patternsJSON string
		if rows.Scan(&id, &threatType, &patternsJSON) != nil {
			continue
		}
		var patterns []string
		if sonic.Unmarshal([]byte(patternsJSON), &patterns) != nil {
			continue
		}
		for _, p := range patterns {
			if re, err := regexp.Compile(p); err == nil {
				threatMatchers[threatType] = append(threatMatchers[threatType], re)
				threatRuleIds[threatType] = append(threatRuleIds[threatType], id)
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
	query := "SELECT id, threat_type, name, patterns_json, severity, enabled, created_at, updated_at FROM threat_rules"
	var args []interface{}
	if threatType != "" {
		query += " WHERE threat_type = ?"
		args = append(args, threatType)
	}
	query += " ORDER BY threat_type, id"

	rows, err := db.Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	var rules []map[string]interface{}
	for rows.Next() {
		var id int64
		var tType, name, patternsJSON, severity string
		var enabled int
		var createdAt, updatedAt string
		rows.Scan(&id, &tType, &name, &patternsJSON, &severity, &enabled, &createdAt, &updatedAt)

		var patterns []string
		sonic.Unmarshal([]byte(patternsJSON), &patterns)

		rules = append(rules, map[string]interface{}{
			"id":          id,
			"threat_type": tType,
			"name":        name,
			"patterns":    patterns,
			"severity":    severity,
			"enabled":     enabled == 1,
			"created_at":  createdAt,
			"updated_at":  updatedAt,
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
	result, err := db.Exec(`INSERT INTO threat_rules (threat_type, name, patterns_json, severity, enabled) VALUES (?, ?, ?, ?, ?)`,
		input.ThreatType, input.Name, string(patternsJSON), input.Severity, input.Enabled)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	id, _ := result.LastInsertId()
	loadThreatRules()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"id": id, "success": true})
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
	now := formatTimeNow()
	db.Exec(`UPDATE threat_rules SET threat_type=?, name=?, patterns_json=?, severity=?, enabled=?, updated_at=? WHERE id=?`,
		input.ThreatType, input.Name, string(patternsJSON), input.Severity, input.Enabled, now, id)

	loadThreatRules()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func (p *ProxyServer) handleDeleteThreatRule(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	db.Exec("DELETE FROM threat_rules WHERE id = ?", id)
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

	rows, err := db.Query(`SELECT trigger_type, COUNT(*) FROM security_alerts WHERE timestamp >= ? AND trigger_type LIKE 'threat:%' GROUP BY trigger_type`, cutoff.Format(time.RFC3339))
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"by_type": map[string]int{}, "total": 0})
		return
	}
	defer rows.Close()

	byType := make(map[string]int)
	total := 0
	for rows.Next() {
		var tType string
		var cnt int
		if rows.Scan(&tType, &cnt) == nil {
			shortType := strings.TrimPrefix(tType, "threat:")
			byType[shortType] = cnt
			total += cnt
		}
	}

	type ruleCount struct {
		ThreatType string `json:"threat_type"`
		Total      int    `json:"total"`
		Enabled    int    `json:"enabled"`
	}
	var ruleCounts []ruleCount
	r2, _ := db.Query("SELECT threat_type, COUNT(*), SUM(CASE WHEN enabled=1 THEN 1 ELSE 0 END) FROM threat_rules GROUP BY threat_type")
	if r2 != nil {
		defer r2.Close()
		for r2.Next() {
			var rc ruleCount
			r2.Scan(&rc.ThreatType, &rc.Total, &rc.Enabled)
			ruleCounts = append(ruleCounts, rc)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"by_type":     byType,
		"total":       total,
		"rule_counts": ruleCounts,
	})
}
