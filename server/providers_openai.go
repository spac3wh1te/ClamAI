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
	name          string
	baseURL       string
	apiKey        string
	dynamicModels []string
}

func NewOpenAIProvider(apiKey string) *OpenAIProvider {
	return &OpenAIProvider{
		name:    "openai",
		baseURL: "https://api.openai.com",
		apiKey:  apiKey,
	}
}

func (p *OpenAIProvider) GetName() string    { return p.name }
func (p *OpenAIProvider) GetBaseURL() string { return p.baseURL }
func (p *OpenAIProvider) GetAPIKey() string  { return p.apiKey }
func (p *OpenAIProvider) GetModels() []string {
	if len(p.dynamicModels) > 0 {
		return p.dynamicModels
	}
	return []string{"gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o1-preview", "o1-mini", "o3-mini"}
}
func (p *OpenAIProvider) FetchModels() {
	if models := fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer"); len(models) > 0 {
		p.dynamicModels = models
	}
}
func (p *OpenAIProvider) TestConnection() error {
	return testConnection(p.baseURL+"/v1/models", p.apiKey, "Bearer")
}
func (p *OpenAIProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== DeepSeek提供商 ====================
type DeepSeekProvider struct {
	name          string
	baseURL       string
	apiKey        string
	dynamicModels []string
}

func NewDeepSeekProvider(apiKey string) *DeepSeekProvider {
	return &DeepSeekProvider{
		name:    "deepseek",
		baseURL: "https://api.deepseek.com",
		apiKey:  apiKey,
	}
}

func (p *DeepSeekProvider) GetName() string    { return p.name }
func (p *DeepSeekProvider) GetBaseURL() string { return p.baseURL }
func (p *DeepSeekProvider) GetAPIKey() string  { return p.apiKey }
func (p *DeepSeekProvider) GetModels() []string {
	if len(p.dynamicModels) > 0 {
		return p.dynamicModels
	}
	return []string{"deepseek-chat", "deepseek-coder", "deepseek-chat-v3"}
}
func (p *DeepSeekProvider) FetchModels() {
	if models := fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer"); len(models) > 0 {
		p.dynamicModels = models
	}
}
func (p *DeepSeekProvider) TestConnection() error {
	return testConnection(p.baseURL+"/v1/models", p.apiKey, "Bearer")
}
func (p *DeepSeekProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== SiliconFlow提供商 (第三方聚合API) ====================
type SiliconFlowProvider struct {
	name          string
	baseURL       string
	apiKey        string
	dynamicModels []string
}

func NewSiliconFlowProvider(apiKey string) *SiliconFlowProvider {
	return &SiliconFlowProvider{
		name:    "siliconflow",
		baseURL: "https://api.siliconflow.cn",
		apiKey:  apiKey,
	}
}

func (p *SiliconFlowProvider) GetName() string    { return p.name }
func (p *SiliconFlowProvider) GetBaseURL() string { return p.baseURL }
func (p *SiliconFlowProvider) GetAPIKey() string  { return p.apiKey }
func (p *SiliconFlowProvider) GetModels() []string {
	if len(p.dynamicModels) > 0 {
		return p.dynamicModels
	}
	return []string{
		"Qwen/Qwen2.5-7B-Instruct", "Qwen/Qwen2.5-14B-Instruct", "Qwen/Qwen2.5-72B-Instruct",
		"deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-V2.5", "deepseek-ai/DeepSeek-V2",
		"THUDM/glm-4-9b-chat", "THUDM/glm-4-plus",
		"01-ai/Yi-1.5-34B-Chat-16K", "01-ai/Yi-1.5-9B-Chat-16K",
		"moonshot/v1-8k", "moonshot/v1-32k",
	}
}
func (p *SiliconFlowProvider) FetchModels() {
	if models := fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer"); len(models) > 0 {
		p.dynamicModels = models
	}
}
func (p *SiliconFlowProvider) TestConnection() error {
	return testConnection(p.baseURL+"/v1/models", p.apiKey, "Bearer")
}
func (p *SiliconFlowProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== Qwen提供商 (阿里云通义) ====================
type QwenProvider struct {
	name          string
	baseURL       string
	apiKey        string
	dynamicModels []string
}

func NewQwenProvider(apiKey string) *QwenProvider {
	return &QwenProvider{
		name:    "qwen",
		baseURL: "https://dashscope.aliyuncs.com/compatible-mode",
		apiKey:  apiKey,
	}
}

func (p *QwenProvider) GetName() string    { return p.name }
func (p *QwenProvider) GetBaseURL() string { return p.baseURL }
func (p *QwenProvider) GetAPIKey() string  { return p.apiKey }
func (p *QwenProvider) GetModels() []string {
	if len(p.dynamicModels) > 0 {
		return p.dynamicModels
	}
	return []string{"qwen-plus", "qwen-plus-latest", "qwen-turbo", "qwen-turbo-latest", "qwen-max"}
}
func (p *QwenProvider) FetchModels() {
	if models := fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer"); len(models) > 0 {
		p.dynamicModels = models
	}
}
func (p *QwenProvider) TestConnection() error {
	return testConnection(p.baseURL+"/models", p.apiKey, "Bearer")
}
func (p *QwenProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== Moonshot提供商 (月之暗面Kimi) ====================
type MoonshotProvider struct {
	name          string
	baseURL       string
	apiKey        string
	dynamicModels []string
}

func NewMoonshotProvider(apiKey string) *MoonshotProvider {
	return &MoonshotProvider{
		name:    "moonshot",
		baseURL: "https://api.moonshot.cn",
		apiKey:  apiKey,
	}
}

func (p *MoonshotProvider) GetName() string    { return p.name }
func (p *MoonshotProvider) GetBaseURL() string { return p.baseURL }
func (p *MoonshotProvider) GetAPIKey() string  { return p.apiKey }
func (p *MoonshotProvider) GetModels() []string {
	if len(p.dynamicModels) > 0 {
		return p.dynamicModels
	}
	return []string{"moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"}
}
func (p *MoonshotProvider) FetchModels() {
	if models := fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer"); len(models) > 0 {
		p.dynamicModels = models
	}
}
func (p *MoonshotProvider) TestConnection() error {
	return testConnection(p.baseURL+"/models", p.apiKey, "Bearer")
}
func (p *MoonshotProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== Yi提供商 (零一万物) ====================
type YiProvider struct {
	name          string
	baseURL       string
	apiKey        string
	dynamicModels []string
}

func NewYiProvider(apiKey string) *YiProvider {
	return &YiProvider{
		name:    "yi",
		baseURL: "https://api.lingyiwanwu.com",
		apiKey:  apiKey,
	}
}

func (p *YiProvider) GetName() string    { return p.name }
func (p *YiProvider) GetBaseURL() string { return p.baseURL }
func (p *YiProvider) GetAPIKey() string  { return p.apiKey }
func (p *YiProvider) GetModels() []string {
	if len(p.dynamicModels) > 0 {
		return p.dynamicModels
	}
	return []string{"yi-large", "yi-medium", "yi-large-rag", "yi-1.5-34b-chat"}
}
func (p *YiProvider) FetchModels() {
	if models := fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer"); len(models) > 0 {
		p.dynamicModels = models
	}
}
func (p *YiProvider) TestConnection() error {
	return testConnection(p.baseURL+"/models", p.apiKey, "Bearer")
}
func (p *YiProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== OpenRouter提供商 ====================
type OpenRouterProvider struct {
	name          string
	baseURL       string
	apiKey        string
	dynamicModels []string
}

func NewOpenRouterProvider(apiKey string) *OpenRouterProvider {
	return &OpenRouterProvider{
		name:    "openrouter",
		baseURL: "https://openrouter.ai/api",
		apiKey:  apiKey,
	}
}

func (p *OpenRouterProvider) GetName() string    { return p.name }
func (p *OpenRouterProvider) GetBaseURL() string { return p.baseURL }
func (p *OpenRouterProvider) GetAPIKey() string  { return p.apiKey }
func (p *OpenRouterProvider) GetModels() []string {
	if len(p.dynamicModels) > 0 {
		return p.dynamicModels
	}
	return []string{"openai/gpt-4o", "anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash-exp"}
}
func (p *OpenRouterProvider) FetchModels() {
	if models := fetchModelsForProvider(p.baseURL, p.apiKey, "Bearer"); len(models) > 0 {
		p.dynamicModels = models
	}
}
func (p *OpenRouterProvider) TestConnection() error {
	return testConnection(p.baseURL+"/models", p.apiKey, "Bearer")
}
func (p *OpenRouterProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== Doubao提供商 (字节豆包-火山引擎) ====================
type DoubaoProvider struct {
	name          string
	baseURL       string
	apiKey        string
	dynamicModels []string
}

func NewDoubaoProvider(apiKey string) *DoubaoProvider {
	return &DoubaoProvider{
		name:    "doubao",
		baseURL: "https://ark.cn-beijing.volces.com/api/v3",
		apiKey:  apiKey,
	}
}

func (p *DoubaoProvider) GetName() string    { return p.name }
func (p *DoubaoProvider) GetBaseURL() string { return p.baseURL }
func (p *DoubaoProvider) GetAPIKey() string  { return p.apiKey }
func (p *DoubaoProvider) GetModels() []string {
	if len(p.dynamicModels) > 0 {
		return p.dynamicModels
	}
	return []string{"doubao-e-32k", "doubao-e-16k", "doubao-lite-32k", "doubao-lite-16k"}
}
func (p *DoubaoProvider) FetchModels() {
	if models := fetchModelsForProvider("https://ark.cn-beijing.volces.com/api/v3", p.apiKey, "Bearer"); len(models) > 0 {
		p.dynamicModels = models
	}
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
