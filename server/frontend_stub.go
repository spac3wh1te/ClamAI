//go:build !server
// +build !server

package main

import "log"

func (p *ProxyServer) setupFrontendRoutes() {
	if p.config.Host != "0.0.0.0" {
		return
	}
	log.Printf("[INFO] Server mode: WebUI not available (build with -tags server to enable)")
}
