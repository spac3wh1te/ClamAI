package main

import (
	"bufio"
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
)

type DirectionConfig struct {
	Enabled         bool   `json:"enabled"`
	Mode            string `json:"mode"` // "block" or "detect"
	KeywordEnabled  bool   `json:"keyword_enabled"`
	SemanticEnabled bool   `json:"semantic_enabled"`
	VectorEnabled   bool   `json:"vector_enabled"`
}

type SecurityConfig struct {
	Enabled           bool            `json:"enabled"`
	Input             DirectionConfig `json:"input"`
	Output            DirectionConfig `json:"output"`
	Keywords          []string        `json:"keywords"`
	BlockMessage      string          `json:"block_message"`
	SemanticModel     string          `json:"semantic_model"`
	SemanticThreshold float64         `json:"semantic_threshold"`
	SemanticPrompt    string          `json:"semantic_prompt"`
	AutoBanKey        bool            `json:"auto_ban_key"`
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
	secConfig       SecurityConfig
	secConfigMu     sync.Mutex
	compiledRegexps []*regexp.Regexp
	regexpsMu       sync.Mutex
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

func rebuildRegexps(keywords []string) {
	regexpsMu.Lock()
	defer regexpsMu.Unlock()
	compiledRegexps = make([]*regexp.Regexp, 0, len(keywords))
	for _, kw := range keywords {
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
}

func defaultSecurityConfig() SecurityConfig {
	return SecurityConfig{
		Input: DirectionConfig{
			Enabled:         true,
			Mode:            "block",
			KeywordEnabled:  true,
			SemanticEnabled: false,
			VectorEnabled:   false,
		},
		Output: DirectionConfig{
			Enabled:         true,
			Mode:            "block",
			KeywordEnabled:  true,
			SemanticEnabled: false,
			VectorEnabled:   false,
		},
		Keywords:          []string{},
		BlockMessage:      "抱歉，您的内容涉及敏感信息，已被安全策略拦截。",
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

	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		log.Printf("[WARN] dbLoadSecurityConfig: parse error: %v", err)
		return defaultSecurityConfig()
	}

	if cfg.Keywords == nil {
		cfg.Keywords = []string{}
	}
	if cfg.BlockMessage == "" {
		cfg.BlockMessage = "抱歉，您的内容涉及敏感信息，已被安全策略拦截。"
	}

	rebuildRegexps(cfg.Keywords)
	log.Printf("[INFO] dbLoadSecurityConfig: enabled=%v, keywords=%d", cfg.Enabled, len(cfg.Keywords))
	return cfg
}

func dbSaveSecurityConfig(cfg *SecurityConfig) {
	configJSON, _ := json.Marshal(cfg)
	_, err := db.Exec(`INSERT OR REPLACE INTO security_config (id, config_json) VALUES (1, ?)`, string(configJSON))
	if err != nil {
		log.Printf("[ERROR] dbSaveSecurityConfig: %v", err)
	}
	rebuildRegexps(cfg.Keywords)
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
		query += fmt.Sprintf(" WHERE resolved = %d", *resolved)
	}
	db.QueryRow(query).Scan(&total)

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

// ==================== Security Middleware ====================

func (p *ProxyServer) securityMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Internal-Analysis") != "" {
			next.ServeHTTP(w, r)
			return
		}

		secConfigMu.Lock()
		cfg := secConfig
		secConfigMu.Unlock()

		if !cfg.Enabled || !strings.HasPrefix(r.URL.Path, "/v1/") {
			next.ServeHTTP(w, r)
			return
		}

		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}
		r.Body.Close()
		r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

		var reqMap map[string]interface{}
		isStream := false
		json.Unmarshal(bodyBytes, &reqMap)
		if reqMap != nil {
			if s, ok := reqMap["stream"].(bool); ok && s {
				isStream = true
			}
		}

		apiKey := extractAPIKeyFromRequest(r)
		clientIP := getClientIP(r)
		reqModel := getStr(reqMap, "model")
		reqProvider := ""
		if reqModel != "" {
			if idx := strings.Index(reqModel, ":"); idx > 0 {
				reqProvider = reqModel[:idx]
			}
		}
		inputContent := ""
		if reqMap != nil {
			inputContent = extractContentFromRequest(reqMap)
		}

		// ---- Input check ----
		if cfg.Input.Enabled && inputContent != "" {
			if cfg.Input.KeywordEnabled {
				matched, kw := checkKeywordsRegex(inputContent)
				if matched {
					log.Printf("[SECURITY] input keyword %s: keyword=%s", cfg.Input.Mode, kw)
					alert := &SecurityAlert{
						Timestamp: time.Now(), Direction: "input", Mode: cfg.Input.Mode,
						TriggerType: "keyword", TriggerDetail: kw,
						ContentPreview: truncate(inputContent, 200), Model: reqModel,
						APIKeyUsed: maskAPIKey(apiKey), ClientIP: clientIP, Action: cfg.Input.Mode,
					}
					dbInsertAlert(alert)
					if cfg.Input.Mode == "block" {
						dbInsertBlockedLog(reqProvider, reqModel, clientIP, maskAPIKey(apiKey), r.URL.Path, r.Method, string(bodyBytes), fmt.Sprintf("input keyword blocked: %s", kw))
						sendBlockResponse(w, cfg.BlockMessage)
						return
					}
				}
			}
			if cfg.Input.SemanticEnabled && cfg.SemanticModel != "" {
				if cfg.Input.Mode == "block" {
					sr, serr := p.semanticCheck(inputContent, cfg)
					if serr != nil {
						log.Printf("[WARN] input semantic check error: %v", serr)
					} else if sr != nil {
						alerted := getAlertCategories(sr, cfg.SemanticThreshold)
						if len(alerted) > 0 {
							log.Printf("[SECURITY] input semantic block: categories=%v", alerted)
							for _, cat := range alerted {
								cr := sr.Categories[cat]
								alert := &SecurityAlert{
									Timestamp: time.Now(), Direction: "input", Mode: "block",
									TriggerType: "semantic", TriggerDetail: fmt.Sprintf("%s (%.0f%%)", categoryLabel(cat), cr.Confidence*100),
									ContentPreview: truncate(inputContent, 200), Model: reqModel,
									APIKeyUsed: maskAPIKey(apiKey), ClientIP: clientIP, Action: "block",
								}
								dbInsertAlert(alert)
							}
							dbInsertBlockedLog(reqProvider, reqModel, clientIP, maskAPIKey(apiKey), r.URL.Path, r.Method, string(bodyBytes), "input semantic blocked")
							autoAddBlockedSample(truncate(inputContent, 500), "input_semantic")
							sendBlockResponse(w, cfg.BlockMessage)
							return
						}
					}
				} else {
					go p.asyncInputSemanticCheck(inputContent, reqModel, apiKey, clientIP, cfg)
				}
			}
			if cfg.Input.VectorEnabled {
				if cfg.Input.Mode == "block" {
					vr, verr := vectorCheck(inputContent)
					if verr != nil {
						log.Printf("[WARN] input vector check error: %v", verr)
					} else if len(vr) > 0 {
						best := vr[0]
						log.Printf("[SECURITY] input vector block: similarity=%.2f, category=%s", best.Similarity, best.Category)
						alert := &SecurityAlert{
							Timestamp: time.Now(), Direction: "input", Mode: "block",
							TriggerType: "vector", TriggerDetail: fmt.Sprintf("相似度 %.0f%% (%s)", best.Similarity*100, best.Category),
							ContentPreview: truncate(inputContent, 200), Model: reqModel,
							APIKeyUsed: maskAPIKey(apiKey), ClientIP: clientIP, Action: "block",
						}
						dbInsertAlert(alert)
						dbInsertBlockedLog(reqProvider, reqModel, clientIP, maskAPIKey(apiKey), r.URL.Path, r.Method, string(bodyBytes), "input vector blocked")
						autoAddBlockedSample(truncate(inputContent, 500), "input_vector")
						sendBlockResponse(w, cfg.BlockMessage)
						return
					}
				} else {
					go p.asyncInputVectorCheck(inputContent, reqModel, apiKey, clientIP)
				}
			}
		}

		// ---- Output check ----
		if cfg.Output.Enabled {
			if cfg.Output.Mode == "detect" {
				if !isStream {
					bw := newBufferedResponseWriter(0)
					next.ServeHTTP(bw, r)
					for k, vs := range bw.Header() {
						for _, v := range vs {
							w.Header().Add(k, v)
						}
					}
					w.WriteHeader(bw.statusCode)
					w.Write(bw.Bytes())
					if bw.statusCode == http.StatusOK && bw.Len() > 0 && (cfg.Output.KeywordEnabled || cfg.Output.SemanticEnabled || cfg.Output.VectorEnabled) {
						var resp map[string]interface{}
						if json.Unmarshal(bw.Bytes(), &resp) == nil {
							outputContent := extractContentFromResponse(resp)
							if outputContent != "" {
								go p.asyncOutputCheck(outputContent, reqModel, apiKey, clientIP, cfg)
								if cfg.Output.VectorEnabled {
									go p.asyncOutputVectorCheck(outputContent, reqModel, apiKey, clientIP)
								}
							}
						}
					}
					bw.Release()
				} else {
					next.ServeHTTP(w, r)
				}
				return
			}

			// Block mode
			if !isStream {
				bw := newBufferedResponseWriter(0)
				next.ServeHTTP(bw, r)
				defer bw.Release()
				if bw.statusCode == http.StatusOK && bw.Len() > 0 {
					// overflow = response exceeded buffer limit, fail-open
					if bw.overflowed {
						log.Printf("[WARN] output block: response exceeded buffer limit (%d bytes), fail-open", bw.Len())
						for k, vs := range bw.Header() {
							for _, v := range vs {
								w.Header().Add(k, v)
							}
						}
						w.WriteHeader(bw.statusCode)
						w.Write(bw.Bytes())
						return
					}
					var resp map[string]interface{}
					if json.Unmarshal(bw.Bytes(), &resp) == nil {
						outputContent := extractContentFromResponse(resp)
						if outputContent != "" {
							blocked := false
							if cfg.Output.KeywordEnabled {
								matched, kw := checkKeywordsRegex(outputContent)
								if matched {
									log.Printf("[SECURITY] output keyword block: keyword=%s", kw)
									alert := &SecurityAlert{
										Timestamp: time.Now(), Direction: "output", Mode: "block",
										TriggerType: "keyword", TriggerDetail: kw,
										ContentPreview: truncate(outputContent, 200), Model: reqModel,
										APIKeyUsed: maskAPIKey(apiKey), ClientIP: clientIP, Action: "replace",
									}
									dbInsertAlert(alert)
									w.Header().Set("Content-Type", "application/json")
									w.Header().Set("X-Security-Block", "output")
									json.NewEncoder(w).Encode(buildBlockChatResponse(cfg.BlockMessage, resp))
									blocked = true
								}
							}
							if !blocked && cfg.Output.SemanticEnabled && cfg.SemanticModel != "" {
								sr, serr := p.semanticCheck(outputContent, cfg)
								if serr == nil && sr != nil {
									alerted := getAlertCategories(sr, cfg.SemanticThreshold)
									if len(alerted) > 0 {
										log.Printf("[SECURITY] output semantic block: categories=%v", alerted)
										for _, cat := range alerted {
											cr := sr.Categories[cat]
											alert := &SecurityAlert{
												Timestamp: time.Now(), Direction: "output", Mode: "block",
												TriggerType: "semantic", TriggerDetail: fmt.Sprintf("%s (%.0f%%)", categoryLabel(cat), cr.Confidence*100),
												ContentPreview: truncate(outputContent, 200), Model: reqModel,
												APIKeyUsed: maskAPIKey(apiKey), ClientIP: clientIP, Action: "replace",
											}
											dbInsertAlert(alert)
										}
										autoAddBlockedSample(truncate(outputContent, 500), "output_semantic")
										w.Header().Set("Content-Type", "application/json")
										w.Header().Set("X-Security-Block", "output")
										json.NewEncoder(w).Encode(buildBlockChatResponse(cfg.BlockMessage, resp))
										blocked = true
									}
								}
							}
							if !blocked && cfg.Output.VectorEnabled {
								vr, verr := vectorCheck(outputContent)
								if verr != nil {
									log.Printf("[WARN] output vector check error: %v", verr)
								} else if len(vr) > 0 {
									best := vr[0]
									log.Printf("[SECURITY] output vector block: similarity=%.2f, category=%s", best.Similarity, best.Category)
									alert := &SecurityAlert{
										Timestamp: time.Now(), Direction: "output", Mode: "block",
										TriggerType: "vector", TriggerDetail: fmt.Sprintf("相似度 %.0f%% (%s)", best.Similarity*100, best.Category),
										ContentPreview: truncate(outputContent, 200), Model: reqModel,
										APIKeyUsed: maskAPIKey(apiKey), ClientIP: clientIP, Action: "replace",
									}
									dbInsertAlert(alert)
									autoAddBlockedSample(truncate(outputContent, 500), "output_vector")
									w.Header().Set("Content-Type", "application/json")
									w.Header().Set("X-Security-Block", "output")
									json.NewEncoder(w).Encode(buildBlockChatResponse(cfg.BlockMessage, resp))
									blocked = true
								}
							}
							if !blocked {
								for k, vs := range bw.Header() {
									for _, v := range vs {
										w.Header().Add(k, v)
									}
								}
								w.WriteHeader(bw.statusCode)
								w.Write(bw.Bytes())
							}
							return
						}
					}
				}
				for k, vs := range bw.Header() {
					for _, v := range vs {
						w.Header().Add(k, v)
					}
				}
				w.WriteHeader(bw.statusCode)
				w.Write(bw.Bytes())
				return
			}

			// Block mode + stream: use sliding window for keywords
			sw := newSlidingWindowWriter(w, cfg, reqModel, maskAPIKey(apiKey), clientIP)
			next.ServeHTTP(sw, r)
			// After stream completes, do async semantic check on accumulated content if needed
			if cfg.Output.SemanticEnabled && cfg.SemanticModel != "" && !sw.aborted {
				accumulated := sw.GetAccumulated()
				if accumulated != "" {
					go p.asyncOutputCheck(accumulated, reqModel, apiKey, clientIP, cfg)
				}
			}
			if cfg.Output.VectorEnabled && !sw.aborted {
				accumulated := sw.GetAccumulated()
				if accumulated != "" {
					go p.asyncOutputVectorCheck(accumulated, reqModel, apiKey, clientIP)
				}
			}
			return
		}

		next.ServeHTTP(w, r)
	})
}

// ==================== Async Checks ====================

func (p *ProxyServer) asyncInputSemanticCheck(content, model, apiKey, clientIP string, cfg SecurityConfig) {
	sr, err := p.semanticCheck(content, cfg)
	if err != nil {
		log.Printf("[WARN] async input semantic: %v", err)
		return
	}
	if sr == nil {
		return
	}
	alerted := getAlertCategories(sr, cfg.SemanticThreshold)
	if len(alerted) == 0 {
		return
	}
	log.Printf("[SECURITY] async input semantic alert: categories=%v", alerted)
	for _, cat := range alerted {
		cr := sr.Categories[cat]
		alert := &SecurityAlert{
			Timestamp: time.Now(), Direction: "input", Mode: "detect",
			TriggerType: "semantic", TriggerDetail: fmt.Sprintf("%s (%.0f%%)", categoryLabel(cat), cr.Confidence*100),
			ContentPreview: truncate(content, 200), Model: model,
			APIKeyUsed: maskAPIKey(apiKey), ClientIP: clientIP, Action: "alert",
		}
		dbInsertAlert(alert)
	}
}

func (p *ProxyServer) asyncOutputCheck(content, model, apiKey, clientIP string, cfg SecurityConfig) {
	if cfg.Output.KeywordEnabled {
		matched, kw := checkKeywordsRegex(content)
		if matched {
			log.Printf("[SECURITY] async output keyword detect: keyword=%s", kw)
			alert := &SecurityAlert{
				Timestamp: time.Now(), Direction: "output", Mode: "detect",
				TriggerType: "keyword", TriggerDetail: kw,
				ContentPreview: truncate(content, 200), Model: model,
				APIKeyUsed: maskAPIKey(apiKey), ClientIP: clientIP, Action: "alert",
			}
			dbInsertAlert(alert)
		}
	}
	if cfg.Output.SemanticEnabled && cfg.SemanticModel != "" {
		sr, err := p.semanticCheck(content, cfg)
		if err != nil {
			log.Printf("[WARN] async output semantic: %v", err)
			return
		}
		if sr == nil {
			return
		}
		alerted := getAlertCategories(sr, cfg.SemanticThreshold)
		if len(alerted) == 0 {
			return
		}
		log.Printf("[SECURITY] async output semantic alert: categories=%v", alerted)
		for _, cat := range alerted {
			cr := sr.Categories[cat]
			alert := &SecurityAlert{
				Timestamp: time.Now(), Direction: "output", Mode: "detect",
				TriggerType: "semantic", TriggerDetail: fmt.Sprintf("%s (%.0f%%)", categoryLabel(cat), cr.Confidence*100),
				ContentPreview: truncate(content, 200), Model: model,
				APIKeyUsed: maskAPIKey(apiKey), ClientIP: clientIP, Action: "alert",
			}
			dbInsertAlert(alert)
		}
		if cfg.AutoBanKey && apiKey != "" {
			if banAPIKey(apiKey) {
				log.Printf("[SECURITY] auto-banned key %s", maskAPIKey(apiKey))
			}
		}
	}
}

func (p *ProxyServer) asyncInputVectorCheck(content, model, apiKey, clientIP string) {
	results, err := vectorCheck(content)
	if err != nil {
		log.Printf("[WARN] async input vector: %v", err)
		return
	}
	if len(results) == 0 {
		return
	}
	best := results[0]
	log.Printf("[SECURITY] async input vector alert: similarity=%.2f, category=%s", best.Similarity, best.Category)
	alert := &SecurityAlert{
		Timestamp: time.Now(), Direction: "input", Mode: "detect",
		TriggerType: "vector", TriggerDetail: fmt.Sprintf("相似度 %.0f%% (%s)", best.Similarity*100, best.Category),
		ContentPreview: truncate(content, 200), Model: model,
		APIKeyUsed: maskAPIKey(apiKey), ClientIP: clientIP, Action: "alert",
	}
	dbInsertAlert(alert)
	autoAddBlockedSample(truncate(content, 500), "input_vector")
}

func (p *ProxyServer) asyncOutputVectorCheck(content, model, apiKey, clientIP string) {
	results, err := vectorCheck(content)
	if err != nil {
		log.Printf("[WARN] async output vector: %v", err)
		return
	}
	if len(results) == 0 {
		return
	}
	best := results[0]
	log.Printf("[SECURITY] async output vector alert: similarity=%.2f, category=%s", best.Similarity, best.Category)
	alert := &SecurityAlert{
		Timestamp: time.Now(), Direction: "output", Mode: "detect",
		TriggerType: "vector", TriggerDetail: fmt.Sprintf("相似度 %.0f%% (%s)", best.Similarity*100, best.Category),
		ContentPreview: truncate(content, 200), Model: model,
		APIKeyUsed: maskAPIKey(apiKey), ClientIP: clientIP, Action: "alert",
	}
	dbInsertAlert(alert)
	autoAddBlockedSample(truncate(content, 500), "output_vector")
}

// ==================== Stream/Buffer Writers ====================

const defaultMaxBufferSize = 64 * 1024 // 64KB

var bufferPool = sync.Pool{
	New: func() interface{} {
		buf := bytes.NewBuffer(make([]byte, 0, 32*1024))
		return buf
	},
}

func getBuffer() *bytes.Buffer {
	buf := bufferPool.Get().(*bytes.Buffer)
	buf.Reset()
	return buf
}

func putBuffer(buf *bytes.Buffer) {
	if buf.Cap() <= 256*1024 {
		bufferPool.Put(buf)
	}
}

type bufferedResponseWriter struct {
	header       http.Header
	statusCode   int
	body         *bytes.Buffer
	maxBufSize   int
	overflowed   bool
	overflowBody []byte
}

func newBufferedResponseWriter(maxSize int) *bufferedResponseWriter {
	if maxSize <= 0 {
		maxSize = defaultMaxBufferSize
	}
	return &bufferedResponseWriter{
		statusCode: http.StatusOK,
		body:       getBuffer(),
		maxBufSize: maxSize,
	}
}

func (w *bufferedResponseWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}
func (w *bufferedResponseWriter) Write(b []byte) (int, error) {
	if w.statusCode == 0 {
		w.statusCode = http.StatusOK
	}
	if w.overflowed {
		w.overflowBody = append(w.overflowBody, b...)
		return len(b), nil
	}
	if w.body.Len()+len(b) > w.maxBufSize {
		w.overflowed = true
		w.overflowBody = append(w.body.Bytes(), b...)
		putBuffer(w.body)
		w.body = nil
		return len(b), nil
	}
	return w.body.Write(b)
}
func (w *bufferedResponseWriter) WriteHeader(code int) { w.statusCode = code }

func (w *bufferedResponseWriter) Bytes() []byte {
	if w.overflowed {
		return w.overflowBody
	}
	return w.body.Bytes()
}

func (w *bufferedResponseWriter) Len() int {
	if w.overflowed {
		return len(w.overflowBody)
	}
	return w.body.Len()
}

func (w *bufferedResponseWriter) Release() {
	if w.body != nil {
		putBuffer(w.body)
		w.body = nil
	}
	w.overflowBody = nil
}

type slidingWindowWriter struct {
	http.ResponseWriter
	wroteHeader bool
	cfg         SecurityConfig
	reqModel    string
	apiKey      string
	clientIP    string
	window      []byte
	windowSize  int
	aborted     bool
	accumulated strings.Builder
}

const defaultSlidingWindowSize = 4096

func newSlidingWindowWriter(w http.ResponseWriter, cfg SecurityConfig, reqModel, apiKey, clientIP string) *slidingWindowWriter {
	return &slidingWindowWriter{
		ResponseWriter: w,
		cfg:            cfg,
		reqModel:       reqModel,
		apiKey:         apiKey,
		clientIP:       clientIP,
		windowSize:     defaultSlidingWindowSize,
	}
}

func (w *slidingWindowWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.wroteHeader = true
		w.ResponseWriter.WriteHeader(http.StatusOK)
	}
	if w.aborted {
		return len(b), nil
	}

	text := extractStreamText(b)
	if text != "" {
		w.accumulated.WriteString(text)
	}

	if w.cfg.Output.KeywordEnabled && !w.aborted {
		checkText := text
		if len(w.window) > 0 {
			combined := string(w.window) + text
			checkText = combined
		}
		if checkText != "" {
			matched, kw := checkKeywordsRegex(checkText)
			if matched {
				log.Printf("[SECURITY] stream output keyword block: keyword=%s", kw)
				alert := &SecurityAlert{
					Timestamp: time.Now(), Direction: "output", Mode: "block",
					TriggerType: "keyword", TriggerDetail: kw,
					ContentPreview: truncate(text, 200), Model: w.reqModel,
					APIKeyUsed: w.apiKey, ClientIP: w.clientIP, Action: "abort",
				}
				dbInsertAlert(alert)
				abortMsg := fmt.Sprintf("data: {\"error\":{\"message\":\"%s\",\"type\":\"content_policy_violation\"}}\n\n", w.cfg.BlockMessage)
				w.ResponseWriter.Write([]byte(abortMsg))
				w.ResponseWriter.Write([]byte("data: [DONE]\n\n"))
				if f, ok := w.ResponseWriter.(http.Flusher); ok {
					f.Flush()
				}
				w.aborted = true
				return len(b), nil
			}
		}

		if len(text) > 0 {
			newWindow := append(w.window, []byte(text)...)
			if len(newWindow) > w.windowSize {
				newWindow = newWindow[len(newWindow)-w.windowSize:]
			}
			w.window = newWindow
		}
	}
	return w.ResponseWriter.Write(b)
}

func (w *slidingWindowWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
func (w *slidingWindowWriter) WriteHeader(code int) {
	if !w.wroteHeader {
		w.wroteHeader = true
		w.ResponseWriter.WriteHeader(code)
	}
}
func (w *slidingWindowWriter) GetAccumulated() string {
	return w.accumulated.String()
}

func extractStreamText(data []byte) string {
	var result strings.Builder
	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		if payload == "[DONE]" {
			continue
		}
		var chunk map[string]interface{}
		if json.Unmarshal([]byte(payload), &chunk) != nil {
			continue
		}
		choices, ok := chunk["choices"].([]interface{})
		if !ok || len(choices) == 0 {
			continue
		}
		choice, ok := choices[0].(map[string]interface{})
		if !ok {
			continue
		}
		delta, ok := choice["delta"].(map[string]interface{})
		if !ok {
			continue
		}
		if c, ok := delta["content"].(string); ok {
			result.WriteString(c)
		}
	}
	return result.String()
}

// ==================== Keyword Matching ====================

func checkKeywordsRegex(content string) (bool, string) {
	regexpsMu.Lock()
	regexps := compiledRegexps
	regexpsMu.Unlock()
	for _, re := range regexps {
		if re.MatchString(content) {
			return true, re.String()
		}
	}
	return false, ""
}

// ==================== Semantic Check ====================

type CategoryResult struct {
	Detected   bool    `json:"d"`
	Confidence float64 `json:"c"`
}

type SemanticCheckResult struct {
	Categories map[string]CategoryResult
}

func banAPIKey(fullKey string) bool {
	apiKeysMu.Lock()
	defer apiKeysMu.Unlock()
	info, exists := apiKeys[fullKey]
	if !exists {
		return false
	}
	info.Active = false
	dbSaveAPIKey(info)
	log.Printf("[INFO] banAPIKey: deactivated key id=%s", info.ID)
	return true
}

func (p *ProxyServer) semanticCheck(content string, cfg SecurityConfig) (*SemanticCheckResult, error) {
	provider, modelName := p.resolveProvider(cfg.SemanticModel)
	if provider == nil {
		return nil, fmt.Errorf("no provider for semantic model: %s", cfg.SemanticModel)
	}

	systemPrompt := cfg.SemanticPrompt
	if systemPrompt == "" {
		systemPrompt = defaultSemanticSystemPrompt
	}

	checkReq := map[string]interface{}{
		"model": modelName,
		"messages": []map[string]interface{}{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": content},
		},
		"max_tokens":      200,
		"temperature":     0.0,
		"response_format": map[string]interface{}{"type": "json_object"},
	}

	body, _ := json.Marshal(checkReq)
	client := &http.Client{Timeout: 15 * time.Second}
	reqURL := provider.GetBaseURL() + "/v1/chat/completions"
	httpReq, _ := http.NewRequest("POST", reqURL, bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+provider.GetAPIKey())

	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var respData map[string]interface{}
	if json.Unmarshal(respBody, &respData) != nil {
		return nil, nil
	}
	choices, ok := respData["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return nil, nil
	}
	choice, ok := choices[0].(map[string]interface{})
	if !ok {
		return nil, nil
	}
	msg, ok := choice["message"].(map[string]interface{})
	if !ok {
		return nil, nil
	}
	msgContent, ok := msg["content"].(string)
	if !ok || msgContent == "" {
		return nil, nil
	}

	parsed := extractJSON(msgContent)
	if parsed == nil {
		log.Printf("[WARN] semanticCheck: failed to extract JSON: %s", truncate(msgContent, 200))
		return nil, nil
	}

	result := &SemanticCheckResult{Categories: make(map[string]CategoryResult)}
	for _, cat := range securityCategories {
		cr := CategoryResult{}
		if catObj, ok := parsed[cat].(map[string]interface{}); ok {
			if d, ok := catObj["d"].(bool); ok {
				cr.Detected = d
			}
			if c, ok := catObj["c"].(float64); ok {
				cr.Confidence = c
			}
		}
		result.Categories[cat] = cr
	}
	return result, nil
}

func extractJSON(s string) map[string]interface{} {
	var result map[string]interface{}
	if json.Unmarshal([]byte(s), &result) == nil {
		return result
	}
	re := regexp.MustCompile("(?s)```(?:json)?\\s*\\n?(\\{.*?\\})\\s*```")
	if matches := re.FindStringSubmatch(s); len(matches) > 1 {
		if json.Unmarshal([]byte(matches[1]), &result) == nil {
			return result
		}
	}
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start >= 0 && end > start {
		candidate := s[start : end+1]
		if json.Unmarshal([]byte(candidate), &result) == nil {
			return result
		}
		cleaned := regexp.MustCompile(`,\s*([}\]])`).ReplaceAllString(candidate, "$1")
		if json.Unmarshal([]byte(cleaned), &result) == nil {
			return result
		}
	}
	return nil
}

func getAlertCategories(sr *SemanticCheckResult, threshold float64) []string {
	var triggered []string
	for _, cat := range securityCategories {
		if cr, ok := sr.Categories[cat]; ok && cr.Detected && cr.Confidence >= threshold {
			triggered = append(triggered, cat)
		}
	}
	return triggered
}

func categoryLabel(cat string) string {
	switch cat {
	case "sensitive_data":
		return "敏感数据"
	case "pornography":
		return "涉黄"
	case "violence":
		return "涉暴"
	case "politics":
		return "涉政"
	case "terrorism":
		return "涉恐"
	case "vector":
		return "向量检测"
	default:
		return cat
	}
}

// ==================== Content Extraction ====================

func extractContentFromRequest(req map[string]interface{}) string {
	msgs, ok := req["messages"].([]interface{})
	if !ok {
		return ""
	}
	var parts []string
	for _, m := range msgs {
		msg, ok := m.(map[string]interface{})
		if !ok {
			continue
		}
		if c, ok := msg["content"].(string); ok && c != "" {
			parts = append(parts, c)
		}
		if arr, ok := msg["content"].([]interface{}); ok {
			for _, item := range arr {
				if part, ok := item.(map[string]interface{}); ok {
					if t, _ := part["type"].(string); t == "text" {
						if text, ok := part["text"].(string); ok && text != "" {
							parts = append(parts, text)
						}
					}
				}
			}
		}
	}
	return strings.Join(parts, " ")
}

func extractContentFromResponse(resp map[string]interface{}) string {
	choices, ok := resp["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return ""
	}
	choice, ok := choices[0].(map[string]interface{})
	if !ok {
		return ""
	}
	msg, ok := choice["message"].(map[string]interface{})
	if !ok {
		return ""
	}
	var parts []string
	if c, ok := msg["content"].(string); ok && c != "" {
		parts = append(parts, c)
	}
	if rc, ok := msg["reasoning_content"].(string); ok && rc != "" {
		parts = append(parts, rc)
	}
	return strings.Join(parts, " ")
}

// ==================== Response Helpers ====================

func sendBlockResponse(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Security-Block", "input")
	w.WriteHeader(http.StatusForbidden)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]interface{}{
			"message": message,
			"type":    "content_policy_violation",
			"code":    "blocked_by_security_policy",
		},
	})
}

func buildBlockChatResponse(message string, origResp map[string]interface{}) map[string]interface{} {
	modelName, _ := origResp["model"].(string)
	return map[string]interface{}{
		"id": fmt.Sprintf("sec-%d", time.Now().UnixMilli()), "object": "chat.completion",
		"created": time.Now().Unix(), "model": modelName,
		"choices": []map[string]interface{}{
			{"index": 0, "message": map[string]interface{}{"role": "assistant", "content": message}, "finish_reason": "stop"},
		},
		"usage": map[string]interface{}{"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
	}
}

func truncate(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen]) + "..."
}

func getStr(m map[string]interface{}, k string) string {
	v, _ := m[k].(string)
	return v
}

// ==================== HTTP Handlers ====================

func (p *ProxyServer) setupSecurityRoutes(api *mux.Router) {
	api.HandleFunc("/security/config", p.handleGetSecurityConfig).Methods("GET")
	api.HandleFunc("/security/config", p.handleUpdateSecurityConfig).Methods("PUT")
	api.HandleFunc("/security/alerts", p.handleGetSecurityAlerts).Methods("GET")
	api.HandleFunc("/security/alerts/{id}/resolve", p.handleResolveAlert).Methods("PUT")
}

func (p *ProxyServer) handleGetSecurityConfig(w http.ResponseWriter, r *http.Request) {
	secConfigMu.Lock()
	cfg := secConfig
	secConfigMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg)
}

func (p *ProxyServer) handleUpdateSecurityConfig(w http.ResponseWriter, r *http.Request) {
	var cfg SecurityConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if cfg.Keywords == nil {
		cfg.Keywords = []string{}
	}
	if cfg.BlockMessage == "" {
		cfg.BlockMessage = "抱歉，您的内容涉及敏感信息，已被安全策略拦截。"
	}
	secConfigMu.Lock()
	secConfig = cfg
	secConfigMu.Unlock()
	dbSaveSecurityConfig(&cfg)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func (p *ProxyServer) handleGetSecurityAlerts(w http.ResponseWriter, r *http.Request) {
	limit := 50
	offset := 0
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 {
		limit = l
	}
	if o, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && o >= 0 {
		offset = o
	}
	var resolved *int
	if rv := r.URL.Query().Get("resolved"); rv == "0" || rv == "1" {
		v := int(rv[0] - '0')
		resolved = &v
	}
	alerts, total := dbGetAlerts(limit, offset, resolved)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"alerts": alerts, "total": total})
}

func (p *ProxyServer) handleResolveAlert(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	db.Exec("UPDATE security_alerts SET resolved = 1 WHERE id = ?", id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
