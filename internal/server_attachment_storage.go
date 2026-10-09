package internal

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"

	"czfy-assets/internal/store"
)

type attachmentStorageTargetRequest struct {
	TargetRoot string `json:"target_root"`
}

type localizeAttachmentRequest struct {
	TempToken string `json:"temp_token"`
}

type pendingAttachmentResponse struct {
	store.WorkOrderAttachment
	LocalPath   string `json:"local_path"`
	LocalExists bool   `json:"local_exists"`
}

func decodeAttachmentJSON(r *http.Request, value interface{}) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("请求体只能包含一个 JSON 对象")
	}
	return nil
}

func (s *Server) handleGetAttachmentStorage(w http.ResponseWriter, r *http.Request) {
	status, err := s.Store.GetAttachmentStorageStatus(requestProjectScope(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handlePreflightAttachmentStorage(w http.ResponseWriter, r *http.Request) {
	var request attachmentStorageTargetRequest
	if err := decodeAttachmentJSON(r, &request); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}
	preview, err := s.Store.PreflightAttachmentStorageMigration(requestProjectScope(r), request.TargetRoot)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, preview)
}

func (s *Server) handleMigrateAttachmentStorage(w http.ResponseWriter, r *http.Request) {
	var request attachmentStorageTargetRequest
	if err := decodeAttachmentJSON(r, &request); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}
	result, err := s.Store.MigrateAttachmentStorage(requestProjectScope(r), request.TargetRoot)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleRestoreDefaultAttachmentStorage(w http.ResponseWriter, r *http.Request) {
	result, err := s.Store.MigrateAttachmentStorage(requestProjectScope(r), "")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleListPendingAttachments(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.ListPendingWorkOrderAttachmentsForProject(requestProjectScope(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	response := make([]pendingAttachmentResponse, 0, len(list))
	for _, attachment := range list {
		exists := false
		if info, statErr := os.Stat(attachment.StoredPath); statErr == nil && !info.IsDir() {
			exists = true
		}
		response = append(response, pendingAttachmentResponse{
			WorkOrderAttachment: attachment,
			LocalPath:           attachment.StoredPath,
			LocalExists:         exists,
		})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"list": response, "total": len(response)})
}

func (s *Server) handleCreateAttachmentTempTarget(w http.ResponseWriter, r *http.Request) {
	token, path, err := s.Store.CreateAttachmentTempTarget(requestProjectScope(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"token": token, "path": path})
}

func (s *Server) handleLocalizeWorkOrderAttachment(w http.ResponseWriter, r *http.Request) {
	workOrderID, attachmentID, ok := workOrderAttachmentIDs(r)
	if !ok {
		writeErr(w, http.StatusBadRequest, "无效的附件 ID")
		return
	}
	var request localizeAttachmentRequest
	if err := decodeAttachmentJSON(r, &request); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}
	if strings.TrimSpace(request.TempToken) == "" {
		writeErr(w, http.StatusBadRequest, "缺少附件临时令牌")
		return
	}
	attachment, err := s.Store.LocalizeWorkOrderAttachmentFromTemp(
		requestProjectScope(r), workOrderID, attachmentID, request.TempToken,
	)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, attachment)
}
