// AIProxy Go代理服务 - 提供商实现
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Provider 接口定义
type Provider interface {
	GetName() string
	GetBaseURL() string
	GetModels() []string
	GetAPIKey() string
	ProxyRequest(w http.ResponseWriter, r *http.Request)
	TestConnection() error
	FetchModels()
}

var fetchMu sync.Mutex

func fetchModelsFromAPI(url, apiKey, authType string) []string {
	fetchMu.Lock()
	defer fetchMu.Unlock()

	client := newHTTPClient("")
	if proxyURL := getProxy(); proxyURL != nil {
		client = newHTTPClient(proxyURL.String())
	}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil
	}
	if apiKey != "" {
		if authType == "x-api-key" {
			req.Header.Set("x-api-key", apiKey)
		} else {
			req.Header.Set("Authorization", "Bearer "+apiKey)
		}
	}

	client.Timeout = 15 * time.Second
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[FetchModels] GET %s failed: %v", url, err)
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[FetchModels] GET %s status %d", url, resp.StatusCode)
		return nil
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return nil
	}

	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil
	}

	var models []string
	for _, m := range result.Data {
		if m.ID != "" {
			models = append(models, m.ID)
		}
	}
	log.Printf("[FetchModels] Fetched %d models from %s", len(models), url)
	return models
}

func fetchModelsForProvider(baseURL, apiKey, authType string) []string {
	modelsURL := strings.TrimRight(baseURL, "/")
	if !strings.Contains(modelsURL, "/models") {
		if strings.Contains(modelsURL, "/v1") || strings.Contains(modelsURL, "/v3") || strings.Contains(modelsURL, "/v4") {
			modelsURL += "/models"
		} else {
			modelsURL += "/v1/models"
		}
	}
	return fetchModelsFromAPI(modelsURL, apiKey, authType)
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
			errChunk := `{"choices":[{"delta":{"content":""},"finish_reason":"error"}]}`
			w.Write([]byte("data: " + errChunk + "\n\n"))
			w.Write([]byte("data: [DONE]\n\n"))
			flusher.Flush()
			return
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if strings.HasPrefix(line, ":") {
			continue
		}

		if strings.HasPrefix(line, "data:") {
			line = strings.TrimPrefix(line, "data:")
			line = strings.TrimSpace(line)
		}

		if line == "[DONE]" {
			w.Write([]byte("data: [DONE]\n\n"))
			flusher.Flush()
			break
		}

		if line == "" {
			continue
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

var (
	sharedDirectClient *http.Client
	sharedProxyClient  *http.Client
	clientOnce         sync.Once
)

func getSharedClient() *http.Client {
	clientOnce.Do(func() {
		sharedDirectClient = newHTTPClient("")
		if proxyURL := getProxy(); proxyURL != nil {
			sharedProxyClient = newHTTPClient(proxyURL.String())
		} else {
			sharedProxyClient = sharedDirectClient
		}
	})
	if getProxy() != nil {
		return sharedProxyClient
	}
	return sharedDirectClient
}

func doProxy(w http.ResponseWriter, proxyReq *http.Request) {
	client := getSharedClient()
	resp, err := client.Do(proxyReq)
	if err != nil {
		openAIError(w, "Failed to send request to upstream", http.StatusBadGateway, "bad_gateway")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if err != nil {
			openAIError(w, "Failed to read error response", http.StatusBadGateway, "bad_gateway")
			return
		}
		wrapped := wrapError(body, resp.StatusCode)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Del("Content-Length")
		w.WriteHeader(resp.StatusCode)
		w.Write(wrapped)
		return
	}

	if strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
		copyHeaders(w.Header(), resp.Header)
		w.WriteHeader(resp.StatusCode)
		handleStreamingResponse(w, resp.Body)
	} else {
		body, err := io.ReadAll(io.LimitReader(resp.Body, 50<<20))
		if err != nil {
			openAIError(w, "Failed to read response body", http.StatusBadGateway, "bad_gateway")
			return
		}
		normalizedBody := normalizeResponse(body)
		copyHeaders(w.Header(), resp.Header)
		w.Header().Del("Content-Length")
		w.WriteHeader(resp.StatusCode)
		w.Write(normalizedBody)
	}
}

func wrapError(body []byte, status int) []byte {
	var resp map[string]interface{}
	if err := json.Unmarshal(body, &resp); err != nil {
		return body
	}
	if _, ok := resp["error"]; ok {
		return body
	}
	wrapped := map[string]interface{}{
		"error": map[string]interface{}{
			"message": fmt.Sprintf("Upstream error (HTTP %d)", status),
			"type":    "upstream_error",
			"code":    status,
			"internal": resp,
		},
	}
	errMap := wrapped["error"].(map[string]interface{})
	if errMsg, ok := resp["error"].(string); ok {
		errMap["message"] = errMsg
	}
	if errObj, ok := resp["error"].(map[string]interface{}); ok {
		if msg, ok := errObj["message"].(string); ok {
			errMap["message"] = msg
		}
		if t, ok := errObj["type"].(string); ok {
			errMap["type"] = t
		}
		if code, ok := errObj["code"].(string); ok {
			errMap["code"] = code
		}
	}
	result, _ := json.Marshal(wrapped)
	return result
}

func proxyOpenAIRequest(baseURL, apiKey string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		upstreamURL := baseURL + r.URL.Path
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

		copyHeaders(proxyReq.Header, r.Header)
		if apiKey != "" {
			proxyReq.Header.Set("Authorization", "Bearer "+apiKey)
		}

		doProxy(w, proxyReq)
	}
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
	case "glm-coding":
		return NewGLMCodingProvider(apiKey), nil
	case "minimax-tokenplan":
		return NewMiniMaxTokenPlanProvider(apiKey), nil
	case "arkcode":
		return NewArkCodeProvider(apiKey), nil
	default:
		return nil, fmt.Errorf("unsupported provider type: %s", providerType)
	}
}
