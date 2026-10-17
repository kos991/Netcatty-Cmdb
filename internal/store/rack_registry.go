package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

func normalizeRackConfig(item *ConfigItem) error {
	item.Name = strings.TrimSpace(item.Name)
	item.DataCenter = strings.TrimSpace(item.DataCenter)
	item.CabinetName = normalizeCabinetName(item.CabinetName)
	switch item.LocationType {
	case "":
		return validateRackUnits(item.RackUnits)
	case "room":
		if item.DataCenter == "" {
			item.DataCenter = item.Name
		}
		if item.DataCenter == "" {
			return errors.New("机房名称不能为空")
		}
		item.Name, item.CabinetName, item.RackUnits = item.DataCenter, "", 0
	case "cabinet":
		if item.CabinetName == "" {
			return errors.New("机柜名称不能为空")
		}
		if item.RackUnits < 1 {
			return errors.New("机柜 U 数需在 1-60 之间")
		}
		if err := validateRackUnits(item.RackUnits); err != nil {
			return err
		}
		item.Name = qualifiedRackLocation(item.DataCenter, item.CabinetName)
	default:
		return errors.New("位置类型无效")
	}
	return nil
}

func (s *Store) updateRackConfigItem(scope ProjectScope, item *ConfigItem) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var current ConfigItem
	err = tx.QueryRow(`SELECT name,rack_units,location_type,data_center,cabinet_name FROM cmdb_locations WHERE id=? AND project_id=? AND deleted_at IS NULL`, item.ID, scope.ProjectID).Scan(&current.Name, &current.RackUnits, &current.LocationType, &current.DataCenter, &current.CabinetName)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("配置项不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	if err != nil {
		return err
	}
	if item.LocationType == "" && current.LocationType != "" {
		item.LocationType, item.DataCenter, item.CabinetName = current.LocationType, current.DataCenter, current.CabinetName
	}
	if current.LocationType != "" && item.LocationType != current.LocationType {
		return errors.New("不能改变已登记位置的机房或机柜类型")
	}
	if err := normalizeRackConfig(item); err != nil {
		return err
	}
	if item.Name == "" {
		return errors.New("配置项名称不能为空")
	}
	var collision int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM cmdb_locations WHERE project_id=? AND name=? AND id<>? AND deleted_at IS NULL`, scope.ProjectID, item.Name, item.ID).Scan(&collision); err != nil {
		return err
	}
	if collision > 0 {
		return errors.New("目标机房或机柜已存在")
	}
	if current.LocationType == "room" && current.DataCenter != item.DataCenter {
		if err := tx.QueryRow(`SELECT (SELECT COUNT(*) FROM cmdb_assets WHERE project_id=? AND data_center=? AND deleted_at IS NULL)+(SELECT COUNT(*) FROM cmdb_locations WHERE project_id=? AND data_center=? AND location_type='cabinet' AND deleted_at IS NULL)`, scope.ProjectID, current.DataCenter, scope.ProjectID, current.DataCenter).Scan(&collision); err != nil {
			return err
		}
		if collision > 0 {
			return errors.New("机房已有设备或机柜，不能直接改名")
		}
	}
	isCabinet := item.LocationType == "cabinet" || current.LocationType == "cabinet" || current.RackUnits > 0
	if isCabinet {
		// Match canonical identities, including literal parentheses, without
		// guessing historic free-text room/cabinet names.
		predicate := `CASE WHEN IFNULL(data_center,'')='' THEN IFNULL(cabinet_name,'') ELSE data_center || ' (' || cabinet_name || ')' END=?`
		args := []any{scope.ProjectID, current.Name}
		if current.LocationType == "cabinet" {
			predicate = `IFNULL(data_center,'')=? AND IFNULL(cabinet_name,'')=?`
			args = []any{scope.ProjectID, current.DataCenter, current.CabinetName}
		}
		var highest int64
		if err := tx.QueryRow(`SELECT COALESCE(MAX(start_u+MAX(height_u,1)-1),0) FROM cmdb_assets WHERE project_id=? AND `+predicate+` AND start_u>0 AND deleted_at IS NULL`, args...).Scan(&highest); err != nil {
			return err
		}
		units := item.RackUnits
		if units == 0 {
			units = 42
		}
		if highest > units {
			return fmt.Errorf("已有设备占用到 %dU，机柜不能小于 %dU", highest, highest)
		}
		if item.LocationType == "cabinet" && item.Name != current.Name {
			if err := tx.QueryRow(`SELECT COUNT(*) FROM cmdb_assets WHERE project_id=? AND IFNULL(data_center,'')=? AND IFNULL(cabinet_name,'')=? AND deleted_at IS NULL`, scope.ProjectID, item.DataCenter, item.CabinetName).Scan(&collision); err != nil {
				return err
			}
			if collision > 0 {
				return errors.New("目标机柜已有设备，不能合并两个机柜")
			}
			rows, err := tx.Query(`SELECT id,source_type,source_id,IFNULL(data_center,''),IFNULL(cabinet_name,'') FROM cmdb_assets WHERE project_id=? AND `+predicate+` AND deleted_at IS NULL`, args...)
			if err != nil {
				return err
			}
			var assets []CmdbAsset
			for rows.Next() {
				var asset CmdbAsset
				if err := rows.Scan(&asset.ID, &asset.SourceType, &asset.SourceID, &asset.DataCenter, &asset.CabinetName); err != nil {
					rows.Close()
					return err
				}
				assets = append(assets, asset)
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return err
			}
			for _, asset := range assets {
				if _, err := tx.Exec(`UPDATE cmdb_assets SET data_center=?,cabinet_name=?,cabinet_pos='',revision=revision+1,updated_at=? WHERE id=? AND project_id=?`, item.DataCenter, item.CabinetName, time.Now().UTC().Format(time.RFC3339Nano), asset.ID, scope.ProjectID); err != nil {
					return err
				}
				changes := CmdbAssetChanges{DataCenter: &item.DataCenter, CabinetName: &item.CabinetName}
				if err := writeThroughToLegacy(tx, scope.ProjectID, &asset, changes); err != nil {
					return err
				}
				if err := appendCmdbAssetHistory(tx, scope.ProjectID, asset.ID, "机柜变更", fmt.Sprintf("机柜由 %s 调整为 %s", current.Name, item.Name), "系统"); err != nil {
					return err
				}
			}
		}
	}
	result, err := tx.Exec(`UPDATE cmdb_locations SET name=?,remark=?,sort_order=?,rack_units=?,location_type=?,data_center=?,cabinet_name=?,revision=revision+1,updated_at=? WHERE id=? AND project_id=? AND deleted_at IS NULL`, item.Name, strings.TrimSpace(item.Remark), item.SortOrder, item.RackUnits, item.LocationType, item.DataCenter, item.CabinetName, time.Now().UTC().Format(time.RFC3339Nano), item.ID, scope.ProjectID)
	if err != nil {
		return err
	}
	if err := requireConfigAffected(result, "配置项不属于当前项目"); err != nil {
		return err
	}
	return tx.Commit()
}

func validateRackAssetPlacement(tx *sql.Tx, projectID, assetID int64, room, cabinet string, start, height int64) error {
	if start < 0 {
		return errors.New("起始 U 位无效")
	}
	if height < 1 || height > maxRackUnits {
		return errors.New("占用 U 数需在 1-60 之间")
	}
	if start == 0 {
		return nil
	}
	if cabinet == "" {
		return errors.New("上架前请选择机柜")
	}
	var units int64
	err := tx.QueryRow(`SELECT rack_units FROM cmdb_locations WHERE project_id=? AND name=? AND deleted_at IS NULL`, projectID, qualifiedRackLocation(room, cabinet)).Scan(&units)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if units == 0 {
		units = 42
	}
	top := start + height - 1
	if top > units {
		return fmt.Errorf("设备占用到 %dU，超出机柜 %dU", top, units)
	}
	var name string
	err = tx.QueryRow(`SELECT name FROM cmdb_assets WHERE project_id=? AND id<>? AND IFNULL(data_center,'')=? AND IFNULL(cabinet_name,'')=? AND start_u>0 AND start_u<=? AND start_u+MAX(height_u,1)-1>=? AND deleted_at IS NULL LIMIT 1`, projectID, assetID, room, cabinet, top, start).Scan(&name)
	if err == nil {
		return fmt.Errorf("与 %s 的 U 位重叠", name)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	return nil
}

func rackPatchInterfaces(tx *sql.Tx, projectID, assetID int64) ([]CmdbAssetInterface, error) {
	rows, err := tx.Query(`SELECT id,IFNULL(ip,''),IFNULL(additional_ips_json,'[]') FROM cmdb_asset_interfaces WHERE project_id=? AND asset_id=? AND deleted_at IS NULL`, projectID, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var interfaces []CmdbAssetInterface
	for rows.Next() {
		var iface CmdbAssetInterface
		if err := rows.Scan(&iface.ID, &iface.IP, &iface.AdditionalIPsJSON); err != nil {
			return nil, err
		}
		interfaces = append(interfaces, iface)
	}
	return interfaces, rows.Err()
}
