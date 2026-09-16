package store

import (
	"fmt"
	"strings"
	"time"
)

// 组织 / 分组 / 设备分类 三个维度共用一套增删改查。
// 通过白名单映射到具体表与被资产引用的外键列，避免把外部输入拼进 SQL。
var cmdbTaxonomyTables = map[string]struct {
	Table string // 维度表名
	FK    string // cmdb_assets 上引用该维度的外键列
	Label string // 中文名，用于错误提示
}{
	"orgs":       {"cmdb_orgs", "org_id", "组织"},
	"groups":     {"cmdb_groups", "group_id", "分组"},
	"categories": {"cmdb_device_categories", "category_id", "设备分类"},
}

// CmdbTaxonomyNode 是三个维度通用的节点结构。
type CmdbTaxonomyNode struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	ParentID   int64  `json:"parent_id"`
	SortOrder  int64  `json:"sort_order"`
	AssetCount int    `json:"asset_count"` // 被资产引用数，删除前据此判断
	ChildCount int    `json:"child_count"` // 子节点数
}

func cmdbTaxonomySpec(kind string) (struct {
	Table string
	FK    string
	Label string
}, error) {
	spec, ok := cmdbTaxonomyTables[kind]
	if !ok {
		return spec, fmt.Errorf("未知的分类维度: %s", kind)
	}
	return spec, nil
}

// ListCmdbTaxonomy 返回某维度的全部节点（含被引用数与子节点数），按 sort_order, id 排序。
func (s *Store) ListCmdbTaxonomy(kind string) ([]CmdbTaxonomyNode, error) {
	spec, err := cmdbTaxonomySpec(kind)
	if err != nil {
		return nil, err
	}
	q := fmt.Sprintf(`SELECT t.id, t.name, t.parent_id, t.sort_order,
		(SELECT COUNT(*) FROM cmdb_assets a WHERE a.%s = t.id),
		(SELECT COUNT(*) FROM %s c WHERE c.parent_id = t.id)
		FROM %s t ORDER BY t.sort_order, t.id`, spec.FK, spec.Table, spec.Table)

	rows, err := s.db.Query(q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]CmdbTaxonomyNode, 0, 16)
	for rows.Next() {
		var n CmdbTaxonomyNode
		if err := rows.Scan(&n.ID, &n.Name, &n.ParentID, &n.SortOrder, &n.AssetCount, &n.ChildCount); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// CreateCmdbTaxonomy 新增一个分类节点。
func (s *Store) CreateCmdbTaxonomy(kind, name string, parentID, sortOrder int64) (int64, error) {
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
	// 上级节点必须存在（0 表示顶级）
	if parentID > 0 {
		var cnt int
		if err := s.db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE id = ?`, spec.Table), parentID).Scan(&cnt); err != nil {
			return 0, err
		}
		if cnt == 0 {
			return 0, fmt.Errorf("上级节点不存在")
		}
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	q := fmt.Sprintf(`INSERT INTO %s (name, parent_id, sort_order, created_at, updated_at)
		VALUES (?,?,?,?,?)`, spec.Table)
	res, err := s.db.Exec(q, name, parentID, sortOrder, now, now)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return 0, fmt.Errorf("同级下已存在同名%s", spec.Label)
		}
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateCmdbTaxonomy 重命名 / 调整上级与排序。
func (s *Store) UpdateCmdbTaxonomy(kind string, id int64, name string, parentID, sortOrder int64) error {
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
	// 不允许把节点挂到自己或自己的子孙下，避免成环
	if parentID == id {
		return fmt.Errorf("上级不能是自己")
	}
	if parentID > 0 {
		descendants, err := s.cmdbTaxonomyDescendants(spec.Table, id)
		if err != nil {
			return err
		}
		for _, d := range descendants {
			if d == parentID {
				return fmt.Errorf("上级不能是自己的下级节点")
			}
		}
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	q := fmt.Sprintf(`UPDATE %s SET name=?, parent_id=?, sort_order=?, updated_at=? WHERE id=?`, spec.Table)
	_, err = s.db.Exec(q, name, parentID, sortOrder, now, id)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return fmt.Errorf("同级下已存在同名%s", spec.Label)
	}
	return err
}

// cmdbTaxonomyDescendants 返回某节点的全部后代 ID（用于防成环）。
func (s *Store) cmdbTaxonomyDescendants(table string, id int64) ([]int64, error) {
	var out []int64
	frontier := []int64{id}
	for len(frontier) > 0 {
		var next []int64
		for _, pid := range frontier {
			rows, err := s.db.Query(fmt.Sprintf(`SELECT id FROM %s WHERE parent_id = ?`, table), pid)
			if err != nil {
				return nil, err
			}
			for rows.Next() {
				var cid int64
				if err := rows.Scan(&cid); err != nil {
					rows.Close()
					return nil, err
				}
				out = append(out, cid)
				next = append(next, cid)
			}
			rows.Close()
		}
		frontier = next
	}
	return out, nil
}

// DeleteCmdbTaxonomy 删除节点。有子节点或已被资产引用时拒绝删除并说明原因，
// 避免把资产的维度关联变成悬空引用。
func (s *Store) DeleteCmdbTaxonomy(kind string, id int64) error {
	spec, err := cmdbTaxonomySpec(kind)
	if err != nil {
		return err
	}

	var childCount int
	if err := s.db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE parent_id = ?`, spec.Table), id).Scan(&childCount); err != nil {
		return err
	}
	if childCount > 0 {
		return fmt.Errorf("该%s下还有 %d 个子节点，请先处理子节点", spec.Label, childCount)
	}

	var assetCount int
	if err := s.db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) FROM cmdb_assets WHERE %s = ?`, spec.FK), id).Scan(&assetCount); err != nil {
		return err
	}
	if assetCount > 0 {
		return fmt.Errorf("该%s已被 %d 台资产引用，请先调整这些资产的归属", spec.Label, assetCount)
	}

	res, err := s.db.Exec(fmt.Sprintf(`DELETE FROM %s WHERE id = ?`, spec.Table), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("%s不存在", spec.Label)
	}
	return nil
}
