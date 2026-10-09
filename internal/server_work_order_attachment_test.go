package internal

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"czfy-assets/internal/store"
)

func TestWorkOrderAttachmentEndpoints(t *testing.T) {
	s := newCmdbTestServer(t)
	workOrderID, err := s.Store.CreateCmdbWorkOrder(&store.CmdbWorkOrder{Subject: "现场故障处理"})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	rawContent := []byte("attachment-data")
	expectedHash := sha256.Sum256(rawContent)
	expectedHashHex := hex.EncodeToString(expectedHash[:])

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "现场照片.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(rawContent)
	_ = writer.Close()
	upload := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/cmdb/work-orders/%d/attachments", workOrderID), &body)
	upload.Header.Set("Content-Type", writer.FormDataContentType())
	uploadRec := httptest.NewRecorder()
	mux.ServeHTTP(uploadRec, upload)
	if uploadRec.Code != http.StatusCreated {
		t.Fatalf("上传附件失败: status=%d body=%s", uploadRec.Code, uploadRec.Body.String())
	}
	var attachment store.WorkOrderAttachment
	if err := json.Unmarshal(uploadRec.Body.Bytes(), &attachment); err != nil {
		t.Fatal(err)
	}
	if attachment.ID <= 0 || attachment.FileName != "现场照片.txt" {
		t.Fatalf("上传响应错误: %+v", attachment)
	}
	if attachment.ContentHash != expectedHashHex {
		t.Fatalf("内容哈希错误: 期望 %s, 得到 %s", expectedHashHex, attachment.ContentHash)
	}
	if attachment.S3Status != "pending" {
		t.Fatalf("初始 S3 状态错误: %s", attachment.S3Status)
	}

	// 测试探测本地哈希存在性
	checkRec := httptest.NewRecorder()
	mux.ServeHTTP(checkRec, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/cmdb/attachments/hash/%s/status", expectedHashHex), nil))
	if checkRec.Code != http.StatusOK {
		t.Fatalf("探测本地哈希失败: %d %s", checkRec.Code, checkRec.Body.String())
	}
	var checkResp struct {
		LocalExists bool  `json:"local_exists"`
		SizeBytes   int64 `json:"size_bytes"`
	}
	if err := json.Unmarshal(checkRec.Body.Bytes(), &checkResp); err != nil || !checkResp.LocalExists || checkResp.SizeBytes != int64(len(rawContent)) {
		t.Fatalf("探测本地哈希响应异常: %+v", checkResp)
	}

	// 测试更新 S3 同步状态
	s3StatusBody := bytes.NewBufferString(`{"s3_status":"synced","s3_key":"attachments/test.bin"}`)
	updateS3Rec := httptest.NewRecorder()
	updateS3Req := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/cmdb/work-orders/%d/attachments/%d/s3-status", workOrderID, attachment.ID), s3StatusBody)
	mux.ServeHTTP(updateS3Rec, updateS3Req)
	if updateS3Rec.Code != http.StatusOK {
		t.Fatalf("更新 S3 状态失败: %d %s", updateS3Rec.Code, updateS3Rec.Body.String())
	}

	list := httptest.NewRecorder()
	mux.ServeHTTP(list, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/cmdb/work-orders/%d/attachments", workOrderID), nil))
	if list.Code != http.StatusOK || !bytes.Contains(list.Body.Bytes(), []byte("现场照片.txt")) {
		t.Fatalf("附件列表失败: status=%d body=%s", list.Code, list.Body.String())
	}
	if !strings.Contains(list.Body.String(), `"s3_status":"synced"`) {
		t.Fatalf("列表未反映更新后的 S3 状态: %s", list.Body.String())
	}

	download := httptest.NewRecorder()
	mux.ServeHTTP(download, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/cmdb/work-orders/%d/attachments/%d", workOrderID, attachment.ID), nil))
	if download.Code != http.StatusOK || download.Body.String() != "attachment-data" {
		t.Fatalf("附件下载失败: status=%d body=%q", download.Code, download.Body.String())
	}

	remove := httptest.NewRecorder()
	mux.ServeHTTP(remove, httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/cmdb/work-orders/%d/attachments/%d", workOrderID, attachment.ID), nil))
	if remove.Code != http.StatusOK {
		t.Fatalf("附件删除失败: status=%d body=%s", remove.Code, remove.Body.String())
	}
}
