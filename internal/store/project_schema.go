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
	"cmdb_org_nodes",
	"cmdb_software_catalog",
	"cmdb_asset_software",
	"cmdb_locations",
	"cmdb_statuses",
	"cmdb_work_order_categories",
	"cmdb_work_order_types",
	"cmdb_work_order_priorities",
	"cmdb_work_order_rules",
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
	if err := addMissingColumns(tx, "cmdb_custom_fields", columns); err != nil {
		return fmt.Errorf("add project columns to cmdb_custom_fields: %w", err)
	}
	if err := migrateLegacyCustomFieldUniqueConstraint(tx); err != nil {
		return err
	}
	for _, table := range projectScopedTables {
		if err := addMissingColumns(tx, table, columns); err != nil {
			return fmt.Errorf("add project columns to %s: %w", table, err)
		}
		if err := backfillProjectMetadata(tx, table, projectID, now); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`
		INSERT OR REPLACE INTO _meta(k, v) VALUES ('project_schema_version', ?)
	`, projectSchemaVersion); err != nil {
		return fmt.Errorf("record project schema version: %w", err)
	}
	if err := migrateProjectUniqueIndexes(tx); err != nil {
		return err
	}
	if err := migrateLegacyPersonOrgPaths(tx, now); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit project migration: %w", err)
	}
	return nil
}

func migrateLegacyCustomFieldUniqueConstraint(tx *sql.Tx) error {
	var legacyConstraintCount int
	if err := tx.QueryRow(`
		SELECT COUNT(*)
		FROM pragma_index_list('cmdb_custom_fields') AS indexes
		WHERE indexes.origin = 'u'
		  AND EXISTS (
			SELECT 1
			FROM pragma_index_info(indexes.name) AS columns
			WHERE columns.name = 'field_key'
		  )
	`).Scan(&legacyConstraintCount); err != nil {
		return fmt.Errorf("inspect legacy custom field unique constraint: %w", err)
	}
	if legacyConstraintCount == 0 {
		return nil
	}

	if _, err := tx.Exec(`
		ALTER TABLE cmdb_custom_fields RENAME TO cmdb_custom_fields_legacy_unique;
		CREATE TABLE cmdb_custom_fields (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			field_key TEXT NOT NULL,
			field_name TEXT NOT NULL,
			field_type TEXT NOT NULL,
			options_json TEXT,
			asset_class TEXT NOT NULL DEFAULT 'all',
			required INTEGER NOT NULL DEFAULT 0,
			show_in_list INTEGER NOT NULL DEFAULT 0,
			export_excel INTEGER NOT NULL DEFAULT 1,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at TEXT,
			updated_at TEXT,
			project_id INTEGER,
			sync_id TEXT,
			revision INTEGER NOT NULL DEFAULT 1,
			deleted_at TEXT
		);
		INSERT INTO cmdb_custom_fields (
			id, field_key, field_name, field_type, options_json, asset_class,
			required, show_in_list, export_excel, sort_order, created_at, updated_at,
			project_id, sync_id, revision, deleted_at
		)
		SELECT
			id, field_key, field_name, field_type, options_json, asset_class,
			required, show_in_list, export_excel, sort_order, created_at, updated_at,
			project_id, sync_id, revision, deleted_at
		FROM cmdb_custom_fields_legacy_unique;
		DROP TABLE cmdb_custom_fields_legacy_unique;
		CREATE INDEX IF NOT EXISTS idx_cmdb_cf_class ON cmdb_custom_fields(asset_class);
	`); err != nil {
		return fmt.Errorf("remove legacy custom field unique constraint: %w", err)
	}
	return nil
}

func migrateProjectUniqueIndexes(tx *sql.Tx) error {
	indexes := []struct {
		drop   string
		create string
	}{
		{drop: "idx_cmdb_orgs_parent_name", create: "CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_orgs_project_parent_name ON cmdb_orgs(project_id, parent_id, name) WHERE deleted_at IS NULL"},
		{drop: "idx_cmdb_groups_parent_name", create: "CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_groups_project_parent_name ON cmdb_groups(project_id, parent_id, name) WHERE deleted_at IS NULL"},
		{drop: "idx_cmdb_categories_parent_name", create: "CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_categories_project_parent_name ON cmdb_device_categories(project_id, parent_id, name) WHERE deleted_at IS NULL"},
		{drop: "idx_cmdb_models_vendor_model", create: "CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_models_project_vendor_model ON cmdb_device_models(project_id, vendor, model) WHERE deleted_at IS NULL"},
		{drop: "idx_cmdb_labels_code", create: "CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_labels_project_code ON cmdb_labels(project_id, code) WHERE deleted_at IS NULL"},
		{drop: "idx_cmdb_assets_source", create: "CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_assets_project_source ON cmdb_assets(project_id, source_type, source_id) WHERE source_id > 0 AND deleted_at IS NULL"},
		{drop: "idx_cmdb_cf_key", create: "CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_cf_project_key ON cmdb_custom_fields(project_id, field_key) WHERE deleted_at IS NULL"},
		{drop: "idx_ip_subnets_name", create: "CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_subnets_project_name ON ip_subnets(project_id, name) WHERE deleted_at IS NULL"},
	}
	for _, idx := range indexes {
		if _, err := tx.Exec("DROP INDEX IF EXISTS " + idx.drop); err != nil {
			return fmt.Errorf("drop %s: %w", idx.drop, err)
		}
		if _, err := tx.Exec(idx.create); err != nil {
			return fmt.Errorf("create project unique index after %s: %w", idx.drop, err)
		}
	}
	if _, err := tx.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_work_orders_project_order_no
		ON cmdb_work_orders(project_id, order_no) WHERE order_no <> '' AND deleted_at IS NULL`); err != nil {
		return fmt.Errorf("create project work order number index: %w", err)
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
	if err := createProjectInsertTrigger(tx, table); err != nil {
		return err
	}
	return nil
}

func createProjectInsertTrigger(tx *sql.Tx, table string) error {
	const uuidExpression = `(
		lower(hex(randomblob(4))) || '-' ||
		lower(hex(randomblob(2))) || '-4' ||
		substr(lower(hex(randomblob(2))), 2) || '-' ||
		substr('89ab', 1 + abs(random() % 4), 1) ||
		substr(lower(hex(randomblob(2))), 2) || '-' ||
		lower(hex(randomblob(6)))
	)`
	query := fmt.Sprintf(`
		CREATE TRIGGER IF NOT EXISTS trg_%s_sync_metadata
		AFTER INSERT ON %s
		FOR EACH ROW
		WHEN NEW.project_id IS NULL OR NEW.project_id = 0
			OR NEW.sync_id IS NULL OR NEW.sync_id = ''
			OR NEW.revision IS NULL OR NEW.revision < 1
			OR NEW.updated_at IS NULL OR NEW.updated_at = ''
		BEGIN
			UPDATE %s
			SET project_id = COALESCE(NULLIF(NEW.project_id, 0), (
					SELECT id FROM cmdb_projects WHERE code = '%s' AND deleted_at IS NULL
				)),
				sync_id = COALESCE(NULLIF(NEW.sync_id, ''), %s),
				revision = CASE WHEN NEW.revision IS NULL OR NEW.revision < 1 THEN 1 ELSE NEW.revision END,
				updated_at = COALESCE(NULLIF(NEW.updated_at, ''), strftime('%%Y-%%m-%%dT%%H:%%M:%%fZ', 'now'))
			WHERE id = NEW.id;
		END
	`, table, table, table, DefaultProjectCode, uuidExpression)
	if _, err := tx.Exec(query); err != nil {
		return fmt.Errorf("create %s sync metadata trigger: %w", table, err)
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
