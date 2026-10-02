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
	"cmdb_asset_links",
	"cmdb_netcatty_links",
	"cmdb_switch_snapshots",
	"cmdb_asset_history",
	"cmdb_work_orders",
	"cmdb_work_order_asset_links",
	"cmdb_work_order_attachments",
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
	"cmdb_network_types",
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
	if _, err := tx.Exec(`INSERT OR REPLACE INTO _meta(k, v) VALUES ('cmdb_sync_apply', 'schema-migration')`); err != nil {
		return fmt.Errorf("mark project schema migration: %w", err)
	}
	for _, table := range projectScopedTables {
		if err := addMissingColumns(tx, table, columns); err != nil {
			return fmt.Errorf("add project columns to %s: %w", table, err)
		}
		if err := backfillProjectMetadata(tx, table, projectID, now); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DROP INDEX IF EXISTS idx_cmdb_network_types_sync_id`); err != nil {
		return fmt.Errorf("drop network type sync index: %w", err)
	}
	if _, err := tx.Exec(`CREATE UNIQUE INDEX idx_cmdb_network_types_sync_id
		ON cmdb_network_types(project_id, sync_id) WHERE sync_id IS NOT NULL AND sync_id <> ''`); err != nil {
		return fmt.Errorf("create project network type sync index: %w", err)
	}
	var networkTypesSeeded int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM _meta WHERE k='cmdb_network_types_seeded_v1'`).Scan(&networkTypesSeeded); err != nil {
		return fmt.Errorf("检查网络类型默认项: %w", err)
	}
	if networkTypesSeeded == 0 {
		rows, err := tx.Query(`SELECT id FROM cmdb_projects WHERE deleted_at IS NULL`)
		if err != nil {
			return fmt.Errorf("查询网络类型项目: %w", err)
		}
		var projectIDs []int64
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			projectIDs = append(projectIDs, id)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		for _, id := range projectIDs {
			if err := insertDefaultNetworkTypes(tx, id, now); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`INSERT INTO _meta(k,v) VALUES('cmdb_network_types_seeded_v1','1')`); err != nil {
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
	if err := backfillAssetCategoryTaxonomies(tx, now); err != nil {
		return err
	}
	if err := migrateLegacyPersonOrgPaths(tx, now); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM _meta WHERE k = 'cmdb_sync_apply'`); err != nil {
		return fmt.Errorf("clear project schema migration marker: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit project migration: %w", err)
	}
	return nil
}

func insertDefaultNetworkTypes(tx *sql.Tx, projectID int64, _ string) error {
	const createdAt = "1970-01-01T00:00:00Z"
	for index, name := range []string{"专网", "外网", "内网"} {
		syncID := uuid.NewSHA1(uuid.NameSpaceURL, []byte("netcatty/cmdb/network-type/"+name)).String()
		if _, err := tx.Exec(`INSERT INTO cmdb_network_types(project_id,sync_id,name,sort_order,created_at,updated_at)
			SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM cmdb_network_types WHERE project_id=? AND name=? AND deleted_at IS NULL)`,
			projectID, syncID, name, index+1, createdAt, createdAt, projectID, name); err != nil {
			return fmt.Errorf("初始化网络类型 %s: %w", name, err)
		}
	}
	return nil
}

func backfillAssetCategoryTaxonomies(tx *sql.Tx, now string) error {
	statements := []struct {
		scope  string
		table  string
		column string
	}{
		{scope: "terminal", table: "assets", column: "device_type"},
		{scope: "application", table: "server_apps", column: "app_type"},
	}
	for _, item := range statements {
		query := fmt.Sprintf(`INSERT OR IGNORE INTO cmdb_device_categories
			(project_id,name,asset_scope,parent_id,sort_order,created_at,updated_at)
			SELECT project_id,TRIM(%s),?,0,0,?,?
			FROM %s
			WHERE project_id>0 AND TRIM(IFNULL(%s,''))<>''
			GROUP BY project_id,TRIM(%s)`, item.column, item.table, item.column, item.column)
		if _, err := tx.Exec(query, item.scope, now, now); err != nil {
			return fmt.Errorf("backfill %s asset categories: %w", item.scope, err)
		}
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
	// 分类名称只要求在同一项目、同一资产范围和同一上级内唯一。
	// 旧索引不含 asset_scope，必须先删除后以同名索引重建，才能允许三类资产使用同名分类。
	if _, err := tx.Exec("DROP INDEX IF EXISTS idx_cmdb_categories_project_parent_name"); err != nil {
		return fmt.Errorf("drop idx_cmdb_categories_project_parent_name: %w", err)
	}
	indexes := []struct {
		drop   string
		create string
	}{
		{drop: "idx_cmdb_orgs_parent_name", create: "CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_orgs_project_parent_name ON cmdb_orgs(project_id, parent_id, name) WHERE deleted_at IS NULL"},
		{drop: "idx_cmdb_groups_parent_name", create: "CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_groups_project_parent_name ON cmdb_groups(project_id, parent_id, name) WHERE deleted_at IS NULL"},
		{drop: "idx_cmdb_categories_parent_name", create: "CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_categories_project_parent_name ON cmdb_device_categories(project_id, asset_scope, parent_id, name) WHERE deleted_at IS NULL"},
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
	if _, err := tx.Exec(`DROP INDEX IF EXISTS ux_cmdb_netcatty_primary_host`); err != nil {
		return fmt.Errorf("drop Netcatty primary host index: %w", err)
	}
	if _, err := tx.Exec(`CREATE UNIQUE INDEX ux_cmdb_netcatty_primary_host
		ON cmdb_netcatty_links(project_id, host_id) WHERE host_id <> '' AND is_primary = 1 AND deleted_at IS NULL`); err != nil {
		return fmt.Errorf("create Netcatty primary host index: %w", err)
	}
	if _, err := tx.Exec(`DROP INDEX IF EXISTS ux_cmdb_netcatty_asset_host`); err != nil {
		return fmt.Errorf("drop Netcatty asset host index: %w", err)
	}
	if _, err := tx.Exec(`CREATE UNIQUE INDEX ux_cmdb_netcatty_asset_host
		ON cmdb_netcatty_links(project_id, asset_type, asset_id, host_id) WHERE host_id <> '' AND deleted_at IS NULL`); err != nil {
		return fmt.Errorf("create Netcatty asset host index: %w", err)
	}
	if _, err := tx.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_cmdb_netcatty_asset_credential_only
		ON cmdb_netcatty_links(project_id, asset_type, asset_id, credential_id) WHERE host_id = '' AND credential_id <> '' AND deleted_at IS NULL`); err != nil {
		return fmt.Errorf("create Netcatty standalone credential index: %w", err)
	}
	if _, err := tx.Exec(`DROP INDEX IF EXISTS idx_cmdb_switch_snapshot_asset`); err != nil {
		return fmt.Errorf("drop switch snapshot asset index: %w", err)
	}
	if _, err := tx.Exec(`DROP INDEX IF EXISTS idx_cmdb_switch_snapshot_project_asset`); err != nil {
		return fmt.Errorf("drop project switch snapshot asset index: %w", err)
	}
	if _, err := tx.Exec(`CREATE UNIQUE INDEX idx_cmdb_switch_snapshot_project_asset
		ON cmdb_switch_snapshots(project_id, asset_id) WHERE deleted_at IS NULL`); err != nil {
		return fmt.Errorf("create switch snapshot project asset index: %w", err)
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
	if err := createProjectChangeTriggers(tx, table); err != nil {
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

func createProjectChangeTriggers(tx *sql.Tx, table string) error {
	for _, suffix := range []string{"sync_revision", "sync_soft_delete", "sync_delete"} {
		if _, err := tx.Exec(fmt.Sprintf("DROP TRIGGER IF EXISTS trg_%s_%s", table, suffix)); err != nil {
			return fmt.Errorf("drop %s %s trigger: %w", table, suffix, err)
		}
	}
	changeTrigger := fmt.Sprintf(`
		CREATE TRIGGER IF NOT EXISTS trg_%s_sync_revision
		AFTER UPDATE ON %s
		FOR EACH ROW
		WHEN OLD.project_id IS NOT NULL AND OLD.project_id > 0
			AND OLD.sync_id IS NOT NULL AND OLD.sync_id <> ''
			AND (NEW.revision IS NULL OR NEW.revision <= OLD.revision)
			AND NOT EXISTS (SELECT 1 FROM _meta WHERE k='cmdb_sync_apply')
		BEGIN
			UPDATE %s
			SET revision = OLD.revision + 1,
				updated_at = strftime('%%Y-%%m-%%dT%%H:%%M:%%fZ', 'now')
			WHERE id = NEW.id;
		END
	`, table, table, table)
	if _, err := tx.Exec(changeTrigger); err != nil {
		return fmt.Errorf("create %s revision trigger: %w", table, err)
	}

	tombstoneUpdateTrigger := fmt.Sprintf(`
		CREATE TRIGGER IF NOT EXISTS trg_%s_sync_soft_delete
		AFTER UPDATE OF deleted_at ON %s
		FOR EACH ROW
		WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
			AND NEW.sync_id IS NOT NULL AND NEW.sync_id <> ''
			AND NOT EXISTS (SELECT 1 FROM _meta WHERE k='cmdb_sync_apply')
		BEGIN
			INSERT INTO cmdb_tombstones(project_id,entity_type,sync_id,revision,deleted_at)
			VALUES(NEW.project_id,'%s',NEW.sync_id,
				CASE WHEN NEW.revision <= OLD.revision THEN OLD.revision + 1 ELSE NEW.revision END,
				NEW.deleted_at)
			ON CONFLICT(project_id,entity_type,sync_id) DO UPDATE SET
				revision=MAX(revision,excluded.revision),
				deleted_at=CASE WHEN excluded.revision >= revision THEN excluded.deleted_at ELSE deleted_at END;
		END
	`, table, table, table)
	if _, err := tx.Exec(tombstoneUpdateTrigger); err != nil {
		return fmt.Errorf("create %s soft-delete trigger: %w", table, err)
	}

	tombstoneDeleteTrigger := fmt.Sprintf(`
		CREATE TRIGGER IF NOT EXISTS trg_%s_sync_delete
		AFTER DELETE ON %s
		FOR EACH ROW
		WHEN OLD.project_id IS NOT NULL AND OLD.project_id > 0
			AND OLD.sync_id IS NOT NULL AND OLD.sync_id <> ''
			AND NOT EXISTS (SELECT 1 FROM _meta WHERE k='cmdb_sync_apply')
		BEGIN
			INSERT INTO cmdb_tombstones(project_id,entity_type,sync_id,revision,deleted_at)
			VALUES(OLD.project_id,'%s',OLD.sync_id,OLD.revision + 1,
				COALESCE(NULLIF(OLD.deleted_at,''),strftime('%%Y-%%m-%%dT%%H:%%M:%%fZ', 'now')))
			ON CONFLICT(project_id,entity_type,sync_id) DO UPDATE SET
				revision=MAX(revision,excluded.revision),
				deleted_at=CASE WHEN excluded.revision >= revision THEN excluded.deleted_at ELSE deleted_at END;
		END
	`, table, table, table)
	if _, err := tx.Exec(tombstoneDeleteTrigger); err != nil {
		return fmt.Errorf("create %s delete trigger: %w", table, err)
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
