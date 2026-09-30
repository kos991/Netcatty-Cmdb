package store

import (
	"fmt"
	"io"
	"strings"
)

func (s *Store) AllCmdbAssetsForProject(scope ProjectScope, q CmdbAssetQuery) ([]CmdbAsset, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	where, args := s.buildCmdbWhereForProject(scope, q)
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

func (s *Store) CmdbAssetFilterOptionsForProject(scope ProjectScope) (map[string][]string, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	out := map[string][]string{}
	query := func(col string) ([]string, error) {
		rows, err := s.db.Query(`SELECT DISTINCT IFNULL(`+col+`,'') FROM cmdb_assets
			WHERE project_id=? AND IFNULL(`+col+`,'') <> '' ORDER BY `+col, scope.ProjectID)
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
	where, args := s.buildCmdbWhereForProject(scope, CmdbAssetQuery{ResourceScope: "infrastructure"})
	rows, err := s.db.Query(`SELECT DISTINCT IFNULL(a.device_type,'') FROM cmdb_assets a`+where+`
		AND IFNULL(a.device_type,'') <> '' ORDER BY a.device_type`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	deviceTypes := []string{}
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		deviceTypes = append(deviceTypes, value)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out["device_type"] = deviceTypes
	return out, nil
}

func (s *Store) cmdbNameToIDForProject(scope ProjectScope, kind string) (map[string]int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	list, err := s.ListCmdbTaxonomyForProject(scope, kind)
	if err != nil {
		return nil, err
	}
	m := make(map[string]int64, len(list))
	for _, n := range list {
		m[n.Name] = n.ID
	}
	return m, nil
}

func (s *Store) verifyCmdbImportForProject(scope ProjectScope, parsed []map[string]string) (*CmdbImportResult, []*CmdbAsset, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, nil, err
	}
	orgs, err := s.cmdbNameToIDForProject(scope, "orgs")
	if err != nil {
		return nil, nil, err
	}
	groups, err := s.cmdbNameToIDForProject(scope, "groups")
	if err != nil {
		return nil, nil, err
	}
	cats, err := s.cmdbNameToIDForProject(scope, "categories")
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

func (s *Store) PreviewCmdbImportForProject(scope ProjectScope, r io.Reader) (*CmdbImportResult, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	parsed, err := parseCmdbImport(r)
	if err != nil {
		return nil, err
	}
	res, _, err := s.verifyCmdbImportForProject(scope, parsed)
	return res, err
}

func (s *Store) CommitCmdbImportForProject(scope ProjectScope, r io.Reader) (*CmdbImportResult, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	parsed, err := parseCmdbImport(r)
	if err != nil {
		return nil, err
	}
	res, items, err := s.verifyCmdbImportForProject(scope, parsed)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if _, err := s.CreateCmdbAssetManualForProject(scope, item); err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("「%s」写入失败：%v", item.Name, err))
			continue
		}
		res.Created++
	}
	return res, nil
}
