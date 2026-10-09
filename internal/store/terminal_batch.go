package store

import (
	"fmt"
	"strings"
	"time"
)

// TerminalAssetChanges 只接收批量弹窗支持的属性，不允许覆盖 IP、人员等未选字段。
type TerminalAssetChanges struct {
	GroupID    *int64  `json:"group_id"`
	DeviceType *string `json:"device_type"`
	OSType     *string `json:"os_type"`
	OSVersion  *string `json:"os_version"`
	Status     *string `json:"status"`
}

func (s *Store) BatchUpdateTerminalAssetsForProject(scope ProjectScope, ids []int64, changes TerminalAssetChanges, operator string) (int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	unique := make([]int64, 0, len(ids))
	seen := make(map[int64]bool, len(ids))
	for _, id := range ids {
		if id <= 0 {
			return 0, fmt.Errorf("非法资产 ID")
		}
		if !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	if len(unique) == 0 {
		return 0, fmt.Errorf("请先选择要操作的资产")
	}
	sets := []string{}
	mappedSets := []string{}
	args, mappedArgs := []any{}, []any{}
	description := []string{}
	if changes.GroupID != nil {
		if *changes.GroupID < 0 {
			return 0, fmt.Errorf("资产分组无效")
		}
		sets = append(sets, "group_id=?")
		mappedSets = append(mappedSets, "group_name=?")
		args = append(args, *changes.GroupID)
		mappedArgs = append(mappedArgs, "")
		description = append(description, fmt.Sprintf("分组 ID：%d", *changes.GroupID))
	}
	for _, field := range []struct {
		key, label string
		value      *string
	}{
		{"device_type", "设备分类", changes.DeviceType},
		{"os_type", "操作系统", changes.OSType},
		{"os_version", "系统版本", changes.OSVersion},
		{"status", "设备状态", changes.Status},
	} {
		if field.value == nil {
			continue
		}
		value := strings.TrimSpace(*field.value)
		sets = append(sets, field.key+"=?")
		mappedSets = append(mappedSets, field.key+"=?")
		args = append(args, value)
		mappedValue := value
		if field.key == "status" {
			mappedValue = mapLegacyAssetStatus(value)
		}
		mappedArgs = append(mappedArgs, mappedValue)
		description = append(description, field.label+"："+value)
	}
	if len(sets) == 0 {
		return 0, fmt.Errorf("请选择要修改的属性")
	}
	clearCloudFields := changes.DeviceType != nil && strings.TrimSpace(*changes.DeviceType) != "" && !isCloudDesktopDeviceType(*changes.DeviceType)
	if clearCloudFields {
		sets = append(sets, "display_sn=''", "terminal_ip=''")
		mappedSets = append(mappedSets, "display_sn=''")
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	sets = append(sets, "updated_at=?")
	mappedSets = append(mappedSets, "updated_at=?")
	args = append(args, now)
	mappedArgs = append(mappedArgs, now)
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if changes.GroupID != nil && *changes.GroupID > 0 {
		var groupName string
		if err := tx.QueryRow(`SELECT name FROM cmdb_groups WHERE project_id=? AND id=?`, scope.ProjectID, *changes.GroupID).Scan(&groupName); err != nil {
			return 0, fmt.Errorf("资产分组不属于当前项目")
		}
		mappedArgs[0] = groupName
	} else if changes.GroupID != nil {
		mappedArgs[0] = ""
	}
	for _, id := range unique {
		old, err := legacyAssetSnapshotInTx(tx, id, scope.ProjectID)
		if err != nil {
			return 0, fmt.Errorf("资产 %d 不存在或不可修改: %w", id, err)
		}
		values := append(append([]any{}, args...), id, scope.ProjectID)
		if _, err := tx.Exec(`UPDATE assets SET `+strings.Join(sets, ",")+` WHERE id=? AND project_id=?`, values...); err != nil {
			return 0, err
		}
		mappedValues := append(append([]any{}, mappedArgs...), id, scope.ProjectID)
		if _, err := tx.Exec(`UPDATE cmdb_assets SET `+strings.Join(mappedSets, ",")+` WHERE source_type='legacy_asset' AND source_id=? AND project_id=?`, mappedValues...); err != nil {
			return 0, err
		}
		// 仅切换普通设备类型导致物理 IP 清空时处理地址联动；普通属性不重新分配旧 IP。
		if clearCloudFields && old.TerminalIP != "" {
			if _, err := tx.Exec(`UPDATE cmdb_assets SET
				mgmt_ip=CASE WHEN mgmt_ip=? THEN '' ELSE mgmt_ip END,
				manage_ip=CASE WHEN manage_ip=? THEN '' ELSE manage_ip END
				WHERE project_id=? AND source_type='legacy_asset' AND source_id=?`, old.TerminalIP, old.TerminalIP, scope.ProjectID, id); err != nil {
				return 0, err
			}
			asset := &Asset{AssetCode: old.AssetCode, IP: old.IP, UserName: old.UserName, Department: old.Department, Room: old.Room}
			if err := syncAssetIPPoolInTx(tx, scope.ProjectID, id, old.IP, old.TerminalIP, asset); err != nil {
				return 0, err
			}
		}
		if _, err := tx.Exec(`INSERT INTO asset_logs (project_id,asset_id,log_type,operator,description,log_time)
			VALUES (?,?,'属性修改',?,?,?)`, scope.ProjectID, id, operator, "批量设置："+strings.Join(description, "；"), now); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(unique), nil
}
