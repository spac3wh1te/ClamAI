package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

func (p *ProxyServer) handleTransparentProxy(w http.ResponseWriter, r *http.Request) {
	spec := specFromContext(r)
	if spec == nil {
		http.Error(w, "Provider route not found", http.StatusNotFound)
		return
	}

	if r.Method == "GET" {
		stripped := strings.TrimPrefix(r.URL.Path, spec.PathPrefix)
		if stripped == "/models" {
			p.handleProviderModels(w, r, spec)
			return
		}
	}

	var upstreamBase, apiKey string
	p.mu.RLock()
	if provider, exists := p.providers[spec.Name]; exists {
		upstreamBase = provider.GetBaseURL()
		apiKey = provider.GetAPIKey()
	}
	p.mu.RUnlock()
	if upstreamBase == "" || apiKey == "" {
		for _, pr := range dbListProviders() {
			ptype, _ := pr["provider_type"].(string)
			if ptype != spec.Name {
				continue
			}
			if upstreamBase == "" {
				if bu, ok := pr["base_url"].(string); ok && bu != "" {
					upstreamBase = bu
				}
			}
			if apiKey == "" {
				if keys, ok := pr["api_keys"].([]map[string]interface{}); ok && len(keys) > 0 {
					apiKey, _ = keys[0]["key_value"].(string)
				}
			}
			if upstreamBase != "" && apiKey != "" {
				break
			}
		}
	}
	if upstreamBase == "" {
		upstreamBase = spec.UpstreamBase
	}

	bodyBytes, err := io.ReadAll(io.LimitReader(r.Body, 50<<20))
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}
	r.Body.Close()

	upstreamURL := buildUpstreamURL(r.URL.Path, spec)
	if r.URL.RawQuery != "" {
		upstreamURL += "?" + r.URL.RawQuery
	}

	proxyReq, err := http.NewRequest(r.Method, upstreamURL, strings.NewReader(string(bodyBytes)))
	if err != nil {
		log.Printf("[ERROR] transparent proxy: create request failed for %s: %v", upstreamURL, err)
		http.Error(w, "Failed to create upstream request", http.StatusBadGateway)
		return
	}

	reqHeaders := make(map[string]string)
	for key, values := range r.Header {
		reqHeaders[key] = strings.Join(values, ",")
	}

	skipHeaders := map[string]bool{
		"authorization":      true,
		"x-api-key":          true,
		"anthropic-version":  true,
		"host":               true,
		"content-length":     true,
		"transfer-encoding":  true,
		"accept-encoding":    true,
	}
	for key, values := range r.Header {
		if skipHeaders[strings.ToLower(key)] {
			continue
		}
		for _, value := range values {
			proxyReq.Header.Add(key, value)
		}
	}

	if apiKey != "" {
		switch spec.AuthType {
		case "x-api-key":
			proxyReq.Header.Set("x-api-key", apiKey)
			proxyReq.Header.Set("anthropic-version", "2023-06-01")
		default:
			proxyReq.Header.Set("Authorization", "Bearer "+apiKey)
		}
	}
	if proxyReq.Header.Get("Content-Type") == "" && len(bodyBytes) > 0 {
		proxyReq.Header.Set("Content-Type", "application/json")
	}

	client := getSharedClient()
	if client == nil {
		client = &http.Client{Timeout: 120 * time.Second}
	}
	startTime := time.Now()
	resp, err := client.Do(proxyReq)
	latency := time.Since(startTime)

	respHeaders := make(map[string]string)
	for key, values := range resp.Header {
		respHeaders[key] = strings.Join(values, ",")
	}
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 50<<20))
	resp.Body.Close()

	if err != nil {
		log.Printf("[ERROR] transparent proxy: %s %s → %s failed: %v (%dms)", r.Method, r.URL.Path, upstreamURL, err, latency.Milliseconds())
		http.Error(w, "Upstream request failed", http.StatusBadGateway)
		return
	}

	log.Printf("[PROXY] %s %s → %s %d (%dms)", r.Method, r.URL.Path, upstreamURL, resp.StatusCode, latency.Milliseconds())

	upstreamReqContent := string(bodyBytes)
	if len(upstreamReqContent) > 10000 {
		upstreamReqContent = upstreamReqContent[:10000]
	}
	upstreamRespContent := string(respBody)
	if len(upstreamRespContent) > 10000 {
		upstreamRespContent = upstreamRespContent[:10000]
	}
	reqHeadersJSON, _ := json.Marshal(reqHeaders)
	respHeadersJSON, _ := json.Marshal(respHeaders)

	upstreamEntry := &RequestLog{
		Timestamp:           startTime,
		Provider:           spec.Name,
		Model:              getModelFromProxyRequest(bodyBytes),
		InputTokens:        0,
		OutputTokens:       0,
		LatencyMs:          latency.Milliseconds(),
		Success:            resp.StatusCode >= 200 && resp.StatusCode < 300,
		ErrorMessage:       "",
		ClientIP:           getClientIP(r),
		APIKeyUsed:         maskAPIKeyForLog(apiKey),
		CallType:          "model-call",
		StatusCode:         resp.StatusCode,
		Path:               r.URL.Path,
		Method:              r.Method,
		RequestContent:     truncateStr(string(bodyBytes), 10000),
		ResponseContent:    truncateStr(upstreamRespContent, 10000),
		UserID:             resolveUserIDFromRequest(r),
		APIKeyID:           resolveAPIKeyIDFromRequest(r),
		IsProxyCall:        true,
		UpstreamReqHeaders: string(reqHeadersJSON),
		UpstreamRespHeaders: string(respHeadersJSON),
		UpstreamReqBody:    truncateStr(upstreamReqContent, 10000),
		UpstreamRespBody:   "",
		UpstreamProvider:   spec.Name,
		UpstreamModel:      getModelFromProxyRequest(bodyBytes),
	}
	dbInsertLog(upstreamEntry)

	if cw, ok := w.(*capturingResponseWriter); ok {
		cw.upstreamProvider = spec.Name
		cw.upstreamModel = getModelFromProxyRequest(bodyBytes)
	}

	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

func getModelFromProxyRequest(bodyBytes []byte) string {
	var body map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &body); err == nil {
		if model, ok := body["model"].(string); ok {
			return model
		}
	}
	return ""
}

func (p *ProxyServer) handleListAllModels(w http.ResponseWriter, r *http.Request) {
	var models []ModelInfo
	for _, pr := range dbListProviders() {
		ptype, _ := pr["provider_type"].(string)
		if ptype == "" {
			continue
		}
		if modelList, ok := pr["models"].([]string); ok {
			for _, modelName := range modelList {
				models = append(models, ModelInfo{
					ID:      fmt.Sprintf("%s:%s", ptype, modelName),
					Object:  "model",
					Created: time.Now().Unix(),
					OwnedBy: ptype,
				})
			}
		}
	}
	if models == nil {
		models = []ModelInfo{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ModelList{Object: "list", Data: models})
}

func (p *ProxyServer) handleProviderModels(w http.ResponseWriter, r *http.Request, spec *ProviderRouteSpec) {
	var allModels []string
	for _, pr := range dbListProviders() {
		ptype, _ := pr["provider_type"].(string)
		if ptype == spec.Name {
			if modelList, ok := pr["models"].([]string); ok {
				allModels = modelList
			}
			break
		}
	}

	if len(allModels) == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ModelList{Object: "list", Data: []ModelInfo{}})
		return
	}

	apiKeyStr := extractAPIKeyFromRequest(r)
	var allowedSet map[string]bool
	if apiKeyStr != "" {
		apiKeysMu.Lock()
		if info, ok := apiKeys[apiKeyStr]; ok && info.Active && len(info.AllowedModels) > 0 {
			allowedSet = make(map[string]bool, len(info.AllowedModels))
			for _, m := range info.AllowedModels {
				if m == "*" || m == spec.Name+":*" || m == spec.Name+":" {
					allowedSet = nil
					break
				}
				if strings.HasPrefix(m, spec.Name+":") {
					allowedSet[strings.TrimPrefix(m, spec.Name+":")] = true
				} else if !strings.Contains(m, ":") && !strings.Contains(m, "/") {
					allowedSet[m] = true
				}
			}
		}
		apiKeysMu.Unlock()
	}

	var models []ModelInfo
	for _, modelName := range allModels {
		if allowedSet != nil {
			if !allowedSet[modelName] {
				continue
			}
		}
		models = append(models, ModelInfo{
			ID:      modelName,
			Object:  "model",
			Created: time.Now().Unix(),
			OwnedBy: spec.Name,
		})
	}
	if models == nil {
		models = []ModelInfo{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ModelList{Object: "list", Data: models})
}

func openAIError(w http.ResponseWriter, message string, status int, errType string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]interface{}{
			"message": message,
			"type":    errType,
			"code":    nil,
		},
	})
}
