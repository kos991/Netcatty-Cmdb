package store

import (
	"bytes"
	"fmt"
	"io"
	"strings"

	"github.com/xuri/excelize/v2"
)

// ============================ CMDB 资源导出 ============================

// AllCmdbAssets 返回当前筛选条件下的全部资产（用于导出，不受分页限制）。
func (s *Store) AllCmdbAssets(q CmdbAssetQuery) ([]CmdbAsset, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.AllCmdbAssetsForProject(scope, q)
}

// CmdbAssetFilterOptions 返回列头筛选的可选值（取自真实数据）。
func (s *Store) CmdbAssetFilterOptions() (map[string][]string, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.CmdbAssetFilterOptionsForProject(scope)
}

// ============================ CMDB 批量导入 ============================

// cmdbImportColumns 是导入模板的列顺序（下载模板与批量导入共用，保证是一对）。
var cmdbImportColumns = []string{
	"资产名称", "资产编号", "状态", "设备分类", "序列号", "厂商", "型号",
	"所属组织", "所属分组", "部门", "负责人", "管理IP", "MAC地址",
	"操作系统类型", "操作系统版本", "安装日期", "保修到期", "备注",
}

// CmdbImportRow 是一行导入结果。
type CmdbImportRow struct {
	Row          int    `json:"row"`
	Name         string `json:"name"`
	AssetCode    string `json:"asset_code"`
	CategoryName string `json:"category_name"`
	OrgName      string `json:"org_name"`
	GroupName    string `json:"group_name"`
	Valid        bool   `json:"valid"`
	Message      string `json:"message"`
}

// CmdbImportResult 是导入预览 / 提交结果。
type CmdbImportResult struct {
	Total   int             `json:"total"`
	Valid   int             `json:"valid"`
	Created int             `json:"created"`
	Rows    []CmdbImportRow `json:"rows"`
	Errors  []string        `json:"errors"`
}

// BuildCmdbImportTemplate 生成与批量导入严格匹配的 xlsx 模板。
func BuildCmdbImportTemplate() ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close()
	const sheet = "资产导入模板"
	f.SetSheetName("Sheet1", sheet)

	for i, h := range cmdbImportColumns {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		_ = f.SetCellValue(sheet, cell, h)
	}
	example := []interface{}{
		"测试交换机", "ZC-2026-001", "在库", "网络设备", "SN-EXAMPLE-001", "华为", "S5720",
		"技术处", "核心机房", "技术处", "张三", "10.10.20.10", "00:11:22:33:44:55",
		"Linux", "openEuler 22.03", "2026-01-01", "2029-01-01", "示例行，导入前请删除",
	}
	for i, v := range example {
		cell, _ := excelize.CoordinatesToCellName(i+1, 2)
		_ = f.SetCellValue(sheet, cell, v)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// parseCmdbImport 解析模板：按表头名定位列，不依赖列顺序。
func parseCmdbImport(r io.Reader) ([]map[string]string, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("无法读取 Excel 文件: %w", err)
	}
	defer f.Close()

	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return nil, fmt.Errorf("文件里没有工作表")
	}
	rows, err := f.GetRows(sheets[0])
	if err != nil {
		return nil, err
	}
	if len(rows) < 2 {
		return nil, fmt.Errorf("文件没有数据行")
	}

	header := rows[0]
	colIndex := map[string]int{}
	for i, h := range header {
		colIndex[strings.TrimSpace(h)] = i
	}
	if _, ok := colIndex["资产名称"]; !ok {
		return nil, fmt.Errorf("表头缺少「资产名称」列，请使用下载的模板填写")
	}

	out := []map[string]string{}
	for r := 1; r < len(rows); r++ {
		row := rows[r]
		item := map[string]string{}
		empty := true
		for _, col := range cmdbImportColumns {
			idx, ok := colIndex[col]
			v := ""
			if ok && idx < len(row) {
				v = strings.TrimSpace(row[idx])
			}
			item[col] = v
			if v != "" {
				empty = false
			}
		}
		if empty {
			continue
		}
		item["__row"] = fmt.Sprint(r + 1)
		out = append(out, item)
	}
	return out, nil
}

func (s *Store) cmdbNameToID(kind string) (map[string]int64, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.cmdbNameToIDForProject(scope, kind)
}

// verifyCmdbImport 校验每一行，返回可写入的记录与逐行结果。
func (s *Store) verifyCmdbImport(parsed []map[string]string) (*CmdbImportResult, []*CmdbAsset, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, nil, err
	}
	return s.verifyCmdbImportForProject(scope, parsed)
}

// PreviewCmdbImport 只校验不写库。
func (s *Store) PreviewCmdbImport(r io.Reader) (*CmdbImportResult, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.PreviewCmdbImportForProject(scope, r)
}

// CommitCmdbImport 校验并写入（作为 CMDB 手工登记记录）。
func (s *Store) CommitCmdbImport(r io.Reader) (*CmdbImportResult, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.CommitCmdbImportForProject(scope, r)
}
