package store

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

func TestProjectMigrationCreatesEmptyDefaultProject(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "fresh.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	project, err := s.DefaultProject()
	if err != nil {
		t.Fatal(err)
	}
	if project.Code != DefaultProjectCode || project.Name != DefaultProjectName || project.SyncID == "" {
		t.Fatalf("默认项目异常: %+v", project)
	}
	var projectCount int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM cmdb_projects").Scan(&projectCount); err != nil {
		t.Fatalf("查询项目数: %v", err)
	}
	if projectCount != 1 {
		t.Fatalf("全新库项目数=%d，期望 1", projectCount)
	}
	for _, table := range projectScopedTables {
		var count int
		if err := s.db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil {
			t.Fatalf("查询 %s: %v", table, err)
		}
		want := 0
		if table == "cmdb_network_types" {
			want = 3
		}
		if table == "cmdb_device_categories" {
			for _, group := range defaultAssetCategories {
				want += len(group.names)
			}
		}
		if count != want {
			t.Fatalf("全新库 %s 有 %d 条记录，期望 %d", table, count, want)
		}
	}
}

func TestProjectMigrationKeepsRenamedOnlyProjectAcrossRestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "renamed-project.db")
	first, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	project, err := first.DefaultProject()
	if err != nil {
		first.Close()
		t.Fatal(err)
	}
	project.Code = "CN2026-ZJFY"
	project.Name = "法院"
	if err := first.UpdateCmdbProject(project); err != nil {
		first.Close()
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	second, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	resolved, err := second.DefaultProject()
	if err != nil {
		t.Fatal(err)
	}
	if resolved.ID != project.ID || resolved.Code != "CN2026-ZJFY" {
		t.Fatalf("重启后默认项目异常: %+v", resolved)
	}
	var projectCount int
	if err := second.db.QueryRow(`SELECT COUNT(*) FROM cmdb_projects WHERE deleted_at IS NULL`).Scan(&projectCount); err != nil {
		t.Fatal(err)
	}
	if projectCount != 1 {
		t.Fatalf("重启后有效项目数=%d，期望 1", projectCount)
	}

	result, err := second.db.Exec(`INSERT INTO assets(asset_code, updated_at) VALUES ('RESTART-1', '')`)
	if err != nil {
		t.Fatal(err)
	}
	assetID, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	var assetProjectID int64
	if err := second.db.QueryRow(`SELECT project_id FROM assets WHERE id=?`, assetID).Scan(&assetProjectID); err != nil {
		t.Fatal(err)
	}
	if assetProjectID != project.ID {
		t.Fatalf("重启后的兼容写入归属项目=%d，期望 %d", assetProjectID, project.ID)
	}
}

func TestProjectMigrationBackfillsLegacyRowsIdempotently(t *testing.T) {
	dbPath := createLegacyProjectFixture(t)

	first, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	project, err := first.DefaultProject()
	if err != nil {
		t.Fatal(err)
	}
	syncIDs := make(map[string][]string, len(projectScopedTables))
	for _, table := range projectScopedTables {
		assertProjectRows(t, first, table, project.ID)
		syncIDs[table] = projectRowSyncIDs(t, first, table)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	second, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	var projects int
	if err := second.db.QueryRow("SELECT COUNT(*) FROM cmdb_projects").Scan(&projects); err != nil {
		t.Fatal(err)
	}
	if projects != 1 {
		t.Fatalf("重复打开后项目数=%d", projects)
	}
	for _, table := range projectScopedTables {
		got := projectRowSyncIDs(t, second, table)
		if len(got) != len(syncIDs[table]) {
			t.Fatalf("%s UUID 数量变化: %d -> %d", table, len(syncIDs[table]), len(got))
		}
		for i := range got {
			if got[i] != syncIDs[table][i] {
				t.Fatalf("%s UUID 被重写: %s -> %s", table, syncIDs[table][i], got[i])
			}
		}
	}
}

func TestProjectMigrationAddsSyncColumnsToEveryBusinessTable(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "columns.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	for _, table := range projectScopedTables {
		columns, err := getTableColumns(s.db, table)
		if err != nil {
			t.Fatalf("读取 %s 列: %v", table, err)
		}
		for _, column := range []string{"project_id", "sync_id", "revision", "updated_at", "deleted_at"} {
			if !columns[column] {
				t.Fatalf("%s 缺少 %s", table, column)
			}
		}
	}
}

func TestProjectMigrationAddsAttachmentStorageAndEncryptionColumns(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "attachment-columns.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	projectColumns, err := getTableColumns(s.db, "cmdb_projects")
	if err != nil {
		t.Fatal(err)
	}
	if !projectColumns["attachment_root"] {
		t.Fatal("cmdb_projects 缺少 attachment_root")
	}

	attachmentColumns, err := getTableColumns(s.db, "cmdb_work_order_attachments")
	if err != nil {
		t.Fatal(err)
	}
	for _, column := range []string{"cloud_object_id", "encryption_version", "wrapped_key", "wrapped_key_iv", "data_iv"} {
		if !attachmentColumns[column] {
			t.Fatalf("cmdb_work_order_attachments 缺少 %s", column)
		}
	}
}

func TestProjectMigrationAssignsMetadataToNewRows(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "new-rows.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	project, err := s.DefaultProject()
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range projectScopedTables {
		t.Run(table, func(t *testing.T) {
			id := insertProjectScopedRow(t, s.db, table, "NEW")
			var projectID, revision int64
			var syncID, updatedAt string
			if err := s.db.QueryRow("SELECT project_id, sync_id, revision, updated_at FROM "+table+" WHERE id = ?", id).
				Scan(&projectID, &syncID, &revision, &updatedAt); err != nil {
				t.Fatal(err)
			}
			if projectID != project.ID || revision != 1 || updatedAt == "" {
				t.Fatalf("新记录同步元数据异常: project=%d revision=%d updated=%q", projectID, revision, updatedAt)
			}
			if _, err := uuid.Parse(syncID); err != nil {
				t.Fatalf("sync_id 不是 UUID: %q: %v", syncID, err)
			}
		})
	}
}

func TestProjectAssetCatalogDefaultsAndRealModelsStayScoped(t *testing.T) {
	path := filepath.Join(t.TempDir(), "catalog.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defaultScope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.CreateCmdbProject(&CmdbProject{Code: "catalog-other", Name: "其他项目"})
	if err != nil {
		t.Fatal(err)
	}
	otherScope := ProjectScope{ProjectID: other.ID}
	for _, scope := range []ProjectScope{defaultScope, otherScope} {
		for _, group := range defaultAssetCategories {
			kind := group.scope + "-categories"
			list, err := s.ListCmdbTaxonomyForProject(scope, kind)
			if err != nil {
				t.Fatal(err)
			}
			if len(list) != len(group.names) {
				t.Fatalf("项目 %d 的 %s 默认分类数: %+v", scope.ProjectID, kind, list)
			}
			for _, name := range group.names {
				found := false
				for _, category := range list {
					if category.Name == name && category.ProjectID == scope.ProjectID && category.SyncID != "" {
						found = true
					}
				}
				if !found {
					t.Fatalf("项目 %d 缺失默认分类 %s/%s: %+v", scope.ProjectID, kind, name, list)
				}
			}
		}
	}
	for _, deviceType := range []string{"云桌面盒子", "云盒"} {
		if _, err := s.CreateAssetForProject(otherScope, &Asset{AssetCode: "CLOUD-" + deviceType, DeviceType: deviceType, Status: "在用"}, "测试"); err != nil {
			t.Fatalf("新项目的 %s 分类必须可用于终端建档: %v", deviceType, err)
		}
	}
	if _, err := s.CreateAssetForProject(defaultScope, &Asset{AssetCode: "CAT-PC-1", Vendor: "真实厂商", Model: "型号甲", Status: "在用"}, "测试"); err != nil {
		t.Fatal(err)
	}
	if err := s.ImportAssetsForProject(defaultScope, []Asset{
		{AssetCode: "CAT-PC-2", Vendor: "真实厂商", Model: "型号甲", Status: "在用"},
		{AssetCode: "CAT-PC-3", Vendor: "真实厂商", Model: "   ", Status: "在用"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateCmdbAssetManualForProject(defaultScope, &CmdbAsset{Name: "设备", Vendor: "真实厂商", Model: "型号甲"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateCmdbAssetManualForProject(defaultScope, &CmdbAsset{Name: "未知厂商设备", Model: "型号乙"}); err != nil {
		t.Fatal(err)
	}
	if models, total, err := s.QueryCmdbModelsForProject(defaultScope, "", 1, 100); err != nil || total != 1 || len(models) != 1 || models[0].Vendor != "真实厂商" || models[0].Model != "型号甲" || models[0].SyncID == "" {
		t.Fatalf("真实完整型号应且仅应登记一次: total=%d models=%+v err=%v", total, models, err)
	}
	if _, total, err := s.QueryCmdbModelsForProject(otherScope, "", 1, 100); err != nil || total != 0 {
		t.Fatalf("其他项目不能读取型号: total=%d err=%v", total, err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, total, err := s.QueryCmdbModelsForProject(defaultScope, "", 1, 100); err != nil || total != 1 {
		t.Fatalf("重启不能重复创建型号: total=%d err=%v", total, err)
	}
}

func TestProjectAssetCatalogDoesNotRestoreDeletedEntries(t *testing.T) {
	path := filepath.Join(t.TempDir(), "deleted-catalog.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	types, err := s.ListCmdbTaxonomyForProject(scope, "terminal-categories")
	if err != nil {
		t.Fatal(err)
	}
	var workstationID int64
	for _, category := range types {
		if category.Name == "工作站" {
			workstationID = category.ID
		}
	}
	if workstationID == 0 {
		t.Fatal("未初始化工作站分类")
	}
	if err := s.DeleteCmdbTaxonomyForProject(scope, "terminal-categories", workstationID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAssetForProject(scope, &Asset{AssetCode: "MODEL-DELETE", Vendor: "真实厂商", Model: "可删除型号", Status: "在用"}, "测试"); err != nil {
		t.Fatal(err)
	}
	models, total, err := s.QueryCmdbModelsForProject(scope, "", 1, 10)
	if err != nil || total != 1 {
		t.Fatalf("真实型号未创建: total=%d err=%v", total, err)
	}
	if err := s.DeleteCmdbModelForProject(scope, models[0].ID); err != nil {
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
	types, err = s.ListCmdbTaxonomyForProject(scope, "terminal-categories")
	if err != nil {
		t.Fatal(err)
	}
	for _, category := range types {
		if category.Name == "工作站" {
			t.Fatal("重启恢复了用户主动删除的分类")
		}
	}
	if _, total, err := s.QueryCmdbModelsForProject(scope, "", 1, 10); err != nil || total != 0 {
		t.Fatalf("重启恢复了用户主动删除的型号: total=%d err=%v", total, err)
	}
}

func TestProjectAssetCatalogUpdatesOnAssetEdits(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	terminal := &Asset{AssetCode: "MODEL-EDIT", Vendor: "甲厂商", Status: "在用"}
	id, err := s.CreateAssetForProject(scope, terminal, "测试")
	if err != nil {
		t.Fatal(err)
	}
	terminal.ID = id
	terminal.Model = "终端型号"
	if err := s.UpdateAssetForProject(scope, terminal, "测试"); err != nil {
		t.Fatal(err)
	}
	cmdbID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "真实设备", Vendor: "乙厂商"})
	if err != nil {
		t.Fatal(err)
	}
	model := "设施型号"
	if _, err := s.ApplyCmdbAssetChangesForProject(scope, []int64{cmdbID}, CmdbAssetChanges{Model: &model}); err != nil {
		t.Fatal(err)
	}
	models, total, err := s.QueryCmdbModelsForProject(scope, "", 1, 100)
	if err != nil || total != 2 || len(models) != 2 {
		t.Fatalf("编辑后应实时收录已保存的型号: total=%d models=%+v err=%v", total, models, err)
	}
}

func TestProjectAssetCatalogBackfillsLegacyAndKeepsUserRecords(t *testing.T) {
	path := createLegacyProjectFixture(t)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE assets SET vendor='历史厂商', model='终端真实型号';
		UPDATE cmdb_assets SET vendor='历史厂商', model='基础设施真实型号', device_type='旧设备类型';
		INSERT INTO assets(asset_code, vendor, model) VALUES ('MISSING-MODEL', '历史厂商', '');
		INSERT INTO cmdb_device_models(vendor,model,height_u) VALUES ('历史厂商','终端真实型号',9);
		INSERT INTO cmdb_device_categories(name,asset_scope,sort_order) VALUES ('台式电脑','terminal',99);
		INSERT INTO cmdb_assets(name,device_type,category_id) VALUES ('历史技术编码资产','virtual_machine',0);`); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	var categoryID int64
	if err := s.db.QueryRow(`SELECT id FROM cmdb_device_categories WHERE project_id=? AND asset_scope='terminal' AND name='台式电脑' AND sort_order=99`, scope.ProjectID).Scan(&categoryID); err != nil {
		t.Fatalf("原有分类不可被覆盖: %v", err)
	}
	var modelID int64
	if err := s.db.QueryRow(`SELECT id FROM cmdb_device_models WHERE project_id=? AND vendor='历史厂商' AND model='终端真实型号' AND height_u=9`, scope.ProjectID).Scan(&modelID); err != nil {
		t.Fatalf("人工型号属性不可被覆盖: %v", err)
	}
	models, total, err := s.QueryCmdbModelsForProject(scope, "历史厂商", 1, 100)
	if err != nil || total != 2 || len(models) != 2 {
		t.Fatalf("旧库只应补真实双字段型号: total=%d models=%+v err=%v", total, models, err)
	}
	infra, err := s.ListCmdbTaxonomyForProject(scope, "infrastructure-categories")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, category := range infra {
		if category.Name == "旧设备类型" {
			found = true
		}
		if category.Name == "virtual_machine" {
			t.Fatalf("内部设备编码不能冒充基础设施目录类型: %+v", category)
		}
	}
	if !found {
		t.Fatalf("真实基础设施类型未回填: %+v", infra)
	}
}

func createLegacyProjectFixture(t *testing.T) string {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "legacy.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	legacy := &Store{db: db}
	if err := legacy.InitSchema(); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := legacy.InitCmdbSchema(); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := MigrateCMDBFullSchema(db); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := legacy.InitConfigSchema(); err != nil {
		db.Close()
		t.Fatal(err)
	}
	for _, table := range projectScopedTables {
		insertProjectScopedRow(t, db, table, "LEGACY")
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	return dbPath
}

func insertProjectScopedRow(t *testing.T, db *sql.DB, table, prefix string) int64 {
	t.Helper()
	value := prefix + "-" + table
	var result sql.Result
	var err error
	switch table {
	case "assets":
		result, err = db.Exec(`INSERT INTO assets(asset_code, updated_at) VALUES (?, '')`, value)
	case "asset_logs":
		result, err = db.Exec(`INSERT INTO asset_logs(description) VALUES (?)`, value)
	case "ip_pool":
		result, err = db.Exec(`INSERT INTO ip_pool(ip) VALUES (?)`, value)
	case "ip_subnets":
		result, err = db.Exec(`INSERT INTO ip_subnets(name) VALUES (?)`, value)
	case "servers":
		result, err = db.Exec(`INSERT INTO servers(asset_code, updated_at) VALUES (?, '')`, value)
	case "server_apps":
		result, err = db.Exec(`INSERT INTO server_apps(app_name, updated_at) VALUES (?, '')`, value)
	case "server_app_logs":
		var appID int64
		err = db.QueryRow(`SELECT id FROM server_apps ORDER BY id LIMIT 1`).Scan(&appID)
		if err == sql.ErrNoRows {
			appID = insertProjectScopedRow(t, db, "server_apps", prefix+"-app-log")
		} else if err != nil {
			t.Fatalf("读取应用履历的应用 ID: %v", err)
		}
		result, err = db.Exec(`INSERT INTO server_app_logs(project_id,app_id,log_type,operator,description,log_time) VALUES(0,?,'测试','测试',?,'')`, appID, value)
	case "cmdb_orgs":
		result, err = db.Exec(`INSERT INTO cmdb_orgs(name, updated_at) VALUES (?, '')`, value)
	case "cmdb_groups":
		result, err = db.Exec(`INSERT INTO cmdb_groups(name, updated_at) VALUES (?, '')`, value)
	case "cmdb_device_categories":
		result, err = db.Exec(`INSERT INTO cmdb_device_categories(name, updated_at) VALUES (?, '')`, value)
	case "cmdb_device_models":
		result, err = db.Exec(`INSERT INTO cmdb_device_models(vendor, model, updated_at) VALUES (?, ?, '')`, value, value)
	case "cmdb_assets":
		result, err = db.Exec(`INSERT INTO cmdb_assets(name, updated_at) VALUES (?, '')`, value)
	case "cmdb_asset_interfaces":
		var assetID int64
		err = db.QueryRow(`SELECT id FROM cmdb_assets ORDER BY id LIMIT 1`).Scan(&assetID)
		if err == sql.ErrNoRows {
			assetID = insertProjectScopedRow(t, db, "cmdb_assets", prefix+"-interface")
		} else if err != nil {
			t.Fatalf("读取 cmdb_asset_interfaces 的关联资产: %v", err)
		}
		result, err = db.Exec(`INSERT INTO cmdb_asset_interfaces(asset_id, updated_at) VALUES (?, '')`, assetID)
	case "cmdb_asset_links":
		var localAssetID int64
		err = db.QueryRow(`SELECT id FROM cmdb_assets ORDER BY id LIMIT 1`).Scan(&localAssetID)
		if err == sql.ErrNoRows {
			localAssetID = insertProjectScopedRow(t, db, "cmdb_assets", prefix+"-link-local")
		} else if err != nil {
			t.Fatalf("读取 cmdb_asset_links 的本端资产: %v", err)
		}
		peerAssetID := insertProjectScopedRow(t, db, "cmdb_assets", prefix+"-link-peer")
		result, err = db.Exec(`INSERT INTO cmdb_asset_links(local_asset_id, local_port, peer_asset_id, updated_at) VALUES (?, ?, ?, '')`, localAssetID, value, peerAssetID)
	case "cmdb_netcatty_links":
		var assetID int64
		err = db.QueryRow(`SELECT id FROM cmdb_assets ORDER BY id LIMIT 1`).Scan(&assetID)
		if err == sql.ErrNoRows {
			assetID = insertProjectScopedRow(t, db, "cmdb_assets", prefix+"-netcatty-link")
		} else if err != nil {
			t.Fatalf("读取 cmdb_netcatty_links 的关联资产: %v", err)
		}
		result, err = db.Exec(`INSERT INTO cmdb_netcatty_links(asset_type, asset_id, asset_sync_id, host_id, updated_at) VALUES ('infrastructure', ?, ?, ?, '')`, assetID, value, value)
	case "cmdb_switch_snapshots":
		var assetID int64
		err = db.QueryRow(`SELECT id FROM cmdb_assets ORDER BY id LIMIT 1`).Scan(&assetID)
		if err == sql.ErrNoRows {
			assetID = insertProjectScopedRow(t, db, "cmdb_assets", prefix+"-switch-snapshot")
		} else if err != nil {
			t.Fatalf("读取 cmdb_switch_snapshots 的关联资产: %v", err)
		}
		result, err = db.Exec(`INSERT INTO cmdb_switch_snapshots(asset_id, vendor, protocol, host_id, read_at, snapshot_json, updated_at) VALUES (?, 'huawei', 'ssh', ?, '', '{}', '')`, assetID, value)
	case "cmdb_asset_history":
		var assetID int64
		err = db.QueryRow(`SELECT id FROM cmdb_assets ORDER BY id LIMIT 1`).Scan(&assetID)
		if err == sql.ErrNoRows {
			assetID = insertProjectScopedRow(t, db, "cmdb_assets", prefix+"-history")
		} else if err != nil {
			t.Fatalf("读取 cmdb_asset_history 的关联资产: %v", err)
		}
		result, err = db.Exec(`INSERT INTO cmdb_asset_history(asset_id, event_type, occurred_at, updated_at) VALUES (?, ?, ?, '')`, assetID, value, value)
	case "cmdb_work_orders":
		result, err = db.Exec(`INSERT INTO cmdb_work_orders(subject, updated_at) VALUES (?, '')`, value)
	case "cmdb_work_order_logs":
		var workOrderID int64
		err = db.QueryRow(`SELECT id FROM cmdb_work_orders ORDER BY id LIMIT 1`).Scan(&workOrderID)
		if err == sql.ErrNoRows {
			workOrderID = insertProjectScopedRow(t, db, "cmdb_work_orders", prefix+"-log-order")
		} else if err != nil {
			t.Fatalf("读取工单记录的工单 ID: %v", err)
		}
		result, err = db.Exec(`INSERT INTO cmdb_work_order_logs(work_order_id,action,content,operator,created_at) VALUES(?,'测试',?,'测试','')`, workOrderID, value)
	case "cmdb_work_order_asset_links":
		var workOrderID int64
		err = db.QueryRow(`SELECT id FROM cmdb_work_orders ORDER BY id LIMIT 1`).Scan(&workOrderID)
		if err == sql.ErrNoRows {
			workOrderID = insertProjectScopedRow(t, db, "cmdb_work_orders", prefix+"-asset-link-order")
		} else if err != nil {
			t.Fatalf("读取工单关联的工单 ID: %v", err)
		}
		result, err = db.Exec(`INSERT INTO cmdb_work_order_asset_links(work_order_id, asset_type, asset_id, asset_name, created_at) VALUES (?, 'infrastructure', 1, ?, '')`, workOrderID, value)
	case "cmdb_work_order_attachments":
		var workOrderID int64
		err = db.QueryRow(`SELECT id FROM cmdb_work_orders ORDER BY id LIMIT 1`).Scan(&workOrderID)
		if err == sql.ErrNoRows {
			workOrderID = insertProjectScopedRow(t, db, "cmdb_work_orders", prefix+"-attachment-order")
		} else if err != nil {
			t.Fatalf("读取附件关联的工单 ID: %v", err)
		}
		result, err = db.Exec(`INSERT INTO cmdb_work_order_attachments(work_order_id, file_name, stored_name, size_bytes, content_type, created_at) VALUES (?, ?, ?, 1, 'text/plain', '')`, workOrderID, value+".txt", value+".stored")
	case "cmdb_inventory_tasks":
		result, err = db.Exec(`INSERT INTO cmdb_inventory_tasks(name, updated_at) VALUES (?, '')`, value)
	case "cmdb_credentials":
		result, err = db.Exec(`INSERT INTO cmdb_credentials(name, updated_at) VALUES (?, '')`, value)
	case "cmdb_labels":
		result, err = db.Exec(`INSERT INTO cmdb_labels(code, updated_at) VALUES (?, '')`, value)
	case "cmdb_persons":
		result, err = db.Exec(`INSERT INTO cmdb_persons(name, department, updated_at) VALUES (?, ?, '')`, value, value)
	case "cmdb_custom_fields":
		result, err = db.Exec(`INSERT INTO cmdb_custom_fields(field_key, field_name, field_type, updated_at) VALUES (?, ?, 'text', '')`, value, value)
	case "cmdb_org_nodes":
		result, err = db.Exec(`INSERT INTO cmdb_org_nodes(node_type, name, updated_at) VALUES ('organization', ?, '')`, value)
	case "cmdb_software_catalog":
		result, err = db.Exec(`INSERT INTO cmdb_software_catalog(name, updated_at) VALUES (?, '')`, value)
	case "cmdb_asset_software":
		result, err = db.Exec(`INSERT INTO cmdb_asset_software(remark, updated_at) VALUES (?, '')`, value)
	case "cmdb_locations":
		result, err = db.Exec(`INSERT INTO cmdb_locations(name, updated_at) VALUES (?, '')`, value)
	case "cmdb_statuses":
		result, err = db.Exec(`INSERT INTO cmdb_statuses(name, updated_at) VALUES (?, '')`, value)
	case "cmdb_network_types":
		result, err = db.Exec(`INSERT INTO cmdb_network_types(name, updated_at) VALUES (?, '')`, value)
	case "cmdb_work_order_categories":
		result, err = db.Exec(`INSERT INTO cmdb_work_order_categories(name, updated_at) VALUES (?, '')`, value)
	case "cmdb_work_order_types":
		result, err = db.Exec(`INSERT INTO cmdb_work_order_types(name, updated_at) VALUES (?, '')`, value)
	case "cmdb_work_order_priorities":
		result, err = db.Exec(`INSERT INTO cmdb_work_order_priorities(name, updated_at) VALUES (?, '')`, value)
	case "cmdb_work_order_rules":
		result, err = db.Exec(`INSERT INTO cmdb_work_order_rules(name, updated_at) VALUES (?, '')`, value)
	default:
		t.Fatalf("未定义 %s 的测试插入语句", table)
	}
	if err != nil {
		t.Fatalf("插入 %s: %v", table, err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("读取 %s 新记录 ID: %v", table, err)
	}
	return id
}

func assertProjectRows(t *testing.T, s *Store, table string, projectID int64) {
	t.Helper()
	rows, err := s.db.Query("SELECT project_id, sync_id, revision, updated_at FROM " + table + " ORDER BY id")
	if err != nil {
		t.Fatalf("读取 %s 同步元数据: %v", table, err)
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		count++
		var gotProjectID, revision int64
		var syncID, updatedAt string
		if err := rows.Scan(&gotProjectID, &syncID, &revision, &updatedAt); err != nil {
			t.Fatalf("读取 %s 同步元数据: %v", table, err)
		}
		if gotProjectID != projectID || syncID == "" || revision != 1 || updatedAt == "" {
			t.Fatalf("%s 同步元数据异常: project=%d sync=%q revision=%d updated=%q", table, gotProjectID, syncID, revision, updatedAt)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("遍历 %s 同步元数据: %v", table, err)
	}
	if count == 0 {
		t.Fatalf("旧库夹具未插入 %s 记录", table)
	}
}

func projectRowSyncIDs(t *testing.T, s *Store, table string) []string {
	t.Helper()
	rows, err := s.db.Query("SELECT sync_id FROM " + table + " ORDER BY id")
	if err != nil {
		t.Fatalf("读取 %s sync_id: %v", table, err)
	}
	defer rows.Close()
	var syncIDs []string
	for rows.Next() {
		var syncID string
		if err := rows.Scan(&syncID); err != nil {
			t.Fatalf("读取 %s sync_id: %v", table, err)
		}
		syncIDs = append(syncIDs, syncID)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("遍历 %s sync_id: %v", table, err)
	}
	return syncIDs
}
