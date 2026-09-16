package store

import (
	"strings"
	"testing"
)

func strPtr(s string) *string { return &s }

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
	if servers[0].AdminUser != "李四" || servers[0].Status != "维护中" {
		t.Fatalf("服务器台账未写穿（admin_user/status）: %+v", servers[0])
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
