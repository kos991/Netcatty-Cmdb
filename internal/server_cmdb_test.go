package internal

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"czfy-assets/internal/store"
)

func newCmdbTestServer(t *testing.T) *Server {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "server_cmdb_test.db"))
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	if _, err := st.SyncLegacyToCmdb(); err != nil {
		t.Fatalf("映射同步失败: %v", err)
	}
	return &Server{Store: st}
}

func TestHandleCmdbAssetsReturnsPagedList(t *testing.T) {
	s := newCmdbTestServer(t)
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/cmdb/assets?page=1&page_size=5", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("状态码应为 200，实际 %d，响应 %s", rec.Code, rec.Body.String())
	}
	var body struct {
		List     []store.CmdbAsset `json:"list"`
		Total    int               `json:"total"`
		Page     int               `json:"page"`
		PageSize int               `json:"page_size"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("响应不是合法 JSON: %v", err)
	}
	if body.Page != 1 || body.PageSize != 5 {
		t.Fatalf("分页回显错误: %+v", body)
	}
}

func TestHandleCmdbAssetNotFoundReturnsExplicitError(t *testing.T) {
	s := newCmdbTestServer(t)
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/cmdb/assets/999999", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("不存在资产应返回 404，实际 %d", rec.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["error"] == "" {
		t.Fatalf("404 必须带明确 error 说明，实际响应 %s", rec.Body.String())
	}
}

func TestHandleReplaceCmdbAssetPersistsCompleteProfile(t *testing.T) {
	s := newCmdbTestServer(t)
	id, err := s.Store.CreateCmdbAssetManual(&store.CmdbAsset{Name: "待完善设备", Status: "在库"})
	if err != nil {
		t.Fatal(err)
	}
	payload := store.CmdbAsset{
		Name: "核心交换机", Status: "在线", AssetClass: "physical", DeviceType: "switch",
		Province: "江苏省", City: "常州市", Address: "机房 A", PortCount: 48,
		RatedPowerW: 300, OSType: "网络设备系统", OSVersion: "1.0",
		Interfaces: []store.CmdbAssetInterface{{Name: "mgmt0", IP: "10.20.30.40", Mask: "24", NetworkZone: "管理网", IsPrimary: 1}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	req := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/cmdb/assets/%d/full", id), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("完整资产保存失败: status=%d body=%s", rec.Code, rec.Body.String())
	}
	asset, interfaces, err := s.Store.GetCmdbAsset(id)
	if err != nil {
		t.Fatal(err)
	}
	if asset.Name != payload.Name || asset.City != payload.City || asset.PortCount != 48 || asset.OSVersion != "1.0" {
		t.Fatalf("完整字段未保存: %+v", asset)
	}
	if len(interfaces) != 1 || interfaces[0].IP != "10.20.30.40" || interfaces[0].IsPrimary != 1 {
		t.Fatalf("网络接口未保存: %+v", interfaces)
	}
}
