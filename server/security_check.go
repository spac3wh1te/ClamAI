package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/bytedance/sonic"
)

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
		if sonic.Unmarshal([]byte(payload), &chunk) != nil {
			continue
		}
		if choices, ok := chunk["choices"].([]interface{}); ok && len(choices) > 0 {
			if choice, ok := choices[0].(map[string]interface{}); ok {
				if delta, ok := choice["delta"].(map[string]interface{}); ok {
					if c, ok := delta["content"].(string); ok {
						result.WriteString(c)
					}
				}
			}
		} else if delta, ok := chunk["delta"].(map[string]interface{}); ok {
			if text, ok := delta["text"].(string); ok {
				result.WriteString(text)
			}
		}
	}
	return result.String()
}

func normalizeContent(content string) string {
	var buf strings.Builder
	buf.Grow(len(content))
	for _, ch := range content {
		if ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch > 127 {
			buf.WriteRune(ch)
		}
	}
	return buf.String()
}

func checkKeywords(content string) (bool, string, string, string) {
	acBuildMu.Lock()
	hasAC := len(acMatchers) > 0
	matcherMap := acMatchers
	dictMap := acDicts
	levelIdxMap := acLevelForIdx
	whitelistMatcher := keywordWhitelistMatcher
	acBuildMu.Unlock()

	if hasAC {
		normalized := normalizeContent(content)
		for cat, matcher := range matcherMap {
			dict := dictMap[cat]
			levels := levelIdxMap[cat]
			hits := matcher.Match([]byte(normalized))
			if len(hits) > 0 {
				if whitelistMatcher != nil && len(whitelistMatcher.Match([]byte(normalized))) > 0 {
					return false, "", "", ""
				}
				idx := hits[0]
				kw := dict[idx]
				level := "high"
				if idx < len(levels) {
					level = levels[idx]
				}
				return true, cat, level, kw
			}
		}
		return false, "", "", ""
	}

	regexpsMu.Lock()
	regexps := compiledRegexps
	regexpsMu.Unlock()
	for _, re := range regexps {
		if re.MatchString(content) {
			normalized := normalizeContent(content)
			if whitelistMatcher != nil && len(whitelistMatcher.Match([]byte(normalized))) > 0 {
				return false, "", "", ""
			}
			return true, "sensitive_data", "high", re.String()
		}
	}
	return false, "", "", ""
}

func checkKeywordsRegex(content string) (bool, string) {
	matched, _, _, kw := checkKeywords(content)
	return matched, kw
}

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
	provider, _ := p.resolveProvider(cfg.SemanticModel)
	if provider == nil {
		return nil, fmt.Errorf("no provider for semantic model: %s", cfg.SemanticModel)
	}

	systemPrompt := cfg.SemanticPrompt
	if systemPrompt == "" {
		systemPrompt = defaultSemanticSystemPrompt
	}

	messages := []map[string]interface{}{
		{"role": "system", "content": systemPrompt},
		{"role": "user", "content": content},
	}

	statusCode, _, _, respBody, err := p.internalChatCompletion(cfg.SemanticModel, messages, 0.0, 200)
	if err != nil {
		return nil, err
	}

	var respData map[string]interface{}
	if sonic.Unmarshal(respBody, &respData) != nil {
		return nil, nil
	}

	if statusCode < 200 || statusCode >= 300 {
		log.Printf("[WARN] semanticCheck: non-success status %d", statusCode)
		return nil, nil
	}

	msgContent := extractContentFromResp(respData)
	if msgContent == "" {
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

func extractTokensFromSecurityResp(respData map[string]interface{}) (int, int) {
	inTok, outTok := 0, 0
	if usage, ok := respData["usage"].(map[string]interface{}); ok {
		if pt, ok := usage["prompt_tokens"].(float64); ok {
			inTok = int(pt)
		} else if pt, ok := usage["input_tokens"].(float64); ok {
			inTok = int(pt)
		}
		if ct, ok := usage["completion_tokens"].(float64); ok {
			outTok = int(ct)
		} else if ct, ok := usage["output_tokens"].(float64); ok {
			outTok = int(ct)
		}
	}
	return inTok, outTok
}

func extractJSON(s string) map[string]interface{} {
	var result map[string]interface{}
	if sonic.Unmarshal([]byte(s), &result) == nil {
		return result
	}
	re := regexp.MustCompile("(?s)```(?:json)?\\s*\\n?(\\{.*?\\})\\s*```")
	if matches := re.FindStringSubmatch(s); len(matches) > 1 {
		if sonic.Unmarshal([]byte(matches[1]), &result) == nil {
			return result
		}
	}
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start >= 0 && end > start {
		candidate := s[start : end+1]
		if sonic.Unmarshal([]byte(candidate), &result) == nil {
			return result
		}
		cleaned := regexp.MustCompile(`,\s*([}\]])`).ReplaceAllString(candidate, "$1")
		if sonic.Unmarshal([]byte(cleaned), &result) == nil {
			return result
		}
	}
	return nil
}

func extractContentFromResp(respData map[string]interface{}) string {
	if choices, ok := respData["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if msg, ok := choice["message"].(map[string]interface{}); ok {
				if c, ok := msg["content"].(string); ok {
					return c
				}
			}
		}
	}
	if contentArr, ok := respData["content"].([]interface{}); ok && len(contentArr) > 0 {
		var texts []string
		for _, item := range contentArr {
			if block, ok := item.(map[string]interface{}); ok {
				if t, ok := block["text"].(string); ok && t != "" {
					texts = append(texts, t)
				}
			}
		}
		return strings.Join(texts, "\n")
	}
	return ""
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
	var parts []string
	if choices, ok := resp["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if msg, ok := choice["message"].(map[string]interface{}); ok {
				if c, ok := msg["content"].(string); ok && c != "" {
					parts = append(parts, c)
				}
				if rc, ok := msg["reasoning_content"].(string); ok && rc != "" {
					parts = append(parts, rc)
				}
			}
		}
	}
	if contentArr, ok := resp["content"].([]interface{}); ok && len(contentArr) > 0 {
		for _, item := range contentArr {
			if block, ok := item.(map[string]interface{}); ok {
				if t, _ := block["type"].(string); t == "text" {
					if text, ok := block["text"].(string); ok && text != "" {
						parts = append(parts, text)
					}
				}
			}
		}
	}
	return strings.Join(parts, " ")
}

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
