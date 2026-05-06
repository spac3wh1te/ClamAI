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

	skipHeaders := map[string]bool{
		"authorization":      true,
		"x-api-key":          true,
		"anthropic-version":  true,
		"host":               true,
		"content-length":     true,
		"transfer-encoding":  true,
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

	if err != nil {
		log.Printf("[ERROR] transparent proxy: %s %s → %s failed: %v (%dms)", r.Method, r.URL.Path, upstreamURL, err, latency.Milliseconds())
		http.Error(w, "Upstream request failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	log.Printf("[PROXY] %s %s → %s %d (%dms)", r.Method, r.URL.Path, upstreamURL, resp.StatusCode, latency.Milliseconds())

	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func (p *ProxyServer) handleListAllModels(w http.ResponseWriter, r *http.Request) {
	var models []ModelInfo
	for providerName, provider := range p.providers {
		for _, modelName := range provider.GetModels() {
			models = append(models, ModelInfo{
				ID:      fmt.Sprintf("%s:%s", providerName, modelName),
				Object:  "model",
				Created: time.Now().Unix(),
				OwnedBy: providerName,
			})
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
	p.mu.RLock()
	provider, exists := p.providers[spec.Name]
	if exists {
		allModels = provider.GetModels()
	}
	p.mu.RUnlock()

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
				if m == "*" || m == provider.GetName()+":*" || m == provider.GetName()+":" {
					allowedSet = nil
					break
				}
				if strings.HasPrefix(m, provider.GetName()+":") {
					allowedSet[strings.TrimPrefix(m, provider.GetName()+":")] = true
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
