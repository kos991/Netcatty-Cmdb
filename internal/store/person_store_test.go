package store

import (
	"path/filepath"
	"testing"
)

func newPersonTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "person_test.db"))
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestPersonCRUD(t *testing.T) {
	s := newPersonTestStore(t)

	// 1. 创建人员
	p := &Person{
		PersonCode: "EMP001",
		Name:       "张三",
		Department: "信息技术部",
		Title:      "运维主管",
		Phone:      "13800000001",
		Email:      "zhangsan@example.com",
		Status:     "在职",
		Remark:     "核心骨干",
	}
	id, err := s.CreatePerson(p)
	if err != nil {
		t.Fatalf("创建人员失败: %v", err)
	}
	if id <= 0 {
		t.Fatalf("返回的人员 ID 无效: %d", id)
	}

	// 2. 详情获取
	fetched, err := s.GetPerson(id)
	if err != nil {
		t.Fatalf("获取人员详情失败: %v", err)
	}
	if fetched.Name != "张三" || fetched.Department != "信息技术部" {
		t.Fatalf("人员信息不匹配: %+v", fetched)
	}

	// 3. 更新人员
	fetched.Title = "高级运维总监"
	fetched.Status = "调休"
	if err := s.UpdatePerson(fetched); err != nil {
		t.Fatalf("更新人员失败: %v", err)
	}

	updated, err := s.GetPerson(id)
	if err != nil {
		t.Fatalf("重新获取人员失败: %v", err)
	}
	if updated.Title != "高级运维总监" || updated.Status != "调休" {
		t.Fatalf("更新字段未生效: %+v", updated)
	}

	// 4. 列表查询（关键字与部门筛选）
	list, total, err := s.ListPersons(PersonQuery{Keyword: "张三", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("列表查询失败: %v", err)
	}
	if total != 1 || len(list) != 1 {
		t.Fatalf("列表条数不正确: total=%d, len=%d", total, len(list))
	}

	// 5. 删除人员
	if err := s.DeletePerson(id); err != nil {
		t.Fatalf("删除人员失败: %v", err)
	}
	if _, err := s.GetPerson(id); err == nil {
		t.Fatalf("删除后应当无法查出该人员")
	}
}

func TestPersonNodeFilterUsesSameIDsAsOrganizationCount(t *testing.T) {
	s := newPersonTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.CreateOrgNode(scope, &OrgNode{Name: "机关", NodeType: OrgNodeOrganization})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.CreateOrgNode(scope, &OrgNode{Name: "办事处", NodeType: OrgNodeOrganization})
	if err != nil {
		t.Fatal(err)
	}
	firstDept, err := s.CreateOrgNode(scope, &OrgNode{Name: "技术部", NodeType: OrgNodeDepartment, ParentID: first})
	if err != nil {
		t.Fatal(err)
	}
	secondDept, err := s.CreateOrgNode(scope, &OrgNode{Name: "技术部", NodeType: OrgNodeDepartment, ParentID: second})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePersonForProject(scope, &Person{Name: "甲", OrgID: first, DepartmentID: firstDept, Status: "在职"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePersonForProject(scope, &Person{Name: "乙", OrgID: second, DepartmentID: secondDept, Status: "在职"}); err != nil {
		t.Fatal(err)
	}
	list, total, err := s.ListPersonsForProject(scope, PersonQuery{NodeID: firstDept, NodeType: OrgNodeDepartment, Page: 1, PageSize: 10})
	if err != nil || total != 1 || len(list) != 1 || list[0].Name != "甲" {
		t.Fatalf("组织人数与列表不一致: total=%d list=%+v err=%v", total, list, err)
	}
}

func TestGetPersonAssets(t *testing.T) {
	s := newPersonTestStore(t)

	// 创建人员
	pID, err := s.CreatePerson(&Person{
		PersonCode: "EMP002",
		Name:       "李四",
		Department: "审判第一庭",
		Status:     "在职",
	})
	if err != nil {
		t.Fatalf("创建人员失败: %v", err)
	}

	// 为李四分配两台资产（一台终端，一台服务器），并带网络接口
	a1ID, err := s.CreateCmdbAssetManual(&CmdbAsset{
		Name:       "李四-办公PC",
		AssetClass: "pc",
		OwnerID:    pID,
		Owner:      "李四",
		Department: "审判第一庭",
		Interfaces: []CmdbAssetInterface{
			{Name: "eth0", IP: "172.16.10.101", MAC: "00:11:22:33:44:55", IsPrimary: 1},
		},
	})
	if err != nil {
		t.Fatalf("创建资产1失败: %v", err)
	}
	if a1ID <= 0 {
		t.Fatalf("资产1 ID 无效")
	}

	a2ID, err := s.CreateCmdbAssetManual(&CmdbAsset{
		Name:       "李四-专案虚拟机",
		AssetClass: "vm",
		OwnerID:    pID,
		Owner:      "李四",
		Department: "审判第一庭",
		Interfaces: []CmdbAssetInterface{
			{Name: "vnet0", IP: "172.16.20.102", IsPrimary: 1},
		},
	})
	if err != nil {
		t.Fatalf("创建资产2失败: %v", err)
	}
	if a2ID <= 0 {
		t.Fatalf("资产2 ID 无效")
	}

	// 穿透获取李四名下资产
	person, assets, err := s.GetPersonAssets(pID)
	if err != nil {
		t.Fatalf("穿透获取人员名下资产失败: %v", err)
	}
	if person.Name != "李四" {
		t.Fatalf("人员姓名不符: %s", person.Name)
	}
	if len(assets) != 2 {
		t.Fatalf("名下资产数量应为 2，实际为 %d", len(assets))
	}
	if len(assets[0].Interfaces) == 0 {
		t.Fatalf("资产未正确携带网络接口")
	}
}

func TestPersonAssetsIncludeTerminalLedgerWithoutDuplicateMirror(t *testing.T) {
	s := newPersonTestStore(t)

	fromID, err := s.CreatePerson(&Person{Name: "周明", Department: "技术科", Status: "在职"})
	if err != nil {
		t.Fatalf("创建人员失败: %v", err)
	}
	toID, err := s.CreatePerson(&Person{Name: "吴敏", Department: "办公室", Status: "在职"})
	if err != nil {
		t.Fatalf("创建接收人失败: %v", err)
	}

	mappedLegacyID, err := s.CreateAsset(&Asset{AssetCode: "PC-001", DeviceType: "台式电脑", UserName: "周明", Department: "技术科", IP: "172.16.1.10", Status: "在用"}, "测试员")
	if err != nil {
		t.Fatalf("创建待映射终端资产失败: %v", err)
	}
	if _, err := s.SyncLegacyToCmdb(); err != nil {
		t.Fatalf("同步终端资产镜像失败: %v", err)
	}
	unmappedLegacyID, err := s.CreateAsset(&Asset{AssetCode: "NB-002", DeviceType: "笔记本", UserName: "周明", Department: "技术科", IP: "172.16.1.11", Status: "在用"}, "测试员")
	if err != nil {
		t.Fatalf("创建未映射终端资产失败: %v", err)
	}
	if _, err := s.CreateAsset(&Asset{AssetCode: "PC-NO-OWNER", DeviceType: "台式电脑", Department: "技术科", Status: "闲置"}, "测试员"); err != nil {
		t.Fatalf("创建同部门无使用人资产失败: %v", err)
	}
	if _, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "核心交换机", AssetClass: "physical", OwnerID: fromID, Owner: "周明", Department: "技术科"}); err != nil {
		t.Fatalf("创建原生 CMDB 资产失败: %v", err)
	}

	people, _, err := s.ListPersons(PersonQuery{Keyword: "周明", Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("查询人员列表失败: %v", err)
	}
	if len(people) != 1 || people[0].AssetCount != 3 {
		t.Fatalf("资产数应合并两条终端资产和一条原生资产，且镜像不重复计数: %+v", people)
	}

	person, assets, err := s.GetPersonAssets(fromID)
	if err != nil {
		t.Fatalf("查询人员名下资产失败: %v", err)
	}
	if person.AssetCount != 3 || len(assets) != 3 {
		t.Fatalf("人员资产详情数量应为 3: person=%+v assets=%+v", person, assets)
	}
	legacyCount := 0
	for _, asset := range assets {
		if asset.SourceType == "legacy_asset" {
			legacyCount++
			if asset.SourceID == unmappedLegacyID && asset.ID >= 0 {
				t.Fatalf("未映射终端资产应使用负 ID 区分交接来源: %+v", asset)
			}
		}
	}
	if legacyCount != 2 {
		t.Fatalf("终端资产详情应恰好返回 2 条，实际 %d: %+v", legacyCount, assets)
	}

	transferred, err := s.TransferPersonAssets(PersonTransferReq{FromPersonID: fromID, ToPersonID: toID, Operator: "测试员"})
	if err != nil {
		t.Fatalf("交接混合来源资产失败: %v", err)
	}
	if transferred != 3 {
		t.Fatalf("应交接 3 条资产，实际 %d", transferred)
	}
	for _, legacyID := range []int64{mappedLegacyID, unmappedLegacyID} {
		var owner, department string
		if err := s.db.QueryRow("SELECT user_name, department FROM assets WHERE id=?", legacyID).Scan(&owner, &department); err != nil {
			t.Fatalf("读取终端资产 %d 失败: %v", legacyID, err)
		}
		if owner != "吴敏" || department != "办公室" {
			t.Fatalf("终端资产 %d 未同步交接结果: owner=%q department=%q", legacyID, owner, department)
		}
	}
}

func TestTransferPersonAssets(t *testing.T) {
	s := newPersonTestStore(t)

	// 创建来源人与目标人
	fromID, err := s.CreatePerson(&Person{
		PersonCode: "EMP003",
		Name:       "王五",
		Department: "立案庭",
		Status:     "离职",
	})
	if err != nil {
		t.Fatalf("创建交接发起人失败: %v", err)
	}

	toID, err := s.CreatePerson(&Person{
		PersonCode: "EMP004",
		Name:       "赵六",
		Department: "执行局",
		Status:     "在职",
	})
	if err != nil {
		t.Fatalf("创建交接接收人失败: %v", err)
	}

	// 给王五分配资产
	_, err = s.CreateCmdbAssetManual(&CmdbAsset{
		Name:       "王五原PC",
		AssetClass: "pc",
		OwnerID:    fromID,
		Owner:      "王五",
		Department: "立案庭",
	})
	if err != nil {
		t.Fatalf("创建资产失败: %v", err)
	}

	// 一键交接
	transferred, err := s.TransferPersonAssets(PersonTransferReq{
		FromPersonID: fromID,
		ToPersonID:   toID,
		Remark:       "离职交接给赵六",
	})
	if err != nil {
		t.Fatalf("资产交接失败: %v", err)
	}
	if transferred != 1 {
		t.Fatalf("期望交接 1 条资产，实际 %d", transferred)
	}

	// 校验王五名下资产为 0
	_, fromAssets, err := s.GetPersonAssets(fromID)
	if err != nil {
		t.Fatalf("查询王五资产失败: %v", err)
	}
	if len(fromAssets) != 0 {
		t.Fatalf("交接后王五名下资产应为 0，实际 %d", len(fromAssets))
	}

	// 校验赵六名下资产为 1 且信息已变更为赵六所在部门
	_, toAssets, err := s.GetPersonAssets(toID)
	if err != nil {
		t.Fatalf("查询赵六资产失败: %v", err)
	}
	if len(toAssets) != 1 {
		t.Fatalf("交接后赵六名下资产应为 1，实际 %d", len(toAssets))
	}
	if toAssets[0].Owner != "赵六" || toAssets[0].Department != "执行局" {
		t.Fatalf("资产属性未正确同步为新接收人: %+v", toAssets[0])
	}
}

// 拖拽人员到新组织节点最终调用 UpdatePerson；人员名下资产必须在同一事务内跟随归属。
func TestUpdatePersonOrganizationMovesOwnedAssets(t *testing.T) {
	s := newPersonTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	orgID, _ := s.CreateOrgNode(scope, &OrgNode{NodeType: OrgNodeOrganization, Name: "常州中院"})
	oldDeptID, _ := s.CreateOrgNode(scope, &OrgNode{ParentID: orgID, NodeType: OrgNodeDepartment, Name: "信息处"})
	newDeptID, _ := s.CreateOrgNode(scope, &OrgNode{ParentID: orgID, NodeType: OrgNodeDepartment, Name: "办公室"})
	personID, err := s.CreatePersonForProject(scope, &Person{Name: "张三", OrgID: orgID, DepartmentID: oldDeptID, Status: "在职"})
	if err != nil {
		t.Fatal(err)
	}
	cmdbID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "核心交换机", OwnerID: personID, Owner: "张三", Department: "信息处"})
	if err != nil {
		t.Fatal(err)
	}
	legacyID, err := s.CreateAssetForProject(scope, &Asset{AssetCode: "PC-001", UserName: "张三", Department: "信息处", Status: "在用"}, "测试")
	if err != nil {
		t.Fatal(err)
	}

	person, err := s.GetPersonForProject(scope, personID)
	if err != nil {
		t.Fatal(err)
	}
	person.DepartmentID = newDeptID
	person.GroupID = 0
	if err := s.UpdatePersonForProject(scope, person); err != nil {
		t.Fatal(err)
	}

	cmdbAsset, _, err := s.GetCmdbAssetForProject(scope, cmdbID)
	if err != nil {
		t.Fatal(err)
	}
	if cmdbAsset.Department != "办公室" {
		t.Fatalf("基础设施没有跟随人员组织变更: %+v", cmdbAsset)
	}
	legacyAsset, _, err := s.GetAssetForProject(scope, legacyID)
	if err != nil {
		t.Fatal(err)
	}
	if legacyAsset.Department != "办公室" {
		t.Fatalf("终端资产没有跟随人员组织变更: %+v", legacyAsset)
	}
}
