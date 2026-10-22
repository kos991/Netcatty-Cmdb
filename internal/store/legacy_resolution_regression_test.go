package store

import "testing"

func TestLegacyBoxResolutionExactAndShared(t *testing.T) {
	for _, remark := range []string{"盒子 10.0.0.1", "盒子:10.0.0.1", "盒子：10.0.0.1"} {
		t.Run(remark, func(t *testing.T) {
			s := newCmdbTestStore(t)
			scope, _ := s.DefaultProjectScope()
			other, err := s.CreateCmdbProject(&CmdbProject{Code: "box-other", Name: "其他项目"})
			if err != nil {
				t.Fatal(err)
			}
			mustLegacyExec(t, s, `INSERT INTO ip_subnets(project_id,name,category,cidr) VALUES (?, '邻居', '错误', '192.0.2.0/24'), (?, '正确', '专网', '198.51.100.0/24'), (?, '其他项目', '外网', '203.0.113.0/24')`, scope.ProjectID, scope.ProjectID, other.ID)
			mustLegacyExec(t, s, `INSERT INTO ip_pool(project_id,subnet,ip,remark) VALUES (?, '其他项目', '203.0.113.2', '盒子 10.0.0.1'), (?, '邻居', '192.0.2.2', '盒子 10.0.0.10'), (?, '正确', '198.51.100.2', ?)`, other.ID, scope.ProjectID, scope.ProjectID, remark)
			id, err := s.CreateAssetForProject(scope, &Asset{AssetCode: "BOX-EXACT", IP: "外网", TerminalIP: "10.0.0.1"}, "测试")
			if err != nil {
				t.Fatal(err)
			}
			list, err := s.AllAssetsForProject(scope)
			if err != nil {
				t.Fatal(err)
			}
			detail, _, err := s.GetAssetForProject(scope, id)
			if err != nil {
				t.Fatal(err)
			}
			if len(list) != 1 || list[0].IP != "198.51.100.2" || list[0].IPNetworkType != "专网" || detail.IP != list[0].IP || detail.IPNetworkType != list[0].IPNetworkType || detail.TerminalIPNetworkType != list[0].TerminalIPNetworkType {
				t.Fatalf("列表详情必须精确解析同项目盒子: list=%+v detail=%+v", list, detail)
			}
		})
	}
}

func TestLegacyServerHostFilterSharedByListAndExport(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	other, err := s.CreateCmdbProject(&CmdbProject{Code: "host-other", Name: "其他项目"})
	if err != nil {
		t.Fatal(err)
	}
	serverID, err := s.CreateServerForProject(scope, &PhysicalServer{DeviceName: "历史承载"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.db.Exec(`INSERT INTO cmdb_assets(project_id,name,source_type,source_id) VALUES (?, '历史映射', 'legacy_server', ?)`, scope.ProjectID, serverID)
	if err != nil {
		t.Fatal(err)
	}
	hostID, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	legacyID, err := s.CreateAppForProject(scope, &ServerApp{ServerID: serverID, AppName: "历史应用"})
	if err != nil {
		t.Fatal(err)
	}
	directID, err := s.CreateAppForProject(scope, &ServerApp{CmdbAssetID: hostID, AppName: "直接应用"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAppForProject(scope, &ServerApp{AppName: "未关联"}); err != nil {
		t.Fatal(err)
	}
	// Corrupt historical cross-project links must not leak through either host path.
	mustLegacyExec(t, s, `INSERT INTO server_apps(project_id,server_id,cmdb_asset_id,app_name) VALUES (?, ?, ?, '跨项目应用')`, other.ID, serverID, hostID)
	for _, size := range []int{20, 500} {
		rows, total, err := s.QueryServerAppsForProject(scope, ServerAppQuery{HostID: hostID, HostLinked: "linked", Page: 1, PageSize: size})
		if err != nil || total != 2 || len(rows) != 2 || rows[0].ID != directID || rows[1].ID != legacyID {
			t.Fatalf("列表和导出分页必须包含历史及直接承载: size=%d rows=%+v total=%d err=%v", size, rows, total, err)
		}
	}
	rows, total, err := s.QueryServerAppsForProject(ProjectScope{ProjectID: other.ID}, ServerAppQuery{HostID: hostID, Page: 1, PageSize: 500})
	if err != nil || total != 0 || len(rows) != 0 {
		t.Fatalf("其他项目不能选择本项目承载: rows=%+v total=%d err=%v", rows, total, err)
	}
	rows, total, err = s.QueryServerAppsForProject(scope, ServerAppQuery{HostLinked: "unlinked", Page: 1, PageSize: 20})
	if err != nil || total != 1 || len(rows) != 1 || rows[0].AppName != "未关联" {
		t.Fatalf("未关联语义改变: rows=%+v total=%d err=%v", rows, total, err)
	}
}
