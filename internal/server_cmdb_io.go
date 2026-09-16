package internal

import (
	"bytes"
	"encoding/csv"
	"io"
	"net/http"
	"strconv"
	"time"

	"czfy-assets/internal/store"

	"github.com/xuri/excelize/v2"
)

// cmdbQueryFromRequest 解析资源列表的查询参数（列表 / 导出 / 导入共用同一套筛选）。
func cmdbQueryFromRequest(r *http.Request, page, pageSize int) store.CmdbAssetQuery {
	q := r.URL.Query()
	categoryID, _ := strconv.ParseInt(q.Get("category_id"), 10, 64)
	orgID, _ := strconv.ParseInt(q.Get("org_id"), 10, 64)
	groupID, _ := strconv.ParseInt(q.Get("group_id"), 10, 64)
	return store.CmdbAssetQuery{
		Keyword:    q.Get("keyword"),
		CategoryID: categoryID,
		OrgID:      orgID,
		GroupID:    groupID,
		Status:     q.Get("status"),
		OSType:     q.Get("os_type"),
		OSVersion:  q.Get("os_version"),
		MgmtIP:     q.Get("mgmt_ip"),
		SourceType: q.Get("source_type"),
		Page:       page,
		PageSize:   pageSize,
		SortBy:     q.Get("sort_by"),
		SortOrder:  q.Get("sort_order"),
	}
}

// ---- 列头筛选可选值 ----
func (s *Server) handleCmdbAssetFilters(w http.ResponseWriter, r *http.Request) {
	opts, err := s.Store.CmdbAssetFilterOptions()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	// 附上状态与三个维度的可选值
	meta, err := s.Store.ListCmdbCategories()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	cats := make([]map[string]interface{}, 0, len(meta))
	for _, c := range meta {
		cats = append(cats, map[string]interface{}{"id": c.ID, "name": c.Name})
	}
	writeJSON(w, 200, map[string]interface{}{
		"statuses":   store.CmdbAssetStatuses,
		"os_type":    opts["os_type"],
		"os_version": opts["os_version"],
		"categories": cats,
	})
}

// 导出列与前端 30 列表格严格一致（去掉「操作」列）
var cmdbExportColumns = []struct {
	Title string
	Get   func(store.CmdbAsset) string
}{
	{"资产编号", func(a store.CmdbAsset) string { return a.AssetCode }},
	{"设备名称", func(a store.CmdbAsset) string { return a.Name }},
	{"状态", func(a store.CmdbAsset) string { return a.Status }},
	{"设备分类", func(a store.CmdbAsset) string { return a.CategoryName }},
	{"操作系统类型", func(a store.CmdbAsset) string { return a.OSType }},
	{"操作系统版本", func(a store.CmdbAsset) string { return a.OSVersion }},
	{"管理IP", func(a store.CmdbAsset) string { return a.MgmtIP }},
	{"业务监控", func(a store.CmdbAsset) string { return "" }},
	{"所属组织", func(a store.CmdbAsset) string { return a.OrgName }},
	{"所属分组", func(a store.CmdbAsset) string { return a.GroupName }},
	{"所属部门", func(a store.CmdbAsset) string { return a.Department }},
	{"负责人", func(a store.CmdbAsset) string { return a.Owner }},
	{"序列号", func(a store.CmdbAsset) string { return a.SN }},
	{"MAC地址", func(a store.CmdbAsset) string { return a.MAC }},
	{"厂商", func(a store.CmdbAsset) string { return a.Vendor }},
	{"型号", func(a store.CmdbAsset) string { return a.Model }},
	{"所属区域", func(a store.CmdbAsset) string { return a.DataCenter }},
	{"楼层", func(a store.CmdbAsset) string { return a.Floor }},
	{"机柜名称", func(a store.CmdbAsset) string { return a.CabinetName }},
	{"位置标识", func(a store.CmdbAsset) string { return "" }},
	{"高度", func(a store.CmdbAsset) string { return strconv.FormatInt(a.HeightU, 10) }},
	{"起始U位", func(a store.CmdbAsset) string { return strconv.FormatInt(a.StartU, 10) }},
	{"端口数量", func(a store.CmdbAsset) string { return strconv.FormatInt(a.PortCount, 10) }},
	{"电源类型", func(a store.CmdbAsset) string { return a.PowerType }},
	{"冗余电源", func(a store.CmdbAsset) string {
		if a.RedundantPower == 1 {
			return "是"
		}
		return "否"
	}},
	{"安装日期", func(a store.CmdbAsset) string { return a.InstallDate }},
	{"保修到期", func(a store.CmdbAsset) string { return a.WarrantyDate }},
	{"额定功耗", func(a store.CmdbAsset) string { return strconv.FormatInt(a.RatedPowerW, 10) }},
	{"重量", func(a store.CmdbAsset) string { return strconv.FormatFloat(a.WeightKG, 'f', -1, 64) }},
}

// handleExportCmdbAssets 按当前筛选导出全部匹配记录（不受分页限制）。
func (s *Server) handleExportCmdbAssets(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.AllCmdbAssets(cmdbQueryFromRequest(r, 1, 0))
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "xlsx"
	}
	stamp := time.Now().Format("20060102_150405")

	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename=\"CMDB资源_"+stamp+".csv\"")
		w.Write([]byte{0xEF, 0xBB, 0xBF})
		cw := csv.NewWriter(w)
		head := make([]string, len(cmdbExportColumns))
		for i, c := range cmdbExportColumns {
			head[i] = c.Title
		}
		_ = cw.Write(head)
		for _, a := range list {
			line := make([]string, len(cmdbExportColumns))
			for i, c := range cmdbExportColumns {
				line[i] = c.Get(a)
			}
			_ = cw.Write(line)
		}
		cw.Flush()
	case "xlsx":
		f := excelize.NewFile()
		defer f.Close()
		const sheet = "CMDB资源"
		idx, _ := f.NewSheet(sheet)
		f.SetActiveSheet(idx)
		_ = f.DeleteSheet("Sheet1")
		for i, c := range cmdbExportColumns {
			cell, _ := excelize.CoordinatesToCellName(i+1, 1)
			_ = f.SetCellValue(sheet, cell, c.Title)
		}
		for ri, a := range list {
			for ci, c := range cmdbExportColumns {
				cell, _ := excelize.CoordinatesToCellName(ci+1, ri+2)
				_ = f.SetCellValue(sheet, cell, c.Get(a))
			}
		}
		buf, err := f.WriteToBuffer()
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		w.Header().Set("Content-Disposition", "attachment; filename=\"CMDB资源_"+stamp+".xlsx\"")
		w.Write(buf.Bytes())
	default:
		writeErr(w, 400, "不支持的格式: "+format)
	}
}

// handleDownloadCmdbTemplate 下载与批量导入严格匹配的模板。
func (s *Server) handleDownloadCmdbTemplate(w http.ResponseWriter, r *http.Request) {
	b, err := store.BuildCmdbImportTemplate()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="czfy_cmdb_import_template.xlsx"`)
	w.Write(b)
}

// handleImportCmdbAssets 批量导入：默认只预览，commit=1 才写入。
func (s *Server) handleImportCmdbAssets(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, 400, "Excel 文件解析失败")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, 400, "请上传 xlsx 文件")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		writeErr(w, 400, "读取 Excel 文件失败")
		return
	}

	var res *store.CmdbImportResult
	if r.URL.Query().Get("commit") == "1" {
		res, err = s.Store.CommitCmdbImport(bytes.NewReader(data))
	} else {
		res, err = s.Store.PreviewCmdbImport(bytes.NewReader(data))
	}
	if err != nil {
		writeErr(w, 400, "导入失败: "+err.Error())
		return
	}
	writeJSON(w, 200, res)
}
