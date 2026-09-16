package internal

import (
	"encoding/json"
	"net/http"
	"strconv"

	"czfy-assets/internal/store"
)

// handleListCmdbTaxonomy 返回某维度的全部节点（orgs / groups / categories）。
func (s *Server) handleListCmdbTaxonomy(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	list, err := s.Store.ListCmdbTaxonomy(kind)
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
	id, err := s.Store.CreateCmdbTaxonomy(kind, body.Name, body.ParentID, body.SortOrder)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id})
}

func (s *Server) handleUpdateCmdbTaxonomy(w http.ResponseWriter, r *http.Request) {
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
	if err := s.Store.UpdateCmdbTaxonomy(kind, id, body.Name, body.ParentID, body.SortOrder); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

func (s *Server) handleDeleteCmdbTaxonomy(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的节点 ID")
		return
	}
	if err := s.Store.DeleteCmdbTaxonomy(kind, id); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}
