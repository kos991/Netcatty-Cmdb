package internal

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
)

func (s *Server) handleGetApp(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "非法ID")
		return
	}
	app, logs, err := s.Store.GetAppForProject(requestProjectScope(r), id)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "业务系统不存在")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"app": app, "logs": logs})
}
