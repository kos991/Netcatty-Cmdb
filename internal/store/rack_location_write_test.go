package store

import (
	"encoding/json"
	"testing"
)

func TestRackLocationNewWritesSplitLegacyInputAndPreserveExplicitRoom(t *testing.T) {
	for _, insert := range []bool{false, true} {
		s := newCmdbTestStore(t)
		scope, _ := s.DefaultProjectScope()
		asset := &CmdbAsset{Name: "服务器", CabinetName: "甲机房（１－２机柜）", UStart: 10, HeightU: 2}
		var id int64
		var err error
		if insert {
			id, err = s.InsertCmdbAssetForProject(scope, asset)
		} else {
			id, err = s.CreateCmdbAssetManualForProject(scope, asset)
		}
		if err != nil {
			t.Fatal(err)
		}
		got, _, _ := s.GetCmdbAssetForProject(scope, id)
		if got.DataCenter != "甲机房" || got.CabinetName != "1-2机柜" || got.CabinetPos != "" || got.StartU != 10 || got.UStart != 10 {
			t.Fatalf("新增写入不得保留混合字段: %+v", got)
		}
		bad := &CmdbAsset{Name: "冲突位置", DataCenter: "乙机房", CabinetName: "甲机房 (1-2机柜)"}
		if insert {
			_, err = s.InsertCmdbAssetForProject(scope, bad)
		} else {
			_, err = s.CreateCmdbAssetManualForProject(scope, bad)
		}
		if err == nil {
			t.Fatal("新增不得覆盖现有非空机房")
		}
	}
}

func TestRackLocationExplicitZeroAndCabinetClearNeverResurrectLegacyUPosition(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	id, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "服务器", DataCenter: "甲机房", CabinetName: "1-1机柜", StartU: 10, HeightU: 2})
	if err != nil {
		t.Fatal(err)
	}
	asset, _, _ := s.GetCmdbAssetForProject(scope, id)
	asset.StartU = 0 // stale client still sends legacy u_start=10.
	if err := s.UpdateCmdbAssetManualForProject(scope, asset); err != nil {
		t.Fatal(err)
	}
	asset, _, _ = s.GetCmdbAssetForProject(scope, id)
	if asset.StartU != 0 || asset.UStart != 0 {
		t.Fatalf("全量保存的零U不得恢复旧U: %+v", asset)
	}
	start := int64(12)
	if _, err := s.ApplyCmdbAssetChangesForProject(scope, []int64{id}, CmdbAssetChanges{StartU: &start}); err != nil {
		t.Fatal(err)
	}
	empty := ""
	if _, err := s.ApplyCmdbAssetChangesForProject(scope, []int64{id}, CmdbAssetChanges{CabinetName: &empty}); err != nil {
		t.Fatal(err)
	}
	asset, _, _ = s.GetCmdbAssetForProject(scope, id)
	if asset.DataCenter != "甲机房" || asset.CabinetName != "" || asset.CabinetPos != "" || asset.StartU != 0 || asset.UStart != 0 {
		t.Fatalf("移出机柜须保留机房并清除两套U: %+v", asset)
	}
}

func TestRackLocationBatchNormalizesInputAndRollsBackConflictingRoom(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	first, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "第一台"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "第二台", DataCenter: "乙机房"})
	if err != nil {
		t.Fatal(err)
	}
	cabinet := "甲机房 (1－1机柜)"
	if _, err := s.ApplyCmdbAssetChangesForProject(scope, []int64{first, second}, CmdbAssetChanges{CabinetName: &cabinet}); err == nil {
		t.Fatal("批量歧义应整批失败")
	}
	got, _, _ := s.GetCmdbAssetForProject(scope, first)
	if got.DataCenter != "" || got.CabinetName != "" {
		t.Fatalf("批量失败不得部分保存: %+v", got)
	}
	if _, err := s.ApplyCmdbAssetChangesForProject(scope, []int64{first}, CmdbAssetChanges{CabinetName: &cabinet}); err != nil {
		t.Fatal(err)
	}
	got, _, _ = s.GetCmdbAssetForProject(scope, first)
	if got.DataCenter != "甲机房" || got.CabinetName != "1-1机柜" || got.CabinetPos != "" {
		t.Fatalf("批量不得写入旧位置格式: %+v", got)
	}
}

func TestRackLocationLegacySyncSplitsNewProjectionWithoutChangingSourceMetadata(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	serverID, err := s.CreateServerForProject(scope, &PhysicalServer{DeviceName: "旧服务器", Location: "甲机房 (1－1机柜)"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SyncLegacyToCmdbForProject(scope); err != nil {
		t.Fatal(err)
	}
	list, _, err := s.QueryCmdbAssetsForProject(scope, CmdbAssetQuery{Page: 1, PageSize: 100})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, got := range list {
		if got.SourceType != "legacy_server" || got.SourceID != serverID {
			continue
		}
		found = true
		if got.DataCenter != "甲机房" || got.CabinetName != "1-1机柜" || got.CabinetPos != "" {
			t.Fatalf("同步新投影不得恢复混合位置: %+v", got)
		}
	}
	if !found {
		t.Fatal("同步未保留旧来源身份")
	}
}

func TestRackLocationSnapshotImportRejectsLegacyCombinedInputBeforeMutation(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	insertLegacyRackFixture(t, s, scope, "", "甲机房 (1－1机柜)", "", 3)
	snapshot, err := s.ExportCmdbSnapshot(scope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ApplyCmdbSnapshot(scope, snapshot); err == nil {
		t.Fatal("快照必须要求来源迁移，不能写回旧格式")
	}
	preview := mustRackPreview(t, s, scope)
	if _, err := s.ApplyRackMigration(scope, preview.Token); err != nil {
		t.Fatal(err)
	}
	canonical, err := s.ExportCmdbSnapshot(scope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.PreflightCmdbSnapshot(scope, canonical); err != nil {
		t.Fatalf("迁移后快照应可同步: %v", err)
	}
	var records []map[string]any
	if err := json.Unmarshal(canonical.Collections["cmdb_assets"], &records); err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || snapshotString(records[0]["cabinet_name"]) != "1-1机柜" || snapshotString(records[0]["cabinet_pos"]) != "" {
		t.Fatalf("迁移后的导出包含旧位置: %+v", records)
	}
}

func TestRackLocationStartupDoesNotAutomaticallySplitLegacyData(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	id := insertLegacyRackFixture(t, s, scope, "", "甲机房 (1－1机柜)", "", 3)
	path := s.path
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	got, _, _ := reopened.GetCmdbAssetForProject(scope, id)
	if got.DataCenter != "" || got.CabinetName != "甲机房 (1－1机柜)" {
		t.Fatalf("启动不得未经预览确认迁移: %+v", got)
	}
}

func TestRackLocationExplicitRoomAndCabinetParenthesesRemainLiteral(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	id, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{
		Name: "自定义名称服务器", DataCenter: "机房（东区）", CabinetName: "A (测试柜)",
	})
	if err != nil {
		t.Fatal(err)
	}
	got, _, err := s.GetCmdbAssetForProject(scope, id)
	if err != nil || got.DataCenter != "机房（东区）" || got.CabinetName != "A (测试柜)" {
		t.Fatalf("显式机房机柜名称不得重复启发式拆分: %+v %v", got, err)
	}
	if _, err := s.CreateConfigItem(scope, ConfigKindLocations, &ConfigItem{
		Name: "机房（东区） (A (测试柜))", RackUnits: 47,
	}); err != nil {
		t.Fatal(err)
	}
	preview := mustRackPreview(t, s, scope)
	if preview.Total != 0 || len(preview.Conflicts) != 0 {
		t.Fatalf("自定义规范位置不需要迁移: %+v", preview)
	}
	zero := int64(0)
	if _, err := s.ApplyCmdbAssetChangesForProject(scope, []int64{id}, CmdbAssetChanges{StartU: &zero}); err != nil {
		t.Fatalf("自定义规范机柜必须仍可上/下架: %v", err)
	}
}
