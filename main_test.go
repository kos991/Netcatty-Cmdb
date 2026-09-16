package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"czfy-assets/internal"
)

func TestNewHTTPHandlerAPIOnly(t *testing.T) {
	h, err := newHTTPHandler(&internal.Server{}, true)
	if err != nil {
		t.Fatalf("创建 API-only handler 失败: %v", err)
	}
	health := httptest.NewRecorder()
	h.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if health.Code != http.StatusOK {
		t.Fatalf("健康检查状态码=%d，期望 200", health.Code)
	}
	root := httptest.NewRecorder()
	h.ServeHTTP(root, httptest.NewRequest(http.MethodGet, "/", nil))
	if root.Code != http.StatusNotFound {
		t.Fatalf("API-only 根路径状态码=%d，期望 404", root.Code)
	}
}
