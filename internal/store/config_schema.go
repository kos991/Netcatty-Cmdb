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
	// 机柜作为位置目录项登记，rack_units 为机柜总 U 数；0 表示未设置，按默认 42U 展示。
	if err := addMissingColumns(s.db, "cmdb_locations", map[string]string{
		"rack_units":    "INTEGER NOT NULL DEFAULT 0",
		"location_type": "TEXT NOT NULL DEFAULT ''",
		"data_center":   "TEXT NOT NULL DEFAULT ''",
		"cabinet_name":  "TEXT NOT NULL DEFAULT ''",
	}); err != nil {
		return fmt.Errorf("add location rack units column: %w", err)
	}
	return nil
}

func migrateLegacyPersonOrgPaths(tx *sql.Tx, now string) error {
	// 优先信任仍然有效的部门节点。旧测试数据曾把 cmdb_orgs.id 写入 org_id，
	// 该值可能非零，因此不能只修复 org_id=0 的人员。
	validRows, err := tx.Query(`
		SELECT p.id, p.project_id, d.id, d.name, o.id, o.name,
		       p.group_id, CASE WHEN g.id IS NULL THEN IFNULL(p.group_name,'') ELSE g.name END
		FROM cmdb_persons p
		JOIN cmdb_org_nodes d ON d.id=p.department_id AND d.project_id=p.project_id
		  AND d.node_type=? AND d.deleted_at IS NULL
		JOIN cmdb_org_nodes o ON o.id=d.parent_id AND o.project_id=p.project_id
		  AND o.node_type=? AND o.deleted_at IS NULL
		LEFT JOIN cmdb_org_nodes g ON g.id=p.group_id AND g.project_id=p.project_id
		  AND g.node_type=? AND g.parent_id=d.id AND g.deleted_at IS NULL
		WHERE p.deleted_at IS NULL
		  AND (p.org_id<>o.id OR IFNULL(p.org_name,'')<>o.name OR IFNULL(p.department,'')<>d.name
		       OR (g.id IS NOT NULL AND IFNULL(p.group_name,'')<>g.name))
		ORDER BY p.id
	`, OrgNodeDepartment, OrgNodeOrganization, OrgNodeGroup)
	if err != nil {
		return fmt.Errorf("list persons with recoverable organization path: %w", err)
	}
	type validPersonPath struct {
		id, projectID, departmentID, orgID, groupID int64
		department, orgName, groupName              string
	}
	var validPaths []validPersonPath
	for validRows.Next() {
		var path validPersonPath
		if err := validRows.Scan(&path.id, &path.projectID, &path.departmentID, &path.department, &path.orgID, &path.orgName, &path.groupID, &path.groupName); err != nil {
			validRows.Close()
			return fmt.Errorf("scan recoverable person organization path: %w", err)
		}
		validPaths = append(validPaths, path)
	}
	if err := validRows.Err(); err != nil {
		validRows.Close()
		return fmt.Errorf("iterate recoverable person organization paths: %w", err)
	}
	if err := validRows.Close(); err != nil {
		return fmt.Errorf("close recoverable person organization paths: %w", err)
	}
	for _, path := range validPaths {
		if _, err := tx.Exec(`UPDATE cmdb_persons
			SET org_id=?, org_name=?, department=?, group_name=?, updated_at=?
			WHERE id=? AND project_id=?`, path.orgID, path.orgName, path.department, path.groupName, now, path.id, path.projectID); err != nil {
			return fmt.Errorf("repair person organization from department: %w", err)
		}
	}

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
		orgName := strings.TrimSpace(person.orgName)
		if department == "" {
			if orgName == "" {
				continue
			}
			orgID, err := findOrCreateMigratedOrgNode(tx, person.projectID, 0, OrgNodeOrganization, orgName, now)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`
				UPDATE cmdb_persons SET org_id=?, org_name=?, updated_at=?
				WHERE id=? AND project_id=?
			`, orgID, orgName, now, person.id, person.projectID); err != nil {
				return fmt.Errorf("backfill person organization id: %w", err)
			}
			continue
		}
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
