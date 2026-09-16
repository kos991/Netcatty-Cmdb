package store

import (
	"path/filepath"
	"testing"
)

func TestInitCmdbSchemaCreatesAllTables(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "cmdb_schema_test.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer s.Close()

	want := []string{
		"cmdb_orgs", "cmdb_groups", "cmdb_device_categories",
		"cmdb_device_models", "cmdb_assets", "cmdb_asset_interfaces",
	}
	for _, table := range want {
		var name string
		err := s.db.QueryRow(
			`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table,
		).Scan(&name)
		if err != nil {
			t.Fatalf("表 %s 未创建: %v", table, err)
		}
	}
}

func TestInitCmdbSchemaIsIdempotent(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "cmdb_schema_twice.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer s.Close()

	if err := s.InitCmdbSchema(); err != nil {
		t.Fatalf("重复执行建表应当成功，实际失败: %v", err)
	}
}

// 模块表：工单 / 盘点 / 凭证 / 编码与标签（P0 第二阶段）。
func TestInitCmdbModuleTables(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "cmdb_module_schema_test.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer s.Close()

	want := []string{
		"cmdb_work_orders", "cmdb_inventory_tasks", "cmdb_credentials", "cmdb_labels",
	}
	for _, table := range want {
		var name string
		err := s.db.QueryRow(
			`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table,
		).Scan(&name)
		if err != nil {
			t.Fatalf("表 %s 未创建: %v", table, err)
		}
	}

	// 编码必须唯一
	now := "2026-09-14 19:00:00"
	if _, err := s.db.Exec(`INSERT INTO cmdb_labels (code, asset_id, status, created_at, updated_at)
		VALUES ('ZC-TEST-1', 0, '使用中', ?, ?)`, now, now); err != nil {
		t.Fatalf("写入编码失败: %v", err)
	}
	if _, err := s.db.Exec(`INSERT INTO cmdb_labels (code, asset_id, status, created_at, updated_at)
		VALUES ('ZC-TEST-1', 0, '使用中', ?, ?)`, now, now); err == nil {
		t.Fatalf("重复编码应当被唯一索引拒绝")
	}
}
