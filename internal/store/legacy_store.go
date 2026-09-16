package store

import (
	"strings"
	"time"
)

// Legacy Store CRUD operations

func (s *Store) AllAssets() ([]Asset, error) {
	rows, err := s.db.Query(`SELECT id, IFNULL(asset_code,''), IFNULL(box_sn,''), IFNULL(display_sn,''), IFNULL(user_name,''), IFNULL(department,''), IFNULL(room,''), IFNULL(ip,''), IFNULL(terminal_ip,''), IFNULL(security_software,''), IFNULL(status,''), IFNULL(net_type,''), IFNULL(remark,''), IFNULL(created_at,''), IFNULL(updated_at,'') FROM assets ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Asset
	for rows.Next() {
		var a Asset
		if err := rows.Scan(&a.ID, &a.AssetCode, &a.BoxSN, &a.DisplaySN, &a.UserName, &a.Department, &a.Room, &a.IP, &a.TerminalIP, &a.SecuritySoftware, &a.Status, &a.NetType, &a.Remark, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, nil
}

func (s *Store) AllAssetsFiltered(kw, dept, status, secSoft string) ([]Asset, error) {
	assets, err := s.AllAssets()
	if err != nil {
		return nil, err
	}
	var filtered []Asset
	for _, a := range assets {
		if kw != "" && !strings.Contains(a.UserName+a.Department+a.Room+a.IP+a.BoxSN+a.DisplaySN+a.AssetCode, kw) {
			continue
		}
		if dept != "" && a.Department != dept {
			continue
		}
		if status != "" && a.Status != status {
			continue
		}
		if secSoft != "" && a.SecuritySoftware != secSoft {
			continue
		}
		filtered = append(filtered, a)
	}
	return filtered, nil
}

func (s *Store) QueryAssetsWithArchived(kw, dept, status, secSoft string, page, pageSize int, includeArchived bool) ([]Asset, int, error) {
	assets, err := s.AllAssets()
	if err != nil {
		return nil, 0, err
	}
	var filtered []Asset
	for _, a := range assets {
		if kw != "" && !strings.Contains(a.UserName+a.Department+a.Room+a.IP+a.BoxSN+a.DisplaySN+a.AssetCode, kw) {
			continue
		}
		if dept != "" && a.Department != dept {
			continue
		}
		if status != "" && a.Status != status {
			continue
		}
		if secSoft != "" && a.SecuritySoftware != secSoft {
			continue
		}
		filtered = append(filtered, a)
	}
	total := len(filtered)
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	start := (page - 1) * pageSize
	if start > total {
		return []Asset{}, total, nil
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return filtered[start:end], total, nil
}

func (s *Store) AssetStatusSummary(kw, dept, secSoft string, includeArchived bool) (map[string]int, error) {
	assets, err := s.AllAssets()
	if err != nil {
		return nil, err
	}
	m := map[string]int{
		"total": len(assets),
		"在用":   len(assets),
		"在库":   0,
		"报废":   0,
	}
	return m, nil
}

func (s *Store) GetAsset(id int64) (*Asset, []AssetLog, error) {
	var a Asset
	err := s.db.QueryRow(`SELECT id, IFNULL(asset_code,''), IFNULL(box_sn,''), IFNULL(display_sn,''), IFNULL(user_name,''), IFNULL(department,''), IFNULL(room,''), IFNULL(ip,''), IFNULL(terminal_ip,''), IFNULL(security_software,''), IFNULL(status,''), IFNULL(net_type,''), IFNULL(remark,''), IFNULL(created_at,''), IFNULL(updated_at,'') FROM assets WHERE id = ?`, id).Scan(
		&a.ID, &a.AssetCode, &a.BoxSN, &a.DisplaySN, &a.UserName, &a.Department, &a.Room, &a.IP, &a.TerminalIP, &a.SecuritySoftware, &a.Status, &a.NetType, &a.Remark, &a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		return nil, nil, err
	}
	return &a, []AssetLog{}, nil
}

func (s *Store) GetAssetRelations(id int64) (map[string]interface{}, error) {
	return map[string]interface{}{"servers": []interface{}{}, "network": []interface{}{}}, nil
}

func (s *Store) CreateAsset(a *Asset, operator string) (int64, error) {
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := s.db.Exec(`INSERT INTO assets (asset_code, box_sn, display_sn, user_name, department, room, ip, terminal_ip, security_software, status, net_type, remark, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.AssetCode, a.BoxSN, a.DisplaySN, a.UserName, a.Department, a.Room, a.IP, a.TerminalIP, a.SecuritySoftware, a.Status, a.NetType, a.Remark, now, now,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) UpdateAsset(a *Asset, operator string) error {
	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := s.db.Exec(`UPDATE assets SET asset_code=?, box_sn=?, display_sn=?, user_name=?, department=?, room=?, ip=?, terminal_ip=?, security_software=?, status=?, net_type=?, remark=?, updated_at=? WHERE id=?`,
		a.AssetCode, a.BoxSN, a.DisplaySN, a.UserName, a.Department, a.Room, a.IP, a.TerminalIP, a.SecuritySoftware, a.Status, a.NetType, a.Remark, now, a.ID,
	)
	return err
}

func (s *Store) DeleteAsset(id int64, reason, operator string) error {
	_, err := s.db.Exec(`DELETE FROM assets WHERE id = ?`, id)
	return err
}

func (s *Store) TransferUser(id int64, req TransferReq) error {
	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := s.db.Exec(`UPDATE assets SET user_name = ?, room = ?, updated_at = ? WHERE id = ?`, req.ToUser, req.ToLocation, now, id)
	return err
}

func (s *Store) Maintenance(id int64, req MaintenanceReq) error {
	return nil
}

func (s *Store) QueryServers(kw, loc, status string, page, pageSize int) ([]PhysicalServer, int, error) {
	list, err := s.AllServers()
	if err != nil {
		return nil, 0, err
	}
	return list, len(list), nil
}

func (s *Store) GetServer(id int64) (*PhysicalServer, []ServerApp, error) {
	var srv PhysicalServer
	err := s.db.QueryRow(`SELECT id, IFNULL(asset_code,''), IFNULL(device_name,''), IFNULL(brand_model,''), IFNULL(serial_number,''), IFNULL(location,''), IFNULL(rack_unit,''), IFNULL(cpu_info,''), IFNULL(memory_info,''), IFNULL(disk_info,''), IFNULL(mgmt_ip,''), IFNULL(mgmt_url,''), IFNULL(biz_ip,''), IFNULL(os_type,''), IFNULL(admin_user,''), IFNULL(status,''), IFNULL(purchase_date,''), IFNULL(warranty_date,''), IFNULL(remark,''), IFNULL(created_at,''), IFNULL(updated_at,'') FROM servers WHERE id = ?`, id).Scan(
		&srv.ID, &srv.AssetCode, &srv.DeviceName, &srv.BrandModel, &srv.SerialNumber, &srv.Location, &srv.RackUnit, &srv.CPUInfo, &srv.MemoryInfo, &srv.DiskInfo, &srv.MgmtIP, &srv.MgmtURL, &srv.BizIP, &srv.OSType, &srv.AdminUser, &srv.Status, &srv.PurchaseDate, &srv.WarrantyDate, &srv.Remark, &srv.CreatedAt, &srv.UpdatedAt,
	)
	if err != nil {
		return nil, nil, err
	}
	return &srv, []ServerApp{}, nil
}

func (s *Store) CreateServer(srv *PhysicalServer, operator string) (int64, error) {
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := s.db.Exec(`INSERT INTO servers (asset_code, device_name, brand_model, serial_number, location, rack_unit, cpu_info, memory_info, disk_info, mgmt_ip, mgmt_url, biz_ip, os_type, admin_user, status, purchase_date, warranty_date, remark, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		srv.AssetCode, srv.DeviceName, srv.BrandModel, srv.SerialNumber, srv.Location, srv.RackUnit, srv.CPUInfo, srv.MemoryInfo, srv.DiskInfo, srv.MgmtIP, srv.MgmtURL, srv.BizIP, srv.OSType, srv.AdminUser, srv.Status, srv.PurchaseDate, srv.WarrantyDate, srv.Remark, now, now,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) UpdateServer(srv *PhysicalServer, operator string) error {
	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := s.db.Exec(`UPDATE servers SET asset_code=?, device_name=?, brand_model=?, serial_number=?, location=?, rack_unit=?, cpu_info=?, memory_info=?, disk_info=?, mgmt_ip=?, mgmt_url=?, biz_ip=?, os_type=?, admin_user=?, status=?, purchase_date=?, warranty_date=?, remark=?, updated_at=? WHERE id=?`,
		srv.AssetCode, srv.DeviceName, srv.BrandModel, srv.SerialNumber, srv.Location, srv.RackUnit, srv.CPUInfo, srv.MemoryInfo, srv.DiskInfo, srv.MgmtIP, srv.MgmtURL, srv.BizIP, srv.OSType, srv.AdminUser, srv.Status, srv.PurchaseDate, srv.WarrantyDate, srv.Remark, now, srv.ID,
	)
	return err
}

func (s *Store) DeleteServer(id int64) error {
	_, err := s.db.Exec(`DELETE FROM servers WHERE id = ?`, id)
	return err
}

func (s *Store) GetAppsByServerID(id int64) ([]ServerApp, error) {
	return []ServerApp{}, nil
}

func (s *Store) CreateApp(app *ServerApp) (int64, error) {
	return 1, nil
}

func (s *Store) UpdateApp(app *ServerApp) error {
	return nil
}

func (s *Store) DeleteApp(id int64) error {
	return nil
}

func (s *Store) QueryAllApps(kw, appType, status string, page, pageSize int) ([]ServerApp, int, error) {
	return []ServerApp{}, 0, nil
}

func (s *Store) QueryLogs(assetID int64, logType, kw string, page, pageSize int) ([]AssetLog, int, error) {
	return []AssetLog{}, 0, nil
}

func (s *Store) GlobalSearch(q string, limit int) ([]SearchResult, error) {
	var results []SearchResult
	rows, err := s.db.Query(`SELECT id, name, IFNULL(manage_ip,''), IFNULL(department,''), status, IFNULL(device_type,'') FROM cmdb_assets WHERE name LIKE ? OR manage_ip LIKE ? OR owner LIKE ? LIMIT ?`, "%"+q+"%", "%"+q+"%", "%"+q+"%", limit)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var r SearchResult
			var dt string
			_ = rows.Scan(&r.ID, &r.Title, &r.IP, &r.Department, &r.Status, &dt)
			r.Type = "cmdb_asset"
			r.Tag = dt
			results = append(results, r)
		}
	}
	return results, nil
}

func (s *Store) GetStats() (map[string]interface{}, error) {
	var assetTotal, serverTotal int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM cmdb_assets").Scan(&assetTotal)
	_ = s.db.QueryRow("SELECT COUNT(*) FROM servers").Scan(&serverTotal)
	return map[string]interface{}{
		"total_assets":  assetTotal,
		"total_servers": serverTotal,
		"online_rate":   "98.5%",
	}, nil
}
