package store

import (
	"strings"
	"testing"
)

func strPtr(s string) *string { return &s }

func int64Ptr(v int64) *int64 { return &v }

func customFieldsPtr(v map[string]interface{}) *map[string]interface{} { return &v }

func findCmdbBySource(t *testing.T, s *Store, sourceType string) *CmdbAsset {
	t.Helper()
	list, _, err := s.QueryCmdbAssets(CmdbAssetQuery{Page: 1, PageSize: 50})
	if err != nil {
		t.Fatalf("查询失败: %v", err)
	}
	for i := range list {
		if list[i].SourceType == sourceType {
			return &list[i]
		}
	}
	t.Fatalf("未找到 source_type=%s 的记录", sourceType)
	return nil
}

func TestApplyCmdbAssetChangesPersistsEditorFields(t *testing.T) {
	s := newCmdbTestStore(t)
	initialOrgID, err := s.CreateCmdbTaxonomy("orgs", "原组织", 0, 0)
	if err != nil {
		t.Fatalf("准备原组织失败: %v", err)
	}
	initialGroupID, err := s.CreateCmdbTaxonomy("groups", "原分组", 0, 0)
	if err != nil {
		t.Fatalf("准备原分组失败: %v", err)
	}
	initialCategoryID, err := s.CreateCmdbTaxonomy("categories", "原分类", 0, 0)
	if err != nil {
		t.Fatalf("准备原分类失败: %v", err)
	}
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{
		Name: "原设备", DeviceType: "server", Status: "在库", Department: "原部门", Owner: "原负责人",
		OrgID: initialOrgID, GroupID: initialGroupID, CategoryID: initialCategoryID, DataCenter: "原机房", Floor: "1F", CabinetName: "A01",
		Remark: "原备注", CustomFields: map[string]interface{}{"old": "value"},
	})
	if err != nil {
		t.Fatalf("准备资产失败: %v", err)
	}

	updatedOrgID, err := s.CreateCmdbTaxonomy("orgs", "新组织", 0, 0)
	if err != nil {
		t.Fatalf("准备新组织失败: %v", err)
	}
	updatedGroupID, err := s.CreateCmdbTaxonomy("groups", "新分组", 0, 0)
	if err != nil {
		t.Fatalf("准备新分组失败: %v", err)
	}
	updatedCategoryID, err := s.CreateCmdbTaxonomy("categories", "新分类", 0, 0)
	if err != nil {
		t.Fatalf("准备新分类失败: %v", err)
	}
	customFields := map[string]interface{}{"z": "末项", "a": float64(1)}
	changes := CmdbAssetChanges{
		Name: strPtr("新设备"), DeviceType: strPtr("network"), Status: strPtr("在线"),
		Department: strPtr("技术处"), Owner: strPtr("李四"), OwnerID: int64Ptr(0),
		OrgID: &updatedOrgID, GroupID: &updatedGroupID, CategoryID: &updatedCategoryID,
		DataCenter: strPtr("主机房"), Floor: strPtr("2F"), CabinetName: strPtr("B02"),
		Remark: strPtr("新备注"), CustomFields: customFieldsPtr(customFields),
	}
	n, err := s.ApplyCmdbAssetChanges([]int64{id}, changes)
	if err != nil {
		t.Fatalf("编辑失败: %v", err)
	}
	if n != 1 {
		t.Fatalf("应更新 1 条，实际 %d", n)
	}

	got, _, err := s.GetCmdbAsset(id)
	if err != nil {
		t.Fatalf("读取资产失败: %v", err)
	}
	if got.Name != "新设备" || got.DeviceType != "network" || got.Status != "在线" ||
		got.Department != "技术处" || got.Owner != "李四" || got.OwnerID != 0 ||
		got.OrgID != updatedOrgID || got.GroupID != updatedGroupID || got.CategoryID != updatedCategoryID ||
		got.DataCenter != "主机房" || got.Floor != "2F" || got.CabinetName != "B02" || got.Remark != "新备注" {
		t.Fatalf("编辑字段未完整持久化: %+v", got)
	}
	var raw string
	if err := s.db.QueryRow("SELECT custom_fields FROM cmdb_assets WHERE id = ?", id).Scan(&raw); err != nil {
		t.Fatalf("读取自定义字段原文失败: %v", err)
	}
	if raw != `{"a":1,"z":"末项"}` {
		t.Fatalf("自定义字段应稳定序列化，实际 %s", raw)
	}

	empty := map[string]interface{}{}
	if _, err := s.ApplyCmdbAssetChanges([]int64{id}, CmdbAssetChanges{CustomFields: &empty}); err != nil {
		t.Fatalf("清空自定义字段失败: %v", err)
	}
	if err := s.db.QueryRow("SELECT custom_fields FROM cmdb_assets WHERE id = ?", id).Scan(&raw); err != nil {
		t.Fatalf("读取清空后的自定义字段失败: %v", err)
	}
	if raw != `{}` {
		t.Fatalf("空对象应清空自定义字段，实际 %s", raw)
	}
}

func TestApplyCmdbAssetChangesResolvesOwnerID(t *testing.T) {
	s := newCmdbTestStore(t)
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "人员关联设备", Owner: "原负责人", Department: "原部门"})
	if err != nil {
		t.Fatalf("准备资产失败: %v", err)
	}
	personID, err := s.CreatePerson(&Person{Name: "王五", Department: "信息技术处"})
	if err != nil {
		t.Fatalf("准备人员失败: %v", err)
	}

	if _, err := s.ApplyCmdbAssetChanges([]int64{id}, CmdbAssetChanges{OwnerID: &personID}); err != nil {
		t.Fatalf("按人员 ID 编辑失败: %v", err)
	}
	got, _, _ := s.GetCmdbAsset(id)
	if got.OwnerID != personID || got.Owner != "王五" || got.Department != "信息技术处" {
		t.Fatalf("仅提供人员 ID 时应补齐姓名与部门: %+v", got)
	}

	customOwner := "临时负责人"
	if _, err := s.ApplyCmdbAssetChanges([]int64{id}, CmdbAssetChanges{OwnerID: &personID, Owner: &customOwner}); err != nil {
		t.Fatalf("保存明确负责人失败: %v", err)
	}
	got, _, _ = s.GetCmdbAsset(id)
	if got.Owner != customOwner {
		t.Fatalf("同时提供负责人时应按 payload 保存，实际 %q", got.Owner)
	}

	zero := int64(0)
	if _, err := s.ApplyCmdbAssetChanges([]int64{id}, CmdbAssetChanges{OwnerID: &zero}); err != nil {
		t.Fatalf("清空人员 ID 失败: %v", err)
	}
	got, _, _ = s.GetCmdbAsset(id)
	if got.OwnerID != 0 {
		t.Fatalf("人员 ID 应可清空为 0，实际 %d", got.OwnerID)
	}

	missing := personID + 9999
	if _, err := s.ApplyCmdbAssetChanges([]int64{id}, CmdbAssetChanges{OwnerID: &missing}); err == nil {
		t.Fatalf("不存在的人员 ID 必须报错")
	}
	got, _, _ = s.GetCmdbAsset(id)
	if got.OwnerID != 0 {
		t.Fatalf("校验失败后资产不得变化: %+v", got)
	}
}

func TestApplyCmdbAssetChangesClearsOwnerIDWhenOwnerChangesAlone(t *testing.T) {
	s := newCmdbTestStore(t)
	personID, err := s.CreatePerson(&Person{Name: "原负责人", Department: "原部门"})
	if err != nil {
		t.Fatalf("准备人员失败: %v", err)
	}
	assetID, err := s.CreateCmdbAssetManual(&CmdbAsset{
		Name: "人员解绑设备", Owner: "原负责人", OwnerID: personID, Department: "原部门",
	})
	if err != nil {
		t.Fatalf("准备资产失败: %v", err)
	}

	newOwner := "批量文本负责人"
	if _, err := s.ApplyCmdbAssetChanges([]int64{assetID}, CmdbAssetChanges{Owner: &newOwner}); err != nil {
		t.Fatalf("修改文本负责人失败: %v", err)
	}
	got, _, err := s.GetCmdbAsset(assetID)
	if err != nil {
		t.Fatalf("读取资产失败: %v", err)
	}
	if got.Owner != newOwner || got.OwnerID != 0 {
		t.Fatalf("仅修改文本负责人时必须清除旧人员绑定: %+v", got)
	}
	_, assets, err := s.GetPersonAssets(personID)
	if err != nil {
		t.Fatalf("查询旧人员名下资产失败: %v", err)
	}
	if len(assets) != 0 {
		t.Fatalf("解绑后资产不应继续出现在旧人员名下: %+v", assets)
	}
}

func TestApplyCmdbAssetChangesRollsBackBatch(t *testing.T) {
	s := newCmdbTestStore(t)
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "事务设备", Status: "在库"})
	if err != nil {
		t.Fatalf("准备资产失败: %v", err)
	}

	newName := "不应提交的名称"
	n, err := s.ApplyCmdbAssetChanges([]int64{id, id + 9999}, CmdbAssetChanges{Name: &newName})
	if err == nil {
		t.Fatalf("批量包含不存在 ID 时必须报错")
	}
	if n != 0 {
		t.Fatalf("事务失败时已应用条数应为 0，实际 %d", n)
	}
	got, _, getErr := s.GetCmdbAsset(id)
	if getErr != nil {
		t.Fatalf("读取资产失败: %v", getErr)
	}
	if got.Name != "事务设备" {
		t.Fatalf("批量失败后首条更新必须回滚，实际名称 %q", got.Name)
	}
}

func TestApplyCmdbAssetChangesRollsBackWhenSourceWriteFails(t *testing.T) {
	s, err := Open(t.TempDir() + "/cmdb_source_rollback_test.db")
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer s.Close()
	if _, err := s.CreateAsset(&Asset{AssetCode: "ZC-TX-1", UserName: "原使用人", Status: "在用"}, "测试"); err != nil {
		t.Fatalf("准备源资产失败: %v", err)
	}
	if _, err := s.SyncLegacyToCmdb(); err != nil {
		t.Fatalf("同步失败: %v", err)
	}
	row := findCmdbBySource(t, s, "legacy_asset")
	if _, err := s.db.Exec(`CREATE TRIGGER reject_legacy_asset_update BEFORE UPDATE ON assets BEGIN SELECT RAISE(ABORT, '拒绝源台账更新'); END`); err != nil {
		t.Fatalf("准备失败触发器失败: %v", err)
	}

	newName, newOwner := "不应提交的名称", "不应提交的使用人"
	if n, err := s.ApplyCmdbAssetChanges([]int64{row.ID}, CmdbAssetChanges{Name: &newName, Owner: &newOwner}); err == nil {
		t.Fatalf("源台账写入失败时必须返回错误")
	} else if n != 0 {
		t.Fatalf("事务失败时已应用条数应为 0，实际 %d", n)
	}
	got, _, err := s.GetCmdbAsset(row.ID)
	if err != nil {
		t.Fatalf("读取 CMDB 资产失败: %v", err)
	}
	if got.Name != row.Name || got.Owner != "原使用人" {
		t.Fatalf("源台账写入失败时 CMDB 更新必须回滚: %+v", got)
	}
	assets, err := s.AllAssets()
	if err != nil || len(assets) != 1 || assets[0].UserName != "原使用人" {
		t.Fatalf("源台账应保持不变: assets=%+v err=%v", assets, err)
	}
}

func TestApplyCmdbAssetChangesRollsBackWhenMappedSourceIsMissing(t *testing.T) {
	tests := []struct {
		name       string
		sourceType string
		prepare    func(*testing.T, *Store)
		table      string
	}{
		{
			name:       "旧终端台账",
			sourceType: "legacy_asset",
			prepare: func(t *testing.T, s *Store) {
				t.Helper()
				if _, err := s.CreateAsset(&Asset{AssetCode: "ZC-MISSING", UserName: "原使用人", Status: "在用"}, "测试"); err != nil {
					t.Fatalf("准备终端失败: %v", err)
				}
			},
			table: "assets",
		},
		{
			name:       "旧服务器台账",
			sourceType: "legacy_server",
			prepare: func(t *testing.T, s *Store) {
				t.Helper()
				if _, err := s.CreateServer(&PhysicalServer{DeviceName: "缺失来源服务器", AdminUser: "原管理员", Status: "运行中"}, "测试"); err != nil {
					t.Fatalf("准备服务器失败: %v", err)
				}
			},
			table: "servers",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newCmdbTestStore(t)
			tt.prepare(t, s)
			if _, err := s.SyncLegacyToCmdb(); err != nil {
				t.Fatalf("同步失败: %v", err)
			}
			row := findCmdbBySource(t, s, tt.sourceType)
			if _, err := s.db.Exec("DELETE FROM "+tt.table+" WHERE id = ?", row.SourceID); err != nil {
				t.Fatalf("删除来源行失败: %v", err)
			}

			newOwner := "不应提交的负责人"
			n, err := s.ApplyCmdbAssetChanges([]int64{row.ID}, CmdbAssetChanges{Owner: &newOwner})
			if err == nil || !strings.Contains(err.Error(), "来源记录") || !strings.Contains(err.Error(), "不存在") {
				t.Fatalf("来源行不存在时必须返回明确错误，实际 %v", err)
			}
			if n != 0 {
				t.Fatalf("事务失败时已应用条数应为 0，实际 %d", n)
			}
			got, _, getErr := s.GetCmdbAsset(row.ID)
			if getErr != nil {
				t.Fatalf("读取 CMDB 资产失败: %v", getErr)
			}
			if got.Owner != row.Owner || got.OwnerID != row.OwnerID {
				t.Fatalf("来源缺失时 CMDB 变更必须回滚: before=%+v after=%+v", row, got)
			}
		})
	}
}

func TestApplyCmdbAssetChangesRejectsInvalidCustomFields(t *testing.T) {
	s := newCmdbTestStore(t)
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "自定义字段设备", CustomFields: map[string]interface{}{"valid": "value"}})
	if err != nil {
		t.Fatalf("准备资产失败: %v", err)
	}
	invalid := map[string]interface{}{"unsupported": make(chan int)}
	if _, err := s.ApplyCmdbAssetChanges([]int64{id}, CmdbAssetChanges{CustomFields: &invalid}); err == nil || !strings.Contains(err.Error(), "自定义字段序列化失败") {
		t.Fatalf("不可编码值必须返回明确错误，实际 %v", err)
	}
	var raw string
	if err := s.db.QueryRow("SELECT custom_fields FROM cmdb_assets WHERE id = ?", id).Scan(&raw); err != nil {
		t.Fatalf("读取自定义字段失败: %v", err)
	}
	if raw != `{"valid":"value"}` {
		t.Fatalf("序列化失败后原值必须保持不变，实际 %s", raw)
	}
}

// 批量编辑映射来的记录时，必须反向写穿回源台账，避免两边分叉。
func TestCmdbBatchEditWritesThroughToLegacyLedger(t *testing.T) {
	s, err := Open(t.TempDir() + "/cmdb_write_test.db")
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer s.Close()

	if _, err := s.CreateAsset(&Asset{
		AssetCode: "ZC-W-1", UserName: "张三", Department: "立案庭", IP: "138.64.7.10", Status: "在用",
	}, "测试"); err != nil {
		t.Fatalf("准备资产失败: %v", err)
	}
	if _, err := s.CreateServer(&PhysicalServer{
		DeviceName: "SRV-1", AssetCode: "SRV-W-1", BizIP: "172.16.7.21", Status: "运行中", Location: "中心机房",
	}, "测试"); err != nil {
		t.Fatalf("准备服务器失败: %v", err)
	}
	if _, err := s.SyncLegacyToCmdb(); err != nil {
		t.Fatalf("同步失败: %v", err)
	}

	assetRow := findCmdbBySource(t, s, "legacy_asset")
	serverRow := findCmdbBySource(t, s, "legacy_server")

	// 批量编辑：部门 / 负责人 / 状态 / 备注 + 纯 CMDB 字段（所属组织）
	orgID, err := s.CreateCmdbTaxonomy("orgs", "执行局", 0, 0)
	if err != nil {
		t.Fatalf("新增组织失败: %v", err)
	}
	n, err := s.ApplyCmdbAssetChanges([]int64{assetRow.ID, serverRow.ID}, CmdbAssetChanges{
		Name:       strPtr("统一资源名称"),
		Department: strPtr("执行局"),
		Owner:      strPtr("李四"),
		Status:     strPtr("维护中"),
		OrgID:      &orgID,
	})
	if err != nil {
		t.Fatalf("批量编辑失败: %v", err)
	}
	if n != 2 {
		t.Fatalf("应处理 2 条，实际 %d", n)
	}

	// CMDB 侧
	got, _, _ := s.GetCmdbAsset(assetRow.ID)
	if got.Department != "执行局" || got.Owner != "李四" || got.Status != "维护中" || got.OrgID != orgID {
		t.Fatalf("CMDB 侧未更新: %+v", got)
	}

	// 源台账侧（写穿）
	assets, _ := s.AllAssets()
	if len(assets) != 1 {
		t.Fatalf("源台账应仍有 1 台终端，实际 %d", len(assets))
	}
	if assets[0].Department != "执行局" || assets[0].UserName != "李四" || assets[0].Status != "维修中" {
		t.Fatalf("终端台账未写穿（department/user_name/status）: %+v", assets[0])
	}

	servers, _ := s.AllServers()
	if len(servers) != 1 {
		t.Fatalf("源台账应仍有 1 台服务器，实际 %d", len(servers))
	}
	if servers[0].DeviceName != "统一资源名称" || servers[0].AdminUser != "李四" || servers[0].Status != "维护中" {
		t.Fatalf("服务器台账未写穿（device_name/admin_user/status）: %+v", servers[0])
	}
}

// 空值不写穿：在 CMDB 清空字段不得抹掉源台账里的真实信息。
func TestCmdbWriteThroughSkipsEmptyValues(t *testing.T) {
	s, err := Open(t.TempDir() + "/cmdb_empty_test.db")
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer s.Close()

	if _, err := s.CreateAsset(&Asset{
		AssetCode: "ZC-E-1", UserName: "邹婷婷", Department: "民三", Status: "在用",
	}, "测试"); err != nil {
		t.Fatalf("准备资产失败: %v", err)
	}
	if _, err := s.SyncLegacyToCmdb(); err != nil {
		t.Fatalf("同步失败: %v", err)
	}
	row := findCmdbBySource(t, s, "legacy_asset")

	// 同步应带上负责人
	if row.Owner != "邹婷婷" {
		t.Fatalf("同步应把使用人映射为负责人，实际 [%s]", row.Owner)
	}

	// 传空值：CMDB 记录会被清空，但源台账必须保持不变
	if _, err := s.ApplyCmdbAssetChanges([]int64{row.ID}, CmdbAssetChanges{Owner: strPtr(""), Department: strPtr("")}); err != nil {
		t.Fatalf("编辑失败: %v", err)
	}
	got, _, _ := s.GetCmdbAsset(row.ID)
	if got.Owner != "" || got.Department != "" {
		t.Fatalf("CMDB 侧应被清空: %+v", got)
	}
	assets, _ := s.AllAssets()
	if assets[0].UserName != "邹婷婷" || assets[0].Department != "民三" {
		t.Fatalf("空值不得写穿到源台账，实际 %+v", assets[0])
	}
}

// 历史映射遗漏的负责人必须能被补齐，且幂等。
func TestBackfillLegacyAssetOwner(t *testing.T) {
	s, err := Open(t.TempDir() + "/cmdb_backfill_test.db")
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer s.Close()

	if _, err := s.CreateAsset(&Asset{AssetCode: "ZC-B-1", UserName: "张三", Department: "立案庭"}, "测试"); err != nil {
		t.Fatalf("准备资产失败: %v", err)
	}
	if _, err := s.SyncLegacyToCmdb(); err != nil {
		t.Fatalf("同步失败: %v", err)
	}
	row := findCmdbBySource(t, s, "legacy_asset")

	// 模拟「早期映射遗漏」：把负责人清空
	if _, err := s.db.Exec(`UPDATE cmdb_assets SET owner='' WHERE id=?`, row.ID); err != nil {
		t.Fatalf("准备失败: %v", err)
	}
	n, err := s.BackfillLegacyAssetOwner()
	if err != nil {
		t.Fatalf("补齐失败: %v", err)
	}
	if n != 1 {
		t.Fatalf("应补齐 1 条，实际 %d", n)
	}
	got, _, _ := s.GetCmdbAsset(row.ID)
	if got.Owner != "张三" {
		t.Fatalf("补齐后负责人应为张三，实际 [%s]", got.Owner)
	}
	if again, err := s.BackfillLegacyAssetOwner(); err != nil {
		t.Fatalf("重复补齐失败: %v", err)
	} else if again != 0 {
		t.Fatalf("重复补齐应为 0，实际 %d", again)
	}
}

func TestCmdbBatchEditOnManualRecordDoesNotTouchLedger(t *testing.T) {
	s := newCmdbTestStore(t)

	manualID, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "手工登记交换机", Status: "在线"})
	if err != nil {
		t.Fatalf("新增失败: %v", err)
	}
	if _, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "   "}); err == nil {
		t.Fatalf("空名称必须报错")
	}

	if _, err := s.ApplyCmdbAssetChanges([]int64{manualID}, CmdbAssetChanges{Department: strPtr("技术处")}); err != nil {
		t.Fatalf("编辑失败: %v", err)
	}
	got, _, _ := s.GetCmdbAsset(manualID)
	if got.Department != "技术处" {
		t.Fatalf("CMDB 记录未更新: %+v", got)
	}
	if assets, _ := s.AllAssets(); len(assets) != 0 {
		t.Fatalf("纯 CMDB 记录不应影响源台账，实际 %d 条", len(assets))
	}
}

func TestCmdbBatchArchiveAndClone(t *testing.T) {
	s := newCmdbTestStore(t)
	a, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "A 设备", AssetCode: "ZC-A", SN: "SN-A", Status: "在线"})
	if err != nil {
		t.Fatalf("新增失败: %v", err)
	}
	b, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "B 设备", Status: "在线"})
	if err != nil {
		t.Fatalf("新增失败: %v", err)
	}

	// 批量归档
	n, err := s.ArchiveCmdbAssets([]int64{a, b})
	if err != nil {
		t.Fatalf("批量归档失败: %v", err)
	}
	if n != 2 {
		t.Fatalf("应归档 2 条，实际 %d", n)
	}
	got, _, _ := s.GetCmdbAsset(a)
	if got.Status != "报废" {
		t.Fatalf("归档后状态应为报废，实际 %s", got.Status)
	}

	// 批量克隆：编号/SN/管理IP 必须清空，来源必须为 manual
	n, err = s.CloneCmdbAssets([]int64{a})
	if err != nil {
		t.Fatalf("批量克隆失败: %v", err)
	}
	if n != 1 {
		t.Fatalf("应克隆 1 条，实际 %d", n)
	}
	list, total, _ := s.QueryCmdbAssets(CmdbAssetQuery{Keyword: "副本", Page: 1, PageSize: 10})
	if total != 1 {
		t.Fatalf("应能按「副本」搜到 1 条，实际 %d", total)
	}
	cp := list[0]
	if cp.AssetCode != "" || cp.SN != "" || cp.MgmtIP != "" {
		t.Fatalf("克隆应清空编号/SN/管理IP: %+v", cp)
	}
	if cp.SourceType != "manual" || cp.SourceID != 0 {
		t.Fatalf("克隆记录来源应为 manual: %+v", cp)
	}

	// 空选择必须报错
	if _, err := s.CloneCmdbAssets(nil); err == nil {
		t.Fatalf("未选择资产时必须报错")
	}
	status := "在线"
	if _, err := s.ApplyCmdbAssetChanges([]int64{a}, CmdbAssetChanges{}); err == nil {
		t.Fatalf("没有变更字段时必须报错")
	}
	_ = status
}

func TestCmdbDeleteGuardsMappedRecords(t *testing.T) {
	s, err := Open(t.TempDir() + "/cmdb_delete_test.db")
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer s.Close()

	if _, err := s.CreateAsset(&Asset{AssetCode: "ZC-D-1", UserName: "张三", Status: "在用"}, "测试"); err != nil {
		t.Fatalf("准备资产失败: %v", err)
	}
	if _, err := s.SyncLegacyToCmdb(); err != nil {
		t.Fatalf("同步失败: %v", err)
	}
	mapped := findCmdbBySource(t, s, "legacy_asset")

	err = s.DeleteCmdbAsset(mapped.ID)
	if err == nil {
		t.Fatalf("映射来的记录必须拒绝删除")
	}
	if !strings.Contains(err.Error(), "云桌面终端台账") || !strings.Contains(err.Error(), "下次同步会重新出现") {
		t.Fatalf("错误信息应说明来源与后果，实际: %v", err)
	}
	if _, _, err := s.GetCmdbAsset(mapped.ID); err != nil {
		t.Fatalf("拒绝删除后记录应仍存在: %v", err)
	}

	// 纯 CMDB 记录可以删除
	manualID, _ := s.CreateCmdbAssetManual(&CmdbAsset{Name: "临时设备"})
	if err := s.DeleteCmdbAsset(manualID); err != nil {
		t.Fatalf("纯 CMDB 记录应可删除: %v", err)
	}
	if _, _, err := s.GetCmdbAsset(manualID); err == nil {
		t.Fatalf("删除后不应再查到")
	}
}
