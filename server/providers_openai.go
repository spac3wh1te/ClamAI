package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// ==================== OpenAI提供商 ====================
type OpenAIProvider struct {
	name    string
	baseURL string
	apiKey  string
}

func NewOpenAIProvider(apiKey string) *OpenAIProvider {
	return &OpenAIProvider{
		name:    "openai",
		baseURL: "https://api.openai.com",
		apiKey:  apiKey,
	}
}

func (p *OpenAIProvider) GetName() string         { return p.name }
func (p *OpenAIProvider) GetBaseURL() string       { return p.baseURL }
func (p *OpenAIProvider) SetBaseURL(url string)    { p.baseURL = url }
func (p *OpenAIProvider) GetAPIKey() string        { return p.apiKey }
func (p *OpenAIProvider) FetchModels() []string    { return fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer") }
func (p *OpenAIProvider) TestConnection() error    { return testConnection(p.baseURL+"/v1/models", p.apiKey, "Bearer") }
func (p *OpenAIProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== DeepSeek提供商 ====================
type DeepSeekProvider struct {
	name    string
	baseURL string
	apiKey  string
}

func NewDeepSeekProvider(apiKey string) *DeepSeekProvider {
	return &DeepSeekProvider{
		name:    "deepseek",
		baseURL: "https://api.deepseek.com",
		apiKey:  apiKey,
	}
}

func (p *DeepSeekProvider) GetName() string         { return p.name }
func (p *DeepSeekProvider) GetBaseURL() string       { return p.baseURL }
func (p *DeepSeekProvider) SetBaseURL(url string)    { p.baseURL = url }
func (p *DeepSeekProvider) GetAPIKey() string        { return p.apiKey }
func (p *DeepSeekProvider) FetchModels() []string    { return fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer") }
func (p *DeepSeekProvider) TestConnection() error    { return testConnection(p.baseURL+"/v1/models", p.apiKey, "Bearer") }
func (p *DeepSeekProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== SiliconFlow提供商 (第三方聚合API) ====================
type SiliconFlowProvider struct {
	name    string
	baseURL string
	apiKey  string
}

func NewSiliconFlowProvider(apiKey string) *SiliconFlowProvider {
	return &SiliconFlowProvider{
		name:    "siliconflow",
		baseURL: "https://api.siliconflow.cn",
		apiKey:  apiKey,
	}
}

func (p *SiliconFlowProvider) GetName() string         { return p.name }
func (p *SiliconFlowProvider) GetBaseURL() string       { return p.baseURL }
func (p *SiliconFlowProvider) SetBaseURL(url string)    { p.baseURL = url }
func (p *SiliconFlowProvider) GetAPIKey() string        { return p.apiKey }
func (p *SiliconFlowProvider) FetchModels() []string    { return fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer") }
func (p *SiliconFlowProvider) TestConnection() error    { return testConnection(p.baseURL+"/v1/models", p.apiKey, "Bearer") }
func (p *SiliconFlowProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== Qwen提供商 (阿里云通义) ====================
type QwenProvider struct {
	name    string
	baseURL string
	apiKey  string
}

func NewQwenProvider(apiKey string) *QwenProvider {
	return &QwenProvider{
		name:    "qwen",
		baseURL: "https://dashscope.aliyuncs.com/compatible-mode",
		apiKey:  apiKey,
	}
}

func (p *QwenProvider) GetName() string         { return p.name }
func (p *QwenProvider) GetBaseURL() string       { return p.baseURL }
func (p *QwenProvider) SetBaseURL(url string)    { p.baseURL = url }
func (p *QwenProvider) GetAPIKey() string        { return p.apiKey }
func (p *QwenProvider) FetchModels() []string    { return fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer") }
func (p *QwenProvider) TestConnection() error    { return testConnection(p.baseURL+"/models", p.apiKey, "Bearer") }
func (p *QwenProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== Moonshot提供商 (月之暗面Kimi) ====================
type MoonshotProvider struct {
	name    string
	baseURL string
	apiKey  string
}

func NewMoonshotProvider(apiKey string) *MoonshotProvider {
	return &MoonshotProvider{
		name:    "moonshot",
		baseURL: "https://api.moonshot.cn",
		apiKey:  apiKey,
	}
}

func (p *MoonshotProvider) GetName() string         { return p.name }
func (p *MoonshotProvider) GetBaseURL() string       { return p.baseURL }
func (p *MoonshotProvider) SetBaseURL(url string)    { p.baseURL = url }
func (p *MoonshotProvider) GetAPIKey() string        { return p.apiKey }
func (p *MoonshotProvider) FetchModels() []string    { return fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer") }
func (p *MoonshotProvider) TestConnection() error    { return testConnection(p.baseURL+"/models", p.apiKey, "Bearer") }
func (p *MoonshotProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== Yi提供商 (零一万物) ====================
type YiProvider struct {
	name    string
	baseURL string
	apiKey  string
}

func NewYiProvider(apiKey string) *YiProvider {
	return &YiProvider{
		name:    "yi",
		baseURL: "https://api.lingyiwanwu.com",
		apiKey:  apiKey,
	}
}

func (p *YiProvider) GetName() string         { return p.name }
func (p *YiProvider) GetBaseURL() string       { return p.baseURL }
func (p *YiProvider) SetBaseURL(url string)    { p.baseURL = url }
func (p *YiProvider) GetAPIKey() string        { return p.apiKey }
func (p *YiProvider) FetchModels() []string    { return fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer") }
func (p *YiProvider) TestConnection() error    { return testConnection(p.baseURL+"/models", p.apiKey, "Bearer") }
func (p *YiProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== OpenRouter提供商 ====================
type OpenRouterProvider struct {
	name    string
	baseURL string
	apiKey  string
}

func NewOpenRouterProvider(apiKey string) *OpenRouterProvider {
	return &OpenRouterProvider{
		name:    "openrouter",
		baseURL: "https://openrouter.ai/api",
		apiKey:  apiKey,
	}
}

func (p *OpenRouterProvider) GetName() string         { return p.name }
func (p *OpenRouterProvider) GetBaseURL() string       { return p.baseURL }
func (p *OpenRouterProvider) SetBaseURL(url string)    { p.baseURL = url }
func (p *OpenRouterProvider) GetAPIKey() string        { return p.apiKey }
func (p *OpenRouterProvider) FetchModels() []string    { return fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer") }
func (p *OpenRouterProvider) TestConnection() error    { return testConnection(p.baseURL+"/models", p.apiKey, "Bearer") }
func (p *OpenRouterProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== Doubao提供商 (字节豆包-火山引擎) ====================
type DoubaoProvider struct {
	name    string
	baseURL string
	apiKey  string
}

func NewDoubaoProvider(apiKey string) *DoubaoProvider {
	return &DoubaoProvider{
		name:    "doubao",
		baseURL: "https://ark.cn-beijing.volces.com/api/v3",
		apiKey:  apiKey,
	}
}

func (p *DoubaoProvider) GetName() string         { return p.name }
func (p *DoubaoProvider) GetBaseURL() string       { return p.baseURL }
func (p *DoubaoProvider) SetBaseURL(url string)    { p.baseURL = url }
func (p *DoubaoProvider) GetAPIKey() string        { return p.apiKey }
func (p *DoubaoProvider) FetchModels() []string {
	return fetchModelsForProvider("https://ark.cn-beijing.volces.com/api/v3", p.apiKey, "Bearer")
}
func (p *DoubaoProvider) TestConnection() error {
	return testConnection("https://ark.cn-beijing.volces.com/api/v3/models", p.apiKey, "Bearer")
}
func (p *DoubaoProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	path = strings.TrimPrefix(path, "/v1")
	upstreamURL := p.baseURL + path
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

	doProxy(w, proxyReq)
}
