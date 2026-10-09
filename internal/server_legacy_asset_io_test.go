package internal

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"czfy-assets/internal/store"
	"github.com/xuri/excelize/v2"
)

func legacyAssetImportWorkbookWithHeaders(t *testing.T, headers, values []string) []byte {
	t.Helper()
	book := excelize.NewFile()
	sheet := book.GetSheetName(0)
	for index, header := range headers {
		cell, _ := excelize.CoordinatesToCellName(index+1, 1)
		if err := book.SetCellValue(sheet, cell, header); err != nil {
			t.Fatal(err)
		}
	}
	for index, value := range values {
		cell, _ := excelize.CoordinatesToCellName(index+1, 2)
		if err := book.SetCellValue(sheet, cell, value); err != nil {
			t.Fatal(err)
		}
	}
	buffer, err := book.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func legacyAssetImportWorkbook(t *testing.T, values []string) []byte {
	t.Helper()
	headers := []string{"资产编码", "设备类型", "设备SN/终端主机SN", "显示器SN（仅云桌面）", "当前使用人", "所属组织", "房间/位置", "设备/业务IP", "终端物理IP", "状态", "网络类型", "备注"}
	return legacyAssetImportWorkbookWithHeaders(t, headers, values)
}

func TestParseLegacyAssetImport(t *testing.T) {
	data := legacyAssetImportWorkbook(t, []string{"ASSET-001", "台式电脑", "HOST-001", "DISPLAY-001", "张三", "技术处", "301", "10.0.0.10", "", "在用", "内网", "导入测试"})
	rows, errors, err := parseLegacyAssetImport(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if len(errors) != 0 || len(rows) != 1 {
		t.Fatalf("rows=%d errors=%v", len(rows), errors)
	}
	asset := rows[0].Asset
	if asset.AssetCode != "ASSET-001" || asset.DeviceType != "台式电脑" || asset.BoxSN != "HOST-001" || asset.DisplaySN != "" || asset.IP != "10.0.0.10" || asset.NetType != "内网" {
		t.Fatalf("unexpected asset: %#v", asset)
	}
}

func TestParseLegacyAssetImportReadsOptionalOperatingSystemColumns(t *testing.T) {
	headers := []string{"资产编码", "设备类型", "设备SN/终端主机SN", "显示器SN（仅云桌面）", "当前使用人", "所属组织", "房间/位置", "设备/业务IP", "终端物理IP", "操作系统类型", "操作系统版本", "状态", "网络类型", "备注"}
	data := legacyAssetImportWorkbookWithHeaders(t, headers, []string{"OS-001", "台式电脑", "HOST-OS-1", "", "张三", "技术处", "301", "10.0.0.30", "", "openEuler", "24.03 LTS", "在用", "内网", "系统导入"})
	rows, errors, err := parseLegacyAssetImport(bytes.NewReader(data))
	if err != nil || len(errors) != 0 || len(rows) != 1 {
		t.Fatalf("rows=%d errors=%v err=%v", len(rows), errors, err)
	}
	if rows[0].Asset.OSType != "openEuler" || rows[0].Asset.OSVersion != "24.03 LTS" {
		t.Fatalf("导入未保留系统信息: %#v", rows[0].Asset)
	}
}

func TestParseLegacyAssetImportReadsIndependentAssetName(t *testing.T) {
	headers := []string{"资产名称", "资产编码", "设备类型", "设备SN/终端主机SN", "显示器SN（仅云桌面）", "当前使用人", "所属组织", "房间/位置", "设备/业务IP", "终端物理IP", "操作系统类型", "操作系统版本", "状态", "网络类型", "备注"}
	data := legacyAssetImportWorkbookWithHeaders(t, headers, []string{"执行局办公终端", "ASSET-NAME-1", "台式电脑", "SN-1", "", "张三", "执行局", "502室", "10.0.0.40", "", "统信 UOS", "20", "在用", "内网", "名称导入"})
	rows, errors, err := parseLegacyAssetImport(bytes.NewReader(data))
	if err != nil || len(errors) != 0 || len(rows) != 1 {
		t.Fatalf("rows=%d errors=%v err=%v", len(rows), errors, err)
	}
	if rows[0].Asset.AssetName != "执行局办公终端" || rows[0].Asset.AssetCode != "ASSET-NAME-1" {
		t.Fatalf("独立资产名称与编码必须分别导入: %+v", rows[0].Asset)
	}
}

func TestLegacyAssetExportIncludesOperatingSystemColumns(t *testing.T) {
	values := legacyAssetExportValues(store.Asset{ID: 9, AssetName: "出口名称", AssetCode: "OS-EXPORT", DeviceType: "台式电脑", OSType: "Windows 11", OSVersion: "23H2", Status: "在用"})
	if len(values) != 16 || values[1] != "出口名称" || values[11] != "Windows 11" || values[12] != "23H2" {
		t.Fatalf("终端导出系统列错误: %#v", values)
	}
}

func TestLegacyAssetTemplateIncludesIndependentAssetName(t *testing.T) {
	_, _, mux := newLegacyHandlerTestServer(t)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/template/assets", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("模板下载失败: status=%d body=%s", rec.Code, rec.Body.String())
	}
	book, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	rows, err := book.GetRows(book.GetSheetName(0))
	if err != nil || len(rows) == 0 {
		t.Fatalf("读取模板失败: %v", err)
	}
	if rows[0][0] != "资产名称" || rows[0][1] != "资产编码" {
		t.Fatalf("模板必须将名称与编码分开: %v", rows[0])
	}
}

func TestParseLegacyAssetImportKeepsCloudDesktopDualSerials(t *testing.T) {
	data := legacyAssetImportWorkbook(t, []string{"CLOUD-001", "云桌面盒子", "BOX-001", "DISPLAY-001", "张三", "技术处", "301", "10.0.0.10", "10.0.0.11", "在用", "内网", "云桌面"})
	rows, errors, err := parseLegacyAssetImport(bytes.NewReader(data))
	if err != nil || len(errors) != 0 || len(rows) != 1 {
		t.Fatalf("rows=%d errors=%v err=%v", len(rows), errors, err)
	}
	if rows[0].Asset.BoxSN != "BOX-001" || rows[0].Asset.DisplaySN != "DISPLAY-001" || rows[0].Asset.TerminalIP != "10.0.0.11" {
		t.Fatalf("云桌面双 SN/IP 未保留: %#v", rows[0].Asset)
	}
}

func TestParseLegacyAssetImportAcceptsOldSerialHeaders(t *testing.T) {
	headers := []string{"资产编码", "设备类型", "终端主机SN", "显示器SN", "当前使用人", "所属组织", "房间/位置", "设备/业务IP", "终端物理IP", "状态", "网络类型", "备注"}
	data := legacyAssetImportWorkbookWithHeaders(t, headers, []string{"OLD-001", "云桌面盒子", "BOX-OLD", "DISPLAY-OLD", "张三", "技术处", "301", "10.0.0.10", "10.0.0.11", "在用", "内网", "旧模板"})
	rows, errors, err := parseLegacyAssetImport(bytes.NewReader(data))
	if err != nil || len(errors) != 0 || len(rows) != 1 || rows[0].Asset.DisplaySN != "DISPLAY-OLD" {
		t.Fatalf("旧模板兼容失败: rows=%#v errors=%v err=%v", rows, errors, err)
	}
}

func TestParseLegacyAssetImportIgnoresRetiredSoftwareColumn(t *testing.T) {
	headers := []string{"资产编码", "设备类型", "终端主机SN", "显示器SN", "当前使用人", "所属组织", "房间/位置", "设备/业务IP", "终端物理IP", "软件安装情况", "状态", "网络类型", "备注"}
	data := legacyAssetImportWorkbookWithHeaders(t, headers, []string{"ASSET-OLD", "台式电脑", "HOST-OLD", "", "张三", "技术处", "301", "10.0.0.20", "", "历史安全客户端", "在用", "内网", "旧模板"})
	rows, errors, err := parseLegacyAssetImport(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if len(errors) != 0 || len(rows) != 1 {
		t.Fatalf("rows=%d errors=%v", len(rows), errors)
	}
	if rows[0].Asset.SecuritySoftware != "" {
		t.Fatalf("旧模板的软件安装情况必须忽略，实际=%q", rows[0].Asset.SecuritySoftware)
	}
}

func TestParseLegacyAssetImportRejectsMissingDeviceType(t *testing.T) {
	data := legacyAssetImportWorkbook(t, []string{"ASSET-002"})
	rows, errors, err := parseLegacyAssetImport(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || len(errors) != 1 || rows[0].Message != "设备类型不能为空" {
		t.Fatalf("rows=%#v errors=%v", rows, errors)
	}
}
