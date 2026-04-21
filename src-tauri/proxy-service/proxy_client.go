package main

import (
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"time"
)

var globalProxyURL *url.URL

func setProxy(proxyStr string) error {
	if proxyStr == "" {
		globalProxyURL = nil
		return nil
	}
	u, err := url.Parse(proxyStr)
	if err != nil {
		return err
	}
	globalProxyURL = u
	return nil
}

func getProxy() *url.URL {
	return globalProxyURL
}

func testProxyConnectivity(proxyURL string) (bool, string) {
	if proxyURL == "" {
		return false, "代理地址为空"
	}

	u, err := url.Parse(proxyURL)
	if err != nil {
		return false, fmt.Sprintf("代理地址格式错误: %v", err)
	}

	dialer := &net.Dialer{Timeout: 10 * time.Second}

	switch u.Scheme {
	case "http", "https":
		conn, err := dialer.Dial("tcp", u.Host)
		if err != nil {
			return false, fmt.Sprintf("连接代理服务器失败: %v", err)
		}
		conn.Close()
		return true, "HTTP/HTTPS 代理连接成功"
	case "socks5":
		conn, err := dialer.Dial("tcp", u.Host)
		if err != nil {
			return false, fmt.Sprintf("连接 SOCKS5 代理服务器失败: %v", err)
		}
		conn.Close()
		return true, "SOCKS5 代理连接成功"
	default:
		return false, fmt.Sprintf("不支持的代理协议: %s (仅支持 http/https/socks5)", u.Scheme)
	}
}

func newHTTPClient(proxyURL string) *http.Client {
	transport := &http.Transport{
		IdleConnTimeout: 60 * time.Second,
	}

	if proxyURL != "" {
		transport.Proxy = func(*http.Request) (*url.URL, error) {
			return url.Parse(proxyURL)
		}
	}

	return &http.Client{
		Transport: transport,
		Timeout:   30 * time.Second,
	}
}

func newHTTPSClient(proxyURL string, skipVerify bool) *http.Client {
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: skipVerify},
		IdleConnTimeout: 60 * time.Second,
	}

	if proxyURL != "" {
		transport.Proxy = func(*http.Request) (*url.URL, error) {
			return url.Parse(proxyURL)
		}
	}

	return &http.Client{
		Transport: transport,
		Timeout:   30 * time.Second,
	}
}

func fetchWithProxy(client *http.Client, req *http.Request) (*http.Response, error) {
	resp, err := client.Do(req)
	if err != nil {
		if proxyURL := getProxy(); proxyURL != nil {
			log.Printf("[WARN] request failed, trying direct: %v", err)
			directClient := &http.Client{
				Transport: &http.Transport{
					IdleConnTimeout: 60 * time.Second,
				},
				Timeout: 30 * time.Second,
			}
			resp, err = directClient.Do(req)
		}
	}
	return resp, err
}
