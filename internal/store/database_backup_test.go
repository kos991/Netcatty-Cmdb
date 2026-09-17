package store

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestOpenCreatesReadableBackupBeforeProjectMigration(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "legacy.db")
	createPreProjectDatabase(t, dbPath)

	s, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	backups, err := filepath.Glob(dbPath + ".backup-*")
	if err != nil {
		t.Fatal(err)
	}
	if len(backups) != 1 {
		t.Fatalf("备份数=%d，期望 1: %v", len(backups), backups)
	}
	backup, err := sql.Open("sqlite", backups[0])
	if err != nil {
		t.Fatal(err)
	}
	defer backup.Close()
	var code string
	if err := backup.QueryRow(`SELECT asset_code FROM assets WHERE id = 1`).Scan(&code); err != nil {
		t.Fatalf("备份不可读: %v", err)
	}
	if code != "LEGACY-A" {
		t.Fatalf("备份记录=%q", code)
	}
	columns, err := getTableColumns(backup, "assets")
	if err != nil {
		t.Fatal(err)
	}
	if columns["project_id"] {
		t.Fatal("备份发生在项目迁移之后")
	}

	second, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	second.Close()
	backups, _ = filepath.Glob(dbPath + ".backup-*")
	if len(backups) != 1 {
		t.Fatalf("无需迁移时重复备份: %v", backups)
	}
}

func TestOpenCreatesBackupBeforeProjectMigrationForFileURI(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "legacy-uri.db")
	createPreProjectDatabase(t, dbPath)

	uri := "file:" + filepath.ToSlash(dbPath) + "?mode=rwc"
	s, err := Open(uri)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	backups, err := filepath.Glob(dbPath + ".backup-*")
	if err != nil {
		t.Fatal(err)
	}
	if len(backups) != 1 {
		t.Fatalf("URI 旧库备份数=%d，期望=1: %v", len(backups), backups)
	}
	backup, err := sql.Open("sqlite", backups[0])
	if err != nil {
		t.Fatal(err)
	}
	defer backup.Close()
	columns, err := getTableColumns(backup, "assets")
	if err != nil {
		t.Fatal(err)
	}
	if columns["project_id"] {
		t.Fatal("URI 旧库备份发生在项目迁移之后")
	}
}

func TestDatabaseFilePathHandlesSQLiteURIs(t *testing.T) {
	absoluteURIPath := filepath.FromSlash("/C:/cmdb/legacy.db")
	if runtime.GOOS == "windows" {
		absoluteURIPath = filepath.FromSlash("C:/cmdb/legacy.db")
	}
	tests := []struct {
		name  string
		input string
		want  string
		ok    bool
	}{
		{name: "普通路径含查询参数", input: "legacy.db?cache=shared", want: "legacy.db", ok: true},
		{name: "相对 file URI", input: "file:legacy.db?mode=rwc", want: "legacy.db", ok: true},
		{name: "相对目录 file URI", input: "file:data/legacy.db?mode=rwc", want: filepath.Join("data", "legacy.db"), ok: true},
		{name: "Windows 盘符 file URI", input: "file:C:/cmdb/legacy.db?mode=rwc", want: filepath.FromSlash("C:/cmdb/legacy.db"), ok: true},
		{name: "绝对 file URI", input: "file:///C:/cmdb/legacy.db?mode=rwc", want: absoluteURIPath, ok: true},
		{name: "共享内存 URI", input: "file::memory:?cache=shared", want: "", ok: false},
		{name: "mode memory URI", input: "file:cmdb?mode=memory&cache=shared", want: "", ok: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := databaseFilePath(tt.input)
			if ok != tt.ok || got != tt.want {
				t.Fatalf("databaseFilePath(%q) = (%q, %t), want (%q, %t)", tt.input, got, ok, tt.want, tt.ok)
			}
		})
	}
}

func TestFreshDatabaseDoesNotCreateMigrationBackup(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "fresh.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	backups, _ := filepath.Glob(dbPath + ".backup-*")
	if len(backups) != 0 {
		t.Fatalf("全新库不应生成升级备份: %v", backups)
	}
}

func TestMigrationFailureReturnsBackupPathAndClosesDatabase(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "broken.db")
	createPreProjectDatabase(t, dbPath)
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE VIEW cmdb_projects AS SELECT 1 AS id`); err != nil {
		db.Close()
		t.Fatal(err)
	}
	db.Close()

	_, err = Open(dbPath)
	if err == nil {
		t.Fatal("损坏的项目结构应阻断打开")
	}
	var migrationErr *MigrationError
	if !errors.As(err, &migrationErr) {
		t.Fatalf("错误类型=%T: %v", err, err)
	}
	if migrationErr.BackupPath == "" || !strings.Contains(err.Error(), migrationErr.BackupPath) {
		t.Fatalf("错误未包含备份路径: %v", err)
	}
	if _, statErr := os.Stat(migrationErr.BackupPath); statErr != nil {
		t.Fatalf("备份不存在: %v", statErr)
	}
	if renameErr := os.Rename(dbPath, dbPath+".moved"); renameErr != nil {
		t.Fatalf("迁移失败后数据库仍被占用: %v", renameErr)
	}
}

func createPreProjectDatabase(t *testing.T, dbPath string) {
	t.Helper()
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	legacy := &Store{db: db}
	if err := legacy.InitSchema(); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO assets(asset_code) VALUES ('LEGACY-A')`); err != nil {
		t.Fatal(err)
	}
}
