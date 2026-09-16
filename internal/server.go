package internal

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"czfy-assets/internal/store"
	"github.com/xuri/excelize/v2"
)

type Server struct {
	Store *store.Store
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// ---- 元数据字典（下拉选单） ----
func (s *Server) handleMeta(w http.ResponseWriter, r *http.Request) {
	allAssets, err := s.Store.AllAssets()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	deptSet := map[string]bool{}
	roomSet := map[string]bool{}
	for _, a := range allAssets {
		if a.Department != "" {
			deptSet[a.Department] = true
		}
		if a.Room != "" {
			roomSet[a.Room] = true
		}
	}
	var depts []string
	for d := range deptSet {
		depts = append(depts, d)
	}
	var rooms []string
	for rm := range roomSet {
		rooms = append(rooms, rm)
	}

	writeJSON(w, 200, map[string]interface{}{
		"departments":     depts,
		"rooms":           rooms,
		"statuses":        []string{"在用", "闲置", "维修中", "仓库备用", "待报废", "已报废"},
		"log_types":       []string{"调换使用人", "设备维修更换", "信息修改", "建档入库", "设备回收注销"},
		"subnets":         []string{"7段", "8段", "9段", "10段", "外网"},
		"server_statuses": []string{"运行中", "已停机", "维护中", "备用"},
		"app_types":       []string{"业务应用", "中间件服务", "数据库服务", "基础支撑"},
		"app_statuses":    []string{"正常运行", "待部署", "停止", "异常"},
	})
}

// ---- 终端资产列表查询 ----
func (s *Server) handleListAssets(w http.ResponseWriter, r *http.Request) {
	kw := r.URL.Query().Get("keyword")
	dept := r.URL.Query().Get("dept")
	status := r.URL.Query().Get("status")
	secSoft := r.URL.Query().Get("security_software")
	includeArchived := r.URL.Query().Get("include_archived") == "1" || r.URL.Query().Get("include_archived") == "true"
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))

	list, total, err := s.Store.QueryAssetsWithArchived(kw, dept, status, secSoft, page, pageSize, includeArchived)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	summary, err := s.Store.AssetStatusSummary(kw, dept, secSoft, includeArchived)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"list":      list,
		"total":     total,
		"summary":   summary,
		"page":      page,
		"page_size": pageSize,
	})
}

func (s *Server) handleSangforImport(w http.ResponseWriter, r *http.Request) {
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
	var result *store.SangforImportPreview
	if r.URL.Query().Get("commit") == "1" {
		result, err = s.Store.CommitSangforImport(bytes.NewReader(data))
	} else {
		result, err = s.Store.PreviewSangforImport(bytes.NewReader(data))
	}
	if err != nil {
		writeErr(w, 400, "导入失败: "+err.Error())
		return
	}
	writeJSON(w, 200, result)
}

// ---- 获取单个资产及历史履历 ----
func (s *Server) handleGetAsset(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}

	asset, logs, err := s.Store.GetAsset(id)
	if err != nil {
		writeErr(w, 404, "资产不存在")
		return
	}

	writeJSON(w, 200, map[string]interface{}{
		"asset": asset,
		"logs":  logs,
	})
}

func (s *Server) handleAssetRelations(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}
	relations, err := s.Store.GetAssetRelations(id)
	if err != nil {
		writeErr(w, 404, "资产不存在")
		return
	}
	writeJSON(w, 200, relations)
}

// ---- 新建资产 ----
func (s *Server) handleCreateAsset(w http.ResponseWriter, r *http.Request) {
	var body struct {
		store.Asset
		Operator string `json:"operator"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败")
		return
	}

	op := body.Operator
	if op == "" {
		op = "管理员"
	}

	newID, err := s.Store.CreateAsset(&body.Asset, op)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, map[string]interface{}{"id": newID, "message": "创建成功"})
}

// ---- 更新资产基础信息 ----
func (s *Server) handleUpdateAsset(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}

	var body struct {
		store.Asset
		Operator string `json:"operator"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败")
		return
	}
	body.Asset.ID = id

	op := body.Operator
	if op == "" {
		op = "管理员"
	}

	if err := s.Store.UpdateAsset(&body.Asset, op); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"message": "更新成功"})
}

// ---- 删除资产 ----
func (s *Server) handleDeleteAsset(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}
	var body struct {
		Reason   string `json:"reason"`
		Operator string `json:"operator"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if err := s.Store.DeleteAsset(id, body.Reason, body.Operator); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"message": "资产已注销归档"})
}

// ---- 业务接口：调换使用人 ----
func (s *Server) handleTransferUser(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}

	var req store.TransferReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "请求体解析失败")
		return
	}

	if strings.TrimSpace(req.ToUser) == "" {
		writeErr(w, 400, "新使用人姓名不能为空")
		return
	}

	if err := s.Store.TransferUser(id, req); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"message": "调换使用人成功，已自动写入履历流水"})
}

// ---- 业务接口：设备维修更换（换件） ----
func (s *Server) handleMaintenance(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}

	var req store.MaintenanceReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "请求体解析失败")
		return
	}

	if err := s.Store.Maintenance(id, req); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"message": "设备维修/换件操作已登记，旧件已入库并生成维护记录"})
}

// ---- 物理服务器管理接口 ----
func (s *Server) handleListServers(w http.ResponseWriter, r *http.Request) {
	kw := r.URL.Query().Get("keyword")
	loc := r.URL.Query().Get("location")
	status := r.URL.Query().Get("status")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))

	list, total, err := s.Store.QueryServers(kw, loc, status, page, pageSize)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"list":      list,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

func (s *Server) handleGetServer(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}

	srv, apps, err := s.Store.GetServer(id)
	if err != nil {
		writeErr(w, 404, "物理服务器不存在")
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"server": srv,
		"apps":   apps,
	})
}

func (s *Server) handleCreateServer(w http.ResponseWriter, r *http.Request) {
	var body struct {
		store.PhysicalServer
		Operator string `json:"operator"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败")
		return
	}
	op := body.Operator
	if op == "" {
		op = "系统管理员"
	}

	newID, err := s.Store.CreateServer(&body.PhysicalServer, op)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, map[string]interface{}{"id": newID, "message": "物理服务器建档成功"})
}

func (s *Server) handleUpdateServer(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}

	var body struct {
		store.PhysicalServer
		Operator string `json:"operator"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败")
		return
	}
	body.PhysicalServer.ID = id

	op := body.Operator
	if op == "" {
		op = "系统管理员"
	}

	if err := s.Store.UpdateServer(&body.PhysicalServer, op); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"message": "物理服务器更新成功"})
}

func (s *Server) handleDeleteServer(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}
	if err := s.Store.DeleteServer(id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"message": "物理服务器及关联应用已删除"})
}

// ---- 系统与应用管理接口 ----
func (s *Server) handleListServerApps(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}

	apps, err := s.Store.GetAppsByServerID(id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, apps)
}

func (s *Server) handleCreateServerApp(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}

	var app store.ServerApp
	if err := json.NewDecoder(r.Body).Decode(&app); err != nil {
		writeErr(w, 400, "请求体解析失败")
		return
	}
	app.ServerID = id

	newID, err := s.Store.CreateApp(&app)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, map[string]interface{}{"id": newID, "message": "系统应用添加成功"})
}

func (s *Server) handleUpdateApp(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}

	var app store.ServerApp
	if err := json.NewDecoder(r.Body).Decode(&app); err != nil {
		writeErr(w, 400, "请求体解析失败")
		return
	}
	app.ID = id

	if err := s.Store.UpdateApp(&app); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"message": "应用信息更新成功"})
}

func (s *Server) handleDeleteApp(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}

	if err := s.Store.DeleteApp(id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"message": "系统应用已删除"})
}

func (s *Server) handleListAllApps(w http.ResponseWriter, r *http.Request) {
	kw := r.URL.Query().Get("keyword")
	appType := r.URL.Query().Get("app_type")
	status := r.URL.Query().Get("status")

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	apps, total, err := s.Store.QueryAllApps(kw, appType, status, page, pageSize)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 20
	}
	writeJSON(w, 200, map[string]interface{}{"list": apps, "total": total, "page": page, "page_size": pageSize})
}

// ---- 全局履历流水总账查询 ----
func (s *Server) handleListLogs(w http.ResponseWriter, r *http.Request) {
	assetID, _ := strconv.ParseInt(r.URL.Query().Get("asset_id"), 10, 64)
	logType := r.URL.Query().Get("log_type")
	kw := r.URL.Query().Get("keyword")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))

	list, total, err := s.Store.QueryLogs(assetID, logType, kw, page, pageSize)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"list":      list,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// ---- IP 规划池 ----
func (s *Server) handleListIPPool(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 100
	}
	list, total, err := s.Store.QueryIPEntries(store.IPEntryQuery{
		Subnet:   q.Get("subnet"),
		Status:   q.Get("status"),
		Keyword:  q.Get("keyword"),
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"list": list, "total": total, "page": page, "page_size": pageSize})
}

func (s *Server) handleGlobalSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeJSON(w, 200, map[string]interface{}{"query": "", "results": []store.SearchResult{}, "total": 0})
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	results, err := s.Store.GlobalSearch(q, limit)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"query": q, "results": results, "total": len(results)})
}

// ---- 综合数据统计大屏 ----
func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	st, err := s.Store.GetStats()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, st)
}

// ---- 导出终端资产 Excel ----
func (s *Server) handleExportAssets(w http.ResponseWriter, r *http.Request) {
	assets, err := s.Store.AllAssetsFiltered(
		r.URL.Query().Get("keyword"),
		r.URL.Query().Get("dept"),
		r.URL.Query().Get("status"),
		r.URL.Query().Get("security_software"),
	)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	f := excelize.NewFile()
	defer f.Close()
	sheet := "资产台账"
	f.SetSheetName("Sheet1", sheet)

	headers := []string{"序号", "资产编码", "盒子SN", "显示器SN", "使用人", "部门", "房间", "业务IP", "终端IP", "安元情况", "状态", "网络类型", "备注"}
	for colIdx, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(colIdx+1, 1)
		f.SetCellValue(sheet, cell, h)
	}

	for rowIdx, a := range assets {
		r := rowIdx + 2
		vals := []interface{}{
			a.ID, a.AssetCode, a.BoxSN, a.DisplaySN, a.UserName, a.Department, a.Room, a.IP, a.TerminalIP, a.SecuritySoftware, a.Status, a.NetType, a.Remark,
		}
		for colIdx, v := range vals {
			cell, _ := excelize.CoordinatesToCellName(colIdx+1, r)
			f.SetCellValue(sheet, cell, v)
		}
	}

	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="czfy_assets.xlsx"`)
	_ = f.Write(w)
}

// RegisterRoutes 注册路由
// ---- 资产导入模板下载 ----
func (s *Server) handleDownloadTemplate(w http.ResponseWriter, r *http.Request) {
	f := excelize.NewFile()
	defer f.Close()
	sheet := "资产导入模板"
	f.SetSheetName("Sheet1", sheet)

	headers := []string{"资产编码", "盒子SN", "显示器SN", "当前使用人", "所属组织", "房间/法庭", "业务IP", "终端IP", "安元软件", "状态", "网络类型", "备注"}
	for colIdx, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(colIdx+1, 1)
		f.SetCellValue(sheet, cell, h)
	}

	example := []interface{}{"ZC-2026-001", "BOX-SN-001", "DISP-SN-001", "张三", "立案庭", "101室", "172.16.7.10", "172.16.7.11", "已安装", "在用", "专网", "示例数据"}
	for colIdx, v := range example {
		cell, _ := excelize.CoordinatesToCellName(colIdx+1, 2)
		f.SetCellValue(sheet, cell, v)
	}

	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="czfy_asset_template.xlsx"`)
	_ = f.Write(w)
}

func (s *Server) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/meta", s.handleMeta)
	mux.HandleFunc("GET /api/assets", s.handleListAssets)
	mux.HandleFunc("GET /api/assets/{id}", s.handleGetAsset)
	mux.HandleFunc("GET /api/assets/{id}/relations", s.handleAssetRelations)
	mux.HandleFunc("POST /api/assets", s.handleCreateAsset)
	mux.HandleFunc("PUT /api/assets/{id}", s.handleUpdateAsset)
	mux.HandleFunc("DELETE /api/assets/{id}", s.handleDeleteAsset)
	mux.HandleFunc("POST /api/assets/{id}/transfer", s.handleTransferUser)
	mux.HandleFunc("POST /api/assets/{id}/maintenance", s.handleMaintenance)

	// 物理服务器
	mux.HandleFunc("GET /api/servers", s.handleListServers)
	mux.HandleFunc("GET /api/servers/{id}", s.handleGetServer)
	mux.HandleFunc("POST /api/servers", s.handleCreateServer)
	mux.HandleFunc("PUT /api/servers/{id}", s.handleUpdateServer)
	mux.HandleFunc("DELETE /api/servers/{id}", s.handleDeleteServer)

	// 系统应用
	mux.HandleFunc("GET /api/servers/{id}/apps", s.handleListServerApps)
	mux.HandleFunc("POST /api/servers/{id}/apps", s.handleCreateServerApp)
	mux.HandleFunc("PUT /api/apps/{id}", s.handleUpdateApp)
	mux.HandleFunc("DELETE /api/apps/{id}", s.handleDeleteApp)
	mux.HandleFunc("GET /api/apps", s.handleListAllApps)

	mux.HandleFunc("GET /api/logs", s.handleListLogs)
	mux.HandleFunc("GET /api/ip_pool", s.handleListIPPool)
	mux.HandleFunc("GET /api/ip_pool/summary", s.handleIPPoolSummary)
	mux.HandleFunc("GET /api/ip_pool/export", s.handleExportIPPool)
	mux.HandleFunc("POST /api/ip_pool", s.handleCreateIPEntry)
	mux.HandleFunc("POST /api/ip_pool/normalize", s.handleNormalizeIPPool)
	mux.HandleFunc("PUT /api/ip_pool/{id}", s.handleUpdateIPEntry)
	mux.HandleFunc("DELETE /api/ip_pool/{id}", s.handleDeleteIPEntry)
	mux.HandleFunc("POST /api/ip_pool/{id}/allocate", s.handleAllocateIP)
	mux.HandleFunc("POST /api/ip_pool/{id}/release", s.handleReleaseIP)

	// IP 网段管理（子网定义）
	mux.HandleFunc("GET /api/ip_subnets", s.handleListIPSubnets)
	mux.HandleFunc("POST /api/ip_subnets", s.handleCreateIPSubnet)
	mux.HandleFunc("PUT /api/ip_subnets/{id}", s.handleUpdateIPSubnet)
	mux.HandleFunc("DELETE /api/ip_subnets/{id}", s.handleDeleteIPSubnet)
	mux.HandleFunc("GET /api/stats", s.handleStats)
	mux.HandleFunc("GET /api/export/assets", s.handleExportAssets)
	mux.HandleFunc("GET /api/search", s.handleGlobalSearch)
	mux.HandleFunc("POST /api/import/sangfor", s.handleSangforImport)
	mux.HandleFunc("GET /api/template/assets", s.handleDownloadTemplate)

	// CMDB 资源管理
	mux.HandleFunc("GET /api/cmdb/meta", s.handleCmdbMeta)
	mux.HandleFunc("GET /api/cmdb/assets", s.handleListCmdbAssets)
	mux.HandleFunc("GET /api/cmdb/assets/{id}", s.handleGetCmdbAsset)

	// CMDB 资产写操作（批量编辑 / 克隆 / 归档）
	mux.HandleFunc("POST /api/cmdb/assets", s.handleCreateCmdbAsset)
	mux.HandleFunc("POST /api/cmdb/assets/batch", s.handleBatchCmdbAssets)
	mux.HandleFunc("GET /api/cmdb/assets/export", s.handleExportCmdbAssets)
	mux.HandleFunc("GET /api/cmdb/assets/template", s.handleDownloadCmdbTemplate)
	mux.HandleFunc("POST /api/cmdb/assets/import", s.handleImportCmdbAssets)
	mux.HandleFunc("GET /api/cmdb/assets/filters", s.handleCmdbAssetFilters)
	mux.HandleFunc("PUT /api/cmdb/assets/{id}", s.handleUpdateCmdbAsset)
	mux.HandleFunc("DELETE /api/cmdb/assets/{id}", s.handleDeleteCmdbAsset)
	mux.HandleFunc("POST /api/cmdb/sync/legacy", s.handleCmdbSyncLegacy)

	// CMDB 仪表盘
	mux.HandleFunc("GET /api/cmdb/dashboard", s.handleCmdbDashboard)

	// CMDB 工单管理
	mux.HandleFunc("GET /api/cmdb/work-orders", s.handleListCmdbWorkOrders)
	mux.HandleFunc("POST /api/cmdb/work-orders", s.handleCreateCmdbWorkOrder)
	mux.HandleFunc("PUT /api/cmdb/work-orders/{id}", s.handleUpdateCmdbWorkOrder)
	mux.HandleFunc("DELETE /api/cmdb/work-orders/{id}", s.handleDeleteCmdbWorkOrder)

	// CMDB 资产盘点
	mux.HandleFunc("GET /api/cmdb/inventory", s.handleListCmdbInventory)
	mux.HandleFunc("POST /api/cmdb/inventory", s.handleCreateCmdbInventory)
	mux.HandleFunc("PUT /api/cmdb/inventory/{id}", s.handleUpdateCmdbInventory)
	mux.HandleFunc("DELETE /api/cmdb/inventory/{id}", s.handleDeleteCmdbInventory)

	// CMDB 凭证中心
	mux.HandleFunc("GET /api/cmdb/credentials", s.handleListCmdbCredentials)
	mux.HandleFunc("POST /api/cmdb/credentials", s.handleCreateCmdbCredential)
	mux.HandleFunc("PUT /api/cmdb/credentials/{id}", s.handleUpdateCmdbCredential)
	mux.HandleFunc("DELETE /api/cmdb/credentials/{id}", s.handleDeleteCmdbCredential)

	// CMDB 编码与标签
	mux.HandleFunc("GET /api/cmdb/labels", s.handleListCmdbLabels)
	mux.HandleFunc("POST /api/cmdb/labels/generate", s.handleGenerateCmdbLabels)
	mux.HandleFunc("POST /api/cmdb/labels/repair", s.handleRepairCmdbLabels)
	mux.HandleFunc("POST /api/cmdb/labels/print", s.handlePrintCmdbLabels)
	mux.HandleFunc("GET /api/cmdb/labels/printed", s.handlePrintedCmdbLabels)
	mux.HandleFunc("GET /api/cmdb/labels/rule", s.handleGetCmdbLabelRule)
	mux.HandleFunc("PUT /api/cmdb/labels/rule", s.handleSaveCmdbLabelRule)
	mux.HandleFunc("PUT /api/cmdb/labels/{id}/status", s.handleSetCmdbLabelStatus)
	mux.HandleFunc("DELETE /api/cmdb/labels/{id}", s.handleDeleteCmdbLabel)

	// CMDB 配置中心（设备模型库）
	mux.HandleFunc("GET /api/cmdb/models", s.handleListCmdbModels)
	mux.HandleFunc("POST /api/cmdb/models", s.handleCreateCmdbModel)
	mux.HandleFunc("PUT /api/cmdb/models/{id}", s.handleUpdateCmdbModel)
	mux.HandleFunc("DELETE /api/cmdb/models/{id}", s.handleDeleteCmdbModel)

	// CMDB 分类管理（组织 / 分组 / 设备分类 三个维度）
	mux.HandleFunc("GET /api/cmdb/taxonomy/{kind}", s.handleListCmdbTaxonomy)
	mux.HandleFunc("POST /api/cmdb/taxonomy/{kind}", s.handleCreateCmdbTaxonomy)
	mux.HandleFunc("PUT /api/cmdb/taxonomy/{kind}/{id}", s.handleUpdateCmdbTaxonomy)
	mux.HandleFunc("DELETE /api/cmdb/taxonomy/{kind}/{id}", s.handleDeleteCmdbTaxonomy)

	// CMDB 人员档案与资产穿透
	mux.HandleFunc("GET /api/cmdb/persons", s.handleListPersons)
	mux.HandleFunc("POST /api/cmdb/persons", s.handleCreatePerson)
	mux.HandleFunc("PUT /api/cmdb/persons/{id}", s.handleUpdatePerson)
	mux.HandleFunc("DELETE /api/cmdb/persons/{id}", s.handleDeletePerson)
	mux.HandleFunc("GET /api/cmdb/persons/{id}/assets", s.handleGetPersonAssets)
	mux.HandleFunc("POST /api/cmdb/persons/transfer", s.handleTransferPersonAssets)

	// CMDB 自定义扩展字段
	mux.HandleFunc("GET /api/cmdb/custom-fields", s.handleListCustomFields)
	mux.HandleFunc("POST /api/cmdb/custom-fields", s.handleSaveCustomField)
	mux.HandleFunc("DELETE /api/cmdb/custom-fields/{id}", s.handleDeleteCustomField)
}
