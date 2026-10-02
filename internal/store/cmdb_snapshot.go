package store

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const CmdbSnapshotSchemaVersion = 1

type SnapshotExportOptions struct {
	IncludeContacts bool `json:"include_contacts"`
	IncludeHistory  bool `json:"include_history"`
}

type Tombstone struct {
	EntityType string `json:"entity_type"`
	SyncID     string `json:"sync_id"`
	Revision   int64  `json:"revision"`
	DeletedAt  string `json:"deleted_at"`
}

type CmdbSnapshot struct {
	SchemaVersion int                        `json:"schema_version"`
	ProjectSyncID string                     `json:"project_sync_id"`
	GeneratedAt   string                     `json:"generated_at"`
	BaseHash      string                     `json:"base_hash"`
	Collections   map[string]json.RawMessage `json:"collections"`
	Tombstones    []Tombstone                `json:"tombstones"`
}

type CmdbSyncConflict struct {
	EntityType string `json:"entity_type"`
	SyncID     string `json:"sync_id"`
	Field      string `json:"field,omitempty"`
	Reason     string `json:"reason"`
}

type CmdbMergePreview struct {
	Added                 int                `json:"added"`
	Updated               int                `json:"updated"`
	Deleted               int                `json:"deleted"`
	Conflicts             int                `json:"conflicts"`
	UnresolvedReferences  int                `json:"unresolved_references"`
	SuppressedByTombstone int                `json:"suppressed_by_tombstone"`
	BaseHash              string             `json:"base_hash"`
	BackupPath            string             `json:"backup_path,omitempty"`
	ConflictDetails       []CmdbSyncConflict `json:"conflict_details"`
}

type CmdbMergeResult = CmdbMergePreview

var snapshotExcludedTables = map[string]bool{
	"cmdb_work_order_attachments": true,
}

var snapshotApplyOrder = []string{
	"cmdb_orgs", "cmdb_groups", "cmdb_device_categories", "cmdb_device_models",
	"cmdb_org_nodes", "cmdb_persons", "cmdb_software_catalog", "cmdb_locations", "cmdb_statuses", "cmdb_network_types",
	"cmdb_work_order_categories", "cmdb_work_order_types", "cmdb_work_order_priorities", "cmdb_work_order_rules",
	"cmdb_custom_fields", "assets", "servers", "server_apps", "cmdb_assets", "cmdb_asset_interfaces",
	"cmdb_asset_links", "cmdb_netcatty_links", "cmdb_switch_snapshots", "cmdb_asset_history", "cmdb_work_orders",
	"cmdb_work_order_asset_links", "cmdb_inventory_tasks", "cmdb_credentials", "cmdb_labels",
	"cmdb_asset_software", "ip_subnets", "ip_pool", "asset_logs", "cmdb_work_order_attachments",
}

func (s *Store) ExportCmdbSnapshot(scope ProjectScope, options SnapshotExportOptions) (*CmdbSnapshot, error) {
	project, err := s.ResolveProject(scope)
	if err != nil {
		return nil, err
	}
	referenceIndex, err := buildSnapshotReferenceIndex(s.db, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	collections := make(map[string]json.RawMessage)
	for _, table := range projectScopedTables {
		if snapshotExcludedTables[table] || (!options.IncludeHistory && (table == "asset_logs" || table == "cmdb_asset_history")) {
			continue
		}
		records, err := readSnapshotTable(s.db, table, scope.ProjectID, options, referenceIndex)
		if err != nil {
			return nil, err
		}
		encoded, err := json.Marshal(records)
		if err != nil {
			return nil, fmt.Errorf("编码同步集合 %s: %w", table, err)
		}
		collections[table] = encoded
	}
	tombstones, err := readSnapshotTombstones(s.db, scope.ProjectID, options)
	if err != nil {
		return nil, err
	}
	snapshot := &CmdbSnapshot{
		SchemaVersion: CmdbSnapshotSchemaVersion,
		ProjectSyncID: project.SyncID,
		GeneratedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		Collections:   collections,
		Tombstones:    tombstones,
	}
	hash, err := snapshotContentHash(snapshot)
	if err != nil {
		return nil, err
	}
	snapshot.BaseHash = hash
	return snapshot, nil
}

type snapshotQueryer interface {
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

type snapshotTransaction interface {
	snapshotQueryer
	QueryRow(query string, args ...any) *sql.Row
	Exec(query string, args ...any) (sql.Result, error)
}

func readSnapshotTable(q snapshotQueryer, table string, projectID int64, options SnapshotExportOptions, referenceIndex snapshotReferenceIndex) ([]map[string]any, error) {
	rows, err := q.Query("SELECT * FROM "+table+" WHERE project_id=? AND deleted_at IS NULL ORDER BY sync_id", projectID)
	if err != nil {
		return nil, fmt.Errorf("读取同步集合 %s: %w", table, err)
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("读取同步集合 %s 列: %w", table, err)
	}
	records := make([]map[string]any, 0)
	for rows.Next() {
		values := make([]any, len(columns))
		targets := make([]any, len(columns))
		for index := range targets {
			targets[index] = &values[index]
		}
		if err := rows.Scan(targets...); err != nil {
			return nil, fmt.Errorf("扫描同步集合 %s: %w", table, err)
		}
		rawRecord := make(map[string]any, len(columns))
		for index, column := range columns {
			if bytes, ok := values[index].([]byte); ok {
				rawRecord[column] = string(bytes)
			} else {
				rawRecord[column] = values[index]
			}
		}
		record := make(map[string]any, len(columns)-2)
		for column, value := range rawRecord {
			if omitSnapshotColumn(table, column, options) || isSnapshotReferenceColumn(table, column, rawRecord) {
				continue
			}
			record[column] = value
		}
		refs := snapshotRecordReferences(table, rawRecord, referenceIndex)
		if len(refs) > 0 {
			record["_refs"] = refs
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历同步集合 %s: %w", table, err)
	}
	return records, nil
}

func omitSnapshotColumn(table, column string, options SnapshotExportOptions) bool {
	switch column {
	case "id", "project_id", "deleted_at", "stored_name":
		return true
	case "email":
		return true
	case "phone":
		return table == "cmdb_persons" && !options.IncludeContacts
	}
	return strings.Contains(strings.ToLower(column), "password") || strings.Contains(strings.ToLower(column), "secret")
}

func readSnapshotTombstones(q snapshotQueryer, projectID int64, options SnapshotExportOptions) ([]Tombstone, error) {
	rows, err := q.Query(`SELECT entity_type,sync_id,revision,deleted_at FROM cmdb_tombstones
		WHERE project_id=? ORDER BY entity_type,sync_id`, projectID)
	if err != nil {
		return nil, fmt.Errorf("读取同步墓碑: %w", err)
	}
	defer rows.Close()
	result := make([]Tombstone, 0)
	for rows.Next() {
		var item Tombstone
		if err := rows.Scan(&item.EntityType, &item.SyncID, &item.Revision, &item.DeletedAt); err != nil {
			return nil, fmt.Errorf("扫描同步墓碑: %w", err)
		}
		if snapshotExcludedTables[item.EntityType] || (!options.IncludeHistory && (item.EntityType == "asset_logs" || item.EntityType == "cmdb_asset_history")) {
			continue
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func snapshotContentHash(snapshot *CmdbSnapshot) (string, error) {
	collectionNames := make([]string, 0, len(snapshot.Collections))
	for name := range snapshot.Collections {
		collectionNames = append(collectionNames, name)
	}
	sort.Strings(collectionNames)
	canonicalCollections := make([]struct {
		Name string          `json:"name"`
		Data json.RawMessage `json:"data"`
	}, 0, len(collectionNames))
	for _, name := range collectionNames {
		var decoded any
		decoder := json.NewDecoder(bytes.NewReader(snapshot.Collections[name]))
		decoder.UseNumber()
		if err := decoder.Decode(&decoded); err != nil {
			return "", fmt.Errorf("规范化同步集合 %s: %w", name, err)
		}
		canonicalData, err := json.Marshal(decoded)
		if err != nil {
			return "", fmt.Errorf("编码规范化同步集合 %s: %w", name, err)
		}
		canonicalCollections = append(canonicalCollections, struct {
			Name string          `json:"name"`
			Data json.RawMessage `json:"data"`
		}{Name: name, Data: canonicalData})
	}
	encoded, err := json.Marshal(struct {
		SchemaVersion int         `json:"schema_version"`
		ProjectSyncID string      `json:"project_sync_id"`
		Collections   any         `json:"collections"`
		Tombstones    []Tombstone `json:"tombstones"`
	}{snapshot.SchemaVersion, snapshot.ProjectSyncID, canonicalCollections, snapshot.Tombstones})
	if err != nil {
		return "", fmt.Errorf("计算同步摘要: %w", err)
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

func (s *Store) PreflightCmdbSnapshot(scope ProjectScope, snapshot *CmdbSnapshot) (*CmdbMergePreview, error) {
	project, err := s.ResolveProject(scope)
	if err != nil {
		return nil, err
	}
	if err := validateIncomingSnapshot(project, snapshot); err != nil {
		return nil, err
	}
	return preflightCmdbSnapshot(s.db, scope.ProjectID, snapshot)
}

func (s *Store) ApplyCmdbSnapshot(scope ProjectScope, snapshot *CmdbSnapshot) (*CmdbMergeResult, error) {
	preview, err := s.PreflightCmdbSnapshot(scope, snapshot)
	if err != nil {
		return nil, err
	}
	if preview.Conflicts > 0 || preview.UnresolvedReferences > 0 {
		return nil, fmt.Errorf("同步预检未通过: %d 个冲突，%d 个未解析引用", preview.Conflicts, preview.UnresolvedReferences)
	}
	backupPath, err := BackupDatabase(s.db, s.path)
	if err != nil {
		return nil, fmt.Errorf("创建同步前安全备份: %w", err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("开始同步事务: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT OR REPLACE INTO _meta(k,v) VALUES('cmdb_sync_apply','1')`); err != nil {
		return nil, fmt.Errorf("标记同步事务: %w", err)
	}
	localTombstones, err := snapshotTombstoneMap(tx, scope.ProjectID, SnapshotExportOptions{IncludeContacts: true, IncludeHistory: true})
	if err != nil {
		return nil, err
	}
	for _, table := range snapshotApplyOrder {
		raw, exists := snapshot.Collections[table]
		if !exists || snapshotExcludedTables[table] {
			continue
		}
		records, err := decodeSnapshotCollection(table, raw)
		if err != nil {
			return nil, err
		}
		columns, err := snapshotTableColumns(tx, table)
		if err != nil {
			return nil, err
		}
		for _, record := range records {
			syncID := snapshotString(record["sync_id"])
			remoteRevision := snapshotInt64(record["revision"])
			if tombstone, exists := localTombstones[table+"\x00"+syncID]; exists && tombstone.Revision >= remoteRevision {
				continue
			}
			writeRecord, err := withAvailableSnapshotReferences(tx, scope.ProjectID, table, record)
			if err != nil {
				return nil, err
			}
			var localRevision int64
			err = tx.QueryRow("SELECT revision FROM "+table+" WHERE project_id=? AND sync_id=? AND deleted_at IS NULL", scope.ProjectID, syncID).Scan(&localRevision)
			switch {
			case errors.Is(err, sql.ErrNoRows):
				if err := insertSnapshotRecord(tx, table, columns, scope.ProjectID, writeRecord); err != nil {
					return nil, err
				}
			case err != nil:
				return nil, fmt.Errorf("读取本地同步记录 %s/%s: %w", table, syncID, err)
			case remoteRevision > localRevision:
				if err := updateSnapshotRecord(tx, table, columns, scope.ProjectID, syncID, writeRecord); err != nil {
					return nil, err
				}
			}
		}
	}
	for _, table := range snapshotApplyOrder {
		raw, exists := snapshot.Collections[table]
		if !exists || snapshotExcludedTables[table] {
			continue
		}
		records, err := decodeSnapshotCollection(table, raw)
		if err != nil {
			return nil, err
		}
		for _, record := range records {
			resolved, err := resolveSnapshotReferences(tx, scope.ProjectID, table, record)
			if err != nil {
				return nil, err
			}
			if len(resolved) == 0 {
				continue
			}
			columns := make([]string, 0, len(resolved))
			for column := range resolved {
				columns = append(columns, column)
			}
			sort.Strings(columns)
			assignments := make([]string, 0, len(columns))
			values := make([]any, 0, len(columns)+2)
			for _, column := range columns {
				assignments = append(assignments, column+"=?")
				values = append(values, resolved[column])
			}
			values = append(values, scope.ProjectID, snapshotString(record["sync_id"]))
			if _, err := tx.Exec("UPDATE "+table+" SET "+strings.Join(assignments, ",")+" WHERE project_id=? AND sync_id=?", values...); err != nil {
				return nil, fmt.Errorf("还原同步引用 %s/%s: %w", table, snapshotString(record["sync_id"]), err)
			}
		}
	}
	for _, tombstone := range snapshot.Tombstones {
		if !isSnapshotTable(tombstone.EntityType) || snapshotExcludedTables[tombstone.EntityType] {
			continue
		}
		if _, err := tx.Exec("DELETE FROM "+tombstone.EntityType+" WHERE project_id=? AND sync_id=? AND revision<=?", scope.ProjectID, tombstone.SyncID, tombstone.Revision); err != nil {
			return nil, fmt.Errorf("应用同步删除 %s/%s: %w", tombstone.EntityType, tombstone.SyncID, err)
		}
		if _, err := tx.Exec(`INSERT INTO cmdb_tombstones(project_id,entity_type,sync_id,revision,deleted_at)
			VALUES(?,?,?,?,?) ON CONFLICT(project_id,entity_type,sync_id) DO UPDATE SET
			revision=MAX(revision,excluded.revision),
			deleted_at=CASE WHEN excluded.revision>=revision THEN excluded.deleted_at ELSE deleted_at END`,
			scope.ProjectID, tombstone.EntityType, tombstone.SyncID, tombstone.Revision, tombstone.DeletedAt); err != nil {
			return nil, fmt.Errorf("保存同步墓碑 %s/%s: %w", tombstone.EntityType, tombstone.SyncID, err)
		}
	}
	if _, err := tx.Exec(`DELETE FROM _meta WHERE k='cmdb_sync_apply'`); err != nil {
		return nil, fmt.Errorf("清理同步事务标记: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("提交同步事务: %w", err)
	}
	options := snapshotOptions(snapshot)
	current, err := s.ExportCmdbSnapshot(scope, options)
	if err != nil {
		return nil, err
	}
	result := CmdbMergeResult(*preview)
	result.BaseHash = current.BaseHash
	result.BackupPath = backupPath
	return &result, nil
}

func validateIncomingSnapshot(project *CmdbProject, snapshot *CmdbSnapshot) error {
	if snapshot == nil {
		return errors.New("同步快照不能为空")
	}
	if snapshot.SchemaVersion != CmdbSnapshotSchemaVersion {
		return fmt.Errorf("不支持的同步快照版本: %d", snapshot.SchemaVersion)
	}
	if snapshot.ProjectSyncID != project.SyncID {
		return errors.New("同步快照不属于当前项目")
	}
	want, err := snapshotContentHash(snapshot)
	if err != nil {
		return err
	}
	if snapshot.BaseHash == "" || snapshot.BaseHash != want {
		return errors.New("同步快照摘要校验失败")
	}
	for table := range snapshot.Collections {
		if !isSnapshotTable(table) || snapshotExcludedTables[table] {
			return fmt.Errorf("同步快照包含不允许的集合: %s", table)
		}
	}
	return nil
}

func preflightCmdbSnapshot(q snapshotTransaction, projectID int64, snapshot *CmdbSnapshot) (*CmdbMergePreview, error) {
	options := snapshotOptions(snapshot)
	preview := &CmdbMergePreview{BaseHash: snapshot.BaseHash, ConflictDetails: make([]CmdbSyncConflict, 0)}
	localTombstones, err := snapshotTombstoneMap(q, projectID, options)
	if err != nil {
		return nil, err
	}
	localByTable := make(map[string]map[string]map[string]any)
	remoteByTable := make(map[string]map[string]map[string]any)
	referenceIndex, err := buildSnapshotReferenceIndex(q, projectID)
	if err != nil {
		return nil, err
	}
	for _, table := range projectScopedTables {
		raw, exists := snapshot.Collections[table]
		if !exists || snapshotExcludedTables[table] {
			continue
		}
		remoteRecords, err := decodeSnapshotCollection(table, raw)
		if err != nil {
			return nil, err
		}
		localRecords, err := readSnapshotTable(q, table, projectID, options, referenceIndex)
		if err != nil {
			return nil, err
		}
		localByTable[table] = snapshotRecordsBySyncID(localRecords)
		remoteByTable[table] = snapshotRecordsBySyncID(remoteRecords)
		for _, remote := range remoteRecords {
			syncID := snapshotString(remote["sync_id"])
			if syncID == "" || snapshotInt64(remote["revision"]) < 1 {
				return nil, fmt.Errorf("同步集合 %s 包含无效的稳定标识或修订号", table)
			}
			remoteRevision := snapshotInt64(remote["revision"])
			local, exists := localByTable[table][syncID]
			if !exists {
				if tombstone, deleted := localTombstones[table+"\x00"+syncID]; deleted {
					if tombstone.Revision >= remoteRevision {
						preview.SuppressedByTombstone++
					} else {
						preview.addConflict(table, syncID, "远端记录晚于本地删除墓碑，禁止自动复活")
					}
					continue
				}
				preview.Added++
				continue
			}
			if snapshotRecordEqual(local, remote) {
				continue
			}
			localRevision := snapshotInt64(local["revision"])
			switch {
			case remoteRevision > localRevision:
				preview.Updated++
			case remoteRevision == localRevision:
				preview.addConflict(table, syncID, "同一修订号内容不一致")
			}
		}
	}
	for _, tombstone := range snapshot.Tombstones {
		if !isSnapshotTable(tombstone.EntityType) || snapshotExcludedTables[tombstone.EntityType] || tombstone.SyncID == "" || tombstone.Revision < 1 {
			return nil, fmt.Errorf("同步快照包含无效墓碑: %s/%s", tombstone.EntityType, tombstone.SyncID)
		}
		local := localByTable[tombstone.EntityType][tombstone.SyncID]
		if local == nil {
			continue
		}
		localRevision := snapshotInt64(local["revision"])
		if tombstone.Revision >= localRevision {
			preview.Deleted++
		} else {
			preview.addConflict(tombstone.EntityType, tombstone.SyncID, "本地记录在远端删除后已修改")
		}
	}
	preview.UnresolvedReferences = countUnresolvedSnapshotReferences(localByTable, remoteByTable)
	detectSnapshotUniquenessConflicts(preview, localByTable, remoteByTable)
	return preview, nil
}

func (preview *CmdbMergePreview) addConflict(table, syncID, reason string) {
	preview.Conflicts++
	preview.ConflictDetails = append(preview.ConflictDetails, CmdbSyncConflict{EntityType: table, SyncID: syncID, Reason: reason})
}

func snapshotOptions(snapshot *CmdbSnapshot) SnapshotExportOptions {
	options := SnapshotExportOptions{}
	if _, exists := snapshot.Collections["asset_logs"]; exists {
		options.IncludeHistory = true
	}
	if raw, exists := snapshot.Collections["cmdb_persons"]; exists {
		var records []map[string]any
		if json.Unmarshal(raw, &records) == nil {
			for _, record := range records {
				if _, exists := record["phone"]; exists {
					options.IncludeContacts = true
					break
				}
			}
		}
	}
	return options
}

func decodeSnapshotCollection(table string, raw json.RawMessage) ([]map[string]any, error) {
	var records []map[string]any
	if err := json.Unmarshal(raw, &records); err != nil {
		return nil, fmt.Errorf("解析同步集合 %s: %w", table, err)
	}
	if records == nil {
		records = make([]map[string]any, 0)
	}
	return records, nil
}

func snapshotRecordsBySyncID(records []map[string]any) map[string]map[string]any {
	result := make(map[string]map[string]any, len(records))
	for _, record := range records {
		if syncID := snapshotString(record["sync_id"]); syncID != "" {
			result[syncID] = record
		}
	}
	return result
}

func snapshotTombstoneMap(q snapshotQueryer, projectID int64, options SnapshotExportOptions) (map[string]Tombstone, error) {
	items, err := readSnapshotTombstones(q, projectID, options)
	if err != nil {
		return nil, err
	}
	result := make(map[string]Tombstone, len(items))
	for _, item := range items {
		result[item.EntityType+"\x00"+item.SyncID] = item
	}
	return result, nil
}

func snapshotString(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}

func snapshotInt64(value any) int64 {
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case float64:
		return int64(typed)
	case json.Number:
		result, _ := typed.Int64()
		return result
	default:
		var result int64
		_, _ = fmt.Sscan(fmt.Sprint(value), &result)
		return result
	}
}

func snapshotRecordEqual(left, right map[string]any) bool {
	clean := func(record map[string]any) map[string]any {
		result := make(map[string]any, len(record))
		for key, value := range record {
			if key == "revision" || key == "updated_at" {
				continue
			}
			result[key] = value
		}
		return result
	}
	leftJSON, _ := json.Marshal(clean(left))
	rightJSON, _ := json.Marshal(clean(right))
	return string(leftJSON) == string(rightJSON)
}

func isSnapshotTable(table string) bool {
	for _, allowed := range projectScopedTables {
		if table == allowed {
			return true
		}
	}
	return false
}

func snapshotTableColumns(q snapshotQueryer, table string) (map[string]bool, error) {
	rows, err := q.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return nil, fmt.Errorf("读取同步表 %s 结构: %w", table, err)
	}
	defer rows.Close()
	result := make(map[string]bool)
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return nil, err
		}
		result[name] = true
	}
	return result, rows.Err()
}

type snapshotReferenceIndex map[string]map[int64]string

var snapshotStaticReferences = map[string]map[string]string{
	"asset_logs":                  {"asset_id": "assets"},
	"assets":                      {"group_id": "cmdb_groups"},
	"server_apps":                 {"server_id": "servers", "cmdb_asset_id": "cmdb_assets", "group_id": "cmdb_groups"},
	"cmdb_orgs":                   {"parent_id": "cmdb_orgs"},
	"cmdb_groups":                 {"parent_id": "cmdb_groups"},
	"cmdb_device_categories":      {"parent_id": "cmdb_device_categories"},
	"cmdb_assets":                 {"category_id": "cmdb_device_categories", "model_id": "cmdb_device_models", "org_id": "cmdb_orgs", "group_id": "cmdb_groups", "owner_id": "cmdb_persons"},
	"cmdb_asset_interfaces":       {"asset_id": "cmdb_assets"},
	"cmdb_asset_links":            {"local_asset_id": "cmdb_assets", "local_interface_id": "cmdb_asset_interfaces", "peer_asset_id": "cmdb_assets"},
	"cmdb_asset_history":          {"asset_id": "cmdb_assets"},
	"cmdb_switch_snapshots":       {"asset_id": "cmdb_assets"},
	"cmdb_work_orders":            {"asset_id": "cmdb_assets"},
	"cmdb_work_order_asset_links": {"work_order_id": "cmdb_work_orders"},
	"cmdb_work_order_attachments": {"work_order_id": "cmdb_work_orders"},
	"cmdb_credentials":            {"asset_id": "cmdb_assets"},
	"cmdb_labels":                 {"asset_id": "cmdb_assets"},
	"cmdb_org_nodes":              {"parent_id": "cmdb_org_nodes"},
	"cmdb_asset_software":         {"asset_id": "cmdb_assets", "software_id": "cmdb_software_catalog"},
	"cmdb_persons":                {"org_id": "cmdb_org_nodes", "department_id": "cmdb_org_nodes", "group_id": "cmdb_org_nodes"},
}

func buildSnapshotReferenceIndex(q snapshotQueryer, projectID int64) (snapshotReferenceIndex, error) {
	index := make(snapshotReferenceIndex, len(projectScopedTables))
	for _, table := range projectScopedTables {
		rows, err := q.Query("SELECT id,sync_id FROM "+table+" WHERE project_id=? AND deleted_at IS NULL", projectID)
		if err != nil {
			return nil, fmt.Errorf("建立同步引用索引 %s: %w", table, err)
		}
		items := make(map[int64]string)
		for rows.Next() {
			var id int64
			var syncID sql.NullString
			if err := rows.Scan(&id, &syncID); err != nil {
				rows.Close()
				return nil, err
			}
			if syncID.String != "" {
				items[id] = syncID.String
			}
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
		index[table] = items
	}
	return index, nil
}

func snapshotReferenceTargets(table string, record map[string]any) map[string]string {
	result := make(map[string]string)
	for column, target := range snapshotStaticReferences[table] {
		result[column] = target
	}
	switch table {
	case "ip_pool":
		if target := snapshotAssetTypeTable(snapshotString(record["owner_type"])); target != "" {
			result["owner_id"] = target
		}
	case "cmdb_assets":
		switch snapshotString(record["source_type"]) {
		case "legacy_asset":
			result["source_id"] = "assets"
		case "legacy_server":
			result["source_id"] = "servers"
		}
	case "cmdb_netcatty_links", "cmdb_work_order_asset_links":
		if target := snapshotAssetTypeTable(snapshotString(record["asset_type"])); target != "" {
			result["asset_id"] = target
		}
	}
	return result
}

func snapshotAssetTypeTable(assetType string) string {
	switch strings.ToLower(strings.TrimSpace(assetType)) {
	case "terminal", "asset", "assets":
		return "assets"
	case "infrastructure", "cmdb_asset", "cmdb_assets":
		return "cmdb_assets"
	case "application", "app", "server_app", "server_apps":
		return "server_apps"
	case "server", "servers":
		return "servers"
	default:
		return ""
	}
}

func isSnapshotReferenceColumn(table, column string, record map[string]any) bool {
	if _, exists := snapshotReferenceTargets(table, record)[column]; exists {
		return true
	}
	return (table == "cmdb_assets" && column == "source_id") ||
		(table == "ip_pool" && column == "owner_id") ||
		((table == "cmdb_netcatty_links" || table == "cmdb_work_order_asset_links") && column == "asset_id")
}

func snapshotRecordReferences(table string, record map[string]any, index snapshotReferenceIndex) map[string]string {
	refs := make(map[string]string)
	for column, target := range snapshotReferenceTargets(table, record) {
		localID := snapshotInt64(record[column])
		if localID <= 0 {
			continue
		}
		if syncID := index[target][localID]; syncID != "" {
			refs[column] = syncID
		}
	}
	if table == "cmdb_netcatty_links" && refs["asset_id"] == "" {
		if syncID := strings.TrimSpace(snapshotString(record["asset_sync_id"])); syncID != "" {
			refs["asset_id"] = syncID
		}
	}
	return refs
}

func snapshotRefs(record map[string]any) map[string]string {
	raw, exists := record["_refs"]
	if !exists {
		return nil
	}
	result := make(map[string]string)
	switch refs := raw.(type) {
	case map[string]string:
		for column, syncID := range refs {
			result[column] = syncID
		}
	case map[string]any:
		for column, syncID := range refs {
			result[column] = snapshotString(syncID)
		}
	}
	return result
}

func countUnresolvedSnapshotReferences(local, remote map[string]map[string]map[string]any) int {
	count := 0
	for table, records := range remote {
		for _, record := range records {
			for column, targetSyncID := range snapshotRefs(record) {
				targetTable := snapshotReferenceTargets(table, record)[column]
				if targetTable == "" || targetSyncID == "" || (local[targetTable][targetSyncID] == nil && remote[targetTable][targetSyncID] == nil) {
					count++
				}
			}
		}
	}
	return count
}

func resolveSnapshotReferences(tx snapshotTransaction, projectID int64, table string, record map[string]any) (map[string]any, error) {
	resolved := make(map[string]any)
	for column, targetSyncID := range snapshotRefs(record) {
		targetTable := snapshotReferenceTargets(table, record)[column]
		if targetTable == "" || targetSyncID == "" {
			return nil, fmt.Errorf("无法解析同步引用 %s.%s", table, column)
		}
		var id int64
		if err := tx.QueryRow("SELECT id FROM "+targetTable+" WHERE project_id=? AND sync_id=? AND deleted_at IS NULL", projectID, targetSyncID).Scan(&id); err != nil {
			return nil, fmt.Errorf("解析同步引用 %s.%s -> %s/%s: %w", table, column, targetTable, targetSyncID, err)
		}
		resolved[column] = id
	}
	return resolved, nil
}

func withAvailableSnapshotReferences(tx snapshotTransaction, projectID int64, table string, record map[string]any) (map[string]any, error) {
	result := make(map[string]any, len(record)+len(snapshotRefs(record)))
	for key, value := range record {
		result[key] = value
	}
	for column, targetSyncID := range snapshotRefs(record) {
		targetTable := snapshotReferenceTargets(table, record)[column]
		if targetTable == "" || targetSyncID == "" {
			return nil, fmt.Errorf("无法解析同步引用 %s.%s", table, column)
		}
		var id int64
		err := tx.QueryRow("SELECT id FROM "+targetTable+" WHERE project_id=? AND sync_id=? AND deleted_at IS NULL", projectID, targetSyncID).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		result[column] = id
	}
	return result, nil
}

func insertSnapshotRecord(tx snapshotTransaction, table string, allowed map[string]bool, projectID int64, record map[string]any) error {
	columns := []string{"project_id"}
	values := []any{projectID}
	for _, column := range sortedSnapshotColumns(record, allowed) {
		columns = append(columns, column)
		values = append(values, record[column])
	}
	placeholders := make([]string, len(columns))
	for index := range placeholders {
		placeholders[index] = "?"
	}
	if _, err := tx.Exec("INSERT INTO "+table+"("+strings.Join(columns, ",")+") VALUES("+strings.Join(placeholders, ",")+")", values...); err != nil {
		return fmt.Errorf("新增同步记录 %s/%s: %w", table, snapshotString(record["sync_id"]), err)
	}
	return nil
}

func updateSnapshotRecord(tx snapshotTransaction, table string, allowed map[string]bool, projectID int64, syncID string, record map[string]any) error {
	columns := sortedSnapshotColumns(record, allowed)
	assignments := make([]string, 0, len(columns))
	values := make([]any, 0, len(columns)+2)
	for _, column := range columns {
		if column == "sync_id" {
			continue
		}
		assignments = append(assignments, column+"=?")
		values = append(values, record[column])
	}
	values = append(values, projectID, syncID)
	if _, err := tx.Exec("UPDATE "+table+" SET "+strings.Join(assignments, ",")+" WHERE project_id=? AND sync_id=?", values...); err != nil {
		return fmt.Errorf("更新同步记录 %s/%s: %w", table, syncID, err)
	}
	return nil
}

func sortedSnapshotColumns(record map[string]any, allowed map[string]bool) []string {
	columns := make([]string, 0, len(record))
	for column := range record {
		if allowed[column] && column != "id" && column != "project_id" && column != "deleted_at" {
			columns = append(columns, column)
		}
	}
	sort.Strings(columns)
	return columns
}

func detectSnapshotUniquenessConflicts(preview *CmdbMergePreview, local, remote map[string]map[string]map[string]any) {
	type owner struct{ table, syncID string }
	seenIPs := make(map[string]owner)
	seenCodes := make(map[string]owner)
	seenPrimaryHosts := make(map[string]owner)
	reported := make(map[string]bool)
	lookup := func(table, syncID string) map[string]any {
		if record := remote[table][syncID]; record != nil {
			return record
		}
		return local[table][syncID]
	}
	var canonicalOwner func(table, syncID string, depth int) owner
	canonicalOwner = func(table, syncID string, depth int) owner {
		current := owner{table, syncID}
		if depth > 3 {
			return current
		}
		record := lookup(table, syncID)
		if record == nil {
			return current
		}
		refs := snapshotRefs(record)
		switch table {
		case "cmdb_assets":
			target := snapshotReferenceTargets(table, record)["source_id"]
			if targetSyncID := refs["source_id"]; target != "" && targetSyncID != "" {
				return canonicalOwner(target, targetSyncID, depth+1)
			}
		case "cmdb_asset_interfaces":
			if targetSyncID := refs["asset_id"]; targetSyncID != "" {
				return canonicalOwner("cmdb_assets", targetSyncID, depth+1)
			}
		}
		return current
	}
	recordConflict := func(kind, value string, current, previous owner) {
		if value == "" || current == previous {
			return
		}
		left, right := current, previous
		if left.table+"\x00"+left.syncID > right.table+"\x00"+right.syncID {
			left, right = right, left
		}
		key := kind + "\x00" + value + "\x00" + left.table + "\x00" + left.syncID + "\x00" + right.table + "\x00" + right.syncID
		if reported[key] {
			return
		}
		reported[key] = true
		preview.addConflict(current.table, current.syncID, fmt.Sprintf("%s %s 已被 %s/%s 使用", kind, value, previous.table, previous.syncID))
	}
	visit := func(table string, records map[string]map[string]any) {
		for syncID, record := range records {
			current := canonicalOwner(table, syncID, 0)
			for _, field := range snapshotIPFields(table) {
				value := strings.TrimSpace(snapshotString(record[field]))
				if value == "" {
					continue
				}
				if previous, exists := seenIPs[value]; exists {
					recordConflict("IP", value, current, previous)
				} else {
					seenIPs[value] = current
				}
			}
			if table == "assets" || table == "servers" || table == "cmdb_assets" {
				code := strings.TrimSpace(snapshotString(record["asset_code"]))
				if previous, exists := seenCodes[code]; code != "" && exists {
					recordConflict("资产编码", code, current, previous)
				} else if code != "" {
					seenCodes[code] = current
				}
			}
			if table == "cmdb_netcatty_links" && snapshotInt64(record["is_primary"]) == 1 {
				hostID := strings.TrimSpace(snapshotString(record["host_id"]))
				if previous, exists := seenPrimaryHosts[hostID]; hostID != "" && exists {
					recordConflict("Netcatty 主连接", hostID, current, previous)
				} else if hostID != "" {
					seenPrimaryHosts[hostID] = current
				}
			}
		}
	}
	for _, table := range projectScopedTables {
		visit(table, local[table])
		visit(table, remote[table])
	}
}

func snapshotIPFields(table string) []string {
	switch table {
	case "assets":
		return []string{"ip", "terminal_ip"}
	case "servers":
		return []string{"mgmt_ip", "biz_ip"}
	case "cmdb_assets":
		return []string{"mgmt_ip", "manage_ip", "biz_ip", "public_ip"}
	case "cmdb_asset_interfaces":
		return []string{"ip"}
	default:
		return nil
	}
}
