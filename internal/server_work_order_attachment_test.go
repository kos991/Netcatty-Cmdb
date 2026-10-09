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

	incompleteSync := httptest.NewRecorder()
	incompleteSyncRequest := httptest.NewRequest(http.MethodPut,
		fmt.Sprintf("/api/cmdb/work-orders/%d/attachments/%d/s3-status", workOrderID, attachment.ID),
		bytes.NewBufferString(`{"s3_status":"synced","s3_key":"attachments/plain.bin"}`))
	mux.ServeHTTP(incompleteSync, incompleteSyncRequest)
	if incompleteSync.Code != http.StatusBadRequest || !strings.Contains(incompleteSync.Body.String(), "加密元数据") {
		t.Fatalf("缺少加密元数据的附件不得标记为已同步: %d %s", incompleteSync.Code, incompleteSync.Body.String())
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
	s3StatusBody := bytes.NewBufferString(`{"s3_status":"synced","s3_key":"attachments/test.bin","cloud_object_id":"object-1","encryption_version":1,"wrapped_key":"wrapped","wrapped_key_iv":"wrap-iv","data_iv":"data-iv"}`)
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
	var listPayload struct {
		List []struct {
			LocalExists bool `json:"local_exists"`
		} `json:"list"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &listPayload); err != nil {
		t.Fatal(err)
	}
	if len(listPayload.List) != 1 || !listPayload.List[0].LocalExists {
		t.Fatalf("附件列表未返回可靠的本地存在状态: %s", list.Body.String())
	}
	if strings.Contains(list.Body.String(), `"stored_path"`) {
		t.Fatalf("附件列表不得暴露内部存储路径: %s", list.Body.String())
	}
	for _, metadata := range []string{`"cloud_object_id":"object-1"`, `"encryption_version":1`, `"wrapped_key":"wrapped"`, `"wrapped_key_iv":"wrap-iv"`, `"data_iv":"data-iv"`} {
		if !strings.Contains(list.Body.String(), metadata) {
			t.Fatalf("列表缺少附件加密元数据 %s: %s", metadata, list.Body.String())
		}
	}

	retryStatus := httptest.NewRecorder()
	retryStatusRequest := httptest.NewRequest(http.MethodPut,
		fmt.Sprintf("/api/cmdb/work-orders/%d/attachments/%d/s3-status", workOrderID, attachment.ID),
		bytes.NewBufferString(`{"s3_status":"failed","s3_key":"attachments/test.bin"}`))
	mux.ServeHTTP(retryStatus, retryStatusRequest)
	if retryStatus.Code != http.StatusOK {
		t.Fatalf("更新附件重试状态失败: %d %s", retryStatus.Code, retryStatus.Body.String())
	}
	stored, err := s.Store.GetWorkOrderAttachmentForProject(store.ProjectScope{ProjectID: attachment.ProjectID}, workOrderID, attachment.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.CloudObjectID != "object-1" || stored.WrappedKey != "wrapped" || stored.DataIV != "data-iv" {
		t.Fatalf("仅更新状态时清空了加密元数据: %+v", stored)
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
