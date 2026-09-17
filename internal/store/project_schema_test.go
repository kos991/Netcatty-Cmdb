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
	for _, table := range projectScopedTables {
		var count int
		if err := s.db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil {
			t.Fatalf("查询 %s: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("全新库 %s 有 %d 条业务数据", table, count)
		}
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
	case "cmdb_work_orders":
		result, err = db.Exec(`INSERT INTO cmdb_work_orders(subject, updated_at) VALUES (?, '')`, value)
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
