package store

import (
	"fmt"
	"strings"
	"time"
)

func (s *Store) ListCmdbTaxonomyForProject(scope ProjectScope, kind string) ([]CmdbTaxonomyNode, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	spec, err := cmdbTaxonomySpec(kind)
	if err != nil {
		return nil, err
	}
	q := fmt.Sprintf(`SELECT t.id, t.project_id, IFNULL(t.sync_id,''), t.name, t.parent_id, t.sort_order,
		(SELECT COUNT(*) FROM cmdb_assets a WHERE a.project_id = ? AND a.%s = t.id),
		(SELECT COUNT(*) FROM %s c WHERE c.project_id = ? AND c.parent_id = t.id)
		FROM %s t WHERE t.project_id = ? ORDER BY t.sort_order, t.id`, spec.FK, spec.Table, spec.Table)
	rows, err := s.db.Query(q, scope.ProjectID, scope.ProjectID, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]CmdbTaxonomyNode, 0, 16)
	for rows.Next() {
		var n CmdbTaxonomyNode
		if err := rows.Scan(&n.ID, &n.ProjectID, &n.SyncID, &n.Name, &n.ParentID, &n.SortOrder, &n.AssetCount, &n.ChildCount); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *Store) CreateCmdbTaxonomyForProject(scope ProjectScope, kind, name string, parentID, sortOrder int64) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	spec, err := cmdbTaxonomySpec(kind)
	if err != nil {
		return 0, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return 0, fmt.Errorf("%s名称不能为空", spec.Label)
	}
	if parentID < 0 {
		parentID = 0
	}
	if parentID > 0 {
		var cnt int
		if err := s.db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE id = ? AND project_id = ?`, spec.Table), parentID, scope.ProjectID).Scan(&cnt); err != nil {
			return 0, err
		}
		if cnt == 0 {
			return 0, fmt.Errorf("上级节点不属于当前项目")
		}
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	q := fmt.Sprintf(`INSERT INTO %s (project_id, name, parent_id, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)`, spec.Table)
	res, err := s.db.Exec(q, scope.ProjectID, name, parentID, sortOrder, now, now)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return 0, fmt.Errorf("同级下已存在同名%s", spec.Label)
		}
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) cmdbTaxonomyDescendantsForProject(scope ProjectScope, table string, id int64) ([]int64, error) {
	var out []int64
	frontier := []int64{id}
	for len(frontier) > 0 {
		var next []int64
		for _, parentID := range frontier {
			rows, err := s.db.Query(fmt.Sprintf(`SELECT id FROM %s WHERE parent_id=? AND project_id=?`, table), parentID, scope.ProjectID)
			if err != nil {
				return nil, err
			}
			for rows.Next() {
				var childID int64
				if err := rows.Scan(&childID); err != nil {
					rows.Close()
					return nil, err
				}
				out = append(out, childID)
				next = append(next, childID)
			}
			if err := rows.Close(); err != nil {
				return nil, err
			}
			if err := rows.Err(); err != nil {
				return nil, err
			}
		}
		frontier = next
	}
	return out, nil
}

func (s *Store) UpdateCmdbTaxonomyForProject(scope ProjectScope, kind string, id int64, name string, parentID, sortOrder int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	spec, err := cmdbTaxonomySpec(kind)
	if err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("%s名称不能为空", spec.Label)
	}
	if parentID < 0 {
		parentID = 0
	}
	if parentID == id {
		return fmt.Errorf("上级不能是自己")
	}
	var exists int
	if err := s.db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE id=? AND project_id=?`, spec.Table), id, scope.ProjectID).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return fmt.Errorf("%s不属于当前项目: %w", spec.Label, ErrProjectScopedNotFound)
	}
	if parentID > 0 {
		if err := s.db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE id=? AND project_id=?`, spec.Table), parentID, scope.ProjectID).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			return fmt.Errorf("上级节点不属于当前项目: %w", ErrProjectScopedNotFound)
		}
		descendants, err := s.cmdbTaxonomyDescendantsForProject(scope, spec.Table, id)
		if err != nil {
			return err
		}
		for _, descendantID := range descendants {
			if descendantID == parentID {
				return fmt.Errorf("上级不能是自己的下级节点")
			}
		}
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := s.db.Exec(fmt.Sprintf(`UPDATE %s SET name=?, parent_id=?, sort_order=?, updated_at=? WHERE id=? AND project_id=?`, spec.Table), name, parentID, sortOrder, now, id, scope.ProjectID)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return fmt.Errorf("同级下已存在同名%s", spec.Label)
		}
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("%s不属于当前项目: %w", spec.Label, ErrProjectScopedNotFound)
	}
	return nil
}

func (s *Store) DeleteCmdbTaxonomyForProject(scope ProjectScope, kind string, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	spec, err := cmdbTaxonomySpec(kind)
	if err != nil {
		return err
	}
	var childCount int
	if err := s.db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE parent_id=? AND project_id=?`, spec.Table), id, scope.ProjectID).Scan(&childCount); err != nil {
		return err
	}
	if childCount > 0 {
		return fmt.Errorf("该%s下还有 %d 个子节点，请先处理子节点", spec.Label, childCount)
	}
	var assetCount int
	if err := s.db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) FROM cmdb_assets WHERE %s=? AND project_id=?`, spec.FK), id, scope.ProjectID).Scan(&assetCount); err != nil {
		return err
	}
	if assetCount > 0 {
		return fmt.Errorf("该%s已被 %d 台资产引用，请先调整这些资产的归属", spec.Label, assetCount)
	}
	res, err := s.db.Exec(fmt.Sprintf(`DELETE FROM %s WHERE id=? AND project_id=?`, spec.Table), id, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("%s不属于当前项目: %w", spec.Label, ErrProjectScopedNotFound)
	}
	return nil
}

func (s *Store) QueryCmdbModelsForProject(scope ProjectScope, keyword string, page, pageSize int) ([]CmdbDeviceModel, int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, 0, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 10
	}
	clause := " WHERE project_id = ?"
	args := []interface{}{scope.ProjectID}
	if kw := strings.TrimSpace(keyword); kw != "" {
		pat := "%" + kw + "%"
		clause += " AND (IFNULL(vendor,'') LIKE ? OR IFNULL(model,'') LIKE ?)"
		args = append(args, pat, pat)
	}
	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM cmdb_device_models"+clause, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(`SELECT id, project_id, IFNULL(sync_id,''), IFNULL(vendor,''), IFNULL(model,''), height_u,
		rated_power_w, max_power_w, IFNULL(weight_kg,0), depth_mm FROM cmdb_device_models`+
		clause+` ORDER BY IFNULL(vendor,''), IFNULL(model,''), id LIMIT ? OFFSET ?`,
		append(append([]interface{}{}, args...), pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]CmdbDeviceModel, 0, pageSize)
	for rows.Next() {
		var v CmdbDeviceModel
		if err := rows.Scan(&v.ID, &v.ProjectID, &v.SyncID, &v.Vendor, &v.Model, &v.HeightU, &v.RatedPowerW, &v.MaxPowerW, &v.WeightKG, &v.DepthMM); err != nil {
			return nil, 0, err
		}
		out = append(out, v)
	}
	return out, total, rows.Err()
}

func (s *Store) CreateCmdbModelForProject(scope ProjectScope, m *CmdbDeviceModel) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if strings.TrimSpace(m.Model) == "" {
		return 0, fmt.Errorf("型号不能为空")
	}
	if m.HeightU <= 0 {
		m.HeightU = 1
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := s.db.Exec(`INSERT INTO cmdb_device_models
		(project_id, vendor, model, height_u, rated_power_w, max_power_w, weight_kg, depth_mm, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?)`,
		scope.ProjectID, m.Vendor, m.Model, m.HeightU, m.RatedPowerW, m.MaxPowerW, m.WeightKG, m.DepthMM, now, now)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return 0, fmt.Errorf("厂商 + 型号已存在")
		}
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	m.ID = id
	m.ProjectID = scope.ProjectID
	if err := s.db.QueryRow(`SELECT sync_id FROM cmdb_device_models WHERE id=? AND project_id=?`, id, scope.ProjectID).Scan(&m.SyncID); err != nil {
		return id, err
	}
	return id, nil
}

func (s *Store) listCmdbTaxonomyMetaForProject(scope ProjectScope, table string, scan func(interface{ Scan(...interface{}) error }) error) error {
	rows, err := s.db.Query(fmt.Sprintf(`SELECT id, project_id, IFNULL(sync_id,''), name, parent_id, sort_order FROM %s WHERE project_id=? ORDER BY sort_order,id`, table), scope.ProjectID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := scan(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}

func (s *Store) ListCmdbOrgsForProject(scope ProjectScope) ([]CmdbOrg, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	out := make([]CmdbOrg, 0, 16)
	err := s.listCmdbTaxonomyMetaForProject(scope, "cmdb_orgs", func(row interface{ Scan(...interface{}) error }) error {
		var v CmdbOrg
		if err := row.Scan(&v.ID, &v.ProjectID, &v.SyncID, &v.Name, &v.ParentID, &v.SortOrder); err != nil {
			return err
		}
		out = append(out, v)
		return nil
	})
	return out, err
}

func (s *Store) ListCmdbGroupsForProject(scope ProjectScope) ([]CmdbGroup, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	out := make([]CmdbGroup, 0, 16)
	err := s.listCmdbTaxonomyMetaForProject(scope, "cmdb_groups", func(row interface{ Scan(...interface{}) error }) error {
		var v CmdbGroup
		if err := row.Scan(&v.ID, &v.ProjectID, &v.SyncID, &v.Name, &v.ParentID, &v.SortOrder); err != nil {
			return err
		}
		out = append(out, v)
		return nil
	})
	return out, err
}

func (s *Store) ListCmdbCategoriesForProject(scope ProjectScope) ([]CmdbCategory, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	out := make([]CmdbCategory, 0, 16)
	err := s.listCmdbTaxonomyMetaForProject(scope, "cmdb_device_categories", func(row interface{ Scan(...interface{}) error }) error {
		var v CmdbCategory
		if err := row.Scan(&v.ID, &v.ProjectID, &v.SyncID, &v.Name, &v.ParentID, &v.SortOrder); err != nil {
			return err
		}
		out = append(out, v)
		return nil
	})
	return out, err
}

func (s *Store) ListCmdbModelsForProject(scope ProjectScope) ([]CmdbDeviceModel, error) {
	rows, _, err := s.QueryCmdbModelsForProject(scope, "", 1, 500)
	return rows, err
}

func (s *Store) SeedCmdbOrgsFromDepartmentsForProject(scope ProjectScope, departments []string) (int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	added := 0
	for idx, name := range departments {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		res, err := s.db.Exec(`INSERT OR IGNORE INTO cmdb_orgs(project_id,name,parent_id,sort_order,created_at,updated_at) VALUES(?,?,0,?,?,?)`, scope.ProjectID, name, idx, now, now)
		if err != nil {
			return added, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			added++
		}
	}
	return added, nil
}

func (s *Store) UpdateCmdbModelForProject(scope ProjectScope, m *CmdbDeviceModel) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	if strings.TrimSpace(m.Model) == "" {
		return fmt.Errorf("型号不能为空")
	}
	if m.HeightU <= 0 {
		m.HeightU = 1
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := s.db.Exec(`UPDATE cmdb_device_models SET vendor=?,model=?,height_u=?,rated_power_w=?,max_power_w=?,weight_kg=?,depth_mm=?,updated_at=? WHERE id=? AND project_id=?`, m.Vendor, m.Model, m.HeightU, m.RatedPowerW, m.MaxPowerW, m.WeightKG, m.DepthMM, now, m.ID, scope.ProjectID)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return fmt.Errorf("厂商 + 型号已存在")
		}
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("设备型号不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	return nil
}

func (s *Store) DeleteCmdbModelForProject(scope ProjectScope, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	var refs int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_assets WHERE model_id=? AND project_id=?`, id, scope.ProjectID).Scan(&refs); err != nil {
		return err
	}
	if refs > 0 {
		return fmt.Errorf("该设备型号已被 %d 台资产引用", refs)
	}
	res, err := s.db.Exec(`DELETE FROM cmdb_device_models WHERE id=? AND project_id=?`, id, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("设备型号不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	return nil
}
