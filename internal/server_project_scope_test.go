package internal

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"czfy-assets/internal/store"
)

func createHTTPTestProject(t *testing.T, s *Server, code string) (*store.CmdbProject, store.ProjectScope) {
	t.Helper()
	project, err := s.Store.CreateCmdbProject(&store.CmdbProject{Code: code, Name: "项目 " + code})
	if err != nil {
		t.Fatal(err)
	}
	return project, store.ProjectScope{ProjectID: project.ID}
}

func projectRequest(method, target string, body []byte, projectID int64) *http.Request {
	req := httptest.NewRequest(method, target, bytes.NewReader(body))
	if projectID > 0 {
		req.Header.Set("X-Cmdb-Project", fmt.Sprint(projectID))
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return req
}

func TestProjectHeaderScopesLegacyAndCmdbHTTP(t *testing.T) {
	s := newCmdbTestServer(t)
	projectA, scopeA := createHTTPTestProject(t, s, "http-a")
	projectB, scopeB := createHTTPTestProject(t, s, "http-b")
	defaultScope, err := s.Store.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}

	for _, fixture := range []struct {
		scope store.ProjectScope
		name  string
	}{
		{scope: defaultScope, name: "默认项目资产"},
		{scope: scopeA, name: "项目 A 资产"},
		{scope: scopeB, name: "项目 B 资产"},
	} {
		if _, err := s.Store.CreateCmdbAssetManualForProject(fixture.scope, &store.CmdbAsset{Name: fixture.name}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Store.CreateAssetForProject(fixture.scope, &store.Asset{AssetCode: fixture.name}, "测试"); err != nil {
			t.Fatal(err)
		}
	}

	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	for _, tc := range []struct {
		name      string
		projectID int64
		want      string
	}{
		{name: "缺少头使用默认项目", want: "默认项目资产"},
		{name: "项目 A", projectID: projectA.ID, want: "项目 A 资产"},
		{name: "项目 B", projectID: projectB.ID, want: "项目 B 资产"},
	} {
		t.Run(tc.name+"_CMDB", func(t *testing.T) {
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, projectRequest(http.MethodGet, "/api/cmdb/assets?page=1&page_size=20", nil, tc.projectID))
			if rec.Code != http.StatusOK {
				t.Fatalf("状态码=%d 响应=%s", rec.Code, rec.Body.String())
			}
			var response struct {
				List  []store.CmdbAsset `json:"list"`
				Total int               `json:"total"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Total != 1 || len(response.List) != 1 || response.List[0].Name != tc.want {
				t.Fatalf("项目隔离失败: %+v", response)
			}
		})

		t.Run(tc.name+"_旧台账", func(t *testing.T) {
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, projectRequest(http.MethodGet, "/api/assets?page=1&page_size=20", nil, tc.projectID))
			if rec.Code != http.StatusOK {
				t.Fatalf("状态码=%d 响应=%s", rec.Code, rec.Body.String())
			}
			var response struct {
				List  []store.Asset `json:"list"`
				Total int           `json:"total"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Total != 1 || len(response.List) != 1 || response.List[0].AssetCode != tc.want {
				t.Fatalf("旧台账项目隔离失败: %+v", response)
			}
		})
	}
}

func TestProjectHeaderRejectsInvalidValues(t *testing.T) {
	s := newCmdbTestServer(t)
	deleted, _ := createHTTPTestProject(t, s, "http-deleted")
	if err := s.Store.DeleteCmdbProject(deleted.ID); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	tests := []struct {
		name   string
		values []string
	}{
		{name: "空值", values: []string{""}},
		{name: "非数字", values: []string{"abc"}},
		{name: "非正数", values: []string{"0"}},
		{name: "不存在", values: []string{"999999"}},
		{name: "已删除", values: []string{fmt.Sprint(deleted.ID)}},
		{name: "重复", values: []string{"1", "2"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/cmdb/assets", nil)
			req.Header[http.CanonicalHeaderKey("X-Cmdb-Project")] = tc.values
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("状态码=%d，响应=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestProjectHeaderOverridesBodyProjectID(t *testing.T) {
	s := newCmdbTestServer(t)
	projectA, scopeA := createHTTPTestProject(t, s, "http-body-a")
	projectB, scopeB := createHTTPTestProject(t, s, "http-body-b")
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	payload, _ := json.Marshal(store.CmdbAsset{Name: "请求头决定归属", ProjectID: projectB.ID})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, projectRequest(http.MethodPost, "/api/cmdb/assets", payload, projectA.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("状态码=%d 响应=%s", rec.Code, rec.Body.String())
	}
	_, totalA, err := s.Store.QueryCmdbAssetsForProject(scopeA, store.CmdbAssetQuery{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	_, totalB, err := s.Store.QueryCmdbAssetsForProject(scopeB, store.CmdbAssetQuery{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if totalA != 1 || totalB != 0 {
		t.Fatalf("请求体覆盖了请求头项目: totalA=%d totalB=%d", totalA, totalB)
	}
}

func TestCmdbProjectHTTPCRUD(t *testing.T) {
	s := newCmdbTestServer(t)
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	createBody := []byte(`{"code":"http-crud","name":"HTTP 项目"}`)
	createRec := httptest.NewRecorder()
	mux.ServeHTTP(createRec, projectRequest(http.MethodPost, "/api/cmdb/projects", createBody, 0))
	if createRec.Code != http.StatusOK {
		t.Fatalf("创建状态码=%d 响应=%s", createRec.Code, createRec.Body.String())
	}
	var created store.CmdbProject
	if err := json.Unmarshal(createRec.Body.Bytes(), &created); err != nil || created.ID == 0 {
		t.Fatalf("创建响应无效: project=%+v err=%v", created, err)
	}

	updateBody := []byte(`{"id":999999,"code":"http-crud","name":"HTTP 项目新名称"}`)
	updateRec := httptest.NewRecorder()
	mux.ServeHTTP(updateRec, projectRequest(http.MethodPut, fmt.Sprintf("/api/cmdb/projects/%d", created.ID), updateBody, 0))
	if updateRec.Code != http.StatusOK {
		t.Fatalf("修改状态码=%d 响应=%s", updateRec.Code, updateRec.Body.String())
	}
	updated, err := s.Store.GetCmdbProject(created.ID)
	if err != nil || updated.Name != "HTTP 项目新名称" {
		t.Fatalf("路径 ID 未生效: project=%+v err=%v", updated, err)
	}

	listRec := httptest.NewRecorder()
	mux.ServeHTTP(listRec, projectRequest(http.MethodGet, "/api/cmdb/projects", nil, 0))
	if listRec.Code != http.StatusOK {
		t.Fatalf("列表状态码=%d 响应=%s", listRec.Code, listRec.Body.String())
	}
	var listBody struct {
		List []store.CmdbProject `json:"list"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listBody); err != nil || len(listBody.List) != 2 {
		t.Fatalf("项目列表错误: %+v err=%v", listBody, err)
	}
}
