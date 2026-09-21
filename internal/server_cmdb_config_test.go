package internal

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"czfy-assets/internal/store"
)

func TestCmdbConfigOrgTreeAndPersonIDsAPI(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "config_api.db"))
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	project, err := st.DefaultProject()
	if err != nil {
		t.Fatalf("读取默认项目: %v", err)
	}
	mux := http.NewServeMux()
	(&Server{Store: st}).RegisterRoutes(mux)

	orgID := createConfigItemAPI(t, mux, project.ID, store.ConfigKindOrgNodes, `{"node_type":"organization","name":"常州中院","sort_order":1}`)
	departmentID := createConfigItemAPI(t, mux, project.ID, store.ConfigKindOrgNodes, fmt.Sprintf(`{"node_type":"department","name":"信息技术处","parent_id":%d}`, orgID))
	groupID := createConfigItemAPI(t, mux, project.ID, store.ConfigKindOrgNodes, fmt.Sprintf(`{"node_type":"group","name":"运维组","parent_id":%d}`, departmentID))
	otherDepartmentID := createConfigItemAPI(t, mux, project.ID, store.ConfigKindOrgNodes, fmt.Sprintf(`{"node_type":"department","name":"综合处","parent_id":%d}`, orgID))

	moveReq := httptest.NewRequest(http.MethodPost, "/api/cmdb/config/org-tree/move", bytes.NewBufferString(fmt.Sprintf(`{"id":%d,"parent_id":%d,"sort_order":3}`, groupID, otherDepartmentID)))
	moveReq.Header.Set("Content-Type", "application/json")
	moveReq.Header.Set("X-Cmdb-Project", fmt.Sprint(project.ID))
	moveRec := httptest.NewRecorder()
	mux.ServeHTTP(moveRec, moveReq)
	if moveRec.Code != http.StatusOK {
		t.Fatalf("移动组织节点失败: code=%d body=%s", moveRec.Code, moveRec.Body.String())
	}

	treeReq := httptest.NewRequest(http.MethodGet, "/api/cmdb/config/org-tree", nil)
	treeReq.Header.Set("X-Cmdb-Project", fmt.Sprint(project.ID))
	treeRec := httptest.NewRecorder()
	mux.ServeHTTP(treeRec, treeReq)
	if treeRec.Code != http.StatusOK {
		t.Fatalf("读取组织树失败: code=%d body=%s", treeRec.Code, treeRec.Body.String())
	}
	var treeBody struct {
		List []store.OrgNode `json:"list"`
	}
	if err := json.Unmarshal(treeRec.Body.Bytes(), &treeBody); err != nil {
		t.Fatalf("解析组织树: %v", err)
	}
	if len(treeBody.List) != 1 || len(treeBody.List[0].Children) != 2 || len(treeBody.List[0].Children[1].Children) != 1 {
		t.Fatalf("组织树响应错误: %+v", treeBody.List)
	}

	personBody := fmt.Sprintf(`{"person_code":"EMP-API-1","name":"张三","org_id":%d,"department_id":%d,"group_id":%d,"status":"在职"}`, orgID, otherDepartmentID, groupID)
	personReq := httptest.NewRequest(http.MethodPost, "/api/cmdb/persons", bytes.NewBufferString(personBody))
	personReq.Header.Set("Content-Type", "application/json")
	personReq.Header.Set("X-Cmdb-Project", fmt.Sprint(project.ID))
	personRec := httptest.NewRecorder()
	mux.ServeHTTP(personRec, personReq)
	if personRec.Code != http.StatusOK {
		t.Fatalf("用组织节点创建人员失败: code=%d body=%s", personRec.Code, personRec.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/cmdb/persons?keyword=张三", nil)
	listReq.Header.Set("X-Cmdb-Project", fmt.Sprint(project.ID))
	listRec := httptest.NewRecorder()
	mux.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("读取人员列表失败: code=%d body=%s", listRec.Code, listRec.Body.String())
	}
	var listBody struct {
		List []store.Person `json:"list"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listBody); err != nil {
		t.Fatalf("解析人员列表: %v", err)
	}
	if len(listBody.List) != 1 || listBody.List[0].Department != "综合处" || listBody.List[0].GroupName != "运维组" {
		t.Fatalf("人员组织名称未按节点返回: %+v", listBody.List)
	}
}

func TestCmdbConfigCatalogAPIProjectIsolation(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "config_api_scope.db"))
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	projectA, err := st.CreateCmdbProject(&store.CmdbProject{Code: "config-api-a", Name: "配置项目 A"})
	if err != nil {
		t.Fatalf("创建项目 A: %v", err)
	}
	projectB, err := st.CreateCmdbProject(&store.CmdbProject{Code: "config-api-b", Name: "配置项目 B"})
	if err != nil {
		t.Fatalf("创建项目 B: %v", err)
	}
	mux := http.NewServeMux()
	(&Server{Store: st}).RegisterRoutes(mux)

	idA := createConfigItemAPI(t, mux, projectA.ID, store.ConfigKindSoftware, `{"name":"终端安全软件","vendor":"厂商甲","version":"1.0"}`)
	idB := createConfigItemAPI(t, mux, projectB.ID, store.ConfigKindSoftware, `{"name":"终端安全软件","vendor":"厂商乙","version":"2.0"}`)

	listReq := httptest.NewRequest(http.MethodGet, "/api/cmdb/config/software", nil)
	listReq.Header.Set("X-Cmdb-Project", fmt.Sprint(projectA.ID))
	listRec := httptest.NewRecorder()
	mux.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("读取项目 A 软件目录失败: code=%d body=%s", listRec.Code, listRec.Body.String())
	}
	var listBody struct {
		List []store.ConfigItem `json:"list"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listBody); err != nil {
		t.Fatalf("解析软件目录: %v", err)
	}
	if len(listBody.List) != 1 || listBody.List[0].ID != idA {
		t.Fatalf("软件目录项目隔离失败: %+v", listBody.List)
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/cmdb/config/software/%d", idB), nil)
	deleteReq.Header.Set("X-Cmdb-Project", fmt.Sprint(projectA.ID))
	deleteRec := httptest.NewRecorder()
	mux.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusBadRequest {
		t.Fatalf("项目 A 删除项目 B 配置应返回 400: code=%d body=%s", deleteRec.Code, deleteRec.Body.String())
	}

	unknownReq := httptest.NewRequest(http.MethodGet, "/api/cmdb/config/unknown", nil)
	unknownReq.Header.Set("X-Cmdb-Project", fmt.Sprint(projectA.ID))
	unknownRec := httptest.NewRecorder()
	mux.ServeHTTP(unknownRec, unknownReq)
	if unknownRec.Code != http.StatusBadRequest {
		t.Fatalf("未知配置类型应返回 400: code=%d body=%s", unknownRec.Code, unknownRec.Body.String())
	}
}

func createConfigItemAPI(t *testing.T, mux http.Handler, projectID int64, kind, body string) int64 {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/cmdb/config/"+kind, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Cmdb-Project", fmt.Sprint(projectID))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("创建 %s 配置失败: code=%d body=%s", kind, rec.Code, rec.Body.String())
	}
	var response struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil || response.ID <= 0 {
		t.Fatalf("解析 %s 创建响应: id=%d err=%v body=%s", kind, response.ID, err, rec.Body.String())
	}
	return response.ID
}
