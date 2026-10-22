package store

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

var ErrRackMigrationConflict = errors.New("机柜位置迁移冲突")

type RackMigrationItem struct {
	ID     int64              `json:"id"`
	Name   string             `json:"name"`
	Before RackLocationFields `json:"before"`
	After  RackLocationFields `json:"after"`
}

type RackMigrationConflict struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Reason string `json:"reason"`
	Entity string `json:"entity"`
}

type RackMigrationLocation struct {
	ID     int64          `json:"id"`
	Name   string         `json:"name"`
	Before map[string]any `json:"before"`
	After  map[string]any `json:"after"`
}

type RackMigrationPreview struct {
	List              []RackMigrationItem     `json:"list"`
	Total             int                     `json:"total"`
	Conflicts         []RackMigrationConflict `json:"conflicts"`
	Locations         []RackMigrationLocation `json:"locations"`
	RollbackAvailable bool                    `json:"rollback_available"`
	Token             string                  `json:"token"`
}

type RackMigrationResult struct {
	Updated    int    `json:"updated"`
	BackupPath string `json:"backup_path"`
}

type rackMigrationRecord struct {
	Table  string         `json:"table"`
	Before map[string]any `json:"before"`
	After  map[string]any `json:"after"`
}

type rackMigrationJournal struct {
	Records    []rackMigrationRecord `json:"records"`
	BackupPath string                `json:"backup_path"`
	RolledBack bool                  `json:"rolled_back"`
}

func rackMigrationKey(projectID int64) string {
	return fmt.Sprintf("rack_location_migration/%d", projectID)
}

// Keep exact database columns (including revision and sync metadata) so a
// rollback never clobbers newer edits, even when only another field changed.
func readRackMigrationRecords(q snapshotQueryer, table string, projectID int64) ([]map[string]any, error) {
	rows, err := q.Query("SELECT * FROM "+table+" WHERE project_id=? AND deleted_at IS NULL ORDER BY id", projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	records := []map[string]any{}
	values := make([]any, len(columns))
	targets := make([]any, len(columns))
	for i := range values {
		targets[i] = &values[i]
	}
	for rows.Next() {
		if err := rows.Scan(targets...); err != nil {
			return nil, err
		}
		record := make(map[string]any, len(columns))
		for i, column := range columns {
			if bytes, ok := values[i].([]byte); ok {
				record[column] = string(bytes)
			} else {
				record[column] = values[i]
			}
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func rackFields(record map[string]any) RackLocationFields {
	return RackLocationFields{snapshotString(record["data_center"]), snapshotString(record["cabinet_name"]), snapshotString(record["cabinet_pos"])}
}

func rackRecordEqual(a, b map[string]any) bool {
	left, _ := json.Marshal(a)
	right, _ := json.Marshal(b)
	return string(left) == string(right)
}

func readRackMigrationJournal(q snapshotQueryer, projectID int64) (*rackMigrationJournal, error) {
	var raw string
	err := q.QueryRow("SELECT v FROM _meta WHERE k=?", rackMigrationKey(projectID)).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var journal rackMigrationJournal
	if err := json.Unmarshal([]byte(raw), &journal); err != nil {
		return nil, fmt.Errorf("读取机柜迁移回滚记录: %w", err)
	}
	for _, record := range journal.Records {
		if record.Table != "cmdb_locations" {
			continue
		}
		for _, fields := range []map[string]any{record.Before, record.After} {
			for _, column := range []string{"location_type", "data_center", "cabinet_name"} {
				if _, present := fields[column]; !present {
					fields[column] = ""
				}
			}
		}
	}
	return &journal, nil
}

func rackMigrationPreview(q snapshotQueryer, projectID int64) (*RackMigrationPreview, []map[string]any, []map[string]any, error) {
	assets, err := readRackMigrationRecords(q, "cmdb_assets", projectID)
	if err != nil {
		return nil, nil, nil, err
	}
	locations, err := readRackMigrationRecords(q, "cmdb_locations", projectID)
	if err != nil {
		return nil, nil, nil, err
	}
	journal, err := readRackMigrationJournal(q, projectID)
	if err != nil {
		return nil, nil, nil, err
	}
	preview := &RackMigrationPreview{List: []RackMigrationItem{}, Conflicts: []RackMigrationConflict{}, Locations: []RackMigrationLocation{}, RollbackAvailable: journal != nil && !journal.RolledBack}
	conflict := func(entity string, record map[string]any, reason string) {
		preview.Conflicts = append(preview.Conflicts, RackMigrationConflict{snapshotInt64(record["id"]), snapshotString(record["name"]), reason, entity})
	}
	cabinetRooms := map[string]map[string]bool{}
	canonicalNames := map[string]bool{}
	for _, record := range assets {
		before := rackFields(record)
		after, err := canonicalRackLocation(before)
		if err != nil {
			conflict("asset", record, err.Error())
			continue
		}
		if after.CabinetName != "" {
			if cabinetRooms[after.CabinetName] == nil {
				cabinetRooms[after.CabinetName] = map[string]bool{}
			}
			cabinetRooms[after.CabinetName][qualifiedRackLocation(after.DataCenter, after.CabinetName)] = true
			canonicalNames[qualifiedRackLocation(after.DataCenter, after.CabinetName)] = true
		}
		if before != after {
			preview.List = append(preview.List, RackMigrationItem{snapshotInt64(record["id"]), snapshotString(record["name"]), before, after})
		}
	}
	// Resolve old height-only cabinet entries only when the asset hierarchy
	// identifies one room. Explicit qualified registry names keep their height.
	existingNames := map[string]int64{}
	for _, record := range locations {
		existingNames[snapshotString(record["name"])] = snapshotInt64(record["id"])
	}
	targetNames := map[string]int64{}
	for _, record := range locations {
		if snapshotString(record["location_type"]) != "" {
			continue // Explicit registry identities are not legacy prose.
		}
		name := snapshotString(record["name"])
		if canonicalNames[name] {
			continue // Literal qualified identities may contain parentheses.
		}
		room, cabinet, combined, err := parseRackLocation(name)
		if err != nil {
			if snapshotInt64(record["rack_units"]) > 0 {
				conflict("location", record, err.Error())
			}
			continue
		}
		if cabinet == "" {
			if snapshotInt64(record["rack_units"]) > 0 {
				conflict("location", record, "仅机房的位置不能登记为机柜高度，请明确机柜")
			}
			continue
		}
		if !combined && snapshotInt64(record["rack_units"]) == 0 {
			continue // General location configuration is not a rack registry.
		}
		target := qualifiedRackLocation(room, cabinet)
		if !combined {
			matches := cabinetRooms[cabinet]
			if len(matches) > 1 {
				conflict("location", record, "同名机柜存在于多个机房，不能猜测高度归属")
				continue
			}
			for match := range matches {
				target = match
			}
		}
		if other, exists := existingNames[target]; exists && other != snapshotInt64(record["id"]) {
			conflict("location", record, fmt.Sprintf("规范位置「%s」已由目录项 %d 使用，不能覆盖高度", target, other))
		}
		if other, exists := targetNames[target]; exists {
			conflict("location", record, fmt.Sprintf("规范位置「%s」与目录项 %d 重复，需确认高度归属", target, other))
		}
		targetNames[target] = snapshotInt64(record["id"])
		if target != name {
			preview.Locations = append(preview.Locations, RackMigrationLocation{snapshotInt64(record["id"]), name, map[string]any{"name": name, "rack_units": record["rack_units"]}, map[string]any{"name": target, "rack_units": record["rack_units"]}})
		}
	}
	preview.Total = len(preview.List) + len(preview.Locations)
	encoded, err := json.Marshal(struct {
		ProjectID int64
		Assets    []map[string]any
		Locations []map[string]any
		Preview   *RackMigrationPreview
	}{projectID, assets, locations, preview})
	if err != nil {
		return nil, nil, nil, err
	}
	digest := sha256.Sum256(encoded)
	preview.Token = hex.EncodeToString(digest[:])
	return preview, assets, locations, nil
}

func (s *Store) PreviewRackMigration(scope ProjectScope) (*RackMigrationPreview, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	preview, _, _, err := rackMigrationPreview(tx, scope.ProjectID)
	return preview, err
}

func recordsByRackID(records []map[string]any) map[int64]map[string]any {
	out := make(map[int64]map[string]any, len(records))
	for _, record := range records {
		out[snapshotInt64(record["id"])] = record
	}
	return out
}

func (s *Store) ApplyRackMigration(scope ProjectScope, token string) (*RackMigrationResult, error) {
	preview, err := s.PreviewRackMigration(scope)
	if err != nil {
		return nil, err
	}
	if token == "" || token != preview.Token {
		return nil, fmt.Errorf("%w: 预览已过期，请重新预览", ErrRackMigrationConflict)
	}
	if len(preview.Conflicts) > 0 {
		return nil, fmt.Errorf("%w: 请先处理 %d 项不明确位置", ErrRackMigrationConflict, len(preview.Conflicts))
	}
	if preview.Total == 0 {
		return &RackMigrationResult{}, nil
	}
	backupPath, err := BackupDatabase(s.db, s.path)
	if err != nil {
		return nil, fmt.Errorf("创建机柜迁移前安全备份: %w", err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	preview, assets, locations, err := rackMigrationPreview(tx, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	if preview.Token != token || len(preview.Conflicts) > 0 {
		return nil, fmt.Errorf("%w: 数据在备份期间发生变化，请重新预览", ErrRackMigrationConflict)
	}
	previous, err := readRackMigrationJournal(tx, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	if previous != nil && !previous.RolledBack {
		return nil, fmt.Errorf("%w: 本项目已执行一次迁移，不能覆盖现有回滚记录", ErrRackMigrationConflict)
	}
	assetByID, locationByID := recordsByRackID(assets), recordsByRackID(locations)
	journal := &rackMigrationJournal{BackupPath: backupPath, Records: []rackMigrationRecord{}}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, item := range preview.List {
		before := assetByID[item.ID]
		if _, err := tx.Exec(`UPDATE cmdb_assets SET data_center=?,cabinet_name=?,cabinet_pos='',revision=revision+1,updated_at=? WHERE id=? AND project_id=? AND deleted_at IS NULL`, item.After.DataCenter, item.After.CabinetName, now, item.ID, scope.ProjectID); err != nil {
			return nil, err
		}
		journal.Records = append(journal.Records, rackMigrationRecord{Table: "cmdb_assets", Before: before})
		if err := appendCmdbAssetHistory(tx, scope.ProjectID, item.ID, "机柜位置迁移", fmt.Sprintf("拆分机房与机柜：%s → %s / %s", item.Before.CabinetName, item.After.DataCenter, item.After.CabinetName), "系统"); err != nil {
			return nil, err
		}
	}
	for _, item := range preview.Locations {
		if _, err := tx.Exec(`UPDATE cmdb_locations SET name=?,revision=revision+1,updated_at=? WHERE id=? AND project_id=? AND deleted_at IS NULL`, item.After["name"], now, item.ID, scope.ProjectID); err != nil {
			return nil, err
		}
		journal.Records = append(journal.Records, rackMigrationRecord{Table: "cmdb_locations", Before: locationByID[item.ID]})
	}
	if err := captureRackMigrationAfter(tx, scope.ProjectID, journal); err != nil {
		return nil, err
	}
	if err := saveRackMigrationJournal(tx, scope.ProjectID, journal); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &RackMigrationResult{Updated: preview.Total, BackupPath: backupPath}, nil
}

func captureRackMigrationAfter(q snapshotQueryer, projectID int64, journal *rackMigrationJournal) error {
	byTable := map[string]map[int64]map[string]any{}
	for _, table := range []string{"cmdb_assets", "cmdb_locations"} {
		records, err := readRackMigrationRecords(q, table, projectID)
		if err != nil {
			return err
		}
		byTable[table] = recordsByRackID(records)
	}
	for i := range journal.Records {
		record := &journal.Records[i]
		record.After = byTable[record.Table][snapshotInt64(record.Before["id"])]
	}
	return nil
}

func saveRackMigrationJournal(tx *sql.Tx, projectID int64, journal *rackMigrationJournal) error {
	encoded, err := json.Marshal(journal)
	if err != nil {
		return err
	}
	_, err = tx.Exec("INSERT OR REPLACE INTO _meta(k,v) VALUES(?,?)", rackMigrationKey(projectID), string(encoded))
	return err
}

func (s *Store) RollbackRackMigration(scope ProjectScope) (int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	journal, err := readRackMigrationJournal(tx, scope.ProjectID)
	if err != nil {
		return 0, err
	}
	if journal == nil || journal.RolledBack {
		return 0, fmt.Errorf("%w: 当前项目没有可回滚的机柜迁移", ErrRackMigrationConflict)
	}
	byTable := map[string]map[int64]map[string]any{}
	for _, table := range []string{"cmdb_assets", "cmdb_locations"} {
		records, err := readRackMigrationRecords(tx, table, scope.ProjectID)
		if err != nil {
			return 0, err
		}
		byTable[table] = recordsByRackID(records)
	}
	for _, record := range journal.Records {
		id := snapshotInt64(record.Before["id"])
		if !rackRecordEqual(byTable[record.Table][id], record.After) {
			return 0, fmt.Errorf("%w: %s/%d 已被修改或删除，拒绝覆盖新数据", ErrRackMigrationConflict, record.Table, id)
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	updated := 0
	for _, record := range journal.Records {
		id := snapshotInt64(record.Before["id"])
		switch record.Table {
		case "cmdb_assets":
			before := rackFields(record.Before)
			if _, err := tx.Exec(`UPDATE cmdb_assets SET data_center=?,cabinet_name=?,cabinet_pos=?,revision=revision+1,updated_at=? WHERE id=? AND project_id=?`, record.Before["data_center"], record.Before["cabinet_name"], record.Before["cabinet_pos"], now, id, scope.ProjectID); err != nil {
				return 0, err
			}
			if err := appendCmdbAssetHistory(tx, scope.ProjectID, id, "机柜迁移回滚", "恢复迁移前位置："+before.CabinetName, "系统"); err != nil {
				return 0, err
			}
			updated++
		case "cmdb_locations":
			if _, err := tx.Exec(`UPDATE cmdb_locations SET name=?,revision=revision+1,updated_at=? WHERE id=? AND project_id=?`, record.Before["name"], now, id, scope.ProjectID); err != nil {
				return 0, err
			}
			updated++
		default:
			return 0, fmt.Errorf("未知机柜回滚集合: %s", record.Table)
		}
	}
	journal.RolledBack = true
	if err := saveRackMigrationJournal(tx, scope.ProjectID, journal); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return updated, nil
}
