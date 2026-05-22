package main

import (
	"testing"
)

func TestExtractContentFromResp(t *testing.T) {
	tests := []struct {
		name    string
		resp    map[string]interface{}
		wantOK  bool
		wantHas string
	}{
		{
			"OpenAI format",
			map[string]interface{}{
				"choices": []interface{}{
					map[string]interface{}{
						"message": map[string]interface{}{
							"content": "Hello from OpenAI",
						},
					},
				},
			},
			true, "Hello from OpenAI",
		},
		{
			"Anthropic format",
			map[string]interface{}{
				"content": []interface{}{
					map[string]interface{}{
						"type": "text",
						"text": "Hello from Anthropic",
					},
				},
			},
			true, "Hello from Anthropic",
		},
		{
			"Empty response",
			map[string]interface{}{},
			false, "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractContentFromResp(tt.resp)
			if tt.wantOK && got == "" {
				t.Error("expected non-empty content")
			}
			if !tt.wantOK && got != "" {
				t.Errorf("expected empty content, got %q", got)
			}
			if tt.wantOK && got != "" && tt.wantHas != "" {
				if !containsSubstring(got, tt.wantHas) {
					t.Errorf("content = %q, want to contain %q", got, tt.wantHas)
				}
			}
		})
	}
}

func containsSubstring(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func TestNormalizeContent(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"HelloWorld", "HelloWorld"},
		{"UPPERCASE", "UPPERCASE"},
		{"  spaces  ", "spaces"},
		{"Test123", "Test123"},
		{"hello world", "helloworld"},
		{"Test\nLine", "TestLine"},
	}
	for _, tt := range tests {
		got := normalizeContent(tt.input)
		if got != tt.want {
			t.Errorf("normalizeContent(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestKeywordWhitelistExemptsBlacklistedContent(t *testing.T) {
	cfg := SecurityConfig{
		KeywordByCategory: map[string]map[string][]string{
			"sensitive_data": {"high": {"secret"}},
		},
		KeywordLevels:     []string{"high"},
		KeywordWhitelist:  []string{"safe secret"},
	}
	rebuildMatchers(&cfg)

	matched, _, _, _ := checkKeywords("this is a safe secret example")
	if matched {
		t.Fatal("expected whitelist match to exempt blacklisted keyword")
	}
}

func TestKeywordWhitelistDoesNotDisableOtherBlacklistedContent(t *testing.T) {
	cfg := SecurityConfig{
		KeywordByCategory: map[string]map[string][]string{
			"sensitive_data": {"high": {"secret"}},
		},
		KeywordLevels:     []string{"high"},
		KeywordWhitelist:  []string{"safe secret"},
	}
	rebuildMatchers(&cfg)

	matched, cat, level, kw := checkKeywords("this contains secret only")
	if !matched {
		t.Fatal("expected blacklisted keyword to match when whitelist does not match")
	}
	if cat != "sensitive_data" || level != "high" || kw != "secret" {
		t.Fatalf("match = (%q, %q, %q), want (sensitive_data, high, secret)", cat, level, kw)
	}
}

func TestKeywordWhitelistUsesSameNormalizationAsBlacklist(t *testing.T) {
	cfg := SecurityConfig{
		KeywordByCategory: map[string]map[string][]string{
			"sensitive_data": {"high": {"secret"}},
		},
		KeywordLevels:     []string{"high"},
		KeywordWhitelist:  []string{"safe-secret"},
	}
	rebuildMatchers(&cfg)

	matched, _, _, _ := checkKeywords("this is a safe secret example")
	if matched {
		t.Fatal("expected whitelist normalization to ignore punctuation like blacklist matching")
	}
}

func TestExtractJSON(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{"valid json", `{"key": "value"}`, true},
		{"json in markdown", "```json\n{\"key\": \"value\"}\n```", true},
		{"embedded json", `Here is the result: {"a": 1} end`, true},
		{"no json", "plain text without json", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractJSON(tt.input)
			if (result != nil) != tt.want {
				t.Errorf("extractJSON(%q) returned %v, want nil=%v", tt.input, result == nil, !tt.want)
			}
		})
	}
}

func TestExtractContentFromRequest(t *testing.T) {
	req := map[string]interface{}{
		"messages": []interface{}{
			map[string]interface{}{
				"role":    "user",
				"content": "Hello there",
			},
			map[string]interface{}{
				"role": "assistant",
				"content": []interface{}{
					map[string]interface{}{
						"type": "text",
						"text": "Hi!",
					},
				},
			},
		},
	}
	got := extractContentFromRequest(req)
	if got != "Hello there Hi!" {
		t.Errorf("extractContentFromRequest = %q, want %q", got, "Hello there Hi!")
	}
}

func TestExtractContentFromResponse(t *testing.T) {
	resp := map[string]interface{}{
		"choices": []interface{}{
			map[string]interface{}{
				"message": map[string]interface{}{
					"content": "Response text",
				},
			},
		},
	}
	got := extractContentFromResponse(resp)
	if got != "Response text" {
		t.Errorf("extractContentFromResponse = %q, want %q", got, "Response text")
	}
}

func TestTruncate(t *testing.T) {
	if truncate("short", 10) != "short" {
		t.Error("short string should not be truncated")
	}
	long := "abcdefghijklmnopqrstuvwxyz"
	result := truncate(long, 10)
	if len(result) != 13 {
		t.Errorf("truncate len = %d, want 13 (10 + '...')", len(result))
	}
}

func TestCategoryLabel(t *testing.T) {
	tests := []struct {
		cat  string
		want string
	}{
		{"sensitive_data", "敏感数据"},
		{"violence", "涉暴"},
		{"unknown", "unknown"},
	}
	for _, tt := range tests {
		got := categoryLabel(tt.cat)
		if got != tt.want {
			t.Errorf("categoryLabel(%q) = %q, want %q", tt.cat, got, tt.want)
		}
	}
}
