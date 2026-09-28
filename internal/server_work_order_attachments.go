package internal

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"strconv"
)

const maxWorkOrderAttachmentBytes = 50 << 20

func workOrderAttachmentIDs(r *http.Request) (int64, int64, bool) {
	workOrderID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || workOrderID <= 0 {
		return 0, 0, false
	}
	if r.PathValue("attachment_id") == "" {
		return workOrderID, 0, true
	}
	attachmentID, err := strconv.ParseInt(r.PathValue("attachment_id"), 10, 64)
	return workOrderID, attachmentID, err == nil && attachmentID > 0
}

func (s *Server) handleListWorkOrderAttachments(w http.ResponseWriter, r *http.Request) {
	workOrderID, _, ok := workOrderAttachmentIDs(r)
	if !ok {
		writeErr(w, http.StatusBadRequest, "无效的工单 ID")
		return
	}
	list, err := s.Store.ListWorkOrderAttachmentsForProject(requestProjectScope(r), workOrderID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"list": list, "total": len(list)})
}

func (s *Server) handleUploadWorkOrderAttachment(w http.ResponseWriter, r *http.Request) {
	workOrderID, _, ok := workOrderAttachmentIDs(r)
	if !ok {
		writeErr(w, http.StatusBadRequest, "无效的工单 ID")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxWorkOrderAttachmentBytes+1<<20)
	if err := r.ParseMultipartForm(maxWorkOrderAttachmentBytes); err != nil {
		writeErr(w, http.StatusBadRequest, "附件不能超过 50 MiB: "+err.Error())
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "请选择附件: "+err.Error())
		return
	}
	defer file.Close()
	contentType := header.Header.Get("Content-Type")
	attachment, err := s.Store.SaveWorkOrderAttachmentForProject(requestProjectScope(r), workOrderID, header.Filename, contentType, io.LimitReader(file, maxWorkOrderAttachmentBytes+1))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if attachment.SizeBytes > maxWorkOrderAttachmentBytes {
		_ = s.Store.DeleteWorkOrderAttachmentForProject(requestProjectScope(r), workOrderID, attachment.ID)
		writeErr(w, http.StatusBadRequest, "附件不能超过 50 MiB")
		return
	}
	writeJSON(w, http.StatusCreated, attachment)
}

func (s *Server) handleDownloadWorkOrderAttachment(w http.ResponseWriter, r *http.Request) {
	workOrderID, attachmentID, ok := workOrderAttachmentIDs(r)
	if !ok {
		writeErr(w, http.StatusBadRequest, "无效的附件 ID")
		return
	}
	attachment, err := s.Store.GetWorkOrderAttachmentForProject(requestProjectScope(r), workOrderID, attachmentID)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	file, err := os.Open(attachment.StoredPath)
	if err != nil {
		writeErr(w, http.StatusNotFound, "附件文件不存在")
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", attachment.ContentType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": attachment.FileName}))
	w.Header().Set("Content-Length", fmt.Sprint(attachment.SizeBytes))
	_, _ = io.Copy(w, file)
}

func (s *Server) handleDeleteWorkOrderAttachment(w http.ResponseWriter, r *http.Request) {
	workOrderID, attachmentID, ok := workOrderAttachmentIDs(r)
	if !ok {
		writeErr(w, http.StatusBadRequest, "无效的附件 ID")
		return
	}
	if err := s.Store.DeleteWorkOrderAttachmentForProject(requestProjectScope(r), workOrderID, attachmentID); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "1"})
}
