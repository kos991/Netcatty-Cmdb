package internal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"czfy-assets/internal/store"
)

const cmdbProjectHeader = "X-Cmdb-Project"

type projectScopeContextKey struct{}

func (s *Server) resolveRequestProjectScope(r *http.Request) (store.ProjectScope, int, error) {
	key := http.CanonicalHeaderKey(cmdbProjectHeader)
	values, exists := r.Header[key]
	if !exists {
		scope, err := s.Store.DefaultProjectScope()
		return scope, http.StatusInternalServerError, err
	}
	if len(values) != 1 || strings.TrimSpace(values[0]) == "" {
		return store.ProjectScope{}, http.StatusBadRequest, fmt.Errorf("%s 必须是单个有效项目 ID", cmdbProjectHeader)
	}
	id, err := strconv.ParseInt(strings.TrimSpace(values[0]), 10, 64)
	if err != nil || id <= 0 {
		return store.ProjectScope{}, http.StatusBadRequest, fmt.Errorf("%s 必须是正整数项目 ID", cmdbProjectHeader)
	}
	scope := store.ProjectScope{ProjectID: id}
	if _, err := s.Store.ResolveProject(scope); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, store.ErrProjectScopedNotFound) {
			status = http.StatusBadRequest
		}
		return store.ProjectScope{}, status, fmt.Errorf("%s 无效: %w", cmdbProjectHeader, err)
	}
	return scope, http.StatusOK, nil
}

func (s *Server) withProjectScope(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, status, err := s.resolveRequestProjectScope(r)
		if err != nil {
			writeErr(w, status, err.Error())
			return
		}
		ctx := context.WithValue(r.Context(), projectScopeContextKey{}, scope)
		next(w, r.WithContext(ctx))
	}
}

func requestProjectScope(r *http.Request) store.ProjectScope {
	scope, _ := r.Context().Value(projectScopeContextKey{}).(store.ProjectScope)
	return scope
}

func (s *Server) handleListCmdbProjects(w http.ResponseWriter, _ *http.Request) {
	projects, err := s.Store.ListCmdbProjects()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"list": projects, "total": len(projects)})
}

func (s *Server) handleCreateCmdbProject(w http.ResponseWriter, r *http.Request) {
	var body store.CmdbProject
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
		return
	}
	created, err := s.Store.CreateCmdbProject(&body)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, created)
}

func (s *Server) handleUpdateCmdbProject(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "无效的项目 ID")
		return
	}
	var body store.CmdbProject
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
		return
	}
	body.ID = id
	if err := s.Store.UpdateCmdbProject(&body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	updated, err := s.Store.GetCmdbProject(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}
