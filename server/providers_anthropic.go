package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// ==================== Anthropic提供商 ====================
type AnthropicProvider struct {
	name          string
	baseURL       string
	apiKey        string
	dynamicModels []string
}

func NewAnthropicProvider(apiKey string) *AnthropicProvider {
	return &AnthropicProvider{
		name:    "anthropic",
		baseURL: "https://api.anthropic.com",
		apiKey:  apiKey,
	}
}

func (p *AnthropicProvider) GetName() string    { return p.name }
func (p *AnthropicProvider) GetBaseURL() string { return p.baseURL }
func (p *AnthropicProvider) GetAPIKey() string  { return p.apiKey }
func (p *AnthropicProvider) GetModels() []string {
	if len(p.dynamicModels) > 0 {
		return p.dynamicModels
	}
	return []string{"claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229", "claude-3-sonnet-20240229"}
}
func (p *AnthropicProvider) FetchModels() {}
func (p *AnthropicProvider) TestConnection() error {
	return testConnection(p.baseURL+"/v1/messages", p.apiKey, "x-api-key")
}
func (p *AnthropicProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	path = strings.TrimPrefix(path, "/v1")
	upstreamURL := p.baseURL + path
	body, err := io.ReadAll(io.LimitReader(r.Body, 50<<20))
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	proxyReq, err := http.NewRequest(r.Method, upstreamURL, bytes.NewReader(body))
	if err != nil {
		http.Error(w, "Failed to create proxy request", http.StatusBadGateway)
		return
	}

	for key, values := range r.Header {
		if key != "Authorization" {
			for _, value := range values {
				proxyReq.Header.Add(key, value)
			}
		}
	}

	if p.apiKey != "" {
		proxyReq.Header.Set("x-api-key", p.apiKey)
		proxyReq.Header.Set("anthropic-version", "2023-06-01")
	}

	doProxy(w, proxyReq)
}

// ==================== GLM Coding 提供商 (Anthropic协议) ====================
type GLMCodingProvider struct {
	name          string
	baseURL       string
	apiKey        string
	dynamicModels []string
}

func NewGLMCodingProvider(apiKey string) *GLMCodingProvider {
	return &GLMCodingProvider{
		name:    "glm-coding",
		baseURL: "https://open.bigmodel.cn/api/coding/paas/v4",
		apiKey:  apiKey,
	}
}

func (p *GLMCodingProvider) GetName() string    { return p.name }
func (p *GLMCodingProvider) GetBaseURL() string { return p.baseURL }
func (p *GLMCodingProvider) GetAPIKey() string  { return p.apiKey }
func (p *GLMCodingProvider) GetModels() []string {
	if len(p.dynamicModels) > 0 {
		return p.dynamicModels
	}
	return []string{"coder-4-plus", "coder-4"}
}
func (p *GLMCodingProvider) FetchModels() {
	if models := fetchModelsForProvider(p.baseURL, p.apiKey, "x-api-key"); len(models) > 0 {
		p.dynamicModels = models
	}
}
func (p *GLMCodingProvider) TestConnection() error { return nil }
func (p *GLMCodingProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	path = strings.TrimPrefix(path, "/v1")
	upstreamURL := p.baseURL + path
	body, err := io.ReadAll(io.LimitReader(r.Body, 50<<20))
	if err != nil {
		openAIError(w, "Failed to read request body", http.StatusBadRequest, "invalid_request_error")
		return
	}
	proxyReq, err := http.NewRequest(r.Method, upstreamURL, bytes.NewReader(body))
	if err != nil {
		openAIError(w, "Failed to create proxy request", http.StatusBadGateway, "server_error")
		return
	}
	for key, values := range r.Header {
		if key != "Authorization" {
			for _, value := range values {
				proxyReq.Header.Add(key, value)
			}
		}
	}
	if p.apiKey != "" {
		proxyReq.Header.Set("x-api-key", p.apiKey)
		proxyReq.Header.Set("anthropic-version", "2023-06-01")
	}
	doProxy(w, proxyReq)
}

// ==================== MiniMax TokenPlan 提供商 (Anthropic协议) ====================
type MiniMaxTokenPlanProvider struct {
	name          string
	baseURL       string
	apiKey        string
	dynamicModels []string
}

func NewMiniMaxTokenPlanProvider(apiKey string) *MiniMaxTokenPlanProvider {
	return &MiniMaxTokenPlanProvider{
		name:    "minimax-tokenplan",
		baseURL: "https://api.minimaxi.com/anthropic",
		apiKey:  apiKey,
	}
}

func (p *MiniMaxTokenPlanProvider) GetName() string    { return p.name }
func (p *MiniMaxTokenPlanProvider) GetBaseURL() string { return p.baseURL }
func (p *MiniMaxTokenPlanProvider) GetAPIKey() string  { return p.apiKey }
func (p *MiniMaxTokenPlanProvider) GetModels() []string {
	if len(p.dynamicModels) > 0 {
		return p.dynamicModels
	}
	return []string{"MiniMax-Text-01", "abab6.5s-chat", "abab6.5g-chat"}
}
func (p *MiniMaxTokenPlanProvider) FetchModels() {
	modelsURL := strings.TrimRight(p.baseURL, "/") + "/v1/models"
	client := newHTTPClient("")
	if proxyURL := getProxy(); proxyURL != nil {
		client = newHTTPClient(proxyURL.String())
	}
	req, err := http.NewRequest("GET", modelsURL, nil)
	if err != nil {
		return
	}
	if p.apiKey != "" {
		req.Header.Set("x-api-key", p.apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	}
	client.Timeout = 15 * time.Second
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[MiniMaxTokenPlan.FetchModels] GET %s failed: %v", modelsURL, err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("[MiniMaxTokenPlan.FetchModels] GET %s status %d", modelsURL, resp.StatusCode)
		return
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return
	}
	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		log.Printf("[MiniMaxTokenPlan.FetchModels] parse failed: %v", err)
		return
	}
	var models []string
	for _, m := range result.Data {
		if m.ID != "" {
			models = append(models, m.ID)
		}
	}
	if len(models) > 0 {
		p.dynamicModels = models
		log.Printf("[MiniMaxTokenPlan.FetchModels] got %d models: %v", len(models), models)
	}
}
func (p *MiniMaxTokenPlanProvider) TestConnection() error { return nil }
func (p *MiniMaxTokenPlanProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	path = strings.TrimPrefix(path, "/v1")
	upstreamURL := p.baseURL + path
	body, err := io.ReadAll(io.LimitReader(r.Body, 50<<20))
	if err != nil {
		openAIError(w, "Failed to read request body", http.StatusBadRequest, "invalid_request_error")
		return
	}
	proxyReq, err := http.NewRequest(r.Method, upstreamURL, bytes.NewReader(body))
	if err != nil {
		openAIError(w, "Failed to create proxy request", http.StatusBadGateway, "server_error")
		return
	}
	for key, values := range r.Header {
		if key != "Authorization" {
			for _, value := range values {
				proxyReq.Header.Add(key, value)
			}
		}
	}
	if p.apiKey != "" {
		proxyReq.Header.Set("x-api-key", p.apiKey)
		proxyReq.Header.Set("anthropic-version", "2023-06-01")
	}
	doProxy(w, proxyReq)
}
