package store

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestCmdbInterfaceAdditionalPurposesSurviveCreateAndEdit(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "interface-addresses.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var iface CmdbAssetInterface
	if err := json.Unmarshal([]byte(`{"name":"eth0","ip":"192.0.2.10","additional_ips_json":"[{\"ip\":\"192.0.2.11\",\"purpose\":\"out_of_band\"}]"}`), &iface); err != nil {
		t.Fatal(err)
	}
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "安全设备", MgmtIP: "192.0.2.1", Interfaces: []CmdbAssetInterface{iface}})
	if err != nil {
		t.Fatal(err)
	}
	asset, ifaces, err := s.GetCmdbAsset(id)
	if err != nil {
		t.Fatal(err)
	}
	if len(ifaces) != 1 {
		t.Fatalf("接口数错误: %+v", ifaces)
	}
	encoded, _ := json.Marshal(ifaces[0])
	var actual map[string]interface{}
	if err := json.Unmarshal(encoded, &actual); err != nil {
		t.Fatal(err)
	}
	if _, hasPurpose := actual["purpose"]; hasPurpose || actual["additional_ips_json"] != `[{"ip":"192.0.2.11","purpose":"out_of_band"}]` {
		t.Fatalf("接口地址未恢复: %s", encoded)
	}
	asset.Interfaces = ifaces
	if err := s.UpdateCmdbAssetManual(asset); err != nil {
		t.Fatal(err)
	}
	_, again, err := s.GetCmdbAsset(id)
	if err != nil {
		t.Fatal(err)
	}
	reencoded, _ := json.Marshal(again[0])
	if string(reencoded) != string(encoded) {
		t.Fatalf("二次保存覆盖地址: %s -> %s", encoded, reencoded)
	}
}

func TestCmdbInterfaceDoesNotAddPurposeColumn(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "interface-schema.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	rows, err := s.db.Query(`PRAGMA table_info(cmdb_asset_interfaces)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, kind string
		var defaultValue interface{}
		if err := rows.Scan(&cid, &name, &kind, &notNull, &defaultValue, &primaryKey); err != nil {
			t.Fatal(err)
		}
		if name == "purpose" {
			t.Fatal("接口表不得新增主地址用途列")
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
}

func TestCmdbInterfaceAdditionalAddressesAreValidatedAndDeduplicated(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "interface-address-validation.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	_, err = s.CreateCmdbAssetManual(&CmdbAsset{Name: "无效地址", Interfaces: []CmdbAssetInterface{{Name: "eth0", AdditionalIPsJSON: `{"ip":"192.0.2.2"}`}}})
	if err == nil {
		t.Fatal("非数组附加地址应明确拒绝")
	}
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "多地址服务器", Interfaces: []CmdbAssetInterface{{Name: "eth0", IP: "192.0.2.10", AdditionalIPsJSON: `[{"ip":"192.0.2.10","purpose":"business"},{"ip":"192.0.2.11","purpose":"out_of_band"},{"ip":"192.0.2.11","purpose":"out_of_band"}]`}}})
	if err != nil {
		t.Fatal(err)
	}
	_, ifaces, err := s.GetCmdbAsset(id)
	if err != nil {
		t.Fatal(err)
	}
	if got := ifaces[0].AdditionalIPsJSON; got != `[{"ip":"192.0.2.10","purpose":"business"},{"ip":"192.0.2.11","purpose":"out_of_band"}]` {
		t.Fatalf("附加地址未按 IP 去重: %s", got)
	}
}

func TestCmdbInterfaceAdditionalAddressesMergePurposesByIP(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "interface-purposes.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "多用途", MgmtIP: "192.0.2.10", Interfaces: []CmdbAssetInterface{{Name: "eth0", IP: "192.0.2.10", IsPrimary: 1, AdditionalIPsJSON: `[{"ip":"192.0.2.10","purpose":"out_of_band"},{"ip":"192.0.2.11","purpose":"business"},{"ip":"192.0.2.11","purpose":"out_of_band"}]`}}})
	if err != nil {
		t.Fatal(err)
	}
	_, ifaces, err := s.GetCmdbAsset(id)
	if err != nil {
		t.Fatal(err)
	}
	if got := ifaces[0].AdditionalIPsJSON; got != `[{"ip":"192.0.2.10","purpose":"out_of_band"},{"ip":"192.0.2.11","purpose":["business","out_of_band"]}]` {
		t.Fatalf("附加地址用途未按 IP 归并: %s", got)
	}
}

func TestCmdbMainAddressPurposeCombinationsSurviveSaveAndReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "out-of-band-main.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	first := s
	defer first.Close()
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "带外设备", Interfaces: []CmdbAssetInterface{{Name: "eth0", IP: "192.0.2.9", AdditionalIPsJSON: `[{"ip":"192.0.2.9","purpose":"out_of_band"}]`}, {Name: "eth1", IP: "192.0.2.10", AdditionalIPsJSON: `[{"ip":"192.0.2.10","purpose":["business","out_of_band"]}]`}}})
	if err != nil {
		t.Fatal(err)
	}
	asset, ifaces, err := s.GetCmdbAsset(id)
	if err != nil {
		t.Fatal(err)
	}
	if got := ifaces[0].AdditionalIPsJSON; got != `[{"ip":"192.0.2.9","purpose":"out_of_band"}]` {
		t.Fatalf("带外用途丢失: %s", got)
	}
	if got := ifaces[1].AdditionalIPsJSON; got != `[{"ip":"192.0.2.10","purpose":["business","out_of_band"]}]` {
		t.Fatalf("同 IP 业务与带外用途未共存: %s", got)
	}
	asset.Interfaces = ifaces
	if err := s.UpdateCmdbAssetManual(asset); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	_, ifaces, err = s.GetCmdbAsset(id)
	if err != nil {
		t.Fatal(err)
	}
	if got := ifaces[0].AdditionalIPsJSON; got != `[{"ip":"192.0.2.9","purpose":"out_of_band"}]` {
		t.Fatalf("重开后带外用途丢失: %s", got)
	}
	if got := ifaces[1].AdditionalIPsJSON; got != `[{"ip":"192.0.2.10","purpose":["business","out_of_band"]}]` {
		t.Fatalf("重开后双用途丢失: %s", got)
	}
}

func TestCmdbLegacyPurposeColumnMigratesIntoAddressNotes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy-purpose.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	first := s
	defer first.Close()
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "旧带外设备", Interfaces: []CmdbAssetInterface{{Name: "eth0", IP: "192.0.2.9"}}})
	if err != nil {
		t.Fatal(err)
	}
	managementID, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "旧管理业务设备", MgmtIP: "192.0.2.10", Interfaces: []CmdbAssetInterface{{Name: "eth0", IP: "192.0.2.10", IsPrimary: 1}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`ALTER TABLE cmdb_asset_interfaces ADD COLUMN purpose TEXT NOT NULL DEFAULT 'business'`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE cmdb_asset_interfaces SET purpose='out_of_band' WHERE asset_id=?`, id); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	var newID int64
	for run := 0; run < 2; run++ {
		s, err = Open(path)
		if err != nil {
			t.Fatal(err)
		}
		current := s
		defer current.Close()
		_, ifaces, err := s.GetCmdbAsset(id)
		if err != nil {
			t.Fatal(err)
		}
		if got := ifaces[0].AdditionalIPsJSON; got != `[{"ip":"192.0.2.9","purpose":"out_of_band"}]` {
			t.Fatalf("第 %d 次打开未保留旧带外用途: %s", run+1, got)
		}
		_, managementIfaces, err := s.GetCmdbAsset(managementID)
		if err != nil {
			t.Fatal(err)
		}
		if got := managementIfaces[0].AdditionalIPsJSON; got != `[{"ip":"192.0.2.10","purpose":"business"}]` {
			t.Fatalf("第 %d 次打开未保留旧管理+业务用途: %s", run+1, got)
		}
		if run == 0 {
			newID, err = s.CreateCmdbAssetManual(&CmdbAsset{Name: "新带外设备", Interfaces: []CmdbAssetInterface{{Name: "eth1", IP: "192.0.2.11", AdditionalIPsJSON: `[{"ip":"192.0.2.11","purpose":"out_of_band"}]`}}})
			if err != nil {
				t.Fatal(err)
			}
		} else {
			_, newIfaces, err := s.GetCmdbAsset(newID)
			if err != nil {
				t.Fatal(err)
			}
			if got := newIfaces[0].AdditionalIPsJSON; got != `[{"ip":"192.0.2.11","purpose":"out_of_band"}]` {
				t.Fatalf("新设备带外用途被旧列默认值污染: %s", got)
			}
		}
		if err := s.Close(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestCmdbInvalidLegacyAdditionalAddressesFailOnRead(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "invalid-legacy-interface.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "旧设备", Interfaces: []CmdbAssetInterface{{Name: "eth0", IP: "192.0.2.10"}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE cmdb_asset_interfaces SET additional_ips_json='{bad' WHERE asset_id=?`, id); err != nil {
		t.Fatal(err)
	}
	_, _, err = s.GetCmdbAsset(id)
	if err == nil || !strings.Contains(err.Error(), "接口 eth0") || !strings.Contains(err.Error(), "附加地址格式无效") {
		t.Fatalf("旧数据应在接口读取时明确报错: %v", err)
	}
	if err := s.UpdateCmdbAssetManual(&CmdbAsset{ID: id, Name: "旧设备"}); err == nil || !strings.Contains(err.Error(), "附加地址格式无效") {
		t.Fatalf("旧数据编辑保存应拒绝: %v", err)
	}
}

func TestCmdbFullSavePreservesInterfacesAndLinks(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "interface-update.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "服务器", MgmtIP: "10.20.30.8", Interfaces: []CmdbAssetInterface{{Name: "业务口", IP: "10.20.30.21", IsPrimary: 1}}})
	if err != nil {
		t.Fatal(err)
	}
	peer, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "交换机"})
	if err != nil {
		t.Fatal(err)
	}
	asset, interfaces, err := s.GetCmdbAsset(id)
	if err != nil {
		t.Fatal(err)
	}
	oldID := interfaces[0].ID
	_, err = s.CreateCmdbAssetLinkForProject(scope, &CmdbAssetLink{LocalAssetID: id, LocalInterfaceID: oldID, LocalPort: "业务口", Direction: "uplink", PeerAssetID: peer, PeerPort: "GE1"})
	if err != nil {
		t.Fatal(err)
	}
	interfaces[0].IsPrimary = 0
	asset.Interfaces = append(interfaces, CmdbAssetInterface{Name: "管理口", IP: "10.20.30.8", IsPrimary: 1})
	if err := s.UpdateCmdbAssetManual(asset); err != nil {
		t.Fatal(err)
	}
	updated, current, err := s.GetCmdbAsset(id)
	if err != nil {
		t.Fatal(err)
	}
	if updated.MgmtIP != "10.20.30.8" || len(current) != 2 {
		t.Fatalf("管理地址或接口未保留: %+v %+v", updated, current)
	}
	var found bool
	for _, iface := range current {
		if iface.ID == oldID && iface.IP == "10.20.30.21" {
			found = true
		}
	}
	if !found {
		t.Fatal("保存改变了业务接口编号")
	}
	links, err := s.ListCmdbAssetLinksForProject(scope, id)
	if err != nil || len(links) != 1 || links[0].LocalInterfaceID != oldID {
		t.Fatalf("链路引用丢失: %+v %v", links, err)
	}
	updated.Interfaces = []CmdbAssetInterface{}
	if err := s.UpdateCmdbAssetManual(updated); err == nil || !strings.Contains(err.Error(), "链路") {
		t.Fatalf("删除链路引用的接口应明确拒绝: %v", err)
	}
	_, current, err = s.GetCmdbAsset(id)
	if err != nil || len(current) != 2 {
		t.Fatalf("失败事务必须保留原接口: %+v %v", current, err)
	}
}

func TestCmdbFullSaveClearsManagementAliasesAndRejectsForeignInterface(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "interface-clear.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "设备", MgmtIP: "192.0.2.1", Interfaces: []CmdbAssetInterface{{Name: "管理口", IP: "192.0.2.1", IsPrimary: 1}}})
	if err != nil {
		t.Fatal(err)
	}
	asset, _, err := s.GetCmdbAsset(id)
	if err != nil {
		t.Fatal(err)
	}
	asset.Interfaces = []CmdbAssetInterface{{ID: 999999, Name: "不属于本资产", IP: "192.0.2.2"}}
	if err := s.UpdateCmdbAssetManual(asset); err == nil {
		t.Fatal("不能使用其他资产或不存在的接口编号")
	}
	asset.MgmtIP, asset.ManageIP = "", ""
	asset.Interfaces = []CmdbAssetInterface{}
	if err := s.UpdateCmdbAssetManual(asset); err != nil {
		t.Fatal(err)
	}
	actual, interfaces, err := s.GetCmdbAsset(id)
	if err != nil {
		t.Fatal(err)
	}
	if actual.MgmtIP != "" || actual.ManageIP != "" || len(interfaces) != 0 {
		t.Fatalf("管理地址被旧别名回填: %+v", actual)
	}
}
