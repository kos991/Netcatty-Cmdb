package internal

import (
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"strconv"
	"strings"
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
		writeErr(w, http.StatusNotFound, "附件文件不存在或未下载至本地")
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", attachment.ContentType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": attachment.FileName}))
	w.Header().Set("Content-Length", fmt.Sprint(attachment.SizeBytes))
	_, _ = io.Copy(w, file)
}

func (s *Server) handleUpdateWorkOrderAttachmentS3Status(w http.ResponseWriter, r *http.Request) {
	workOrderID, attachmentID, ok := workOrderAttachmentIDs(r)
	if !ok {
		writeErr(w, http.StatusBadRequest, "无效的附件 ID")
		return
	}
	var req struct {
		S3Status string `json:"s3_status"`
		S3Key    string `json:"s3_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	s3Status := strings.TrimSpace(req.S3Status)
	if s3Status != "synced" && s3Status != "pending" && s3Status != "failed" {
		writeErr(w, http.StatusBadRequest, "未知的 S3 状态")
		return
	}
	if err := s.Store.UpdateWorkOrderAttachmentS3Status(requestProjectScope(r), workOrderID, attachmentID, s3Status, strings.TrimSpace(req.S3Key)); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "1"})
}

func (s *Server) handleCheckAttachmentLocalStatus(w http.ResponseWriter, r *http.Request) {
	hash := strings.TrimSpace(r.PathValue("hash"))
	if hash == "" {
		writeErr(w, http.StatusBadRequest, "缺少文件哈希")
		return
	}
	localPath, err := s.Store.BuildAttachmentLocalPath(hash)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	exists := false
	var size int64
	if stat, err := os.Stat(localPath); err == nil && !stat.IsDir() {
		exists = true
		size = stat.Size()
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"content_hash": hash,
		"local_exists": exists,
		"local_path":   localPath,
		"size_bytes":   size,
	})
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
