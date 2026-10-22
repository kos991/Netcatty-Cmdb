package internal

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"czfy-assets/internal/store"
)

func attachmentStorageRequest(t *testing.T, mux http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	return attachmentStorageProjectRequest(t, mux, method, path, body, "")
}

func attachmentStorageProjectRequest(t *testing.T, mux http.Handler, method, path string, body any, projectID string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(encoded)
	}
	request := httptest.NewRequest(method, path, reader)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if projectID != "" {
		request.Header.Set(cmdbProjectHeader, projectID)
	}
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, request)
	return recorder
}

func TestAttachmentStorageEndpointsMigrateProjectFiles(t *testing.T) {
	s := newCmdbTestServer(t)
	scope, err := s.Store.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	workOrderID, err := s.Store.CreateCmdbWorkOrderForProject(scope, &store.CmdbWorkOrder{Subject: "迁移附件"})
	if err != nil {
		t.Fatal(err)
	}
	attachment, err := s.Store.SaveWorkOrderAttachmentForProject(scope, workOrderID, "迁移.txt", "text/plain", strings.NewReader("migrate-me"))
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	status := attachmentStorageRequest(t, mux, http.MethodGet, "/api/cmdb/attachment-storage", nil)
	if status.Code != http.StatusOK || !bytes.Contains(status.Body.Bytes(), []byte(`"uses_default":true`)) {
		t.Fatalf("读取附件存储状态失败: status=%d body=%s", status.Code, status.Body.String())
	}

	target := filepath.Join(t.TempDir(), "custom-attachments")
	preflight := attachmentStorageRequest(t, mux, http.MethodPost, "/api/cmdb/attachment-storage/preflight", map[string]any{"target_root": target})
	if preflight.Code != http.StatusOK || !bytes.Contains(preflight.Body.Bytes(), []byte(`"file_count":1`)) {
		t.Fatalf("附件迁移预检失败: status=%d body=%s", preflight.Code, preflight.Body.String())
	}
	migrate := attachmentStorageRequest(t, mux, http.MethodPost, "/api/cmdb/attachment-storage/migrate", map[string]any{"target_root": target})
	if migrate.Code != http.StatusOK || !bytes.Contains(migrate.Body.Bytes(), []byte(`"migrated_files":1`)) {
		t.Fatalf("附件迁移失败: status=%d body=%s", migrate.Code, migrate.Body.String())
	}

	got, err := s.Store.GetWorkOrderAttachmentForProject(scope, workOrderID, attachment.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(filepath.Clean(got.StoredPath), filepath.Clean(target)+string(os.PathSeparator)) {
		t.Fatalf("迁移后附件路径错误: %q", got.StoredPath)
	}

	restore := attachmentStorageRequest(t, mux, http.MethodPost, "/api/cmdb/attachment-storage/restore-default", nil)
	if restore.Code != http.StatusOK || !bytes.Contains(restore.Body.Bytes(), []byte(`"migrated_files":1`)) {
		t.Fatalf("恢复默认附件目录失败: status=%d body=%s", restore.Code, restore.Body.String())
	}
	status = attachmentStorageRequest(t, mux, http.MethodGet, "/api/cmdb/attachment-storage", nil)
	if status.Code != http.StatusOK || !bytes.Contains(status.Body.Bytes(), []byte(`"uses_default":true`)) {
		t.Fatalf("恢复默认后状态错误: status=%d body=%s", status.Code, status.Body.String())
	}
}

func TestAttachmentStorageEndpointsRejectInvalidTargetWithoutSwitching(t *testing.T) {
	s := newCmdbTestServer(t)
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	migrate := attachmentStorageRequest(t, mux, http.MethodPost, "/api/cmdb/attachment-storage/migrate", map[string]any{"target_root": "relative/path"})
	if migrate.Code != http.StatusBadRequest {
		t.Fatalf("相对目录必须被拒绝: status=%d body=%s", migrate.Code, migrate.Body.String())
	}
	status := attachmentStorageRequest(t, mux, http.MethodGet, "/api/cmdb/attachment-storage", nil)
	if status.Code != http.StatusOK || !bytes.Contains(status.Body.Bytes(), []byte(`"uses_default":true`)) {
		t.Fatalf("迁移失败后不应切换目录: status=%d body=%s", status.Code, status.Body.String())
	}
}

func TestAttachmentCloudEndpointsListPendingAndLocalizeVerifiedDownload(t *testing.T) {
	s := newCmdbTestServer(t)
	scope, err := s.Store.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	workOrderID, err := s.Store.CreateCmdbWorkOrderForProject(scope, &store.CmdbWorkOrder{Subject: "云端附件"})
	if err != nil {
		t.Fatal(err)
	}
	attachment, err := s.Store.SaveWorkOrderAttachmentForProject(scope, workOrderID, "云端.txt", "text/plain", strings.NewReader("cloud-content"))
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	pending := attachmentStorageRequest(t, mux, http.MethodGet, "/api/cmdb/attachments/pending", nil)
	if pending.Code != http.StatusOK || !bytes.Contains(pending.Body.Bytes(), []byte(`"file_name":"云端.txt"`)) ||
		!bytes.Contains(pending.Body.Bytes(), []byte(`"local_path":`)) {
		t.Fatalf("读取待同步附件失败: status=%d body=%s", pending.Code, pending.Body.String())
	}
	if !bytes.Contains(pending.Body.Bytes(), []byte(`"local_exists":true`)) {
		t.Fatalf("待同步附件未反映本地文件存在: %s", pending.Body.String())
	}

	if err := os.Remove(attachment.StoredPath); err != nil {
		t.Fatal(err)
	}
	casPath, err := s.Store.BuildAttachmentLocalPathForProject(scope, attachment.ContentHash)
	if err != nil {
		t.Fatal(err)
	}
	_ = os.Remove(casPath)
	missingPending := attachmentStorageRequest(t, mux, http.MethodGet, "/api/cmdb/attachments/pending", nil)
	if missingPending.Code != http.StatusOK || !bytes.Contains(missingPending.Body.Bytes(), []byte(`"local_exists":false`)) {
		t.Fatalf("本地附件缺失时状态未反映为 false: status=%d body=%s", missingPending.Code, missingPending.Body.String())
	}
	legacyRoot, err := s.Store.AttachmentRoot()
	if err != nil {
		t.Fatal(err)
	}
	legacyPath := filepath.Join(legacyRoot, fmt.Sprintf("project-%d", scope.ProjectID), fmt.Sprintf("work-order-%d", workOrderID), attachment.StoredName)
	if err := os.MkdirAll(filepath.Dir(legacyPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacyPath, []byte("cloud-content"), 0o600); err != nil {
		t.Fatal(err)
	}
	legacyPending := attachmentStorageRequest(t, mux, http.MethodGet, "/api/cmdb/attachments/pending", nil)
	if legacyPending.Code != http.StatusOK || !bytes.Contains(legacyPending.Body.Bytes(), []byte(`"local_exists":true`)) {
		t.Fatalf("旧版附件路径未被识别为本地文件: status=%d body=%s", legacyPending.Code, legacyPending.Body.String())
	}

	targetRec := attachmentStorageRequest(t, mux, http.MethodPost, "/api/cmdb/attachments/temp-target", nil)
	if targetRec.Code != http.StatusCreated {
		t.Fatalf("创建附件临时目标失败: status=%d body=%s", targetRec.Code, targetRec.Body.String())
	}
	var target struct {
		Token string `json:"token"`
		Path  string `json:"path"`
	}
	if err := json.Unmarshal(targetRec.Body.Bytes(), &target); err != nil {
		t.Fatal(err)
	}
	if target.Token == "" || target.Path == "" {
		t.Fatalf("临时目标响应异常: %+v", target)
	}
	if err := os.WriteFile(target.Path, []byte("cloud-content"), 0o600); err != nil {
		t.Fatal(err)
	}

	localize := attachmentStorageRequest(t, mux, http.MethodPut,
		fmt.Sprintf("/api/cmdb/work-orders/%d/attachments/%d/localize", workOrderID, attachment.ID),
		map[string]any{"temp_token": target.Token})
	if localize.Code != http.StatusOK {
		t.Fatalf("附件本地化失败: status=%d body=%s", localize.Code, localize.Body.String())
	}
	download := httptest.NewRecorder()
	mux.ServeHTTP(download, httptest.NewRequest(http.MethodGet,
		fmt.Sprintf("/api/cmdb/work-orders/%d/attachments/%d", workOrderID, attachment.ID), nil))
	if download.Code != http.StatusOK || download.Body.String() != "cloud-content" {
		t.Fatalf("本地化后附件不可下载: status=%d body=%q", download.Code, download.Body.String())
	}
	reused := attachmentStorageRequest(t, mux, http.MethodPut,
		fmt.Sprintf("/api/cmdb/work-orders/%d/attachments/%d/localize", workOrderID, attachment.ID),
		map[string]any{"temp_token": target.Token})
	if reused.Code != http.StatusBadRequest {
		t.Fatalf("临时令牌只能使用一次: status=%d body=%s", reused.Code, reused.Body.String())
	}
}

func TestAttachmentCloudPendingListRespectsProjectScope(t *testing.T) {
	s := newCmdbTestServer(t)
	other, err := s.Store.CreateCmdbProject(&store.CmdbProject{Code: "ATTACH-OTHER", Name: "附件隔离项目"})
	if err != nil {
		t.Fatal(err)
	}
	otherScope := store.ProjectScope{ProjectID: other.ID}
	workOrderID, err := s.Store.CreateCmdbWorkOrderForProject(otherScope, &store.CmdbWorkOrder{Subject: "隔离附件"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Store.SaveWorkOrderAttachmentForProject(otherScope, workOrderID, "仅其他项目.txt", "text/plain", strings.NewReader("other")); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	defaultPending := attachmentStorageRequest(t, mux, http.MethodGet, "/api/cmdb/attachments/pending", nil)
	if defaultPending.Code != http.StatusOK || bytes.Contains(defaultPending.Body.Bytes(), []byte("仅其他项目.txt")) {
		t.Fatalf("默认项目读取到了其他项目附件: status=%d body=%s", defaultPending.Code, defaultPending.Body.String())
	}
	otherPending := attachmentStorageProjectRequest(t, mux, http.MethodGet, "/api/cmdb/attachments/pending", nil, fmt.Sprint(other.ID))
	if otherPending.Code != http.StatusOK || !bytes.Contains(otherPending.Body.Bytes(), []byte("仅其他项目.txt")) {
		t.Fatalf("指定项目未读取到自身附件: status=%d body=%s", otherPending.Code, otherPending.Body.String())
	}
}

func TestAttachmentCloudLocalizeRejectsHashMismatch(t *testing.T) {
	s := newCmdbTestServer(t)
	scope, err := s.Store.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	workOrderID, err := s.Store.CreateCmdbWorkOrderForProject(scope, &store.CmdbWorkOrder{Subject: "损坏密文"})
	if err != nil {
		t.Fatal(err)
	}
	attachment, err := s.Store.SaveWorkOrderAttachmentForProject(scope, workOrderID, "校验.txt", "text/plain", strings.NewReader("expected"))
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	targetRec := attachmentStorageRequest(t, mux, http.MethodPost, "/api/cmdb/attachments/temp-target", nil)
	var target struct {
		Token string `json:"token"`
		Path  string `json:"path"`
	}
	if err := json.Unmarshal(targetRec.Body.Bytes(), &target); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target.Path, []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}

	localize := attachmentStorageRequest(t, mux, http.MethodPut,
		fmt.Sprintf("/api/cmdb/work-orders/%d/attachments/%d/localize", workOrderID, attachment.ID),
		map[string]any{"temp_token": target.Token})
	if localize.Code != http.StatusBadRequest || !strings.Contains(localize.Body.String(), "哈希") {
		t.Fatalf("损坏附件必须被拒绝: status=%d body=%s", localize.Code, localize.Body.String())
	}
	if _, err := os.Stat(target.Path); !os.IsNotExist(err) {
		t.Fatalf("校验失败的临时文件未清理: %v", err)
	}
}
