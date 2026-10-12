package internal

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"czfy-assets/internal/store"
)

// cmdbPaging 统一解析分页参数，与资源列表保持同一套生效规则。
func cmdbPaging(r *http.Request) (int, int) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 10
	}
	return page, pageSize
}

func cmdbPathID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return 0, false
	}
	return id, true
}

func listResponse(list interface{}, total, page, pageSize int) map[string]interface{} {
	return map[string]interface{}{"list": list, "total": total, "page": page, "page_size": pageSize}
}

// ============================ 仪表盘 ============================

func (s *Server) handleCmdbDashboard(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	data, err := s.Store.CmdbDashboardDataForProject(scope)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, data)
}

// ============================ 工单管理 ============================

func (s *Server) handleListCmdbWorkOrders(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	page, pageSize := cmdbPaging(r)
	q := r.URL.Query()
	list, total, err := s.Store.QueryCmdbWorkOrdersForProject(scope, store.CmdbWorkOrderQuery{
		Keyword:       q.Get("keyword"),
		BizType:       q.Get("biz_type"),
		Status:        q.Get("status"),
		Result:        q.Get("result"),
		Owner:         q.Get("owner"),
		Maintainer:    q.Get("maintainer"),
		OperationType: q.Get("operation_type"),
		Priority:      q.Get("priority"),
		DateFrom:      q.Get("date_from"),
		DateTo:        q.Get("date_to"),
		AssetKeyword:  q.Get("asset_keyword"),
		Page:          page,
		PageSize:      pageSize,
	})
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if list == nil {
		list = []store.CmdbWorkOrder{}
	}
	writeJSON(w, 200, listResponse(list, total, page, pageSize))
}

func (s *Server) handleCreateCmdbWorkOrder(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body store.CmdbWorkOrder
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.CreateCmdbWorkOrderForProject(scope, &body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id, "order_no": body.OrderNo})
}

func (s *Server) handleUpdateCmdbWorkOrder(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的工单 ID")
		return
	}
	var body store.CmdbWorkOrder
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	body.ID = id
	if err := s.Store.UpdateCmdbWorkOrderForProject(scope, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleBatchUpdateCmdbWorkOrders(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body struct {
		IDs    []int64                      `json:"ids"`
		Items  []store.CmdbWorkOrderClosure `json:"items"`
		Status string                       `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
		return
	}
	if len(body.IDs) == 0 && len(body.Items) == 0 {
		writeErr(w, http.StatusBadRequest, "至少选择一张工单")
		return
	}
	if body.Status == "" {
		body.Status = "已关闭"
	}
	if body.Status != "已关闭" {
		writeErr(w, http.StatusBadRequest, "批量操作只允许关闭已解决工单")
		return
	}
	var updated int64
	var err error
	if len(body.Items) > 0 {
		updated, err = s.Store.CloseCmdbWorkOrdersForProject(scope, body.Items)
	} else {
		updated, err = s.Store.BatchUpdateCmdbWorkOrdersStatusForProject(scope, body.IDs, body.Status)
	}
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"updated": updated, "status": body.Status})
}

func (s *Server) handleDeleteCmdbWorkOrder(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的工单 ID")
		return
	}
	if err := s.Store.DeleteCmdbWorkOrderForProject(scope, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// ============================ 资产盘点 ============================

func (s *Server) handleListCmdbInventory(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	page, pageSize := cmdbPaging(r)
	list, total, err := s.Store.QueryCmdbInventoryTasksForProject(scope,
		r.URL.Query().Get("status"), r.URL.Query().Get("keyword"), page, pageSize)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if list == nil {
		list = []store.CmdbInventoryTask{}
	}
	writeJSON(w, 200, listResponse(list, total, page, pageSize))
}

func (s *Server) handleCreateCmdbInventory(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body store.CmdbInventoryTask
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.CreateCmdbInventoryTaskForProject(scope, &body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id})
}

func (s *Server) handleUpdateCmdbInventory(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的盘点任务 ID")
		return
	}
	var body store.CmdbInventoryTask
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	body.ID = id
	if err := s.Store.UpdateCmdbInventoryTaskForProject(scope, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleDeleteCmdbInventory(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的盘点任务 ID")
		return
	}
	if err := s.Store.DeleteCmdbInventoryTaskForProject(scope, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// ============================ 凭证中心 ============================

func (s *Server) handleListCmdbCredentials(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	page, pageSize := cmdbPaging(r)
	list, total, err := s.Store.QueryCmdbCredentialsForProject(scope,
		r.URL.Query().Get("cred_type"), r.URL.Query().Get("keyword"), page, pageSize)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if list == nil {
		list = []store.CmdbCredential{}
	}
	writeJSON(w, 200, listResponse(list, total, page, pageSize))
}

func (s *Server) handleCreateCmdbCredential(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body store.CmdbCredential
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.CreateCmdbCredentialForProject(scope, &body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id})
}

func (s *Server) handleUpdateCmdbCredential(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的凭证 ID")
		return
	}
	var body store.CmdbCredential
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	body.ID = id
	if err := s.Store.UpdateCmdbCredentialForProject(scope, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleDeleteCmdbCredential(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的凭证 ID")
		return
	}
	if err := s.Store.DeleteCmdbCredentialForProject(scope, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// ============================ 编码与标签 ============================

func (s *Server) handleListCmdbLabels(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	page, pageSize := cmdbPaging(r)
	list, total, err := s.Store.QueryCmdbLabelsForProject(scope,
		r.URL.Query().Get("tab"), r.URL.Query().Get("keyword"), page, pageSize)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	orphan, err := s.Store.CountOrphanCmdbLabelsForProject(scope)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if list == nil {
		list = []store.CmdbLabel{}
	}
	resp := listResponse(list, total, page, pageSize)
	resp["orphan_count"] = orphan
	writeJSON(w, 200, resp)
}

func (s *Server) handleGenerateCmdbLabels(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body struct {
		Prefix string `json:"prefix"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	prefix := body.Prefix
	if prefix == "" {
		p, err := s.Store.LabelCodePrefixForProject(scope)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		prefix = p
	}
	n, err := s.Store.GenerateCmdbLabelsForProject(scope, prefix)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"generated": n})
}

func (s *Server) handleRepairCmdbLabels(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	n, err := s.Store.RepairOrphanCmdbLabelsForProject(scope)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"handled": n})
}

func (s *Server) handlePrintCmdbLabels(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	batch := time.Now().Format("20060102150405")
	n, err := s.Store.MarkCmdbLabelsPrintedForProject(scope, body.IDs, batch)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"printed": n, "batch": batch})
}

func (s *Server) handleSetCmdbLabelStatus(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的编码 ID")
		return
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	if body.Status != "使用中" && body.Status != "已归档" {
		writeErr(w, 400, "状态只允许「使用中」或「已归档」")
		return
	}
	if err := s.Store.SetCmdbLabelStatusForProject(scope, id, body.Status); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// handlePrintedCmdbLabels 返回已打印的编码记录（打印审计）。
func (s *Server) handlePrintedCmdbLabels(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	list, err := s.Store.QueryCmdbPrintedLabelsForProject(scope, 200)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if list == nil {
		list = []store.CmdbLabel{}
	}
	writeJSON(w, 200, map[string]interface{}{"list": list, "total": len(list)})
}

func (s *Server) handleDeleteCmdbLabel(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的编码 ID")
		return
	}
	if err := s.Store.DeleteCmdbLabelForProject(scope, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleGetCmdbLabelRule(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	prefix, err := s.Store.LabelCodePrefixForProject(scope)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"prefix": prefix})
}

func (s *Server) handleSaveCmdbLabelRule(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body struct {
		Prefix string `json:"prefix"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	if err := s.Store.SaveLabelCodePrefixForProject(scope, body.Prefix); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// ============================ 配置中心：设备模型库 ============================

func (s *Server) handleListCmdbModels(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	page, pageSize := cmdbPaging(r)
	list, total, err := s.Store.QueryCmdbModelsForProject(scope, r.URL.Query().Get("keyword"), page, pageSize)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if list == nil {
		list = []store.CmdbDeviceModel{}
	}
	writeJSON(w, 200, listResponse(list, total, page, pageSize))
}

func (s *Server) handleCreateCmdbModel(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body store.CmdbDeviceModel
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.CreateCmdbModelForProject(scope, &body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id})
}

func (s *Server) handleUpdateCmdbModel(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的模型 ID")
		return
	}
	var body store.CmdbDeviceModel
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	body.ID = id
	if err := s.Store.UpdateCmdbModelForProject(scope, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleDeleteCmdbModel(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的模型 ID")
		return
	}
	if err := s.Store.DeleteCmdbModelForProject(scope, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}
