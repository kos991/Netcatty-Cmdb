package store

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

const configSchema = `
CREATE TABLE IF NOT EXISTS cmdb_org_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    sync_id TEXT,
    parent_id INTEGER NOT NULL DEFAULT 0,
    node_type TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_org_nodes_project_parent_name
    ON cmdb_org_nodes(project_id, parent_id, name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cmdb_software_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    sync_id TEXT,
    name TEXT NOT NULL,
    vendor TEXT NOT NULL DEFAULT '',
    version TEXT NOT NULL DEFAULT '',
    remark TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_software_project_name_vendor
    ON cmdb_software_catalog(project_id, name, vendor) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cmdb_asset_software (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    sync_id TEXT,
    asset_id INTEGER NOT NULL DEFAULT 0,
    software_id INTEGER NOT NULL DEFAULT 0,
    installed_version TEXT NOT NULL DEFAULT '',
    installed_at TEXT NOT NULL DEFAULT '',
    remark TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_asset_software_project_asset_software
    ON cmdb_asset_software(project_id, asset_id, software_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cmdb_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    sync_id TEXT,
    name TEXT NOT NULL,
    remark TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_locations_project_name
    ON cmdb_locations(project_id, name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cmdb_statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    sync_id TEXT,
    name TEXT NOT NULL,
    remark TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_statuses_project_name
    ON cmdb_statuses(project_id, name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cmdb_network_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    sync_id TEXT,
    name TEXT NOT NULL,
    remark TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_network_types_project_name
    ON cmdb_network_types(project_id, name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cmdb_work_order_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    sync_id TEXT,
    name TEXT NOT NULL,
    remark TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_work_order_categories_project_name
    ON cmdb_work_order_categories(project_id, name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cmdb_work_order_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    sync_id TEXT,
    name TEXT NOT NULL,
    remark TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_work_order_types_project_name
    ON cmdb_work_order_types(project_id, name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cmdb_work_order_priorities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    sync_id TEXT,
    name TEXT NOT NULL,
    remark TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_work_order_priorities_project_name
    ON cmdb_work_order_priorities(project_id, name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cmdb_work_order_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    sync_id TEXT,
    name TEXT NOT NULL,
    vendor TEXT NOT NULL DEFAULT '-',
    version TEXT NOT NULL DEFAULT 'YYYYMMDD',
    remark TEXT NOT NULL DEFAULT '每日',
    sort_order INTEGER NOT NULL DEFAULT 4,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_work_order_rules_project
    ON cmdb_work_order_rules(project_id) WHERE deleted_at IS NULL;
`

func (s *Store) InitConfigSchema() error {
	if _, err := s.db.Exec(configSchema); err != nil {
		return fmt.Errorf("init config schema: %w", err)
	}
	if err := addMissingColumns(s.db, "cmdb_persons", map[string]string{
		"org_id":        "INTEGER NOT NULL DEFAULT 0",
		"department_id": "INTEGER NOT NULL DEFAULT 0",
		"group_id":      "INTEGER NOT NULL DEFAULT 0",
	}); err != nil {
		return fmt.Errorf("add person organization columns: %w", err)
	}
	return nil
}

func migrateLegacyPersonOrgPaths(tx *sql.Tx, now string) error {
	rows, err := tx.Query(`
		SELECT id, project_id, IFNULL(org_name,''), IFNULL(department,''), IFNULL(group_name,'')
		FROM cmdb_persons
		WHERE deleted_at IS NULL
		  AND (org_id=0 OR department_id=0 OR (group_id=0 AND TRIM(IFNULL(group_name,''))<>''))
		ORDER BY id
	`)
	if err != nil {
		return fmt.Errorf("list legacy person organization paths: %w", err)
	}
	type legacyPersonPath struct {
		id, projectID                  int64
		orgName, department, groupName string
	}
	var people []legacyPersonPath
	for rows.Next() {
		var person legacyPersonPath
		if err := rows.Scan(&person.id, &person.projectID, &person.orgName, &person.department, &person.groupName); err != nil {
			rows.Close()
			return fmt.Errorf("scan legacy person organization path: %w", err)
		}
		people = append(people, person)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close legacy person organization rows: %w", err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate legacy person organization rows: %w", err)
	}

	for _, person := range people {
		department := strings.TrimSpace(person.department)
		if department == "" {
			continue
		}
		orgName := strings.TrimSpace(person.orgName)
		if orgName == "" {
			orgName = "未归属组织"
		}
		orgID, err := findOrCreateMigratedOrgNode(tx, person.projectID, 0, OrgNodeOrganization, orgName, now)
		if err != nil {
			return err
		}
		departmentID, err := findOrCreateMigratedOrgNode(tx, person.projectID, orgID, OrgNodeDepartment, department, now)
		if err != nil {
			return err
		}
		var groupID int64
		if groupName := strings.TrimSpace(person.groupName); groupName != "" {
			groupID, err = findOrCreateMigratedOrgNode(tx, person.projectID, departmentID, OrgNodeGroup, groupName, now)
			if err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`
			UPDATE cmdb_persons
			SET org_id=?, department_id=?, group_id=?, org_name=?, department=?, group_name=?, updated_at=?
			WHERE id=? AND project_id=?
		`, orgID, departmentID, groupID, orgName, department, strings.TrimSpace(person.groupName), now, person.id, person.projectID); err != nil {
			return fmt.Errorf("backfill person organization ids: %w", err)
		}
	}
	return nil
}

func findOrCreateMigratedOrgNode(tx *sql.Tx, projectID, parentID int64, nodeType, name, now string) (int64, error) {
	var id int64
	err := tx.QueryRow(`
		SELECT id FROM cmdb_org_nodes
		WHERE project_id=? AND parent_id=? AND node_type=? AND name=? AND deleted_at IS NULL
	`, projectID, parentID, nodeType, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != sql.ErrNoRows {
		return 0, fmt.Errorf("find migrated organization node: %w", err)
	}
	result, err := tx.Exec(`
		INSERT INTO cmdb_org_nodes(project_id, sync_id, parent_id, node_type, name, revision, created_at, updated_at)
		VALUES(?,?,?,?,?,1,?,?)
	`, projectID, uuid.NewString(), parentID, nodeType, name, now, now)
	if err != nil {
		return 0, fmt.Errorf("create migrated organization node: %w", err)
	}
	id, err = result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("read migrated organization node id: %w", err)
	}
	return id, nil
}
