package internal

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"czfy-assets/internal/store"
	"github.com/xuri/excelize/v2"
)

func TestExportCmdbWorkOrdersIncludesAllFilteredRows(t *testing.T) {
	s := newCmdbTestServer(t)
	for i := 0; i < 501; i++ {
		_, err := s.Store.CreateCmdbWorkOrder(&store.CmdbWorkOrder{
			Subject: fmt.Sprintf("导出范围测试 %d", i), BizType: "故障处理",
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Store.CreateCmdbWorkOrder(&store.CmdbWorkOrder{Subject: "不应导出", BizType: "日常维护"}); err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/cmdb/work-orders/export?biz_type=故障处理", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("导出失败: status=%d body=%s", rec.Code, rec.Body.String())
	}
	book, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	rows, err := book.GetRows("工单管理")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 502 {
		t.Fatalf("预期表头及 501 条匹配工单，实际 %d 行", len(rows))
	}
}
