package store

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"
)

func newLegacyOperationsTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "legacy_operations_test.db"))
	if err != nil {
		t.Fatalf("打开隔离测试数据库失败: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func mustOperationsExec(t *testing.T, s *Store, query string, args ...interface{}) {
	t.Helper()
	if _, err := s.db.Exec(query, args...); err != nil {
		t.Fatalf("准备测试数据失败: %v", err)
	}
}

func createOperationsServer(t *testing.T, s *Store, server PhysicalServer) int64 {
	t.Helper()
	id, err := s.CreateServer(&server, "测试")
	if err != nil {
		t.Fatalf("创建测试服务器失败: %v", err)
	}
	return id
}

func operationsAppFromJSON(t *testing.T, payload string) ServerApp {
	t.Helper()
	var app ServerApp
	if err := json.Unmarshal([]byte(payload), &app); err != nil {
		t.Fatalf("构造应用数据失败: %v", err)
	}
	return app
}

func operationsAppJSON(t *testing.T, app ServerApp) map[string]interface{} {
	t.Helper()
	raw, err := json.Marshal(app)
	if err != nil {
		t.Fatalf("序列化应用失败: %v", err)
	}
	var value map[string]interface{}
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatalf("解析应用 JSON 失败: %v", err)
	}
	return value
}

func TestLegacyOperationsServerAppSchemaSupportsFreshAndLegacyDatabases(t *testing.T) {
	requiredColumns := []string{
		"server_id", "app_name", "app_type", "port", "access_url", "middleware",
		"database_info", "owner", "status", "remark", "created_at", "updated_at",
	}

	t.Run("全新数据库", func(t *testing.T) {
		s := newLegacyOperationsTestStore(t)
		columns, err := getTableColumns(s.db, "server_apps")
		if err != nil {
			t.Fatalf("读取全新表结构失败: %v", err)
		}
		for _, column := range requiredColumns {
			if !columns[column] {
				t.Errorf("全新 server_apps 缺少列 %s", column)
			}
		}
	})

	t.Run("已有数据库幂等迁移并保留数据", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "legacy_server_apps.db")
		db, err := sql.Open("sqlite", path)
		if err != nil {
			t.Fatalf("打开模拟旧库失败: %v", err)
		}
		if _, err := db.Exec(`CREATE TABLE server_apps (
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
			t.Fatalf("创建模拟旧表失败: %v", err)
		}
		if _, err := db.Exec(`INSERT INTO server_apps
			(server_id, app_name, app_type, access_url, status, remark, created_at, updated_at)
			VALUES (7, '旧审判系统', '业务应用', 'http://legacy', '正常运行', '保留内容', '2025-01-01', '2025-01-02')`); err != nil {
			t.Fatalf("写入模拟旧数据失败: %v", err)
		}
		if err := db.Close(); err != nil {
			t.Fatalf("关闭模拟旧库失败: %v", err)
		}

		s, err := Open(path)
		if err != nil {
			t.Fatalf("迁移模拟旧库失败: %v", err)
		}
		defer s.Close()
		columns, err := getTableColumns(s.db, "server_apps")
		if err != nil {
			t.Fatalf("读取迁移后表结构失败: %v", err)
		}
		for _, column := range requiredColumns {
			if !columns[column] {
				t.Errorf("迁移后 server_apps 缺少列 %s", column)
			}
		}
		var name, accessURL, remark string
		if err := s.db.QueryRow(`SELECT app_name, access_url, remark FROM server_apps WHERE id=1`).Scan(&name, &accessURL, &remark); err != nil {
			t.Fatalf("读取迁移后旧数据失败: %v", err)
		}
		if name != "旧审判系统" || accessURL != "http://legacy" || remark != "保留内容" {
			t.Fatalf("迁移不得改写已有数据: name=%q access_url=%q remark=%q", name, accessURL, remark)
		}
	})
}

func TestLegacyOperationsQueryServersFiltersAndPaginates(t *testing.T) {
	s := newLegacyOperationsTestStore(t)
	targetID := createOperationsServer(t, s, PhysicalServer{
		AssetCode: "ASSET-UNIQUE", DeviceName: "HOST-UNIQUE", BrandModel: "MODEL-UNIQUE",
		SerialNumber: "SN-UNIQUE", Location: "核心机房", MgmtIP: "10.10.0.11",
		BizIP: "10.20.0.11", AdminUser: "ADMIN-UNIQUE", Status: "运行中",
	})
	createOperationsServer(t, s, PhysicalServer{AssetCode: "OTHER-1", DeviceName: "备用主机", Location: "灾备机房", Status: "备用"})

	for _, keyword := range []string{"ASSET-UNIQUE", "HOST-UNIQUE", "MODEL-UNIQUE", "SN-UNIQUE", "10.10.0.11", "10.20.0.11", "ADMIN-UNIQUE"} {
		list, total, err := s.QueryServers(keyword, "", "", 1, 20)
		if err != nil {
			t.Fatalf("按关键词 %q 查询失败: %v", keyword, err)
		}
		if total != 1 || len(list) != 1 || list[0].ID != targetID {
			t.Fatalf("关键词 %q 应只命中目标服务器，total=%d list=%+v", keyword, total, list)
		}
	}
	list, total, err := s.QueryServers("", "核心机房", "运行中", 1, 20)
	if err != nil {
		t.Fatalf("按位置和状态查询失败: %v", err)
	}
	if total != 1 || len(list) != 1 || list[0].ID != targetID {
		t.Fatalf("位置和状态筛选结果错误，total=%d list=%+v", total, list)
	}

	lastIDs := make([]int64, 0, 21)
	for i := 0; i < 21; i++ {
		lastIDs = append(lastIDs, createOperationsServer(t, s, PhysicalServer{DeviceName: "分页主机", Status: "运行中"}))
	}
	page1, total, err := s.QueryServers("分页主机", "", "", 1, 2)
	if err != nil {
		t.Fatalf("查询第一页失败: %v", err)
	}
	page2, _, err := s.QueryServers("分页主机", "", "", 2, 2)
	if err != nil {
		t.Fatalf("查询第二页失败: %v", err)
	}
	if total != 21 || len(page1) != 2 || len(page2) != 2 || page1[0].ID != lastIDs[20] || page1[1].ID != lastIDs[19] || page2[0].ID != lastIDs[18] {
		t.Fatalf("服务器应按 id 倒序稳定分页，total=%d page1=%+v page2=%+v", total, page1, page2)
	}
	defaultPage, total, err := s.QueryServers("分页主机", "", "", 0, 501)
	if err != nil {
		t.Fatalf("非法分页参数查询失败: %v", err)
	}
	if total != 21 || len(defaultPage) != 20 || defaultPage[0].ID != lastIDs[20] {
		t.Fatalf("非法分页参数应回退到第 1 页/20 条，total=%d len=%d", total, len(defaultPage))
	}
	maxPage, _, err := s.QueryServers("分页主机", "", "", 1, 500)
	if err != nil || len(maxPage) != 21 {
		t.Fatalf("page_size=500 应合法，len=%d err=%v", len(maxPage), err)
	}
}

func TestLegacyOperationsAppCRUDRelationsAndQueries(t *testing.T) {
	s := newLegacyOperationsTestStore(t)
	serverID := createOperationsServer(t, s, PhysicalServer{DeviceName: "承载主机甲", BizIP: "10.30.0.11", Status: "运行中"})
	serverTwoID := createOperationsServer(t, s, PhysicalServer{DeviceName: "承载主机乙", BizIP: "10.30.0.12", Status: "运行中"})

	emptyName := operationsAppFromJSON(t, `{"server_id":1,"app_name":"   "}`)
	emptyName.ServerID = serverID
	if _, err := s.CreateApp(&emptyName); err == nil {
		t.Fatal("空应用名称必须返回错误")
	}
	missingServer := operationsAppFromJSON(t, `{"server_id":999999,"app_name":"孤立应用"}`)
	if _, err := s.CreateApp(&missingServer); err == nil {
		t.Fatal("不存在的承载服务器必须返回错误")
	}

	app := operationsAppFromJSON(t, `{
		"app_name":"审判系统","app_type":"业务应用","port":"8080/tcp",
		"access_url":"https://trial.example","middleware":"BES 9","database_info":"DM8",
		"owner":"张工","status":"正常运行","remark":"生产系统"
	}`)
	app.ServerID = serverID
	appID, err := s.CreateApp(&app)
	if err != nil {
		t.Fatalf("创建应用失败: %v", err)
	}
	if appID <= 0 {
		t.Fatalf("创建应用必须返回真实数据库 ID，实际 %d", appID)
	}

	apps, err := s.GetAppsByServerID(serverID)
	if err != nil {
		t.Fatalf("读取服务器应用失败: %v", err)
	}
	if len(apps) != 1 || apps[0].ID != appID {
		t.Fatalf("服务器应用关联不完整: %+v", apps)
	}
	createdJSON := operationsAppJSON(t, apps[0])
	for field, want := range map[string]string{
		"app_name": "审判系统", "app_type": "业务应用", "port": "8080/tcp",
		"access_url": "https://trial.example", "middleware": "BES 9", "database_info": "DM8",
		"owner": "张工", "status": "正常运行", "remark": "生产系统",
	} {
		if got, _ := createdJSON[field].(string); got != want {
			t.Errorf("创建后字段 %s 未完整往返，want=%q got=%q JSON=%v", field, want, got, createdJSON)
		}
	}
	server, relatedApps, err := s.GetServer(serverID)
	if err != nil {
		t.Fatalf("读取服务器详情失败: %v", err)
	}
	if server.ID != serverID || len(relatedApps) != 1 || relatedApps[0].ID != appID {
		t.Fatalf("服务器详情必须返回真实关联应用: server=%+v apps=%+v", server, relatedApps)
	}
	if _, _, err := s.GetServer(999999); err == nil {
		t.Fatal("不存在服务器详情必须返回错误")
	}
	if _, err := s.GetAppsByServerID(999999); err == nil {
		t.Fatal("不存在服务器的应用清单必须返回错误")
	}

	updated := operationsAppFromJSON(t, `{
		"app_name":"审判系统升级","app_type":"业务应用","port":"8443/tcp",
		"access_url":"https://trial-updated.example","middleware":"TongWeb 8","database_info":"DM8 主库",
		"owner":"李工","status":"异常","remark":"核心系统"
	}`)
	updated.ID = appID
	if err := s.UpdateApp(&updated); err != nil {
		t.Fatalf("更新应用失败: %v", err)
	}
	apps, err = s.GetAppsByServerID(serverID)
	if err != nil || len(apps) != 1 {
		t.Fatalf("更新后读取应用失败: apps=%+v err=%v", apps, err)
	}
	updatedJSON := operationsAppJSON(t, apps[0])
	for field, want := range map[string]string{
		"app_name": "审判系统升级", "app_type": "业务应用", "port": "8443/tcp",
		"access_url": "https://trial-updated.example", "middleware": "TongWeb 8", "database_info": "DM8 主库",
		"owner": "李工", "status": "异常", "remark": "核心系统",
	} {
		if got, _ := updatedJSON[field].(string); got != want {
			t.Errorf("更新后字段 %s 未完整往返，want=%q got=%q JSON=%v", field, want, got, updatedJSON)
		}
	}

	second := operationsAppFromJSON(t, `{
		"app_name":"档案数据库","app_type":"数据库服务","port":"5236/tcp",
		"access_url":"https://db.example","middleware":"DM Service","database_info":"DM8 归档库",
		"owner":"王工","status":"正常运行","remark":"灾备"
	}`)
	second.ServerID = serverTwoID
	secondID, err := s.CreateApp(&second)
	if err != nil {
		t.Fatalf("创建第二个应用失败: %v", err)
	}

	for _, keyword := range []string{"审判系统升级", "业务应用", "trial-updated", "TongWeb", "DM8 主库", "李工", "核心系统"} {
		list, total, err := s.QueryAllApps(keyword, "", "", 1, 20)
		if err != nil {
			t.Fatalf("按应用关键词 %q 查询失败: %v", keyword, err)
		}
		if total != 1 || len(list) != 1 || list[0].ID != appID {
			t.Fatalf("关键词 %q 应只命中目标应用，total=%d list=%+v", keyword, total, list)
		}
		itemJSON := operationsAppJSON(t, list[0])
		if itemJSON["server_name"] != "承载主机甲" || itemJSON["server_biz_ip"] != "10.30.0.11" {
			t.Fatalf("应用列表必须带承载服务器信息，JSON=%v", itemJSON)
		}
	}
	filtered, total, err := s.QueryAllApps("", "数据库服务", "正常运行", 1, 20)
	if err != nil || total != 1 || len(filtered) != 1 || filtered[0].ID != secondID {
		t.Fatalf("应用类型和状态筛选错误，total=%d list=%+v err=%v", total, filtered, err)
	}
	page1, total, err := s.QueryAllApps("", "", "", 1, 1)
	if err != nil || total != 2 || len(page1) != 1 || page1[0].ID != secondID {
		t.Fatalf("应用第一页应按 id 倒序稳定分页，total=%d list=%+v err=%v", total, page1, err)
	}
	page2, _, err := s.QueryAllApps("", "", "", 2, 1)
	if err != nil || len(page2) != 1 || page2[0].ID != appID {
		t.Fatalf("应用第二页分页错误，list=%+v err=%v", page2, err)
	}

	updated.ID = 999999
	if err := s.UpdateApp(&updated); err == nil {
		t.Fatal("更新不存在应用必须返回错误")
	}
	if err := s.DeleteApp(999999); err == nil {
		t.Fatal("删除不存在应用必须返回错误")
	}
	if err := s.DeleteApp(appID); err != nil {
		t.Fatalf("删除应用失败: %v", err)
	}
	apps, err = s.GetAppsByServerID(serverID)
	if err != nil || len(apps) != 0 {
		t.Fatalf("删除后服务器应用应为空，apps=%+v err=%v", apps, err)
	}
}

func TestLegacyOperationsQueryLogsFiltersAndPaginates(t *testing.T) {
	s := newLegacyOperationsTestStore(t)
	mustOperationsExec(t, s, `INSERT INTO asset_logs
		(asset_id, log_type, from_user, to_user, from_location, to_location, old_sn, new_sn, operator, description, log_time)
		VALUES (101, '信息修改', '原人员甲', '新人员甲', '原位置甲', '新位置甲', 'OLD-UNIQUE', 'NEW-UNIQUE', '经办人甲', '唯一说明', '2026-09-16 10:00:00')`)
	mustOperationsExec(t, s, `INSERT INTO asset_logs
		(asset_id, log_type, operator, description, log_time)
		VALUES (202, '设备维修更换', '经办人乙', '其他说明', '2026-09-16 10:00:00')`)
	mustOperationsExec(t, s, `INSERT INTO asset_logs
		(asset_id, log_type, operator, description, log_time)
		VALUES (303, '建档入库', '经办人丙', '更早记录', '2026-09-16 09:00:00')`)

	for _, keyword := range []string{"唯一说明", "经办人甲", "原人员甲", "新人员甲", "原位置甲", "新位置甲", "OLD-UNIQUE", "NEW-UNIQUE"} {
		list, total, err := s.QueryLogs(0, "", keyword, 1, 20)
		if err != nil {
			t.Fatalf("按履历关键词 %q 查询失败: %v", keyword, err)
		}
		if total != 1 || len(list) != 1 || list[0].AssetID != 101 {
			t.Fatalf("履历关键词 %q 应只命中目标记录，total=%d list=%+v", keyword, total, list)
		}
	}
	filtered, total, err := s.QueryLogs(101, "信息修改", "", 1, 20)
	if err != nil || total != 1 || len(filtered) != 1 || filtered[0].Description != "唯一说明" {
		t.Fatalf("asset_id 与 log_type 筛选错误，total=%d list=%+v err=%v", total, filtered, err)
	}
	page1, total, err := s.QueryLogs(0, "", "", 1, 1)
	if err != nil || total != 3 || len(page1) != 1 || page1[0].AssetID != 202 {
		t.Fatalf("履历第一页应按 log_time、id 倒序，total=%d list=%+v err=%v", total, page1, err)
	}
	page2, _, err := s.QueryLogs(0, "", "", 2, 1)
	if err != nil || len(page2) != 1 || page2[0].AssetID != 101 {
		t.Fatalf("履历第二页稳定分页错误，list=%+v err=%v", page2, err)
	}

	for i := 0; i < 19; i++ {
		mustOperationsExec(t, s, `INSERT INTO asset_logs (asset_id, log_type, description, log_time)
			VALUES (?, '批量记录', '分页上限', '2026-09-15 08:00:00')`, 1000+i)
	}
	defaultPage, total, err := s.QueryLogs(0, "", "", 0, 501)
	if err != nil {
		t.Fatalf("非法履历分页参数查询失败: %v", err)
	}
	if total != 22 || len(defaultPage) != 20 {
		t.Fatalf("非法履历分页参数应回退到第 1 页/20 条，total=%d len=%d", total, len(defaultPage))
	}
}

func TestLegacyOperationsDatabaseFailuresAreReturned(t *testing.T) {
	s := newLegacyOperationsTestStore(t)
	if err := s.Close(); err != nil {
		t.Fatalf("关闭测试数据库失败: %v", err)
	}
	if _, _, err := s.QueryServers("", "", "", 1, 20); err == nil {
		t.Fatal("服务器查询数据库失败不得伪装成功")
	}
	if _, _, err := s.QueryAllApps("", "", "", 1, 20); err == nil {
		t.Fatal("应用查询数据库失败不得伪装成功")
	}
	if _, _, err := s.QueryLogs(0, "", "", 1, 20); err == nil {
		t.Fatal("履历查询数据库失败不得伪装成功")
	}
}
