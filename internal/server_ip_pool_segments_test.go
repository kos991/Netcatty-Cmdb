package internal

import (
	"encoding/csv"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"czfy-assets/internal/store"
)

func TestSegmentedAddressPoolAPIAndLegacyImport(t *testing.T) {
	_, st, mux := newLegacyHandlerTestServer(t)
	body := `{"name":"楼层池","category":"内网","cidr":"192.0.2.0/29","segments":[{"name":"速载","floor":"3楼","start_ip":"192.0.2.1","end_ip":"192.0.2.3"}]}`
	created := doJSON(t, mux, http.MethodPost, "/api/ip_subnets", body)
	if created.Code != 200 {
		t.Fatalf("创建分段池失败: %d %s", created.Code, created.Body.String())
	}
	var result struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	listed := doJSON(t, mux, http.MethodGet, "/api/ip_subnets", "")
	var catalog struct {
		List []store.IPSubnet `json:"list"`
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &catalog); err != nil || len(catalog.List) != 1 || len(catalog.List[0].Segments) != 1 {
		t.Fatalf("目录未回读分段: %+v %v", catalog, err)
	}
	segment := catalog.List[0].Segments[0]
	if _, err := st.CreateIPEntry(&store.IPEntry{Subnet: "楼层池", IP: "192.0.2.2", Status: "保留"}); err != nil {
		t.Fatal(err)
	}
	params := "?subnet=" + url.QueryEscape("楼层池") + "&segment_id=" + strconv.FormatInt(segment.ID, 10)
	visual := doJSON(t, mux, http.MethodGet, "/api/ip_pool/visualization"+params+"&page=1&page_size=2", "")
	var page struct {
		List  []store.IPEntry `json:"list"`
		Total int             `json:"total"`
	}
	if err := json.Unmarshal(visual.Body.Bytes(), &page); err != nil || visual.Code != 200 || page.Total != 3 || len(page.List) != 2 || page.List[1].Status != "保留" {
		t.Fatalf("分段方格错误: %d %+v %v", visual.Code, page, err)
	}
	query := doJSON(t, mux, http.MethodGet, "/api/ip_pool"+params, "")
	if err := json.Unmarshal(query.Body.Bytes(), &page); err != nil || query.Code != 200 || page.Total != 1 {
		t.Fatalf("分段列表错误: %d %+v %v", query.Code, page, err)
	}
	summary := doJSON(t, mux, http.MethodGet, "/api/ip_pool/summary", "")
	var overview store.IPPoolSummary
	if err := json.Unmarshal(summary.Body.Bytes(), &overview); err != nil || len(overview.Subnets) != 1 || len(overview.Subnets[0].Segments) != 1 || overview.Subnets[0].Segments[0].Reserved != 1 {
		t.Fatalf("分段汇总错误: %+v %v", overview, err)
	}
	exported := doJSON(t, mux, http.MethodGet, "/api/ip_pool/export"+params+"&format=csv", "")
	if exported.Code != 200 {
		t.Fatalf("导出失败: %d %s", exported.Code, exported.Body.String())
	}
	records, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(exported.Body.String(), "\ufeff"))).ReadAll()
	if err != nil || len(records) != 2 || records[0][7] != "分段名称" || records[1][7] != "速载" || records[1][8] != "3楼" {
		t.Fatalf("导出分段列错误: %+v %v", records, err)
	}
	legacy := [][]string{{"网段", "IP地址", "状态", "使用人/帐号", "归属部门", "房间", "备注"}, {"楼层池", "192.0.2.3", "空闲", "", "", "", ""}}
	imported := httptest.NewRecorder()
	mux.ServeHTTP(imported, ipImportRequest(t, "/api/ip_pool/import?commit=1", legacy))
	if imported.Code != 200 {
		t.Fatalf("旧格式导入失败: %d %s", imported.Code, imported.Body.String())
	}
	bad := doJSON(t, mux, http.MethodPut, "/api/ip_subnets/"+strconv.FormatInt(result.ID, 10), `{"name":"楼层池","category":"内网","cidr":"192.0.2.0/29","segments":[{"name":"越界","start_ip":"192.0.2.1","end_ip":"192.0.3.1"}]}`)
	if bad.Code != 400 || !strings.Contains(bad.Body.String(), "CIDR") {
		t.Fatalf("越界保存未明确拒绝: %d %s", bad.Code, bad.Body.String())
	}
}
