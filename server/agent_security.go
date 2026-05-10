package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

type AgentMsg struct {
	Role      string
	Content   string
	Timestamp string
	Model     string
}

func getAgentDirMap() map[string]string {
	homeDir, _ := os.UserHomeDir()
	return map[string]string{
		"claude code":   filepath.Join(homeDir, ".claude"),
		"cursor":        filepath.Join(homeDir, ".cursor"),
		"windsurf":      filepath.Join(homeDir, ".windsurf"),
		"cline":         filepath.Join(homeDir, ".cline"),
		"aider":         filepath.Join(homeDir, ".aider"),
		"codex cli":     filepath.Join(homeDir, ".codex"),
		"cherry studio": filepath.Join(homeDir, ".cherrystudio"),
		"openclaw":      filepath.Join(homeDir, ".openclaw"),
		"lm studio":     filepath.Join(homeDir, ".lmstudio"),
		"aipy pro":      filepath.Join(homeDir, ".aipyapp"),
		"trae aicc":     filepath.Join(homeDir, ".trae-aicc"),
		"trae cn":       filepath.Join(homeDir, ".trae-cn"),
	}
}

func (p *ProxyServer) handleAgentList(w http.ResponseWriter, r *http.Request) {
	dirs := getAgentDirMap()
	type AgentInfo struct {
		Name       string `json:"name"`
		Dir        string `json:"dir"`
		Detected   bool   `json:"detected"`
		HasConfig  bool   `json:"has_config"`
		HasSkills  bool   `json:"has_skills"`
		HasLogs    bool   `json:"has_logs"`
		SessionCnt int    `json:"session_count"`
	}

	var agents []AgentInfo
	for name, dir := range dirs {
		info := AgentInfo{Name: name, Dir: dir}
		if st, err := os.Stat(dir); err == nil && st.IsDir() {
			info.Detected = true
			configFiles := []string{"settings.json", "config.json", "config.yaml", "config.yml", ".aider.conf.yml", "argv.json", "openclaw.json"}
			for _, cf := range configFiles {
				if _, err := os.Stat(filepath.Join(dir, cf)); err == nil {
					info.HasConfig = true
					break
				}
			}
			filepath.Walk(dir, func(path string, fi os.FileInfo, err error) error {
				if err != nil || fi.IsDir() {
					return nil
				}
				lower := strings.ToLower(fi.Name())
				if strings.Contains(lower, "skill") || strings.Contains(lower, "rule") {
					info.HasSkills = true
				}
				ext := filepath.Ext(lower)
				if ext == ".json" || ext == ".jsonl" || ext == ".log" || ext == ".md" {
					info.SessionCnt++
				}
				return nil
			})
			if info.SessionCnt > 0 {
				info.HasLogs = true
			}
		}
		agents = append(agents, info)
	}
	sort.Slice(agents, func(i, j int) bool {
		if agents[i].Detected != agents[j].Detected {
			return agents[i].Detected
		}
		return agents[i].Name < agents[j].Name
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"agents": agents,
		"total":  len(agents),
	})
}

func (p *ProxyServer) handleAgentLogsParse(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AgentName string `json:"agent_name"`
		Path      string `json:"path"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	homeDir, _ := os.UserHomeDir()
	scanPaths := []string{}
	if req.Path != "" {
		absPath, err := filepath.Abs(req.Path)
		if err != nil {
			http.Error(w, "Invalid path", http.StatusBadRequest)
			return
		}
		if !strings.HasPrefix(absPath, homeDir) {
			http.Error(w, "Path not allowed", http.StatusForbidden)
			return
		}
		scanPaths = []string{absPath}
	} else if req.AgentName != "" {
		dirs := getAgentDirMap()
		if dir, ok := dirs[strings.ToLower(req.AgentName)]; ok {
			scanPaths = []string{dir}
		} else {
			http.Error(w, "Unknown agent", http.StatusBadRequest)
			return
		}
	} else {
		for _, dir := range getAgentDirMap() {
			if _, err := os.Stat(dir); err == nil {
				scanPaths = append(scanPaths, dir)
			}
		}
	}

	type TimelineEvent struct {
		Timestamp string `json:"timestamp"`
		AgentName string `json:"agent_name"`
		EventType string `json:"event_type"`
		Content   string `json:"content"`
		Severity  string `json:"severity"`
		RuleName  string `json:"rule_name,omitempty"`
		FilePath  string `json:"file_path"`
	}

	var events []TimelineEvent
	for _, sp := range scanPaths {
		if _, err := os.Stat(sp); os.IsNotExist(err) {
			continue
		}
		agentName := deriveAgentName(sp)
		filepath.Walk(sp, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return nil
			}
			name := strings.ToLower(info.Name())
			ext := filepath.Ext(name)
			if ext != ".json" && ext != ".jsonl" && ext != ".log" && ext != ".md" && !strings.Contains(info.Name(), ".") {
				return nil
			}
			if info.Size() > 5<<20 {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return nil
			}
			msgs := parseAgentMessages(data, name)
			for _, msg := range msgs {
				evt := TimelineEvent{
					Timestamp: msg.Timestamp,
					AgentName: agentName,
					EventType: mapRoleToEventType(msg.Role),
					Content:   msg.Content,
					Severity:  "info",
					FilePath:  path,
				}
				if evt.Timestamp == "" {
					evt.Timestamp = info.ModTime().UTC().Format(time.RFC3339)
				}
				matched, threatType, sev, matchStr := checkThreatRules(msg.Content)
				if matched {
					evt.Severity = sev
					evt.RuleName = fmt.Sprintf("%s: %s", threatType, truncateStr(matchStr, 80))
				} else {
					lower := strings.ToLower(msg.Content)
					for _, kw := range []string{"sk-", "api_key", "password", "secret", "rm -rf", "sudo rm", "drop table", "eval(", "exec("} {
						if strings.Contains(lower, kw) {
							evt.Severity = "high"
							evt.RuleName = "sensitive_pattern: " + kw
							break
						}
					}
				}
				events = append(events, evt)
			}
			return nil
		})
	}

	var critical, high, medium int
	for _, e := range events {
		switch e.Severity {
		case "critical":
			critical++
		case "high":
			high++
		case "medium":
			medium++
		}
	}

	var newCount int
	for _, evt := range events {
		contentKey := fmt.Sprintf("%s|%s|%s", evt.AgentName, evt.Timestamp, truncateStr(evt.Content, 200))
		hash := fmt.Sprintf("%x", sha256.Sum256([]byte(contentKey)))
		var existing DBAgentRuntimeEvent
		gormDB.Where("content_hash = ?", hash).First(&existing)
		if existing.ID == 0 {
			target := truncateStr(evt.Content, 200)
			if evt.RuleName != "" {
				target = evt.RuleName
			}
			gormDB.Create(&DBAgentRuntimeEvent{
				AgentName:   evt.AgentName,
				EventAt:     parseTime(evt.Timestamp),
				EventType:   evt.EventType,
				EventTarget: target,
				Severity:    evt.Severity,
				RuleName:    evt.RuleName,
				Details:     truncateStr(evt.Content, 4000),
				LogSource:   evt.FilePath,
				ContentHash: hash,
			})
			newCount++
		}
	}

	if events == nil {
		events = []TimelineEvent{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"events":      events,
		"total":       len(events),
		"new_count":   newCount,
		"critical":    critical,
		"high":        high,
		"medium":      medium,
		"scan_time":   time.Now().UTC().Format(time.RFC3339),
	})
}

func (p *ProxyServer) handleAgentRuntimeEvents(w http.ResponseWriter, r *http.Request) {
	agentName := r.URL.Query().Get("agent")
	severity := r.URL.Query().Get("severity")
	eventType := r.URL.Query().Get("event_type")
	search := r.URL.Query().Get("search")
	limit := 100
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := parseInt(l); err == nil && v > 0 && v <= 500 {
			limit = v
		}
	}
	offset := 0
	if o := r.URL.Query().Get("offset"); o != "" {
		if v, err := parseInt(o); err == nil && v >= 0 {
			offset = v
		}
	}

	query := gormDB.Model(&DBAgentRuntimeEvent{})
	if agentName != "" {
		query = query.Where("agent_name = ?", agentName)
	}
	if severity != "" {
		query = query.Where("severity = ?", severity)
	}
	if eventType != "" {
		query = query.Where("event_type = ?", eventType)
	}
	if search != "" {
		q := "%" + search + "%"
		query = query.Where("details LIKE ? OR rule_name LIKE ? OR event_target LIKE ? OR log_source LIKE ?", q, q, q, q)
	}

	var total int64
	query.Count(&total)

	var events []DBAgentRuntimeEvent
	query.Order("event_at DESC").Limit(limit).Offset(offset).Find(&events)

	type sevCount struct {
		Severity string
		Count    int64
	}
	var sevCounts []sevCount
	gormDB.Model(&DBAgentRuntimeEvent{}).Select("severity, COUNT(*) as count").Group("severity").Scan(&sevCounts)
	sevMap := map[string]int64{}
	for _, sc := range sevCounts {
		sevMap[sc.Severity] = sc.Count
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"events":   events,
		"total":    total,
		"sev_map":  sevMap,
	})
}

func deriveAgentName(dir string) string {
	base := filepath.Base(dir)
	switch base {
	case "sessions":
		return "OpenClaw"
	case "conversations":
		return "LM Studio"
	case "trace":
		return "Cherry Studio"
	case "log":
		return "AiPy Pro"
	default:
		name := strings.TrimPrefix(base, ".")
		if idx := strings.Index(name, "-"); idx > 0 {
			parts := strings.Split(name, "-")
			for i, p := range parts {
				if len(p) > 0 {
					parts[i] = strings.ToUpper(p[:1]) + p[1:]
				}
			}
			return strings.Join(parts, " ")
		}
		if len(name) > 0 {
			return strings.ToUpper(name[:1]) + name[1:]
		}
		return base
	}
}

func mapRoleToEventType(role string) string {
	switch strings.ToLower(role) {
	case "user":
		return "user_input"
	case "assistant":
		return "model_output"
	case "system":
		return "system_prompt"
	default:
		return "message"
	}
}

func parseTime(s string) time.Time {
	for _, layout := range []string{
		time.RFC3339Nano, time.RFC3339,
		"2006-01-02T15:04:05", "2006-01-02 15:04:05",
		"2006/01/02 15:04:05",
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC()
		}
	}
	return time.Now().UTC()
}

func parseInt(s string) (int, error) {
	return strconv.Atoi(s)
}

func parseAgentMessages(data []byte, fileName string) []AgentMsg {
	var msgs []AgentMsg
	isJSONL := strings.HasSuffix(fileName, ".jsonl")
	isNoExt := !strings.Contains(fileName, ".")

	if isJSONL || isNoExt {
		scanner := bufio.NewScanner(bytes.NewReader(data))
		for scanner.Scan() {
			line := scanner.Text()
			if line == "" || !strings.HasPrefix(line, "{") {
				continue
			}
			var obj map[string]interface{}
			if json.Unmarshal([]byte(line), &obj) != nil {
				continue
			}
			if typ, _ := obj["type"].(string); typ == "message" {
				if msg, ok := obj["message"].(map[string]interface{}); ok {
					role := normalizeRole(getStringField(msg, "role"))
					text := extractTextFromContent(msg["content"])
					ts := getStringField(msg, "timestamp")
					if ts == "" {
						ts = getStringField(obj, "timestamp")
					}
					if role != "" && text != "" {
						msgs = append(msgs, AgentMsg{Role: role, Content: text, Timestamp: ts})
					}
				}
			}
			if name, _ := obj["name"].(string); name == "sendMessage" {
				if attrs, ok := obj["attributes"].(map[string]interface{}); ok {
					if inputs, _ := attrs["inputs"].(string); inputs != "" {
						text := strings.Trim(inputs, "\"")
						ts := ""
						if st, ok := obj["startTime"].(float64); ok {
							ts = time.UnixMilli(int64(st)).Format(time.RFC3339)
						}
						if text != "" {
							msgs = append(msgs, AgentMsg{Role: "user", Content: text, Timestamp: ts})
						}
					}
					if outputs, _ := attrs["outputs"].(string); outputs != "" {
						text := strings.Trim(outputs, "\"")
						if text != "" {
							msgs = append(msgs, AgentMsg{Role: "assistant", Content: text})
						}
					}
				}
			}
			if modelName, _ := obj["modelName"].(string); modelName != "" {
				if attrs, ok := obj["attributes"].(map[string]interface{}); ok {
					if inputs, ok := attrs["inputs"].(map[string]interface{}); ok {
						if prompt, ok := inputs["prompt"].(map[string]interface{}); ok {
							if sys, ok := prompt["system"].(string); ok && sys != "" {
								msgs = append(msgs, AgentMsg{Role: "system", Content: sys, Model: modelName})
							}
							if chatMsgs, ok := prompt["messages"].([]interface{}); ok {
								for _, m := range chatMsgs {
									if cm, ok := m.(map[string]interface{}); ok {
										role := normalizeRole(getStringField(cm, "role"))
										text := extractTextFromContent(cm["content"])
										if role != "" && text != "" {
											msgs = append(msgs, AgentMsg{Role: role, Content: text, Model: modelName})
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}

	if len(msgs) == 0 {
		var jsonData interface{}
		if json.Unmarshal(data, &jsonData) == nil {
			if arr, ok := jsonData.([]interface{}); ok {
				for _, item := range arr {
					if m, ok := item.(map[string]interface{}); ok {
						role := getStringField(m, "role")
						c := getStringField(m, "content")
						if role == "" {
							typ := getStringField(m, "type")
							if typ == "human" {
								role = "user"
							} else if typ == "assistant" {
								role = "assistant"
							}
							if msg, ok := m["message"].(map[string]interface{}); ok {
								if cc, ok := msg["content"].(string); ok {
									c = cc
								}
							}
						}
						if role != "" && c != "" {
							msg := AgentMsg{Role: role, Content: c}
							if ts, ok := m["timestamp"].(string); ok {
								msg.Timestamp = ts
							}
							if mdl, ok := m["model"].(string); ok {
								msg.Model = mdl
							}
							msgs = append(msgs, msg)
						}
					}
				}
			} else if m, ok := jsonData.(map[string]interface{}); ok {
				if chatMsgs, ok := m["messages"].([]interface{}); ok {
					for _, item := range chatMsgs {
						if cm, ok := item.(map[string]interface{}); ok {
							role := getStringField(cm, "role")
							c := getStringField(cm, "content")
							if role != "" {
								msgs = append(msgs, AgentMsg{Role: role, Content: c})
							}
						}
					}
				}
			}
		}
	}

	if len(msgs) == 0 {
		content := string(data)
		if strings.Contains(content, "Human:") || strings.Contains(content, "Assistant:") {
			lines := strings.Split(content, "\n")
			var curRole string
			var curContent strings.Builder
			for _, line := range lines {
				trimmed := strings.TrimSpace(line)
				if strings.HasPrefix(trimmed, "Human:") || strings.HasPrefix(trimmed, "User:") {
					if curRole != "" {
						msgs = append(msgs, AgentMsg{Role: curRole, Content: curContent.String()})
					}
					curRole = "user"
					curContent.Reset()
					curContent.WriteString(strings.TrimPrefix(trimmed, "Human:"))
					curContent.WriteString(strings.TrimPrefix(trimmed, "User:"))
				} else if strings.HasPrefix(trimmed, "Assistant:") {
					if curRole != "" {
						msgs = append(msgs, AgentMsg{Role: curRole, Content: curContent.String()})
					}
					curRole = "assistant"
					curContent.Reset()
					curContent.WriteString(strings.TrimPrefix(trimmed, "Assistant:"))
				} else if curRole != "" {
					curContent.WriteString("\n" + line)
				}
			}
			if curRole != "" {
				msgs = append(msgs, AgentMsg{Role: curRole, Content: curContent.String()})
			}
		}
	}

	return msgs
}

func getStringField(m map[string]interface{}, key string) string {
	v, _ := m[key].(string)
	return v
}

func (p *ProxyServer) setupAgentSecurityRoutes(api *mux.Router) {
	api.HandleFunc("/agent/list", p.handleAgentList).Methods("GET")
	api.HandleFunc("/agent/logs/parse", p.handleAgentLogsParse).Methods("POST")
	api.HandleFunc("/agent/runtime-events", p.handleAgentRuntimeEvents).Methods("GET")
	log.Printf("[SETUP] Agent Security routes registered")
}
