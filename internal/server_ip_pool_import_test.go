package internal

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"czfy-assets/internal/store"
	"github.com/xuri/excelize/v2"
)

func ipImportRequest(t *testing.T, target string, rows [][]string) *http.Request {
	t.Helper()
	book := excelize.NewFile()
	sheet := book.GetSheetName(0)
	for rowIndex, row := range rows {
		for columnIndex, value := range row {
			cell, _ := excelize.CoordinatesToCellName(columnIndex+1, rowIndex+1)
			_ = book.SetCellValue(sheet, cell, value)
		}
	}
	file, err := book.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	_ = book.Close()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("file", "ipam.xlsx")
	_, _ = part.Write(file.Bytes())
	_ = writer.Close()
	req := httptest.NewRequest(http.MethodPost, target, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

func TestIPPoolImportPreviewsThenCommitsTransactionally(t *testing.T) {
	s := newCmdbTestServer(t)
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	rows := [][]string{
		{"网段", "IP地址", "状态", "使用人/帐号", "归属部门", "房间", "备注"},
		{"办公网", "10.20.30.10", "空闲", "", "", "", "预留"},
		{"办公网", "10.20.30.11", "在用", "张三", "信息中心", "301", "手工分配"},
	}
	preview := httptest.NewRecorder()
	mux.ServeHTTP(preview, ipImportRequest(t, "/api/ip_pool/import", rows))
	if preview.Code != http.StatusOK || !bytes.Contains(preview.Body.Bytes(), []byte(`"valid":2`)) {
		t.Fatalf("预览失败: code=%d body=%s", preview.Code, preview.Body.String())
	}
	scope, _ := s.Store.DefaultProjectScope()
	list, _ := s.Store.AllIPEntriesForProject(scope, structIPQuery())
	if len(list) != 0 {
		t.Fatalf("预览不得写库: %+v", list)
	}

	commit := httptest.NewRecorder()
	mux.ServeHTTP(commit, ipImportRequest(t, "/api/ip_pool/import?commit=1", rows))
	if commit.Code != http.StatusOK {
		t.Fatalf("提交失败: code=%d body=%s", commit.Code, commit.Body.String())
	}
	list, _ = s.Store.AllIPEntriesForProject(scope, structIPQuery())
	foundOwner := false
	for _, item := range list {
		foundOwner = foundOwner || item.Account == "张三"
	}
	if len(list) != 2 || !foundOwner {
		t.Fatalf("导入结果错误: %+v", list)
	}
}

func TestIPPoolImportRejectsDuplicateWithoutPartialWrite(t *testing.T) {
	s := newCmdbTestServer(t)
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	rows := [][]string{
		{"网段", "IP地址", "状态", "使用人/帐号", "归属部门", "房间", "备注"},
		{"办公网", "10.20.30.10", "空闲", "", "", "", ""},
		{"办公网", "10.20.30.10", "空闲", "", "", "", ""},
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, ipImportRequest(t, "/api/ip_pool/import?commit=1", rows))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("重复 IP 应阻断提交: code=%d body=%s", rec.Code, rec.Body.String())
	}
	scope, _ := s.Store.DefaultProjectScope()
	list, _ := s.Store.AllIPEntriesForProject(scope, structIPQuery())
	if len(list) != 0 {
		t.Fatalf("失败导入不得部分写入: %+v", list)
	}
}

func TestIPPoolImportPersistsExistingAssetOwner(t *testing.T) {
	s := newCmdbTestServer(t)
	scope, _ := s.Store.DefaultProjectScope()
	assetID, err := s.Store.CreateCmdbAssetManualForProject(scope, &store.CmdbAsset{
		Name:       "核心交换机",
		DeviceType: "switch",
		MgmtIP:     "10.20.30.12",
	})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	rows := [][]string{
		{"网段", "IP地址", "状态", "使用人/帐号", "归属部门", "房间", "备注"},
		{"管理网", "10.20.30.12", "空闲", "", "", "", ""},
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, ipImportRequest(t, "/api/ip_pool/import?commit=1", rows))
	if rec.Code != http.StatusOK {
		t.Fatalf("提交失败: code=%d body=%s", rec.Code, rec.Body.String())
	}
	list, err := s.Store.AllIPEntriesForProject(scope, structIPQuery())
	if err != nil || len(list) != 1 {
		t.Fatalf("读取导入结果失败: list=%+v err=%v", list, err)
	}
	entry, err := s.Store.GetIPEntryForProject(scope, list[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Status != "在用" || entry.OwnerType != "infrastructure" || entry.OwnerID != assetID || entry.OwnerName != "核心交换机" {
		t.Fatalf("导入未持久化真实资产占用: %+v", entry)
	}
}

func structIPQuery() store.IPEntryQuery { return store.IPEntryQuery{} }
