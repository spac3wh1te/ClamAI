//go:build server
// +build server

package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"strings"
)

//go:embed frontend/dist/*
var frontendFS embed.FS

func (p *ProxyServer) setupFrontendRoutes() {
	if p.config.DeployMode != "server" {
		return
	}

	sub, err := fs.Sub(frontendFS, "frontend/dist")
	if err != nil {
		log.Printf("[WARN] failed to setup frontend embed: %v", err)
		return
	}

	fileServer := http.FileServer(http.FS(sub))

	p.router.PathPrefix("/admin/").Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/admin/api/") {
			http.StripPrefix("/admin/api", p.router).ServeHTTP(w, r)
			return
		}
		r.URL.Path = strings.TrimPrefix(r.URL.Path, "/admin")
		if r.URL.Path == "" || r.URL.Path == "/" {
			r.URL.Path = "/index.html"
		}
		fileServer.ServeHTTP(w, r)
	}))

	p.router.PathPrefix("/admin").Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/admin/", http.StatusMovedPermanently)
	}))

	log.Printf("[INFO] Server mode: WebUI available at /admin/")
}
