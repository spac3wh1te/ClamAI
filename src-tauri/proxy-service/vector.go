package main

import (
	"bytes"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
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
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS vector_samples (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		content TEXT NOT NULL,
		category TEXT DEFAULT 'general',
		source TEXT DEFAULT 'manual',
		embedding BLOB,
		created_at DATETIME NOT NULL,
		auto_added INTEGER DEFAULT 0
	)`)
	if err != nil {
		return fmt.Errorf("create vector_samples: %w", err)
	}

	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_vector_samples_category ON vector_samples(category)`)
	if err != nil {
		log.Printf("[WARN] createTables: index on vector_samples.category: %v", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS vector_config (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		embedding_model TEXT DEFAULT '',
		vector_dim INTEGER DEFAULT 1024,
		similarity_threshold REAL DEFAULT 0.85,
		updated_at DATETIME
	)`)
	if err != nil {
		log.Printf("[WARN] createTables: vector_config: %v", err)
	}

	_, err = db.Exec(`INSERT OR IGNORE INTO vector_config (id, embedding_model, vector_dim, similarity_threshold, updated_at)
		VALUES (1, '', 1024, 0.85, datetime('now'))`)
	if err != nil {
		log.Printf("[WARN] createTables: insert default vector_config: %v", err)
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

	autoAdded := 0
	if sample.AutoAdded {
		autoAdded = 1
	}

	result, err := db.Exec(`INSERT INTO vector_samples (content, category, source, embedding, created_at, auto_added)
		VALUES (?, ?, ?, ?, ?, ?)`,
		sample.Content, sample.Category, sample.Source,
		embBytes, sample.CreatedAt.UTC().Format(time.RFC3339), autoAdded)
	if err != nil {
		return 0, err
	}

	id, _ := result.LastInsertId()
	log.Printf("[INFO] InsertVectorSample: id=%d, category=%s, source=%s, auto=%v", id, sample.Category, sample.Source, sample.AutoAdded)
	return id, nil
}

func (s *SQLiteVecDB) DeleteSample(id int64) error {
	_, err := db.Exec("DELETE FROM vector_samples WHERE id = ?", id)
	return err
}

func (s *SQLiteVecDB) ListSamples(category string, limit, offset int) ([]VectorSample, int, error) {
	var total int
	if category != "" {
		db.QueryRow("SELECT COUNT(*) FROM vector_samples WHERE category = ?", category).Scan(&total)
	} else {
		db.QueryRow("SELECT COUNT(*) FROM vector_samples").Scan(&total)
	}

	var rows *sql.Rows
	var err error
	if category != "" {
		rows, err = db.Query("SELECT id, content, category, source, created_at, auto_added FROM vector_samples WHERE category = ? ORDER BY id DESC LIMIT ? OFFSET ?", category, limit, offset)
	} else {
		rows, err = db.Query("SELECT id, content, category, source, created_at, auto_added FROM vector_samples ORDER BY id DESC LIMIT ? OFFSET ?", limit, offset)
	}
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var samples []VectorSample
	for rows.Next() {
		var s VectorSample
		var createdAt string
		var autoAdded int
		if err := rows.Scan(&s.ID, &s.Content, &s.Category, &s.Source, &createdAt, &autoAdded); err != nil {
			continue
		}
		s.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
		s.AutoAdded = autoAdded == 1
		samples = append(samples, s)
	}
	return samples, total, nil
}

func (s *SQLiteVecDB) Search(queryVec []float32, topK int, threshold float64) ([]VectorSearchResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(queryVec) == 0 {
		return nil, nil
	}

	rows, err := db.Query("SELECT id, content, category, embedding FROM vector_samples WHERE embedding IS NOT NULL LIMIT 10000")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type candidate struct {
		id         int64
		content    string
		category   string
		similarity float64
	}
	var candidates []candidate

	for rows.Next() {
		var id int64
		var content, category string
		var embBlob []byte
		if err := rows.Scan(&id, &content, &category, &embBlob); err != nil {
			continue
		}

		embVec, err := bytesToFloat32(embBlob)
		if err != nil || len(embVec) == 0 {
			continue
		}

		sim := cosineSimilarity(queryVec, embVec)
		if sim >= threshold {
			candidates = append(candidates, candidate{id: id, content: content, category: category, similarity: sim})
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

	provider, _ := p.resolveProvider(embModel)
	if provider == nil {
		return nil, fmt.Errorf("no provider found for embedding model: %s", embModel)
	}

	reqBody := map[string]interface{}{
		"model": embModel,
		"input": content,
	}
	body, _ := json.Marshal(reqBody)

	scheme := "http"
	var client *http.Client
	if p.useTLS {
		scheme = "https"
		client = &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		}
	} else {
		client = &http.Client{Timeout: 30 * time.Second}
	}

	url := fmt.Sprintf("%s://%s/v1/embeddings", scheme, p.proxyAddr)
	httpReq, _ := http.NewRequest("POST", url, bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-Internal-Analysis", internalAnalysisKey)

	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("embedding API call failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("embedding API returned status %d: %s", resp.StatusCode, truncate(string(respBody), 200))
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
		return nil, fmt.Errorf("empty embedding returned")
	}

	return respData.Data[0].Embedding, nil
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
	row := db.QueryRow("SELECT embedding_model, vector_dim, similarity_threshold FROM vector_config WHERE id = 1")
	var embModel string
	var dim int
	var threshold float64
	if err := row.Scan(&embModel, &dim, &threshold); err != nil {
		if err != sql.ErrNoRows {
			log.Printf("[WARN] dbLoadVectorConfig: %v", err)
		}
		return cfg
	}
	cfg.EmbeddingModel = embModel
	if dim > 0 {
		cfg.VectorDim = dim
	}
	if threshold > 0 {
		cfg.SimilarityThreshold = threshold
	}
	return cfg
}

func dbSaveVectorConfig(cfg *VectorConfig) {
	_, err := db.Exec(`INSERT OR REPLACE INTO vector_config (id, embedding_model, vector_dim, similarity_threshold, updated_at)
		VALUES (1, ?, ?, ?, datetime('now'))`,
		cfg.EmbeddingModel, cfg.VectorDim, cfg.SimilarityThreshold)
	if err != nil {
		log.Printf("[ERROR] dbSaveVectorConfig: %v", err)
	}
}

func autoAddBlockedSample(content, category string) {
	if content == "" || len(content) < 10 {
		return
	}

	go func() {
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
	}()
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
