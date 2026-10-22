package store

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"
)

func assertTerminalHardware(t *testing.T, got, want Asset) {
	t.Helper()
	if got.Vendor != want.Vendor || got.Model != want.Model || got.CPUInfo != want.CPUInfo || got.MemoryMB != want.MemoryMB || got.DiskInfo != want.DiskInfo {
		t.Fatalf("hardware mismatch: got=%+v want=%+v", got, want)
	}
}

func TestTerminalHardwareCreateUpdateListAndImport(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	for _, deviceType := range []string{"台式电脑", "笔记本", "打印机", "云桌面盒子"} {
		t.Run(deviceType, func(t *testing.T) {
			want := Asset{AssetCode: deviceType, DeviceType: deviceType, Vendor: "联想", Model: "开天 M630Z", CPUInfo: "兆芯 KX-U6780A", MemoryMB: 16384, DiskInfo: "512GB SSD", Status: "在用"}
			id, err := s.CreateAssetForProject(scope, &want, "测试")
			if err != nil {
				t.Fatal(err)
			}
			got, _, err := s.GetAssetForProject(scope, id)
			if err != nil {
				t.Fatal(err)
			}
			assertTerminalHardware(t, *got, want)
			got.Vendor, got.Model, got.CPUInfo, got.MemoryMB, got.DiskInfo = "华为", "擎云 L420", "麒麟 9006C", 32768, "1TB SSD"
			if err := s.UpdateAssetForProject(scope, got, "测试"); err != nil {
				t.Fatal(err)
			}
			list, total, err := s.QueryAssetsForProject(scope, AssetQuery{DeviceType: deviceType})
			if err != nil || total != 1 || len(list) != 1 {
				t.Fatalf("list=%+v total=%d err=%v", list, total, err)
			}
			assertTerminalHardware(t, list[0], *got)
			got.Vendor, got.Model, got.CPUInfo, got.MemoryMB, got.DiskInfo = "", "", "", 0, ""
			if err := s.UpdateAssetForProject(scope, got, "测试"); err != nil {
				t.Fatal(err)
			}
			cleared, _, err := s.GetAssetForProject(scope, id)
			if err != nil {
				t.Fatal(err)
			}
			assertTerminalHardware(t, *cleared, *got)
		})
	}
	imported := Asset{AssetCode: "IMPORT-HARDWARE", DeviceType: "笔记本", Vendor: "华为", Model: "擎云", CPUInfo: "麒麟", MemoryMB: 8192, DiskInfo: "256GB SSD", Status: "在用"}
	if err := s.ImportAssetsForProject(scope, []Asset{imported}); err != nil {
		t.Fatal(err)
	}
	list, total, err := s.QueryAssetsForProject(scope, AssetQuery{Keyword: imported.AssetCode})
	if err != nil || total != 1 || len(list) != 1 {
		t.Fatalf("list=%+v total=%d err=%v", list, total, err)
	}
	assertTerminalHardware(t, list[0], imported)
}

func TestTerminalHardwareRejectsNegativeMemoryWithoutWrites(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAssetForProject(scope, &Asset{AssetCode: "NEGATIVE", MemoryMB: -1}, "测试"); err == nil {
		t.Fatal("negative create accepted")
	}
	id := createLegacyAsset(t, s, Asset{AssetCode: "EXISTING", MemoryMB: 8192})
	asset, _, err := s.GetAssetForProject(scope, id)
	if err != nil {
		t.Fatal(err)
	}
	asset.MemoryMB = -1
	if err := s.UpdateAssetForProject(scope, asset, "测试"); err == nil {
		t.Fatal("negative update accepted")
	}
	if err := s.ImportAssetsForProject(scope, []Asset{{AssetCode: "VALID", MemoryMB: 4096}, {AssetCode: "INVALID", MemoryMB: -1}}); err == nil {
		t.Fatal("negative import accepted")
	}
	list, err := s.AllAssetsForProject(scope)
	if err != nil || len(list) != 1 || list[0].ID != id || list[0].MemoryMB != 8192 {
		t.Fatalf("failed writes changed assets: %+v err=%v", list, err)
	}
	if _, err := s.db.Exec(`UPDATE assets SET memory_mb=-1 WHERE id=?`, id); err == nil {
		t.Fatal("negative memory bypassed SQLite constraint")
	}
}

func TestTerminalHardwareMigratesExistingSQLiteAssets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old-terminal.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE assets (
		id INTEGER PRIMARY KEY AUTOINCREMENT, asset_code TEXT, device_type TEXT, box_sn TEXT, display_sn TEXT,
		user_name TEXT, department TEXT, room TEXT, ip TEXT, terminal_ip TEXT, security_software TEXT,
		status TEXT, net_type TEXT, remark TEXT, created_at TEXT, updated_at TEXT
	); INSERT INTO assets(asset_code,device_type,status) VALUES('OLD-PC','台式电脑','在用')`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	list, err := s.AllAssets()
	if err != nil || len(list) != 1 {
		t.Fatalf("list=%+v err=%v", list, err)
	}
	assertTerminalHardware(t, list[0], Asset{})
	list[0].Vendor, list[0].Model, list[0].CPUInfo, list[0].MemoryMB, list[0].DiskInfo = "联想", "M630Z", "兆芯", 16384, "512GB SSD"
	if err := s.UpdateAsset(&list[0], "测试"); err != nil {
		t.Fatal(err)
	}
	got, _, err := s.GetAsset(list[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	assertTerminalHardware(t, *got, list[0])
	if _, err := s.db.Exec(`UPDATE assets SET memory_mb=-1 WHERE id=?`, got.ID); err == nil {
		t.Fatal("migrated memory constraint missing")
	}
}

func TestTerminalHardwareLegacyMappingAndSnapshotRoundTrip(t *testing.T) {
	remote, remoteScope := openSnapshotTestStore(t)
	local, localScope := openSnapshotTestStore(t)
	project, err := remote.ResolveProject(remoteScope)
	if err != nil {
		t.Fatal(err)
	}
	alignSnapshotProject(t, local, localScope, project.SyncID)
	want := Asset{AssetCode: "HW-SNAPSHOT", DeviceType: "台式电脑", Vendor: "联想", Model: "M630Z", CPUInfo: "兆芯", MemoryMB: 16384, DiskInfo: "512GB SSD", Status: "在用"}
	id, err := remote.CreateAssetForProject(remoteScope, &want, "测试")
	if err != nil {
		t.Fatal(err)
	}
	result, err := remote.SyncLegacyToCmdbForProject(remoteScope)
	if err != nil || result.AssetInserted != 1 {
		t.Fatalf("mapping=%+v err=%v", result, err)
	}
	var mappedID int64
	if err := remote.db.QueryRow(`SELECT id FROM cmdb_assets WHERE project_id=? AND source_type='legacy_asset' AND source_id=?`, remoteScope.ProjectID, id).Scan(&mappedID); err != nil {
		t.Fatal(err)
	}
	mapped, _, err := remote.GetCmdbAssetForProject(remoteScope, mappedID)
	if err != nil {
		t.Fatal(err)
	}
	assertTerminalHardware(t, Asset{Vendor: mapped.Vendor, Model: mapped.Model, CPUInfo: mapped.CPUInfo, MemoryMB: mapped.MemoryMB, DiskInfo: mapped.DiskInfo}, want)
	want.ID, want.MemoryMB, want.DiskInfo = id, 32768, "1TB SSD"
	if err := remote.UpdateAssetForProject(remoteScope, &want, "测试"); err != nil {
		t.Fatal(err)
	}
	mapped, _, err = remote.GetCmdbAssetForProject(remoteScope, mappedID)
	if err != nil {
		t.Fatal(err)
	}
	assertTerminalHardware(t, Asset{Vendor: mapped.Vendor, Model: mapped.Model, CPUInfo: mapped.CPUInfo, MemoryMB: mapped.MemoryMB, DiskInfo: mapped.DiskInfo}, want)
	snapshot, err := remote.ExportCmdbSnapshot(remoteScope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	var records []map[string]any
	if err := json.Unmarshal(snapshot.Collections["assets"], &records); err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0]["vendor"] != want.Vendor || records[0]["memory_mb"] != float64(want.MemoryMB) {
		t.Fatalf("snapshot hardware missing: %+v", records)
	}
	if _, err := local.ApplyCmdbSnapshot(localScope, snapshot); err != nil {
		t.Fatal(err)
	}
	list, err := local.AllAssetsForProject(localScope)
	if err != nil || len(list) != 1 {
		t.Fatalf("list=%+v err=%v", list, err)
	}
	assertTerminalHardware(t, list[0], want)
	back, err := local.ExportCmdbSnapshot(localScope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for _, collection := range []string{"assets", "cmdb_assets"} {
		if err := json.Unmarshal(back.Collections[collection], &records); err != nil {
			t.Fatal(err)
		}
		if len(records) != 1 || records[0]["vendor"] != want.Vendor || records[0]["model"] != want.Model || records[0]["cpu_info"] != want.CPUInfo || records[0]["memory_mb"] != float64(want.MemoryMB) || records[0]["disk_info"] != want.DiskInfo {
			t.Fatalf("%s hardware lost: %+v", collection, records)
		}
	}
}
