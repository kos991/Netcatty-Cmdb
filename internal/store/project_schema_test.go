package store

import (
	"database/sql"
	"path/filepath"
	"testing"

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
	for _, table := range []string{"assets", "asset_logs", "ip_pool", "servers", "server_apps", "cmdb_assets", "cmdb_persons"} {
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
	_, err = db.Exec(`
		INSERT INTO assets(asset_code, updated_at) VALUES ('LEGACY-A', '2026-01-02 03:04:05');
		INSERT INTO asset_logs(description) VALUES ('历史履历');
		INSERT INTO ip_pool(ip) VALUES ('192.0.2.10');
		INSERT INTO servers(asset_code, updated_at) VALUES ('LEGACY-S', '');
	`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	first, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	project, err := first.DefaultProject()
	if err != nil {
		t.Fatal(err)
	}
	assetSyncID := projectRowSyncID(t, first, "assets")
	logSyncID := projectRowSyncID(t, first, "asset_logs")
	assertProjectRow(t, first, "assets", project.ID)
	assertProjectRow(t, first, "asset_logs", project.ID)
	assertProjectRow(t, first, "ip_pool", project.ID)
	assertProjectRow(t, first, "servers", project.ID)
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
	if got := projectRowSyncID(t, second, "assets"); got != assetSyncID {
		t.Fatalf("资产 UUID 被重写: %s -> %s", assetSyncID, got)
	}
	if got := projectRowSyncID(t, second, "asset_logs"); got != logSyncID {
		t.Fatalf("履历 UUID 被重写: %s -> %s", logSyncID, got)
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

func assertProjectRow(t *testing.T, s *Store, table string, projectID int64) {
	t.Helper()
	var gotProjectID, revision int64
	var syncID, updatedAt string
	if err := s.db.QueryRow("SELECT project_id, sync_id, revision, updated_at FROM "+table+" LIMIT 1").
		Scan(&gotProjectID, &syncID, &revision, &updatedAt); err != nil {
		t.Fatalf("读取 %s 同步元数据: %v", table, err)
	}
	if gotProjectID != projectID || syncID == "" || revision != 1 || updatedAt == "" {
		t.Fatalf("%s 同步元数据异常: project=%d sync=%q revision=%d updated=%q", table, gotProjectID, syncID, revision, updatedAt)
	}
}

func projectRowSyncID(t *testing.T, s *Store, table string) string {
	t.Helper()
	var syncID string
	if err := s.db.QueryRow("SELECT sync_id FROM " + table + " LIMIT 1").Scan(&syncID); err != nil {
		t.Fatalf("读取 %s sync_id: %v", table, err)
	}
	return syncID
}
