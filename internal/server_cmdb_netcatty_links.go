package internal

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"czfy-assets/internal/store"
)

func decodeStrictJSON(r *http.Request, value interface{}) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(value)
}

func (s *Server) handleListCmdbNetcattyLinks(w http.ResponseWriter, r *http.Request) {
	assetID, _ := strconv.ParseInt(r.URL.Query().Get("asset_id"), 10, 64)
	list, err := s.Store.ListCmdbNetcattyLinksForProject(requestProjectScope(r), r.URL.Query().Get("asset_type"), assetID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"list": list})
}

func (s *Server) handleCreateCmdbNetcattyLink(w http.ResponseWriter, r *http.Request) {
	var link store.CmdbNetcattyLink
	if err := decodeStrictJSON(r, &link); err != nil {
		writeErr(w, 400, "请求字段无效: "+err.Error())
		return
	}
	id, err := s.Store.SaveCmdbNetcattyLinkForProject(requestProjectScope(r), &link)
	if err != nil {
		status := 400
		if errors.Is(err, store.ErrNetcattyHostAlreadyLinked) {
			status = http.StatusConflict
		}
		writeErr(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{"id": id})
}

func (s *Server) handleUpdateCmdbNetcattyLink(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的关联 ID")
		return
	}
	if strings.HasSuffix(r.URL.Path, "/state") {
		var payload struct {
			State string `json:"state"`
		}
		if err := decodeStrictJSON(r, &payload); err != nil {
			writeErr(w, 400, "请求字段无效: "+err.Error())
			return
		}
		if err := s.Store.MarkCmdbNetcattyLinkStateForProject(requestProjectScope(r), id, payload.State); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, map[string]string{"message": "引用状态已更新"})
		return
	}
	var link store.CmdbNetcattyLink
	if err := decodeStrictJSON(r, &link); err != nil {
		writeErr(w, 400, "请求字段无效: "+err.Error())
		return
	}
	link.ID = id
	if _, err := s.Store.SaveCmdbNetcattyLinkForProject(requestProjectScope(r), &link); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"message": "主机关联已更新"})
}

func (s *Server) handleDeleteCmdbNetcattyLink(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的关联 ID")
		return
	}
	if err := s.Store.DeleteCmdbNetcattyLinkForProject(requestProjectScope(r), id); err != nil {
		writeErr(w, 404, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"message": "主机关联已解除"})
}
