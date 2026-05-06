package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"log"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

var defaultCertPEM = []byte(`-----BEGIN CERTIFICATE-----
MIICRzCCAfWgAwIBAgIUJJ5v
-----END CERTIFICATE-----`)

func generateSelfSignedCert(certPath, keyPath string, hosts []string) error {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fmt.Errorf("failed to generate private key: %w", err)
	}

	serialNumber, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return fmt.Errorf("failed to generate serial number: %w", err)
	}

	notBefore := time.Now()
	notAfter := notBefore.AddDate(10, 0, 0)

	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			CommonName:   "ClamAI Gateway",
			Organization: []string{"ClamAI"},
		},
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
		IPAddresses:           []net.IP{},
		DNSNames:              []string{},
	}

	for _, h := range hosts {
		if ip := net.ParseIP(h); ip != nil {
			template.IPAddresses = append(template.IPAddresses, ip)
		} else {
			template.DNSNames = append(template.DNSNames, h)
		}
	}

	if len(template.IPAddresses) == 0 && len(template.DNSNames) == 0 {
		template.IPAddresses = append(template.IPAddresses, net.ParseIP("0.0.0.0"))
		template.IPAddresses = append(template.IPAddresses, net.ParseIP("::"))
		template.DNSNames = append(template.DNSNames, "localhost")
	}

	certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		return fmt.Errorf("failed to create certificate: %w", err)
	}

	certOut, err := os.Create(certPath)
	if err != nil {
		return fmt.Errorf("failed to open cert file: %w", err)
	}
	defer certOut.Close()
	if err := pem.Encode(certOut, &pem.Block{Type: "CERTIFICATE", Bytes: certDER}); err != nil {
		return fmt.Errorf("failed to write cert: %w", err)
	}

	keyOut, err := os.Create(keyPath)
	if err != nil {
		return fmt.Errorf("failed to open key file: %w", err)
	}
	defer keyOut.Close()
	privBytes, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		return fmt.Errorf("failed to marshal private key: %w", err)
	}
	if err := pem.Encode(keyOut, &pem.Block{Type: "EC PRIVATE KEY", Bytes: privBytes}); err != nil {
		return fmt.Errorf("failed to write key: %w", err)
	}

	return nil
}

func ensureSelfSignedTLSCert(dataDir string, hosts []string) (certFile, keyFile string, err error) {
	certFile = filepath.Join(dataDir, "clamai-cert.pem")
	keyFile = filepath.Join(dataDir, "clamai-key.pem")

	certExists := false
	keyExists := false
	if _, e := os.Stat(certFile); e == nil {
		certExists = true
	}
	if _, e := os.Stat(keyFile); e == nil {
		keyExists = true
	}
	if certExists && keyExists {
		log.Printf("[TLS] Using existing cert: %s", certFile)
		return
	}

	log.Printf("[TLS] Generating self-signed certificate for hosts: %v...", hosts)
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return "", "", fmt.Errorf("failed to create cert dir: %w", err)
	}

	if err := generateSelfSignedCert(certFile, keyFile, hosts); err != nil {
		return "", "", fmt.Errorf("failed to generate self-signed cert: %w", err)
	}
	log.Printf("[TLS] Cert generated: %s (valid 10 years)", certFile)
	return
}

func loadTLSCredentials(certFile, keyFile string) (*tls.Config, error) {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("failed to load TLS cert/key: %w", err)
	}
	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	}, nil
}

func detectListenHosts(addr string) []string {
	hosts := []string{}
	host, port, err := splitHostPort(addr)
	if err != nil {
		return hosts
	}
	if host == "0.0.0.0" || host == "" {
		addrs, _ := net.InterfaceAddrs()
		for _, a := range addrs {
			if ip, ok := a.(*net.IPNet); ok && !ip.IP.IsLoopback() {
				hosts = append(hosts, ip.IP.String())
			}
		}
		hosts = append(hosts, "localhost", "127.0.0.1")
	} else {
		hosts = append(hosts, host)
	}
	_ = port
	return hosts
}

func splitHostPort(addr string) (string, string, error) {
	for i := len(addr) - 1; i >= 0; i-- {
		if addr[i] == ':' && !isBracketAddr(addr[:i+1]) {
			return addr[:i], addr[i+1:], nil
		}
	}
	return addr, "", nil
}

func isBracketAddr(s string) bool {
	return len(s) >= 2 && s[0] == '['
}
