package internal

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"czfy-assets/internal/store"
)

func TestSwitchSnapshotAPIWritesAndReturnsLatestSnapshot(t *testing.T) {
	s := newCmdbTestServer(t)
	scope, _ := s.Store.DefaultProjectScope()
	assetID, err := s.Store.CreateCmdbAssetManualForProject(scope, &store.CmdbAsset{Name: "核心交换机", DeviceType: "switch"})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	body := `{"vendor":"huawei","protocol":"ssh","host_id":"host-1","read_at":"2026-09-22T12:00:00Z","snapshot":{"device":{"name":"CORE-SW"},"interfaces":[]}}`
	put := httptest.NewRecorder()
	mux.ServeHTTP(put, httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/cmdb/assets/%d/switch-snapshot", assetID), strings.NewReader(body)))
	if put.Code != http.StatusOK {
		t.Fatalf("保存快照失败: %d %s", put.Code, put.Body.String())
	}

	get := httptest.NewRecorder()
	mux.ServeHTTP(get, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/cmdb/assets/%d/switch-snapshot", assetID), nil))
	if get.Code != http.StatusOK {
		t.Fatalf("读取快照失败: %d %s", get.Code, get.Body.String())
	}
	var payload struct {
		Snapshot map[string]any `json:"snapshot"`
		HostID   string         `json:"host_id"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.HostID != "host-1" || payload.Snapshot["device"].(map[string]any)["name"] != "CORE-SW" {
		t.Fatalf("快照响应错误: %+v", payload)
	}
}

func TestSwitchSnapshotAPIReturnsNoContentWhenEmpty(t *testing.T) {
	s := newCmdbTestServer(t)
	scope, _ := s.Store.DefaultProjectScope()
	assetID, _ := s.Store.CreateCmdbAssetManualForProject(scope, &store.CmdbAsset{Name: "空交换机", DeviceType: "switch"})
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/cmdb/assets/%d/switch-snapshot", assetID), nil))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("空快照应返回 204，实际 %d %s", rec.Code, rec.Body.String())
	}
}
