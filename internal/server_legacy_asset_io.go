package internal

import (
	"io"
	"net/http"
	"strconv"
	"strings"

	"czfy-assets/internal/store"
	"github.com/xuri/excelize/v2"
)

var legacyAssetImportHeaders = []string{"资产编码", "设备类型", "终端主机SN", "显示器SN", "当前使用人", "所属组织", "房间/位置", "设备/业务IP", "终端物理IP", "软件安装情况", "状态", "网络类型", "备注"}

type legacyAssetImportRow struct {
	Row     int         `json:"row"`
	Name    string      `json:"name"`
	Asset   store.Asset `json:"asset"`
	Message string      `json:"message"`
}

func parseLegacyAssetImport(r io.Reader) ([]legacyAssetImportRow, []string, error) {
	book, err := excelize.OpenReader(r)
	if err != nil {
		return nil, nil, err
	}
	defer book.Close()
	rows, err := book.GetRows(book.GetSheetName(0))
	if err != nil {
		return nil, nil, err
	}
	if len(rows) == 0 {
		return []legacyAssetImportRow{}, []string{"导入文件没有数据"}, nil
	}
	indexes := map[string]int{}
	for index, name := range rows[0] {
		indexes[strings.TrimSpace(name)] = index
	}
	var missing []string
	for _, header := range legacyAssetImportHeaders {
		if _, ok := indexes[header]; !ok {
			missing = append(missing, "缺少列："+header)
		}
	}
	if len(missing) > 0 {
		return []legacyAssetImportRow{}, missing, nil
	}
	value := func(row []string, name string) string {
		index := indexes[name]
		if index >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[index])
	}
	parsed := make([]legacyAssetImportRow, 0, len(rows)-1)
	errors := []string{}
	seen := map[string]bool{}
	for index, row := range rows[1:] {
		asset := store.Asset{
			AssetCode: value(row, "资产编码"), DeviceType: value(row, "设备类型"), BoxSN: value(row, "终端主机SN"), DisplaySN: value(row, "显示器SN"),
			UserName: value(row, "当前使用人"), Department: value(row, "所属组织"), Room: value(row, "房间/位置"), IP: value(row, "设备/业务IP"),
			TerminalIP: value(row, "终端物理IP"), SecuritySoftware: value(row, "软件安装情况"), Status: value(row, "状态"), NetType: value(row, "网络类型"), Remark: value(row, "备注"),
		}
		if asset.AssetCode == "" && asset.DeviceType == "" && asset.BoxSN == "" && asset.UserName == "" {
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
		if asset.Status == "" {
			asset.Status = "在用"
		}
		if asset.NetType == "" {
			asset.NetType = "专网"
		}
		seen[asset.AssetCode] = asset.AssetCode != ""
		parsed = append(parsed, legacyAssetImportRow{Row: index + 2, Name: asset.AssetCode, Asset: asset, Message: message})
	}
	return parsed, errors, nil
}

func (s *Server) handleImportAssets(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "Excel 文件解析失败")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "请上传 xlsx 文件")
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
