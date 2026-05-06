package main

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
)

func dbGetSetting(key string) string {
	dbMu.Lock()
	defer dbMu.Unlock()
	var val string
	err := db.QueryRow("SELECT value FROM system_settings WHERE key = ?", key).Scan(&val)
	if err != nil {
		return ""
	}
	return val
}

func dbSetSetting(key, value string) {
	dbMu.Lock()
	defer dbMu.Unlock()
	_, err := db.Exec("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)", key, value)
	if err != nil {
		log.Printf("[ERROR] dbSetSetting %s: %v", key, err)
	}
}

func dbGetSettingsByPrefix(prefix string) map[string]string {
	dbMu.Lock()
	defer dbMu.Unlock()
	rows, err := db.Query("SELECT key, value FROM system_settings WHERE key LIKE ?", prefix+"%")
	if err != nil {
		return map[string]string{}
	}
	defer rows.Close()
	m := map[string]string{}
	for rows.Next() {
		var k, v string
		if rows.Scan(&k, &v) == nil {
			m[strings.TrimPrefix(k, prefix)] = v
		}
	}
	return m
}

func dbGetBoolSetting(key string, def bool) bool {
	v := dbGetSetting(key)
	if v == "" {
		return def
	}
	return v == "true" || v == "1"
}

func dbGetIntSetting(key string, def int) int {
	v := dbGetSetting(key)
	if v == "" {
		return def
	}
	var n int
	fmt.Sscanf(v, "%d", &n)
	if n == 0 && v != "0" {
		return def
	}
	return n
}

func dbGetStringSetting(key, def string) string {
	v := dbGetSetting(key)
	if v == "" {
		return def
	}
	return v
}

var providerCache []map[string]interface{}
var providerCacheMu sync.RWMutex

func dbListProviders() []map[string]interface{} {
	providerCacheMu.RLock()
	if providerCache != nil {
		defer providerCacheMu.RUnlock()
		return providerCache
	}
	providerCacheMu.RUnlock()

	dbMu.Lock()
	defer dbMu.Unlock()
	rows, err := db.Query("SELECT id, name, provider_type, auth_type, enabled, base_url, api_key, models, disabled_models, oauth_config, rate_limits, priority, created_by, created_at, updated_at FROM providers ORDER BY priority ASC, name ASC")
	if err != nil {
		return []map[string]interface{}{}
	}
	defer rows.Close()
	var result []map[string]interface{}
	for rows.Next() {
		var id, name, ptype, authType, baseURL, apiKey, models, disabled, oauthCfg, rateLimits, createdBy, createdAt, updatedAt string
		var enabled int
		var priority int
		if err := rows.Scan(&id, &name, &ptype, &authType, &enabled, &baseURL, &apiKey, &models, &disabled, &oauthCfg, &rateLimits, &priority, &createdBy, &createdAt, &updatedAt); err != nil {
			continue
		}
		var modelsArr []string
		json.Unmarshal([]byte(models), &modelsArr)
		if modelsArr == nil {
			modelsArr = []string{}
		}
		var disabledArr []string
		json.Unmarshal([]byte(disabled), &disabledArr)
		if disabledArr == nil {
			disabledArr = []string{}
		}
		var oauth interface{}
		if oauthCfg != "" && oauthCfg != "null" {
			json.Unmarshal([]byte(oauthCfg), &oauth)
		}
		var rl interface{}
		if rateLimits != "" && rateLimits != "null" {
			json.Unmarshal([]byte(rateLimits), &rl)
		}
		apiKeys := []map[string]interface{}{}
		if apiKey != "" {
			apiKeys = append(apiKeys, map[string]interface{}{
				"id": id + "_key1", "key_value": apiKey, "name": "默认密钥",
				"is_active": true, "created_at": createdAt, "usage_count": 0,
			})
		}
		m := map[string]interface{}{
			"id": id, "name": name, "provider_type": ptype, "auth_type": authType,
			"enabled": enabled == 1, "base_url": baseURL, "api_keys": apiKeys,
			"models": modelsArr, "disabled_models": disabledArr,
			"oauth_config": oauth, "rate_limits": rl, "priority": priority,
			"created_by": createdBy, "created_at": createdAt, "updated_at": updatedAt,
		}
		result = append(result, m)
	}
	if result == nil {
		result = []map[string]interface{}{}
	}
	providerCacheMu.Lock()
	providerCache = result
	providerCacheMu.Unlock()
	return result
}

func invalidateProviderCache() {
	providerCacheMu.Lock()
	providerCache = nil
	providerCacheMu.Unlock()
}

func dbAddProvider(p map[string]interface{}) error {
	invalidateProviderCache()
	dbMu.Lock()
	defer dbMu.Unlock()
	models, _ := json.Marshal(sliceOrNil(p["models"]))
	disabled, _ := json.Marshal(sliceOrNil(p["disabled_models"]))
	oauth, _ := json.Marshal(p["oauth_config"])
	rates, _ := json.Marshal(p["rate_limits"])
	apiKey := ""
	if keys, ok := p["api_keys"].([]interface{}); ok && len(keys) > 0 {
		if km, ok := keys[0].(map[string]interface{}); ok {
			if kv, ok := km["key_value"].(string); ok {
				apiKey = kv
			}
		}
	}
	enabled := 0
	if e, ok := p["enabled"].(bool); ok && e {
		enabled = 1
	}
	_, err := db.Exec(`INSERT OR REPLACE INTO providers (id, name, provider_type, auth_type, enabled, base_url, api_key, models, disabled_models, oauth_config, rate_limits, priority, created_by, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p["id"], p["name"], p["provider_type"], strOr(p["auth_type"], "apikey"),
		enabled, strOr(p["base_url"], ""), apiKey, string(models), string(disabled),
		string(oauth), string(rates), intOr(p["priority"], 0), strOr(p["created_by"], ""),
		strOr(p["created_at"], ""), strOr(p["updated_at"], ""))
	return err
}

func dbUpdateProvider(id string, p map[string]interface{}) error {
	invalidateProviderCache()
	dbMu.Lock()
	defer dbMu.Unlock()
	models, _ := json.Marshal(sliceOrNil(p["models"]))
	disabled, _ := json.Marshal(sliceOrNil(p["disabled_models"]))
	oauth, _ := json.Marshal(p["oauth_config"])
	rates, _ := json.Marshal(p["rate_limits"])
	apiKey := ""
	if keys, ok := p["api_keys"].([]interface{}); ok && len(keys) > 0 {
		if km, ok := keys[0].(map[string]interface{}); ok {
			if kv, ok := km["key_value"].(string); ok {
				apiKey = kv
			}
		}
	}
	enabled := 0
	if e, ok := p["enabled"].(bool); ok && e {
		enabled = 1
	}
	_, err := db.Exec(`UPDATE providers SET name=?, provider_type=?, auth_type=?, enabled=?, base_url=?, api_key=?, models=?, disabled_models=?, oauth_config=?, rate_limits=?, priority=?, created_by=?, updated_at=? WHERE id=?`,
		p["name"], p["provider_type"], strOr(p["auth_type"], "apikey"),
		enabled, strOr(p["base_url"], ""), apiKey, string(models), string(disabled),
		string(oauth), string(rates), intOr(p["priority"], 0), strOr(p["created_by"], ""),
		strOr(p["updated_at"], ""), id)
	return err
}

func dbDeleteProvider(id string) error {
	invalidateProviderCache()
	dbMu.Lock()
	defer dbMu.Unlock()
	_, err := db.Exec("DELETE FROM providers WHERE id = ?", id)
	return err
}

func dbListModelMappings() []map[string]interface{} {
	dbMu.Lock()
	defer dbMu.Unlock()
	rows, err := db.Query("SELECT alias, provider_id, model, description FROM model_mappings")
	if err != nil {
		return []map[string]interface{}{}
	}
	defer rows.Close()
	var result []map[string]interface{}
	for rows.Next() {
		var alias, providerID, model, desc string
		if rows.Scan(&alias, &providerID, &model, &desc) == nil {
			result = append(result, map[string]interface{}{
				"alias": alias, "provider_id": providerID, "model": model, "description": desc,
			})
		}
	}
	if result == nil {
		result = []map[string]interface{}{}
	}
	return result
}

func dbSetModelMapping(alias, providerID, model, desc string) error {
	dbMu.Lock()
	defer dbMu.Unlock()
	_, err := db.Exec("INSERT OR REPLACE INTO model_mappings (alias, provider_id, model, description) VALUES (?, ?, ?, ?)",
		alias, providerID, model, desc)
	return err
}

func dbDeleteModelMapping(alias string) error {
	dbMu.Lock()
	defer dbMu.Unlock()
	_, err := db.Exec("DELETE FROM model_mappings WHERE alias = ?", alias)
	return err
}

func dbListProfiles() []map[string]interface{} {
	dbMu.Lock()
	defer dbMu.Unlock()
	rows, err := db.Query("SELECT id, name, providers_json, mappings_json, gateway_json, advanced_json, service_json, is_active, created_at, updated_at FROM profiles ORDER BY created_at")
	if err != nil {
		return []map[string]interface{}{}
	}
	defer rows.Close()
	var result []map[string]interface{}
	for rows.Next() {
		var id, name, provJ, mapJ, gwJ, advJ, svcJ string
		var isActive int
		var createdAt, updatedAt string
		if rows.Scan(&id, &name, &provJ, &mapJ, &gwJ, &advJ, &svcJ, &isActive, &createdAt, &updatedAt) == nil {
			result = append(result, map[string]interface{}{
				"id": id, "name": name, "is_active": isActive == 1,
				"providers_json": provJ, "mappings_json": mapJ, "gateway_json": gwJ,
				"advanced_json": advJ, "service_json": svcJ,
				"created_at": createdAt, "updated_at": updatedAt,
			})
		}
	}
	if result == nil {
		result = []map[string]interface{}{}
	}
	return result
}

func dbSaveProfile(id, name string, prov, mappings, gateway, advanced, service map[string]interface{}) error {
	pj, _ := json.Marshal(prov)
	mj, _ := json.Marshal(mappings)
	gj, _ := json.Marshal(gateway)
	aj, _ := json.Marshal(advanced)
	sj, _ := json.Marshal(service)
	dbMu.Lock()
	defer dbMu.Unlock()
	_, err := db.Exec(`INSERT OR REPLACE INTO profiles (id, name, providers_json, mappings_json, gateway_json, advanced_json, service_json, is_active, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
		id, name, string(pj), string(mj), string(gj), string(aj), string(sj))
	return err
}

func dbLoadProfile(id string) (map[string]interface{}, error) {
	dbMu.Lock()
	defer dbMu.Unlock()
	var name, provJ, mapJ, gwJ, advJ, svcJ string
	err := db.QueryRow("SELECT name, providers_json, mappings_json, gateway_json, advanced_json, service_json FROM profiles WHERE id = ?", id).
		Scan(&name, &provJ, &mapJ, &gwJ, &advJ, &svcJ)
	if err != nil {
		return nil, fmt.Errorf("profile not found")
	}
	var prov, mappings, gateway, advanced, service map[string]interface{}
	json.Unmarshal([]byte(provJ), &prov)
	json.Unmarshal([]byte(mapJ), &mappings)
	json.Unmarshal([]byte(gwJ), &gateway)
	json.Unmarshal([]byte(advJ), &advanced)
	json.Unmarshal([]byte(svcJ), &service)
	return map[string]interface{}{
		"name": name, "providers": prov, "mappings": mappings,
		"gateway": gateway, "advanced": advanced, "service": service,
	}, nil
}

func dbDeleteProfile(id string) error {
	dbMu.Lock()
	defer dbMu.Unlock()
	_, err := db.Exec("DELETE FROM profiles WHERE id = ?", id)
	return err
}

func dbRenameProfile(id, newName string) error {
	dbMu.Lock()
	defer dbMu.Unlock()
	_, err := db.Exec("UPDATE profiles SET name = ?, updated_at = datetime('now') WHERE id = ?", newName, id)
	return err
}

func dbSetActiveProfile(id string) error {
	dbMu.Lock()
	defer dbMu.Unlock()
	db.Exec("UPDATE profiles SET is_active = 0")
	_, err := db.Exec("UPDATE profiles SET is_active = 1, updated_at = datetime('now') WHERE id = ?", id)
	return err
}

func dbGetActiveProfile() string {
	dbMu.Lock()
	defer dbMu.Unlock()
	var id string
	err := db.QueryRow("SELECT id FROM profiles WHERE is_active = 1").Scan(&id)
	if err != nil {
		return "default"
	}
	return id
}

func dbGetUserSetting(userID, key string) string {
	dbMu.Lock()
	defer dbMu.Unlock()
	var val string
	err := db.QueryRow("SELECT value FROM user_settings WHERE user_id = ? AND key = ?", userID, key).Scan(&val)
	if err != nil {
		return ""
	}
	return val
}

func dbSetUserSetting(userID, key, value string) error {
	dbMu.Lock()
	defer dbMu.Unlock()
	_, err := db.Exec("INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)", userID, key, value)
	return err
}

func dbGetAllUserSettings(userID string) map[string]string {
	dbMu.Lock()
	defer dbMu.Unlock()
	rows, err := db.Query("SELECT key, value FROM user_settings WHERE user_id = ?", userID)
	if err != nil {
		return map[string]string{}
	}
	defer rows.Close()
	m := map[string]string{}
	for rows.Next() {
		var k, v string
		if rows.Scan(&k, &v) == nil {
			m[k] = v
		}
	}
	return m
}

func strOr(v interface{}, def string) string {
	if s, ok := v.(string); ok {
		return s
	}
	return def
}

func intOr(v interface{}, def int) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	}
	return def
}

func sliceOrNil(v interface{}) []string {
	if arr, ok := v.([]string); ok {
		return arr
	}
	if arr, ok := v.([]interface{}); ok {
		var result []string
		for _, item := range arr {
			if s, ok := item.(string); ok {
				result = append(result, s)
			}
		}
		return result
	}
	return []string{}
}
