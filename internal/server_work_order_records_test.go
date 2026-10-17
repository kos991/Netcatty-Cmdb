package internal

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"czfy-assets/internal/store"
)

func TestCurrentProjectAndWorkOrderRecordsRespectRequestScope(t *testing.T) {
	s := newCmdbTestServer(t)
	a, scopeA := createHTTPTestProject(t, s, "records-a")
	b, _ := createHTTPTestProject(t, s, "records-b")
	id, err := s.Store.CreateCmdbWorkOrderForProject(scopeA, &store.CmdbWorkOrder{Subject: "真实处理记录", Owner: "张三"})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	current := httptest.NewRecorder()
	mux.ServeHTTP(current, projectRequest(http.MethodGet, "/api/cmdb/projects/current", nil, a.ID))
	var project store.CmdbProject
	if err := json.Unmarshal(current.Body.Bytes(), &project); err != nil {
		t.Fatal(err)
	}
	if current.Code != http.StatusOK || project.ID != a.ID || project.Code != a.Code {
		t.Fatalf("current project: %d %+v", current.Code, project)
	}
	path := fmt.Sprintf("/api/cmdb/work-orders/%d", id)
	for _, endpoint := range []string{path, path + "/logs"} {
		wrong := httptest.NewRecorder()
		mux.ServeHTTP(wrong, projectRequest(http.MethodGet, endpoint, nil, b.ID))
		if wrong.Code != http.StatusNotFound {
			t.Fatalf("cross-project read %s: %d %s", endpoint, wrong.Code, wrong.Body.String())
		}
	}
	wrongWrite := httptest.NewRecorder()
	mux.ServeHTTP(wrongWrite, projectRequest(http.MethodPost, path+"/logs", []byte(`{"content":"越权记录","operator":"李四"}`), b.ID))
	if wrongWrite.Code != http.StatusNotFound {
		t.Fatalf("cross-project write: %d %s", wrongWrite.Code, wrongWrite.Body.String())
	}
	created := httptest.NewRecorder()
	mux.ServeHTTP(created, projectRequest(http.MethodPost, path+"/logs", []byte(`{"content":"已完成现场排查","operator":"李四","created_at":"2000-01-01"}`), a.ID))
	var saved store.CmdbWorkOrderLog
	if err := json.Unmarshal(created.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if created.Code != http.StatusOK || saved.ID == 0 || saved.Content != "已完成现场排查" || saved.CreatedAt == "" || saved.CreatedAt == "2000-01-01" {
		t.Fatalf("saved record: %d %+v", created.Code, saved)
	}
	logs := httptest.NewRecorder()
	mux.ServeHTTP(logs, projectRequest(http.MethodGet, path+"/logs", nil, a.ID))
	var records struct {
		List  []store.CmdbWorkOrderLog `json:"list"`
		Total int                      `json:"total"`
	}
	if err := json.Unmarshal(logs.Body.Bytes(), &records); err != nil {
		t.Fatal(err)
	}
	if records.Total != 2 || records.List[0].ID != saved.ID {
		t.Fatalf("record list: %+v", records)
	}
	get := httptest.NewRecorder()
	mux.ServeHTTP(get, projectRequest(http.MethodGet, path, nil, a.ID))
	var order store.CmdbWorkOrder
	if err := json.Unmarshal(get.Body.Bytes(), &order); err != nil {
		t.Fatal(err)
	}
	if get.Code != http.StatusOK || order.ID != id || order.Subject != "真实处理记录" {
		t.Fatalf("detail: %d %+v", get.Code, order)
	}
}

func TestWorkOrderCSVTemplatePreviewAndCommit(t *testing.T) {
	s := newCmdbTestServer(t)
	project, scope := createHTTPTestProject(t, s, "csv-order")
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	template := httptest.NewRecorder()
	mux.ServeHTTP(template, projectRequest(http.MethodGet, "/api/cmdb/work-orders/template", nil, project.ID))
	if template.Code != http.StatusOK || !strings.Contains(template.Body.String(), "维护主题") {
		t.Fatalf("template: %d %s", template.Code, template.Body.String())
	}
	data := strings.TrimSpace(template.Body.String()) + "\n交换机巡检,日常维护,巡检,高,2026-10-16 09:00:00,张三,李四,现场巡检,\n"
	for _, commit := range []bool{false, true} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, err := writer.CreateFormFile("file", "orders.csv")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write([]byte(data)); err != nil {
			t.Fatal(err)
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		target := "/api/cmdb/work-orders/import"
		if commit {
			target += "?commit=1"
		}
		req := projectRequest(http.MethodPost, target, body.Bytes(), project.ID)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		var result store.WorkOrderImportResult
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		wantCreated := 0
		if commit {
			wantCreated = 1
		}
		if rec.Code != http.StatusOK || result.Valid != 1 || result.Created != wantCreated {
			t.Fatalf("import commit=%v: %d %+v", commit, rec.Code, result)
		}
		list, total, err := s.Store.QueryCmdbWorkOrdersForProject(scope, store.CmdbWorkOrderQuery{Page: 1, PageSize: 10})
		if err != nil {
			t.Fatal(err)
		}
		if total != wantCreated {
			t.Fatalf("preview wrote data: %d", total)
		}
		if commit && (list[0].OrderNo == "" || list[0].Status != "新建" || list[0].StartedAt != "") {
			t.Fatalf("import lifecycle: %+v", list[0])
		}
	}
}
