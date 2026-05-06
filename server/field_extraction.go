package main

import (
	"bytes"
	"encoding/json"
	"strings"
)

func jsonGet(data interface{}, path string) interface{} {
	parts := strings.Split(path, ".")
	v := data
	for _, p := range parts {
		m, ok := v.(map[string]interface{})
		if !ok {
			return nil
		}
		v, ok = m[p]
		if !ok {
			return nil
		}
	}
	return v
}

func extractField(body []byte, path string) interface{} {
	var data interface{}
	if json.Unmarshal(body, &data) != nil {
		return nil
	}
	return jsonGet(data, path)
}

func extractTextsForSecurity(body []byte, paths []string) []string {
	var data interface{}
	if json.Unmarshal(body, &data) != nil {
		return nil
	}
	var texts []string
	for _, path := range paths {
		if idx := strings.Index(path, "[*]"); idx >= 0 {
			arrPath := path[:idx]
			subPath := strings.TrimPrefix(path[idx+3:], ".")
			arr := jsonGet(data, arrPath)
			if items, ok := arr.([]interface{}); ok {
				for _, item := range items {
					var v interface{}
					if subPath != "" {
						v = jsonGet(item, subPath)
					} else {
						v = item
					}
					collectStringValues(v, &texts)
				}
			}
		} else {
			v := jsonGet(data, path)
			collectStringValues(v, &texts)
		}
	}
	return texts
}

func collectStringValues(v interface{}, out *[]string) {
	switch val := v.(type) {
	case string:
		if val != "" {
			*out = append(*out, val)
		}
	case []interface{}:
		for _, item := range val {
			if m, ok := item.(map[string]interface{}); ok {
				if t, ok := m["type"].(string); ok && t == "text" {
					if s, ok := m["text"].(string); ok && s != "" {
						*out = append(*out, s)
					}
				}
			}
		}
	}
}

func extractModelFromBody(body []byte, spec *UsageExtraction) string {
	if spec == nil || spec.ModelPath == "" {
		if s, ok := extractField(body, "model").(string); ok {
			return s
		}
		return ""
	}
	if s, ok := extractField(body, spec.ModelPath).(string); ok {
		return s
	}
	return ""
}

func extractTokensFromBody(body []byte, spec *UsageExtraction) (int, int) {
	if spec == nil {
		return 0, 0
	}
	usagePath := spec.UsagePath
	if usagePath == "" {
		usagePath = "usage"
	}
	inputField := spec.InputField
	if inputField == "" {
		inputField = "prompt_tokens"
	}
	outputField := spec.OutputField
	if outputField == "" {
		outputField = "completion_tokens"
	}
	usage := extractField(body, usagePath)
	m, ok := usage.(map[string]interface{})
	if !ok {
		return 0, 0
	}
	var in, out int
	if v, ok := m[inputField].(float64); ok {
		in = int(v)
	}
	if v, ok := m[outputField].(float64); ok {
		out = int(v)
	}
	return in, out
}

func extractTokensFromStreamUsage(data []byte, spec *UsageExtraction) (int, int) {
	inputField := "prompt_tokens"
	outputField := "completion_tokens"
	inputFieldAlt := "input_tokens"
	outputFieldAlt := "output_tokens"
	usagePath := "usage"
	if spec != nil {
		if spec.InputField != "" {
			inputField = spec.InputField
		}
		if spec.OutputField != "" {
			outputField = spec.OutputField
		}
		if spec.UsagePath != "" {
			usagePath = spec.UsagePath
		}
	}

	var totalIn, totalOut int
	segments := bytes.Split(data, []byte("}{"))
	for i, seg := range segments {
		var chunk []byte
		if i == 0 {
			chunk = seg
		} else {
			chunk = append([]byte("{"), seg...)
		}
		if i < len(segments)-1 {
			chunk = append(chunk, "}"...)
		}
		if len(chunk) < 3 {
			continue
		}
		var parsed map[string]interface{}
		if json.Unmarshal(chunk, &parsed) != nil {
			continue
		}

		usage := jsonGet(parsed, usagePath)
		if m, ok := usage.(map[string]interface{}); ok {
			if v, ok := m[inputField].(float64); ok {
				totalIn += int(v)
			}
			if v, ok := m[outputField].(float64); ok {
				totalOut += int(v)
			}
			if v, ok := m[inputFieldAlt].(float64); ok && totalIn == 0 {
				totalIn += int(v)
			}
			if v, ok := m[outputFieldAlt].(float64); ok && totalOut == 0 {
				totalOut += int(v)
			}
		}

		if totalIn == 0 || totalOut == 0 {
			for _, key := range []string{"input_tokens", "prompt_tokens"} {
				if v, ok := parsed[key].(float64); ok && totalIn == 0 {
					totalIn = int(v)
				}
			}
			for _, key := range []string{"output_tokens", "completion_tokens"} {
				if v, ok := parsed[key].(float64); ok && totalOut == 0 {
					totalOut = int(v)
				}
			}
		}
	}
	return totalIn, totalOut
}
