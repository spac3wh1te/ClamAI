package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

func (p *ProxyServer) handleProxyTest(w http.ResponseWriter, r *http.Request) {
	proxyURL := r.URL.Query().Get("url")
	if proxyURL == "" {
		proxyURL = getGlobalConfig().ProxyURL
	}
	ok, msg := testProxyConnectivity(proxyURL)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": ok,
		"message": msg,
	})
}

func (p *ProxyServer) handleProxyTestChat(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Mode         string `json:"mode"`
		BaseURL      string `json:"baseUrl"`
		APIKey       string `json:"apiKey"`
		Model        string `json:"model"`
		Message      string `json:"message"`
		ProviderType string `json:"providerType"`
		ProviderID   string `json:"providerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	log.Printf("[DEBUG] handleProxyTestChat: mode=%s, model=%s, providerID=%s", req.Mode, req.Model, req.ProviderID)

	if req.Mode == "proxy" {
		p.handleProxyModeTestChat(w, req)
	} else {
		p.handleDirectModeTestChat(w, req)
	}
}

func (p *ProxyServer) handleProxyModeTestChat(w http.ResponseWriter, req struct {
	Mode         string `json:"mode"`
	BaseURL      string `json:"baseUrl"`
	APIKey       string `json:"apiKey"`
	Model        string `json:"model"`
	Message      string `json:"message"`
	ProviderType string `json:"providerType"`
	ProviderID   string `json:"providerId"`
}) {
	if req.APIKey == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false, "message": "请选择ClamAI API密钥", "latency_ms": 0, "input_tokens": 0, "output_tokens": 0,
		})
		return
	}
	if req.Model == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false, "message": "请选择模型", "latency_ms": 0, "input_tokens": 0, "output_tokens": 0,
		})
		return
	}

	providerName := ""
	modelName := req.Model
	if idx := strings.Index(modelName, ":"); idx >= 0 {
		providerName = modelName[:idx]
		modelName = modelName[idx+1:]
	}
	if providerName == "" {
		providerName = req.ProviderType
	}

	var spec *ProviderRouteSpec
	for i := range p.providerRoutes {
		if p.providerRoutes[i].Name == providerName {
			spec = &p.providerRoutes[i]
			break
		}
	}
	if spec == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false, "message": fmt.Sprintf("未找到提供商路由: %s", providerName), "latency_ms": 0, "input_tokens": 0, "output_tokens": 0,
		})
		return
	}

	scheme := "http"
	if p.useTLS {
		scheme = "https"
	}

	var bodyBytes []byte
	var url string

	if spec.AuthType == "x-api-key" {
		anthropicReq := map[string]interface{}{
			"model":      modelName,
			"max_tokens": 256,
			"stream":     false,
			"messages": []map[string]interface{}{
				{"role": "user", "content": req.Message},
			},
		}
		bodyBytes, _ = json.Marshal(anthropicReq)
		url = fmt.Sprintf("%s://%s%s/messages", scheme, p.proxyAddr, spec.PathPrefix)
	} else {
		openaiReq := map[string]interface{}{
			"model": modelName,
			"messages": []map[string]interface{}{
				{"role": "user", "content": req.Message},
			},
			"max_tokens": 256,
			"stream":     false,
		}
		bodyBytes, _ = json.Marshal(openaiReq)
		url = fmt.Sprintf("%s://%s%s/chat/completions", scheme, p.proxyAddr, spec.PathPrefix)
	}

	httpReq, err := http.NewRequest("POST", url, bytes.NewReader(bodyBytes))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false, "message": "Request failed", "latency_ms": 0, "input_tokens": 0, "output_tokens": 0,
		})
		return
	}
		httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-Internal-Test-Call", "1")
	if spec.AuthType == "x-api-key" {
		httpReq.Header.Set("x-api-key", req.APIKey)
	} else {
		httpReq.Header.Set("Authorization", "Bearer "+req.APIKey)
	}

	startTime := time.Now()
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(httpReq)
	latency := time.Since(startTime).Milliseconds()

	if err != nil {
		log.Printf("[ERROR] handleProxyModeTestChat: internal proxy call failed: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false, "message": fmt.Sprintf("代理服务调用失败: %v", err), "latency_ms": latency, "input_tokens": 0, "output_tokens": 0,
		})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 50<<20))

	if resp.StatusCode >= 400 {
		errDetail := string(respBody)
		if len(errDetail) > 200 {
			errDetail = errDetail[:200]
		}
		log.Printf("[ERROR] handleProxyModeTestChat: proxy returned status=%d body=%s", resp.StatusCode, string(respBody))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":       false,
			"message":       fmt.Sprintf("代理服务返回错误 HTTP %d: %s", resp.StatusCode, errDetail),
			"latency_ms":    latency,
			"input_tokens":  0,
			"output_tokens": 0,
		})
		return
	}

	var result map[string]interface{}
	json.Unmarshal(respBody, &result)

	inputTokens := 0
	outputTokens := 0
	if usage, ok := result["usage"].(map[string]interface{}); ok {
		if pt, ok := usage["prompt_tokens"].(float64); ok {
			inputTokens = int(pt)
		} else if pt, ok := usage["input_tokens"].(float64); ok {
			inputTokens = int(pt)
		}
		if ct, ok := usage["completion_tokens"].(float64); ok {
			outputTokens = int(ct)
		} else if ct, ok := usage["output_tokens"].(float64); ok {
			outputTokens = int(ct)
		}
	}

	log.Printf("[INFO] handleProxyModeTestChat: success provider=%s model=%s latency=%dms input=%d output=%d",
		providerName, modelName, latency, inputTokens, outputTokens)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"message":       "OK",
		"response":      result,
		"latency_ms":    latency,
		"input_tokens":  inputTokens,
		"output_tokens": outputTokens,
	})
}

func (p *ProxyServer) handleDirectModeTestChat(w http.ResponseWriter, req struct {
	Mode         string `json:"mode"`
	BaseURL      string `json:"baseUrl"`
	APIKey       string `json:"apiKey"`
	Model        string `json:"model"`
	Message      string `json:"message"`
	ProviderType string `json:"providerType"`
	ProviderID   string `json:"providerId"`
}) {
	var apiKey, baseURL string
	if req.ProviderID != "" {
		for _, pr := range dbListProviders() {
			if pr["id"] == req.ProviderID {
				if keys, ok := pr["api_keys"].([]map[string]interface{}); ok && len(keys) > 0 {
					apiKey, _ = keys[0]["key_value"].(string)
				}
				baseURL, _ = pr["base_url"].(string)
				break
			}
		}
		if apiKey == "" || baseURL == "" {
			for _, pr := range dbListProviders() {
				if keys, ok := pr["api_keys"].([]map[string]interface{}); ok && len(keys) > 0 {
					if kv, ok := keys[0]["key_value"].(string); ok && kv != "" {
						apiKey = kv
						if baseURL == "" {
							baseURL, _ = pr["base_url"].(string)
						}
						break
					}
				}
			}
		}
	} else if req.Model != "" {
		modelPrefix := ""
		if idx := strings.Index(req.Model, ":"); idx >= 0 {
			modelPrefix = req.Model[:idx]
		}
		for _, pr := range dbListProviders() {
			ptype, _ := pr["name"].(string)
			if modelPrefix != "" && ptype != "" && strings.ToLower(ptype) == strings.ToLower(modelPrefix) {
				if keys, ok := pr["api_keys"].([]map[string]interface{}); ok && len(keys) > 0 {
					apiKey, _ = keys[0]["key_value"].(string)
				}
				baseURL, _ = pr["base_url"].(string)
				break
			}
		}
		if apiKey == "" {
			for _, pr := range dbListProviders() {
				if keys, ok := pr["api_keys"].([]map[string]interface{}); ok && len(keys) > 0 {
					if kv, ok := keys[0]["key_value"].(string); ok && kv != "" {
						apiKey = kv
						if baseURL == "" {
							baseURL, _ = pr["base_url"].(string)
						}
						break
					}
				}
			}
		}
	} else {
		apiKey = req.APIKey
		baseURL = req.BaseURL
	}
	if baseURL == "" {
		baseURL = "https://api.siliconflow.cn"
	}
	if apiKey == "" {
		for _, pr := range dbListProviders() {
			if keys, ok := pr["api_keys"].([]map[string]interface{}); ok && len(keys) > 0 {
				if kv, ok := keys[0]["key_value"].(string); ok && kv != "" {
					apiKey = kv
					if baseURL == "" {
						baseURL, _ = pr["base_url"].(string)
					}
					break
				}
			}
		}
	}
	if apiKey == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false, "message": "No API key available", "latency_ms": 0, "input_tokens": 0, "output_tokens": 0,
		})
		return
	}

	startTime := time.Now()
	modelToSend := req.Model
	if idx := strings.Index(modelToSend, ":"); idx >= 0 {
		modelToSend = modelToSend[idx+1:]
	}

	isAnthropicCompat := req.ProviderType == "minimax-tokenplan" || req.ProviderType == "anthropic" || req.ProviderType == "glm-coding"

	var bodyBytes []byte
	var endpoint string

	if isAnthropicCompat {
		anthropicReq := map[string]interface{}{
			"model":      modelToSend,
			"max_tokens": 256,
			"stream":     false,
			"messages": []map[string]interface{}{
				{"role": "user", "content": req.Message},
			},
		}
		bodyBytes, _ = json.Marshal(anthropicReq)
		endpoint = baseURL + "/v1/messages"
	} else {
		openaiReq := map[string]interface{}{
			"model": modelToSend,
			"messages": []map[string]interface{}{
				{"role": "user", "content": req.Message},
			},
			"max_tokens": 256,
			"stream":     false,
		}
		bodyBytes, _ = json.Marshal(openaiReq)
		endpoint = baseURL + "/v1/chat/completions"
	}

	httpReq, err := http.NewRequest("POST", endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		log.Printf("[ERROR] handleDirectModeTestChat: failed to create request: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false, "message": "Request failed", "latency_ms": 0, "input_tokens": 0, "output_tokens": 0,
		})
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if isAnthropicCompat {
		httpReq.Header.Set("x-api-key", apiKey)
		httpReq.Header.Set("anthropic-version", "2023-06-01")
	} else {
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	latency := time.Since(startTime).Milliseconds()

	if err != nil {
		log.Printf("[ERROR] handleDirectModeTestChat: request failed: %v", err)
		dbInsertLog(&RequestLog{
			Timestamp:    startTime,
			Provider:    req.ProviderType,
			Model:       modelToSend,
			InputTokens: 0,
			OutputTokens: 0,
			LatencyMs:   int64(latency),
			Success:     false,
			ErrorMessage: err.Error(),
			ClientIP:    "direct-test",
			APIKeyUsed:  maskAPIKeyForLog(apiKey),
			StatusCode:  0,
			Path:        endpoint,
			Method:      "POST",
			CallType:   "direct-call",
		})
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false, "message": "Request failed", "latency_ms": latency, "input_tokens": 0, "output_tokens": 0,
		})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 50<<20))

	if resp.StatusCode >= 400 {
		log.Printf("[ERROR] handleDirectModeTestChat: upstream returned HTTP %d", resp.StatusCode)
		dbInsertLog(&RequestLog{
			Timestamp:    startTime,
			Provider:    req.ProviderType,
			Model:       modelToSend,
			InputTokens: 0,
			OutputTokens: 0,
			LatencyMs:   int64(latency),
			Success:     false,
			ErrorMessage: fmt.Sprintf("HTTP %d", resp.StatusCode),
			ClientIP:    "direct-test",
			APIKeyUsed:  maskAPIKeyForLog(apiKey),
			StatusCode:  resp.StatusCode,
			Path:        endpoint,
			Method:      "POST",
			CallType:   "direct-call",
		})
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("HTTP %d", resp.StatusCode),
			"latency_ms": latency, "input_tokens": 0, "output_tokens": 0,
		})
		return
	}

	var result map[string]interface{}
	json.Unmarshal(respBody, &result)
	usage, ok := result["usage"].(map[string]interface{})
	if !ok {
		dbInsertLog(&RequestLog{
			Timestamp:    startTime,
			Provider:    req.ProviderType,
			Model:       modelToSend,
			InputTokens: 0,
			OutputTokens: 0,
			LatencyMs:   int64(latency),
			Success:     false,
			ErrorMessage: "No usage in response",
			ClientIP:    "direct-test",
			APIKeyUsed:  maskAPIKeyForLog(apiKey),
			StatusCode:  200,
			Path:        endpoint,
			Method:      "POST",
			CallType:   "direct-call",
		})
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false, "message": "No usage in response", "latency_ms": latency, "input_tokens": 0, "output_tokens": 0,
		})
		return
	}
	var inputTokens, outputTokens int
	if v, ok := usage["prompt_tokens"].(float64); ok {
		inputTokens = int(v)
	} else if v, ok := usage["input_tokens"].(float64); ok {
		inputTokens = int(v)
	}
	if v, ok := usage["completion_tokens"].(float64); ok {
		outputTokens = int(v)
	} else if v, ok := usage["output_tokens"].(float64); ok {
		outputTokens = int(v)
	}

	dbInsertLog(&RequestLog{
		Timestamp:    startTime,
		Provider:    req.ProviderType,
		Model:       modelToSend,
		InputTokens: inputTokens,
		OutputTokens: outputTokens,
		LatencyMs:   int64(latency),
		Success:     true,
		ClientIP:    "direct-test",
		APIKeyUsed:  maskAPIKeyForLog(apiKey),
		StatusCode:  200,
		Path:        endpoint,
		Method:      "POST",
		CallType:   "direct-call",
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"message":       "OK",
		"response":      result,
		"latency_ms":    latency,
		"input_tokens":  inputTokens,
		"output_tokens": outputTokens,
	})
}
