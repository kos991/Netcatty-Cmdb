package internal

import (
	"bytes"
	"testing"

	"github.com/xuri/excelize/v2"
)

func legacyAssetImportWorkbook(t *testing.T, values []string) []byte {
	t.Helper()
	book := excelize.NewFile()
	sheet := book.GetSheetName(0)
	for index, header := range legacyAssetImportHeaders {
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

func TestParseLegacyAssetImport(t *testing.T) {
	data := legacyAssetImportWorkbook(t, []string{"ASSET-001", "台式电脑", "HOST-001", "DISPLAY-001", "张三", "技术处", "301", "10.0.0.10", "", "终端安全客户端", "在用", "内网", "导入测试"})
	rows, errors, err := parseLegacyAssetImport(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if len(errors) != 0 || len(rows) != 1 {
		t.Fatalf("rows=%d errors=%v", len(rows), errors)
	}
	asset := rows[0].Asset
	if asset.AssetCode != "ASSET-001" || asset.DeviceType != "台式电脑" || asset.IP != "10.0.0.10" || asset.NetType != "内网" {
		t.Fatalf("unexpected asset: %#v", asset)
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
