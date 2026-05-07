package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/bytedance/sonic"
)

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (p *ProxyServer) resolveProvider(model string) (Provider, string) {
	log.Printf("[DEBUG] resolveProvider called with model=%s", model)
	if strings.Contains(model, ":") {
		parts := strings.SplitN(model, ":", 2)
		if len(parts) == 2 {
			providerName := parts[0]
			modelName := parts[1]
			log.Printf("[DEBUG] resolveProvider: trying colon format, provider=%s, model=%s", providerName, modelName)
			if provider, exists := p.GetProvider(providerName); exists {
				log.Printf("[DEBUG] resolveProvider: found provider %s", providerName)
				return provider, modelName
			}
			log.Printf("[DEBUG] resolveProvider: provider %s not found in registry", providerName)
		}
	}
	parts := strings.SplitN(model, "/", 2)
	if len(parts) == 2 {
		providerName := parts[0]
		modelName := parts[1]
		log.Printf("[DEBUG] resolveProvider: trying slash format, provider=%s, model=%s", providerName, modelName)
		if provider, exists := p.GetProvider(providerName); exists {
			log.Printf("[DEBUG] resolveProvider: found provider %s", providerName)
			return provider, modelName
		}
		log.Printf("[DEBUG] resolveProvider: provider %s not found in registry", providerName)
	}

	for _, pr := range dbListProviders() {
		ptype, _ := pr["provider_type"].(string)
		if ptype == "" {
			continue
		}
		if modelList, ok := pr["models"].([]string); ok {
			for _, m := range modelList {
				if m == model {
					p.mu.RLock()
					prov := p.providers[ptype]
					p.mu.RUnlock()
					return prov, model
				}
			}
		}
	}

	log.Printf("[DEBUG] resolveProvider: no provider found for model %s", model)
	return nil, ""
}

var knownProviders = map[string]string{
	"siliconflow":       "https://api.siliconflow.cn",
	"openai":            "https://api.openai.com",
	"anthropic":         "https://api.anthropic.com",
	"deepseek":          "https://api.deepseek.com",
	"minimax":           "https://api.minimax.chat",
	"minimax-tokenplan": "https://api.minimaxi.com/anthropic",
	"glm":               "https://open.bigmodel.cn/api/paas/v4",
	"glm-coding":        "https://open.bigmodel.cn/api/coding/paas/v4",
	"doubao":            "https://ark.cn-beijing.volces.com/api/v3",
	"arkcode":           "https://ark.cn-beijing.volces.com/api/coding/v3",
	"qwen":              "https://dashscope.aliyuncs.com/compatible-mode",
	"moonshot":          "https://api.moonshot.cn",
	"yi":                "https://api.lingyiwanwu.com",
	"openrouter":        "https://openrouter.ai/api",
}

func knownProviderBaseURL(model string) string {
	if !strings.Contains(model, ":") {
		return ""
	}
	parts := strings.SplitN(model, ":", 2)
	if len(parts) != 2 {
		return ""
	}
	if baseURL, ok := knownProviders[parts[0]]; ok {
		return baseURL
	}
	return ""
}

var sensitiveLogKeys = map[string]bool{
	"password": true, "secret": true, "token": true, "api_key": true,
	"apikey": true, "key": true, "authorization": true, "cookie": true,
	"refresh_token": true, "access_token": true, "password_hash": true,
}

func sanitizeLogBody(body []byte) string {
	var m map[string]interface{}
	if sonic.Unmarshal(body, &m) != nil {
		return "[binary data]"
	}
	return string(sanitizeJSONMap(m))
}

func sanitizeJSONMap(m map[string]interface{}) []byte {
	sanitized := make(map[string]interface{}, len(m))
	for k, v := range m {
		if sensitiveLogKeys[strings.ToLower(k)] {
			sanitized[k] = "***"
		} else if sub, ok := v.(map[string]interface{}); ok {
			sanitized[k] = json.RawMessage(sanitizeJSONMap(sub))
		} else {
			sanitized[k] = v
		}
	}
	b, _ := sonic.Marshal(sanitized)
	return b
}

func sanitizeLogHeaders(h http.Header) http.Header {
	sanitized := make(http.Header)
	for k, vv := range h {
		if sensitiveLogKeys[strings.ToLower(k)] {
			sanitized[k] = []string{"***"}
		} else {
			sanitized[k] = vv
		}
	}
	return sanitized
}
