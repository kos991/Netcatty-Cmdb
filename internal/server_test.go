package internal

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
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

func TestLegacyAssetDeleteRejectsTrailingJSONWithoutArchiving(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
	}{
		{name: "第二个JSON对象", body: `{} {}`},
		{name: "合法对象后有垃圾", body: `{"reason":"注销"} trailing`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, st, mux := newLegacyHandlerTestServer(t)
			id, err := st.CreateAsset(&store.Asset{AssetCode: "DELETE-TRAILING", Status: "在用"}, "测试")
			if err != nil {
				t.Fatalf("准备资产失败: %v", err)
			}
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodDelete, "/api/assets/"+strconv.FormatInt(id, 10), bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")
			mux.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("尾随内容必须返回 400，实际 %d，响应 %s", rec.Code, rec.Body.String())
			}
			asset, logs, err := st.GetAsset(id)
			if err != nil {
				t.Fatalf("读取拒绝后的资产失败: %v", err)
			}
			if asset.Status != "在用" || len(logs) != 0 {
				t.Fatalf("尾随内容不得继续归档: asset=%+v logs=%+v", asset, logs)
			}
		})
	}
}

func TestLegacyAssetExportUsesListFiltersAndIncludeArchived(t *testing.T) {
	_, st, mux := newLegacyHandlerTestServer(t)
	groupA, err := st.CreateCmdbTaxonomy("groups", "办公区", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	groupB, err := st.CreateCmdbTaxonomy("groups", "备件区", 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	for _, asset := range []store.Asset{
		{AssetCode: "EXPORT-ACTIVE", DeviceType: "云桌面盒子", GroupID: groupA, TerminalIP: "10.20.30.41", Status: "在用"},
		{AssetCode: "EXPORT-ARCHIVED", DeviceType: "笔记本", GroupID: groupB, IP: "10.20.30.42", Status: "已报废"},
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
		{name: "设备分类筛选与列表一致", path: "/api/export/assets?device_type=%E4%BA%91%E6%A1%8C%E9%9D%A2%E7%9B%92%E5%AD%90&include_archived=true", want: []string{"EXPORT-ACTIVE"}},
		{name: "资产分组筛选与列表一致", path: fmt.Sprintf("/api/export/assets?group_id=%d&include_archived=true", groupB), want: []string{"EXPORT-ARCHIVED"}},
		{name: "分类和分组组合筛选与列表一致", path: fmt.Sprintf("/api/export/assets?device_type=%s&group_id=%d&include_archived=true", url.QueryEscape("云桌面盒子"), groupB), want: []string{}},
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

func TestLegacyAssetExcelOmitsSoftwareInstallationColumn(t *testing.T) {
	_, _, mux := newLegacyHandlerTestServer(t)
	for _, path := range []string{"/api/export/assets", "/api/template/assets"} {
		t.Run(path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("请求失败，状态 %d，响应 %s", rec.Code, rec.Body.String())
			}
			book, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
			if err != nil {
				t.Fatal(err)
			}
			defer book.Close()
			rows, err := book.GetRows(book.GetSheetName(0))
			if err != nil || len(rows) == 0 {
				t.Fatalf("读取表头失败: %v", err)
			}
			for _, header := range rows[0] {
				if header == "软件安装情况" {
					t.Fatalf("%s 仍包含已移除列: %v", path, rows[0])
				}
			}
			headers := strings.Join(rows[0], "|")
			if !strings.Contains(headers, "设备SN/终端主机SN") || !strings.Contains(headers, "显示器SN（仅云桌面）") {
				t.Fatalf("%s 未使用按设备类型区分的 SN 表头: %v", path, rows[0])
			}
		})
	}
}

func TestLegacyAssetExportOmitsInapplicableOrdinaryDeviceFields(t *testing.T) {
	values := legacyAssetExportValues(store.Asset{DeviceType: "台式电脑", BoxSN: "PC-SN-1", DisplaySN: "DISPLAY-OLD", TerminalIP: "10.20.30.22"})
	if values[3] != "PC-SN-1" || values[4] != "" || values[9] != "" {
		t.Fatalf("普通设备导出字段错误: %v", values)
	}
	cloudValues := legacyAssetExportValues(store.Asset{DeviceType: "云桌面盒子", BoxSN: "BOX-SN-1", DisplaySN: "DISPLAY-SN-1", TerminalIP: "10.20.30.23"})
	if cloudValues[4] != "DISPLAY-SN-1" || cloudValues[9] != "10.20.30.23" {
		t.Fatalf("云桌面导出未保留双 SN/IP: %v", cloudValues)
	}
}

func TestLegacyOperationsListHandlersReturnNormalizedPagination(t *testing.T) {
	for _, path := range []string{"/api/servers", "/api/logs", "/api/servers?page=0&page_size=501", "/api/logs?page=-1&page_size=999"} {
		t.Run(path, func(t *testing.T) {
			_, _, mux := newLegacyHandlerTestServer(t)
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("列表请求失败，状态 %d，响应 %s", rec.Code, rec.Body.String())
			}
			var body struct {
				Page     int `json:"page"`
				PageSize int `json:"page_size"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("列表响应不是合法 JSON: %v", err)
			}
			if body.Page != 1 || body.PageSize != 20 {
				t.Fatalf("列表响应必须返回规范化分页 1/20，实际 %d/%d，响应 %s", body.Page, body.PageSize, rec.Body.String())
			}
		})
	}

	for _, path := range []string{"/api/servers?page=2&page_size=500", "/api/logs?page=2&page_size=500"} {
		t.Run(path, func(t *testing.T) {
			_, _, mux := newLegacyHandlerTestServer(t)
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
			var body struct {
				Page     int `json:"page"`
				PageSize int `json:"page_size"`
			}
			if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &body) != nil || body.Page != 2 || body.PageSize != 500 {
				t.Fatalf("合法分页必须原样返回，状态=%d page=%d page_size=%d 响应=%s", rec.Code, body.Page, body.PageSize, rec.Body.String())
			}
		})
	}
}

func TestLegacyOperationsServerDetailHandlerDistinguishesNotFoundAndDatabaseErrors(t *testing.T) {
	t.Run("不存在返回404", func(t *testing.T) {
		_, _, mux := newLegacyHandlerTestServer(t)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/servers/999999", nil))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("不存在服务器应返回 404，实际 %d，响应 %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("数据库错误返回500及真实错误", func(t *testing.T) {
		_, st, mux := newLegacyHandlerTestServer(t)
		if err := st.Close(); err != nil {
			t.Fatalf("关闭测试数据库失败: %v", err)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/servers/1", nil))
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
