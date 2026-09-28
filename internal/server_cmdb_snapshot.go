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

func (s *Server) handlePreflightCmdbSnapshot(w http.ResponseWriter, r *http.Request) {
	var snapshot store.CmdbSnapshot
	if err := decodeStrictJSON(r, &snapshot); err != nil {
		writeErr(w, http.StatusBadRequest, "同步快照格式无效: "+err.Error())
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
