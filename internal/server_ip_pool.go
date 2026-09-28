package internal

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"io"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"czfy-assets/internal/store"

	"github.com/xuri/excelize/v2"
)

// ---- IP 池网段汇总 ----
func (s *Server) handleIPPoolSummary(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	data, err := s.Store.IPPoolSummaryDataForProject(scope)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, data)
}

func (s *Server) handleIPPoolVisualization(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	list, total, err := s.Store.VisualizeIPSubnetForProject(scope, q.Get("subnet"), page, pageSize)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"list": list, "total": total, "page": page, "page_size": pageSize})
}

// ---- 网段管理（子网定义：名称 / 类别 / 网段 / 网关 / VLAN / 用途）----
func (s *Server) handleListIPSubnets(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	list, err := s.Store.ListIPSubnetsForProject(scope)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if list == nil {
		list = []store.IPSubnet{}
	}
	writeJSON(w, 200, map[string]interface{}{
		"list":       list,
		"total":      len(list),
		"categories": store.IPSubnetCategories,
	})
}

func (s *Server) handleCreateIPSubnet(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body store.IPSubnet
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.CreateIPSubnetForProject(scope, &body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id})
}

func (s *Server) handleUpdateIPSubnet(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的网段 ID")
		return
	}
	var body store.IPSubnet
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	body.ID = id
	if err := s.Store.UpdateIPSubnetForProject(scope, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleDeleteIPSubnet(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的网段 ID")
		return
	}
	if err := s.Store.DeleteIPSubnetForProject(scope, id); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// ---- IP 条目写操作 ----
func (s *Server) handleCreateIPEntry(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body store.IPEntry
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.CreateIPEntryForProject(scope, &body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id})
}

func (s *Server) handleUpdateIPEntry(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的 IP 条目 ID")
		return
	}
	var body store.IPEntry
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	body.ID = id
	if err := s.Store.UpdateIPEntryForProject(scope, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleDeleteIPEntry(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的 IP 条目 ID")
		return
	}
	// force=1 表示用户已确认「该 IP 正被资产占用，仍要强制删除池记录」
	force := r.URL.Query().Get("force") == "1"
	if err := s.Store.DeleteIPEntryForProject(scope, id, force); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// handleAllocateIP 优先关联到指定资产；旧请求仍可按人员 / 部门 / 房间登记。
func (s *Server) handleAllocateIP(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的 IP 条目 ID")
		return
	}
	var body struct {
		AssetID    int64  `json:"asset_id"`
		OwnerType  string `json:"owner_type"`
		IPField    string `json:"ip_field"`
		Department string `json:"department"`
		Account    string `json:"account"`
		Room       string `json:"room"`
		Remark     string `json:"remark"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	if body.AssetID > 0 {
		err = s.Store.AllocateIPToOwnerForProject(scope, id, body.OwnerType, body.AssetID, body.IPField, body.Remark)
	} else {
		err = s.Store.AllocateIPForProject(scope, id, body.Department, body.Account, body.Room, body.Remark)
	}
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// handleReleaseIP 释放 IP：置回空闲并清空占用信息。
func (s *Server) handleReleaseIP(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的 IP 条目 ID")
		return
	}
	if err := s.Store.ReleaseIPForProject(scope, id); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// handleNormalizeIPPool 规范化历史遗留的复合 IP 值（幂等）。
func (s *Server) handleNormalizeIPPool(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	n, err := s.Store.NormalizeIPPoolIPsForProject(scope)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"normalized": n})
}

var ipExportColumns = []string{"网段", "IP地址", "状态", "使用人/帐号", "归属部门", "房间", "备注"}

type ipImportRow struct {
	Row     int           `json:"row"`
	Name    string        `json:"name"`
	IP      store.IPEntry `json:"ip_entry"`
	Message string        `json:"message"`
}

func validImportIPv4(value string) bool {
	address, err := netip.ParseAddr(strings.TrimSpace(value))
	return err == nil && address.Is4()
}

func usedImportStatus(value string) bool {
	switch strings.TrimSpace(value) {
	case "在用", "已占用", "已分配", "占用":
		return true
	default:
		return false
	}
}

func parseIPPoolImport(r io.Reader) ([]ipImportRow, []string, error) {
	book, err := excelize.OpenReader(r)
	if err != nil {
		return nil, nil, err
	}
	defer book.Close()
	rows, err := book.GetRows(book.GetSheetName(0))
	if err != nil {
		return nil, nil, err
	}
	if len(rows) == 0 {
		return []ipImportRow{}, []string{"导入文件没有数据"}, nil
	}
	indexes := map[string]int{}
	for index, header := range rows[0] {
		indexes[strings.TrimSpace(header)] = index
	}
	errorsList := []string{}
	for _, header := range ipExportColumns {
		if _, exists := indexes[header]; !exists {
			errorsList = append(errorsList, "缺少列："+header)
		}
	}
	if len(errorsList) > 0 {
		return []ipImportRow{}, errorsList, nil
	}
	value := func(row []string, header string) string {
		index := indexes[header]
		if index >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[index])
	}
	parsed := make([]ipImportRow, 0, len(rows)-1)
	seen := map[string]bool{}
	for index, row := range rows[1:] {
		entry := store.IPEntry{Subnet: value(row, "网段"), IP: value(row, "IP地址"), Status: value(row, "状态"), Account: value(row, "使用人/帐号"), Department: value(row, "归属部门"), Room: value(row, "房间"), Remark: value(row, "备注")}
		if entry.IP == "" && entry.Subnet == "" {
			continue
		}
		if entry.Status == "" {
			entry.Status = "空闲"
		}
		message := "可导入"
		if entry.Subnet == "" {
			message = "网段不能为空"
		} else if !validImportIPv4(entry.IP) {
			message = "IP 地址格式不正确"
		} else if seen[entry.IP] {
			message = "文件内 IP 重复"
		} else if usedImportStatus(entry.Status) && entry.Account == "" && entry.Department == "" {
			message = "占用状态至少填写使用人/帐号或归属部门"
		}
		if message != "可导入" {
			errorsList = append(errorsList, "第 "+strconv.Itoa(index+2)+" 行："+message)
		}
		seen[entry.IP] = true
		parsed = append(parsed, ipImportRow{Row: index + 2, Name: entry.IP, IP: entry, Message: message})
	}
	return parsed, errorsList, nil
}

func (s *Server) handleImportIPPool(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "Excel 文件解析失败")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "请上传 xlsx 文件")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "读取 Excel 文件失败")
		return
	}
	rows, errorsList, err := parseIPPoolImport(bytes.NewReader(data))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "导入失败: "+err.Error())
		return
	}
	if r.URL.Query().Get("commit") != "1" {
		writeJSON(w, http.StatusOK, map[string]interface{}{"rows": rows, "total": len(rows), "valid": len(rows) - len(errorsList), "errors": errorsList})
		return
	}
	if len(errorsList) > 0 {
		writeErr(w, http.StatusBadRequest, "导入文件仍有校验错误: "+strings.Join(errorsList, "；"))
		return
	}
	entries := make([]store.IPEntry, 0, len(rows))
	for _, row := range rows {
		entries = append(entries, row.IP)
	}
	if err := s.Store.ImportIPEntriesForProject(requestProjectScope(r), entries); err != nil {
		writeErr(w, http.StatusBadRequest, "导入失败: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"created": len(entries)})
}

func (s *Server) handleDownloadIPPoolTemplate(w http.ResponseWriter, _ *http.Request) {
	book := excelize.NewFile()
	defer book.Close()
	sheet := book.GetSheetName(0)
	for index, header := range ipExportColumns {
		cell, _ := excelize.CoordinatesToCellName(index+1, 1)
		_ = book.SetCellValue(sheet, cell, header)
	}
	buf, err := book.WriteToBuffer()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="ipam_template.xlsx"`)
	_, _ = w.Write(buf.Bytes())
}

func ipRowValues(e store.IPEntry) []string {
	return []string{e.Subnet, e.IP, e.Status, e.Account, e.Department, e.Room, e.Remark}
}

// handleExportIPPool 按当前筛选导出全部匹配记录（不受当前页限制）。
func (s *Server) handleExportIPPool(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	q := r.URL.Query()
	list, err := s.Store.AllIPEntriesForProject(scope, store.IPEntryQuery{
		Subnet:  q.Get("subnet"),
		Status:  q.Get("status"),
		Keyword: q.Get("keyword"),
	})
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	format := q.Get("format")
	if format == "" {
		format = "xlsx"
	}
	stamp := time.Now().Format("20060102_150405")

	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename=\"IP规划池_"+stamp+".csv\"")
		w.Write([]byte{0xEF, 0xBB, 0xBF}) // UTF-8 BOM
		cw := csv.NewWriter(w)
		_ = cw.Write(ipExportColumns)
		for _, e := range list {
			_ = cw.Write(ipRowValues(e))
		}
		cw.Flush()
	case "xlsx":
		f := excelize.NewFile()
		defer f.Close()
		const sheet = "IP规划池"
		idx, _ := f.NewSheet(sheet)
		f.SetActiveSheet(idx)
		_ = f.DeleteSheet("Sheet1")
		for i, c := range ipExportColumns {
			cell, _ := excelize.CoordinatesToCellName(i+1, 1)
			_ = f.SetCellValue(sheet, cell, c)
		}
		for ri, e := range list {
			for ci, v := range ipRowValues(e) {
				cell, _ := excelize.CoordinatesToCellName(ci+1, ri+2)
				_ = f.SetCellValue(sheet, cell, v)
			}
		}
		buf, err := f.WriteToBuffer()
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		w.Header().Set("Content-Disposition", "attachment; filename=\"IP规划池_"+stamp+".xlsx\"")
		w.Write(buf.Bytes())
	default:
		writeErr(w, 400, "不支持的格式: "+format)
	}
}
