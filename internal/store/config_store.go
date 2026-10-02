package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	OrgNodeOrganization = "organization"
	OrgNodeDepartment   = "department"
	OrgNodeGroup        = "group"

	ConfigKindOrgNodes            = "org-nodes"
	ConfigKindDeviceTypes         = "device-types"
	ConfigKindSoftware            = "software"
	ConfigKindLocations           = "locations"
	ConfigKindStatuses            = "statuses"
	ConfigKindNetworkTypes        = "network-types"
	ConfigKindModels              = "models"
	ConfigKindWorkOrderCategories = "work-order-categories"
	ConfigKindWorkOrderTypes      = "work-order-types"
	ConfigKindWorkOrderPriorities = "work-order-priorities"
	ConfigKindWorkOrderRule       = "work-order-rule"
)

var ErrReferenced = errors.New("配置项已被引用")

type OrgNode struct {
	ID        int64     `json:"id"`
	ProjectID int64     `json:"project_id"`
	SyncID    string    `json:"sync_id"`
	ParentID  int64     `json:"parent_id"`
	NodeType  string    `json:"node_type"`
	Name      string    `json:"name"`
	SortOrder int64     `json:"sort_order"`
	Revision  int64     `json:"revision"`
	Children  []OrgNode `json:"children"`
}

type ConfigItem struct {
	ID          int64   `json:"id"`
	ProjectID   int64   `json:"project_id"`
	SyncID      string  `json:"sync_id"`
	Name        string  `json:"name"`
	ParentID    int64   `json:"parent_id"`
	NodeType    string  `json:"node_type"`
	Vendor      string  `json:"vendor"`
	Model       string  `json:"model"`
	Version     string  `json:"version"`
	Remark      string  `json:"remark"`
	SortOrder   int64   `json:"sort_order"`
	HeightU     int64   `json:"height_u"`
	RatedPowerW int64   `json:"rated_power_w"`
	MaxPowerW   int64   `json:"max_power_w"`
	WeightKG    float64 `json:"weight_kg"`
	DepthMM     int64   `json:"depth_mm"`
}

func (s *Store) ListOrgTree(scope ProjectScope) ([]OrgNode, error) {
	nodes, err := s.listOrgNodes(scope)
	if err != nil {
		return nil, err
	}
	byID := make(map[int64]OrgNode, len(nodes))
	children := make(map[int64][]int64, len(nodes))
	rootIDs := make([]int64, 0)
	for _, node := range nodes {
		node.Children = []OrgNode{}
		byID[node.ID] = node
		children[node.ParentID] = append(children[node.ParentID], node.ID)
		if node.ParentID == 0 {
			rootIDs = append(rootIDs, node.ID)
		}
	}
	var build func(int64) OrgNode
	build = func(id int64) OrgNode {
		node := byID[id]
		for _, childID := range children[id] {
			node.Children = append(node.Children, build(childID))
		}
		return node
	}
	tree := make([]OrgNode, 0, len(rootIDs))
	for _, id := range rootIDs {
		tree = append(tree, build(id))
	}
	return tree, nil
}

func (s *Store) listOrgNodes(scope ProjectScope) ([]OrgNode, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`
		SELECT id, project_id, IFNULL(sync_id,''), parent_id, node_type, name, sort_order, revision
		FROM cmdb_org_nodes
		WHERE project_id=? AND deleted_at IS NULL
		ORDER BY parent_id, sort_order, id
	`, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	nodes := make([]OrgNode, 0)
	for rows.Next() {
		var node OrgNode
		if err := rows.Scan(&node.ID, &node.ProjectID, &node.SyncID, &node.ParentID, &node.NodeType, &node.Name, &node.SortOrder, &node.Revision); err != nil {
			return nil, err
		}
		node.Children = []OrgNode{}
		nodes = append(nodes, node)
	}
	return nodes, rows.Err()
}

func (s *Store) CreateOrgNode(scope ProjectScope, node *OrgNode) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if node == nil {
		return 0, errors.New("组织节点不能为空")
	}
	node.Name = strings.TrimSpace(node.Name)
	if node.Name == "" {
		return 0, errors.New("组织节点名称不能为空")
	}
	if err := s.validateOrgNodeParent(scope, node.NodeType, node.ParentID, 0); err != nil {
		return 0, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`
		INSERT INTO cmdb_org_nodes(project_id, parent_id, node_type, name, sort_order, created_at, updated_at)
		VALUES(?,?,?,?,?,?,?)
	`, scope.ProjectID, node.ParentID, node.NodeType, node.Name, node.SortOrder, now, now)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return 0, errors.New("同级下已存在同名组织节点")
		}
		return 0, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	node.ID = id
	node.ProjectID = scope.ProjectID
	if err := s.db.QueryRow(`SELECT IFNULL(sync_id,''), revision FROM cmdb_org_nodes WHERE id=? AND project_id=?`, id, scope.ProjectID).Scan(&node.SyncID, &node.Revision); err != nil {
		return 0, err
	}
	return id, nil
}

func (s *Store) UpdateOrgNode(scope ProjectScope, node *OrgNode) error {
	if node == nil || node.ID <= 0 {
		return errors.New("缺少有效组织节点")
	}
	current, err := s.getOrgNode(scope, node.ID)
	if err != nil {
		return err
	}
	if node.NodeType != "" && node.NodeType != current.NodeType {
		return errors.New("组织节点类型不能修改")
	}
	node.NodeType = current.NodeType
	node.Name = strings.TrimSpace(node.Name)
	if node.Name == "" {
		return errors.New("组织节点名称不能为空")
	}
	if err := s.validateOrgNodeParent(scope, node.NodeType, node.ParentID, node.ID); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`
		UPDATE cmdb_org_nodes
		SET parent_id=?, name=?, sort_order=?, revision=revision+1, updated_at=?
		WHERE id=? AND project_id=? AND deleted_at IS NULL
	`, node.ParentID, node.Name, node.SortOrder, now, node.ID, scope.ProjectID)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return errors.New("同级下已存在同名组织节点")
		}
		return err
	}
	if err := requireConfigAffected(result, "组织节点不属于当前项目"); err != nil {
		return err
	}
	if current.Name != node.Name || current.ParentID != node.ParentID {
		if err := syncPersonOrgPath(tx, scope.ProjectID, node.ID, node.ParentID, node.NodeType, node.Name, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) MoveOrgNode(scope ProjectScope, id, parentID, sortOrder int64) error {
	node, err := s.getOrgNode(scope, id)
	if err != nil {
		return err
	}
	if err := s.validateOrgNodeParent(scope, node.NodeType, parentID, node.ID); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`
		UPDATE cmdb_org_nodes
		SET parent_id=?, sort_order=?, revision=revision+1, updated_at=?
		WHERE id=? AND project_id=? AND deleted_at IS NULL
	`, parentID, sortOrder, now, id, scope.ProjectID)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return errors.New("同级下已存在同名组织节点")
		}
		return err
	}
	if err := requireConfigAffected(result, "组织节点不属于当前项目"); err != nil {
		return err
	}

	if node.ParentID != parentID {
		if err := syncPersonOrgPath(tx, scope.ProjectID, node.ID, parentID, node.NodeType, node.Name, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func syncPersonOrgPath(tx *sql.Tx, projectID, nodeID, parentID int64, nodeType, nodeName, now string) error {
	readNode := func(id int64) (*OrgNode, error) {
		return scanOrgNode(tx.QueryRow(`
			SELECT id, project_id, IFNULL(sync_id,''), parent_id, node_type, name, sort_order, revision
			FROM cmdb_org_nodes WHERE id=? AND project_id=? AND deleted_at IS NULL
		`, id, projectID))
	}
	switch nodeType {
	case OrgNodeOrganization:
		_, err := tx.Exec(`
			UPDATE cmdb_persons
			SET org_name=?, revision=revision+1, updated_at=?
			WHERE project_id=? AND org_id=? AND deleted_at IS NULL
		`, nodeName, now, projectID, nodeID)
		return err
	case OrgNodeDepartment:
		org, err := readNode(parentID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(`
			UPDATE cmdb_persons
			SET org_id=?, org_name=?, department=?, revision=revision+1, updated_at=?
			WHERE project_id=? AND department_id=? AND deleted_at IS NULL
		`, org.ID, org.Name, nodeName, now, projectID, nodeID)
		return err
	case OrgNodeGroup:
		department, err := readNode(parentID)
		if err != nil {
			return err
		}
		org, err := readNode(department.ParentID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(`
			UPDATE cmdb_persons
			SET org_id=?, department_id=?, org_name=?, department=?, group_name=?, revision=revision+1, updated_at=?
			WHERE project_id=? AND group_id=? AND deleted_at IS NULL
		`, org.ID, department.ID, org.Name, department.Name, nodeName, now, projectID, nodeID)
		return err
	default:
		return fmt.Errorf("无效的组织节点类型: %s", nodeType)
	}
}

func (s *Store) DeleteOrgNode(scope ProjectScope, id int64) error {
	node, err := s.getOrgNode(scope, id)
	if err != nil {
		return err
	}
	var children int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_org_nodes WHERE project_id=? AND parent_id=? AND deleted_at IS NULL`, scope.ProjectID, id).Scan(&children); err != nil {
		return err
	}
	if children > 0 {
		return fmt.Errorf("组织节点下仍有 %d 个子节点: %w", children, ErrReferenced)
	}
	column := map[string]string{
		OrgNodeOrganization: "org_id",
		OrgNodeDepartment:   "department_id",
		OrgNodeGroup:        "group_id",
	}[node.NodeType]
	var references int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_persons WHERE project_id=? AND deleted_at IS NULL AND `+column+`=?`, scope.ProjectID, id).Scan(&references); err != nil {
		return err
	}
	if references > 0 {
		return fmt.Errorf("组织节点已被 %d 名人员引用: %w", references, ErrReferenced)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`
		UPDATE cmdb_org_nodes SET deleted_at=?, updated_at=?, revision=revision+1
		WHERE id=? AND project_id=? AND deleted_at IS NULL
	`, now, now, id, scope.ProjectID)
	if err != nil {
		return err
	}
	return requireConfigAffected(result, "组织节点不属于当前项目")
}

func (s *Store) getOrgNode(scope ProjectScope, id int64) (*OrgNode, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	return scanOrgNode(s.db.QueryRow(`
		SELECT id, project_id, IFNULL(sync_id,''), parent_id, node_type, name, sort_order, revision
		FROM cmdb_org_nodes WHERE id=? AND project_id=? AND deleted_at IS NULL
	`, id, scope.ProjectID))
}

func scanOrgNode(row *sql.Row) (*OrgNode, error) {
	var node OrgNode
	err := row.Scan(&node.ID, &node.ProjectID, &node.SyncID, &node.ParentID, &node.NodeType, &node.Name, &node.SortOrder, &node.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("组织节点不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	return &node, err
}

func (s *Store) validateOrgNodeParent(scope ProjectScope, nodeType string, parentID, currentID int64) error {
	expectedParent := map[string]string{
		OrgNodeOrganization: "",
		OrgNodeDepartment:   OrgNodeOrganization,
		OrgNodeGroup:        OrgNodeDepartment,
	}
	parentType, ok := expectedParent[nodeType]
	if !ok {
		return fmt.Errorf("无效的组织节点类型: %s", nodeType)
	}
	if nodeType == OrgNodeOrganization {
		if parentID != 0 {
			return errors.New("组织节点不能设置上级")
		}
		return nil
	}
	if parentID <= 0 || parentID == currentID {
		return errors.New("部门或分组必须选择有效上级")
	}
	parent, err := s.getOrgNode(scope, parentID)
	if err != nil {
		return err
	}
	if parent.NodeType != parentType {
		return fmt.Errorf("%s 的上级类型必须是 %s", nodeType, parentType)
	}
	return nil
}

func (s *Store) ListConfigItems(scope ProjectScope, kind string) ([]ConfigItem, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	switch kind {
	case ConfigKindOrgNodes:
		nodes, err := s.listOrgNodes(scope)
		if err != nil {
			return nil, err
		}
		items := make([]ConfigItem, 0, len(nodes))
		for _, node := range nodes {
			items = append(items, ConfigItem{ID: node.ID, ProjectID: node.ProjectID, SyncID: node.SyncID, Name: node.Name, ParentID: node.ParentID, NodeType: node.NodeType, SortOrder: node.SortOrder})
		}
		return items, nil
	case ConfigKindDeviceTypes:
		nodes, err := s.ListCmdbTaxonomyForProject(scope, "categories")
		if err != nil {
			return nil, err
		}
		items := make([]ConfigItem, 0, len(nodes))
		for _, node := range nodes {
			items = append(items, ConfigItem{ID: node.ID, ProjectID: node.ProjectID, SyncID: node.SyncID, Name: node.Name, ParentID: node.ParentID, SortOrder: node.SortOrder})
		}
		return items, nil
	case ConfigKindModels:
		models, _, err := s.QueryCmdbModelsForProject(scope, "", 1, 500)
		if err != nil {
			return nil, err
		}
		items := make([]ConfigItem, 0, len(models))
		for _, model := range models {
			items = append(items, configItemFromModel(model))
		}
		return items, nil
	case ConfigKindSoftware:
		return s.listFlatConfigItems(scope, "cmdb_software_catalog", true)
	case ConfigKindLocations:
		return s.listFlatConfigItems(scope, "cmdb_locations", false)
	case ConfigKindStatuses:
		return s.listFlatConfigItems(scope, "cmdb_statuses", false)
	case ConfigKindNetworkTypes:
		return s.listFlatConfigItems(scope, "cmdb_network_types", false)
	case ConfigKindWorkOrderCategories:
		return s.listFlatConfigItems(scope, "cmdb_work_order_categories", false)
	case ConfigKindWorkOrderTypes:
		return s.listFlatConfigItems(scope, "cmdb_work_order_types", false)
	case ConfigKindWorkOrderPriorities:
		return s.listFlatConfigItems(scope, "cmdb_work_order_priorities", false)
	case ConfigKindWorkOrderRule:
		return s.listFlatConfigItems(scope, "cmdb_work_order_rules", true)
	default:
		return nil, fmt.Errorf("不支持的配置类型: %s", kind)
	}
}

func (s *Store) CreateConfigItem(scope ProjectScope, kind string, item *ConfigItem) (int64, error) {
	if item == nil {
		return 0, errors.New("配置项不能为空")
	}
	switch kind {
	case ConfigKindOrgNodes:
		return s.CreateOrgNode(scope, &OrgNode{ParentID: item.ParentID, NodeType: item.NodeType, Name: item.Name, SortOrder: item.SortOrder})
	case ConfigKindDeviceTypes:
		return s.CreateCmdbTaxonomyForProject(scope, "categories", item.Name, item.ParentID, item.SortOrder)
	case ConfigKindModels:
		model := modelFromConfigItem(item)
		return s.CreateCmdbModelForProject(scope, &model)
	case ConfigKindSoftware:
		return s.createFlatConfigItem(scope, "cmdb_software_catalog", kind, item, true)
	case ConfigKindLocations:
		return s.createFlatConfigItem(scope, "cmdb_locations", kind, item, false)
	case ConfigKindStatuses:
		return s.createFlatConfigItem(scope, "cmdb_statuses", kind, item, false)
	case ConfigKindNetworkTypes:
		return s.createFlatConfigItem(scope, "cmdb_network_types", kind, item, false)
	case ConfigKindWorkOrderCategories:
		return s.createFlatConfigItem(scope, "cmdb_work_order_categories", kind, item, false)
	case ConfigKindWorkOrderTypes:
		return s.createFlatConfigItem(scope, "cmdb_work_order_types", kind, item, false)
	case ConfigKindWorkOrderPriorities:
		return s.createFlatConfigItem(scope, "cmdb_work_order_priorities", kind, item, false)
	case ConfigKindWorkOrderRule:
		return s.createFlatConfigItem(scope, "cmdb_work_order_rules", kind, item, true)
	default:
		return 0, fmt.Errorf("不支持的配置类型: %s", kind)
	}
}

func (s *Store) UpdateConfigItem(scope ProjectScope, kind string, item *ConfigItem) error {
	if item == nil || item.ID <= 0 {
		return errors.New("缺少有效配置项")
	}
	switch kind {
	case ConfigKindOrgNodes:
		return s.UpdateOrgNode(scope, &OrgNode{ID: item.ID, ParentID: item.ParentID, NodeType: item.NodeType, Name: item.Name, SortOrder: item.SortOrder})
	case ConfigKindDeviceTypes:
		return s.UpdateCmdbTaxonomyForProject(scope, "categories", item.ID, item.Name, item.ParentID, item.SortOrder)
	case ConfigKindModels:
		model := modelFromConfigItem(item)
		return s.UpdateCmdbModelForProject(scope, &model)
	case ConfigKindSoftware:
		return s.updateFlatConfigItem(scope, "cmdb_software_catalog", kind, item, true)
	case ConfigKindLocations:
		return s.updateFlatConfigItem(scope, "cmdb_locations", kind, item, false)
	case ConfigKindStatuses:
		return s.updateFlatConfigItem(scope, "cmdb_statuses", kind, item, false)
	case ConfigKindNetworkTypes:
		return s.updateFlatConfigItem(scope, "cmdb_network_types", kind, item, false)
	case ConfigKindWorkOrderCategories:
		return s.updateFlatConfigItem(scope, "cmdb_work_order_categories", kind, item, false)
	case ConfigKindWorkOrderTypes:
		return s.updateFlatConfigItem(scope, "cmdb_work_order_types", kind, item, false)
	case ConfigKindWorkOrderPriorities:
		return s.updateFlatConfigItem(scope, "cmdb_work_order_priorities", kind, item, false)
	case ConfigKindWorkOrderRule:
		return s.updateFlatConfigItem(scope, "cmdb_work_order_rules", kind, item, true)
	default:
		return fmt.Errorf("不支持的配置类型: %s", kind)
	}
}

func (s *Store) DeleteConfigItem(scope ProjectScope, kind string, id int64) error {
	if id <= 0 {
		return errors.New("缺少有效配置项")
	}
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	switch kind {
	case ConfigKindOrgNodes:
		return s.DeleteOrgNode(scope, id)
	case ConfigKindDeviceTypes:
		return s.DeleteCmdbTaxonomyForProject(scope, "categories", id)
	case ConfigKindModels:
		return s.DeleteCmdbModelForProject(scope, id)
	case ConfigKindSoftware:
		var references int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_asset_software WHERE project_id=? AND software_id=? AND deleted_at IS NULL`, scope.ProjectID, id).Scan(&references); err != nil {
			return err
		}
		if references > 0 {
			return fmt.Errorf("软件已被 %d 台资产引用: %w", references, ErrReferenced)
		}
		return s.softDeleteFlatConfigItem(scope, "cmdb_software_catalog", id)
	case ConfigKindLocations:
		return s.softDeleteFlatConfigItem(scope, "cmdb_locations", id)
	case ConfigKindStatuses:
		return s.softDeleteFlatConfigItem(scope, "cmdb_statuses", id)
	case ConfigKindNetworkTypes:
		return s.softDeleteFlatConfigItem(scope, "cmdb_network_types", id)
	case ConfigKindWorkOrderCategories:
		return s.softDeleteFlatConfigItem(scope, "cmdb_work_order_categories", id)
	case ConfigKindWorkOrderTypes:
		return s.softDeleteFlatConfigItem(scope, "cmdb_work_order_types", id)
	case ConfigKindWorkOrderPriorities:
		return s.softDeleteFlatConfigItem(scope, "cmdb_work_order_priorities", id)
	case ConfigKindWorkOrderRule:
		return s.softDeleteFlatConfigItem(scope, "cmdb_work_order_rules", id)
	default:
		return fmt.Errorf("不支持的配置类型: %s", kind)
	}
}

func (s *Store) listFlatConfigItems(scope ProjectScope, table string, software bool) ([]ConfigItem, error) {
	columns := "id, project_id, IFNULL(sync_id,''), name, '', '', IFNULL(remark,''), sort_order"
	if software {
		columns = "id, project_id, IFNULL(sync_id,''), name, IFNULL(vendor,''), IFNULL(version,''), IFNULL(remark,''), sort_order"
	}
	rows, err := s.db.Query(`SELECT `+columns+` FROM `+table+` WHERE project_id=? AND deleted_at IS NULL ORDER BY sort_order,name,id`, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ConfigItem, 0)
	for rows.Next() {
		var item ConfigItem
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.SyncID, &item.Name, &item.Vendor, &item.Version, &item.Remark, &item.SortOrder); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) createFlatConfigItem(scope ProjectScope, table, kind string, item *ConfigItem, software bool) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	item.Name = strings.TrimSpace(item.Name)
	item.Vendor = strings.TrimSpace(item.Vendor)
	if item.Name == "" {
		return 0, errors.New("配置项名称不能为空")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var result sql.Result
	var err error
	if software {
		result, err = s.db.Exec(`INSERT INTO `+table+`(project_id,name,vendor,version,remark,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`, scope.ProjectID, item.Name, item.Vendor, strings.TrimSpace(item.Version), strings.TrimSpace(item.Remark), item.SortOrder, now, now)
	} else {
		result, err = s.db.Exec(`INSERT INTO `+table+`(project_id,name,remark,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?)`, scope.ProjectID, item.Name, strings.TrimSpace(item.Remark), item.SortOrder, now, now)
	}
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return 0, fmt.Errorf("同一项目内已存在相同%s配置", kind)
		}
		return 0, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	item.ID = id
	item.ProjectID = scope.ProjectID
	if err := s.db.QueryRow(`SELECT IFNULL(sync_id,'') FROM `+table+` WHERE id=? AND project_id=?`, id, scope.ProjectID).Scan(&item.SyncID); err != nil {
		return 0, err
	}
	return id, nil
}

func (s *Store) updateFlatConfigItem(scope ProjectScope, table, kind string, item *ConfigItem, software bool) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	item.Name = strings.TrimSpace(item.Name)
	item.Vendor = strings.TrimSpace(item.Vendor)
	if item.Name == "" {
		return errors.New("配置项名称不能为空")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var result sql.Result
	var err error
	if software {
		result, err = s.db.Exec(`UPDATE `+table+` SET name=?,vendor=?,version=?,remark=?,sort_order=?,revision=revision+1,updated_at=? WHERE id=? AND project_id=? AND deleted_at IS NULL`, item.Name, item.Vendor, strings.TrimSpace(item.Version), strings.TrimSpace(item.Remark), item.SortOrder, now, item.ID, scope.ProjectID)
	} else {
		result, err = s.db.Exec(`UPDATE `+table+` SET name=?,remark=?,sort_order=?,revision=revision+1,updated_at=? WHERE id=? AND project_id=? AND deleted_at IS NULL`, item.Name, strings.TrimSpace(item.Remark), item.SortOrder, now, item.ID, scope.ProjectID)
	}
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return fmt.Errorf("同一项目内已存在相同%s配置", kind)
		}
		return err
	}
	return requireConfigAffected(result, "配置项不属于当前项目")
}

func (s *Store) softDeleteFlatConfigItem(scope ProjectScope, table string, id int64) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`UPDATE `+table+` SET deleted_at=?,updated_at=?,revision=revision+1 WHERE id=? AND project_id=? AND deleted_at IS NULL`, now, now, id, scope.ProjectID)
	if err != nil {
		return err
	}
	return requireConfigAffected(result, "配置项不属于当前项目")
}

func requireConfigAffected(result sql.Result, message string) error {
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return fmt.Errorf("%s: %w", message, ErrProjectScopedNotFound)
	}
	return nil
}

func modelFromConfigItem(item *ConfigItem) CmdbDeviceModel {
	modelName := strings.TrimSpace(item.Model)
	if modelName == "" {
		modelName = strings.TrimSpace(item.Name)
	}
	return CmdbDeviceModel{
		ID: item.ID, Vendor: strings.TrimSpace(item.Vendor), Model: modelName,
		HeightU: item.HeightU, RatedPowerW: item.RatedPowerW, MaxPowerW: item.MaxPowerW,
		WeightKG: item.WeightKG, DepthMM: item.DepthMM,
	}
}

func configItemFromModel(model CmdbDeviceModel) ConfigItem {
	return ConfigItem{
		ID: model.ID, ProjectID: model.ProjectID, SyncID: model.SyncID, Name: model.Model,
		Vendor: model.Vendor, Model: model.Model, HeightU: model.HeightU, RatedPowerW: model.RatedPowerW,
		MaxPowerW: model.MaxPowerW, WeightKG: model.WeightKG, DepthMM: model.DepthMM,
	}
}

func (s *Store) resolvePersonOrgPath(scope ProjectScope, person *Person) error {
	if person == nil {
		return errors.New("人员不能为空")
	}
	if person.GroupID > 0 {
		group, err := s.getOrgNode(scope, person.GroupID)
		if err != nil {
			return fmt.Errorf("所属分组无效: %w", err)
		}
		if group.NodeType != OrgNodeGroup {
			return errors.New("所属分组节点类型错误")
		}
		if person.DepartmentID > 0 && person.DepartmentID != group.ParentID {
			return errors.New("所属分组不属于所选部门")
		}
		person.DepartmentID = group.ParentID
	}
	if person.DepartmentID > 0 {
		department, err := s.getOrgNode(scope, person.DepartmentID)
		if err != nil {
			return fmt.Errorf("所属部门无效: %w", err)
		}
		if department.NodeType != OrgNodeDepartment {
			return errors.New("所属部门节点类型错误")
		}
		if person.OrgID > 0 && person.OrgID != department.ParentID {
			return errors.New("所属部门不属于所选组织")
		}
		person.OrgID = department.ParentID
	}

	if person.DepartmentID == 0 {
		department := strings.TrimSpace(person.Department)
		if department == "" {
			return errors.New("所属部门不能为空")
		}
		orgName := strings.TrimSpace(person.OrgName)
		if person.OrgID == 0 {
			if orgName == "" {
				orgName = "未归属组织"
			}
			orgID, err := s.findOrCreateOrgNode(scope, 0, OrgNodeOrganization, orgName)
			if err != nil {
				return err
			}
			person.OrgID = orgID
		}
		departmentID, err := s.findOrCreateOrgNode(scope, person.OrgID, OrgNodeDepartment, department)
		if err != nil {
			return err
		}
		person.DepartmentID = departmentID
		if groupName := strings.TrimSpace(person.GroupName); groupName != "" {
			groupID, err := s.findOrCreateOrgNode(scope, person.DepartmentID, OrgNodeGroup, groupName)
			if err != nil {
				return err
			}
			person.GroupID = groupID
		}
	}

	org, err := s.getOrgNode(scope, person.OrgID)
	if err != nil || org.NodeType != OrgNodeOrganization {
		return errors.New("所属组织无效")
	}
	department, err := s.getOrgNode(scope, person.DepartmentID)
	if err != nil || department.NodeType != OrgNodeDepartment || department.ParentID != org.ID {
		return errors.New("所属部门无效")
	}
	person.OrgName = org.Name
	person.Department = department.Name
	person.GroupName = ""
	if person.GroupID > 0 {
		group, err := s.getOrgNode(scope, person.GroupID)
		if err != nil || group.NodeType != OrgNodeGroup || group.ParentID != department.ID {
			return errors.New("所属分组无效")
		}
		person.GroupName = group.Name
	}
	return nil
}

func (s *Store) findOrCreateOrgNode(scope ProjectScope, parentID int64, nodeType, name string) (int64, error) {
	name = strings.TrimSpace(name)
	var id int64
	err := s.db.QueryRow(`SELECT id FROM cmdb_org_nodes WHERE project_id=? AND parent_id=? AND node_type=? AND name=? AND deleted_at IS NULL`, scope.ProjectID, parentID, nodeType, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	id, err = s.CreateOrgNode(scope, &OrgNode{ParentID: parentID, NodeType: nodeType, Name: name})
	if err != nil && strings.Contains(err.Error(), "同级下已存在") {
		err = s.db.QueryRow(`SELECT id FROM cmdb_org_nodes WHERE project_id=? AND parent_id=? AND node_type=? AND name=? AND deleted_at IS NULL`, scope.ProjectID, parentID, nodeType, name).Scan(&id)
	}
	return id, err
}
