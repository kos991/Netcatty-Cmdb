package internal

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"czfy-assets/internal/store"
)

func doJSON(t *testing.T, mux *http.ServeMux, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestCmdbModuleEndpoints(t *testing.T) {
	s := newCmdbTestServer(t)
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	// --- 仪表盘 ---
	rec := doJSON(t, mux, http.MethodGet, "/api/cmdb/dashboard", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("仪表盘应返回 200，实际 %d %s", rec.Code, rec.Body.String())
	}
	var dash map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &dash); err != nil {
		t.Fatalf("仪表盘响应不是合法 JSON: %v", err)
	}
	for _, k := range []string{"total", "health_rate", "status_counts", "department_dist", "recent_work_orders"} {
		if _, ok := dash[k]; !ok {
			t.Fatalf("仪表盘缺少字段 %s", k)
		}
	}

	// --- 工单：新增 + 列表 + 空主题必须报错 ---
	rec = doJSON(t, mux, http.MethodPost, "/api/cmdb/work-orders",
		`{"subject":"更换硬盘","biz_type":"故障处理","status":"新建","priority":"高"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("新增工单应返回 200，实际 %d %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(t, mux, http.MethodPost, "/api/cmdb/work-orders", `{"subject":""}`)
	if rec.Code == http.StatusOK {
		t.Fatalf("空主题必须返回错误，实际 200")
	}
	rec = doJSON(t, mux, http.MethodGet, "/api/cmdb/work-orders?page=1&page_size=10", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("工单列表应返回 200，实际 %d", rec.Code)
	}
	var woList struct {
		List     []store.CmdbWorkOrder `json:"list"`
		Total    int                   `json:"total"`
		Page     int                   `json:"page"`
		PageSize int                   `json:"page_size"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &woList); err != nil {
		t.Fatalf("工单列表响应非法: %v", err)
	}
	if woList.Total != 1 || woList.Page != 1 || woList.PageSize != 10 {
		t.Fatalf("工单列表分页回显错误: %+v", woList)
	}
	if woList.List[0].OrderNo == "" {
		t.Fatalf("工单号应自动生成")
	}

	// --- 盘点 ---
	rec = doJSON(t, mux, http.MethodPost, "/api/cmdb/inventory", `{"name":"三季度盘点","status":"执行中","progress":30}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("新增盘点应返回 200，实际 %d %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(t, mux, http.MethodGet, "/api/cmdb/inventory?status=%E6%89%A7%E8%A1%8C%E4%B8%AD", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("盘点列表应返回 200，实际 %d", rec.Code)
	}

	// --- 凭证 ---
	rec = doJSON(t, mux, http.MethodPost, "/api/cmdb/credentials",
		`{"name":"核心交换机 SSH","cred_type":"SSH","description":"只读账号"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("新增凭证应返回 200，实际 %d %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(t, mux, http.MethodGet, "/api/cmdb/credentials?cred_type=SSH", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("凭证列表应返回 200，实际 %d", rec.Code)
	}

	// --- 编码与标签：生成 + 分页 + 孤儿计数 + 规则 ---
	// 先造两台资产（测试库是空的，种子数据只在 main.go 导入）
	for _, a := range []store.CmdbAsset{
		{Name: "测试交换机", AssetCode: "ZC-T-1", Status: "在线"},
		{Name: "测试配线架", AssetCode: "ZC-T-2", Status: "在库"},
	} {
		if _, err := s.Store.InsertCmdbAsset(&a); err != nil {
			t.Fatalf("准备测试资产失败: %v", err)
		}
	}
	rec = doJSON(t, mux, http.MethodPost, "/api/cmdb/labels/generate", `{"prefix":"ZC"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("生成编码应返回 200，实际 %d %s", rec.Code, rec.Body.String())
	}
	var gen struct {
		Generated int `json:"generated"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &gen)
	if gen.Generated != 2 {
		t.Fatalf("应为 2 条资产生成编码，实际 %d", gen.Generated)
	}
	rec = doJSON(t, mux, http.MethodGet, "/api/cmdb/labels?tab=%E4%BD%BF%E7%94%A8%E4%B8%AD&page=1&page_size=5", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("编码列表应返回 200，实际 %d", rec.Code)
	}
	var labels struct {
		List        []store.CmdbLabel `json:"list"`
		Total       int               `json:"total"`
		OrphanCount int               `json:"orphan_count"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &labels); err != nil {
		t.Fatalf("编码列表响应非法: %v", err)
	}
	if labels.Total != 2 || labels.OrphanCount != 0 {
		t.Fatalf("编码列表统计错误: total=%d orphan=%d", labels.Total, labels.OrphanCount)
	}
	// 批量打印
	ids := []int64{labels.List[0].ID}
	payload, _ := json.Marshal(map[string]interface{}{"ids": ids})
	rec = doJSON(t, mux, http.MethodPost, "/api/cmdb/labels/print", string(payload))
	if rec.Code != http.StatusOK {
		t.Fatalf("批量打印应返回 200，实际 %d %s", rec.Code, rec.Body.String())
	}
	// 规则读写
	rec = doJSON(t, mux, http.MethodPut, "/api/cmdb/labels/rule", `{"prefix":"CZFZ"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("保存编码规则应返回 200，实际 %d", rec.Code)
	}
	rec = doJSON(t, mux, http.MethodGet, "/api/cmdb/labels/rule", "")
	var rule struct {
		Prefix string `json:"prefix"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &rule)
	if rule.Prefix != "CZFZ" {
		t.Fatalf("编码前缀应为 CZFZ，实际 %s", rule.Prefix)
	}
	// 非法状态必须报错
	rec = doJSON(t, mux, http.MethodPut, "/api/cmdb/labels/1/status", `{"status":"乱写"}`)
	if rec.Code == http.StatusOK {
		t.Fatalf("非法状态必须返回错误")
	}

	// --- 配置中心：设备模型库 ---
	rec = doJSON(t, mux, http.MethodPost, "/api/cmdb/models",
		`{"vendor":"浪潮","model":"NF5280M6","height_u":2,"rated_power_w":800}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("新增模型应返回 200，实际 %d %s", rec.Code, rec.Body.String())
	}
	// 厂商+型号 重复必须给出明确错误
	rec = doJSON(t, mux, http.MethodPost, "/api/cmdb/models", `{"vendor":"浪潮","model":"NF5280M6"}`)
	if rec.Code == http.StatusOK {
		t.Fatalf("重复模型必须返回错误")
	}
	if rec.Body.Len() == 0 {
		t.Fatalf("重复模型必须带明确错误说明")
	}
	// 空型号必须报错
	rec = doJSON(t, mux, http.MethodPost, "/api/cmdb/models", `{"vendor":"华为"}`)
	if rec.Code == http.StatusOK {
		t.Fatalf("空型号必须返回错误")
	}
	rec = doJSON(t, mux, http.MethodGet, "/api/cmdb/models?page=1&page_size=10", "")
	var models struct {
		Total int `json:"total"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &models)
	if models.Total != 1 {
		t.Fatalf("模型数应为 1，实际 %d", models.Total)
	}
}
