package store

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestCmdbInterfaceAddressPurposesSurviveCreateAndEdit(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "interface-addresses.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var iface CmdbAssetInterface
	if err := json.Unmarshal([]byte(`{"name":"eth0","ip":"192.0.2.10","purpose":"business","additional_ips_json":"[{\"ip\":\"192.0.2.11\",\"purpose\":\"out_of_band\"}]"}`), &iface); err != nil {
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
	if actual["purpose"] != "business" || actual["additional_ips_json"] != `[{"ip":"192.0.2.11","purpose":"out_of_band"}]` {
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
	if got := ifaces[0].AdditionalIPsJSON; got != `[{"ip":"192.0.2.11","purpose":"out_of_band"}]` {
		t.Fatalf("附加地址未按 IP 去重: %s", got)
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
