package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"gorm.io/gorm"
)

type FullConfig struct {
	Version       string                       `json:"version"`
	Providers     map[string]ProviderConfEntry `json:"providers"`
	Mappings      map[string]ModelMappingEntry `json:"mappings"`
	Gateway       GatewayConf                  `json:"gateway"`
	UI            UIConf                       `json:"ui"`
	Advanced      AdvancedConf                 `json:"advanced"`
	Service       ServiceConf                  `json:"service"`
	ActiveProfile string                       `json:"active_profile"`
	Profiles      map[string]ProfileConf       `json:"profiles"`
}

type ProviderApiKeyInfo struct {
	ID         string `json:"id"`
	KeyValue   string `json:"key_value"`
	Name       string `json:"name"`
	IsActive   bool   `json:"is_active"`
	CreatedAt  string `json:"created_at"`
	LastUsed   string `json:"last_used,omitempty"`
	UsageCount int64  `json:"usage_count"`
}

type ProviderConfEntry struct {
	ID             string               `json:"id"`
	Name            string               `json:"name"`
	ProviderType    string               `json:"provider_type"`
	AuthType        string               `json:"auth_type"`
	Enabled         bool                 `json:"enabled"`
	BaseURL         string               `json:"base_url"`
	ApiKeys         []ProviderApiKeyInfo `json:"api_keys"`
	Models          []string             `json:"models"`
	DisabledModels  []string             `json:"disabled_models"`
	OauthConfig     interface{}          `json:"oauth_config"`
	RateLimits      interface{}          `json:"rate_limits"`
	Priority        int                  `json:"priority"`
	CreatedAt       string               `json:"created_at"`
	UpdatedAt       string               `json:"updated_at"`
	CreatedBy       string               `json:"created_by"`
}

type ModelMappingEntry struct {
	Alias       string `json:"alias"`
	ProviderID  string `json:"provider_id"`
	Model       string `json:"model"`
	Description string `json:"description,omitempty"`
}

type GatewayConf struct {
	Port      uint16 `json:"port"`
	AdminPort uint16 `json:"admin_port"`
	UseTLS    bool   `json:"use_tls"`
	Host      string `json:"host"`
	APIKey    string `json:"api_key"`
	LogLevel  string `json:"log_level"`
}

type UIConf struct {
	Theme             string `json:"theme"`
	Language          string `json:"language"`
	Timezone          string `json:"timezone"`
	AutoStart         bool   `json:"auto_start"`
	MinimizeToTray    bool   `json:"minimize_to_tray"`
	ShowNotifications bool   `json:"show_notifications"`
}

type AdvancedConf struct {
	ProxyURL *string `json:"proxy_url"`
}

type ServiceConf struct {
	DeployMode       string  `json:"deploy_mode"`
	SetupComplete    bool    `json:"setup_complete"`
	RemoteServiceURL *string `json:"remote_service_url"`
	RemoteProxyURL   *string `json:"remote_proxy_url"`
}

type ProfileConf struct {
	Name      string                       `json:"name"`
	Providers map[string]ProviderConfEntry `json:"providers"`
	Mappings  map[string]ModelMappingEntry `json:"mappings"`
	Gateway   GatewayConf                  `json:"gateway"`
	Advanced  AdvancedConf                 `json:"advanced"`
	Service   ServiceConf                  `json:"service"`
}

func buildFullConfig() *FullConfig {
	cfg := &FullConfig{
		Version:       "1.0.0",
		Providers:     make(map[string]ProviderConfEntry),
		Mappings:      make(map[string]ModelMappingEntry),
		Gateway:       GatewayConf{Port: 8080, AdminPort: 8081, LogLevel: "info"},
		UI:            UIConf{Theme: "dark", Language: "zh-CN", Timezone: "Asia/Shanghai"},
		ActiveProfile: dbGetActiveProfile(),
		Profiles:      make(map[string]ProfileConf),
	}

	cfg.Gateway.Port = uint16(dbGetIntSetting("gateway.port", 8080))
	cfg.Gateway.AdminPort = uint16(dbGetIntSetting("gateway.admin_port", 8081))

	rtCfg := getGlobalConfig()
	if rtCfg.Port != "" {
		if p, err := strconv.Atoi(rtCfg.Port); err == nil && p > 0 {
			cfg.Gateway.Port = uint16(p)
		}
	}
	if rtCfg.AdminPort != "" {
		if p, err := strconv.Atoi(rtCfg.AdminPort); err == nil && p > 0 {
			cfg.Gateway.AdminPort = uint16(p)
		}
	}
	cfg.Gateway.UseTLS = dbGetBoolSetting("gateway.use_tls", true)
	cfg.Gateway.Host = dbGetStringSetting("gateway.host", "127.0.0.1")
	cfg.Gateway.APIKey = dbGetStringSetting("gateway.api_key", "")
	cfg.Gateway.LogLevel = dbGetStringSetting("gateway.log_level", "info")

	cfg.UI.Theme = dbGetStringSetting("ui.theme", "dark")
	cfg.UI.Language = dbGetStringSetting("ui.language", "zh-CN")
	cfg.UI.Timezone = dbGetStringSetting("ui.timezone", "Asia/Shanghai")
	cfg.UI.AutoStart = dbGetBoolSetting("ui.auto_start", false)
	cfg.UI.MinimizeToTray = dbGetBoolSetting("ui.minimize_to_tray", true)
	cfg.UI.ShowNotifications = dbGetBoolSetting("ui.show_notifications", true)

	proxyURL := dbGetStringSetting("advanced.proxy_url", "")
	if proxyURL != "" {
		cfg.Advanced.ProxyURL = &proxyURL
	}

	cfg.Service.DeployMode = dbGetStringSetting("service.deploy_mode", "pc")
	cfg.Service.SetupComplete = dbGetBoolSetting("service.setup_complete", false)
	rsu := dbGetStringSetting("service.remote_service_url", "")
	if rsu != "" {
		cfg.Service.RemoteServiceURL = &rsu
	}
	rpu := dbGetStringSetting("service.remote_proxy_url", "")
	if rpu != "" {
		cfg.Service.RemoteProxyURL = &rpu
	}

	for _, p := range dbListProviders() {
		entry := ProviderConfEntry{
			ID: strOr(p["id"], ""), Name: strOr(p["name"], ""),
			ProviderType: strOr(p["provider_type"], ""),
			AuthType: strOr(p["auth_type"], "apikey"),
			Enabled: p["enabled"] == true || p["enabled"] == float64(1),
			BaseURL: strOr(p["base_url"], ""),
			Priority: intOr(p["priority"], 0),
			CreatedBy: strOr(p["created_by"], ""),
			CreatedAt: strOr(p["created_at"], ""),
			UpdatedAt: strOr(p["updated_at"], ""),
		}
		if arr, ok := p["models"].([]string); ok {
			entry.Models = arr
		} else if arr, ok := p["models"].([]interface{}); ok {
			for _, v := range arr {
				if s, ok := v.(string); ok {
					entry.Models = append(entry.Models, s)
				}
			}
		}
		if entry.Models == nil {
			entry.Models = []string{}
		}
		if arr, ok := p["disabled_models"].([]string); ok {
			entry.DisabledModels = arr
		} else if arr, ok := p["disabled_models"].([]interface{}); ok {
			for _, v := range arr {
				if s, ok := v.(string); ok {
					entry.DisabledModels = append(entry.DisabledModels, s)
				}
			}
		}
		if entry.DisabledModels == nil {
			entry.DisabledModels = []string{}
		}
		entry.OauthConfig = p["oauth_config"]
		entry.RateLimits = p["rate_limits"]
		if keys, ok := p["api_keys"].([]map[string]interface{}); ok {
			for _, km := range keys {
				entry.ApiKeys = append(entry.ApiKeys, ProviderApiKeyInfo{
					ID: strOr(km["id"], ""), KeyValue: strOr(km["key_value"], ""),
					Name: strOr(km["name"], "默认密钥"), IsActive: km["is_active"] == true,
					CreatedAt: strOr(km["created_at"], ""), UsageCount: int64(intOr(km["usage_count"], 0)),
				})
			}
		}
		if entry.ApiKeys == nil {
			entry.ApiKeys = []ProviderApiKeyInfo{}
		}
		cfg.Providers[entry.ID] = entry
	}

	for _, m := range dbListModelMappings() {
		alias := strOr(m["alias"], "")
		if alias != "" {
			cfg.Mappings[alias] = ModelMappingEntry{
				Alias: alias, ProviderID: strOr(m["provider_id"], ""),
				Model: strOr(m["model"], ""), Description: strOr(m["description"], ""),
			}
		}
	}

	for _, pr := range dbListProfiles() {
		id := strOr(pr["id"], "")
		name := strOr(pr["name"], "")
		pconf := ProfileConf{Name: name}
		if pj, ok := pr["providers_json"].(string); ok && pj != "" {
			json.Unmarshal([]byte(pj), &pconf.Providers)
		}
		if mj, ok := pr["mappings_json"].(string); ok && mj != "" {
			json.Unmarshal([]byte(mj), &pconf.Mappings)
		}
		if gj, ok := pr["gateway_json"].(string); ok && gj != "" {
			json.Unmarshal([]byte(gj), &pconf.Gateway)
		}
		if aj, ok := pr["advanced_json"].(string); ok && aj != "" {
			json.Unmarshal([]byte(aj), &pconf.Advanced)
		}
		if sj, ok := pr["service_json"].(string); ok && sj != "" {
			json.Unmarshal([]byte(sj), &pconf.Service)
		}
		if pconf.Providers == nil {
			pconf.Providers = map[string]ProviderConfEntry{}
		}
		if pconf.Mappings == nil {
			pconf.Mappings = map[string]ModelMappingEntry{}
		}
		cfg.Profiles[id] = pconf
	}

	return cfg
}

func saveFullConfigToDB(cfg *FullConfig) {
	dbSetSetting("gateway.port", strconv.Itoa(int(cfg.Gateway.Port)))
	dbSetSetting("gateway.admin_port", strconv.Itoa(int(cfg.Gateway.AdminPort)))
	dbSetSetting("gateway.use_tls", strconv.FormatBool(cfg.Gateway.UseTLS))
	dbSetSetting("gateway.host", cfg.Gateway.Host)
	dbSetSetting("gateway.api_key", cfg.Gateway.APIKey)
	dbSetSetting("gateway.log_level", cfg.Gateway.LogLevel)

	dbSetSetting("ui.theme", cfg.UI.Theme)
	dbSetSetting("ui.language", cfg.UI.Language)
	dbSetSetting("ui.timezone", cfg.UI.Timezone)
	dbSetSetting("ui.auto_start", strconv.FormatBool(cfg.UI.AutoStart))
	dbSetSetting("ui.minimize_to_tray", strconv.FormatBool(cfg.UI.MinimizeToTray))
	dbSetSetting("ui.show_notifications", strconv.FormatBool(cfg.UI.ShowNotifications))

	proxyURL := ""
	if cfg.Advanced.ProxyURL != nil {
		proxyURL = *cfg.Advanced.ProxyURL
	}
	dbSetSetting("advanced.proxy_url", proxyURL)

	dbSetSetting("service.deploy_mode", cfg.Service.DeployMode)
	dbSetSetting("service.setup_complete", strconv.FormatBool(cfg.Service.SetupComplete))
	rsu := ""
	if cfg.Service.RemoteServiceURL != nil {
		rsu = *cfg.Service.RemoteServiceURL
	}
	dbSetSetting("service.remote_service_url", rsu)
	rpu := ""
	if cfg.Service.RemoteProxyURL != nil {
		rpu = *cfg.Service.RemoteProxyURL
	}
	dbSetSetting("service.remote_proxy_url", rpu)

	invalidateProviderCache()
	dbMu.Lock()
	gormDB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&DBProvider{})
	for _, p := range cfg.Providers {
		apiKey := ""
		for _, k := range p.ApiKeys {
			if k.IsActive && k.KeyValue != "" {
				apiKey = k.KeyValue
				break
			}
		}
		models, _ := json.Marshal(p.Models)
		disabled, _ := json.Marshal(p.DisabledModels)
		oauth, _ := json.Marshal(p.OauthConfig)
		rates, _ := json.Marshal(p.RateLimits)
		enabled := 0
		if p.Enabled {
			enabled = 1
		}
		gormDB.Save(&DBProvider{
			ID: p.ID, Name: p.Name, ProviderType: p.ProviderType, AuthType: p.AuthType,
			Enabled: enabled == 1, BaseURL: p.BaseURL, APIKey: apiKey,
			Models: string(models), DisabledModels: string(disabled),
			OAuthConfig: string(oauth), RateLimits: string(rates),
			Priority: p.Priority, CreatedBy: p.CreatedBy,
		})
	}
	dbMu.Unlock()

	dbMu.Lock()
	gormDB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&DBModelMapping{})
	for alias, m := range cfg.Mappings {
		gormDB.Save(&DBModelMapping{
			Alias: alias, ProviderID: m.ProviderID, Model: m.Model, Description: m.Description,
		})
	}
	dbMu.Unlock()
}

func (ps *ProxyServer) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	cfg := buildFullConfig()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg)
}

func (ps *ProxyServer) handleSaveConfig(w http.ResponseWriter, r *http.Request) {
	var newCfg FullConfig
	if err := json.NewDecoder(r.Body).Decode(&newCfg); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	saveFullConfigToDB(&newCfg)
	proxyURL := ""
	if newCfg.Advanced.ProxyURL != nil {
		proxyURL = *newCfg.Advanced.ProxyURL
	}
	if err := setProxy(proxyURL); err != nil {
		log.Printf("[WARN] failed to apply proxy: %v", err)
	}
	resetSharedClient()
	SetLogLevel(newCfg.Gateway.LogLevel)
	log.Printf("[INFO] config saved to SQLite (proxy=%s)", proxyURL)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (ps *ProxyServer) handleResetConfig(w http.ResponseWriter, r *http.Request) {
	dbMu.Lock()
	gormDB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&DBProvider{})
	gormDB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&DBModelMapping{})
	gormDB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&DBProfile{})
	gormDB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&DBSystemSetting{})
	gormDB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&DBUserSetting{})
	dbMu.Unlock()
	invalidateProviderCache()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "reset"})
}

func (ps *ProxyServer) handleAddProvider(w http.ResponseWriter, r *http.Request) {
	var provider map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&provider); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if provider["id"] == nil || provider["id"] == "" {
		provider["id"] = fmt.Sprintf("%d", time.Now().UnixMilli())
	}
	now := time.Now().UTC().Format(time.RFC3339)
	provider["created_at"] = now
	provider["updated_at"] = now
	provider["created_by"] = getUserIDFromRequest(r)

	if err := dbAddProvider(provider); err != nil {
		log.Printf("[ERROR] handleAddProvider: dbAddProvider failed: %v", err)
		http.Error(w, "save failed", http.StatusInternalServerError)
		return
	}

	if enabled, ok := provider["enabled"].(bool); ok && enabled {
		if keys, ok := provider["api_keys"].([]interface{}); ok {
			for _, k := range keys {
				if km, ok := k.(map[string]interface{}); ok {
					if isActive, ok := km["is_active"].(bool); ok && isActive {
						if kv, ok := km["key_value"].(string); ok && kv != "" {
							ptype := strOr(provider["provider_type"], "")
						safeGo(func() { syncProviderKey(ptype, kv) })
						}
					}
				}
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "id": strOr(provider["id"], "")})
}

func syncProviderKey(providerType, apiKey string) {
	cfg := getGlobalConfig()
	if cfg == nil {
		return
	}
	scheme := "http"
	if cfg.EnableTLS {
		scheme = "https"
	}
	url := fmt.Sprintf("%s://127.0.0.1:%s/api/v1/providers/%s/key", scheme, cfg.AdminPort, providerType)
	body, _ := json.Marshal(map[string]string{"api_key": apiKey})
	req, _ := http.NewRequest("PUT", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	client := getInternalClient()
	if client != nil {
		if resp, err := client.Do(req); err == nil {
			resp.Body.Close()
			log.Printf("[INFO] synced provider key for %s", providerType)
		} else {
			log.Printf("[WARN] sync provider key failed: %v", err)
		}
	}
}

func (ps *ProxyServer) handleUpdateProviderByID(w http.ResponseWriter, r *http.Request) {
	id := extractPathVar(r, "id")
	if id == "" {
		http.Error(w, "missing provider id", http.StatusBadRequest)
		return
	}
	userID, isAdmin := getUserAndRole(r)
	if !isAdmin && userID != "" {
		var p DBProvider
		if err := gormDB.Select("created_by").Where("id = ?", id).First(&p).Error; err == nil {
			if p.CreatedBy != userID {
				http.Error(w, "Forbidden: not your provider", http.StatusForbidden)
				return
			}
		}
	}
	var provider map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&provider); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	provider["updated_at"] = time.Now().UTC().Format(time.RFC3339)
	log.Printf("[API] handleUpdateProviderByID: id=%s, name=%v, disabled_models=%v, models_count=%v",
		id, provider["name"], provider["disabled_models"],
		func() int {
			if arr, ok := provider["models"].([]interface{}); ok {
				return len(arr)
			}
			return -1
		}())

	if err := dbUpdateProvider(id, provider); err != nil {
		log.Printf("[ERROR] handleUpdateProviderByID: dbUpdateProvider failed: %v", err)
		http.Error(w, "update failed", http.StatusInternalServerError)
		return
	}
	log.Printf("[API] handleUpdateProviderByID: updated provider %s successfully", id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (ps *ProxyServer) handleDeleteProviderByID(w http.ResponseWriter, r *http.Request) {
	id := extractPathVar(r, "id")
	if id == "" {
		http.Error(w, "missing provider id", http.StatusBadRequest)
		return
	}
	userID, isAdmin := getUserAndRole(r)
	if !isAdmin && userID != "" {
		var p DBProvider
		if err := gormDB.Select("created_by").Where("id = ?", id).First(&p).Error; err == nil {
			if p.CreatedBy != userID {
				http.Error(w, "Forbidden: not your provider", http.StatusForbidden)
				return
			}
		}
	}
	if err := dbDeleteProvider(id); err != nil {
		log.Printf("[ERROR] handleDeleteProviderByID: dbDeleteProvider failed: %v", err)
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (ps *ProxyServer) handleListProfiles(w http.ResponseWriter, r *http.Request) {
	type ProfileItem struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Active bool   `json:"active"`
	}
	active := dbGetActiveProfile()
	userID := getUserIDFromRequest(r)
	var items []ProfileItem
	for _, pr := range dbListProfiles(userID) {
		id := strOr(pr["id"], "")
		items = append(items, ProfileItem{
			ID: id, Name: strOr(pr["name"], ""), Active: id == active,
		})
	}
	if items == nil {
		items = []ProfileItem{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"profiles": items})
}

func (ps *ProxyServer) handleSaveAsProfile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProfileID   string `json:"profile_id"`
		DisplayName string `json:"display_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	userID := getUserIDFromRequest(r)
	cfg := buildFullConfig()
	if err := dbSaveProfile(req.ProfileID, req.DisplayName, userID,
		providersToMap(cfg.Providers), mappingsToMap(cfg.Mappings),
		gatewayToMap(cfg.Gateway), advancedToMap(cfg.Advanced),
		serviceToMap(cfg.Service)); err != nil {
		log.Printf("[ERROR] handleSaveAsProfile: dbSaveProfile failed: %v", err)
		http.Error(w, "save failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (ps *ProxyServer) handleProfileAction(w http.ResponseWriter, r *http.Request) {
	id := extractPathVar(r, "id")
	var req struct {
		Action  string `json:"action"`
		NewName string `json:"new_name"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	switch req.Action {
	case "load":
		data, err := dbLoadProfile(id)
		if err != nil {
			http.Error(w, "profile not found", http.StatusNotFound)
			return
		}
		cfg := buildFullConfig()
		if prov, ok := data["providers"].(map[string]interface{}); ok {
			newProv := make(map[string]ProviderConfEntry)
			for k, v := range prov {
				if b, err := json.Marshal(v); err == nil {
					var pe ProviderConfEntry
					json.Unmarshal(b, &pe)
					newProv[k] = pe
				}
			}
			cfg.Providers = newProv
		}
		if map_, ok := data["mappings"].(map[string]interface{}); ok {
			newMap := make(map[string]ModelMappingEntry)
			for k, v := range map_ {
				if b, err := json.Marshal(v); err == nil {
					var me ModelMappingEntry
					json.Unmarshal(b, &me)
					newMap[k] = me
				}
			}
			cfg.Mappings = newMap
		}
		if gw, ok := data["gateway"].(map[string]interface{}); ok {
			if b, err := json.Marshal(gw); err == nil {
				json.Unmarshal(b, &cfg.Gateway)
			}
		}
		if adv, ok := data["advanced"].(map[string]interface{}); ok {
			if b, err := json.Marshal(adv); err == nil {
				json.Unmarshal(b, &cfg.Advanced)
			}
		}
		if svc, ok := data["service"].(map[string]interface{}); ok {
			if b, err := json.Marshal(svc); err == nil {
				json.Unmarshal(b, &cfg.Service)
			}
		}
		saveFullConfigToDB(cfg)
		dbSetActiveProfile(id)
	case "rename":
		if err := dbRenameProfile(id, req.NewName); err != nil {
			http.Error(w, "rename failed", http.StatusInternalServerError)
			return
		}
	default:
		http.Error(w, "unknown action", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (ps *ProxyServer) handleDeleteProfile(w http.ResponseWriter, r *http.Request) {
	id := extractPathVar(r, "id")
	if id == dbGetActiveProfile() {
		http.Error(w, "cannot delete active profile", http.StatusBadRequest)
		return
	}
	if err := dbDeleteProfile(id); err != nil {
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (ps *ProxyServer) handleAppInfo(w http.ResponseWriter, r *http.Request) {
	cfg := getGlobalConfig()
	port, _ := strconv.Atoi(cfg.Port)
	adminPort, _ := strconv.Atoi(cfg.AdminPort)
	isServer := cfg.Host == "0.0.0.0"
	deployMode := "pc"
	if isServer {
		deployMode = "server"
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"version":     BuildVersion,
		"build_mode":  "server",
		"deploy_mode": deployMode,
		"proxy_port":  port,
		"admin_port":  adminPort,
	})
}

func (ps *ProxyServer) handleAppRestart(w http.ResponseWriter, r *http.Request) {
	log.Printf("[APP] Received restart request via API")
	go func() {
		time.Sleep(500 * time.Millisecond)
		os.Exit(0)
	}()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "restarting"})
}

func getUserIDFromRequest(r *http.Request) string {
	if claims := getUserFromContext(r); claims != nil {
		return claims.UserID
	}
	claims := getAuthClaimsFromRequest(r)
	if claims != nil {
		return claims.UserID
	}
	return ""
}

func isUserAdmin(r *http.Request) bool {
	claims := getAuthClaimsFromRequest(r)
	if claims != nil {
		return claims.Role == "admin"
	}
	return false
}

func getAuthClaimsFromRequest(r *http.Request) *UserClaims {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return nil
	}
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || parts[0] != "Bearer" {
		return nil
	}
	claims, err := validateToken(parts[1])
	if err != nil {
		return nil
	}
	return claims
}

func extractPathVar(r *http.Request, name string) string {
	vars := mux.Vars(r)
	if vars == nil {
		return ""
	}
	return vars[name]
}

func getInternalClient() *http.Client {
	return getSharedClient()
}

func providersToMap(p map[string]ProviderConfEntry) map[string]interface{} {
	m := make(map[string]interface{}, len(p))
	for k, v := range p {
		m[k] = v
	}
	return m
}

func mappingsToMap(m map[string]ModelMappingEntry) map[string]interface{} {
	r := make(map[string]interface{}, len(m))
	for k, v := range m {
		r[k] = v
	}
	return r
}

func gatewayToMap(g GatewayConf) map[string]interface{} {
	m := map[string]interface{}{}
	b, _ := json.Marshal(g)
	json.Unmarshal(b, &m)
	return m
}

func advancedToMap(a AdvancedConf) map[string]interface{} {
	m := map[string]interface{}{}
	b, _ := json.Marshal(a)
	json.Unmarshal(b, &m)
	return m
}

func serviceToMap(s ServiceConf) map[string]interface{} {
	m := map[string]interface{}{}
	b, _ := json.Marshal(s)
	json.Unmarshal(b, &m)
	return m
}
