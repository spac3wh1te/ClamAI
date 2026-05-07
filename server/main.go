package main

import (
	"crypto/tls"
	"fmt"
	"log"
	"net/http"
	"os"
)

func main() {
	initLogging()
	log.Printf("[MAIN] ========== ClamAI v%s Service Starting ==========", BuildVersion)
	log.Printf("[MAIN] PID: %d", os.Getpid())
	log.Printf("[MAIN] Working directory: %s", getWorkingDir())
	log.Printf("[MAIN] Command line args: %v", os.Args)

	config := parseFlags()
	globalConfig = config

	log.Printf("[MAIN] Parsed config: port=%s admin_port=%s host=%s ssl=%v proxy=%s",
		config.Port, config.AdminPort, config.Host, config.EnableTLS, config.ProxyURL)

	proxy, err := NewProxyServer(config)
	if err != nil {
		log.Fatalf("[MAIN] Failed to create proxy server: %v", err)
	}
	log.Printf("[MAIN] ProxyServer created successfully")
	applyDBLogLevel()

	addr := fmt.Sprintf("%s:%s", config.Host, config.Port)
	adminAddr := fmt.Sprintf("%s:%s", config.Host, config.AdminPort)
	log.Printf("[MAIN] ========== Proxy Server Starting ==========")
	isServer := config.Host == "0.0.0.0"
	if isServer {
		log.Printf("[MAIN] Running as server mode (0.0.0.0), WebUI enabled at :%s/admin/", config.AdminPort)
	}
	log.Printf("[MAIN] Proxy port (model API): %s", addr)
	log.Printf("[MAIN] Admin port (management API): %s", adminAddr)
	externalAccess := "no"
	if config.Host == "0.0.0.0" {
		externalAccess = "yes"
	}
	log.Printf("[MAIN] External access allowed: %s", externalAccess)

	if config.APIKey != "" {
		log.Printf("[MAIN] API key: %s", maskAPIKey(config.APIKey))
	} else {
		log.Printf("[MAIN] API key: (not set)")
	}

	log.Printf("[MAIN] HTTP Proxy: %s", config.ProxyURL)
	log.Printf("[MAIN] Providers configured: %d", len(proxy.providers))
	for name, provider := range proxy.providers {
		log.Printf("[MAIN]   Provider: %s, BaseURL: %s", name, provider.GetBaseURL())
	}

	log.Printf("[MAIN] Starting proxy server on %s...", addr)
	log.Printf("[MAIN] Starting admin server on %s...", adminAddr)

	proxy.listenAddr = "127.0.0.1:" + config.AdminPort
	proxy.proxyAddr = "127.0.0.1:" + config.Port
	proxy.useTLS = config.EnableTLS
	log.Printf("[MAIN] Internal callback (admin): %s (TLS=%v)", proxy.listenAddr, proxy.useTLS)
	log.Printf("[MAIN] Internal callback (proxy): %s (TLS=%v)", proxy.proxyAddr, proxy.useTLS)

	var tlsConfig *tls.Config
	if config.EnableTLS {
		if config.TLSCert == "" || config.TLSKey == "" {
			hosts := detectListenHosts(addr)
			hosts = append(hosts, detectListenHosts(adminAddr)...)
			certFile, keyFile, err := ensureSelfSignedTLSCert(getDataDir(), hosts)
			if err != nil {
				log.Fatalf("[MAIN] Failed to generate TLS cert: %v", err)
			}
			config.TLSCert = certFile
			config.TLSKey = keyFile
		}
		var err error
		tlsConfig, err = loadTLSCredentials(config.TLSCert, config.TLSKey)
		if err != nil {
			log.Fatalf("[MAIN] Failed to load TLS credentials: %v", err)
		}
		log.Printf("[MAIN] TLS enabled (auto-generated self-signed): %s", config.TLSCert)
	} else {
		log.Printf("[MAIN] TLS disabled (plain HTTP)")
	}

	// Start admin server (management API) in a goroutine
	safeGo(func() {
		if config.EnableTLS && tlsConfig != nil {
			srv := &http.Server{
				Addr:      adminAddr,
				Handler:   proxy.adminRouter,
				TLSConfig: tlsConfig.Clone(),
			}
			if err := srv.ListenAndServeTLS("", ""); err != nil {
				log.Fatalf("[MAIN] Admin server error: %v", err)
			}
		} else {
			if err := http.ListenAndServe(adminAddr, proxy.adminRouter); err != nil {
				log.Fatalf("[MAIN] Admin server error: %v", err)
			}
		}
	})

	// Start proxy server (model API) on main goroutine
	if config.EnableTLS && tlsConfig != nil {
		server := &http.Server{
			Addr:      addr,
			Handler:   proxy.router,
			TLSConfig: tlsConfig,
		}
		if err := server.ListenAndServeTLS("", ""); err != nil {
			log.Fatalf("[MAIN] Proxy server error: %v", err)
		}
	} else {
		if err := http.ListenAndServe(addr, proxy.router); err != nil {
			log.Fatalf("[MAIN] Proxy server error: %v", err)
		}
	}
}

func (p *ProxyServer) internalChatCompletion(model string, messages []map[string]interface{}, temperature float64, maxTokens int) (int, int, int, []byte, error) {
	return p.directModelCall(model, messages, temperature, maxTokens)
}
