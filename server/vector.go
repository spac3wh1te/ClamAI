package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
)

const defaultVectorDim = 1024

type VectorSample struct {
	ID        int64     `json:"id"`
	Content   string    `json:"content"`
	Category  string    `json:"category"`
	Source    string    `json:"source"`
	Embedding []float32 `json:"embedding,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	AutoAdded bool      `json:"auto_added"`
}

type VectorSearchResult struct {
	SampleID   int64   `json:"sample_id"`
	Content    string  `json:"content"`
	Category   string  `json:"category"`
	Similarity float64 `json:"similarity"`
}

type VectorDB interface {
	InsertSample(sample *VectorSample) (int64, error)
	DeleteSample(id int64) error
	ListSamples(category string, limit, offset int) ([]VectorSample, int, error)
	Search(queryVec []float32, topK int, threshold float64) ([]VectorSearchResult, error)
	Close() error
}

type SQLiteVecDB struct {
	mu    sync.Mutex
	dim   int
	ready bool
}

var (
	vectorDB   VectorDB
	vectorDBMu sync.Mutex
	vecReady   bool
)

func initVectorDB() error {
	vectorDBMu.Lock()
	defer vectorDBMu.Unlock()

	if vecReady {
		return nil
	}

	vdb := &SQLiteVecDB{dim: defaultVectorDim}
	if err := vdb.createTables(); err != nil {
		return fmt.Errorf("failed to create vector tables: %w", err)
	}

	vectorDB = vdb
	vecReady = true
	log.Printf("[INFO] initVectorDB: sqlite-vec vector DB initialized (dim=%d)", vdb.dim)
	return nil
}

func (s *SQLiteVecDB) createTables() error {
	gormDB.AutoMigrate(&DBVectorSample{}, &DBVectorConfig{})

	var count int64
	gormDB.Model(&DBVectorConfig{}).Where("id = 1").Count(&count)
	if count == 0 {
		gormDB.Create(&DBVectorConfig{
			ID:                  1,
			EmbeddingModel:      "",
			VectorDim:           1024,
			SimilarityThreshold: 0.85,
		})
	}

	return nil
}

func (s *SQLiteVecDB) InsertSample(sample *VectorSample) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	embBytes, err := float32ToBytes(sample.Embedding)
	if err != nil {
		return 0, fmt.Errorf("serialize embedding: %w", err)
	}

	record := DBVectorSample{
		Content:   sample.Content,
		Category:  sample.Category,
		Source:    sample.Source,
		Embedding: embBytes,
		CreatedAt: sample.CreatedAt.UTC(),
		AutoAdded: sample.AutoAdded,
	}
	if err := gormDB.Create(&record).Error; err != nil {
		return 0, err
	}

	log.Printf("[INFO] InsertVectorSample: id=%d, category=%s, source=%s, auto=%v", record.ID, sample.Category, sample.Source, sample.AutoAdded)
	return record.ID, nil
}

func (s *SQLiteVecDB) DeleteSample(id int64) error {
	return gormDB.Where("id = ?", id).Delete(&DBVectorSample{}).Error
}

func (s *SQLiteVecDB) ListSamples(category string, limit, offset int) ([]VectorSample, int, error) {
	q := gormDB.Model(&DBVectorSample{})
	if category != "" {
		q = q.Where("category = ?", category)
	}

	var total int64
	q.Count(&total)

	var records []DBVectorSample
	query := gormDB.Model(&DBVectorSample{}).Order("id DESC").Limit(limit).Offset(offset)
	if category != "" {
		query = query.Where("category = ?", category)
	}
	if err := query.Find(&records).Error; err != nil {
		return nil, 0, err
	}

	samples := make([]VectorSample, len(records))
	for i, r := range records {
		samples[i] = VectorSample{
			ID:        r.ID,
			Content:   r.Content,
			Category:  r.Category,
			Source:    r.Source,
			CreatedAt: r.CreatedAt,
			AutoAdded: r.AutoAdded,
		}
	}
	return samples, int(total), nil
}

func (s *SQLiteVecDB) Search(queryVec []float32, topK int, threshold float64) ([]VectorSearchResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(queryVec) == 0 {
		return nil, nil
	}

	var records []DBVectorSample
	if err := gormDB.Where("embedding IS NOT NULL").Limit(10000).Find(&records).Error; err != nil {
		return nil, err
	}

	type candidate struct {
		id         int64
		content    string
		category   string
		similarity float64
	}
	var candidates []candidate

	for _, r := range records {
		embVec, err := bytesToFloat32(r.Embedding)
		if err != nil || len(embVec) == 0 {
			continue
		}

		sim := cosineSimilarity(queryVec, embVec)
		if sim >= threshold {
			candidates = append(candidates, candidate{id: r.ID, content: r.Content, category: r.Category, similarity: sim})
		}
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].similarity > candidates[j].similarity
	})

	if topK > 0 && len(candidates) > topK {
		candidates = candidates[:topK]
	}

	results := make([]VectorSearchResult, len(candidates))
	for i, c := range candidates {
		results[i] = VectorSearchResult{
			SampleID:   c.id,
			Content:    c.content,
			Category:   c.category,
			Similarity: c.similarity,
		}
	}
	return results, nil
}

func (s *SQLiteVecDB) Close() error {
	return nil
}

func float32ToBytes(vec []float32) ([]byte, error) {
	if len(vec) == 0 {
		return nil, nil
	}
	buf := make([]byte, len(vec)*4)
	for i, v := range vec {
		bits := math.Float32bits(v)
		buf[i*4] = byte(bits)
		buf[i*4+1] = byte(bits >> 8)
		buf[i*4+2] = byte(bits >> 16)
		buf[i*4+3] = byte(bits >> 24)
	}
	return buf, nil
}

func bytesToFloat32(data []byte) ([]float32, error) {
	if len(data) == 0 {
		return nil, nil
	}
	if len(data)%4 != 0 {
		return nil, fmt.Errorf("invalid blob length %d", len(data))
	}
	vec := make([]float32, len(data)/4)
	for i := range vec {
		bits := uint32(data[i*4]) | uint32(data[i*4+1])<<8 | uint32(data[i*4+2])<<16 | uint32(data[i*4+3])<<24
		vec[i] = math.Float32frombits(bits)
	}
	return vec, nil
}

func cosineSimilarity(a, b []float32) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, normA, normB float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		normA += float64(a[i]) * float64(a[i])
		normB += float64(b[i]) * float64(b[i])
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return dot / (math.Sqrt(normA) * math.Sqrt(normB))
}

func getEmbeddingFromAPI(content string) ([]float32, error) {
	secConfigMu.Lock()
	embModel := secConfig.SemanticModel
	secConfigMu.Unlock()

	if embModel == "" {
		return nil, fmt.Errorf("no embedding model configured (semantic_model is empty)")
	}

	p := getProxyServer()
	if p == nil {
		return nil, fmt.Errorf("proxy server not available")
	}

	return p.directEmbeddingCall(embModel, content)
}

var proxyServerRef *ProxyServer
var proxyServerMu sync.Mutex

func setProxyServer(p *ProxyServer) {
	proxyServerMu.Lock()
	defer proxyServerMu.Unlock()
	proxyServerRef = p
}

func getProxyServer() *ProxyServer {
	proxyServerMu.Lock()
	defer proxyServerMu.Unlock()
	return proxyServerRef
}

func vectorCheck(content string) ([]VectorSearchResult, error) {
	vectorDBMu.Lock()
	vdb := vectorDB
	vectorDBMu.Unlock()

	if vdb == nil {
		return nil, nil
	}

	vecCfg := dbLoadVectorConfig()
	if vecCfg.SimilarityThreshold <= 0 {
		vecCfg.SimilarityThreshold = 0.85
	}

	queryVec, err := getEmbeddingFromAPI(content)
	if err != nil {
		return nil, fmt.Errorf("failed to get embedding: %w", err)
	}

	results, err := vdb.Search(queryVec, 5, vecCfg.SimilarityThreshold)
	if err != nil {
		return nil, fmt.Errorf("vector search failed: %w", err)
	}

	return results, nil
}

type VectorConfig struct {
	EmbeddingModel      string  `json:"embedding_model"`
	VectorDim           int     `json:"vector_dim"`
	SimilarityThreshold float64 `json:"similarity_threshold"`
}

func dbLoadVectorConfig() VectorConfig {
	cfg := VectorConfig{
		VectorDim:           defaultVectorDim,
		SimilarityThreshold: 0.85,
	}

	var record DBVectorConfig
	if err := gormDB.Where("id = 1").First(&record).Error; err != nil {
		return cfg
	}

	cfg.EmbeddingModel = record.EmbeddingModel
	if record.VectorDim > 0 {
		cfg.VectorDim = record.VectorDim
	}
	if record.SimilarityThreshold > 0 {
		cfg.SimilarityThreshold = record.SimilarityThreshold
	}
	return cfg
}

func dbSaveVectorConfig(cfg *VectorConfig) {
	now := time.Now().UTC()
	record := DBVectorConfig{
		ID:                  1,
		EmbeddingModel:      cfg.EmbeddingModel,
		VectorDim:           cfg.VectorDim,
		SimilarityThreshold: cfg.SimilarityThreshold,
		UpdatedAt:           &now,
	}
	if err := gormDB.Save(&record).Error; err != nil {
		log.Printf("[ERROR] dbSaveVectorConfig: %v", err)
	}
}

func autoAddBlockedSample(content, category string) {
	if content == "" || len(content) < 10 {
		return
	}

	safeGo(func() {
		emb, err := getEmbeddingFromAPI(content)
		if err != nil {
			log.Printf("[WARN] autoAddBlockedSample: embedding failed: %v", err)
			return
		}

		vectorDBMu.Lock()
		vdb := vectorDB
		vectorDBMu.Unlock()

		if vdb == nil {
			return
		}

		sample := &VectorSample{
			Content:   content,
			Category:  category,
			Source:    "auto_blocked",
			Embedding: emb,
			CreatedAt: time.Now(),
			AutoAdded: true,
		}
		if _, err := vdb.InsertSample(sample); err != nil {
			log.Printf("[WARN] autoAddBlockedSample: insert failed: %v", err)
		}
	})
}

func (p *ProxyServer) setupVectorRoutes(api *mux.Router) {
	api.HandleFunc("/security/vector/config", p.handleGetVectorConfig).Methods("GET")
	api.HandleFunc("/security/vector/config", p.handleUpdateVectorConfig).Methods("PUT")
	api.HandleFunc("/security/vector/samples", p.handleListVectorSamples).Methods("GET")
	api.HandleFunc("/security/vector/samples", p.handleAddVectorSample).Methods("POST")
	api.HandleFunc("/security/vector/samples/{id}", p.handleDeleteVectorSample).Methods("DELETE")
	api.HandleFunc("/security/vector/samples/batch", p.handleBatchAddVectorSamples).Methods("POST")
}

func (p *ProxyServer) handleGetVectorConfig(w http.ResponseWriter, r *http.Request) {
	cfg := dbLoadVectorConfig()
	secConfigMu.Lock()
	if cfg.EmbeddingModel == "" && secConfig.SemanticModel != "" {
		cfg.EmbeddingModel = secConfig.SemanticModel
	}
	secConfigMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg)
}

func (p *ProxyServer) handleUpdateVectorConfig(w http.ResponseWriter, r *http.Request) {
	var cfg VectorConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if cfg.VectorDim <= 0 {
		cfg.VectorDim = defaultVectorDim
	}
	if cfg.SimilarityThreshold <= 0 {
		cfg.SimilarityThreshold = 0.85
	}
	if cfg.SimilarityThreshold > 1.0 {
		cfg.SimilarityThreshold = 1.0
	}
	dbSaveVectorConfig(&cfg)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func (p *ProxyServer) handleListVectorSamples(w http.ResponseWriter, r *http.Request) {
	category := r.URL.Query().Get("category")
	limit := 50
	offset := 0
	if l, err := parseIntParam(r.URL.Query().Get("limit")); err == nil && l > 0 {
		limit = l
	}
	if o, err := parseIntParam(r.URL.Query().Get("offset")); err == nil && o >= 0 {
		offset = o
	}

	vectorDBMu.Lock()
	vdb := vectorDB
	vectorDBMu.Unlock()

	if vdb == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"samples": []interface{}{}, "total": 0})
		return
	}

	samples, total, err := vdb.ListSamples(category, limit, offset)
	if err != nil {
		log.Printf("[ERROR] handleListVectorSamples: %v", err)
		http.Error(w, "Failed to list samples", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"samples": samples,
		"total":   total,
	})
}

func (p *ProxyServer) handleAddVectorSample(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Content  string `json:"content"`
		Category string `json:"category"`
		Source   string `json:"source"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.Content == "" {
		http.Error(w, "content is required", http.StatusBadRequest)
		return
	}
	if req.Category == "" {
		req.Category = "general"
	}
	if req.Source == "" {
		req.Source = "manual"
	}

	emb, err := getEmbeddingFromAPI(req.Content)
	if err != nil {
		log.Printf("[ERROR] handleAddVectorSample: embedding failed: %v", err)
		http.Error(w, "Failed to generate embedding: "+err.Error(), http.StatusInternalServerError)
		return
	}

	vectorDBMu.Lock()
	vdb := vectorDB
	vectorDBMu.Unlock()

	if vdb == nil {
		http.Error(w, "Vector DB not initialized", http.StatusInternalServerError)
		return
	}

	sample := &VectorSample{
		Content:   req.Content,
		Category:  req.Category,
		Source:    req.Source,
		Embedding: emb,
		CreatedAt: time.Now(),
		AutoAdded: false,
	}

	id, err := vdb.InsertSample(sample)
	if err != nil {
		log.Printf("[ERROR] handleAddVectorSample: insert failed: %v", err)
		http.Error(w, "Failed to insert sample", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"id":      id,
	})
}

func (p *ProxyServer) handleBatchAddVectorSamples(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Samples []struct {
			Content  string `json:"content"`
			Category string `json:"category"`
		} `json:"samples"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	vectorDBMu.Lock()
	vdb := vectorDB
	vectorDBMu.Unlock()

	if vdb == nil {
		http.Error(w, "Vector DB not initialized", http.StatusInternalServerError)
		return
	}

	var added int
	var errors []string
	for i, s := range req.Samples {
		if s.Content == "" {
			errors = append(errors, fmt.Sprintf("sample %d: empty content", i))
			continue
		}
		if s.Category == "" {
			s.Category = "general"
		}

		emb, err := getEmbeddingFromAPI(s.Content)
		if err != nil {
			errors = append(errors, fmt.Sprintf("sample %d: embedding failed: %v", i, err))
			continue
		}

		sample := &VectorSample{
			Content:   s.Content,
			Category:  s.Category,
			Source:    "manual_batch",
			Embedding: emb,
			CreatedAt: time.Now(),
			AutoAdded: false,
		}
		if _, err := vdb.InsertSample(sample); err != nil {
			errors = append(errors, fmt.Sprintf("sample %d: insert failed: %v", i, err))
			continue
		}
		added++
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"added":   added,
		"errors":  errors,
	})
}

func (p *ProxyServer) handleDeleteVectorSample(w http.ResponseWriter, r *http.Request) {
	idStr := mux.Vars(r)["id"]
	var id int64
	fmt.Sscanf(idStr, "%d", &id)

	vectorDBMu.Lock()
	vdb := vectorDB
	vectorDBMu.Unlock()

	if vdb == nil {
		http.Error(w, "Vector DB not initialized", http.StatusInternalServerError)
		return
	}

	if err := vdb.DeleteSample(id); err != nil {
		http.Error(w, "Failed to delete sample", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func parseIntParam(s string) (int, error) {
	if s == "" {
		return 0, fmt.Errorf("empty")
	}
	var v int
	_, err := fmt.Sscanf(s, "%d", &v)
	return v, err
}

func splitForEmbedding(content string, maxChars int) []string {
	if len(content) <= maxChars {
		return []string{content}
	}
	var chunks []string
	runes := []rune(content)
	for len(runes) > 0 {
		end := maxChars
		if end > len(runes) {
			end = len(runes)
		}
		chunks = append(chunks, string(runes[:end]))
		runes = runes[end:]
	}
	return chunks
}

func init() {
	_ = strings.NewReader("")
}
