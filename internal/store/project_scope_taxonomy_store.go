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
	var rows interface {
		Next() bool
		Scan(...interface{}) error
		Close() error
		Err() error
	}
	if spec.AssetScope != "" {
		usageSQL := `(SELECT COUNT(*) FROM cmdb_assets a WHERE a.project_id=? AND a.category_id=t.id)`
		switch spec.AssetScope {
		case "terminal":
			usageSQL = `(SELECT COUNT(*) FROM assets a WHERE a.project_id=? AND a.device_type=t.name)`
		case "application":
			usageSQL = `(SELECT COUNT(*) FROM server_apps a WHERE a.project_id=? AND a.app_type=t.name)`
		}
		q := fmt.Sprintf(`SELECT t.id, t.project_id, IFNULL(t.sync_id,''), t.name, t.parent_id, t.sort_order,
			%s,
			(SELECT COUNT(*) FROM %s c WHERE c.project_id=? AND c.asset_scope=? AND c.parent_id=t.id)
			FROM %s t WHERE t.project_id=? AND t.asset_scope=? ORDER BY t.sort_order,t.id`, usageSQL, spec.Table, spec.Table)
		rows, err = s.db.Query(q, scope.ProjectID, scope.ProjectID, spec.AssetScope, scope.ProjectID, spec.AssetScope)
	} else {
		usageSQL := fmt.Sprintf(`(SELECT COUNT(*) FROM cmdb_assets a WHERE a.project_id=? AND a.%s=t.id)`, spec.FK)
		if kind == "groups" {
			usageSQL = `((SELECT COUNT(*) FROM cmdb_assets a WHERE a.project_id=? AND a.group_id=t.id)
				+(SELECT COUNT(*) FROM assets a WHERE a.project_id=? AND a.group_id=t.id)
				+(SELECT COUNT(*) FROM server_apps a WHERE a.project_id=? AND a.group_id=t.id))`
		}
		q := fmt.Sprintf(`SELECT t.id, t.project_id, IFNULL(t.sync_id,''), t.name, t.parent_id, t.sort_order,
			%s,
			(SELECT COUNT(*) FROM %s c WHERE c.project_id=? AND c.parent_id=t.id)
			FROM %s t WHERE t.project_id=? ORDER BY t.sort_order,t.id`, usageSQL, spec.Table, spec.Table)
		if kind == "groups" {
			rows, err = s.db.Query(q, scope.ProjectID, scope.ProjectID, scope.ProjectID, scope.ProjectID, scope.ProjectID)
		} else {
			rows, err = s.db.Query(q, scope.ProjectID, scope.ProjectID, scope.ProjectID)
		}
	}
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
		q := fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE id=? AND project_id=?`, spec.Table)
		args := []interface{}{parentID, scope.ProjectID}
		if spec.AssetScope != "" {
			q += " AND asset_scope=?"
			args = append(args, spec.AssetScope)
		}
		if err := s.db.QueryRow(q, args...).Scan(&cnt); err != nil {
			return 0, err
		}
		if cnt == 0 {
			return 0, fmt.Errorf("上级节点不属于当前项目")
		}
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	q := fmt.Sprintf(`INSERT INTO %s (project_id,name,parent_id,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)`, spec.Table)
	args := []interface{}{scope.ProjectID, name, parentID, sortOrder, now, now}
	if spec.AssetScope != "" {
		q = fmt.Sprintf(`INSERT INTO %s (project_id,name,asset_scope,parent_id,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, spec.Table)
		args = []interface{}{scope.ProjectID, name, spec.AssetScope, parentID, sortOrder, now, now}
	}
	res, err := s.db.Exec(q, args...)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return 0, fmt.Errorf("同级下已存在同名%s", spec.Label)
		}
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) cmdbTaxonomyDescendantsForProject(scope ProjectScope, spec cmdbTaxonomyTableSpec, id int64) ([]int64, error) {
	var out []int64
	frontier := []int64{id}
	for len(frontier) > 0 {
		var next []int64
		for _, parentID := range frontier {
			q := fmt.Sprintf(`SELECT id FROM %s WHERE parent_id=? AND project_id=?`, spec.Table)
			args := []interface{}{parentID, scope.ProjectID}
			if spec.AssetScope != "" {
				q += " AND asset_scope=?"
				args = append(args, spec.AssetScope)
			}
			rows, err := s.db.Query(q, args...)
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
	var oldName string
	q := fmt.Sprintf(`SELECT name FROM %s WHERE id=? AND project_id=?`, spec.Table)
	args := []interface{}{id, scope.ProjectID}
	if spec.AssetScope != "" {
		q += " AND asset_scope=?"
		args = append(args, spec.AssetScope)
	}
	if err := s.db.QueryRow(q, args...).Scan(&oldName); err != nil {
		return fmt.Errorf("%s不属于当前项目: %w", spec.Label, ErrProjectScopedNotFound)
	}
	var exists int
	if parentID > 0 {
		parentQuery := fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE id=? AND project_id=?`, spec.Table)
		parentArgs := []interface{}{parentID, scope.ProjectID}
		if spec.AssetScope != "" {
			parentQuery += " AND asset_scope=?"
			parentArgs = append(parentArgs, spec.AssetScope)
		}
		if err := s.db.QueryRow(parentQuery, parentArgs...).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			return fmt.Errorf("上级节点不属于当前项目: %w", ErrProjectScopedNotFound)
		}
		descendants, err := s.cmdbTaxonomyDescendantsForProject(scope, spec, id)
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
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	updateQuery := fmt.Sprintf(`UPDATE %s SET name=?,parent_id=?,sort_order=?,updated_at=? WHERE id=? AND project_id=?`, spec.Table)
	updateArgs := []interface{}{name, parentID, sortOrder, now, id, scope.ProjectID}
	if spec.AssetScope != "" {
		updateQuery += " AND asset_scope=?"
		updateArgs = append(updateArgs, spec.AssetScope)
	}
	res, err := tx.Exec(updateQuery, updateArgs...)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return fmt.Errorf("同级下已存在同名%s", spec.Label)
		}
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("%s不属于当前项目: %w", spec.Label, ErrProjectScopedNotFound)
	}
	if oldName != name {
		switch spec.AssetScope {
		case "terminal":
			if _, err := tx.Exec(`UPDATE assets SET device_type=?,updated_at=? WHERE project_id=? AND device_type=?`, name, now, scope.ProjectID, oldName); err != nil {
				return err
			}
		case "application":
			if _, err := tx.Exec(`UPDATE server_apps SET app_type=?,updated_at=? WHERE project_id=? AND app_type=?`, name, now, scope.ProjectID, oldName); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func (s *Store) DeleteCmdbTaxonomyForProject(scope ProjectScope, kind string, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	spec, err := cmdbTaxonomySpec(kind)
	if err != nil {
		return err
	}
	var nodeName string
	nodeQuery := fmt.Sprintf(`SELECT name FROM %s WHERE id=? AND project_id=?`, spec.Table)
	nodeArgs := []interface{}{id, scope.ProjectID}
	if spec.AssetScope != "" {
		nodeQuery += " AND asset_scope=?"
		nodeArgs = append(nodeArgs, spec.AssetScope)
	}
	if err := s.db.QueryRow(nodeQuery, nodeArgs...).Scan(&nodeName); err != nil {
		return fmt.Errorf("%s不属于当前项目: %w", spec.Label, ErrProjectScopedNotFound)
	}
	var childCount int
	childQuery := fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE parent_id=? AND project_id=?`, spec.Table)
	childArgs := []interface{}{id, scope.ProjectID}
	if spec.AssetScope != "" {
		childQuery += " AND asset_scope=?"
		childArgs = append(childArgs, spec.AssetScope)
	}
	if err := s.db.QueryRow(childQuery, childArgs...).Scan(&childCount); err != nil {
		return err
	}
	if childCount > 0 {
		return fmt.Errorf("该%s下还有 %d 个子节点，请先处理子节点", spec.Label, childCount)
	}
	var assetCount int
	usageQuery := fmt.Sprintf(`SELECT COUNT(*) FROM cmdb_assets WHERE %s=? AND project_id=?`, spec.FK)
	usageArgs := []interface{}{id, scope.ProjectID}
	if kind == "groups" {
		usageQuery = `SELECT
			(SELECT COUNT(*) FROM cmdb_assets WHERE group_id=? AND project_id=?)
			+(SELECT COUNT(*) FROM assets WHERE group_id=? AND project_id=?)
			+(SELECT COUNT(*) FROM server_apps WHERE group_id=? AND project_id=?)`
		usageArgs = []interface{}{id, scope.ProjectID, id, scope.ProjectID, id, scope.ProjectID}
	}
	switch spec.AssetScope {
	case "terminal":
		usageQuery = `SELECT COUNT(*) FROM assets WHERE project_id=? AND device_type=?`
		usageArgs = []interface{}{scope.ProjectID, nodeName}
	case "application":
		usageQuery = `SELECT COUNT(*) FROM server_apps WHERE project_id=? AND app_type=?`
		usageArgs = []interface{}{scope.ProjectID, nodeName}
	}
	if err := s.db.QueryRow(usageQuery, usageArgs...).Scan(&assetCount); err != nil {
		return err
	}
	if assetCount > 0 {
		return fmt.Errorf("该%s已被 %d 台资产引用，请先调整这些资产的归属", spec.Label, assetCount)
	}
	deleteQuery := fmt.Sprintf(`DELETE FROM %s WHERE id=? AND project_id=?`, spec.Table)
	deleteArgs := []interface{}{id, scope.ProjectID}
	if spec.AssetScope != "" {
		deleteQuery += " AND asset_scope=?"
		deleteArgs = append(deleteArgs, spec.AssetScope)
	}
	res, err := s.db.Exec(deleteQuery, deleteArgs...)
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
	rows, err := s.db.Query(`SELECT id,project_id,IFNULL(sync_id,''),name,parent_id,sort_order
		FROM cmdb_device_categories WHERE project_id=? AND asset_scope='infrastructure' ORDER BY sort_order,id`, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var v CmdbCategory
		if err := rows.Scan(&v.ID, &v.ProjectID, &v.SyncID, &v.Name, &v.ParentID, &v.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
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
