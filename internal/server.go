package internal

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
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

func writeAssetLookupError(w http.ResponseWriter, err error) {
	if errors.Is(err, sql.ErrNoRows) || errors.Is(err, store.ErrProjectScopedNotFound) {
		writeErr(w, http.StatusNotFound, "资产不存在")
		return
	}
	writeErr(w, http.StatusInternalServerError, err.Error())
}

// ---- 元数据字典（下拉选单） ----
func (s *Server) handleMeta(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	allAssets, err := s.Store.AllAssetsForProject(scope)
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
	scope := requestProjectScope(r)
	kw := r.URL.Query().Get("keyword")
	dept := r.URL.Query().Get("dept")
	status := r.URL.Query().Get("status")
	secSoft := r.URL.Query().Get("security_software")
	includeArchived := r.URL.Query().Get("include_archived") == "1" || r.URL.Query().Get("include_archived") == "true"
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))

	list, total, err := s.Store.QueryAssetsWithArchivedForProject(scope, kw, dept, status, secSoft, page, pageSize, includeArchived)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	summary, err := s.Store.AssetStatusSummaryForProject(scope, kw, dept, secSoft, includeArchived)
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
	scope := requestProjectScope(r)
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
		result, err = s.Store.CommitSangforImportForProject(scope, bytes.NewReader(data))
	} else {
		result, err = s.Store.PreviewSangforImportForProject(scope, bytes.NewReader(data))
	}
	if err != nil {
		writeErr(w, 400, "导入失败: "+err.Error())
		return
	}
	writeJSON(w, 200, result)
}

// ---- 获取单个资产及历史履历 ----
func (s *Server) handleGetAsset(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}

	asset, logs, err := s.Store.GetAssetForProject(scope, id)
	if err != nil {
		writeAssetLookupError(w, err)
		return
	}

	writeJSON(w, 200, map[string]interface{}{
		"asset": asset,
		"logs":  logs,
	})
}

func (s *Server) handleAssetRelations(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}
	relations, err := s.Store.GetAssetRelationsForProject(scope, id)
	if err != nil {
		writeAssetLookupError(w, err)
		return
	}
	writeJSON(w, 200, relations)
}

// ---- 新建资产 ----
func (s *Server) handleCreateAsset(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
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

	newID, err := s.Store.CreateAssetForProject(scope, &body.Asset, op)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, map[string]interface{}{"id": newID, "message": "创建成功"})
}

// ---- 更新资产基础信息 ----
func (s *Server) handleUpdateAsset(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
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

	if err := s.Store.UpdateAssetForProject(scope, &body.Asset, op); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"message": "更新成功"})
}

// ---- 删除资产 ----
func (s *Server) handleDeleteAsset(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
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
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体解析失败")
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeErr(w, http.StatusBadRequest, "请求体解析失败")
		return
	}
	if err := s.Store.DeleteAssetForProject(scope, id, body.Reason, body.Operator); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"message": "资产已注销归档"})
}

// ---- 业务接口：调换使用人 ----
func (s *Server) handleTransferUser(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
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

	if err := s.Store.TransferUserForProject(scope, id, req); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"message": "调换使用人成功，已自动写入履历流水"})
}

// ---- 业务接口：设备维修更换（换件） ----
func (s *Server) handleMaintenance(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
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

	if err := s.Store.MaintenanceForProject(scope, id, req); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"message": "设备维修/换件操作已登记，旧件已入库并生成维护记录"})
}

// ---- 物理服务器管理接口 ----
func (s *Server) handleListServers(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	kw := r.URL.Query().Get("keyword")
	loc := r.URL.Query().Get("location")
	status := r.URL.Query().Get("status")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	page, pageSize = normalizeLegacyPagination(page, pageSize)

	list, total, err := s.Store.QueryServersForProject(scope, kw, loc, status, page, pageSize)
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
	scope := requestProjectScope(r)
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}

	srv, apps, err := s.Store.GetServerForProject(scope, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "物理服务器不存在")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"server": srv,
		"apps":   apps,
	})
}

func (s *Server) handleCreateServer(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
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

	newID, err := s.Store.CreateServerForProject(scope, &body.PhysicalServer, op)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, map[string]interface{}{"id": newID, "message": "物理服务器建档成功"})
}

func (s *Server) handleUpdateServer(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
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

	if err := s.Store.UpdateServerForProject(scope, &body.PhysicalServer, op); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"message": "物理服务器更新成功"})
}

func (s *Server) handleDeleteServer(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}
	if err := s.Store.DeleteServerForProject(scope, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"message": "物理服务器及关联应用已删除"})
}

// ---- 系统与应用管理接口 ----
func (s *Server) handleListServerApps(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}

	apps, err := s.Store.GetAppsByServerIDForProject(scope, id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, apps)
}

func (s *Server) handleCreateServerApp(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
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

	newID, err := s.Store.CreateAppForProject(scope, &app)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, map[string]interface{}{"id": newID, "message": "系统应用添加成功"})
}

func (s *Server) handleUpdateApp(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
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

	if err := s.Store.UpdateAppForProject(scope, &app); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"message": "应用信息更新成功"})
}

func (s *Server) handleDeleteApp(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "非法ID")
		return
	}

	if err := s.Store.DeleteAppForProject(scope, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"message": "系统应用已删除"})
}

func (s *Server) handleListAllApps(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	kw := r.URL.Query().Get("keyword")
	appType := r.URL.Query().Get("app_type")
	status := r.URL.Query().Get("status")

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	apps, total, err := s.Store.QueryAllAppsForProject(scope, kw, appType, status, page, pageSize)
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
	scope := requestProjectScope(r)
	assetID, _ := strconv.ParseInt(r.URL.Query().Get("asset_id"), 10, 64)
	logType := r.URL.Query().Get("log_type")
	kw := r.URL.Query().Get("keyword")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	page, pageSize = normalizeLegacyPagination(page, pageSize)

	list, total, err := s.Store.QueryLogsForProject(scope, assetID, logType, kw, page, pageSize)
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

func normalizeLegacyPagination(page, pageSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 20
	}
	return page, pageSize
}

// ---- IP 规划池 ----
func (s *Server) handleListIPPool(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 100
	}
	list, total, err := s.Store.QueryIPEntriesForProject(scope, store.IPEntryQuery{
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
	scope := requestProjectScope(r)
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeJSON(w, 200, map[string]interface{}{"query": "", "results": []store.SearchResult{}, "total": 0})
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	results, err := s.Store.GlobalSearchForProject(scope, q, limit)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"query": q, "results": results, "total": len(results)})
}

// ---- 综合数据统计大屏 ----
func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	st, err := s.Store.GetStatsForProject(scope)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, st)
}

// ---- 导出终端资产 Excel ----
func (s *Server) handleExportAssets(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	includeArchived := r.URL.Query().Get("include_archived") == "1" || r.URL.Query().Get("include_archived") == "true"
	assets, err := s.Store.AllAssetsFilteredForProject(scope,
		r.URL.Query().Get("keyword"),
		r.URL.Query().Get("dept"),
		r.URL.Query().Get("status"),
		r.URL.Query().Get("security_software"),
		includeArchived,
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
	scoped := func(pattern string, handler http.HandlerFunc) {
		mux.HandleFunc(pattern, s.withProjectScope(handler))
	}
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/cmdb/projects", s.handleListCmdbProjects)
	mux.HandleFunc("POST /api/cmdb/projects", s.handleCreateCmdbProject)
	mux.HandleFunc("PUT /api/cmdb/projects/{id}", s.handleUpdateCmdbProject)
	scoped("GET /api/meta", s.handleMeta)
	scoped("GET /api/assets", s.handleListAssets)
	scoped("GET /api/assets/{id}", s.handleGetAsset)
	scoped("GET /api/assets/{id}/relations", s.handleAssetRelations)
	scoped("POST /api/assets", s.handleCreateAsset)
	scoped("PUT /api/assets/{id}", s.handleUpdateAsset)
	scoped("DELETE /api/assets/{id}", s.handleDeleteAsset)
	scoped("POST /api/assets/{id}/transfer", s.handleTransferUser)
	scoped("POST /api/assets/{id}/maintenance", s.handleMaintenance)

	// 物理服务器
	scoped("GET /api/servers", s.handleListServers)
	scoped("GET /api/servers/{id}", s.handleGetServer)
	scoped("POST /api/servers", s.handleCreateServer)
	scoped("PUT /api/servers/{id}", s.handleUpdateServer)
	scoped("DELETE /api/servers/{id}", s.handleDeleteServer)

	// 系统应用
	scoped("GET /api/servers/{id}/apps", s.handleListServerApps)
	scoped("POST /api/servers/{id}/apps", s.handleCreateServerApp)
	scoped("PUT /api/apps/{id}", s.handleUpdateApp)
	scoped("DELETE /api/apps/{id}", s.handleDeleteApp)
	scoped("GET /api/apps", s.handleListAllApps)

	scoped("GET /api/logs", s.handleListLogs)
	scoped("GET /api/ip_pool", s.handleListIPPool)
	scoped("GET /api/ip_pool/summary", s.handleIPPoolSummary)
	scoped("GET /api/ip_pool/export", s.handleExportIPPool)
	scoped("POST /api/ip_pool", s.handleCreateIPEntry)
	scoped("POST /api/ip_pool/normalize", s.handleNormalizeIPPool)
	scoped("PUT /api/ip_pool/{id}", s.handleUpdateIPEntry)
	scoped("DELETE /api/ip_pool/{id}", s.handleDeleteIPEntry)
	scoped("POST /api/ip_pool/{id}/allocate", s.handleAllocateIP)
	scoped("POST /api/ip_pool/{id}/release", s.handleReleaseIP)

	// IP 网段管理（子网定义）
	scoped("GET /api/ip_subnets", s.handleListIPSubnets)
	scoped("POST /api/ip_subnets", s.handleCreateIPSubnet)
	scoped("PUT /api/ip_subnets/{id}", s.handleUpdateIPSubnet)
	scoped("DELETE /api/ip_subnets/{id}", s.handleDeleteIPSubnet)
	scoped("GET /api/stats", s.handleStats)
	scoped("GET /api/export/assets", s.handleExportAssets)
	scoped("GET /api/search", s.handleGlobalSearch)
	scoped("POST /api/import/sangfor", s.handleSangforImport)
	mux.HandleFunc("GET /api/template/assets", s.handleDownloadTemplate)

	// CMDB 资源管理
	scoped("GET /api/cmdb/meta", s.handleCmdbMeta)
	scoped("GET /api/cmdb/assets", s.handleListCmdbAssets)
	scoped("GET /api/cmdb/assets/{id}", s.handleGetCmdbAsset)

	// CMDB 资产写操作（批量编辑 / 克隆 / 归档）
	scoped("POST /api/cmdb/assets", s.handleCreateCmdbAsset)
	scoped("POST /api/cmdb/assets/batch", s.handleBatchCmdbAssets)
	scoped("GET /api/cmdb/assets/export", s.handleExportCmdbAssets)
	mux.HandleFunc("GET /api/cmdb/assets/template", s.handleDownloadCmdbTemplate)
	scoped("POST /api/cmdb/assets/import", s.handleImportCmdbAssets)
	scoped("GET /api/cmdb/assets/filters", s.handleCmdbAssetFilters)
	scoped("PUT /api/cmdb/assets/{id}", s.handleUpdateCmdbAsset)
	scoped("DELETE /api/cmdb/assets/{id}", s.handleDeleteCmdbAsset)
	scoped("POST /api/cmdb/sync/legacy", s.handleCmdbSyncLegacy)

	// CMDB 仪表盘
	scoped("GET /api/cmdb/dashboard", s.handleCmdbDashboard)

	// CMDB 工单管理
	scoped("GET /api/cmdb/work-orders", s.handleListCmdbWorkOrders)
	scoped("POST /api/cmdb/work-orders", s.handleCreateCmdbWorkOrder)
	scoped("PUT /api/cmdb/work-orders/{id}", s.handleUpdateCmdbWorkOrder)
	scoped("DELETE /api/cmdb/work-orders/{id}", s.handleDeleteCmdbWorkOrder)

	// CMDB 资产盘点
	scoped("GET /api/cmdb/inventory", s.handleListCmdbInventory)
	scoped("POST /api/cmdb/inventory", s.handleCreateCmdbInventory)
	scoped("PUT /api/cmdb/inventory/{id}", s.handleUpdateCmdbInventory)
	scoped("DELETE /api/cmdb/inventory/{id}", s.handleDeleteCmdbInventory)

	// CMDB 凭证中心
	scoped("GET /api/cmdb/credentials", s.handleListCmdbCredentials)
	scoped("POST /api/cmdb/credentials", s.handleCreateCmdbCredential)
	scoped("PUT /api/cmdb/credentials/{id}", s.handleUpdateCmdbCredential)
	scoped("DELETE /api/cmdb/credentials/{id}", s.handleDeleteCmdbCredential)

	// CMDB 编码与标签
	scoped("GET /api/cmdb/labels", s.handleListCmdbLabels)
	scoped("POST /api/cmdb/labels/generate", s.handleGenerateCmdbLabels)
	scoped("POST /api/cmdb/labels/repair", s.handleRepairCmdbLabels)
	scoped("POST /api/cmdb/labels/print", s.handlePrintCmdbLabels)
	scoped("GET /api/cmdb/labels/printed", s.handlePrintedCmdbLabels)
	scoped("GET /api/cmdb/labels/rule", s.handleGetCmdbLabelRule)
	scoped("PUT /api/cmdb/labels/rule", s.handleSaveCmdbLabelRule)
	scoped("PUT /api/cmdb/labels/{id}/status", s.handleSetCmdbLabelStatus)
	scoped("DELETE /api/cmdb/labels/{id}", s.handleDeleteCmdbLabel)

	// CMDB 配置中心（设备模型库）
	scoped("GET /api/cmdb/models", s.handleListCmdbModels)
	scoped("POST /api/cmdb/models", s.handleCreateCmdbModel)
	scoped("PUT /api/cmdb/models/{id}", s.handleUpdateCmdbModel)
	scoped("DELETE /api/cmdb/models/{id}", s.handleDeleteCmdbModel)

	// CMDB 分类管理（组织 / 分组 / 设备分类 三个维度）
	scoped("GET /api/cmdb/taxonomy/{kind}", s.handleListCmdbTaxonomy)
	scoped("POST /api/cmdb/taxonomy/{kind}", s.handleCreateCmdbTaxonomy)
	scoped("PUT /api/cmdb/taxonomy/{kind}/{id}", s.handleUpdateCmdbTaxonomy)
	scoped("DELETE /api/cmdb/taxonomy/{kind}/{id}", s.handleDeleteCmdbTaxonomy)

	// CMDB 人员档案与资产穿透
	scoped("GET /api/cmdb/persons", s.handleListPersons)
	scoped("POST /api/cmdb/persons", s.handleCreatePerson)
	scoped("PUT /api/cmdb/persons/{id}", s.handleUpdatePerson)
	scoped("DELETE /api/cmdb/persons/{id}", s.handleDeletePerson)
	scoped("GET /api/cmdb/persons/{id}/assets", s.handleGetPersonAssets)
	scoped("POST /api/cmdb/persons/transfer", s.handleTransferPersonAssets)

	// CMDB 自定义扩展字段
	scoped("GET /api/cmdb/custom-fields", s.handleListCustomFields)
	scoped("POST /api/cmdb/custom-fields", s.handleSaveCustomField)
	scoped("DELETE /api/cmdb/custom-fields/{id}", s.handleDeleteCustomField)
}
