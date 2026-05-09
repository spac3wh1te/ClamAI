//go:build server
// +build server

package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"path"
	"strings"
)

//go:embed frontend/dist/*
var frontendFS embed.FS

func (p *ProxyServer) setupFrontendRoutes() {
	isServer := p.config.Host == "0.0.0.0"
	log.Printf("[FRONTEND] setupFrontendRoutes called, host=%s, isServer=%v", p.config.Host, isServer)

	if !isServer {
		log.Printf("[FRONTEND] host=%s (not 0.0.0.0), skipping frontend route setup", p.config.Host)
		return
	}

	log.Printf("[FRONTEND] Server mode (0.0.0.0) detected, setting up embedded frontend")
	sub, err := fs.Sub(frontendFS, "frontend/dist")
	if err != nil {
		log.Printf("[FRONTEND] ERROR: fs.Sub failed: %v", err)
		return
	}

	_ = sub

	p.adminRouter.HandleFunc("/admin", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/admin/", http.StatusMovedPermanently)
	}))

	p.adminRouter.PathPrefix("/admin/").Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/admin/api/") {
			apiPath := strings.TrimPrefix(r.URL.Path, "/admin")
			r.URL.Path = "/" + apiPath
			p.adminRouter.ServeHTTP(w, r)
			return
		}

		stripPath := strings.TrimPrefix(r.URL.Path, "/admin")
		if stripPath == "" || stripPath == "/" {
			stripPath = "/index.html"
		}

		if serveStaticFile(w, stripPath) {
			return
		}

		serveStaticFile(w, "/index.html")
	}))

	allowedAssetDirs := []string{"/assets/", "/favicon", "/vite.svg"}
	p.adminRouter.PathPrefix("/").Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		allowed := false
		for _, prefix := range allowedAssetDirs {
			if strings.HasPrefix(p, prefix) || p == prefix {
				allowed = true
				break
			}
		}
		if !allowed {
			http.NotFound(w, r)
			return
		}
		if !serveStaticFile(w, p) {
			http.NotFound(w, r)
		}
	}))

	log.Printf("[FRONTEND] Server mode: WebUI at /admin/ (admin port %s)", p.config.AdminPort)
}

var staticContentTypes = map[string]string{
	".html":  "text/html; charset=utf-8",
	".js":    "application/javascript",
	".mjs":   "application/javascript",
	".css":   "text/css; charset=utf-8",
	".svg":   "image/svg+xml",
	".png":   "image/png",
	".jpg":   "image/jpeg",
	".ico":   "image/x-icon",
	".json":  "application/json",
	".woff":  "font/woff",
	".woff2": "font/woff2",
	".ttf":   "font/ttf",
	".webp":  "image/webp",
	".map":   "application/json",
}

func serveStaticFile(w http.ResponseWriter, filePath string) bool {
	cleanPath := path.Clean(filePath)
	if cleanPath == "" || cleanPath == "/" {
		cleanPath = "/index.html"
	}
	if strings.Contains(cleanPath, "..") {
		return false
	}

	ext := strings.ToLower(path.Ext(cleanPath))
	if ext == "" && cleanPath != "/index.html" {
		return false
	}

	fsPath := "frontend/dist" + cleanPath
	data, err := fs.ReadFile(frontendFS, fsPath)
	if err != nil {
		return false
	}

	contentType := "application/octet-stream"
	if ct, ok := staticContentTypes[ext]; ok {
		contentType = ct
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Write(data)
	return true
}
