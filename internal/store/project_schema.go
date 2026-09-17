package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const (
	DefaultProjectCode = "default"
	DefaultProjectName = "默认项目"
)

type CmdbProject struct {
	ID        int64  `json:"id"`
	SyncID    string `json:"sync_id"`
	Code      string `json:"code"`
	Name      string `json:"name"`
	Revision  int64  `json:"revision"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	DeletedAt string `json:"deleted_at"`
}

var projectScopedTables = []string{
	"assets",
	"asset_logs",
	"ip_pool",
	"ip_subnets",
	"servers",
	"server_apps",
	"cmdb_orgs",
	"cmdb_groups",
	"cmdb_device_categories",
	"cmdb_device_models",
	"cmdb_assets",
	"cmdb_asset_interfaces",
	"cmdb_work_orders",
	"cmdb_inventory_tasks",
	"cmdb_credentials",
	"cmdb_labels",
	"cmdb_persons",
	"cmdb_custom_fields",
}

const projectSchema = `
CREATE TABLE IF NOT EXISTS cmdb_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_id TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS cmdb_tombstones (
    project_id INTEGER NOT NULL,
    entity_type TEXT NOT NULL,
    sync_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    deleted_at TEXT NOT NULL,
    PRIMARY KEY (project_id, entity_type, sync_id),
    FOREIGN KEY(project_id) REFERENCES cmdb_projects(id)
);
CREATE INDEX IF NOT EXISTS idx_cmdb_tombstones_project ON cmdb_tombstones(project_id, deleted_at);
`

// MigrateProjectSchema 为所有现有业务实体补充项目归属和跨设备同步元数据。
func MigrateProjectSchema(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin project migration: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(projectSchema); err != nil {
		return fmt.Errorf("create project schema: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.Exec(`
		INSERT INTO cmdb_projects(sync_id, code, name, revision, created_at, updated_at)
		VALUES (?, ?, ?, 1, ?, ?)
		ON CONFLICT(code) DO NOTHING
	`, uuid.NewString(), DefaultProjectCode, DefaultProjectName, now, now); err != nil {
		return fmt.Errorf("create default project: %w", err)
	}

	var projectID int64
	if err := tx.QueryRow(`SELECT id FROM cmdb_projects WHERE code = ? AND deleted_at IS NULL`, DefaultProjectCode).Scan(&projectID); err != nil {
		return fmt.Errorf("read default project: %w", err)
	}

	columns := map[string]string{
		"project_id": "INTEGER",
		"sync_id":    "TEXT",
		"revision":   "INTEGER NOT NULL DEFAULT 1",
		"updated_at": "TEXT",
		"deleted_at": "TEXT",
	}
	for _, table := range projectScopedTables {
		if err := addMissingColumns(tx, table, columns); err != nil {
			return fmt.Errorf("add project columns to %s: %w", table, err)
		}
		if err := backfillProjectMetadata(tx, table, projectID, now); err != nil {
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit project migration: %w", err)
	}
	return nil
}

func backfillProjectMetadata(tx *sql.Tx, table string, projectID int64, now string) error {
	if _, err := tx.Exec("UPDATE "+table+" SET project_id = ? WHERE project_id IS NULL OR project_id = 0", projectID); err != nil {
		return fmt.Errorf("backfill %s project_id: %w", table, err)
	}
	if _, err := tx.Exec("UPDATE " + table + " SET revision = 1 WHERE revision IS NULL OR revision < 1"); err != nil {
		return fmt.Errorf("backfill %s revision: %w", table, err)
	}
	if _, err := tx.Exec("UPDATE "+table+" SET updated_at = ? WHERE updated_at IS NULL OR updated_at = ''", now); err != nil {
		return fmt.Errorf("backfill %s updated_at: %w", table, err)
	}

	rows, err := tx.Query("SELECT id FROM " + table + " WHERE sync_id IS NULL OR sync_id = '' ORDER BY id")
	if err != nil {
		return fmt.Errorf("list %s missing sync_id: %w", table, err)
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("scan %s id: %w", table, err)
		}
		ids = append(ids, id)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close %s id rows: %w", table, err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate %s ids: %w", table, err)
	}
	for _, id := range ids {
		if _, err := tx.Exec("UPDATE "+table+" SET sync_id = ? WHERE id = ?", uuid.NewString(), id); err != nil {
			return fmt.Errorf("backfill %s sync_id: %w", table, err)
		}
	}

	if _, err := tx.Exec(fmt.Sprintf(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_%s_sync_id ON %s(sync_id) WHERE sync_id IS NOT NULL AND sync_id <> ''",
		table, table,
	)); err != nil {
		return fmt.Errorf("index %s sync_id: %w", table, err)
	}
	if _, err := tx.Exec(fmt.Sprintf(
		"CREATE INDEX IF NOT EXISTS idx_%s_project_id ON %s(project_id, deleted_at)",
		table, table,
	)); err != nil {
		return fmt.Errorf("index %s project_id: %w", table, err)
	}
	return nil
}

func (s *Store) DefaultProject() (*CmdbProject, error) {
	var project CmdbProject
	var deletedAt sql.NullString
	err := s.db.QueryRow(`
		SELECT id, sync_id, code, name, revision, created_at, updated_at, deleted_at
		FROM cmdb_projects
		WHERE code = ? AND deleted_at IS NULL
	`, DefaultProjectCode).Scan(
		&project.ID,
		&project.SyncID,
		&project.Code,
		&project.Name,
		&project.Revision,
		&project.CreatedAt,
		&project.UpdatedAt,
		&deletedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("读取默认项目: %w", err)
	}
	project.DeletedAt = deletedAt.String
	return &project, nil
}
