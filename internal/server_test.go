package internal

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"czfy-assets/internal/store"
	"github.com/xuri/excelize/v2"
)

func newLegacyHandlerTestServer(t *testing.T) (*Server, *store.Store, *http.ServeMux) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "legacy_handler_test.db"))
	if err != nil {
		t.Fatalf("打开隔离测试数据库失败: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	server := &Server{Store: st}
	mux := http.NewServeMux()
	server.RegisterRoutes(mux)
	return server, st, mux
}

func TestLegacyAssetDetailHandlersDistinguishNotFoundAndDatabaseErrors(t *testing.T) {
	for _, path := range []string{"/api/assets/999999", "/api/assets/999999/relations"} {
		t.Run("不存在_"+path, func(t *testing.T) {
			_, _, mux := newLegacyHandlerTestServer(t)
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
			if rec.Code != http.StatusNotFound {
				t.Fatalf("不存在资产应返回 404，实际 %d，响应 %s", rec.Code, rec.Body.String())
			}
		})
	}

	for _, path := range []string{"/api/assets/1", "/api/assets/1/relations"} {
		t.Run("数据库错误_"+path, func(t *testing.T) {
			_, st, mux := newLegacyHandlerTestServer(t)
			if err := st.Close(); err != nil {
				t.Fatalf("关闭测试数据库失败: %v", err)
			}
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("数据库错误应返回 500，实际 %d，响应 %s", rec.Code, rec.Body.String())
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("错误响应不是合法 JSON: %v", err)
			}
			if !strings.Contains(body["error"], "database is closed") {
				t.Fatalf("500 必须返回真实数据库错误，实际 %q", body["error"])
			}
		})
	}
}

func TestLegacyAssetDeleteRejectsMalformedJSONWithoutArchiving(t *testing.T) {
	_, st, mux := newLegacyHandlerTestServer(t)
	id, err := st.CreateAsset(&store.Asset{AssetCode: "DELETE-JSON", Status: "在用"}, "测试")
	if err != nil {
		t.Fatalf("准备资产失败: %v", err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/assets/"+strconv.FormatInt(id, 10), bytes.NewBufferString(`{"reason":`))
	req.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("非法 JSON 必须返回 400，实际 %d，响应 %s", rec.Code, rec.Body.String())
	}
	asset, logs, err := st.GetAsset(id)
	if err != nil {
		t.Fatalf("读取拒绝后的资产失败: %v", err)
	}
	if asset.Status != "在用" || len(logs) != 0 {
		t.Fatalf("非法 JSON 不得继续归档: asset=%+v logs=%+v", asset, logs)
	}
}

func TestLegacyAssetExportUsesListFiltersAndIncludeArchived(t *testing.T) {
	_, st, mux := newLegacyHandlerTestServer(t)
	for _, asset := range []store.Asset{
		{AssetCode: "EXPORT-ACTIVE", TerminalIP: "10.20.30.41", Status: "在用"},
		{AssetCode: "EXPORT-ARCHIVED", TerminalIP: "10.20.30.42", Status: "已报废"},
	} {
		if _, err := st.CreateAsset(&asset, "测试"); err != nil {
			t.Fatalf("准备导出资产失败: %v", err)
		}
	}

	tests := []struct {
		name string
		path string
		want []string
	}{
		{name: "默认排除归档且terminal_ip可检索", path: "/api/export/assets?keyword=10.20.30", want: []string{"EXPORT-ACTIVE"}},
		{name: "显式状态查回归档", path: "/api/export/assets?keyword=10.20.30&status=%E5%B7%B2%E6%8A%A5%E5%BA%9F", want: []string{"EXPORT-ARCHIVED"}},
		{name: "include_archived导出全部匹配", path: "/api/export/assets?keyword=10.20.30&include_archived=true", want: []string{"EXPORT-ARCHIVED", "EXPORT-ACTIVE"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("导出失败，状态 %d，响应 %s", rec.Code, rec.Body.String())
			}
			book, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
			if err != nil {
				t.Fatalf("导出响应不是合法 xlsx: %v", err)
			}
			defer book.Close()
			rows, err := book.GetRows("资产台账")
			if err != nil {
				t.Fatalf("读取导出工作表失败: %v", err)
			}
			if len(rows) != len(tc.want)+1 {
				t.Fatalf("导出行数错误，want=%v rows=%v", tc.want, rows)
			}
			for i, code := range tc.want {
				if len(rows[i+1]) < 2 || rows[i+1][1] != code {
					t.Fatalf("导出资产不匹配，want=%v rows=%v", tc.want, rows)
				}
			}
		})
	}
}
