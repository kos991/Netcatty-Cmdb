package internal

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"czfy-assets/internal/store"
)

func assetImageID(r *http.Request) (int64, error) {
	return strconv.ParseInt(r.PathValue("id"), 10, 64)
}

func (s *Server) handleGetAssetImages(w http.ResponseWriter, r *http.Request) {
	id, err := assetImageID(r)
	if err != nil || id < 1 {
		writeErr(w, http.StatusBadRequest, "无效的设备 ID")
		return
	}
	images, err := s.Store.GetAssetImagesForProject(requestProjectScope(r), r.PathValue("kind"), id)
	if errors.Is(err, sql.ErrNoRows) || errors.Is(err, store.ErrProjectScopedNotFound) {
		writeErr(w, http.StatusNotFound, "设备不存在")
		return
	}
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, images)
}

func (s *Server) handlePutAssetImage(w http.ResponseWriter, r *http.Request) {
	id, err := assetImageID(r)
	if err != nil || id < 1 {
		writeErr(w, http.StatusBadRequest, "无效的设备 ID")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 750*1024)
	var body struct {
		Side string `json:"side"`
		Data string `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "照片请求解析失败: "+err.Error())
		return
	}
	err = s.Store.SetAssetImageForProject(requestProjectScope(r), r.PathValue("kind"), id, body.Side, body.Data)
	if errors.Is(err, sql.ErrNoRows) || errors.Is(err, store.ErrProjectScopedNotFound) {
		writeErr(w, http.StatusNotFound, "设备不存在")
		return
	}
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
