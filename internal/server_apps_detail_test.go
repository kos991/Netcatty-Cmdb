package internal

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"czfy-assets/internal/store"
	"github.com/xuri/excelize/v2"
)

func TestAppDetailReturnsScopedAppAndTransactionalHistory(t *testing.T) {
	_, st, mux := newLegacyHandlerTestServer(t)
	other, err := st.CreateCmdbProject(&store.CmdbProject{Code: "DETAIL-APP", Name: "业务系统详情项目"})
	if err != nil {
		t.Fatal(err)
	}
	app := &store.ServerApp{AppName: "项目系统", AssetCode: "APP-DETAIL", Version: "3.2", Middleware: "Tomcat", Description: "业务说明", Remark: "运维备注", Department: "审管办", NetworkType: "专网", Deployment: "容器部署", DeploymentLocation: "prod/ns", Status: "正常运行"}
	id, err := st.CreateAppForProject(store.ProjectScope{ProjectID: other.ID}, app)
	if err != nil {
		t.Fatal(err)
	}
	url := fmt.Sprintf("/api/apps/%d", id)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-project GET should return 404: %d %s", rec.Code, rec.Body.String())
	}
	request := httptest.NewRequest(http.MethodGet, url, nil)
	request.Header.Set("X-Cmdb-Project", fmt.Sprint(other.ID))
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, request)
	var detail struct {
		App  store.ServerApp      `json:"app"`
		Logs []store.ServerAppLog `json:"logs"`
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("detail failed: %d %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if detail.App.ID != id || detail.App.Version != "3.2" || detail.App.Middleware != "Tomcat" || detail.App.Description != "业务说明" || detail.App.Remark != "运维备注" || detail.App.Department != "审管办" || detail.App.Deployment != "容器部署" || detail.App.DeploymentLocation != "prod/ns" || len(detail.Logs) != 1 || detail.Logs[0].LogType != "创建" {
		t.Fatalf("detail contract lost app/history: %+v", detail)
	}
	request = httptest.NewRequest(http.MethodDelete, url, nil)
	request.Header.Set("X-Cmdb-Project", fmt.Sprint(other.ID))
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, request)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE archive failed: %d %s", rec.Code, rec.Body.String())
	}
	request = httptest.NewRequest(http.MethodGet, url, nil)
	request.Header.Set("X-Cmdb-Project", fmt.Sprint(other.ID))
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, request)
	if rec.Code != http.StatusOK {
		t.Fatalf("archived detail should remain accessible: %d %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if detail.App.Status != "已注销" || len(detail.Logs) != 2 || detail.Logs[0].LogType != "注销归档" || detail.App.AssetCode != "APP-DETAIL" {
		t.Fatalf("DELETE archive destroyed detail/history: %+v", detail)
	}
	request = httptest.NewRequest(http.MethodDelete, url, nil)
	request.Header.Set("X-Cmdb-Project", fmt.Sprint(other.ID))
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, request)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("repeated archive should be explicit: %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, url, nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-project archive should be 404: %d %s", rec.Code, rec.Body.String())
	}
	for _, suffix := range []string{"bad", "0", "-1"} {
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/apps/"+suffix, nil))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("invalid app ID %q should return 400: %d", suffix, rec.Code)
		}
	}
}

func TestAppListExportArchivedFiltersAndIndependentFields(t *testing.T) {
	_, st, mux := newLegacyHandlerTestServer(t)
	if _, err := st.CreateIPSubnet(&store.IPSubnet{Name: "业务系统网段", Category: "专网", CIDR: "10.131.0.0/24"}); err != nil {
		t.Fatal(err)
	}
	active := &store.ServerApp{AppName: "在用系统", ServiceIP: "10.131.0.10", AssetCode: "APP-EXPORT", Version: "v9", Middleware: "Nginx", Description: "独立说明", Remark: "独立备注", Department: "信息处", NetworkType: "旧网络", Deployment: "托管服务", DeploymentLocation: "供应商环境", Status: "正常运行"}
	if _, err := st.CreateApp(active); err != nil {
		t.Fatal(err)
	}
	for index, status := range []string{"已归档", "已注销"} {
		if _, err := st.CreateApp(&store.ServerApp{AppName: status + "系统", ServiceIP: fmt.Sprintf("10.131.0.%d", index+11), Department: "信息处", NetworkType: "旧网络", Status: status}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := st.CreateApp(&store.ServerApp{AppName: "别的部门", Department: "业务处", Status: "正常运行"}); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		query string
		want  int
	}{
		{"department=" + "信息处" + "&network_type=" + "专网", 1},
		{"department=" + "信息处" + "&network_type=" + "专网" + "&include_archived=true", 3},
		{"status=" + "已归档", 0},
		{"status=" + "已归档" + "&include_archived=1", 1},
		{"department=__unconfigured__", 0},
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/apps?"+tc.query, nil))
		var result struct {
			List  []store.ServerApp `json:"list"`
			Total int               `json:"total"`
		}
		if rec.Code != http.StatusOK {
			t.Fatalf("list failed for %q: %d %s", tc.query, rec.Code, rec.Body.String())
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Total != tc.want || len(result.List) != tc.want {
			t.Fatalf("list archive/filter contract %q: %+v", tc.query, result)
		}
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/apps/export?"+tc.query, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("export failed for %q: %d %s", tc.query, rec.Code, rec.Body.String())
		}
		book, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
		if err != nil {
			t.Fatal(err)
		}
		rows, err := book.GetRows("业务系统")
		book.Close()
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != tc.want+1 {
			t.Fatalf("export archive/filter contract %q: %v", tc.query, rows)
		}
		if tc.want == 1 && strings.HasPrefix(tc.query, "department=") {
			values := map[string]string{}
			for index, header := range rows[0] {
				if index < len(rows[1]) {
					values[header] = rows[1][index]
				}
			}
			for field, want := range map[string]string{"资产编号": "APP-EXPORT", "版本": "v9", "中间件": "Nginx", "说明": "独立说明", "备注": "独立备注", "所属部门": "信息处", "网络类型": "专网", "部署方式": "托管服务", "部署位置": "供应商环境"} {
				if values[field] != want {
					t.Errorf("export %s = %q, want %q", field, values[field], want)
				}
			}
		}
	}
}
