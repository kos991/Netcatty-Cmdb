package internal

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"czfy-assets/internal/store"
)

// ---- CMDB 维度元数据 ----
func (s *Server) handleCmdbMeta(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	orgs, err := s.Store.ListCmdbOrgsForProject(scope)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	groups, err := s.Store.ListCmdbGroupsForProject(scope)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	categories, err := s.Store.ListCmdbCategoriesForProject(scope)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	models, err := s.Store.ListCmdbModelsForProject(scope)
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
	scope := requestProjectScope(r)
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

	list, total, err := s.Store.QueryCmdbAssetsForProject(scope, cmdbQueryFromRequest(r, page, pageSize))
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if list == nil {
		list = []store.CmdbAsset{}
	}
	if err := s.Store.AttachCmdbAssetInterfacesForProject(scope, list); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if err := s.Store.AttachCmdbAssetBusinessNetworkTypesForProject(scope, list); err != nil {
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

// ---- CMDB 资产详情（含网络接口） ----
func (s *Server) handleGetCmdbAsset(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的资产 ID")
		return
	}
	asset, ifaces, err := s.Store.GetCmdbAssetForProject(scope, id)
	if errors.Is(err, sql.ErrNoRows) || errors.Is(err, store.ErrProjectScopedNotFound) {
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
	assetList := []store.CmdbAsset{*asset}
	if err := s.Store.AttachCmdbAssetBusinessNetworkTypesForProject(scope, assetList); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	asset = &assetList[0]
	relations, err := s.Store.CmdbAssetRelationsForProject(scope, asset, ifaces)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	netcattyLinks, err := s.Store.ListCmdbNetcattyLinksForProject(scope, "infrastructure", id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	var switchSnapshot interface{}
	if item, snapshotErr := s.Store.GetCmdbSwitchSnapshotForProject(scope, id); snapshotErr == nil {
		switchSnapshot = item
	} else if !errors.Is(snapshotErr, sql.ErrNoRows) {
		writeErr(w, 500, snapshotErr.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"asset":                asset,
		"interfaces":           ifaces,
		"ipam":                 relations.IPAM,
		"links":                relations.Links,
		"upstream_assets":      relations.UpstreamAssets,
		"downstream_assets":    relations.DownstreamAssets,
		"related_applications": relations.RelatedApplications,
		"history":              relations.History,
		"netcatty_links":       netcattyLinks,
		"switch_snapshot":      switchSnapshot,
	})
}

func (s *Server) handleListCmdbAssetLinks(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	assetID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的资产 ID")
		return
	}
	links, err := s.Store.ListCmdbAssetLinksForProject(scope, assetID)
	if errors.Is(err, sql.ErrNoRows) || errors.Is(err, store.ErrProjectScopedNotFound) {
		writeErr(w, 404, "未找到该资产")
		return
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"list": links})
}

func (s *Server) handleCreateCmdbAssetLink(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	assetID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的资产 ID")
		return
	}
	var link store.CmdbAssetLink
	if err := json.NewDecoder(r.Body).Decode(&link); err != nil {
		writeErr(w, 400, "请求体解析失败")
		return
	}
	link.LocalAssetID = assetID
	id, err := s.Store.CreateCmdbAssetLinkForProject(scope, &link)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{"id": id, "message": "资产链路已添加"})
}

func (s *Server) handleUpdateCmdbAssetLink(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的链路 ID")
		return
	}
	var link store.CmdbAssetLink
	if err := json.NewDecoder(r.Body).Decode(&link); err != nil {
		writeErr(w, 400, "请求体解析失败")
		return
	}
	link.ID = id
	if err := s.Store.UpdateCmdbAssetLinkForProject(scope, &link); err != nil {
		if errors.Is(err, store.ErrProjectScopedNotFound) {
			writeErr(w, 404, "链路不存在")
			return
		}
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"message": "资产链路已更新"})
}

func (s *Server) handleDeleteCmdbAssetLink(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的链路 ID")
		return
	}
	if err := s.Store.DeleteCmdbAssetLinkForProject(scope, id); err != nil {
		if errors.Is(err, store.ErrProjectScopedNotFound) {
			writeErr(w, 404, "链路不存在")
			return
		}
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"message": "资产链路已删除"})
}

// ---- 旧台账映射同步（幂等） ----
func (s *Server) handleCmdbSyncLegacy(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	res, err := s.Store.SyncLegacyToCmdbForProject(scope)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, res)
}
