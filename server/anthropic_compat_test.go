package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

type mockProvider struct {
	name    string
	baseURL string
	models  []string
	apiKey  string
}

func (m *mockProvider) GetName() string                          { return m.name }
func (m *mockProvider) GetBaseURL() string                       { return m.baseURL }
func (m *mockProvider) GetModels() []string                      { return m.models }
func (m *mockProvider) GetAPIKey() string                        { return m.apiKey }
func (m *mockProvider) ProxyRequest(w http.ResponseWriter, r *http.Request) {}
func (m *mockProvider) TestConnection() error                    { return nil }
func (m *mockProvider) FetchModels() []string                    { return nil }
func (m *mockProvider) SetBaseURL(url string)                    { m.baseURL = url }

func newTestProxyServer() *ProxyServer {
	return &ProxyServer{
		providers: map[string]Provider{
			"openai":    &mockProvider{name: "openai", models: []string{"gpt-4"}},
			"deepseek":  &mockProvider{name: "deepseek", models: []string{"deepseek-chat"}},
			"anthropic": &mockProvider{name: "anthropic", models: []string{"claude-3-sonnet"}},
		},
	}
}

func TestResolveProvider(t *testing.T) {
	p := newTestProxyServer()
	tests := []struct {
		name     string
		model    string
		wantProv string
		wantMod  string
	}{
		{"with prefix", "openai:gpt-4", "openai", "gpt-4"},
		{"deepseek prefix", "deepseek:deepseek-chat", "deepseek", "deepseek-chat"},
		{"anthropic prefix", "anthropic:claude-3-sonnet", "anthropic", "claude-3-sonnet"},
		{"unknown model", "unknown-model", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			prov, m := p.resolveProvider(tt.model)
			if tt.wantProv == "" {
				if prov != nil {
					t.Errorf("resolveProvider(%q) expected nil provider", tt.model)
				}
				return
			}
			if prov == nil {
				t.Fatalf("resolveProvider(%q) returned nil provider, want %q", tt.model, tt.wantProv)
			}
			if prov.GetName() != tt.wantProv {
				t.Errorf("resolveProvider(%q) provider = %q, want %q", tt.model, prov.GetName(), tt.wantProv)
			}
			if m != tt.wantMod {
				t.Errorf("resolveProvider(%q) model = %q, want %q", tt.model, m, tt.wantMod)
			}
		})
	}
}

func TestSanitizeJSONMap(t *testing.T) {
	input := map[string]interface{}{
		"safe":     "value",
		"api_key":  "sk-secret123",
		"password": "hunter2",
	}
	result := sanitizeJSONMap(input)

	var parsed map[string]interface{}
	json.Unmarshal(result, &parsed)

	if parsed["safe"] != "value" {
		t.Error("safe value should be preserved")
	}
	if parsed["api_key"] == "sk-secret123" {
		t.Error("api_key should be sanitized")
	}
	if parsed["password"] == "hunter2" {
		t.Error("password should be sanitized")
	}
	if parsed["api_key"] != "***" {
		t.Errorf("api_key = %v, want ***", parsed["api_key"])
	}
	if parsed["password"] != "***" {
		t.Errorf("password = %v, want ***", parsed["password"])
	}
}

func TestKnownProviderBaseURL(t *testing.T) {
	tests := []struct {
		model string
		want  string
	}{
		{"openai:gpt-4", "https://api.openai.com"},
		{"deepseek:deepseek-chat", "https://api.deepseek.com"},
		{"unknown:model", ""},
		{"no-prefix", ""},
	}
	for _, tt := range tests {
		got := knownProviderBaseURL(tt.model)
		if got != tt.want {
			t.Errorf("knownProviderBaseURL(%q) = %q, want %q", tt.model, got, tt.want)
		}
	}
}
