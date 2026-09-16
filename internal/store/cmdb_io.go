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
	where, args := s.buildCmdbWhere(q)
	orderCol, ok := cmdbSortWhitelist[q.SortBy]
	if !ok {
		orderCol = "a.id"
	}
	dir := "ASC"
	if strings.EqualFold(q.SortOrder, "desc") {
		dir = "DESC"
	}
	rows, err := s.db.Query(cmdbAssetSelect+where+fmt.Sprintf(" ORDER BY %s %s", orderCol, dir), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CmdbAsset{}
	for rows.Next() {
		item, err := scanCmdbAsset(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// CmdbAssetFilterOptions 返回列头筛选的可选值（取自真实数据）。
func (s *Store) CmdbAssetFilterOptions() (map[string][]string, error) {
	out := map[string][]string{}
	query := func(col string) ([]string, error) {
		rows, err := s.db.Query(`SELECT DISTINCT IFNULL(` + col + `,'') FROM cmdb_assets
			WHERE IFNULL(` + col + `,'') <> '' ORDER BY ` + col)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		vals := []string{}
		for rows.Next() {
			var v string
			if err := rows.Scan(&v); err != nil {
				return nil, err
			}
			vals = append(vals, v)
		}
		return vals, rows.Err()
	}
	for key, col := range map[string]string{
		"os_type":    "os_type",
		"os_version": "os_version",
		"vendor":     "vendor",
	} {
		vals, err := query(col)
		if err != nil {
			return nil, err
		}
		out[key] = vals
	}
	return out, nil
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
	Total   int              `json:"total"`
	Valid   int              `json:"valid"`
	Created int              `json:"created"`
	Rows    []CmdbImportRow  `json:"rows"`
	Errors  []string         `json:"errors"`
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
	list, err := s.ListCmdbTaxonomy(kind)
	if err != nil {
		return nil, err
	}
	m := make(map[string]int64, len(list))
	for _, n := range list {
		m[n.Name] = n.ID
	}
	return m, nil
}

// verifyCmdbImport 校验每一行，返回可写入的记录与逐行结果。
func (s *Store) verifyCmdbImport(parsed []map[string]string) (*CmdbImportResult, []*CmdbAsset, error) {
	orgs, err := s.cmdbNameToID("orgs")
	if err != nil {
		return nil, nil, err
	}
	groups, err := s.cmdbNameToID("groups")
	if err != nil {
		return nil, nil, err
	}
	cats, err := s.cmdbNameToID("categories")
	if err != nil {
		return nil, nil, err
	}

	res := &CmdbImportResult{Total: len(parsed), Rows: []CmdbImportRow{}, Errors: []string{}}
	items := []*CmdbAsset{}

	for _, row := range parsed {
		rowNo := 0
		fmt.Sscanf(row["__row"], "%d", &rowNo)
		name := row["资产名称"]
		out := CmdbImportRow{Row: rowNo, Name: name, AssetCode: row["资产编号"],
			CategoryName: row["设备分类"], OrgName: row["所属组织"], GroupName: row["所属分组"]}

		if name == "" {
			out.Message = "资产名称不能为空"
			res.Rows = append(res.Rows, out)
			continue
		}
		var warnings []string
		catID := int64(0)
		if v := row["设备分类"]; v != "" {
			if id, ok := cats[v]; ok {
				catID = id
			} else {
				warnings = append(warnings, fmt.Sprintf("设备分类「%s」不存在，已留空", v))
			}
		}
		orgID := int64(0)
		if v := row["所属组织"]; v != "" {
			if id, ok := orgs[v]; ok {
				orgID = id
			} else {
				warnings = append(warnings, fmt.Sprintf("所属组织「%s」不存在，已留空", v))
			}
		}
		groupID := int64(0)
		if v := row["所属分组"]; v != "" {
			if id, ok := groups[v]; ok {
				groupID = id
			} else {
				warnings = append(warnings, fmt.Sprintf("所属分组「%s」不存在，已留空", v))
			}
		}

		status := row["状态"]
		if status == "" {
			status = "在库"
		}
		items = append(items, &CmdbAsset{
			Name: name, AssetCode: row["资产编号"], Status: status,
			CategoryID: catID, OrgID: orgID, GroupID: groupID,
			SN: row["序列号"], Vendor: row["厂商"], Model: row["型号"],
			Department: row["部门"], Owner: row["负责人"],
			MgmtIP: row["管理IP"], MAC: row["MAC地址"],
			OSType: row["操作系统类型"], OSVersion: row["操作系统版本"],
			InstallDate: row["安装日期"], WarrantyDate: row["保修到期"], Remark: row["备注"],
			AssetClass: "physical", SourceType: "manual",
		})
		out.Valid = true
		out.Message = strings.Join(warnings, "；")
		res.Rows = append(res.Rows, out)
		res.Valid++
	}
	return res, items, nil
}

// PreviewCmdbImport 只校验不写库。
func (s *Store) PreviewCmdbImport(r io.Reader) (*CmdbImportResult, error) {
	parsed, err := parseCmdbImport(r)
	if err != nil {
		return nil, err
	}
	res, _, err := s.verifyCmdbImport(parsed)
	return res, err
}

// CommitCmdbImport 校验并写入（作为 CMDB 手工登记记录）。
func (s *Store) CommitCmdbImport(r io.Reader) (*CmdbImportResult, error) {
	parsed, err := parseCmdbImport(r)
	if err != nil {
		return nil, err
	}
	res, items, err := s.verifyCmdbImport(parsed)
	if err != nil {
		return nil, err
	}
	for _, it := range items {
		if _, err := s.InsertCmdbAsset(it); err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("「%s」写入失败：%v", it.Name, err))
			continue
		}
		res.Created++
	}
	return res, nil
}
