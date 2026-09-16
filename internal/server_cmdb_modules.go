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
	data, err := s.Store.CmdbDashboardData()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, data)
}

// ============================ 工单管理 ============================

func (s *Server) handleListCmdbWorkOrders(w http.ResponseWriter, r *http.Request) {
	page, pageSize := cmdbPaging(r)
	q := r.URL.Query()
	list, total, err := s.Store.QueryCmdbWorkOrders(store.CmdbWorkOrderQuery{
		Keyword:    q.Get("keyword"),
		BizType:    q.Get("biz_type"),
		Status:     q.Get("status"),
		Result:     q.Get("result"),
		Owner:      q.Get("owner"),
		Maintainer: q.Get("maintainer"),
		Page:       page,
		PageSize:   pageSize,
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
	var body store.CmdbWorkOrder
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.CreateCmdbWorkOrder(&body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id})
}

func (s *Server) handleUpdateCmdbWorkOrder(w http.ResponseWriter, r *http.Request) {
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
	if err := s.Store.UpdateCmdbWorkOrder(&body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleDeleteCmdbWorkOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的工单 ID")
		return
	}
	if err := s.Store.DeleteCmdbWorkOrder(id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// ============================ 资产盘点 ============================

func (s *Server) handleListCmdbInventory(w http.ResponseWriter, r *http.Request) {
	page, pageSize := cmdbPaging(r)
	list, total, err := s.Store.QueryCmdbInventoryTasks(
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
	var body store.CmdbInventoryTask
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.CreateCmdbInventoryTask(&body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id})
}

func (s *Server) handleUpdateCmdbInventory(w http.ResponseWriter, r *http.Request) {
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
	if err := s.Store.UpdateCmdbInventoryTask(&body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleDeleteCmdbInventory(w http.ResponseWriter, r *http.Request) {
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的盘点任务 ID")
		return
	}
	if err := s.Store.DeleteCmdbInventoryTask(id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// ============================ 凭证中心 ============================

func (s *Server) handleListCmdbCredentials(w http.ResponseWriter, r *http.Request) {
	page, pageSize := cmdbPaging(r)
	list, total, err := s.Store.QueryCmdbCredentials(
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
	var body store.CmdbCredential
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.CreateCmdbCredential(&body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id})
}

func (s *Server) handleUpdateCmdbCredential(w http.ResponseWriter, r *http.Request) {
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
	if err := s.Store.UpdateCmdbCredential(&body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleDeleteCmdbCredential(w http.ResponseWriter, r *http.Request) {
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的凭证 ID")
		return
	}
	if err := s.Store.DeleteCmdbCredential(id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// ============================ 编码与标签 ============================

func (s *Server) handleListCmdbLabels(w http.ResponseWriter, r *http.Request) {
	page, pageSize := cmdbPaging(r)
	list, total, err := s.Store.QueryCmdbLabels(
		r.URL.Query().Get("tab"), r.URL.Query().Get("keyword"), page, pageSize)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	orphan, err := s.Store.CountOrphanCmdbLabels()
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
	var body struct {
		Prefix string `json:"prefix"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	prefix := body.Prefix
	if prefix == "" {
		p, err := s.Store.LabelCodePrefix()
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		prefix = p
	}
	n, err := s.Store.GenerateCmdbLabels(prefix)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"generated": n})
}

func (s *Server) handleRepairCmdbLabels(w http.ResponseWriter, r *http.Request) {
	n, err := s.Store.RepairOrphanCmdbLabels()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"handled": n})
}

func (s *Server) handlePrintCmdbLabels(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	batch := time.Now().Format("20060102150405")
	n, err := s.Store.MarkCmdbLabelsPrinted(body.IDs, batch)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"printed": n, "batch": batch})
}

func (s *Server) handleSetCmdbLabelStatus(w http.ResponseWriter, r *http.Request) {
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
	if err := s.Store.SetCmdbLabelStatus(id, body.Status); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// handlePrintedCmdbLabels 返回已打印的编码记录（打印审计）。
func (s *Server) handlePrintedCmdbLabels(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.QueryCmdbPrintedLabels(200)
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
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的编码 ID")
		return
	}
	if err := s.Store.DeleteCmdbLabel(id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleGetCmdbLabelRule(w http.ResponseWriter, r *http.Request) {
	prefix, err := s.Store.LabelCodePrefix()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"prefix": prefix})
}

func (s *Server) handleSaveCmdbLabelRule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Prefix string `json:"prefix"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	if err := s.Store.SaveLabelCodePrefix(body.Prefix); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// ============================ 配置中心：设备模型库 ============================

func (s *Server) handleListCmdbModels(w http.ResponseWriter, r *http.Request) {
	page, pageSize := cmdbPaging(r)
	list, total, err := s.Store.QueryCmdbModels(r.URL.Query().Get("keyword"), page, pageSize)
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
	var body store.CmdbDeviceModel
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.CreateCmdbModel(&body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id})
}

func (s *Server) handleUpdateCmdbModel(w http.ResponseWriter, r *http.Request) {
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
	if err := s.Store.UpdateCmdbModel(&body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleDeleteCmdbModel(w http.ResponseWriter, r *http.Request) {
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的模型 ID")
		return
	}
	if err := s.Store.DeleteCmdbModel(id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}
