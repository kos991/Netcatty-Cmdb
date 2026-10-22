package internal

import (
	"bytes"
	"encoding/json"
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
		app := &store.ServerApp{AppName: fmt.Sprintf("目标系统-%03d", i), AppType: "审判业务", GroupID: groupID, Status: "正常运行", Provider: "测试供应商", Owner: "张三"}
		if _, err := st.CreateApp(app); err != nil {
			t.Fatalf("准备第 %d 条业务系统失败: %v", i, err)
		}
	}
	if _, err := st.CreateApp(&store.ServerApp{AppName: "目标系统-错误负责人", AppType: "审判业务", GroupID: groupID, Status: "正常运行", Provider: "测试供应商", Owner: "李四"}); err != nil {
		t.Fatal(err)
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

	params := url.Values{"keyword": {"目标系统"}, "app_type": {"审判业务"}, "group_id": {fmt.Sprint(groupID)}, "provider": {"测试供应商"}, "owner": {"张三"}, "host_linked": {"unlinked"}, "status": {"正常运行"}, "page": {"2"}, "page_size": {"1"}}
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

func TestAppExportMatchesResolvedNetworkFilters(t *testing.T) {
	_, st, mux := newLegacyHandlerTestServer(t)
	for _, subnet := range []store.IPSubnet{
		{Name: "承载业务", Category: "承载网络", CIDR: "10.134.0.0/24"},
		{Name: "承载管理", Category: "管理网络", CIDR: "10.135.0.0/24"},
		{Name: "系统大网段", Category: "外网", CIDR: "172.23.0.0/16"},
		{Name: "系统小网段", Category: "专网", CIDR: "172.23.5.0/24"},
	} {
		subnet := subnet
		if _, err := st.CreateIPSubnet(&subnet); err != nil {
			t.Fatal(err)
		}
	}
	hostID, err := st.CreateCmdbAssetManual(&store.CmdbAsset{
		Name: "承载服务器", DeviceType: "服务器", MgmtIP: "10.135.0.10", BizIP: "10.134.0.10", NetType: "承载网络",
		Interfaces: []store.CmdbAssetInterface{{Name: "服务接口", AdditionalIPsJSON: `[{"ip":"172.23.5.20","purpose":"business"},{"ip":"172.23.5.21","purpose":"business"}]`}},
	})
	if err != nil {
		t.Fatal(err)
	}
	wantIPs := map[string]string{"独立服务一": "172.23.5.20", "独立服务二": "172.23.5.21", "仅承载地址": "", "来源缺失": "203.0.113.21"}
	for _, app := range []store.ServerApp{
		{AppName: "独立服务一", CmdbAssetID: hostID, ServiceIP: wantIPs["独立服务一"], NetworkType: "旧登记"},
		{AppName: "独立服务二", CmdbAssetID: hostID, ServiceIP: wantIPs["独立服务二"], NetworkType: "旧登记"},
		{AppName: "仅承载地址", CmdbAssetID: hostID, NetworkType: "旧登记"},
		{AppName: "来源缺失", ServiceIP: wantIPs["来源缺失"], NetworkType: "旧登记"},
	} {
		app := app
		if _, err := st.CreateApp(&app); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		field, filter, network string
		count                  int
	}{
		{"network_type", "专网", "专网", 2},
		{"network_type", store.AssetUnconfiguredFilter, "", 2},
		{"network_type", "承载网络", "", 0},
		{"network_type", "管理网络", "", 0},
		{"network_type", "外网", "", 0},
		{"keyword", "专网", "专网", 2},
		{"keyword", "旧登记", "", 0},
	} {
		params := url.Values{tc.field: {tc.filter}, "page": {"2"}, "page_size": {"1"}}
		listRec := httptest.NewRecorder()
		mux.ServeHTTP(listRec, httptest.NewRequest(http.MethodGet, "/api/apps?"+params.Encode(), nil))
		var list struct {
			List  []store.ServerApp `json:"list"`
			Total int               `json:"total"`
		}
		if listRec.Code != http.StatusOK {
			t.Fatalf("list %v failed: %d %s", params, listRec.Code, listRec.Body.String())
		}
		if err := json.Unmarshal(listRec.Body.Bytes(), &list); err != nil {
			t.Fatal(err)
		}
		if list.Total != tc.count || len(list.List) != min(tc.count, 1) {
			t.Fatalf("list derived filter %v: %+v", params, list)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/apps/export?"+params.Encode(), nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("export %v failed: %d %s", params, rec.Code, rec.Body.String())
		}
		book, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
		if err != nil {
			t.Fatal(err)
		}
		rows, err := book.GetRows("业务系统")
		book.Close()
		if err != nil || len(rows) != tc.count+1 {
			t.Fatalf("export must include all matching list records: params=%v rows=%v err=%v", params, rows, err)
		}
		for _, row := range rows[1:] {
			values := map[string]string{}
			for index, header := range rows[0] {
				if index < len(row) {
					values[header] = row[index]
				}
			}
			if values["网络类型"] != tc.network || values["业务 IP"] != wantIPs[values["系统名称"]] {
				t.Fatalf("export borrowed host network/address or stale explicit value: %v", values)
			}
		}
	}
}
