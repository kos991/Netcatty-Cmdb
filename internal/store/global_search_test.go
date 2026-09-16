package store

import "testing"

func TestGlobalSearchSixGroups(t *testing.T) {
	s := newCmdbTestStore(t)
	const keyword = "全局查询标识"

	if _, err := s.CreateAsset(&Asset{UserName: keyword + "终端", Department: "信息处", IP: "10.0.0.11", Status: "在用"}, "测试"); err != nil {
		t.Fatalf("插入终端失败: %v", err)
	}
	if _, err := s.db.Exec(`INSERT INTO cmdb_device_categories(name, parent_id, sort_order) VALUES ('交换机', 0, 0)`); err != nil {
		t.Fatalf("插入交换机分类失败: %v", err)
	}
	var switchCategoryID int64
	if err := s.db.QueryRow(`SELECT id FROM cmdb_device_categories WHERE name = '交换机'`).Scan(&switchCategoryID); err != nil {
		t.Fatalf("读取交换机分类失败: %v", err)
	}
	insertCmdbAsset(t, s, CmdbAsset{Name: keyword + "交换机", CategoryID: switchCategoryID, ManageIP: "10.0.0.12"})

	if _, err := s.db.Exec(`CREATE TABLE server_apps (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		server_id INTEGER,
		app_name TEXT,
		app_type TEXT,
		access_url TEXT,
		status TEXT,
		remark TEXT,
		created_at TEXT,
		updated_at TEXT
	)`); err != nil {
		t.Fatalf("创建业务系统表失败: %v", err)
	}
	if _, err := s.db.Exec(`INSERT INTO server_apps(server_id, app_name, app_type, access_url, status, remark) VALUES (0, ?, '审判系统', 'https://10.0.0.13', '正常运行', '')`, keyword+"业务系统"); err != nil {
		t.Fatalf("插入业务系统失败: %v", err)
	}
	if _, err := s.CreatePerson(&Person{Name: keyword + "人员", Department: "信息处"}); err != nil {
		t.Fatalf("插入人员失败: %v", err)
	}
	if _, err := s.db.Exec(`INSERT INTO asset_logs(asset_id, log_type, description, log_time) VALUES (0, '信息修改', ?, '2026-09-16 10:00:00')`, keyword+"履历"); err != nil {
		t.Fatalf("插入履历失败: %v", err)
	}
	if _, err := s.CreateIPEntry(&IPEntry{Subnet: "测试网段", IP: "10.0.0.14", Account: keyword + "IP", Status: "在用"}); err != nil {
		t.Fatalf("插入 IP 失败: %v", err)
	}

	results, err := s.GlobalSearch(keyword, 20)
	if err != nil {
		t.Fatalf("全局查询失败: %v", err)
	}
	want := map[string]bool{
		"终端资产":   false,
		"基础设施资源": false,
		"业务系统":   false,
		"组织与人员":  false,
		"运维履历":   false,
		"IP 规划池": false,
	}
	for _, item := range results {
		if _, ok := want[item.Group]; ok {
			want[item.Group] = true
		}
	}
	for group, found := range want {
		if !found {
			t.Fatalf("全局查询缺少 %q: %+v", group, results)
		}
	}
}
