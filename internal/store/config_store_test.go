package store

import (
	"errors"
	"path/filepath"
	"testing"
)

// 删除组织节点时如果漏掉人员引用检查，此测试会失败。
func TestOrgTreeCRUDAndReferenceProtection(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatalf("读取默认项目: %v", err)
	}

	orgID, err := s.CreateOrgNode(scope, &OrgNode{NodeType: OrgNodeOrganization, Name: "常州中院", SortOrder: 1})
	if err != nil {
		t.Fatalf("创建组织: %v", err)
	}
	departmentID, err := s.CreateOrgNode(scope, &OrgNode{ParentID: orgID, NodeType: OrgNodeDepartment, Name: "信息技术处", SortOrder: 1})
	if err != nil {
		t.Fatalf("创建部门: %v", err)
	}
	groupID, err := s.CreateOrgNode(scope, &OrgNode{ParentID: departmentID, NodeType: OrgNodeGroup, Name: "运维组", SortOrder: 1})
	if err != nil {
		t.Fatalf("创建分组: %v", err)
	}
	emptyDepartmentID, err := s.CreateOrgNode(scope, &OrgNode{ParentID: orgID, NodeType: OrgNodeDepartment, Name: "综合处", SortOrder: 2})
	if err != nil {
		t.Fatalf("创建空部门: %v", err)
	}
	if _, err := s.CreateOrgNode(scope, &OrgNode{ParentID: orgID, NodeType: OrgNodeDepartment, Name: "信息技术处"}); err == nil {
		t.Fatal("同一组织下的同名部门必须被拒绝")
	}

	tree, err := s.ListOrgTree(scope)
	if err != nil {
		t.Fatalf("读取组织树: %v", err)
	}
	if len(tree) != 1 || tree[0].ID != orgID || len(tree[0].Children) != 2 {
		t.Fatalf("组织树根节点或空部门丢失: %+v", tree)
	}
	if tree[0].Children[0].ID != departmentID || len(tree[0].Children[0].Children) != 1 || tree[0].Children[0].Children[0].ID != groupID {
		t.Fatalf("三级组织树错误: %+v", tree)
	}
	if tree[0].Children[1].ID != emptyDepartmentID || len(tree[0].Children[1].Children) != 0 {
		t.Fatalf("空部门必须保留在树中: %+v", tree[0].Children[1])
	}

	if err := s.MoveOrgNode(scope, groupID, emptyDepartmentID, 3); err != nil {
		t.Fatalf("移动分组: %v", err)
	}
	tree, err = s.ListOrgTree(scope)
	if err != nil {
		t.Fatalf("移动后读取组织树: %v", err)
	}
	if len(tree[0].Children[0].Children) != 0 || len(tree[0].Children[1].Children) != 1 || tree[0].Children[1].Children[0].ID != groupID {
		t.Fatalf("移动后的组织树错误: %+v", tree)
	}

	person := &Person{
		PersonCode:   "EMP-001",
		Name:         "张三",
		OrgID:        orgID,
		DepartmentID: emptyDepartmentID,
		GroupID:      groupID,
		Status:       "在职",
	}
	personID, err := s.CreatePersonForProject(scope, person)
	if err != nil {
		t.Fatalf("用组织节点创建人员: %v", err)
	}
	got, err := s.GetPersonForProject(scope, personID)
	if err != nil {
		t.Fatalf("读取人员: %v", err)
	}
	if got.OrgID != orgID || got.DepartmentID != emptyDepartmentID || got.GroupID != groupID || got.OrgName != "常州中院" || got.Department != "综合处" || got.GroupName != "运维组" {
		t.Fatalf("人员组织路径没有由节点解析: %+v", got)
	}
	if err := s.DeleteOrgNode(scope, emptyDepartmentID); !errors.Is(err, ErrReferenced) {
		t.Fatalf("被人员引用的部门应阻止删除: %v", err)
	}
}

// 移动已被人员引用的分组时如果不级联更新部门和组织 ID，此测试会失败。
func TestOrgTreeMoveKeepsPersonPathConsistent(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatalf("读取默认项目: %v", err)
	}
	orgA, _ := s.CreateOrgNode(scope, &OrgNode{NodeType: OrgNodeOrganization, Name: "组织 A"})
	deptA, _ := s.CreateOrgNode(scope, &OrgNode{ParentID: orgA, NodeType: OrgNodeDepartment, Name: "部门 A"})
	groupID, _ := s.CreateOrgNode(scope, &OrgNode{ParentID: deptA, NodeType: OrgNodeGroup, Name: "运维组"})
	orgB, _ := s.CreateOrgNode(scope, &OrgNode{NodeType: OrgNodeOrganization, Name: "组织 B"})
	deptB, _ := s.CreateOrgNode(scope, &OrgNode{ParentID: orgB, NodeType: OrgNodeDepartment, Name: "部门 B"})
	personID, err := s.CreatePersonForProject(scope, &Person{Name: "李四", OrgID: orgA, DepartmentID: deptA, GroupID: groupID})
	if err != nil {
		t.Fatalf("创建人员: %v", err)
	}

	if err := s.MoveOrgNode(scope, groupID, deptB, 1); err != nil {
		t.Fatalf("跨部门移动分组: %v", err)
	}
	person, err := s.GetPersonForProject(scope, personID)
	if err != nil {
		t.Fatalf("读取移动后的人员: %v", err)
	}
	if person.OrgID != orgB || person.DepartmentID != deptB || person.Department != "部门 B" || person.OrgName != "组织 B" {
		t.Fatalf("人员路径未跟随分组移动: %+v", person)
	}
}

// 组织节点改名后如果人员镜像字段仍保留旧名称，此测试会失败。
func TestOrgTreeRenameKeepsPersonDisplayNamesConsistent(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatalf("读取默认项目: %v", err)
	}
	orgID, err := s.CreateOrgNode(scope, &OrgNode{NodeType: OrgNodeOrganization, Name: "组织 A"})
	if err != nil {
		t.Fatalf("创建组织: %v", err)
	}
	departmentID, err := s.CreateOrgNode(scope, &OrgNode{ParentID: orgID, NodeType: OrgNodeDepartment, Name: "部门 A"})
	if err != nil {
		t.Fatalf("创建部门: %v", err)
	}
	groupID, err := s.CreateOrgNode(scope, &OrgNode{ParentID: departmentID, NodeType: OrgNodeGroup, Name: "分组 A"})
	if err != nil {
		t.Fatalf("创建分组: %v", err)
	}
	personID, err := s.CreatePersonForProject(scope, &Person{Name: "王五", OrgID: orgID, DepartmentID: departmentID, GroupID: groupID})
	if err != nil {
		t.Fatalf("创建人员: %v", err)
	}

	updates := []OrgNode{
		{ID: orgID, NodeType: OrgNodeOrganization, Name: "组织 B"},
		{ID: departmentID, ParentID: orgID, NodeType: OrgNodeDepartment, Name: "部门 B"},
		{ID: groupID, ParentID: departmentID, NodeType: OrgNodeGroup, Name: "分组 B"},
	}
	for _, update := range updates {
		if err := s.UpdateOrgNode(scope, &update); err != nil {
			t.Fatalf("更新组织节点 %d: %v", update.ID, err)
		}
	}

	var orgName, department, groupName string
	if err := s.db.QueryRow(`
		SELECT org_name, department, group_name
		FROM cmdb_persons WHERE id=? AND project_id=?
	`, personID, scope.ProjectID).Scan(&orgName, &department, &groupName); err != nil {
		t.Fatalf("读取人员兼容镜像字段: %v", err)
	}
	if orgName != "组织 B" || department != "部门 B" || groupName != "分组 B" {
		t.Fatalf("人员兼容镜像字段未跟随组织节点改名: org=%q department=%q group=%q", orgName, department, groupName)
	}
}

// 如果配置 CRUD 仍按全库读写，两个项目的同名配置会相互覆盖或泄漏。
func TestConfigCatalogProjectIsolation(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, scopeB := newCmdbProjectScopes(t, s)

	tests := []struct {
		kind  string
		itemA ConfigItem
		itemB ConfigItem
	}{
		{kind: ConfigKindDeviceTypes, itemA: ConfigItem{Name: "交换机"}, itemB: ConfigItem{Name: "交换机"}},
		{kind: ConfigKindSoftware, itemA: ConfigItem{Name: "终端安全软件", Vendor: "厂商甲", Version: "1.0"}, itemB: ConfigItem{Name: "终端安全软件", Vendor: "厂商乙", Version: "2.0"}},
		{kind: ConfigKindLocations, itemA: ConfigItem{Name: "数据机房"}, itemB: ConfigItem{Name: "数据机房"}},
		{kind: ConfigKindStatuses, itemA: ConfigItem{Name: "在用"}, itemB: ConfigItem{Name: "在用"}},
		{kind: ConfigKindNetworkTypes, itemA: ConfigItem{Name: "测试专线"}, itemB: ConfigItem{Name: "测试专线"}},
		{kind: ConfigKindWorkOrderCategories, itemA: ConfigItem{Name: "故障处理"}, itemB: ConfigItem{Name: "故障处理"}},
		{kind: ConfigKindWorkOrderTypes, itemA: ConfigItem{Name: "排障"}, itemB: ConfigItem{Name: "排障"}},
		{kind: ConfigKindWorkOrderPriorities, itemA: ConfigItem{Name: "P3（普通）"}, itemB: ConfigItem{Name: "P3（普通）"}},
		{kind: ConfigKindWorkOrderRule, itemA: ConfigItem{Name: "GD", Vendor: "-", Version: "YYYYMMDD", Remark: "每日", SortOrder: 4}, itemB: ConfigItem{Name: "GD", Vendor: "-", Version: "YYYYMMDD", Remark: "每日", SortOrder: 4}},
		{kind: ConfigKindModels, itemA: ConfigItem{Vendor: "华为", Model: "S5735", Name: "S5735"}, itemB: ConfigItem{Vendor: "华为", Model: "S5735", Name: "S5735"}},
	}

	for _, tt := range tests {
		t.Run(tt.kind, func(t *testing.T) {
			idA, err := s.CreateConfigItem(scopeA, tt.kind, &tt.itemA)
			if err != nil {
				t.Fatalf("创建项目 A 配置: %v", err)
			}
			idB, err := s.CreateConfigItem(scopeB, tt.kind, &tt.itemB)
			if err != nil {
				t.Fatalf("创建项目 B 同名配置: %v", err)
			}
			listA, err := s.ListConfigItems(scopeA, tt.kind)
			if err != nil || !containsConfigItem(listA, idA, scopeA.ProjectID) {
				t.Fatalf("项目 A 配置隔离失败: list=%+v err=%v", listA, err)
			}
			listB, err := s.ListConfigItems(scopeB, tt.kind)
			if err != nil || !containsConfigItem(listB, idB, scopeB.ProjectID) {
				t.Fatalf("项目 B 配置隔离失败: list=%+v err=%v", listB, err)
			}
			if err := s.DeleteConfigItem(scopeA, tt.kind, idB); !errors.Is(err, ErrProjectScopedNotFound) {
				t.Fatalf("项目 A 不得删除项目 B 配置: %v", err)
			}
		})
	}

	if _, err := s.CreateConfigItem(scopeA, ConfigKindSoftware, &ConfigItem{Name: "终端安全软件", Vendor: "厂商甲"}); err == nil {
		t.Fatal("同一项目内的软件名和厂商组合必须唯一")
	}
	if _, err := s.ListConfigItems(scopeA, "unknown"); err == nil {
		t.Fatal("未知配置类型必须显式报错")
	}
}

func containsConfigItem(items []ConfigItem, id, projectID int64) bool {
	for _, item := range items {
		if item.ID == id && item.ProjectID == projectID && item.SyncID != "" {
			return true
		}
	}
	return false
}

// 机柜 U 数未持久化或越界未拦截时，机柜图会按错误高度绘制。
func TestLocationRackUnitsPersistAndValidate(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	item := ConfigItem{Name: "A01 机柜", RackUnits: 47}
	id, err := s.CreateConfigItem(scope, ConfigKindLocations, &item)
	if err != nil {
		t.Fatal(err)
	}
	item.RackUnits = 42
	if err := s.UpdateConfigItem(scope, ConfigKindLocations, &item); err != nil {
		t.Fatal(err)
	}
	list, err := s.ListConfigItems(scope, ConfigKindLocations)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != id || list[0].RackUnits != 42 {
		t.Fatalf("机柜 U 数未保存: %+v", list)
	}
	if _, err := s.CreateConfigItem(scope, ConfigKindLocations, &ConfigItem{Name: "超高机柜", RackUnits: 61}); err == nil {
		t.Fatal("超过 60U 的机柜必须拒绝")
	}
}

func TestNetworkTypesHaveProjectDefaults(t *testing.T) {
	s := newCmdbTestStore(t)
	first, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	secondProject, err := s.CreateCmdbProject(&CmdbProject{Code: "second", Name: "第二项目"})
	if err != nil {
		t.Fatal(err)
	}
	for _, scope := range []ProjectScope{first, {ProjectID: secondProject.ID}} {
		items, err := s.ListConfigItems(scope, ConfigKindNetworkTypes)
		if err != nil {
			t.Fatal(err)
		}
		if len(items) != 3 || items[0].Name != "专网" || items[1].Name != "外网" || items[2].Name != "内网" {
			t.Fatalf("项目 %d 网络类型默认项错误: %+v", scope.ProjectID, items)
		}
	}
}

// 如果旧人员自由文本没有在升级时解析成节点 ID，此测试会失败。
func TestConfigMigrationBackfillsPersonOrgIDs(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "config_migration.db")
	first, err := Open(dbPath)
	if err != nil {
		t.Fatalf("首次打开数据库: %v", err)
	}
	scope, err := first.DefaultProjectScope()
	if err != nil {
		t.Fatalf("读取默认项目: %v", err)
	}
	if _, err := first.db.Exec(`
		INSERT INTO cmdb_persons(project_id, person_code, name, org_name, department, group_name, status, created_at, updated_at)
		VALUES (?, 'LEGACY-1', '旧人员', '常州中院', '信息技术处', '运维组', '在职', '', '')
	`, scope.ProjectID); err != nil {
		t.Fatalf("写入旧人员数据: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("关闭首次连接: %v", err)
	}

	second, err := Open(dbPath)
	if err != nil {
		t.Fatalf("重新打开并迁移: %v", err)
	}
	defer second.Close()
	people, total, err := second.ListPersonsForProject(scope, PersonQuery{Keyword: "旧人员", Page: 1, PageSize: 10})
	if err != nil || total != 1 || len(people) != 1 {
		t.Fatalf("读取迁移后人员: total=%d people=%+v err=%v", total, people, err)
	}
	person := people[0]
	if person.OrgID <= 0 || person.DepartmentID <= 0 || person.GroupID <= 0 {
		t.Fatalf("旧人员组织节点 ID 未回填: %+v", person)
	}
	tree, err := second.ListOrgTree(scope)
	if err != nil || len(tree) != 1 || len(tree[0].Children) != 1 || len(tree[0].Children[0].Children) != 1 {
		t.Fatalf("旧人员组织路径未生成: tree=%+v err=%v", tree, err)
	}
}
