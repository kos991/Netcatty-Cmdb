package store

import "testing"

// 已被网段 CIDR 覆盖的地址不得出现在建议里；未覆盖地址按 /24 去重计数并标注来源。
func TestUncoveredAssetSubnetsGroupsUncoveredIPs(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateIPSubnetForProject(scope, &IPSubnet{Name: "已建网段", Category: "专网", CIDR: "10.1.1.0/24"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO assets(project_id,ip,terminal_ip,device_type,status) VALUES (?,?,?,?,?),(?,?,?,?,?)`,
		scope.ProjectID, "10.1.1.5", "192.168.34.10", "云桌面终端", "在用",
		scope.ProjectID, "192.168.34.11", "外网", "云桌面终端", "在用"); err != nil {
		t.Fatal(err)
	}
	insertCmdbAsset(t, s, CmdbAsset{Name: "服务器", AssetCode: "S1", MgmtIP: "192.168.34.10", BizIP: "138.65.5.20"})
	list, err := s.UncoveredAssetSubnetsForProject(scope)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("应只有两个未覆盖网段: %+v", list)
	}
	first := list[0]
	if first.CIDR != "192.168.34.0/24" || first.Count != 2 || len(first.Sources) != 2 || first.Sources[0] != "基础设施" || first.Sources[1] != "终端资产" {
		t.Fatalf("网段汇总错误: %+v", first)
	}
	if list[1].CIDR != "138.65.5.0/24" || list[1].Count != 1 {
		t.Fatalf("业务 IP 网段缺失: %+v", list[1])
	}
}
