package internal

import (
	"errors"
	"net/http"

	"czfy-assets/internal/store"
)

func writeRackMigrationError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrRackMigrationConflict) {
		writeErr(w, http.StatusConflict, err.Error())
		return
	}
	writeErr(w, http.StatusInternalServerError, err.Error())
}

func (s *Server) handlePreviewRackMigration(w http.ResponseWriter, r *http.Request) {
	preview, err := s.Store.PreviewRackMigration(requestProjectScope(r))
	if err != nil {
		writeRackMigrationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, preview)
}

func (s *Server) handleApplyRackMigration(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if err := decodeStrictJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "迁移确认参数无效: "+err.Error())
		return
	}
	result, err := s.Store.ApplyRackMigration(requestProjectScope(r), body.Token)
	if err != nil {
		writeRackMigrationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleRollbackRackMigration(w http.ResponseWriter, r *http.Request) {
	updated, err := s.Store.RollbackRackMigration(requestProjectScope(r))
	if err != nil {
		writeRackMigrationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"updated": updated})
}
