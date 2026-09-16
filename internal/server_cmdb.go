package internal

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"

	"czfy-assets/internal/store"
)

// ---- CMDB 维度元数据 ----
func (s *Server) handleCmdbMeta(w http.ResponseWriter, r *http.Request) {
	orgs, err := s.Store.ListCmdbOrgs()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	groups, err := s.Store.ListCmdbGroups()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	categories, err := s.Store.ListCmdbCategories()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	models, err := s.Store.ListCmdbModels()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"orgs":       orgs,
		"groups":     groups,
		"categories": categories,
		"models":     models,
		"statuses":   store.CmdbAssetStatuses,
		"net_zones":  store.CmdbNetZones,
	})
}

// ---- CMDB 资源列表（服务端分页 + 检索 + 排序） ----
func (s *Server) handleListCmdbAssets(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	// 与存储层保持同一套生效值，保证响应中的分页回显与实际查询一致。
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 10
	}

	list, total, err := s.Store.QueryCmdbAssets(cmdbQueryFromRequest(r, page, pageSize))
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if list == nil {
		list = []store.CmdbAsset{}
	}
	writeJSON(w, 200, map[string]interface{}{
		"list":      list,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// ---- CMDB 资产详情（含网络接口） ----
func (s *Server) handleGetCmdbAsset(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的资产 ID")
		return
	}
	asset, ifaces, err := s.Store.GetCmdbAsset(id)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, 404, "未找到该资产")
		return
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if ifaces == nil {
		ifaces = []store.CmdbAssetInterface{}
	}
	writeJSON(w, 200, map[string]interface{}{
		"asset":      asset,
		"interfaces": ifaces,
	})
}

// ---- 旧台账映射同步（幂等） ----
func (s *Server) handleCmdbSyncLegacy(w http.ResponseWriter, r *http.Request) {
	res, err := s.Store.SyncLegacyToCmdb()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, res)
}
