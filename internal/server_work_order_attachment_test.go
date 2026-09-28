package internal

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
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

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "现场照片.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write([]byte("attachment-data"))
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

	list := httptest.NewRecorder()
	mux.ServeHTTP(list, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/cmdb/work-orders/%d/attachments", workOrderID), nil))
	if list.Code != http.StatusOK || !bytes.Contains(list.Body.Bytes(), []byte("现场照片.txt")) {
		t.Fatalf("附件列表失败: status=%d body=%s", list.Code, list.Body.String())
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
