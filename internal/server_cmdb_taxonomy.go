package internal

import (
	"encoding/json"
	"net/http"
	"strconv"

	"czfy-assets/internal/store"
)

// handleListCmdbTaxonomy 返回某维度的全部节点（orgs / groups / categories）。
func (s *Server) handleListCmdbTaxonomy(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	kind := r.PathValue("kind")
	list, err := s.Store.ListCmdbTaxonomyForProject(scope, kind)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if list == nil {
		list = []store.CmdbTaxonomyNode{}
	}
	writeJSON(w, 200, map[string]interface{}{"list": list, "total": len(list), "kind": kind})
}

func (s *Server) handleCreateCmdbTaxonomy(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	kind := r.PathValue("kind")
	var body struct {
		Name      string `json:"name"`
		ParentID  int64  `json:"parent_id"`
		SortOrder int64  `json:"sort_order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.CreateCmdbTaxonomyForProject(scope, kind, body.Name, body.ParentID, body.SortOrder)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id})
}

func (s *Server) handleUpdateCmdbTaxonomy(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	kind := r.PathValue("kind")
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的节点 ID")
		return
	}
	var body struct {
		Name      string `json:"name"`
		ParentID  int64  `json:"parent_id"`
		SortOrder int64  `json:"sort_order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	if err := s.Store.UpdateCmdbTaxonomyForProject(scope, kind, id, body.Name, body.ParentID, body.SortOrder); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleDeleteCmdbTaxonomy(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	kind := r.PathValue("kind")
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的节点 ID")
		return
	}
	if err := s.Store.DeleteCmdbTaxonomyForProject(scope, kind, id); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleListCmdbConfig(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	kind := r.PathValue("kind")
	list, err := s.Store.ListConfigItems(scope, kind)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if list == nil {
		list = []store.ConfigItem{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"list": list, "total": len(list), "kind": kind})
}

func (s *Server) handleCreateCmdbConfig(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body store.ConfigItem
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.CreateConfigItem(scope, r.PathValue("kind"), &body)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"id": id})
}

func (s *Server) handleUpdateCmdbConfig(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "无效的配置项 ID")
		return
	}
	var body store.ConfigItem
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
		return
	}
	body.ID = id
	if err := s.Store.UpdateConfigItem(scope, r.PathValue("kind"), &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}

func (s *Server) handleDeleteCmdbConfig(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "无效的配置项 ID")
		return
	}
	if err := s.Store.DeleteConfigItem(scope, r.PathValue("kind"), id); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}

func (s *Server) handleGetCmdbOrgTree(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	tree, err := s.Store.ListOrgTree(scope)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if tree == nil {
		tree = []store.OrgNode{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"list": tree, "total": len(tree)})
}

func (s *Server) handleMoveCmdbOrgNode(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body struct {
		ID        int64 `json:"id"`
		ParentID  int64 `json:"parent_id"`
		SortOrder int64 `json:"sort_order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
		return
	}
	if body.ID <= 0 {
		writeErr(w, http.StatusBadRequest, "无效的组织节点 ID")
		return
	}
	if err := s.Store.MoveOrgNode(scope, body.ID, body.ParentID, body.SortOrder); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}
