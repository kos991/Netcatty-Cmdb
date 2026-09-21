package main

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"czfy-assets/internal"
)

func TestOpenApplicationStoreCreatesEmptyBusinessDatabase(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "assets.db")
	st, err := openApplicationStore(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	for _, table := range []string{"assets", "asset_logs", "ip_pool", "servers", "server_apps", "cmdb_assets", "cmdb_persons"} {
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil {
			t.Fatalf("%s: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("全新库 %s 有 %d 条业务数据", table, count)
		}
	}
}

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

func TestNewHTTPHandlerNeverServesRetiredBrowserUI(t *testing.T) {
	h, err := newHTTPHandler(&internal.Server{}, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/", "/index.html", "/assets/index.js"} {
		response := httptest.NewRecorder()
		h.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("停用的浏览器入口 %s 返回 %d，期望 404", path, response.Code)
		}
	}
}
