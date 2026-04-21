// AIProxy Go代理服务 - 提供商实现
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

// Provider 接口定义
type Provider interface {
	GetName() string
	GetBaseURL() string
	GetModels() []string
	GetAPIKey() string
	ProxyRequest(w http.ResponseWriter, r *http.Request)
	TestConnection() error
}

// 辅助函数
func testConnection(url, apiKey, authType string) error {
	client := newHTTPClient("")
	if proxyURL := getProxy(); proxyURL != nil {
		client = newHTTPClient(proxyURL.String())
	}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}

	if authType == "Bearer" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	} else if authType == "x-api-key" {
		req.Header.Set("x-api-key", apiKey)
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("connection test failed with status: %d", resp.StatusCode)
	}
	return nil
}

func copyHeaders(dst http.Header, src http.Header) {
	for key, values := range src {
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func handleStreamingResponse(w http.ResponseWriter, body io.ReadCloser) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	reader := bufio.NewReader(body)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			return
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if strings.HasPrefix(line, "data:") {
			line = strings.TrimPrefix(line, "data:")
			line = strings.TrimSpace(line)
		}

		if line == "[DONE]" || line == "" {
			w.Write([]byte("data: [DONE]\n\n"))
			flusher.Flush()
			break
		}

		normalized := normalizeStreamChunk(line)
		w.Write([]byte("data: " + normalized + "\n\n"))
		flusher.Flush()
	}
}

func normalizeStreamChunk(chunk string) string {
	if !strings.HasPrefix(chunk, "{") {
		return chunk
	}

	var data map[string]interface{}
	if err := json.Unmarshal([]byte(chunk), &data); err != nil {
		return chunk
	}

	if choices, ok := data["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if delta, ok := choice["delta"].(map[string]interface{}); ok {
				if content, ok := delta["content"].(string); !ok || content == "" {
					if reasoningContent, ok := delta["reasoning_content"].(string); ok && reasoningContent != "" {
						delta["content"] = reasoningContent
					}
				}
			}
		}
	}

	result, _ := json.Marshal(data)
	return string(result)
}

func normalizeResponse(body []byte) []byte {
	var resp map[string]interface{}
	if err := json.Unmarshal(body, &resp); err != nil {
		return body
	}

	if choices, ok := resp["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if msg, ok := choice["message"].(map[string]interface{}); ok {
				if content, ok := msg["content"].(string); !ok || content == "" {
					if reasoningContent, ok := msg["reasoning_content"].(string); ok && reasoningContent != "" {
						msg["content"] = reasoningContent
					}
				}
			}
		}
	}

	result, _ := json.Marshal(resp)
	return result
}

func doProxy(w http.ResponseWriter, proxyReq *http.Request) {
	client := newHTTPClient("")
	if proxyURL := getProxy(); proxyURL != nil {
		client = newHTTPClient(proxyURL.String())
	}
	resp, err := client.Do(proxyReq)
	if err != nil {
		http.Error(w, "Failed to send request: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	copyHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)

	if resp.Header.Get("Content-Type") == "text/event-stream" {
		handleStreamingResponse(w, resp.Body)
	} else {
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			http.Error(w, "Failed to read response body", http.StatusBadGateway)
			return
		}
		normalizedBody := normalizeResponse(body)
		w.Write(normalizedBody)
	}
}

func proxyOpenAIRequest(baseURL, apiKey string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		upstreamURL := baseURL + r.URL.Path
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read request body", http.StatusBadRequest)
			return
		}

		proxyReq, err := http.NewRequest(r.Method, upstreamURL, bytes.NewReader(body))
		if err != nil {
			http.Error(w, "Failed to create proxy request", http.StatusBadGateway)
			return
		}

		copyHeaders(proxyReq.Header, r.Header)
		if apiKey != "" {
			proxyReq.Header.Set("Authorization", "Bearer "+apiKey)
		}

		doProxy(w, proxyReq)
	}
}

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

func (p *OpenAIProvider) GetName() string    { return p.name }
func (p *OpenAIProvider) GetBaseURL() string { return p.baseURL }
func (p *OpenAIProvider) GetAPIKey() string  { return p.apiKey }
func (p *OpenAIProvider) GetModels() []string {
	return []string{"gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o1-preview", "o1-mini", "o3-mini"}
}
func (p *OpenAIProvider) TestConnection() error {
	return testConnection(p.baseURL+"/v1/models", p.apiKey, "Bearer")
}
func (p *OpenAIProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== Anthropic提供商 ====================
type AnthropicProvider struct {
	name    string
	baseURL string
	apiKey  string
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
	return []string{"claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229", "claude-3-sonnet-20240229"}
}
func (p *AnthropicProvider) TestConnection() error {
	return testConnection(p.baseURL+"/v1/messages", p.apiKey, "x-api-key")
}
func (p *AnthropicProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	path = strings.TrimPrefix(path, "/v1")
	upstreamURL := p.baseURL + path
	body, err := io.ReadAll(r.Body)
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

func (p *GeminiProvider) GetName() string    { return p.name }
func (p *GeminiProvider) GetBaseURL() string { return p.baseURL }
func (p *GeminiProvider) GetAPIKey() string  { return p.apiKey }
func (p *GeminiProvider) GetModels() []string {
	return []string{"gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash"}
}
func (p *GeminiProvider) TestConnection() error { return nil }
func (p *GeminiProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	path = strings.TrimPrefix(path, "/v1")
	upstreamURL := p.baseURL + "/v1beta/openai" + path + "?key=" + p.apiKey
	body, err := io.ReadAll(r.Body)
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

func (p *DeepSeekProvider) GetName() string    { return p.name }
func (p *DeepSeekProvider) GetBaseURL() string { return p.baseURL }
func (p *DeepSeekProvider) GetAPIKey() string  { return p.apiKey }
func (p *DeepSeekProvider) GetModels() []string {
	return []string{"deepseek-chat", "deepseek-coder", "deepseek-chat-v3"}
}
func (p *DeepSeekProvider) TestConnection() error {
	return testConnection(p.baseURL+"/v1/models", p.apiKey, "Bearer")
}
func (p *DeepSeekProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== MiniMax提供商 (字节跳动) ====================
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

func (p *MiniMaxProvider) GetName() string    { return p.name }
func (p *MiniMaxProvider) GetBaseURL() string { return p.baseURL }
func (p *MiniMaxProvider) GetAPIKey() string  { return p.apiKey }
func (p *MiniMaxProvider) GetModels() []string {
	return []string{"MiniMax-Text-01", "abab6.5s-chat", "abab6.5g-chat"}
}
func (p *MiniMaxProvider) TestConnection() error { return nil }
func (p *MiniMaxProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	upstreamURL := p.baseURL + r.URL.Path
	body, err := io.ReadAll(r.Body)
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

func (p *SiliconFlowProvider) GetName() string    { return p.name }
func (p *SiliconFlowProvider) GetBaseURL() string { return p.baseURL }
func (p *SiliconFlowProvider) GetAPIKey() string  { return p.apiKey }
func (p *SiliconFlowProvider) GetModels() []string {
	return []string{
		"Qwen/Qwen2.5-7B-Instruct", "Qwen/Qwen2.5-14B-Instruct", "Qwen/Qwen2.5-72B-Instruct",
		"deepseek-ai/DeepSeek-V2.5", "deepseek-ai/DeepSeek-V2",
		"THUDM/glm-4-9b-chat", "THUDM/glm-4-plus",
		"01-ai/Yi-1.5-34B-Chat-16K", "01-ai/Yi-1.5-9B-Chat-16K",
		"moonshot/v1-8k", "moonshot/v1-32k",
	}
}
func (p *SiliconFlowProvider) TestConnection() error {
	return testConnection(p.baseURL+"/v1/models", p.apiKey, "Bearer")
}
func (p *SiliconFlowProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
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

func (p *GLMProvider) GetName() string    { return p.name }
func (p *GLMProvider) GetBaseURL() string { return p.baseURL }
func (p *GLMProvider) GetAPIKey() string  { return p.apiKey }
func (p *GLMProvider) GetModels() []string {
	return []string{"glm-4", "glm-4-plus", "glm-4v", "glm-3-turbo"}
}
func (p *GLMProvider) TestConnection() error {
	return testConnection(p.baseURL+"/models", p.apiKey, "Bearer")
}
func (p *GLMProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	path = strings.TrimPrefix(path, "/v1")
	upstreamURL := p.baseURL + path
	body, err := io.ReadAll(r.Body)
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

func (p *DoubaoProvider) GetName() string    { return p.name }
func (p *DoubaoProvider) GetBaseURL() string { return p.baseURL }
func (p *DoubaoProvider) GetAPIKey() string  { return p.apiKey }
func (p *DoubaoProvider) GetModels() []string {
	return []string{"doubao-e-32k", "doubao-e-16k", "doubao-lite-32k", "doubao-lite-16k"}
}
func (p *DoubaoProvider) TestConnection() error {
	return testConnection("https://ark.cn-beijing.volces.com/api/v3/models", p.apiKey, "Bearer")
}
func (p *DoubaoProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	path = strings.TrimPrefix(path, "/v1")
	upstreamURL := p.baseURL + path
	body, err := io.ReadAll(r.Body)
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

func (p *QwenProvider) GetName() string    { return p.name }
func (p *QwenProvider) GetBaseURL() string { return p.baseURL }
func (p *QwenProvider) GetAPIKey() string  { return p.apiKey }
func (p *QwenProvider) GetModels() []string {
	return []string{"qwen-plus", "qwen-plus-latest", "qwen-turbo", "qwen-turbo-latest", "qwen-max"}
}
func (p *QwenProvider) TestConnection() error {
	return testConnection(p.baseURL+"/models", p.apiKey, "Bearer")
}
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

func (p *MoonshotProvider) GetName() string    { return p.name }
func (p *MoonshotProvider) GetBaseURL() string { return p.baseURL }
func (p *MoonshotProvider) GetAPIKey() string  { return p.apiKey }
func (p *MoonshotProvider) GetModels() []string {
	return []string{"moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"}
}
func (p *MoonshotProvider) TestConnection() error {
	return testConnection(p.baseURL+"/models", p.apiKey, "Bearer")
}
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

func (p *YiProvider) GetName() string    { return p.name }
func (p *YiProvider) GetBaseURL() string { return p.baseURL }
func (p *YiProvider) GetAPIKey() string  { return p.apiKey }
func (p *YiProvider) GetModels() []string {
	return []string{"yi-large", "yi-medium", "yi-large-rag", "yi-1.5-34b-chat"}
}
func (p *YiProvider) TestConnection() error {
	return testConnection(p.baseURL+"/models", p.apiKey, "Bearer")
}
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

func (p *OpenRouterProvider) GetName() string    { return p.name }
func (p *OpenRouterProvider) GetBaseURL() string { return p.baseURL }
func (p *OpenRouterProvider) GetAPIKey() string  { return p.apiKey }
func (p *OpenRouterProvider) GetModels() []string {
	return []string{"openai/gpt-4o", "anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash-exp"}
}
func (p *OpenRouterProvider) TestConnection() error {
	return testConnection(p.baseURL+"/models", p.apiKey, "Bearer")
}
func (p *OpenRouterProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	proxyOpenAIRequest(p.baseURL, p.apiKey)(w, r)
}

// ==================== 提供商工厂 ====================
func NewProvider(providerType, apiKey string) (Provider, error) {
	switch providerType {
	case "openai":
		return NewOpenAIProvider(apiKey), nil
	case "anthropic":
		return NewAnthropicProvider(apiKey), nil
	case "gemini":
		return NewGeminiProvider(apiKey), nil
	case "deepseek":
		return NewDeepSeekProvider(apiKey), nil
	case "minimax":
		groupID := os.Getenv("MINIMAX_GROUP_ID")
		return NewMiniMaxProvider(apiKey, groupID), nil
	case "siliconflow":
		return NewSiliconFlowProvider(apiKey), nil
	case "glm":
		return NewGLMProvider(apiKey), nil
	case "doubao":
		return NewDoubaoProvider(apiKey), nil
	case "qwen":
		return NewQwenProvider(apiKey), nil
	case "moonshot":
		return NewMoonshotProvider(apiKey), nil
	case "yi":
		return NewYiProvider(apiKey), nil
	case "openrouter":
		return NewOpenRouterProvider(apiKey), nil
	default:
		return nil, fmt.Errorf("unsupported provider type: %s", providerType)
	}
}
