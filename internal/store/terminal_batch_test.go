package store

import (
	"strings"
	"testing"
)

func TestTerminalBatchKeepsDuplicateHistoricalIPs(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	ids := []int64{}
	for _, code := range []string{"OLD-BATCH-1", "OLD-BATCH-2"} {
		ids = append(ids, createLegacyAsset(t, s, Asset{AssetCode: code, DeviceType: "云桌面终端", Status: "在用"}))
	}
	mustLegacyExec(t, s, `UPDATE assets SET ip='外网'`)
	osType, deviceType := "统信 UOS", "云桌面盒子"
	n, err := s.BatchUpdateTerminalAssetsForProject(scope, ids, TerminalAssetChanges{OSType: &osType, DeviceType: &deviceType}, "测试")
	if err != nil || n != 2 {
		t.Fatalf("历史重复 IP 不应阻断属性保存: n=%d err=%v", n, err)
	}
	for _, id := range ids {
		asset, logs, err := s.GetAsset(id)
		if err != nil || asset.IP != "外网" || asset.OSType != osType || asset.DeviceType != deviceType || len(logs) != 1 {
			t.Fatalf("批量修改未完整保存: %+v logs=%+v err=%v", asset, logs, err)
		}
	}
}

func TestTerminalBatchClearsCloudFieldsAndReleasesPhysicalIP(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	id := createLegacyAsset(t, s, Asset{AssetCode: "CLOUD-PC", DeviceType: "云桌面终端", DisplaySN: "DISPLAY", IP: "10.20.30.20", TerminalIP: "10.20.30.21", Status: "在用"})
	poolID, err := s.CreateIPEntry(&IPEntry{Subnet: "10.20.30.0/24", IP: "10.20.30.21", Status: "未用"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SyncLegacyToCmdb(); err != nil {
		t.Fatal(err)
	}
	deviceType := "台式电脑"
	if _, err := s.BatchUpdateTerminalAssetsForProject(scope, []int64{id}, TerminalAssetChanges{DeviceType: &deviceType}, "测试"); err != nil {
		t.Fatal(err)
	}
	asset, _, err := s.GetAsset(id)
	if err != nil || asset.IP != "10.20.30.20" || asset.TerminalIP != "" || asset.DisplaySN != "" {
		t.Fatalf("普通设备字段未归一化: %+v err=%v", asset, err)
	}
	pool, err := s.GetIPEntry(poolID)
	if err != nil || pool.OwnerID != 0 || pool.OwnerType != "" || pool.Status != "空闲" {
		t.Fatalf("原物理 IP 未释放: %+v err=%v", pool, err)
	}
}

func TestTerminalBatchRollsBackOnLogFailure(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	id := createLegacyAsset(t, s, Asset{AssetCode: "LOG-ROLLBACK", OSType: "Windows"})
	if _, err := s.SyncLegacyToCmdb(); err != nil {
		t.Fatal(err)
	}
	mustLegacyExec(t, s, `CREATE TRIGGER reject_batch_log BEFORE INSERT ON asset_logs BEGIN SELECT RAISE(ABORT, '拒绝履历写入'); END`)
	osType := "统信 UOS"
	if _, err := s.BatchUpdateTerminalAssetsForProject(scope, []int64{id}, TerminalAssetChanges{OSType: &osType}, "测试"); err == nil {
		t.Fatal("履历失败应返回错误")
	}
	asset, logs, err := s.GetAsset(id)
	if err != nil || asset.OSType != "Windows" || len(logs) != 0 {
		t.Fatalf("资产/履历未回滚: %+v logs=%+v err=%v", asset, logs, err)
	}
	var mapped string
	if err := s.db.QueryRow(`SELECT os_type FROM cmdb_assets WHERE source_type='legacy_asset' AND source_id=?`, id).Scan(&mapped); err != nil || mapped != "Windows" {
		t.Fatalf("镜像未回滚: %q err=%v", mapped, err)
	}
}

func TestLegacyAttributeUpdateDoesNotStealIPAndNewConflictsStillFail(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	id := createLegacyAsset(t, s, Asset{AssetCode: "LEGACY-CONFLICT", DeviceType: "台式电脑"})
	other := createLegacyAsset(t, s, Asset{AssetCode: "OTHER", IP: "10.20.30.22"})
	mustLegacyExec(t, s, `UPDATE assets SET ip='10.20.30.21' WHERE id=?`, id)
	mustLegacyExec(t, s, `INSERT INTO ip_pool(ip,status,owner_type,owner_id,owner_name) VALUES ('10.20.30.21','在用','infrastructure',999,'保留基础设施')`)
	asset, _, err := s.GetAsset(id)
	if err != nil {
		t.Fatal(err)
	}
	asset.OSType = "统信 UOS"
	if err := s.UpdateAsset(asset, "测试"); err != nil {
		t.Fatal(err)
	}
	var ownerType string
	var ownerID int64
	if err := s.db.QueryRow(`SELECT owner_type,owner_id FROM ip_pool WHERE ip='10.20.30.21'`).Scan(&ownerType, &ownerID); err != nil || ownerType != "infrastructure" || ownerID != 999 {
		t.Fatalf("抢占了其他对象 IP: %q %d err=%v", ownerType, ownerID, err)
	}
	asset.IP = "10.20.30.22"
	if err := s.UpdateAsset(asset, "测试"); err == nil || !strings.Contains(err.Error(), "已关联其他资产") {
		t.Fatalf("新地址仍应校验冲突: %v", err)
	}
	unchanged, _, err := s.GetAsset(id)
	if err != nil || unchanged.IP != "10.20.30.21" || unchanged.OSType != "统信 UOS" {
		t.Fatalf("冲突失败后记录被修改: %+v err=%v", unchanged, err)
	}
	if _, _, err := s.GetAsset(other); err != nil {
		t.Fatal(err)
	}
}
