package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

func (s *Store) AllServersForProject(scope ProjectScope) ([]PhysicalServer, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT id, project_id, IFNULL(asset_code,''), IFNULL(device_name,''), IFNULL(brand_model,''),
		IFNULL(serial_number,''), IFNULL(location,''), IFNULL(rack_unit,''), IFNULL(cpu_info,''),
		IFNULL(memory_info,''), IFNULL(disk_info,''), IFNULL(mgmt_ip,''), IFNULL(mgmt_url,''),
		IFNULL(biz_ip,''), IFNULL(os_type,''), IFNULL(admin_user,''), IFNULL(status,''),
		IFNULL(purchase_date,''), IFNULL(warranty_date,''), IFNULL(remark,''),
		IFNULL(created_at,''), IFNULL(updated_at,'')
		FROM servers WHERE project_id=? ORDER BY id ASC`, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]PhysicalServer, 0, 16)
	for rows.Next() {
		var server PhysicalServer
		if err := rows.Scan(&server.ID, &server.ProjectID, &server.AssetCode, &server.DeviceName, &server.BrandModel, &server.SerialNumber,
			&server.Location, &server.RackUnit, &server.CPUInfo, &server.MemoryInfo, &server.DiskInfo, &server.MgmtIP,
			&server.MgmtURL, &server.BizIP, &server.OSType, &server.AdminUser, &server.Status, &server.PurchaseDate,
			&server.WarrantyDate, &server.Remark, &server.CreatedAt, &server.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, server)
	}
	return list, rows.Err()
}

func (s *Store) cmdbOrgNameToIDForProject(scope ProjectScope) (map[string]int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	orgs, err := s.ListCmdbOrgsForProject(scope)
	if err != nil {
		return nil, err
	}
	m := make(map[string]int64, len(orgs))
	for _, org := range orgs {
		m[org.Name] = org.ID
	}
	return m, nil
}

func (s *Store) cmdbAssetExistsForProject(scope ProjectScope, sourceType string, sourceID int64) (bool, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return false, err
	}
	var id int64
	err := s.db.QueryRow(`SELECT id FROM cmdb_assets
		WHERE project_id=? AND source_type=? AND source_id=? AND deleted_at IS NULL`,
		scope.ProjectID, sourceType, sourceID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (s *Store) insertCmdbInterfaceForProject(scope ProjectScope, assetID, isPrimary int64, ip, netZone, remark string) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	if err := s.requireAssetInProject(s.db, scope.ProjectID, assetID); err != nil {
		return err
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := s.db.Exec(`INSERT INTO cmdb_asset_interfaces
		(project_id, asset_id, is_primary, if_name, ip, mask, gateway, mac, net_zone, remark, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		scope.ProjectID, assetID, isPrimary, "", ip, "", "", "", netZone, remark, now, now)
	return err
}

func (s *Store) SyncLegacyToCmdbForProject(scope ProjectScope) (*CmdbSyncResult, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	result := &CmdbSyncResult{}
	assets, err := s.AllAssetsForProject(scope)
	if err != nil {
		return nil, err
	}

	departments := make([]string, 0, len(assets))
	for _, asset := range assets {
		departments = append(departments, asset.Department)
	}
	added, err := s.SeedCmdbOrgsFromDepartmentsForProject(scope, departments)
	if err != nil {
		return nil, err
	}
	result.OrgInserted = added
	orgMap, err := s.cmdbOrgNameToIDForProject(scope)
	if err != nil {
		return nil, err
	}

	for _, asset := range assets {
		exists, err := s.cmdbAssetExistsForProject(scope, "legacy_asset", asset.ID)
		if err != nil {
			return nil, err
		}
		if exists {
			result.Skipped++
			continue
		}

		name := strings.TrimSpace(asset.UserName)
		if name != "" {
			name += " 的终端"
		} else {
			name = "公用终端"
		}
		item := &CmdbAsset{
			AssetCode: asset.AssetCode, Name: name, Status: mapLegacyAssetStatus(asset.Status),
			AssetClass: "physical", DeviceType: asset.DeviceType, SN: asset.BoxSN,
			OrgID: orgMap[strings.TrimSpace(asset.Department)], Department: asset.Department,
			Owner: asset.UserName, MgmtIP: asset.TerminalIP,
			SourceType: "legacy_asset", SourceID: asset.ID,
		}
		id, err := s.InsertCmdbAssetForProject(scope, item)
		if err != nil {
			return nil, err
		}
		result.AssetInserted++
		if ip := strings.TrimSpace(asset.IP); ip != "" {
			if err := s.insertCmdbInterfaceForProject(scope, id, 1, ip, "业务网", "旧终端台账业务IP"); err != nil {
				return nil, err
			}
		}
	}

	servers, err := s.AllServersForProject(scope)
	if err != nil {
		return nil, err
	}
	for _, server := range servers {
		exists, err := s.cmdbAssetExistsForProject(scope, "legacy_server", server.ID)
		if err != nil {
			return nil, err
		}
		if exists {
			result.Skipped++
			continue
		}

		item := &CmdbAsset{
			AssetCode: server.AssetCode, Name: server.DeviceName,
			Status: mapLegacyServerStatus(server.Status), AssetClass: "physical",
			SN: server.SerialNumber, Model: server.BrandModel, Owner: server.AdminUser,
			CabinetName: server.Location, MgmtIP: server.MgmtIP, OSType: server.OSType,
			InstallDate: server.PurchaseDate, WarrantyDate: server.WarrantyDate,
			SourceType: "legacy_server", SourceID: server.ID,
		}
		id, err := s.InsertCmdbAssetForProject(scope, item)
		if err != nil {
			return nil, err
		}
		result.ServerInserted++
		if ip := strings.TrimSpace(server.BizIP); ip != "" {
			if err := s.insertCmdbInterfaceForProject(scope, id, 1, ip, "业务网", "旧服务器业务IP"); err != nil {
				return nil, err
			}
		}
	}
	return result, nil
}
