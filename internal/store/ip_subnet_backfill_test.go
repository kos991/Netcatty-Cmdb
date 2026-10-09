package store

import "testing"

func TestSubnetCreatedAfterAssetsBackfillsIPOccupancy(t *testing.T) {
	s := newCmdbTestStore(t)
	terminalID, err := s.CreateAsset(&Asset{AssetName: "桌面终端", AssetCode: "PC-1", IP: "10.71.1.10", Status: "在用"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	infraID, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "核心交换机", DeviceType: "switch", MgmtIP: "10.71.1.20", Interfaces: []CmdbAssetInterface{{Name: "业务口", IP: "10.71.1.21", AdditionalIPsJSON: `[{"ip":"10.71.1.22","purpose":"business"}]`}}})
	if err != nil {
		t.Fatal(err)
	}
	appID, err := s.CreateApp(&ServerApp{AppName: "业务系统", ServiceIP: "10.71.1.30"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "管理网", Category: "内网", CIDR: "10.71.1.0/24"}); err != nil {
		t.Fatal(err)
	}
	for _, expected := range []struct {
		ip, ownerType string
		ownerID       int64
	}{
		{"10.71.1.10", "terminal", terminalID},
		{"10.71.1.20", "infrastructure", infraID},
		{"10.71.1.21", "infrastructure", infraID},
		{"10.71.1.22", "infrastructure", infraID},
		{"10.71.1.30", "application", appID},
	} {
		rows, total, err := s.QueryIPEntries(IPEntryQuery{Keyword: expected.ip, Page: 1, PageSize: 20})
		if err != nil || total != 1 || rows[0].OwnerType != expected.ownerType || rows[0].OwnerID != expected.ownerID || rows[0].Status != "在用" {
			t.Fatalf("%s 未正确联动：rows=%+v total=%d err=%v", expected.ip, rows, total, err)
		}
	}
	assets, err := s.AllAssets()
	if err != nil || len(assets) != 1 || assets[0].IPNetworkType != "内网" {
		t.Fatalf("终端网络类型未联动：assets=%+v err=%v", assets, err)
	}
	apps, _, err := s.QueryAllApps("", "", "", 1, 20)
	if err != nil || len(apps) != 1 || apps[0].NetworkType != "内网" {
		t.Fatalf("业务系统网络类型未联动：apps=%+v err=%v", apps, err)
	}
}

func TestSubnetCIDRAddedLaterBackfillsExistingTerminal(t *testing.T) {
	s := newCmdbTestStore(t)
	id, err := s.CreateIPSubnet(&IPSubnet{Name: "待规划网段", Category: "外网"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAsset(&Asset{AssetName: "外网终端", IP: "198.51.100.18"}, "测试"); err != nil {
		t.Fatal(err)
	}
	subnet, err := s.GetIPSubnet(id)
	if err != nil {
		t.Fatal(err)
	}
	subnet.CIDR = "198.51.100.0/24"
	if err := s.UpdateIPSubnet(subnet); err != nil {
		t.Fatal(err)
	}
	assets, err := s.AllAssets()
	if err != nil || len(assets) != 1 || assets[0].IPNetworkType != "外网" {
		t.Fatalf("补全 CIDR 后终端网络类型未联动：assets=%+v err=%v", assets, err)
	}
	rows, total, err := s.QueryIPEntries(IPEntryQuery{Keyword: "198.51.100.18", Page: 1, PageSize: 20})
	if err != nil || total != 1 || rows[0].OwnerType != "terminal" {
		t.Fatalf("补全 CIDR 后 IPAM 未联动：rows=%+v total=%d err=%v", rows, total, err)
	}
}
