package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestServerAppIndependentFieldsAndArchiveHistory(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	app := &ServerApp{AppName: "独立字段系统", AssetCode: "APP-001", Version: "2.3", Middleware: "Tomcat 10", Department: "审管办", NetworkType: "专网", Description: "系统说明", Remark: "单独备注", Deployment: "容器部署", DeploymentLocation: "cluster/ns", Status: "正常运行"}
	id, err := s.CreateAppForProject(scope, app)
	if err != nil {
		t.Fatal(err)
	}
	got, logs, err := s.GetAppForProject(scope, id)
	if err != nil {
		t.Fatal(err)
	}
	if got.AssetCode != app.AssetCode || got.Version != "2.3" || got.Middleware != "Tomcat 10" || got.Department != "审管办" || got.NetworkType != "" || got.Description != "系统说明" || got.Remark != "单独备注" || got.Deployment != "容器部署" || got.DeploymentLocation != "cluster/ns" {
		t.Fatalf("independent fields did not round trip: %+v", got)
	}
	if len(logs) != 1 || logs[0].LogType != "创建" || logs[0].AppID != id || logs[0].ProjectID != scope.ProjectID {
		t.Fatalf("missing creation history: %+v", logs)
	}
	got.Version, got.Description, got.NetworkType = "", "", ""
	if err := s.UpdateAppForProject(scope, got); err != nil {
		t.Fatal(err)
	}
	got, logs, err = s.GetAppForProject(scope, id)
	if err != nil || got.Version != "" || got.Description != "" || got.NetworkType != "" || got.Middleware != "Tomcat 10" || got.Remark != "单独备注" || len(logs) != 2 || logs[0].LogType != "更新" {
		t.Fatalf("clearing independent values changed legacy fields: app=%+v logs=%+v err=%v", got, logs, err)
	}
	got.Status = "已归档"
	if err := s.UpdateAppForProject(scope, got); err != nil {
		t.Fatal(err)
	}
	if rows, total, err := s.QueryServerAppsForProject(scope, ServerAppQuery{}); err != nil || total != 0 || len(rows) != 0 {
		t.Fatalf("archive remained in default list: %+v %d %v", rows, total, err)
	}
	if rows, total, err := s.QueryServerAppsForProject(scope, ServerAppQuery{Status: "已归档"}); err != nil || total != 0 || len(rows) != 0 {
		t.Fatalf("status filter leaked hidden archive: %+v %d %v", rows, total, err)
	}
	rows, total, err := s.QueryServerAppsForProject(scope, ServerAppQuery{IncludeArchived: true, Status: "已归档", Department: "审管办", NetworkType: AssetUnconfiguredFilter, Keyword: "APP-001"})
	if err != nil || total != 1 || len(rows) != 1 || rows[0].ID != id {
		t.Fatalf("archive filtered retrieval failed: %+v %d %v", rows, total, err)
	}
	_, logs, err = s.GetAppForProject(scope, id)
	if err != nil || len(logs) != 3 || logs[0].LogType != "归档" || !strings.Contains(logs[0].Description, "正常运行 → 已归档") {
		t.Fatalf("archive did not preserve history: %+v %v", logs, err)
	}
	other, err := s.CreateCmdbProject(&CmdbProject{Code: "APP-OTHER", Name: "另一个项目"})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.GetAppForProject(ProjectScope{ProjectID: other.ID}, id); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("cross-project detail should be missing: %v", err)
	}
	if err := s.DeleteAppForProject(scope, id); err == nil {
		t.Fatal("repeated archive must report that the application is already archived")
	}
	got, logs, err = s.GetAppForProject(scope, id)
	if err != nil || got.Status != "已归档" || len(logs) != 3 {
		t.Fatalf("repeated archive changed retained data: app=%+v logs=%+v err=%v", got, logs, err)
	}
}

func TestServerAppHistoryFailureRollsBackWrites(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	const reject = `CREATE TRIGGER reject_app_history BEFORE INSERT ON server_app_logs BEGIN SELECT RAISE(ABORT,'history rejected'); END`
	if _, err := s.db.Exec(reject); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAppForProject(scope, &ServerApp{AppName: "不得落库"}); err == nil {
		t.Fatal("history failure should reject creation")
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM server_apps WHERE app_name='不得落库'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("creation was not rolled back: %d %v", count, err)
	}
	if _, err := s.db.Exec(`DROP TRIGGER reject_app_history`); err != nil {
		t.Fatal(err)
	}
	id, err := s.CreateAppForProject(scope, &ServerApp{AppName: "原始系统", Status: "正常运行"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(reject); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateAppForProject(scope, &ServerApp{ID: id, AppName: "不得修改", Status: "已归档"}); err == nil {
		t.Fatal("history failure should reject update/archive")
	}
	app, logs, err := s.GetAppForProject(scope, id)
	if err != nil || app.AppName != "原始系统" || app.Status != "正常运行" || len(logs) != 1 {
		t.Fatalf("update/archive was not rolled back: %+v %+v %v", app, logs, err)
	}
	if err := s.DeleteAppForProject(scope, id); err == nil {
		t.Fatal("history failure should reject DELETE archive")
	}
	app, logs, err = s.GetAppForProject(scope, id)
	if err != nil || app.Status != "正常运行" || len(logs) != 1 {
		t.Fatalf("DELETE archive was not rolled back: %+v %+v %v", app, logs, err)
	}
}

func TestServerAppLegacyFallbackMigratesOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old-apps.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE server_apps(id INTEGER PRIMARY KEY AUTOINCREMENT,app_name TEXT,middleware TEXT,remark TEXT);
		INSERT INTO server_apps(app_name,middleware,remark) VALUES('旧系统','legacy-version','legacy-description')`)
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
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	app, _, err := s.GetAppForProject(scope, 1)
	if err != nil || app.Version != "legacy-version" || app.Description != "legacy-description" || app.Middleware != "legacy-version" || app.Remark != "legacy-description" {
		t.Fatalf("legacy fallback failed: %+v %v", app, err)
	}
	app.Version, app.Description = "", ""
	if err := s.UpdateAppForProject(scope, app); err != nil {
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
	app, _, err = s.GetAppForProject(scope, 1)
	if err != nil || app.Version != "" || app.Description != "" || app.Middleware != "legacy-version" || app.Remark != "legacy-description" {
		t.Fatalf("restart re-aliased explicit empty values: %+v %v", app, err)
	}
}

func TestServerAppLegacyNetworkFallbackUsesOwnProjectAndServiceIP(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateIPSubnetForProject(scope, &IPSubnet{Name: "服务网", Category: "旧专网", CIDR: "10.130.0.0/24"}); err != nil {
		t.Fatal(err)
	}
	app := &ServerApp{AppName: "旧服务", ServiceIP: "10.130.0.12"}
	id, err := s.CreateAppForProject(scope, app)
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.CreateCmdbProject(&CmdbProject{Code: "NETWORK-APP-OTHER", Name: "另一个网络项目"})
	if err != nil {
		t.Fatal(err)
	}
	otherScope := ProjectScope{ProjectID: other.ID}
	if _, err := s.CreateIPSubnetForProject(otherScope, &IPSubnet{Name: "服务网", Category: "另项目外网", CIDR: "10.130.0.0/24"}); err != nil {
		t.Fatal(err)
	}
	otherID, err := s.CreateAppForProject(otherScope, &ServerApp{AppName: "另项目服务", ServiceIP: "10.130.0.12"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE server_apps SET network_type=NULL WHERE id=?`, otherID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE server_apps SET network_type=NULL WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	if err := s.migrateServerAppPrototypeFields(); err != nil {
		t.Fatal(err)
	}
	got, _, err := s.GetAppForProject(scope, id)
	if err != nil || got.NetworkType != "旧专网" {
		t.Fatalf("legacy IPAM fallback failed: %+v %v", got, err)
	}
	otherApp, _, err := s.GetAppForProject(otherScope, otherID)
	if err != nil || otherApp.NetworkType != "另项目外网" {
		t.Fatalf("legacy fallback crossed project scope: %+v %v", otherApp, err)
	}
	got.NetworkType = "系统自有网络"
	if err := s.UpdateAppForProject(scope, got); err != nil {
		t.Fatal(err)
	}
	if err := s.migrateServerAppPrototypeFields(); err != nil {
		t.Fatal(err)
	}
	rows, total, err := s.QueryServerAppsForProject(scope, ServerAppQuery{NetworkType: "旧专网"})
	if err != nil || total != 1 || len(rows) != 1 || rows[0].ID != id || rows[0].NetworkType != "旧专网" {
		t.Fatalf("network filter must use current service IPAM: %+v %d %v", rows, total, err)
	}
	rows, total, err = s.QueryServerAppsForProject(scope, ServerAppQuery{Keyword: "系统自有网络"})
	if err != nil || total != 0 || len(rows) != 0 {
		t.Fatalf("stale explicit network must not be searchable: %+v %d %v", rows, total, err)
	}
}

func TestServerAppNetworkUsesOwnServiceIPAndLongestSubnet(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	for _, subnet := range []IPSubnet{
		{Name: "承载业务网", Category: "承载网络", CIDR: "10.132.0.0/24"},
		{Name: "承载管理网", Category: "管理网络", CIDR: "10.133.0.0/24"},
		{Name: "服务大网段", Category: "外网", CIDR: "172.22.0.0/16"},
		{Name: "服务小网段", Category: "专网", CIDR: "172.22.5.0/24"},
	} {
		subnet := subnet
		if _, err := s.CreateIPSubnetForProject(scope, &subnet); err != nil {
			t.Fatal(err)
		}
	}
	hostID := insertCmdbAsset(t, s, CmdbAsset{Name: "承载设备", BizIP: "10.132.0.10", MgmtIP: "10.133.0.10", NetType: "承载网络"})
	// 旧记录可能携带承载网络或手工网络，读取时必须仅解析自己的 service_ip。
	want := make(map[int64]string)
	for _, tc := range []struct {
		name, serviceIP, network string
	}{
		{"独立服务一", "172.22.5.20", "专网"},
		{"独立服务二", "172.22.5.21", "专网"},
		{"仅承载地址", "", ""},
		{"来源缺失", "203.0.113.20", ""},
	} {
		result, err := s.db.Exec(`INSERT INTO server_apps(project_id,cmdb_asset_id,app_name,service_ip,network_type,status)
			VALUES(?,?,?,?,?,'正常运行')`, scope.ProjectID, hostID, tc.name, tc.serviceIP, "承载网络")
		if err != nil {
			t.Fatal(err)
		}
		id, err := result.LastInsertId()
		if err != nil {
			t.Fatal(err)
		}
		want[id] = tc.network
	}
	// 故意把一个 IP 登记在大网段；另一个完全未登记，二者均应匹配最长 CIDR。
	if _, err := s.db.Exec(`INSERT INTO ip_pool(project_id,subnet,ip) VALUES(?,'服务大网段','172.22.5.20')`, scope.ProjectID); err != nil {
		t.Fatal(err)
	}
	apps, total, err := s.QueryServerAppsForProject(scope, ServerAppQuery{PageSize: 20})
	if err != nil || total != len(want) || len(apps) != len(want) {
		t.Fatalf("list failed: apps=%+v total=%d err=%v", apps, total, err)
	}
	for _, app := range apps {
		detail, _, err := s.GetAppForProject(scope, app.ID)
		if err != nil || app.NetworkType != want[app.ID] || detail.NetworkType != app.NetworkType || detail.ServiceIP != app.ServiceIP {
			t.Fatalf("own service source differs between list/detail: app=%+v detail=%+v want=%q err=%v", app, detail, want[app.ID], err)
		}
	}
	for _, tc := range []struct {
		network string
		count   int
	}{
		{"专网", 2}, {AssetUnconfiguredFilter, 2}, {"承载网络", 0}, {"管理网络", 0}, {"外网", 0},
	} {
		rows, total, err := s.QueryServerAppsForProject(scope, ServerAppQuery{NetworkType: tc.network, PageSize: 1})
		if err != nil || total != tc.count || len(rows) != min(tc.count, 1) {
			t.Fatalf("derived filter %q: rows=%+v total=%d err=%v", tc.network, rows, total, err)
		}
	}
	first, total, err := s.QueryServerAppsForProject(scope, ServerAppQuery{Keyword: "专网", Page: 1, PageSize: 1})
	second, secondTotal, secondErr := s.QueryServerAppsForProject(scope, ServerAppQuery{Keyword: "专网", Page: 2, PageSize: 1})
	if err != nil || secondErr != nil || total != 2 || secondTotal != 2 || len(first) != 1 || len(second) != 1 || first[0].ID == second[0].ID {
		t.Fatalf("resolved keyword must filter before pagination: first=%+v second=%+v totals=%d/%d errors=%v/%v", first, second, total, secondTotal, err, secondErr)
	}
}

func TestServerAppSnapshotHistoryRemapsReferencesAndScopesProjects(t *testing.T) {
	remote, remoteScope := openSnapshotTestStore(t)
	local, localScope := openSnapshotTestStore(t)
	project, err := remote.ResolveProject(remoteScope)
	if err != nil {
		t.Fatal(err)
	}
	alignSnapshotProject(t, local, localScope, project.SyncID)
	if _, err := local.CreateAppForProject(localScope, &ServerApp{AppName: "本地占位"}); err != nil {
		t.Fatal(err)
	}
	remoteApp := &ServerApp{AppName: "同步系统", AssetCode: "SYNC-APP", Version: "v2", Middleware: "Nginx", Description: "说明", Remark: "备注", Department: "信息处", NetworkType: "专网", Deployment: "托管服务", DeploymentLocation: "远端环境", Status: "正常运行"}
	if _, err := remote.CreateAppForProject(remoteScope, remoteApp); err != nil {
		t.Fatal(err)
	}
	remoteApp.Status = "已归档"
	if err := remote.UpdateAppForProject(remoteScope, remoteApp); err != nil {
		t.Fatal(err)
	}
	other, err := remote.CreateCmdbProject(&CmdbProject{Code: "APP-SNAPSHOT-OTHER", Name: "隔离项目"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := remote.CreateAppForProject(ProjectScope{ProjectID: other.ID}, &ServerApp{AppName: "不应同步"}); err != nil {
		t.Fatal(err)
	}
	withoutHistory, err := remote.ExportCmdbSnapshot(remoteScope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := withoutHistory.Collections["server_app_logs"]; ok {
		t.Fatal("history collection exported without IncludeHistory")
	}
	snapshot, err := remote.ExportCmdbSnapshot(remoteScope, SnapshotExportOptions{IncludeHistory: true})
	if err != nil {
		t.Fatal(err)
	}
	var exported []map[string]interface{}
	if err := json.Unmarshal(snapshot.Collections["server_app_logs"], &exported); err != nil || len(exported) != 2 {
		t.Fatalf("scoped app history export failed: %+v %v", exported, err)
	}
	if _, err := local.ApplyCmdbSnapshot(localScope, snapshot); err != nil {
		t.Fatal(err)
	}
	apps, total, err := local.QueryServerAppsForProject(localScope, ServerAppQuery{Keyword: "SYNC-APP", IncludeArchived: true})
	if err != nil || total != 1 || len(apps) != 1 {
		t.Fatalf("app snapshot import failed: %+v %d %v", apps, total, err)
	}
	if apps[0].ID == remoteApp.ID {
		t.Fatal("fixture must exercise different local app IDs")
	}
	app, logs, err := local.GetAppForProject(localScope, apps[0].ID)
	if err != nil || app.AssetCode != "SYNC-APP" || app.Version != "v2" || app.Middleware != "Nginx" || app.Description != "说明" || app.Remark != "备注" || app.Department != "信息处" || app.NetworkType != "" || app.Deployment != "托管服务" || app.DeploymentLocation != "远端环境" || app.Status != "已归档" || len(logs) != 2 {
		t.Fatalf("snapshot lost independent app fields/history: %+v %+v %v", app, logs, err)
	}
	for _, entry := range logs {
		if entry.AppID != app.ID || entry.ProjectID != localScope.ProjectID {
			t.Fatalf("snapshot history reference not remapped: %+v", entry)
		}
	}
}
