package store

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRackRegistryPersistsEmptyRoomAndLiteralCabinetIdentity(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	room := &ConfigItem{Name: "任意位置", LocationType: "room", DataCenter: "任意位置"}
	if _, err := s.CreateConfigItem(scope, ConfigKindLocations, room); err != nil {
		t.Fatal(err)
	}
	cabinet := &ConfigItem{Name: "任意位置 (A (东区))", LocationType: "cabinet", DataCenter: "任意位置", CabinetName: "A (东区)", RackUnits: 47}
	if _, err := s.CreateConfigItem(scope, ConfigKindLocations, cabinet); err != nil {
		t.Fatal(err)
	}
	snapshot, err := s.ExportCmdbSnapshot(scope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	var records []map[string]any
	if err := json.Unmarshal(snapshot.Collections["cmdb_locations"], &records); err != nil {
		t.Fatal(err)
	}
	foundRoom, foundCabinet := false, false
	for _, record := range records {
		if record["location_type"] == "room" {
			foundRoom = record["data_center"] == "任意位置" && snapshotInt64(record["rack_units"]) == 0 && record["cabinet_name"] == ""
		}
		if record["location_type"] == "cabinet" {
			foundCabinet = record["cabinet_name"] == "A (东区)" && snapshotInt64(record["rack_units"]) == 47
		}
	}
	if !foundRoom || !foundCabinet {
		t.Fatalf("空机房和带括号机柜必须可同步: %+v", records)
	}
	path := s.path
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	items, err := reopened.ListConfigItems(scope, ConfigKindLocations)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].DataCenter != "任意位置" || items[1].DataCenter != "任意位置" {
		t.Fatalf("重开丢失位置身份: %+v", items)
	}
}

func TestRackRegistryRenameMovePreservesPlacementAndProjectIsolation(t *testing.T) {
	s := newCmdbTestStore(t)
	first, second := newCmdbProjectScopes(t, s)
	cabinet := &ConfigItem{Name: "甲区 (A)", LocationType: "cabinet", DataCenter: "甲区", CabinetName: "A", RackUnits: 20}
	if _, err := s.CreateConfigItem(first, ConfigKindLocations, cabinet); err != nil {
		t.Fatal(err)
	}
	ids := make([]int64, 0, 2)
	for _, scope := range []ProjectScope{first, second} {
		id, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "设备", DataCenter: "甲区", CabinetName: "A", StartU: 19, HeightU: 2, Remark: "保留备注"})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	cabinet.DataCenter, cabinet.CabinetName = "乙区", "B"
	if err := s.UpdateConfigItem(first, ConfigKindLocations, cabinet); err != nil {
		t.Fatal(err)
	}
	got, _, err := s.GetCmdbAssetForProject(first, ids[0])
	if err != nil {
		t.Fatal(err)
	}
	if got.DataCenter != "乙区" || got.CabinetName != "B" || got.StartU != 19 || got.UStart != 19 || got.HeightU != 2 || got.Remark != "保留备注" {
		t.Fatalf("改名移动损坏资产: %+v", got)
	}
	other, _, err := s.GetCmdbAssetForProject(second, ids[1])
	if err != nil {
		t.Fatal(err)
	}
	if other.DataCenter != "甲区" || other.CabinetName != "A" {
		t.Fatalf("修改越过项目边界: %+v", other)
	}
	items, _ := s.ListConfigItems(first, ConfigKindLocations)
	if len(items) != 1 || items[0].Name != "乙区 (B)" {
		t.Fatalf("目录未同步身份: %+v", items)
	}
	if err := s.UpdateConfigItem(second, ConfigKindLocations, cabinet); err == nil {
		t.Fatal("另一个项目不能修改机柜")
	}
}

func TestRackRegistryRejectsShrinkAndDestinationCollisionWithoutPartialWrites(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	cabinet := &ConfigItem{Name: "甲区 (A)", LocationType: "cabinet", DataCenter: "甲区", CabinetName: "A", RackUnits: 20}
	if _, err := s.CreateConfigItem(scope, ConfigKindLocations, cabinet); err != nil {
		t.Fatal(err)
	}
	id, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "顶层服务器", DataCenter: "甲区", CabinetName: "A", StartU: 19, HeightU: 2})
	if err != nil {
		t.Fatal(err)
	}
	short := *cabinet
	short.RackUnits = 19
	if err := s.UpdateConfigItem(scope, ConfigKindLocations, &short); err == nil || !strings.Contains(err.Error(), "20U") {
		t.Fatalf("缩小必须按最高占用校验: %v", err)
	}
	destination := &ConfigItem{Name: "乙区 (B)", LocationType: "cabinet", DataCenter: "乙区", CabinetName: "B", RackUnits: 20}
	if _, err := s.CreateConfigItem(scope, ConfigKindLocations, destination); err != nil {
		t.Fatal(err)
	}
	moved := *cabinet
	moved.DataCenter, moved.CabinetName = "乙区", "B"
	if err := s.UpdateConfigItem(scope, ConfigKindLocations, &moved); err == nil {
		t.Fatal("不得合并两个已有机柜")
	}
	got, _, _ := s.GetCmdbAssetForProject(scope, id)
	if got.DataCenter != "甲区" || got.CabinetName != "A" || got.StartU != 19 {
		t.Fatalf("失败部分修改资产: %+v", got)
	}
	items, _ := s.ListConfigItems(scope, ConfigKindLocations)
	for _, item := range items {
		if item.ID == cabinet.ID && (item.Name != "甲区 (A)" || item.RackUnits != 20) {
			t.Fatalf("失败部分修改目录: %+v", item)
		}
	}
}

func TestRackDevicePatchPreservesInterfacesAndReconcilesManagementAddress(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "管理", CIDR: "10.120.0.0/24"}); err != nil {
		t.Fatal(err)
	}
	id, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "设备", MgmtIP: "10.120.0.10", Remark: "隐藏字段", Interfaces: []CmdbAssetInterface{{Name: "业务口", IP: "10.120.0.11"}}})
	if err != nil {
		t.Fatal(err)
	}
	_, before, _ := s.GetCmdbAssetForProject(scope, id)
	code, vendor, model, ip := "NEW-CODE", "厂商", "型号", "10.120.0.12"
	if _, err := s.ApplyCmdbAssetChangesForProject(scope, []int64{id}, CmdbAssetChanges{AssetCode: &code, Vendor: &vendor, Model: &model, MgmtIP: &ip}); err != nil {
		t.Fatal(err)
	}
	got, interfaces, err := s.GetCmdbAssetForProject(scope, id)
	if err != nil {
		t.Fatal(err)
	}
	if got.AssetCode != code || got.Vendor != vendor || got.Model != model || got.MgmtIP != ip || got.ManageIP != ip || got.Remark != "隐藏字段" || len(interfaces) != 1 || interfaces[0].ID != before[0].ID || interfaces[0].IP != "10.120.0.11" {
		t.Fatalf("补丁丢失接口或其他字段: %+v %+v", got, interfaces)
	}
	var oldStatus, newType string
	var newOwner int64
	if err := s.db.QueryRow(`SELECT status FROM ip_pool WHERE project_id=? AND ip='10.120.0.10'`, scope.ProjectID).Scan(&oldStatus); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow(`SELECT owner_type,owner_id FROM ip_pool WHERE project_id=? AND ip=?`, scope.ProjectID, ip).Scan(&newType, &newOwner); err != nil {
		t.Fatal(err)
	}
	if oldStatus != "空闲" || newType != "infrastructure" || newOwner != id {
		t.Fatalf("管理 IP 占用未同步: old=%s new=%s/%d", oldStatus, newType, newOwner)
	}
	other, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "另一台", MgmtIP: "10.120.0.13"})
	if err != nil {
		t.Fatal(err)
	}
	conflict := "10.120.0.13"
	renamed := "不得保存"
	if _, err := s.ApplyCmdbAssetChangesForProject(scope, []int64{id}, CmdbAssetChanges{Name: &renamed, MgmtIP: &conflict}); err == nil {
		t.Fatal("冲突 IP 必须拒绝整条修改")
	}
	got, _, _ = s.GetCmdbAssetForProject(scope, id)
	if got.Name != "设备" || got.MgmtIP != ip {
		t.Fatalf("地址失败不得部分保存: %+v", got)
	}
	var owner int64
	if err := s.db.QueryRow(`SELECT owner_id FROM ip_pool WHERE project_id=? AND ip=?`, scope.ProjectID, conflict).Scan(&owner); err != nil || owner != other {
		t.Fatalf("冲突损坏另一台占用: %d %v", owner, err)
	}
}

func TestRackRegistryNumericNamesMatchCanonicalAssetAndSnapshot(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	item := &ConfigItem{Name: "甲区 (１－２－３机柜)", LocationType: "cabinet", DataCenter: "甲区", CabinetName: "１－２－３机柜", RackUnits: 47}
	if _, err := s.CreateConfigItem(scope, ConfigKindLocations, item); err != nil {
		t.Fatal(err)
	}
	id, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "服务器", DataCenter: "甲区", CabinetName: "１－２－３机柜", StartU: 46, HeightU: 2})
	if err != nil {
		t.Fatal(err)
	}
	asset, _, err := s.GetCmdbAssetForProject(scope, id)
	if err != nil {
		t.Fatal(err)
	}
	if item.CabinetName != asset.CabinetName || item.Name != qualifiedRackLocation(asset.DataCenter, asset.CabinetName) || item.CabinetName != "1-2-3机柜" {
		t.Fatalf("目录与资产不能分裂为两个机柜: %+v %+v", item, asset)
	}
	snapshot, err := s.ExportCmdbSnapshot(scope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.PreflightCmdbSnapshot(scope, snapshot); err != nil {
		t.Fatalf("新建机柜和资产必须可同步: %v", err)
	}
}
