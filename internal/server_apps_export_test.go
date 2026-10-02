package internal

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"czfy-assets/internal/store"
	"github.com/xuri/excelize/v2"
)

func TestAppExportUsesCurrentFiltersAndIncludesAllPages(t *testing.T) {
	_, st, mux := newLegacyHandlerTestServer(t)
	groupID, err := st.CreateCmdbTaxonomy("groups", "业务一组", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 501; i++ {
		app := &store.ServerApp{AppName: fmt.Sprintf("目标系统-%03d", i), AppType: "审判业务", GroupID: groupID, Status: "正常运行", Provider: "测试供应商"}
		if _, err := st.CreateApp(app); err != nil {
			t.Fatalf("准备第 %d 条业务系统失败: %v", i, err)
		}
	}
	if _, err := st.CreateApp(&store.ServerApp{AppName: "其他系统", AppType: "审判业务", Status: "正常运行"}); err != nil {
		t.Fatal(err)
	}
	other, err := st.CreateCmdbProject(&store.CmdbProject{Code: "EXPORT-OTHER", Name: "其他项目"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateAppForProject(store.ProjectScope{ProjectID: other.ID}, &store.ServerApp{AppName: "目标系统-外部", AppType: "审判业务", Status: "正常运行"}); err != nil {
		t.Fatal(err)
	}

	params := url.Values{"keyword": {"目标系统"}, "app_type": {"审判业务"}, "group_id": {fmt.Sprint(groupID)}, "status": {"正常运行"}, "page": {"2"}, "page_size": {"1"}}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/apps/export?"+params.Encode(), nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("业务系统导出失败: %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Header().Get("Content-Type"), "spreadsheetml") {
		t.Fatalf("导出内容类型错误: %q", rec.Header().Get("Content-Type"))
	}
	book, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("导出结果不是 xlsx: %v", err)
	}
	defer book.Close()
	rows, err := book.GetRows("业务系统")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 502 {
		t.Fatalf("导出应包含全部 501 条匹配记录，实际行数 %d", len(rows))
	}
	if rows[0][1] != "系统名称" || rows[1][1] != "目标系统-500" || rows[501][1] != "目标系统-000" {
		t.Fatalf("导出表头或排序不正确: 首行=%v，首条=%v，末条=%v", rows[0], rows[1], rows[501])
	}
}

func TestAppExportRespectsProjectScope(t *testing.T) {
	_, st, mux := newLegacyHandlerTestServer(t)
	if _, err := st.CreateApp(&store.ServerApp{AppName: "默认项目系统", Status: "正常运行"}); err != nil {
		t.Fatal(err)
	}
	other, err := st.CreateCmdbProject(&store.CmdbProject{Code: "EXPORT-SCOPE", Name: "导出项目"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateAppForProject(store.ProjectScope{ProjectID: other.ID}, &store.ServerApp{AppName: "指定项目系统", Status: "正常运行"}); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/apps/export", nil)
	req.Header.Set("X-Cmdb-Project", fmt.Sprint(other.ID))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("按项目导出失败: %d %s", rec.Code, rec.Body.String())
	}
	book, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	rows, err := book.GetRows("业务系统")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[1][1] != "指定项目系统" {
		t.Fatalf("导出包含了其他项目记录: %v", rows)
	}
}
