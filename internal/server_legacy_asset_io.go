package internal

import (
	"bufio"
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"czfy-assets/internal/store"
	"github.com/xuri/excelize/v2"
)

var legacyAssetImportHeaders = [][]string{
	{"资产编码"}, {"设备类型"}, {"设备SN/终端主机SN", "终端主机SN"}, {"显示器SN（仅云桌面）", "显示器SN"},
	{"当前使用人", "使用人"}, {"所属组织", "部门"}, {"房间/位置"}, {"设备/业务IP"}, {"终端物理IP"}, {"状态"}, {"网络类型"}, {"备注"},
}

const legacyAssetNameImportHeader = "资产名称"

type legacyAssetImportRow struct {
	Row     int         `json:"row"`
	Name    string      `json:"name"`
	Asset   store.Asset `json:"asset"`
	Message string      `json:"message"`
}

func parseLegacyAssetImport(r io.Reader) ([]legacyAssetImportRow, []string, error) {
	rows, err := readLegacyAssetImportRows(r)
	if err != nil {
		return nil, nil, err
	}
	if len(rows) == 0 {
		return []legacyAssetImportRow{}, []string{"导入文件没有数据"}, nil
	}
	indexes := map[string]int{}
	for index, name := range rows[0] {
		indexes[strings.TrimPrefix(strings.TrimSpace(name), "\uFEFF")] = index
	}
	var missing []string
	for _, aliases := range legacyAssetImportHeaders {
		found := false
		for _, alias := range aliases {
			if _, ok := indexes[alias]; ok {
				found = true
				break
			}
		}
		if !found {
			missing = append(missing, "缺少列："+aliases[0])
		}
	}
	if len(missing) > 0 {
		return []legacyAssetImportRow{}, missing, nil
	}
	value := func(row []string, names ...string) string {
		for _, name := range names {
			index, ok := indexes[name]
			if !ok || index >= len(row) {
				continue
			}
			return strings.TrimSpace(row[index])
		}
		return ""
	}
	assetNameIndex, hasAssetName := indexes[legacyAssetNameImportHeader]
	parsed := make([]legacyAssetImportRow, 0, len(rows)-1)
	errors := []string{}
	seen := map[string]bool{}
	for index, row := range rows[1:] {
		asset := store.Asset{
			AssetCode: value(row, "资产编码"), DeviceType: value(row, "设备类型"), BoxSN: value(row, "设备SN/终端主机SN", "终端主机SN"), DisplaySN: value(row, "显示器SN（仅云桌面）", "显示器SN"),
			UserName: value(row, "当前使用人", "使用人"), Department: value(row, "所属组织", "部门"), Room: value(row, "房间/位置"), IP: value(row, "设备/业务IP"),
			TerminalIP: value(row, "终端物理IP"), OSType: value(row, "操作系统类型"), OSVersion: value(row, "操作系统版本"),
			Status: value(row, "状态"), NetType: value(row, "网络类型"), Remark: value(row, "备注"),
			Vendor: value(row, "品牌/厂商", "厂商", "品牌", "vendor"), Model: value(row, "型号", "model"),
			CPUInfo: value(row, "CPU", "CPU信息", "cpu_info"), DiskInfo: value(row, "磁盘", "磁盘信息", "disk_info"),
		}
		if hasAssetName && assetNameIndex < len(row) {
			asset.AssetName = strings.TrimSpace(row[assetNameIndex])
		}
		if asset.AssetName == "" && asset.AssetCode == "" && asset.DeviceType == "" && asset.BoxSN == "" && asset.UserName == "" {
			continue
		}
		message := "可导入"
		if asset.DeviceType == "" {
			message = "设备类型不能为空"
			errors = append(errors, "第 "+strconv.Itoa(index+2)+" 行："+message)
		} else if asset.AssetCode != "" && seen[asset.AssetCode] {
			message = "文件内资产编码重复"
			errors = append(errors, "第 "+strconv.Itoa(index+2)+" 行："+message)
		}
		if memory := value(row, "内存（MB）", "内存(MB)", "memory_mb"); memory != "" {
			parsedMemory, err := strconv.ParseInt(memory, 10, 64)
			if err != nil || parsedMemory < 0 {
				if message == "可导入" {
					message = "内存（MB）必须为非负整数"
					errors = append(errors, "第 "+strconv.Itoa(index+2)+" 行："+message)
				}
			} else {
				asset.MemoryMB = parsedMemory
			}
		}
		if asset.Status == "" {
			asset.Status = "在用"
		}
		if asset.DeviceType != "" && !isCloudDesktopImportDeviceType(asset.DeviceType) {
			asset.DisplaySN = ""
			asset.TerminalIP = ""
		}
		seen[asset.AssetCode] = asset.AssetCode != ""
		previewName := asset.AssetName
		if previewName == "" {
			previewName = asset.AssetCode
		}
		parsed = append(parsed, legacyAssetImportRow{Row: index + 2, Name: previewName, Asset: asset, Message: message})
	}
	return parsed, errors, nil
}

func readLegacyAssetImportRows(r io.Reader) ([][]string, error) {
	reader := bufio.NewReader(r)
	signature, err := reader.Peek(2)
	if err != nil && err != io.EOF {
		return nil, err
	}
	if string(signature) != "PK" {
		parser := csv.NewReader(reader)
		parser.FieldsPerRecord = -1
		return parser.ReadAll()
	}
	book, err := excelize.OpenReader(reader)
	if err != nil {
		return nil, err
	}
	defer book.Close()
	return book.GetRows(book.GetSheetName(0))
}

func writeLegacyAssetCSV(w http.ResponseWriter, headers []string, assets []store.Asset) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="terminal_assets.csv"`)
	_, _ = w.Write([]byte{0xEF, 0xBB, 0xBF})
	writer := csv.NewWriter(w)
	_ = writer.Write(headers)
	for _, asset := range assets {
		values := legacyAssetExportValues(asset)
		row := make([]string, len(values))
		for index, value := range values {
			row[index] = fmt.Sprint(value)
		}
		_ = writer.Write(row)
	}
	writer.Flush()
}

func isCloudDesktopImportDeviceType(deviceType string) bool {
	for _, keyword := range []string{"云桌面", "云盒", "盒子"} {
		if strings.Contains(deviceType, keyword) {
			return true
		}
	}
	return false
}

func (s *Server) handleImportAssets(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "导入文件解析失败")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "请上传 xlsx 或 csv 文件")
		return
	}
	defer file.Close()
	rows, errors, err := parseLegacyAssetImport(file)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "导入失败: "+err.Error())
		return
	}
	if r.URL.Query().Get("commit") != "1" {
		writeJSON(w, http.StatusOK, map[string]interface{}{"rows": rows, "total": len(rows), "valid": len(rows) - len(errors), "errors": errors})
		return
	}
	if len(errors) > 0 {
		writeErr(w, http.StatusBadRequest, "导入文件仍有校验错误")
		return
	}
	assets := make([]store.Asset, 0, len(rows))
	for _, row := range rows {
		assets = append(assets, row.Asset)
	}
	if err := s.Store.ImportAssetsForProject(scope, assets); err != nil {
		writeErr(w, http.StatusBadRequest, "导入失败: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"created": len(assets)})
}
