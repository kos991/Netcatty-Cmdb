package internal

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"czfy-assets/internal/store"
)

func decodeOptionalStrictJSON(r *http.Request, target any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		if errors.Is(err, io.EOF) {
			return nil
		}
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("请求只能包含一个 JSON 对象")
		}
		return err
	}
	return nil
}

func (s *Server) handleExportCmdbSnapshot(w http.ResponseWriter, r *http.Request) {
	var options store.SnapshotExportOptions
	if err := decodeOptionalStrictJSON(r, &options); err != nil {
		writeErr(w, http.StatusBadRequest, "同步导出参数无效: "+err.Error())
		return
	}
	snapshot, err := s.Store.ExportCmdbSnapshot(requestProjectScope(r), options)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

// adoptSnapshotProject 让空的本机 Cmdb 接入云端快照所属项目；本机已有数据时返回 409，不合并两个项目。
func (s *Server) adoptSnapshotProject(w http.ResponseWriter, r *http.Request, snapshot *store.CmdbSnapshot) bool {
	if _, err := s.Store.AdoptCmdbSnapshotProject(requestProjectScope(r), snapshot); err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, store.ErrCmdbSnapshotProjectMismatch) {
			status = http.StatusConflict
		}
		writeErr(w, status, err.Error())
		return false
	}
	return true
}

func (s *Server) handlePreflightCmdbSnapshot(w http.ResponseWriter, r *http.Request) {
	var snapshot store.CmdbSnapshot
	if err := decodeStrictJSON(r, &snapshot); err != nil {
		writeErr(w, http.StatusBadRequest, "同步快照格式无效: "+err.Error())
		return
	}
	if !s.adoptSnapshotProject(w, r, &snapshot) {
		return
	}
	preview, err := s.Store.PreflightCmdbSnapshot(requestProjectScope(r), &snapshot)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, preview)
}

func (s *Server) handleApplyCmdbSnapshot(w http.ResponseWriter, r *http.Request) {
	var snapshot store.CmdbSnapshot
	if err := decodeStrictJSON(r, &snapshot); err != nil {
		writeErr(w, http.StatusBadRequest, "同步快照格式无效: "+err.Error())
		return
	}
	if !s.adoptSnapshotProject(w, r, &snapshot) {
		return
	}
	preview, err := s.Store.PreflightCmdbSnapshot(requestProjectScope(r), &snapshot)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if preview.Conflicts > 0 || preview.UnresolvedReferences > 0 {
		writeJSON(w, http.StatusConflict, preview)
		return
	}
	result, err := s.Store.ApplyCmdbSnapshot(requestProjectScope(r), &snapshot)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// handleWipeLocalCmdbData 供宿主“清空本地数据”调用：备份后清空本机 Cmdb 数据和本地附件，不影响云端。
func (s *Server) handleWipeLocalCmdbData(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Confirm string `json:"confirm"`
	}
	if err := decodeStrictJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "清空请求格式无效: "+err.Error())
		return
	}
	// 明确确认值防止误调用；接口本身只在本机回环地址提供。
	if body.Confirm != "wipe-local-cmdb" {
		writeErr(w, http.StatusBadRequest, "缺少清空确认")
		return
	}
	result, err := s.Store.WipeLocalCmdbData(requestProjectScope(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}
