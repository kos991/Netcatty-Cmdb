package store

import (
	"errors"
	"strings"
	"testing"
)

func newCmdbProjectScopes(t *testing.T, s *Store) (ProjectScope, ProjectScope) {
	t.Helper()
	projectA, err := s.CreateCmdbProject(&CmdbProject{Code: "cmdb-scope-a", Name: "CMDB 项目 A"})
	if err != nil {
		t.Fatalf("创建项目 A: %v", err)
	}
	projectB, err := s.CreateCmdbProject(&CmdbProject{Code: "cmdb-scope-b", Name: "CMDB 项目 B"})
	if err != nil {
		t.Fatalf("创建项目 B: %v", err)
	}
	return ProjectScope{ProjectID: projectA.ID}, ProjectScope{ProjectID: projectB.ID}
}

// 此测试会在资产查询遗漏 project_id、详情仅按 id 查询或同步元数据未扫描时失败。
func TestProjectScopeCmdbReadIsolationAndSyncMetadata(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, scopeB := newCmdbProjectScopes(t, s)

	assetA := &CmdbAsset{ProjectID: scopeB.ProjectID, Name: "同名核心资产", AssetCode: "SAME-ASSET", Status: "在线"}
	assetAID, err := s.InsertCmdbAssetForProject(scopeA, assetA)
	if err != nil {
		t.Fatalf("写入项目 A 资产: %v", err)
	}
	assetB := &CmdbAsset{ProjectID: scopeA.ProjectID, Name: "同名核心资产", AssetCode: "SAME-ASSET", Status: "在库"}
	assetBID, err := s.InsertCmdbAssetForProject(scopeB, assetB)
	if err != nil {
		t.Fatalf("写入项目 B 资产: %v", err)
	}

	listA, totalA, err := s.QueryCmdbAssetsForProject(scopeA, CmdbAssetQuery{Keyword: "同名核心资产", Page: 1, PageSize: 20})
	if err != nil || totalA != 1 || len(listA) != 1 {
		t.Fatalf("项目 A 资产列表隔离失败: total=%d list=%+v err=%v", totalA, listA, err)
	}
	if listA[0].ID != assetAID || listA[0].ProjectID != scopeA.ProjectID || strings.TrimSpace(listA[0].SyncID) == "" {
		t.Fatalf("项目 A 资产元数据错误: %+v", listA[0])
	}
	listB, totalB, err := s.QueryCmdbAssetsForProject(scopeB, CmdbAssetQuery{Keyword: "同名核心资产", Page: 1, PageSize: 20})
	if err != nil || totalB != 1 || len(listB) != 1 || listB[0].ID != assetBID || listB[0].ProjectID != scopeB.ProjectID || listB[0].SyncID == "" {
		t.Fatalf("项目 B 资产列表隔离失败: total=%d list=%+v err=%v", totalB, listB, err)
	}
	if _, _, err := s.GetCmdbAssetForProject(scopeB, assetAID); !errors.Is(err, ErrProjectScopedNotFound) {
		t.Fatalf("项目 B 不得读取项目 A 资产详情，err=%v", err)
	}
	gotA, _, err := s.GetCmdbAssetForProject(scopeA, assetAID)
	if err != nil || gotA.ProjectID != scopeA.ProjectID || gotA.SyncID == "" {
		t.Fatalf("项目 A 资产详情元数据错误: asset=%+v err=%v", gotA, err)
	}
	if _, _, err := s.QueryCmdbAssetsForProject(ProjectScope{}, CmdbAssetQuery{}); err == nil {
		t.Fatal("无效项目范围必须显式报错")
	}
}

// 此测试会在手工写入、批量操作或删除入口未限制项目时失败。
func TestProjectScopeCmdbWritesOnlyAffectCurrentProject(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, scopeB := newCmdbProjectScopes(t, s)

	assetAID, err := s.CreateCmdbAssetManualForProject(scopeA, &CmdbAsset{ProjectID: scopeB.ProjectID, Name: "项目资产", Status: "在线"})
	if err != nil {
		t.Fatalf("创建项目 A 资产: %v", err)
	}
	assetBID, err := s.CreateCmdbAssetManualForProject(scopeB, &CmdbAsset{ProjectID: scopeA.ProjectID, Name: "项目资产", Status: "在线"})
	if err != nil {
		t.Fatalf("创建项目 B 资产: %v", err)
	}
	assetA, _, err := s.GetCmdbAssetForProject(scopeA, assetAID)
	if err != nil {
		t.Fatalf("读取项目 A 资产: %v", err)
	}
	assetA.Name = "项目 A 已更新"
	if err := s.UpdateCmdbAssetManualForProject(scopeA, assetA); err != nil {
		t.Fatalf("更新项目 A 资产: %v", err)
	}
	department := "项目 A 部门"
	if n, err := s.ApplyCmdbAssetChangesForProject(scopeA, []int64{assetAID}, CmdbAssetChanges{Department: &department}); err != nil || n != 1 {
		t.Fatalf("批量编辑项目 A 资产: n=%d err=%v", n, err)
	}
	if n, err := s.CloneCmdbAssetsForProject(scopeA, []int64{assetAID}); err != nil || n != 1 {
		t.Fatalf("克隆项目 A 资产: n=%d err=%v", n, err)
	}
	if n, err := s.ArchiveCmdbAssetsForProject(scopeA, []int64{assetAID}); err != nil || n != 1 {
		t.Fatalf("归档项目 A 资产: n=%d err=%v", n, err)
	}
	tempID, err := s.CreateCmdbAssetManualForProject(scopeA, &CmdbAsset{Name: "项目 A 待删除资产"})
	if err != nil {
		t.Fatalf("创建待删除资产: %v", err)
	}
	if err := s.DeleteCmdbAssetForProject(scopeA, tempID); err != nil {
		t.Fatalf("删除项目 A 资产: %v", err)
	}

	otherName := "不应跨项目更新"
	if _, err := s.ApplyCmdbAssetChangesForProject(scopeA, []int64{assetBID}, CmdbAssetChanges{Name: &otherName}); err == nil {
		t.Fatal("批量编辑不得修改其他项目资产")
	}
	if _, err := s.CloneCmdbAssetsForProject(scopeA, []int64{assetBID}); err == nil {
		t.Fatal("克隆不得读取其他项目资产")
	}
	if _, err := s.ArchiveCmdbAssetsForProject(scopeA, []int64{assetBID}); err == nil {
		t.Fatal("归档不得修改其他项目资产")
	}
	if err := s.DeleteCmdbAssetForProject(scopeA, assetBID); err == nil {
		t.Fatal("删除不得影响其他项目资产")
	}
	assetB, _, err := s.GetCmdbAssetForProject(scopeB, assetBID)
	if err != nil || assetB.Name != "项目资产" || assetB.Status != "在线" {
		t.Fatalf("项目 B 资产被跨项目操作修改: asset=%+v err=%v", assetB, err)
	}
	listA, totalA, err := s.QueryCmdbAssetsForProject(scopeA, CmdbAssetQuery{Page: 1, PageSize: 20})
	if err != nil || totalA != 2 || len(listA) != 2 {
		t.Fatalf("项目 A 应保留原资产和克隆资产: total=%d list=%+v err=%v", totalA, listA, err)
	}
	for _, asset := range listA {
		if asset.ProjectID != scopeA.ProjectID || asset.SyncID == "" {
			t.Fatalf("项目 A 写入的资产元数据错误: %+v", asset)
		}
	}
}

func insertScopedRelation(t *testing.T, s *Store, table string, projectID int64) int64 {
	t.Helper()
	var (
		res interface{ LastInsertId() (int64, error) }
		err error
	)
	switch table {
	case "cmdb_device_categories", "cmdb_orgs", "cmdb_groups":
		res, err = s.db.Exec("INSERT INTO "+table+"(project_id, name, parent_id, sort_order) VALUES (?, ?, 0, 0)", projectID, table+"-项目关系")
	case "cmdb_device_models":
		res, err = s.db.Exec("INSERT INTO "+table+"(project_id, vendor, model) VALUES (?, '跨项目厂商', '跨项目型号')", projectID)
	default:
		t.Fatalf("未知关系表: %s", table)
	}
	if err != nil {
		t.Fatalf("创建 %s 关系: %v", table, err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatalf("读取 %s 关系 ID: %v", table, err)
	}
	return id
}

// 此测试会在资产接受其他项目的分类、型号、组织、分组或人员 ID 时失败。
func TestProjectScopeCmdbRejectsCrossProjectRelations(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, scopeB := newCmdbProjectScopes(t, s)
	categoryB := insertScopedRelation(t, s, "cmdb_device_categories", scopeB.ProjectID)
	modelB := insertScopedRelation(t, s, "cmdb_device_models", scopeB.ProjectID)
	orgB := insertScopedRelation(t, s, "cmdb_orgs", scopeB.ProjectID)
	groupB := insertScopedRelation(t, s, "cmdb_groups", scopeB.ProjectID)
	personB, err := s.CreatePersonForProject(scopeB, &Person{Name: "跨项目负责人", Department: "项目 B 部门"})
	if err != nil {
		t.Fatalf("创建项目 B 人员: %v", err)
	}

	tests := []struct {
		name  string
		field string
		set   func(*CmdbAsset)
	}{
		{name: "分类", field: "分类", set: func(a *CmdbAsset) { a.CategoryID = categoryB }},
		{name: "型号", field: "型号", set: func(a *CmdbAsset) { a.ModelID = modelB }},
		{name: "组织", field: "组织", set: func(a *CmdbAsset) { a.OrgID = orgB }},
		{name: "分组", field: "分组", set: func(a *CmdbAsset) { a.GroupID = groupB }},
		{name: "人员", field: "人员", set: func(a *CmdbAsset) { a.OwnerID = personB }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			asset := &CmdbAsset{Name: "跨项目关系资产"}
			tt.set(asset)
			if _, err := s.CreateCmdbAssetManualForProject(scopeA, asset); err == nil || !strings.Contains(err.Error(), tt.field) {
				t.Fatalf("创建必须明确拒绝跨项目%s，err=%v", tt.field, err)
			}
		})
	}

	assetID, err := s.CreateCmdbAssetManualForProject(scopeA, &CmdbAsset{Name: "关系更新资产"})
	if err != nil {
		t.Fatalf("创建项目 A 基础资产: %v", err)
	}
	for _, tt := range tests {
		t.Run("更新"+tt.name, func(t *testing.T) {
			asset, _, err := s.GetCmdbAssetForProject(scopeA, assetID)
			if err != nil {
				t.Fatalf("读取项目 A 资产: %v", err)
			}
			tt.set(asset)
			if err := s.UpdateCmdbAssetManualForProject(scopeA, asset); err == nil || !strings.Contains(err.Error(), tt.field) {
				t.Fatalf("更新必须明确拒绝跨项目%s，err=%v", tt.field, err)
			}
		})
	}
	batchTests := []struct {
		name    string
		field   string
		changes CmdbAssetChanges
	}{
		{name: "分类", field: "分类", changes: CmdbAssetChanges{CategoryID: &categoryB}},
		{name: "组织", field: "组织", changes: CmdbAssetChanges{OrgID: &orgB}},
		{name: "分组", field: "分组", changes: CmdbAssetChanges{GroupID: &groupB}},
		{name: "人员", field: "人员", changes: CmdbAssetChanges{OwnerID: &personB}},
	}
	for _, tt := range batchTests {
		t.Run("批量"+tt.name, func(t *testing.T) {
			if _, err := s.ApplyCmdbAssetChangesForProject(scopeA, []int64{assetID}, tt.changes); err == nil || !strings.Contains(err.Error(), tt.field) {
				t.Fatalf("批量编辑必须明确拒绝跨项目%s，err=%v", tt.field, err)
			}
		})
	}
}

// 此测试会在人员 CRUD、名下资产、分配/解绑或批量交接遗漏项目校验时失败。
func TestProjectScopePersonIsolationAssignmentAndTransfer(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, scopeB := newCmdbProjectScopes(t, s)
	personA1, err := s.CreatePersonForProject(scopeA, &Person{ProjectID: scopeB.ProjectID, PersonCode: "SAME-PERSON", Name: "同名人员", Department: "项目 A 部门"})
	if err != nil {
		t.Fatalf("创建项目 A 人员: %v", err)
	}
	personA2, err := s.CreatePersonForProject(scopeA, &Person{Name: "项目 A 接收人", Department: "项目 A 新部门"})
	if err != nil {
		t.Fatalf("创建项目 A 接收人: %v", err)
	}
	personB, err := s.CreatePersonForProject(scopeB, &Person{ProjectID: scopeA.ProjectID, PersonCode: "SAME-PERSON", Name: "同名人员", Department: "项目 B 部门"})
	if err != nil {
		t.Fatalf("创建项目 B 人员: %v", err)
	}

	listA, totalA, err := s.ListPersonsForProject(scopeA, PersonQuery{Page: 1, PageSize: 20})
	if err != nil || totalA != 2 || len(listA) != 2 {
		t.Fatalf("项目 A 人员列表隔离失败: total=%d list=%+v err=%v", totalA, listA, err)
	}
	for _, person := range listA {
		if person.ProjectID != scopeA.ProjectID || person.SyncID == "" {
			t.Fatalf("项目 A 人员元数据错误: %+v", person)
		}
	}
	if _, err := s.GetPersonForProject(scopeA, personB); !errors.Is(err, ErrProjectScopedNotFound) {
		t.Fatalf("项目 A 不得读取项目 B 人员，err=%v", err)
	}
	person, err := s.GetPersonForProject(scopeA, personA1)
	if err != nil {
		t.Fatalf("读取项目 A 人员: %v", err)
	}
	person.Title = "项目 A 已更新"
	if err := s.UpdatePersonForProject(scopeA, person); err != nil {
		t.Fatalf("更新项目 A 人员: %v", err)
	}
	personBRecord, err := s.GetPersonForProject(scopeB, personB)
	if err != nil {
		t.Fatalf("读取项目 B 人员: %v", err)
	}
	personBRecord.Title = "不应更新"
	if err := s.UpdatePersonForProject(scopeA, personBRecord); err == nil {
		t.Fatal("不得跨项目更新人员")
	}
	if err := s.DeletePersonForProject(scopeA, personB); err == nil {
		t.Fatal("不得跨项目删除人员")
	}

	assetAID, err := s.CreateCmdbAssetManualForProject(scopeA, &CmdbAsset{Name: "同名人员资产", OwnerID: personA1, Owner: "同名人员", Department: "项目 A 部门", Interfaces: []CmdbAssetInterface{{Name: "eth0", IP: "10.10.1.1"}}})
	if err != nil {
		t.Fatalf("创建项目 A 人员资产: %v", err)
	}
	assetBID, err := s.CreateCmdbAssetManualForProject(scopeB, &CmdbAsset{Name: "同名人员资产", OwnerID: personB, Owner: "同名人员", Department: "项目 B 部门", Interfaces: []CmdbAssetInterface{{Name: "eth0", IP: "10.10.2.1"}}})
	if err != nil {
		t.Fatalf("创建项目 B 人员资产: %v", err)
	}
	_, assetsA, err := s.GetPersonAssetsForProject(scopeA, personA1)
	if err != nil || len(assetsA) != 1 || assetsA[0].ID != assetAID || assetsA[0].ProjectID != scopeA.ProjectID || len(assetsA[0].Interfaces) != 1 {
		t.Fatalf("项目 A 人员资产隔离失败: assets=%+v err=%v", assetsA, err)
	}
	if _, err := s.CreateCmdbAssetManualForProject(scopeA, &CmdbAsset{Name: "跨项目分配资产", OwnerID: personB}); err == nil {
		t.Fatal("创建资产不得分配给其他项目人员")
	}
	assetA, _, err := s.GetCmdbAssetForProject(scopeA, assetAID)
	if err != nil {
		t.Fatalf("读取项目 A 资产: %v", err)
	}
	assetA.OwnerID = personB
	if err := s.UpdateCmdbAssetManualForProject(scopeA, assetA); err == nil {
		t.Fatal("更新资产不得分配给其他项目人员")
	}
	zero := int64(0)
	if _, err := s.ApplyCmdbAssetChangesForProject(scopeA, []int64{assetBID}, CmdbAssetChanges{OwnerID: &zero}); err == nil {
		t.Fatal("解绑不得修改其他项目资产")
	}
	if _, err := s.TransferPersonAssetsForProject(scopeA, PersonTransferReq{FromPersonID: personA1, ToPersonID: personB}); err == nil {
		t.Fatal("批量交接不得使用其他项目接收人")
	}
	if _, err := s.TransferPersonAssetsForProject(scopeA, PersonTransferReq{FromPersonID: personA1, ToPersonID: personA2, AssetIDs: []int64{assetBID}}); err == nil {
		t.Fatal("批量交接不得使用其他项目资产")
	}
	orgB := insertScopedRelation(t, s, "cmdb_orgs", scopeB.ProjectID)
	groupB := insertScopedRelation(t, s, "cmdb_groups", scopeB.ProjectID)
	crossRelations := []struct {
		name   string
		column string
		label  string
		id     int64
	}{
		{name: "组织", column: "org_id", label: "组织", id: orgB},
		{name: "分组", column: "group_id", label: "分组", id: groupB},
	}
	for _, relation := range crossRelations {
		t.Run("拒绝跨项目"+relation.name+"关系", func(t *testing.T) {
			assetID, err := s.CreateCmdbAssetManualForProject(scopeA, &CmdbAsset{Name: "被污染关系资产-" + relation.name, OwnerID: personA1, Owner: "同名人员"})
			if err != nil {
				t.Fatalf("创建测试资产: %v", err)
			}
			if _, err := s.db.Exec("UPDATE cmdb_assets SET "+relation.column+" = ? WHERE id = ?", relation.id, assetID); err != nil {
				t.Fatalf("准备跨项目%s关系: %v", relation.name, err)
			}
			if _, err := s.ApplyCmdbAssetChangesForProject(scopeA, []int64{assetID}, CmdbAssetChanges{OwnerID: &zero}); err == nil || !strings.Contains(err.Error(), relation.label) {
				t.Fatalf("解绑必须拒绝跨项目%s关系，err=%v", relation.name, err)
			}
			if _, err := s.TransferPersonAssetsForProject(scopeA, PersonTransferReq{FromPersonID: personA1, ToPersonID: personA2, AssetIDs: []int64{assetID}}); err == nil || !strings.Contains(err.Error(), relation.label) {
				t.Fatalf("批量交接必须拒绝跨项目%s关系，err=%v", relation.name, err)
			}
		})
	}
	transferred, err := s.TransferPersonAssetsForProject(scopeA, PersonTransferReq{FromPersonID: personA1, ToPersonID: personA2, AssetIDs: []int64{assetAID}})
	if err != nil || transferred != 1 {
		t.Fatalf("项目 A 批量交接失败: transferred=%d err=%v", transferred, err)
	}
	_, assetsA2, err := s.GetPersonAssetsForProject(scopeA, personA2)
	if err != nil || len(assetsA2) != 1 || assetsA2[0].ID != assetAID {
		t.Fatalf("项目 A 接收人资产错误: assets=%+v err=%v", assetsA2, err)
	}
	_, assetsB, err := s.GetPersonAssetsForProject(scopeB, personB)
	if err != nil || len(assetsB) != 1 || assetsB[0].ID != assetBID {
		t.Fatalf("项目 B 人员资产被跨项目交接影响: assets=%+v err=%v", assetsB, err)
	}
	if err := s.DeletePersonForProject(scopeA, personA1); err != nil {
		t.Fatalf("删除项目 A 移交后人员: %v", err)
	}
}

// 此测试会在旧 API 不再转调默认项目，或接受对象中的 project_id 时失败。
func TestProjectScopeCmdbAndPersonDefaultCompatibility(t *testing.T) {
	s := newCmdbTestStore(t)
	defaultScope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatalf("读取默认项目: %v", err)
	}
	_, otherScope := newCmdbProjectScopes(t, s)

	defaultAssetID, err := s.CreateCmdbAssetManual(&CmdbAsset{ProjectID: otherScope.ProjectID, Name: "默认项目资产"})
	if err != nil {
		t.Fatalf("旧 API 创建默认项目资产: %v", err)
	}
	otherAssetID, err := s.CreateCmdbAssetManualForProject(otherScope, &CmdbAsset{Name: "其他项目资产"})
	if err != nil {
		t.Fatalf("创建其他项目资产: %v", err)
	}
	list, total, err := s.QueryCmdbAssets(CmdbAssetQuery{Page: 1, PageSize: 20})
	if err != nil || total != 1 || len(list) != 1 || list[0].ID != defaultAssetID || list[0].ProjectID != defaultScope.ProjectID {
		t.Fatalf("旧资产 API 未限定默认项目: total=%d list=%+v err=%v", total, list, err)
	}
	if _, _, err := s.GetCmdbAsset(otherAssetID); !errors.Is(err, ErrProjectScopedNotFound) {
		t.Fatalf("旧资产详情 API 不得读取其他项目，err=%v", err)
	}

	defaultPersonID, err := s.CreatePerson(&Person{ProjectID: otherScope.ProjectID, Name: "默认项目人员", Department: "默认部门"})
	if err != nil {
		t.Fatalf("旧 API 创建默认项目人员: %v", err)
	}
	otherPersonID, err := s.CreatePersonForProject(otherScope, &Person{Name: "其他项目人员", Department: "其他部门"})
	if err != nil {
		t.Fatalf("创建其他项目人员: %v", err)
	}
	persons, personTotal, err := s.ListPersons(PersonQuery{Page: 1, PageSize: 20})
	if err != nil || personTotal != 1 || len(persons) != 1 || persons[0].ID != defaultPersonID || persons[0].ProjectID != defaultScope.ProjectID {
		t.Fatalf("旧人员 API 未限定默认项目: total=%d persons=%+v err=%v", personTotal, persons, err)
	}
	if _, err := s.GetPerson(otherPersonID); !errors.Is(err, ErrProjectScopedNotFound) {
		t.Fatalf("旧人员详情 API 不得读取其他项目，err=%v", err)
	}
}
