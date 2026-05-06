package main

import (
	"bytes"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

const defaultMaxBufferSize = 64 * 1024

var bufferPool = sync.Pool{
	New: func() interface{} {
		buf := bytes.NewBuffer(make([]byte, 0, 32*1024))
		return buf
	},
}

func getBuffer() *bytes.Buffer {
	buf := bufferPool.Get().(*bytes.Buffer)
	buf.Reset()
	return buf
}

func putBuffer(buf *bytes.Buffer) {
	if buf.Cap() <= 256*1024 {
		bufferPool.Put(buf)
	}
}

type bufferedResponseWriter struct {
	header       http.Header
	statusCode   int
	body         *bytes.Buffer
	maxBufSize   int
	overflowed   bool
	overflowBody []byte
}

func newBufferedResponseWriter(maxSize int) *bufferedResponseWriter {
	if maxSize <= 0 {
		maxSize = defaultMaxBufferSize
	}
	return &bufferedResponseWriter{
		statusCode: http.StatusOK,
		body:       getBuffer(),
		maxBufSize: maxSize,
	}
}

func (w *bufferedResponseWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}
func (w *bufferedResponseWriter) Write(b []byte) (int, error) {
	if w.statusCode == 0 {
		w.statusCode = http.StatusOK
	}
	if w.overflowed {
		w.overflowBody = append(w.overflowBody, b...)
		return len(b), nil
	}
	if w.body.Len()+len(b) > w.maxBufSize {
		w.overflowed = true
		w.overflowBody = append(w.body.Bytes(), b...)
		putBuffer(w.body)
		w.body = nil
		return len(b), nil
	}
	return w.body.Write(b)
}
func (w *bufferedResponseWriter) WriteHeader(code int) { w.statusCode = code }

func (w *bufferedResponseWriter) Bytes() []byte {
	if w.overflowed {
		return w.overflowBody
	}
	return w.body.Bytes()
}

func (w *bufferedResponseWriter) Len() int {
	if w.overflowed {
		return len(w.overflowBody)
	}
	return w.body.Len()
}

func (w *bufferedResponseWriter) Release() {
	if w.body != nil {
		putBuffer(w.body)
		w.body = nil
	}
	w.overflowBody = nil
}

type slidingWindowWriter struct {
	http.ResponseWriter
	wroteHeader bool
	cfg         SecurityConfig
	reqModel    string
	apiKey      string
	clientIP    string
	window      []byte
	windowSize  int
	aborted     bool
	accumulated strings.Builder
}

const defaultSlidingWindowSize = 4096

func newSlidingWindowWriter(w http.ResponseWriter, cfg SecurityConfig, reqModel, apiKey, clientIP string) *slidingWindowWriter {
	return &slidingWindowWriter{
		ResponseWriter: w,
		cfg:            cfg,
		reqModel:       reqModel,
		apiKey:         apiKey,
		clientIP:       clientIP,
		windowSize:     defaultSlidingWindowSize,
	}
}

func (w *slidingWindowWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.wroteHeader = true
		w.ResponseWriter.WriteHeader(http.StatusOK)
	}
	if w.aborted {
		return len(b), nil
	}

	text := extractStreamText(b)
	if text != "" {
		w.accumulated.WriteString(text)
	}

	if w.cfg.Output.KeywordEnabled && !w.aborted {
		checkText := text
		if len(w.window) > 0 {
			combined := string(w.window) + text
			checkText = combined
		}
		if checkText != "" {
			matched, cat, level, kw := checkKeywords(checkText)
			if matched {
				catLabel := keywordCategoryLabels[cat]
				if catLabel == "" {
					catLabel = cat
				}
				log.Printf("[SECURITY] stream output keyword block: cat=%s level=%s keyword=%s", cat, level, kw)
				alert := &SecurityAlert{
					Timestamp: time.Now(), Direction: "output", Mode: "block",
					TriggerType: "keyword:" + cat, TriggerDetail: fmt.Sprintf("[%s/%s] %s", catLabel, level, kw),
					ContentPreview: truncate(text, 200), Model: w.reqModel,
					APIKeyUsed: w.apiKey, ClientIP: w.clientIP, Action: "abort",
				}
				dbInsertAlert(alert)
				abortMsg := fmt.Sprintf("data: {\"error\":{\"message\":\"%s\",\"type\":\"content_policy_violation\"}}\n\n", w.cfg.BlockMessage)
				w.ResponseWriter.Write([]byte(abortMsg))
				w.ResponseWriter.Write([]byte("data: [DONE]\n\n"))
				if f, ok := w.ResponseWriter.(http.Flusher); ok {
					f.Flush()
				}
				w.aborted = true
				return len(b), nil
			}
		}

		if len(text) > 0 {
			newWindow := append(w.window, []byte(text)...)
			if len(newWindow) > w.windowSize {
				newWindow = newWindow[len(newWindow)-w.windowSize:]
			}
			w.window = newWindow
		}
	}
	return w.ResponseWriter.Write(b)
}

func (w *slidingWindowWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
func (w *slidingWindowWriter) WriteHeader(code int) {
	if !w.wroteHeader {
		w.wroteHeader = true
		w.ResponseWriter.WriteHeader(code)
	}
}
func (w *slidingWindowWriter) GetAccumulated() string {
	return w.accumulated.String()
}
