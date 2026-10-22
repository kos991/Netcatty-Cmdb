package internal

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"net/http"

	"czfy-assets/internal/store"
)

func writeWorkOrderError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrProjectScopedNotFound) {
		writeErr(w, http.StatusNotFound, "工单不存在")
		return
	}
	writeErr(w, http.StatusInternalServerError, err.Error())
}

func (s *Server) handleGetCmdbWorkOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := cmdbPathID(r)
	if !ok || id <= 0 {
		writeErr(w, http.StatusBadRequest, "无效的工单 ID")
		return
	}
	item, err := s.Store.GetCmdbWorkOrderForProject(requestProjectScope(r), id)
	if err != nil {
		writeWorkOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleListCmdbWorkOrderLogs(w http.ResponseWriter, r *http.Request) {
	id, ok := cmdbPathID(r)
	if !ok || id <= 0 {
		writeErr(w, http.StatusBadRequest, "无效的工单 ID")
		return
	}
	list, err := s.Store.ListCmdbWorkOrderLogsForProject(requestProjectScope(r), id)
	if err != nil {
		writeWorkOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"list": list, "total": len(list)})
}

func (s *Server) handleAddCmdbWorkOrderLog(w http.ResponseWriter, r *http.Request) {
	id, ok := cmdbPathID(r)
	if !ok || id <= 0 {
		writeErr(w, http.StatusBadRequest, "无效的工单 ID")
		return
	}
	var body struct {
		Content  string `json:"content"`
		Operator string `json:"operator"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
		return
	}
	item, err := s.Store.AddCmdbWorkOrderLogForProject(requestProjectScope(r), id, body.Content, body.Operator)
	if err != nil {
		if errors.Is(err, store.ErrProjectScopedNotFound) {
			writeWorkOrderError(w, err)
		} else {
			writeErr(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDownloadCmdbWorkOrderTemplate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="work-orders-template.csv"`)
	_, _ = w.Write([]byte{0xef, 0xbb, 0xbf})
	writer := csv.NewWriter(w)
	_ = writer.Write(store.WorkOrderImportColumns)
	writer.Flush()
}

func (s *Server) handleImportCmdbWorkOrders(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 32<<20)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "CSV 文件解析失败: "+err.Error())
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "请上传 CSV 文件")
		return
	}
	defer file.Close()
	result, err := s.Store.ImportCmdbWorkOrdersForProject(requestProjectScope(r), file, r.URL.Query().Get("commit") == "1")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "导入失败: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}
