package internal

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"czfy-assets/internal/store"
)

func TestCmdbSnapshotHTTPExportPreflightAndApply(t *testing.T) {
	s := newCmdbTestServer(t)
	scope, err := s.Store.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Store.CreateAssetForProject(scope, &store.Asset{AssetCode: "HTTP-SYNC-001", IP: "10.20.40.8", Status: "在用"}, "测试"); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	exportRec := httptest.NewRecorder()
	exportReq := projectRequest(http.MethodPost, "/api/cmdb/sync/export", []byte(`{"include_contacts":false,"include_history":false}`), scope.ProjectID)
	mux.ServeHTTP(exportRec, exportReq)
	if exportRec.Code != http.StatusOK {
		t.Fatalf("导出失败: status=%d body=%s", exportRec.Code, exportRec.Body.String())
	}
	var snapshot store.CmdbSnapshot
	if err := json.Unmarshal(exportRec.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.BaseHash == "" || snapshot.ProjectSyncID == "" {
		t.Fatalf("导出快照缺少同步元数据: %+v", snapshot)
	}
	payload, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}

	preflightRec := httptest.NewRecorder()
	mux.ServeHTTP(preflightRec, projectRequest(http.MethodPost, "/api/cmdb/sync/preflight", payload, scope.ProjectID))
	if preflightRec.Code != http.StatusOK {
		t.Fatalf("预检失败: status=%d body=%s", preflightRec.Code, preflightRec.Body.String())
	}
	var preview store.CmdbMergePreview
	if err := json.Unmarshal(preflightRec.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.Added != 0 || preview.Updated != 0 || preview.Deleted != 0 || preview.Conflicts != 0 {
		t.Fatalf("同一快照预检应无变更: %+v", preview)
	}

	applyRec := httptest.NewRecorder()
	mux.ServeHTTP(applyRec, projectRequest(http.MethodPost, "/api/cmdb/sync/apply", payload, scope.ProjectID))
	if applyRec.Code != http.StatusOK {
		t.Fatalf("应用失败: status=%d body=%s", applyRec.Code, applyRec.Body.String())
	}
}

func TestCmdbSnapshotHTTPRejectsDatabasePathAndInvalidHash(t *testing.T) {
	s := newCmdbTestServer(t)
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	unsafeRec := httptest.NewRecorder()
	unsafeReq := httptest.NewRequest(http.MethodPost, "/api/cmdb/sync/export", bytes.NewBufferString(`{"database_path":"C:\\formal\\assets.db"}`))
	unsafeReq.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(unsafeRec, unsafeReq)
	if unsafeRec.Code != http.StatusBadRequest {
		t.Fatalf("同步接口不得接受数据库路径: status=%d body=%s", unsafeRec.Code, unsafeRec.Body.String())
	}

	invalidRec := httptest.NewRecorder()
	invalidReq := httptest.NewRequest(http.MethodPost, "/api/cmdb/sync/preflight", bytes.NewBufferString(`{"schema_version":1,"project_sync_id":"wrong","base_hash":"bad","collections":{},"tombstones":[]}`))
	invalidReq.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(invalidRec, invalidReq)
	if invalidRec.Code != http.StatusBadRequest {
		t.Fatalf("无效摘要应被拒绝: status=%d body=%s", invalidRec.Code, invalidRec.Body.String())
	}
}
