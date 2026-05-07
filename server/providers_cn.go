package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// ==================== Gemini提供商 ====================
type GeminiProvider struct {
	name    string
	baseURL string
	apiKey  string
}

func NewGeminiProvider(apiKey string) *GeminiProvider {
	return &GeminiProvider{
		name:    "gemini",
		baseURL: "https://generativelanguage.googleapis.com",
		apiKey:  apiKey,
	}
}

func (p *GeminiProvider) GetName() string         { return p.name }
func (p *GeminiProvider) GetBaseURL() string       { return p.baseURL }
func (p *GeminiProvider) SetBaseURL(url string)    { p.baseURL = url }
func (p *GeminiProvider) GetAPIKey() string        { return p.apiKey }
func (p *GeminiProvider) FetchModels() []string    { return nil }
func (p *GeminiProvider) TestConnection() error    { return nil }
func (p *GeminiProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	path = strings.TrimPrefix(path, "/v1")
	upstreamURL := p.baseURL + "/v1beta/openai" + path + "?key=" + p.apiKey
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

	proxyReq.Header.Set("Content-Type", "application/json")
	doProxy(w, proxyReq)
}

// ==================== MiniMax提供商 ====================
type MiniMaxProvider struct {
	name    string
	baseURL string
	apiKey  string
	groupID string
}

func NewMiniMaxProvider(apiKey, groupID string) *MiniMaxProvider {
	return &MiniMaxProvider{
		name:    "minimax",
		baseURL: "https://api.minimax.chat",
		apiKey:  apiKey,
		groupID: groupID,
	}
}

func (p *MiniMaxProvider) GetName() string         { return p.name }
func (p *MiniMaxProvider) GetBaseURL() string       { return p.baseURL }
func (p *MiniMaxProvider) SetBaseURL(url string)    { p.baseURL = url }
func (p *MiniMaxProvider) GetAPIKey() string        { return p.apiKey }
func (p *MiniMaxProvider) FetchModels() []string    { return fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer") }
func (p *MiniMaxProvider) TestConnection() error    { return nil }
func (p *MiniMaxProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	upstreamURL := p.baseURL + r.URL.Path
	body, err := io.ReadAll(io.LimitReader(r.Body, 50<<20))
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	var req map[string]interface{}
	if err := json.Unmarshal(body, &req); err == nil {
		if model, ok := req["model"].(string); ok {
			if parts := strings.Split(model, "/"); len(parts) == 2 {
				req["model"] = parts[1]
			}
			body, _ = json.Marshal(req)
		}
	}

	proxyReq, err := http.NewRequest(r.Method, upstreamURL, bytes.NewReader(body))
	if err != nil {
		http.Error(w, "Failed to create proxy request", http.StatusBadGateway)
		return
	}

	proxyReq.Header.Set("Content-Type", "application/json")
	if p.apiKey != "" {
		proxyReq.Header.Set("Authorization", "Bearer "+p.apiKey)
	}
	if p.groupID != "" {
		proxyReq.Header.Set("GroupId", p.groupID)
	}

	doProxy(w, proxyReq)
}

// ==================== GLM提供商 (智谱AI) ====================
type GLMProvider struct {
	name    string
	baseURL string
	apiKey  string
}

func NewGLMProvider(apiKey string) *GLMProvider {
	return &GLMProvider{
		name:    "glm",
		baseURL: "https://open.bigmodel.cn/api/paas/v4",
		apiKey:  apiKey,
	}
}

func (p *GLMProvider) GetName() string         { return p.name }
func (p *GLMProvider) GetBaseURL() string       { return p.baseURL }
func (p *GLMProvider) SetBaseURL(url string)    { p.baseURL = url }
func (p *GLMProvider) GetAPIKey() string        { return p.apiKey }
func (p *GLMProvider) FetchModels() []string    { return fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer") }
func (p *GLMProvider) TestConnection() error {
	return testConnection(p.baseURL+"/models", p.apiKey, "Bearer")
}
func (p *GLMProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
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

	proxyReq.Header.Set("Content-Type", "application/json")
	if p.apiKey != "" {
		proxyReq.Header.Set("Authorization", "Bearer "+p.apiKey)
	}

	doProxy(w, proxyReq)
}

// ==================== ArkCode 提供商 (OpenAI协议) ====================
type ArkCodeProvider struct {
	name    string
	baseURL string
	apiKey  string
}

func NewArkCodeProvider(apiKey string) *ArkCodeProvider {
	return &ArkCodeProvider{
		name:    "arkcode",
		baseURL: "https://ark.cn-beijing.volces.com/api/coding/v3",
		apiKey:  apiKey,
	}
}

func (p *ArkCodeProvider) GetName() string         { return p.name }
func (p *ArkCodeProvider) GetBaseURL() string       { return p.baseURL }
func (p *ArkCodeProvider) SetBaseURL(url string)    { p.baseURL = url }
func (p *ArkCodeProvider) GetAPIKey() string        { return p.apiKey }
func (p *ArkCodeProvider) FetchModels() []string    { return fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer") }
func (p *ArkCodeProvider) TestConnection() error    { return nil }
func (p *ArkCodeProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
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
	proxyReq.Header.Set("Content-Type", "application/json")
	if p.apiKey != "" {
		proxyReq.Header.Set("Authorization", "Bearer "+p.apiKey)
	}
	doProxy(w, proxyReq)
}
