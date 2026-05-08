package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/gorilla/mux"
)

func (p *ProxyServer) handleListAPIKeys(w http.ResponseWriter, r *http.Request) {
	userID := userIDForQuery(r)
	isAdmin := false
	if claims := getUserFromContext(r); claims != nil {
		isAdmin = claims.Role == "admin"
	}
	apiKeysMu.Lock()
	keys := make([]map[string]interface{}, 0, len(apiKeys))
	for _, info := range apiKeys {
		if !isAdmin {
			if userID == "" || info.UserID != userID {
				continue
			}
		}
		entry := map[string]interface{}{
			"id":             info.ID,
			"name":           info.Name,
			"user_id":        info.UserID,
			"created_by_name": getUserNameByID(info.UserID),
			"created_at":     info.CreatedAt,
			"active":         info.Active,
			"request_count":  info.RequestCount,
			"key_preview":    maskAPIKey(info.Key),
			"allowed_models": info.AllowedModels,
			"provider_keys":  info.ProviderKeys,
		}
		if info.LastUsed != nil {
			entry["last_used"] = *info.LastUsed
		}
		if info.LastSynced != nil {
			entry["last_synced"] = *info.LastSynced
		}
		keys = append(keys, entry)
	}
	apiKeysMu.Unlock()

	sort.SliceStable(keys, func(i, j int) bool {
		ci, _ := keys[i]["created_at"].(time.Time)
		cj, _ := keys[j]["created_at"].(time.Time)
		if !ci.Equal(cj) {
			return ci.Before(cj)
		}
		idi, _ := keys[i]["id"].(string)
		idj, _ := keys[j]["id"].(string)
		return idi < idj
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"keys": keys,
	})
}

func (p *ProxyServer) handleCreateAPIKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name          string            `json:"name"`
		AllowedModels []string          `json:"allowed_models"`
		ProviderKeys  map[string]string `json:"provider_keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	key := generateAPIKey()
	id := generateKeyID()
	now := time.Now()
	info := &APIKeyInfo{
		ID:            id,
		Key:           key,
		Name:          req.Name,
		UserID:        getUserIDFromRequest(r),
		AllowedModels: req.AllowedModels,
		ProviderKeys:  req.ProviderKeys,
		CreatedAt:     now,
		Active:        true,
		LastSynced:    &now,
	}

	apiKeysMu.Lock()
	apiKeys[key] = info
	apiKeysByID[id] = info
	apiKeysMu.Unlock()
	dbSaveAPIKey(info)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":             id,
		"key":            key,
		"name":           req.Name,
		"allowed_models": req.AllowedModels,
		"provider_keys":  req.ProviderKeys,
	})
}

func (p *ProxyServer) handleUpdateAPIKey(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var req struct {
		AllowedModels []string          `json:"allowed_models"`
		ProviderKeys  map[string]string `json:"provider_keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	userID := userIDForQuery(r)
	isAdmin := false
	if claims := getUserFromContext(r); claims != nil {
		isAdmin = claims.Role == "admin"
	}

	apiKeysMu.Lock()
	defer apiKeysMu.Unlock()

	info, exists := apiKeysByID[id]
	if !exists {
		http.Error(w, "API key not found", http.StatusNotFound)
		return
	}

	if !isAdmin && userID != "" && info.UserID != userID {
		http.Error(w, "Forbidden: not your API key", http.StatusForbidden)
		return
	}

	info.AllowedModels = req.AllowedModels
	if req.ProviderKeys != nil {
		info.ProviderKeys = req.ProviderKeys
	}
	now := time.Now()
	info.LastSynced = &now
	dbSaveAPIKey(info)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":             id,
		"allowed_models": info.AllowedModels,
		"provider_keys":  info.ProviderKeys,
	})
}

func (p *ProxyServer) handleDeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	userID := userIDForQuery(r)
	isAdmin := false
	if claims := getUserFromContext(r); claims != nil {
		isAdmin = claims.Role == "admin"
	}

	apiKeysMu.Lock()

	var found bool
	if info, exists := apiKeysByID[id]; exists {
		if !isAdmin && userID != "" && info.UserID != userID {
			apiKeysMu.Unlock()
			http.Error(w, "Forbidden: not your API key", http.StatusForbidden)
			return
		}
		delete(apiKeys, info.Key)
		delete(apiKeysByID, id)
		found = true
	} else if info, exists := apiKeys[id]; exists {
		if !isAdmin && userID != "" && info.UserID != userID {
			apiKeysMu.Unlock()
			http.Error(w, "Forbidden: not your API key", http.StatusForbidden)
			return
		}
		delete(apiKeysByID, info.ID)
		delete(apiKeys, id)
		found = true
	}

	apiKeysMu.Unlock()

	if !found {
		http.Error(w, "API key not found", http.StatusNotFound)
		return
	}

	dbDeleteAPIKey(id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func (p *ProxyServer) handleRevealAPIKey(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	userID := userIDForQuery(r)
	isAdmin := false
	if claims := getUserFromContext(r); claims != nil {
		isAdmin = claims.Role == "admin"
	}

	apiKeysMu.Lock()
	defer apiKeysMu.Unlock()

	if info, exists := apiKeysByID[id]; exists {
		if !isAdmin && userID != "" && info.UserID != userID {
			http.Error(w, "Forbidden: not your API key", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":   info.ID,
			"key":  info.Key,
			"name": info.Name,
		})
		return
	}

	http.Error(w, "API key not found", http.StatusNotFound)
}

func generateKeyID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}

func generateAPIKey() string {
	b := make([]byte, 24)
	rand.Read(b)
	return fmt.Sprintf("sk-%x", b)
}
