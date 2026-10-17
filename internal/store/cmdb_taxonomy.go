package store

import (
	"fmt"
)

// 组织 / 分组 / 设备分类 三个维度共用一套增删改查。
// 通过白名单映射到具体表与被资产引用的外键列，避免把外部输入拼进 SQL。
type cmdbTaxonomyTableSpec struct {
	Table      string // 维度表名
	FK         string // cmdb_assets 上引用该维度的外键列
	Label      string // 中文名，用于错误提示
	AssetScope string // 分类适用范围；非分类维度为空
}

var cmdbTaxonomyTables = map[string]cmdbTaxonomyTableSpec{
	"orgs":                      {Table: "cmdb_orgs", FK: "org_id", Label: "组织"},
	"groups":                    {Table: "cmdb_groups", FK: "group_id", Label: "资产分组"},
	"categories":                {Table: "cmdb_device_categories", FK: "category_id", Label: "基础设施分类", AssetScope: "infrastructure"},
	"infrastructure-categories": {Table: "cmdb_device_categories", FK: "category_id", Label: "基础设施分类", AssetScope: "infrastructure"},
	"terminal-categories":       {Table: "cmdb_device_categories", Label: "终端资产分类", AssetScope: "terminal"},
	"application-categories":    {Table: "cmdb_device_categories", Label: "业务系统分类", AssetScope: "application"},
}

// CmdbTaxonomyNode 是三个维度通用的节点结构。
type CmdbTaxonomyNode struct {
	ID         int64  `json:"id"`
	ProjectID  int64  `json:"project_id"`
	SyncID     string `json:"sync_id"`
	Name       string `json:"name"`
	ParentID   int64  `json:"parent_id"`
	SortOrder  int64  `json:"sort_order"`
	AssetCount int    `json:"asset_count"` // 被资产引用数，删除前据此判断
	ChildCount int    `json:"child_count"` // 子节点数
	ShortCode  string `json:"short_code"`  // 设备简称，用于终端自动命名（如 VDI）
}

func cmdbTaxonomySpec(kind string) (cmdbTaxonomyTableSpec, error) {
	spec, ok := cmdbTaxonomyTables[kind]
	if !ok {
		return spec, fmt.Errorf("未知的分类维度: %s", kind)
	}
	return spec, nil
}

// ListCmdbTaxonomy 返回某维度的全部节点（含被引用数与子节点数），按 sort_order, id 排序。
func (s *Store) ListCmdbTaxonomy(kind string) ([]CmdbTaxonomyNode, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.ListCmdbTaxonomyForProject(scope, kind)
}

// CreateCmdbTaxonomy 新增一个分类节点。
func (s *Store) CreateCmdbTaxonomy(kind, name string, parentID, sortOrder int64) (int64, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.CreateCmdbTaxonomyForProject(scope, kind, name, parentID, sortOrder)
}

// UpdateCmdbTaxonomy 重命名 / 调整上级与排序。
func (s *Store) UpdateCmdbTaxonomy(kind string, id int64, name string, parentID, sortOrder int64) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.UpdateCmdbTaxonomyForProject(scope, kind, id, name, parentID, sortOrder)
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
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.DeleteCmdbTaxonomyForProject(scope, kind, id)
}
