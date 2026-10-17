package internal

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"czfy-assets/internal/store"
)

func assertTerminalHardwareResponse(t *testing.T, got, want store.Asset) {
	t.Helper()
	if got.Vendor != want.Vendor || got.Model != want.Model || got.CPUInfo != want.CPUInfo || got.MemoryMB != want.MemoryMB || got.DiskInfo != want.DiskInfo {
		t.Fatalf("hardware mismatch: got=%+v want=%+v", got, want)
	}
}

func TestTerminalHardwareAPIStoresAndReturnsHardware(t *testing.T) {
	_, _, mux := newLegacyHandlerTestServer(t)
	want := store.Asset{AssetName: "办公终端", AssetCode: "HW-API", DeviceType: "台式电脑", Vendor: "联想", Model: "M630Z", CPUInfo: "兆芯 KX-U6780A", MemoryMB: 16384, DiskInfo: "512GB SSD", Status: "在用"}
	body, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	created := httptest.NewRecorder()
	mux.ServeHTTP(created, httptest.NewRequest(http.MethodPost, "/api/assets", bytes.NewReader(body)))
	if created.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	var result struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	path := fmt.Sprintf("/api/assets/%d", result.ID)
	readDetail := func() store.Asset {
		t.Helper()
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("detail: %d %s", rec.Code, rec.Body.String())
		}
		var payload struct {
			Asset store.Asset `json:"asset"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		return payload.Asset
	}
	assertTerminalHardwareResponse(t, readDetail(), want)
	want.Vendor, want.Model, want.CPUInfo, want.MemoryMB, want.DiskInfo = "华为", "擎云 L420", "麒麟 9006C", 32768, "1TB SSD"
	body, err = json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	updated := httptest.NewRecorder()
	mux.ServeHTTP(updated, httptest.NewRequest(http.MethodPut, path, bytes.NewReader(body)))
	if updated.Code != http.StatusOK {
		t.Fatalf("update: %d %s", updated.Code, updated.Body.String())
	}
	assertTerminalHardwareResponse(t, readDetail(), want)
	listed := httptest.NewRecorder()
	mux.ServeHTTP(listed, httptest.NewRequest(http.MethodGet, "/api/assets?keyword=HW-API", nil))
	var listing struct {
		List  []store.Asset `json:"list"`
		Total int           `json:"total"`
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &listing); err != nil {
		t.Fatal(err)
	}
	if listed.Code != http.StatusOK || listing.Total != 1 || len(listing.List) != 1 {
		t.Fatalf("list: %d %s", listed.Code, listed.Body.String())
	}
	assertTerminalHardwareResponse(t, listing.List[0], want)
	for _, method := range []string{http.MethodPost, http.MethodPut} {
		endpoint := path
		if method == http.MethodPost {
			endpoint = "/api/assets"
		}
		bad := httptest.NewRecorder()
		mux.ServeHTTP(bad, httptest.NewRequest(method, endpoint, strings.NewReader(`{"memory_mb":-1}`)))
		if bad.Code != http.StatusBadRequest {
			t.Fatalf("negative %s: %d %s", method, bad.Code, bad.Body.String())
		}
	}
	assertTerminalHardwareResponse(t, readDetail(), want)
}

func uploadTerminalHardware(t *testing.T, mux *http.ServeMux, filename string, data []byte, commit bool) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	path := "/api/import/assets"
	if commit {
		path += "?commit=1"
	}
	request := httptest.NewRequest(http.MethodPost, path, &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, request)
	return rec
}

func TestTerminalHardwareExportImportRoundTrip(t *testing.T) {
	for _, format := range []string{"xlsx", "csv"} {
		t.Run(format, func(t *testing.T) {
			_, source, sourceMux := newLegacyHandlerTestServer(t)
			want := store.Asset{AssetName: "便携终端", AssetCode: "HW-IO", DeviceType: "笔记本", Vendor: "华为", Model: "擎云 L420", CPUInfo: "麒麟, 9006C", MemoryMB: 16384, DiskInfo: "512GB SSD\n外接磁盘", Status: "在用"}
			if _, err := source.CreateAsset(&want, "测试"); err != nil {
				t.Fatal(err)
			}
			exported := httptest.NewRecorder()
			sourceMux.ServeHTTP(exported, httptest.NewRequest(http.MethodGet, "/api/export/assets?format="+format, nil))
			if exported.Code != http.StatusOK {
				t.Fatalf("export: %d %s", exported.Code, exported.Body.String())
			}
			rows, problems, err := parseLegacyAssetImport(bytes.NewReader(exported.Body.Bytes()))
			if err != nil || len(problems) != 0 || len(rows) != 1 {
				t.Fatalf("rows=%+v errors=%v err=%v", rows, problems, err)
			}
			assertTerminalHardwareResponse(t, rows[0].Asset, want)
			_, destination, destinationMux := newLegacyHandlerTestServer(t)
			imported := uploadTerminalHardware(t, destinationMux, "terminals."+format, exported.Body.Bytes(), true)
			if imported.Code != http.StatusOK {
				t.Fatalf("import: %d %s", imported.Code, imported.Body.String())
			}
			assets, err := destination.AllAssets()
			if err != nil || len(assets) != 1 {
				t.Fatalf("assets=%+v err=%v", assets, err)
			}
			assertTerminalHardwareResponse(t, assets[0], want)
		})
	}
}

func TestTerminalHardwareImportRejectsInvalidMemory(t *testing.T) {
	headers := []string{"资产编码", "设备类型", "设备SN/终端主机SN", "显示器SN（仅云桌面）", "当前使用人", "所属组织", "房间/位置", "设备/业务IP", "终端物理IP", "状态", "网络类型", "备注", "品牌/厂商", "型号", "CPU", "内存（MB）", "磁盘"}
	for _, format := range []string{"xlsx", "csv"} {
		for _, memory := range []string{"-1", "1.5", "not-memory", "9223372036854775808"} {
			t.Run(format+"_"+memory, func(t *testing.T) {
				values := []string{"HW-INVALID", "台式电脑", "SN-1", "", "", "", "", "", "", "在用", "", "", "联想", "M630Z", "兆芯", memory, "512GB SSD"}
				var data []byte
				if format == "xlsx" {
					data = legacyAssetImportWorkbookWithHeaders(t, headers, values)
				} else {
					var buffer bytes.Buffer
					writer := csv.NewWriter(&buffer)
					if err := writer.WriteAll([][]string{headers, values}); err != nil {
						t.Fatal(err)
					}
					data = buffer.Bytes()
				}
				rows, problems, err := parseLegacyAssetImport(bytes.NewReader(data))
				if err != nil || len(rows) != 1 || len(problems) != 1 || !strings.Contains(rows[0].Message, "非负整数") {
					t.Fatalf("rows=%+v errors=%v err=%v", rows, problems, err)
				}
				_, destination, mux := newLegacyHandlerTestServer(t)
				rec := uploadTerminalHardware(t, mux, "invalid."+format, data, true)
				if rec.Code != http.StatusBadRequest {
					t.Fatalf("invalid import: %d %s", rec.Code, rec.Body.String())
				}
				assets, err := destination.AllAssets()
				if err != nil || len(assets) != 0 {
					t.Fatalf("invalid import wrote assets=%+v err=%v", assets, err)
				}
			})
		}
	}
}

func TestTerminalHardwareTemplateProvidesColumns(t *testing.T) {
	_, _, mux := newLegacyHandlerTestServer(t)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/template/assets", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("template: %d %s", rec.Code, rec.Body.String())
	}
	rows, problems, err := parseLegacyAssetImport(bytes.NewReader(rec.Body.Bytes()))
	if err != nil || len(problems) != 0 || len(rows) != 1 {
		t.Fatalf("rows=%+v errors=%v err=%v", rows, problems, err)
	}
	if rows[0].Asset.Vendor == "" || rows[0].Asset.Model == "" || rows[0].Asset.CPUInfo == "" || rows[0].Asset.MemoryMB != 16384 || rows[0].Asset.DiskInfo == "" {
		t.Fatalf("template hardware missing: %+v", rows[0].Asset)
	}
}
