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
	appID, err := s.CreateApp(&ServerApp{AppName: "业务系统", ServiceIP: "10.71.1.30", NetworkType: "系统登记网络"})
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
		t.Fatalf("业务系统应展示自身业务 IP 当前的 IPAM 网络类型：apps=%+v err=%v", apps, err)
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

func TestSubnetBackfillKeepsAdditionalBusinessIPWithInfrastructure(t *testing.T) {
	for _, addCIDRLater := range []bool{false, true} {
		name := "create"
		if addCIDRLater {
			name = "update"
		}
		t.Run(name, func(t *testing.T) {
			s := newCmdbTestStore(t)
			scopeA, scopeB := newCmdbProjectScopes(t, s)
			assetIDs := make(map[int64]int64)
			apps := make(map[int64]*ServerApp)
			for _, scope := range []ProjectScope{scopeA, scopeB} {
				assetID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{
					Name: "多地址服务器", DeviceType: "服务器", Owner: "设备负责人", Department: "设备部门", Room: "设备机房",
					MgmtIP: "10.72.1.10",
					Interfaces: []CmdbAssetInterface{{Name: "eth0", IP: "10.72.1.11", AdditionalIPsJSON: `[{"ip":"10.72.1.11","purpose":"business"},{"ip":"10.72.1.12","purpose":"business"}]`}},
				})
				if err != nil {
					t.Fatal(err)
				}
				assetIDs[scope.ProjectID] = assetID
				app := &ServerApp{AppName: "引用附加业务地址", CmdbAssetID: assetID, ServiceIP: "10.72.1.12", Owner: "应用负责人"}
				appID, err := s.CreateAppForProject(scope, app)
				if err != nil {
					t.Fatal(err)
				}
				app.ID = appID
				apps[scope.ProjectID] = app
			}
			for i, scope := range []ProjectScope{scopeA, scopeB} {
				subnet := &IPSubnet{Name: "业务网", CIDR: "10.72.1.0/24"}
				if addCIDRLater {
					subnet.CIDR = ""
				}
				if _, err := s.CreateIPSubnetForProject(scope, subnet); err != nil {
					t.Fatal(err)
				}
				if addCIDRLater {
					subnet.CIDR = "10.72.1.0/24"
					if err := s.UpdateIPSubnetForProject(scope, subnet); err != nil {
						t.Fatal(err)
					}
				}
				if i == 0 {
					if _, total, err := s.QueryIPEntriesForProject(scopeB, IPEntryQuery{Page: 1, PageSize: 20}); err != nil || total != 0 {
						t.Fatalf("项目 A 回填不得写入项目 B：total=%d err=%v", total, err)
					}
				}
				assertOwner := func() {
					t.Helper()
					rows, total, err := s.QueryIPEntriesForProject(scope, IPEntryQuery{Keyword: "10.72.1.12", Page: 1, PageSize: 20})
					if err != nil || total != 1 || len(rows) != 1 {
						t.Fatalf("附加地址应仅占用一次：rows=%+v total=%d err=%v", rows, total, err)
					}
					entry := rows[0]
					if entry.OwnerType != "infrastructure" || entry.OwnerID != assetIDs[scope.ProjectID] || entry.OwnerName != "多地址服务器" || entry.Account != "设备负责人" || entry.Department != "设备部门" || entry.Room != "设备机房" || entry.Status != "在用" {
						t.Fatalf("附加业务地址应保留当前项目基础设施归属及有效字段：%+v", entry)
					}
				}
				assertOwner()
				asset, interfaces, err := s.GetCmdbAssetForProject(scope, assetIDs[scope.ProjectID])
				if err != nil {
					t.Fatal(err)
				}
				asset.Interfaces = interfaces
				if err := s.UpdateCmdbAssetManualForProject(scope, asset); err != nil {
					t.Fatalf("回填后服务器仍应可保存：%v", err)
				}
				if err := s.UpdateAppForProject(scope, apps[scope.ProjectID]); err != nil {
					t.Fatalf("应用应继续共享附加业务地址：%v", err)
				}
				if _, err := s.CreateAppForProject(scope, &ServerApp{AppName: "第二个共享应用", CmdbAssetID: asset.ID, ServiceIP: "10.72.1.12"}); err != nil {
					t.Fatalf("新应用应能共享回填的服务器业务地址：%v", err)
				}
				assertOwner()
			}
		})
	}
}

func TestSubnetBackfillIgnoresLegacyNullTextOutsideSubnet(t *testing.T) {
	for _, fixture := range []struct {
		table, column, insert string
	}{
		{"assets", "asset_code", `INSERT INTO assets(project_id,asset_code,ip,terminal_ip,user_name,department,room) VALUES(?,'PC-NULL','10.73.2.10','10.73.2.11','用户','部门','机房')`},
		{"assets", "user_name", `INSERT INTO assets(project_id,asset_code,ip,terminal_ip,user_name,department,room) VALUES(?,'PC-NULL','10.73.2.10','10.73.2.11','用户','部门','机房')`},
		{"assets", "department", `INSERT INTO assets(project_id,asset_code,ip,terminal_ip,user_name,department,room) VALUES(?,'PC-NULL','10.73.2.10','10.73.2.11','用户','部门','机房')`},
		{"assets", "room", `INSERT INTO assets(project_id,asset_code,ip,terminal_ip,user_name,department,room) VALUES(?,'PC-NULL','10.73.2.10','10.73.2.11','用户','部门','机房')`},
		{"servers", "device_name", `INSERT INTO servers(project_id,device_name,mgmt_ip,biz_ip,admin_user,location) VALUES(?,'旧服务器','10.73.2.20','10.73.2.21','管理员','机房')`},
		{"servers", "admin_user", `INSERT INTO servers(project_id,device_name,mgmt_ip,biz_ip,admin_user,location) VALUES(?,'旧服务器','10.73.2.20','10.73.2.21','管理员','机房')`},
		{"servers", "location", `INSERT INTO servers(project_id,device_name,mgmt_ip,biz_ip,admin_user,location) VALUES(?,'旧服务器','10.73.2.20','10.73.2.21','管理员','机房')`},
		{"cmdb_assets", "owner", `INSERT INTO cmdb_assets(project_id,name,mgmt_ip,owner,department,room) VALUES(?,'基础设施','10.73.2.30','负责人','部门','机房')`},
		{"cmdb_assets", "department", `INSERT INTO cmdb_assets(project_id,name,mgmt_ip,owner,department,room) VALUES(?,'基础设施','10.73.2.30','负责人','部门','机房')`},
		{"cmdb_assets", "room", `INSERT INTO cmdb_assets(project_id,name,mgmt_ip,owner,department,room) VALUES(?,'基础设施','10.73.2.30','负责人','部门','机房')`},
		{"server_apps", "app_name", `INSERT INTO server_apps(project_id,app_name,service_ip,owner) VALUES(?,'旧应用','10.73.2.40','负责人')`},
		{"server_apps", "owner", `INSERT INTO server_apps(project_id,app_name,service_ip,owner) VALUES(?,'旧应用','10.73.2.40','负责人')`},
	} {
		t.Run(fixture.table+"/"+fixture.column, func(t *testing.T) {
			s := newCmdbTestStore(t)
			scope, err := s.DefaultProjectScope()
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.db.Exec(fixture.insert, scope.ProjectID); err != nil {
				t.Fatal(err)
			}
			if _, err := s.db.Exec(`UPDATE `+fixture.table+` SET `+fixture.column+`=NULL WHERE project_id=?`, scope.ProjectID); err != nil {
				t.Fatal(err)
			}
			subnet := &IPSubnet{Name: "不含历史资产的网段", CIDR: "10.73.1.0/24"}
			if _, err := s.CreateIPSubnetForProject(scope, subnet); err != nil {
				t.Fatalf("其他网段资产的 NULL 字段不得阻止新建网段：%v", err)
			}
			subnet.Name = "已编辑的网段"
			if err := s.UpdateIPSubnetForProject(scope, subnet); err != nil {
				t.Fatalf("其他网段资产的 NULL 字段不得阻止编辑网段：%v", err)
			}
			stored, err := s.GetIPSubnetForProject(scope, subnet.ID)
			if err != nil || stored.Name != subnet.Name || stored.CIDR != subnet.CIDR {
				t.Fatalf("网段变更未提交：subnet=%+v err=%v", stored, err)
			}
			if _, total, err := s.QueryIPEntriesForProject(scope, IPEntryQuery{Page: 1, PageSize: 20}); err != nil || total != 0 {
				t.Fatalf("不得回填网段外地址：total=%d err=%v", total, err)
			}
		})
	}
}
