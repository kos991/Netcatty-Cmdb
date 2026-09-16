package internal

import (
	"encoding/csv"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"czfy-assets/internal/store"

	"github.com/xuri/excelize/v2"
)

// ---- IP 池网段汇总 ----
func (s *Server) handleIPPoolSummary(w http.ResponseWriter, r *http.Request) {
	data, err := s.Store.IPPoolSummaryData()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, data)
}

// ---- 网段管理（子网定义：名称 / 类别 / 网段 / 网关 / VLAN / 用途）----
func (s *Server) handleListIPSubnets(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.ListIPSubnets()
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
	var body store.IPSubnet
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.CreateIPSubnet(&body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id})
}

func (s *Server) handleUpdateIPSubnet(w http.ResponseWriter, r *http.Request) {
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
	if err := s.Store.UpdateIPSubnet(&body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleDeleteIPSubnet(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的网段 ID")
		return
	}
	if err := s.Store.DeleteIPSubnet(id); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// ---- IP 条目写操作 ----
func (s *Server) handleCreateIPEntry(w http.ResponseWriter, r *http.Request) {
	var body store.IPEntry
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.CreateIPEntry(&body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id})
}

func (s *Server) handleUpdateIPEntry(w http.ResponseWriter, r *http.Request) {
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
	if err := s.Store.UpdateIPEntry(&body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleDeleteIPEntry(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的 IP 条目 ID")
		return
	}
	// force=1 表示用户已确认「该 IP 正被资产占用，仍要强制删除池记录」
	force := r.URL.Query().Get("force") == "1"
	if err := s.Store.DeleteIPEntry(id, force); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// handleAllocateIP 分配 IP：占用该地址并登记使用人 / 部门 / 房间。
func (s *Server) handleAllocateIP(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的 IP 条目 ID")
		return
	}
	var body struct {
		Department string `json:"department"`
		Account    string `json:"account"`
		Room       string `json:"room"`
		Remark     string `json:"remark"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	if err := s.Store.AllocateIP(id, body.Department, body.Account, body.Room, body.Remark); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// handleReleaseIP 释放 IP：置回空闲并清空占用信息。
func (s *Server) handleReleaseIP(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的 IP 条目 ID")
		return
	}
	if err := s.Store.ReleaseIP(id); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// handleNormalizeIPPool 规范化历史遗留的复合 IP 值（幂等）。
func (s *Server) handleNormalizeIPPool(w http.ResponseWriter, r *http.Request) {
	n, err := s.Store.NormalizeIPPoolIPs()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"normalized": n})
}

var ipExportColumns = []string{"网段", "IP地址", "状态", "使用人/帐号", "归属部门", "房间", "备注"}

func ipRowValues(e store.IPEntry) []string {
	return []string{e.Subnet, e.IP, e.Status, e.Account, e.Department, e.Room, e.Remark}
}

// handleExportIPPool 按当前筛选导出全部匹配记录（不受当前页限制）。
func (s *Server) handleExportIPPool(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	list, err := s.Store.AllIPEntries(store.IPEntryQuery{
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
