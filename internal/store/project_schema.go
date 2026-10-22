package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const (
	DefaultProjectCode = "default"
	DefaultProjectName = "默认项目"
)

type CmdbProject struct {
	ID             int64  `json:"id"`
	SyncID         string `json:"sync_id"`
	Code           string `json:"code"`
	Name           string `json:"name"`
	AttachmentRoot string `json:"attachment_root"`
	Revision       int64  `json:"revision"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
	DeletedAt      string `json:"deleted_at"`
}

var projectScopedTables = []string{
	"assets",
	"asset_logs",
	"ip_pool",
	"ip_subnets",
	"servers",
	"server_apps",
	"server_app_logs",
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
	"cmdb_work_order_logs",
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
	if err := addMissingColumns(tx, "cmdb_projects", map[string]string{
		"attachment_root": "TEXT NOT NULL DEFAULT ''",
	}); err != nil {
		return fmt.Errorf("add attachment storage column to cmdb_projects: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var projectID int64
	err = tx.QueryRow(`SELECT id FROM cmdb_projects WHERE code = ? AND deleted_at IS NULL`, DefaultProjectCode).Scan(&projectID)
	if errors.Is(err, sql.ErrNoRows) {
		var activeProjects int
		if err := tx.QueryRow(`SELECT COUNT(*), COALESCE(MAX(id), 0) FROM cmdb_projects WHERE deleted_at IS NULL`).Scan(&activeProjects, &projectID); err != nil {
			return fmt.Errorf("read active projects: %w", err)
		}
		switch activeProjects {
		case 0:
			result, err := tx.Exec(`
				INSERT INTO cmdb_projects(sync_id, code, name, revision, created_at, updated_at)
				VALUES (?, ?, ?, 1, ?, ?)
			`, uuid.NewString(), DefaultProjectCode, DefaultProjectName, now, now)
			if err != nil {
				return fmt.Errorf("create default project: %w", err)
			}
			projectID, err = result.LastInsertId()
			if err != nil {
				return fmt.Errorf("read created default project: %w", err)
			}
		case 1:
			// 用户可修改唯一项目的编码；迁移与旧接口继续沿用该项目。
		default:
			return fmt.Errorf("read default project: %w", sql.ErrNoRows)
		}
	} else if err != nil {
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
	attachmentColumns := map[string]string{
		"content_hash":       "TEXT NOT NULL DEFAULT ''",
		"s3_key":             "TEXT NOT NULL DEFAULT ''",
		"s3_status":          "TEXT NOT NULL DEFAULT 'pending'",
		"cloud_object_id":    "TEXT NOT NULL DEFAULT ''",
		"encryption_version": "INTEGER NOT NULL DEFAULT 0",
		"wrapped_key":        "TEXT NOT NULL DEFAULT ''",
		"wrapped_key_iv":     "TEXT NOT NULL DEFAULT ''",
		"data_iv":            "TEXT NOT NULL DEFAULT ''",
	}
	if err := addMissingColumns(tx, "cmdb_work_order_attachments", attachmentColumns); err != nil {
		return fmt.Errorf("add CAS columns to cmdb_work_order_attachments: %w", err)
	}
	if _, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_cmdb_wo_attachments_hash ON cmdb_work_order_attachments(content_hash)`); err != nil {
		return fmt.Errorf("create attachment hash index: %w", err)
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
	// 默认类型、基础设施自由文本类型及型号只做一次历史回填，避免重启恢复用户主动删除的目录项。
	var catalogSeeded int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM _meta WHERE k='cmdb_asset_catalog_seeded_v1'`).Scan(&catalogSeeded); err != nil {
		return fmt.Errorf("check asset catalog initialization: %w", err)
	}
	// 终端/业务系统类型仍沿用原有重启回填约定：有资产引用的分类本就不能由配置中心删除。
	if err := backfillAssetCategoryTaxonomies(tx, now, catalogSeeded == 0); err != nil {
		return err
	}
	if catalogSeeded == 0 {
		if err := seedDefaultAssetCategories(tx); err != nil {
			return err
		}
		if err := backfillAssetModels(tx, now); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO _meta(k,v) VALUES('cmdb_asset_catalog_seeded_v1','1')`); err != nil {
			return fmt.Errorf("record asset catalog initialization: %w", err)
		}
	}
	if err := createAssetModelCatalogTriggers(tx); err != nil {
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

// 默认类型只填充同项目、同资产范围缺失的根节点；不调整用户已有节点的 ID、排序或上级。
var defaultAssetCategories = []struct {
	scope string
	names []string
}{
	{"terminal", []string{"台式电脑", "笔记本电脑", "云桌面终端", "云桌面盒子", "云盒", "一体机", "工作站", "瘦客户机", "平板电脑", "打印机", "扫描仪", "高拍仪", "自助终端"}},
	{"infrastructure", []string{"服务器", "虚拟机", "交换机", "路由器", "防火墙", "存储设备", "负载均衡设备", "无线接入点", "无线控制器", "网络安全设备", "UPS电源"}},
}

func seedDefaultAssetCategories(tx *sql.Tx) error {
	rows, err := tx.Query(`SELECT id FROM cmdb_projects WHERE deleted_at IS NULL`)
	if err != nil {
		return fmt.Errorf("list projects for asset categories: %w", err)
	}
	var projectIDs []int64
	for rows.Next() {
		var projectID int64
		if err := rows.Scan(&projectID); err != nil {
			rows.Close()
			return fmt.Errorf("scan project for asset categories: %w", err)
		}
		projectIDs = append(projectIDs, projectID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate projects for asset categories: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close projects for asset categories: %w", err)
	}
	for _, projectID := range projectIDs {
		if err := insertDefaultAssetCategories(tx, projectID); err != nil {
			return err
		}
	}
	return nil
}

func insertDefaultAssetCategories(tx *sql.Tx, projectID int64) error {
	var projectSyncID string
	if err := tx.QueryRow(`SELECT sync_id FROM cmdb_projects WHERE id=? AND deleted_at IS NULL`, projectID).Scan(&projectSyncID); err != nil {
		return fmt.Errorf("read project %d for asset categories: %w", projectID, err)
	}
	const createdAt = "1970-01-01T00:00:00Z"
	for _, group := range defaultAssetCategories {
		for index, name := range group.names {
			syncID := defaultAssetCategorySyncID(projectSyncID, group.scope, name)
			_, err := tx.Exec(`INSERT INTO cmdb_device_categories
				(project_id,sync_id,name,asset_scope,parent_id,sort_order,created_at,updated_at)
				SELECT ?,?,?,?,0,?,?,?
				WHERE NOT EXISTS (SELECT 1 FROM cmdb_device_categories
					WHERE project_id=? AND asset_scope=? AND name=? AND deleted_at IS NULL)`,
				projectID, syncID, name, group.scope, index+1, createdAt, createdAt,
				projectID, group.scope, name)
			if err != nil {
				return fmt.Errorf("seed %s category %s for project %d: %w", group.scope, name, projectID, err)
			}
		}
	}
	return nil
}

func defaultAssetCategorySyncID(projectSyncID, scope, name string) string {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("netcatty/cmdb/device-category/"+projectSyncID+"/"+scope+"/"+name)).String()
}

func backfillAssetCategoryTaxonomies(tx *sql.Tx, now string, includeInfrastructure bool) error {
	type categorySource struct {
		scope  string
		table  string
		column string
		filter string
	}
	statements := []categorySource{
		{scope: "terminal", table: "assets", column: "device_type", filter: "deleted_at IS NULL"},
		{scope: "application", table: "server_apps", column: "app_type", filter: "deleted_at IS NULL"},
	}
	if includeInfrastructure {
		statements = append(statements, categorySource{scope: "infrastructure", table: "cmdb_assets", column: "device_type",
			filter: `deleted_at IS NULL AND source_type <> 'legacy_asset' AND category_id=0
				AND device_type NOT IN ('server','virtual_machine','hyperconverged','switch','router','security_device','storage')`})
	}
	for _, item := range statements {
		query := fmt.Sprintf(`INSERT OR IGNORE INTO cmdb_device_categories
			(project_id,name,asset_scope,parent_id,sort_order,created_at,updated_at)
			SELECT project_id,TRIM(%s),?,0,0,?,?
			FROM %s
			WHERE project_id>0 AND TRIM(IFNULL(%s,''))<>'' AND %s
			GROUP BY project_id,TRIM(%s)`, item.column, item.table, item.column, item.filter, item.column)
		if _, err := tx.Exec(query, item.scope, now, now); err != nil {
			return fmt.Errorf("backfill %s asset categories: %w", item.scope, err)
		}
	}
	return nil
}

// 历史目录仅取两种已保存资产自己的厂商和型号；不根据设备名、品牌型号混写字段或夹具推测型号。
func backfillAssetModels(tx *sql.Tx, now string) error {
	_, err := tx.Exec(`INSERT INTO cmdb_device_models (project_id,vendor,model,created_at,updated_at)
		SELECT source.project_id, source.vendor, source.model, ?, ?
		FROM (
			SELECT project_id, TRIM(vendor) AS vendor, TRIM(model) AS model
			FROM assets WHERE project_id>0 AND deleted_at IS NULL
			UNION
			SELECT project_id, TRIM(vendor), TRIM(model)
			FROM cmdb_assets WHERE project_id>0 AND deleted_at IS NULL AND source_type <> 'legacy_asset'
		) source
		WHERE source.vendor<>'' AND source.model<>''
			AND NOT EXISTS (SELECT 1 FROM cmdb_device_models existing
				WHERE existing.project_id=source.project_id AND existing.vendor=source.vendor
					AND existing.model=source.model AND existing.deleted_at IS NULL)
		ON CONFLICT(project_id,vendor,model) WHERE deleted_at IS NULL DO NOTHING`, now, now)
	if err != nil {
		return fmt.Errorf("backfill asset models: %w", err)
	}
	return nil
}

// 资产导入、编辑和跨项目同步都会写两张资产表；在同一个事务内登记型号，
// 从而避免分别为每条保存路径维护目录逻辑或读目录时再修改数据。
func createAssetModelCatalogTriggers(tx *sql.Tx) error {
	for _, table := range []string{"assets", "cmdb_assets"} {
		filter := ""
		if table == "cmdb_assets" {
			filter = " AND NEW.source_type <> 'legacy_asset'"
		}
		for _, event := range []struct{ suffix, action string }{
			{"insert", "INSERT"},
			{"update", "UPDATE OF vendor, model"},
		} {
			name := "trg_" + table + "_catalog_model_" + event.suffix
			query := fmt.Sprintf(`CREATE TRIGGER IF NOT EXISTS %s AFTER %s ON %s
				FOR EACH ROW WHEN NEW.project_id>0 AND NEW.deleted_at IS NULL
					AND TRIM(IFNULL(NEW.vendor,''))<>'' AND TRIM(IFNULL(NEW.model,''))<>''%s
				BEGIN
					INSERT INTO cmdb_device_models(project_id,vendor,model,created_at,updated_at)
					SELECT NEW.project_id,TRIM(NEW.vendor),TRIM(NEW.model),
						strftime('%%Y-%%m-%%dT%%H:%%M:%%fZ','now'),strftime('%%Y-%%m-%%dT%%H:%%M:%%fZ','now')
					WHERE NOT EXISTS (
						SELECT 1 FROM cmdb_device_models
						WHERE project_id=NEW.project_id AND vendor=TRIM(NEW.vendor)
							AND model=TRIM(NEW.model) AND deleted_at IS NULL
					)
					ON CONFLICT(project_id,vendor,model) WHERE deleted_at IS NULL DO NOTHING;
				END`, name, event.action, table, filter)
			if _, err := tx.Exec(query); err != nil {
				return fmt.Errorf("create %s: %w", name, err)
			}
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
	if _, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_ip_pool_project_ip
		ON ip_pool(project_id, ip)`); err != nil {
		return fmt.Errorf("create project IP pool lookup index: %w", err)
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
	if err := createProjectInsertTrigger(tx, table, projectID); err != nil {
		return err
	}
	if err := createProjectChangeTriggers(tx, table); err != nil {
		return err
	}
	return nil
}

func createProjectInsertTrigger(tx *sql.Tx, table string, projectID int64) error {
	const uuidExpression = `(
		lower(hex(randomblob(4))) || '-' ||
		lower(hex(randomblob(2))) || '-4' ||
		substr(lower(hex(randomblob(2))), 2) || '-' ||
		substr('89ab', 1 + abs(random() % 4), 1) ||
		substr(lower(hex(randomblob(2))), 2) || '-' ||
		lower(hex(randomblob(6)))
	)`
	if _, err := tx.Exec(fmt.Sprintf("DROP TRIGGER IF EXISTS trg_%s_sync_metadata", table)); err != nil {
		return fmt.Errorf("drop %s sync metadata trigger: %w", table, err)
	}
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
			SET project_id = COALESCE(NULLIF(NEW.project_id, 0), %d),
				sync_id = COALESCE(NULLIF(NEW.sync_id, ''), %s),
				revision = CASE WHEN NEW.revision IS NULL OR NEW.revision < 1 THEN 1 ELSE NEW.revision END,
				updated_at = COALESCE(NULLIF(NEW.updated_at, ''), strftime('%%Y-%%m-%%dT%%H:%%M:%%fZ', 'now'))
			WHERE id = NEW.id;
		END
	`, table, table, table, projectID, uuidExpression)
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
	query := `
		SELECT id, sync_id, code, name, revision, created_at, updated_at, deleted_at
		FROM cmdb_projects
		WHERE code = ? AND deleted_at IS NULL
	`
	err := s.db.QueryRow(query, DefaultProjectCode).Scan(
		&project.ID,
		&project.SyncID,
		&project.Code,
		&project.Name,
		&project.Revision,
		&project.CreatedAt,
		&project.UpdatedAt,
		&deletedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		err = s.db.QueryRow(`
			SELECT id, sync_id, code, name, revision, created_at, updated_at, deleted_at
			FROM cmdb_projects
			WHERE deleted_at IS NULL
			  AND (SELECT COUNT(*) FROM cmdb_projects WHERE deleted_at IS NULL) = 1
		`).Scan(
			&project.ID,
			&project.SyncID,
			&project.Code,
			&project.Name,
			&project.Revision,
			&project.CreatedAt,
			&project.UpdatedAt,
			&deletedAt,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("读取默认项目: %w", err)
	}
	project.DeletedAt = deletedAt.String
	return &project, nil
}
