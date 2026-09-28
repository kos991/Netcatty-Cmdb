package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const switchHiddenValue = "已配置（隐藏）"

type CmdbSwitchSnapshot struct {
	ID           int64  `json:"id"`
	ProjectID    int64  `json:"project_id"`
	SyncID       string `json:"sync_id"`
	AssetID      int64  `json:"asset_id"`
	Vendor       string `json:"vendor"`
	Protocol     string `json:"protocol"`
	HostID       string `json:"host_id"`
	ReadAt       string `json:"read_at"`
	SnapshotJSON string `json:"-"`
	Snapshot     any    `json:"snapshot"`
	Revision     int64  `json:"revision"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

func switchSecretKey(key string) bool {
	key = strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "_", ""), "-", ""))
	for _, part := range []string{"password", "secret", "community", "authkey", "authentication", "privkey", "privacy", "hash", "cipher", "encrypt", "privatekey"} {
		if strings.Contains(key, part) {
			return true
		}
	}
	return false
}

func validateSwitchSnapshotValue(value any, key string) error {
	if switchSecretKey(key) && fmt.Sprint(value) != switchHiddenValue {
		return fmt.Errorf("交换机快照包含敏感字段 %s", key)
	}
	switch typed := value.(type) {
	case map[string]any:
		for childKey, child := range typed {
			if err := validateSwitchSnapshotValue(child, childKey); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range typed {
			if err := validateSwitchSnapshotValue(child, key); err != nil {
				return err
			}
		}
	}
	return nil
}

func decodeSwitchSnapshot(raw string) (any, error) {
	var value any
	if strings.TrimSpace(raw) == "" {
		return nil, fmt.Errorf("交换机快照不能为空")
	}
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil, fmt.Errorf("交换机快照格式无效: %w", err)
	}
	if _, ok := value.(map[string]any); !ok {
		return nil, fmt.Errorf("交换机快照必须是 JSON 对象")
	}
	if err := validateSwitchSnapshotValue(value, ""); err != nil {
		return nil, err
	}
	return value, nil
}

func (s *Store) SaveCmdbSwitchSnapshotForProject(scope ProjectScope, item *CmdbSwitchSnapshot) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	if item == nil || item.AssetID <= 0 {
		return fmt.Errorf("交换机快照缺少资产")
	}
	var deviceType, categoryName string
	err := s.db.QueryRow(`SELECT IFNULL(a.device_type,''),IFNULL(c.name,'') FROM cmdb_assets a LEFT JOIN cmdb_device_categories c ON c.id=a.category_id AND c.project_id=a.project_id WHERE a.id=? AND a.project_id=? AND a.deleted_at IS NULL`, item.AssetID, scope.ProjectID).Scan(&deviceType, &categoryName)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("资产不存在: %w", ErrProjectScopedNotFound)
	}
	if err != nil {
		return err
	}
	if !strings.Contains(strings.ToLower(deviceType+" "+categoryName), "switch") && !strings.Contains(deviceType+" "+categoryName, "交换机") {
		return fmt.Errorf("只有交换机资产可以保存配置快照")
	}
	value, err := decodeSwitchSnapshot(item.SnapshotJSON)
	if err != nil {
		return err
	}
	canonical, _ := json.Marshal(value)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	readAt := strings.TrimSpace(item.ReadAt)
	if readAt == "" {
		readAt = now
	}
	_, err = s.db.Exec(`INSERT INTO cmdb_switch_snapshots(project_id,sync_id,asset_id,vendor,protocol,host_id,read_at,snapshot_json,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(project_id,asset_id) WHERE deleted_at IS NULL DO UPDATE SET vendor=excluded.vendor,protocol=excluded.protocol,host_id=excluded.host_id,read_at=excluded.read_at,snapshot_json=excluded.snapshot_json,revision=cmdb_switch_snapshots.revision+1,updated_at=excluded.updated_at,deleted_at=NULL`, scope.ProjectID, uuid.NewString(), item.AssetID, strings.TrimSpace(item.Vendor), strings.TrimSpace(item.Protocol), strings.TrimSpace(item.HostID), readAt, string(canonical), now, now)
	return err
}

func (s *Store) GetCmdbSwitchSnapshotForProject(scope ProjectScope, assetID int64) (*CmdbSwitchSnapshot, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	item := &CmdbSwitchSnapshot{}
	err := s.db.QueryRow(`SELECT id,project_id,IFNULL(sync_id,''),asset_id,vendor,protocol,host_id,read_at,snapshot_json,revision,IFNULL(created_at,''),IFNULL(updated_at,'') FROM cmdb_switch_snapshots WHERE project_id=? AND asset_id=? AND deleted_at IS NULL`, scope.ProjectID, assetID).Scan(&item.ID, &item.ProjectID, &item.SyncID, &item.AssetID, &item.Vendor, &item.Protocol, &item.HostID, &item.ReadAt, &item.SnapshotJSON, &item.Revision, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(item.SnapshotJSON), &item.Snapshot); err != nil {
		return nil, err
	}
	return item, nil
}
