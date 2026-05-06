package main

import (
	"encoding/json"
	"io"
	"log"
	"log/slog"
	"os"
	"strings"
	"sync"
)

var (
	defaultLogger *slog.Logger
	apiReqLogger  *slog.Logger
	logLevel      = slog.LevelInfo
	currentLogLevelStr = "info"
	logMu         sync.RWMutex
	filteredWriter *levelFilterWriter
)

const (
	llError = 0
	llWarn  = 1
	llInfo  = 2
	llDebug = 3
	llTrace = 4
)

type levelFilterWriter struct {
	underlying io.Writer
	level      int
	mu         sync.RWMutex
}

func (w *levelFilterWriter) Write(p []byte) (int, error) {
	w.mu.RLock()
	allowedLevel := w.level
	w.mu.RUnlock()

	msg := string(p)
	msgLevel := llInfo

	if strings.Contains(msg, "[DEBUG]") {
		msgLevel = llDebug
	} else if strings.Contains(msg, "[TRACE]") {
		msgLevel = llTrace
	} else if strings.Contains(msg, "[WARN]") {
		msgLevel = llWarn
	} else if strings.Contains(msg, "[ERROR]") {
		msgLevel = llError
	}

	if msgLevel <= allowedLevel {
		return w.underlying.Write(p)
	}
	return len(p), nil
}

func strLevelToInt(level string) int {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "error":
		return llError
	case "warn", "warning":
		return llWarn
	case "info":
		return llInfo
	case "debug":
		return llDebug
	case "trace":
		return llTrace
	default:
		return llInfo
	}
}

func SetLogLevel(level string) {
	logMu.Lock()
	defer logMu.Unlock()
	currentLogLevelStr = strings.ToLower(strings.TrimSpace(level))
	newLevel := strLevelToInt(currentLogLevelStr)

	if filteredWriter != nil {
		filteredWriter.mu.Lock()
		filteredWriter.level = newLevel
		filteredWriter.mu.Unlock()
	}

	switch currentLogLevelStr {
	case "error":
		logLevel = slog.LevelError
	case "warn", "warning":
		logLevel = slog.LevelWarn
	case "info":
		logLevel = slog.LevelInfo
	case "debug":
		logLevel = slog.LevelDebug
	case "trace":
		logLevel = slog.LevelDebug + 1
	default:
		logLevel = slog.LevelInfo
	}
}

func initLogger(logFilePath string, levelStr string) error {
	logMu.Lock()
	currentLogLevelStr = strings.ToLower(strings.TrimSpace(levelStr))
	logMu.Unlock()

	switch currentLogLevelStr {
	case "error":
		logLevel = slog.LevelError
	case "warn", "warning":
		logLevel = slog.LevelWarn
	case "info":
		logLevel = slog.LevelInfo
	case "debug":
		logLevel = slog.LevelDebug
	case "trace":
		logLevel = slog.LevelDebug + 1
	default:
		logLevel = slog.LevelInfo
	}

	file, err := os.OpenFile(logFilePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}

	opts := &slog.HandlerOptions{Level: logLevel}
	fileHandler := slog.NewJSONHandler(file, opts)
	defaultLogger = slog.New(fileHandler)
	slog.SetDefault(defaultLogger)

	apiReqFile, err := os.OpenFile(logFilePath+".api", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}
	apiReqLogger = slog.New(slog.NewJSONHandler(apiReqFile, &slog.HandlerOptions{Level: slog.LevelInfo}))

	defaultLogger.Info("logger initialized", "level", currentLogLevelStr, "file", logFilePath)
	return nil
}

func setupFilteredLogWriter(target io.Writer, levelStr string) {
	filteredWriter = &levelFilterWriter{
		underlying: target,
		level:      strLevelToInt(levelStr),
	}
	log.SetOutput(filteredWriter)
}

func getAPIReqLogger() *slog.Logger {
	if apiReqLogger != nil {
		return apiReqLogger
	}
	return slog.Default()
}

func sanitizeHeadersForJSON(h map[string]string) map[string]string {
	safe := make(map[string]string)
	for k, v := range h {
		lower := strings.ToLower(k)
		if lower == "authorization" || lower == "cookie" || lower == "x-api-key" {
			safe[k] = "***REDACTED***"
		} else {
			safe[k] = v
		}
	}
	return safe
}

func sanitizeBodyForJSON(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	var v interface{}
	if json.Unmarshal(b, &v) == nil {
		out, _ := json.Marshal(v)
		return string(out)
	}
	return "[binary data]"
}
