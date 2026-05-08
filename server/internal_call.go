package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

func isAnthropicProvider(provider Provider) bool {
	switch provider.(type) {
	case *AnthropicProvider, *GLMCodingProvider, *MiniMaxTokenPlanProvider:
		return true
	}
	return false
}

func (p *ProxyServer) getUsageSpecForProvider(providerName string) UsageExtraction {
	for i := range p.providerRoutes {
		if p.providerRoutes[i].Name == providerName {
			return p.providerRoutes[i].Usage
		}
	}
	return UsageExtraction{ModelPath: "model", UsagePath: "usage", InputField: "prompt_tokens", OutputField: "completion_tokens"}
}

func (p *ProxyServer) directModelCall(model string, messages []map[string]interface{}, temperature float64, maxTokens int) (int, int, int, []byte, error) {
	provider, modelName := p.resolveProvider(model)
	if provider == nil {
		p.mu.RLock()
		available := make([]string, 0, len(p.providers))
		for name := range p.providers {
			available = append(available, name)
		}
		p.mu.RUnlock()
		log.Printf("[INTERNAL] resolveProvider FAILED for model=%s, available=%v", model, available)
		return 0, 0, 0, nil, fmt.Errorf("no provider for model: %s", model)
	}
	log.Printf("[INTERNAL] resolved provider=%s model=%s", provider.GetName(), modelName)

	isAnthropic := isAnthropicProvider(provider)

	var reqBody map[string]interface{}
	if isAnthropic {
		anthMessages := []interface{}{}
		systemContent := ""
		for _, msg := range messages {
			role, _ := msg["role"].(string)
			content, _ := msg["content"].(string)
			if role == "system" {
				systemContent = content
				continue
			}
			anthMessages = append(anthMessages, map[string]interface{}{
				"role":    role,
				"content": content,
			})
		}
		reqBody = map[string]interface{}{
			"model":       modelName,
			"messages":    anthMessages,
			"max_tokens":  maxTokens,
			"temperature": temperature,
		}
		if systemContent != "" {
			reqBody["system"] = systemContent
		}
	} else {
		reqBody = map[string]interface{}{
			"model":       modelName,
			"messages":    messages,
			"temperature": temperature,
			"max_tokens":  maxTokens,
		}
	}

	body, _ := json.Marshal(reqBody)

	baseURL := provider.GetBaseURL()
	path := "/chat/completions"
	if isAnthropic {
		if strings.HasSuffix(baseURL, "/anthropic") || strings.HasSuffix(baseURL, "/anthropic/") {
			path = "/v1/messages"
		} else {
			path = "/messages"
		}
	}
	upstreamURL := strings.TrimRight(baseURL, "/") + path

	log.Printf("[INTERNAL] calling upstream=%s model=%s bodyLen=%d", upstreamURL, modelName, len(body))

	req, err := http.NewRequest("POST", upstreamURL, bytes.NewReader(body))
	if err != nil {
		return 0, 0, 0, nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	apiKey := provider.GetAPIKey()
	switch provider.(type) {
	case *AnthropicProvider, *GLMCodingProvider, *MiniMaxTokenPlanProvider:
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	default:
		if apiKey != "" {
			req.Header.Set("Authorization", "Bearer "+apiKey)
		}
	}

	startTime := time.Now()
	client := getSharedClient()
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[INTERNAL] ERROR upstream call failed: %v", err)
		dbInsertLog(&RequestLog{
			Timestamp:      startTime,
			Provider:       provider.GetName(),
			Model:          modelName,
			LatencyMs:      time.Since(startTime).Milliseconds(),
			Success:        false,
			ErrorMessage:   err.Error(),
			CallType:       "security",
			APIKeyUsed:     "",
			Path:           "/system-analysis/internal",
			Method:         "POST",
			RequestContent: truncateStr(string(body), 5000),
		})
		return 0, 0, 0, nil, fmt.Errorf("upstream call failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return resp.StatusCode, 0, 0, nil, fmt.Errorf("read response: %w", err)
	}

	preview := string(respBody)
	if len(preview) > 200 {
		preview = preview[:200]
	}
	log.Printf("[INTERNAL] response status=%d bodyLen=%d", resp.StatusCode, len(respBody))

	usageSpec := p.getUsageSpecForProvider(provider.GetName())
	inputTokens, outputTokens := extractTokensFromBody(respBody, &usageSpec)
	log.Printf("[INTERNAL] extracted tokens: input=%d output=%d", inputTokens, outputTokens)

	dbInsertLog(&RequestLog{
		Timestamp:       startTime,
		Provider:        provider.GetName(),
		Model:           modelName,
		InputTokens:     inputTokens,
		OutputTokens:    outputTokens,
		LatencyMs:       time.Since(startTime).Milliseconds(),
		Success:         resp.StatusCode >= 200 && resp.StatusCode < 300,
		CallType:        "security",
		APIKeyUsed:      "",
		StatusCode:      resp.StatusCode,
		Path:            "/system-analysis/internal",
		Method:          "POST",
		RequestContent:  truncateStr(string(body), 5000),
		ResponseContent: truncateStr(string(respBody), 5000),
	})

	_ = preview
	return resp.StatusCode, inputTokens, outputTokens, respBody, nil
}

func (p *ProxyServer) directEmbeddingCall(model string, input string) ([]float32, error) {
	provider, modelName := p.resolveProvider(model)
	if provider == nil {
		return nil, fmt.Errorf("no provider for embedding model: %s", model)
	}

	reqBody := map[string]interface{}{
		"model": modelName,
		"input": input,
	}
	body, _ := json.Marshal(reqBody)

	baseURL := provider.GetBaseURL()
	upstreamURL := baseURL + "/embeddings"

	req, err := http.NewRequest("POST", upstreamURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	apiKey := provider.GetAPIKey()
	switch provider.(type) {
	case *AnthropicProvider, *GLMCodingProvider, *MiniMaxTokenPlanProvider:
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	default:
		if apiKey != "" {
			req.Header.Set("Authorization", "Bearer "+apiKey)
		}
	}

	client := getSharedClient()
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("embedding call failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("embedding API returned status %d: %s", resp.StatusCode, truncateStr(string(respBody), 200))
	}

	var respData struct {
		Data []struct {
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &respData); err != nil {
		return nil, fmt.Errorf("failed to parse embedding response: %w", err)
	}
	if len(respData.Data) == 0 || len(respData.Data[0].Embedding) == 0 {
		return nil, fmt.Errorf("empty embedding response")
	}

	return respData.Data[0].Embedding, nil
}

var safeRecoverOnce sync.Once

func safeGo(fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[PANIC] goroutine recovered: %v", r)
			}
		}()
		fn()
	}()
}
