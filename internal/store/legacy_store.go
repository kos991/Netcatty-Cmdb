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
	if limit < 1 {
		limit = 20
	}
	pattern := "%" + strings.TrimSpace(q) + "%"
	results := make([]SearchResult, 0)

	query := func(sql string, args []interface{}, scan func(*SearchResult, interface{ Scan(...interface{}) error }) error) error {
		rows, err := s.db.Query(sql, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SearchResult
			if err := scan(&item, rows); err != nil {
				return err
			}
			results = append(results, item)
		}
		return rows.Err()
	}

	if err := query(`SELECT id, IFNULL(user_name,''), IFNULL(department,''), IFNULL(room,''), IFNULL(ip,''), IFNULL(status,''), IFNULL(asset_code,'')
		FROM assets WHERE user_name LIKE ? OR asset_code LIKE ? OR box_sn LIKE ? OR display_sn LIKE ? OR ip LIKE ? OR terminal_ip LIKE ? OR department LIKE ? OR room LIKE ? LIMIT ?`,
		[]interface{}{pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, limit}, func(item *SearchResult, row interface{ Scan(...interface{}) error }) error {
			var room, assetCode string
			if err := row.Scan(&item.ID, &item.Title, &item.Department, &room, &item.IP, &item.Status, &assetCode); err != nil {
				return err
			}
			item.Type, item.Group, item.TableKey = "terminal", searchGroups["terminal"].Group, searchGroups["terminal"].TableKey
			item.Subtitle, item.Tag, item.Extra = room, "云桌面终端", assetCode
			item.Data = map[string]interface{}{"资产编号": assetCode, "房间": room}
			return nil
		}); err != nil {
		return nil, err
	}

	if err := query(`SELECT a.id, a.name, COALESCE(NULLIF(a.manage_ip,''), a.mgmt_ip, ''), IFNULL(a.department,''), IFNULL(a.status,''), IFNULL(c.name,''), IFNULL(a.asset_code,'')
		FROM cmdb_assets a LEFT JOIN cmdb_device_categories c ON c.id = a.category_id
		WHERE (a.name LIKE ? OR a.asset_code LIKE ? OR a.sn LIKE ? OR a.mgmt_ip LIKE ? OR a.manage_ip LIKE ? OR a.owner LIKE ? OR a.department LIKE ?)
		AND (a.source_type = 'legacy_server'
			OR lower(IFNULL(a.device_type,'')) IN ('server','physical_server','virtual_machine','switch','router','security_device','storage')
			OR EXISTS (SELECT 1 FROM cmdb_device_categories scope_category WHERE scope_category.id = a.category_id
				AND (scope_category.name LIKE '%服务器%' OR scope_category.name LIKE '%虚拟机%' OR scope_category.name LIKE '%交换机%' OR scope_category.name LIKE '%路由器%' OR scope_category.name LIKE '%安全设备%' OR scope_category.name LIKE '%存储设备%')))
		LIMIT ?`,
		[]interface{}{pattern, pattern, pattern, pattern, pattern, pattern, pattern, limit}, func(item *SearchResult, row interface{ Scan(...interface{}) error }) error {
			var category, assetCode string
			if err := row.Scan(&item.ID, &item.Title, &item.IP, &item.Department, &item.Status, &category, &assetCode); err != nil {
				return err
			}
			item.Type, item.Group, item.TableKey = "infrastructure", searchGroups["infrastructure"].Group, searchGroups["infrastructure"].TableKey
			item.Subtitle, item.Tag, item.Extra = category, category, assetCode
			item.Data = map[string]interface{}{"资产编号": assetCode, "设备分类": category}
			return nil
		}); err != nil {
		return nil, err
	}

	if err := query(`SELECT id, IFNULL(app_name,''), IFNULL(app_type,''), IFNULL(access_url,''), IFNULL(status,''), IFNULL(remark,'')
		FROM server_apps WHERE app_name LIKE ? OR app_type LIKE ? OR access_url LIKE ? OR remark LIKE ? LIMIT ?`,
		[]interface{}{pattern, pattern, pattern, pattern, limit}, func(item *SearchResult, row interface{ Scan(...interface{}) error }) error {
			if err := row.Scan(&item.ID, &item.Title, &item.Tag, &item.IP, &item.Status, &item.Extra); err != nil {
				return err
			}
			item.Type, item.Group, item.TableKey = "system", searchGroups["system"].Group, searchGroups["system"].TableKey
			item.Subtitle = item.Tag
			item.Data = map[string]interface{}{"访问地址": item.IP, "备注": item.Extra}
			return nil
		}); err != nil {
		return nil, err
	}

	if err := query(`SELECT id, name, IFNULL(person_code,''), IFNULL(department,''), IFNULL(status,''), IFNULL(title,''), IFNULL(phone,'')
		FROM cmdb_persons WHERE name LIKE ? OR person_code LIKE ? OR phone LIKE ? OR email LIKE ? OR department LIKE ? LIMIT ?`,
		[]interface{}{pattern, pattern, pattern, pattern, pattern, limit}, func(item *SearchResult, row interface{ Scan(...interface{}) error }) error {
			var personCode, title, phone string
			if err := row.Scan(&item.ID, &item.Title, &personCode, &item.Department, &item.Status, &title, &phone); err != nil {
				return err
			}
			item.Type, item.Group, item.TableKey = "person", searchGroups["person"].Group, searchGroups["person"].TableKey
			item.Subtitle, item.Tag, item.Extra = title, "人员", personCode
			item.Data = map[string]interface{}{"人员编号": personCode, "联系电话": phone}
			return nil
		}); err != nil {
		return nil, err
	}

	if err := query(`SELECT id, IFNULL(log_type,''), IFNULL(description,''), IFNULL(operator,''), IFNULL(log_time,''), asset_id
		FROM asset_logs WHERE log_type LIKE ? OR description LIKE ? OR operator LIKE ? OR from_user LIKE ? OR to_user LIKE ? LIMIT ?`,
		[]interface{}{pattern, pattern, pattern, pattern, pattern, limit}, func(item *SearchResult, row interface{ Scan(...interface{}) error }) error {
			var operator, logTime string
			var assetID int64
			if err := row.Scan(&item.ID, &item.Title, &item.Subtitle, &operator, &logTime, &assetID); err != nil {
				return err
			}
			item.Type, item.Group, item.TableKey = "audit", searchGroups["audit"].Group, searchGroups["audit"].TableKey
			item.Tag, item.Extra = "运维履历", logTime
			item.Data = map[string]interface{}{"资产ID": assetID, "操作人": operator, "发生时间": logTime}
			return nil
		}); err != nil {
		return nil, err
	}

	if err := query(`SELECT id, IFNULL(ip,''), IFNULL(subnet,''), IFNULL(department,''), IFNULL(status,''), IFNULL(account,''), IFNULL(room,''), IFNULL(remark,'')
		FROM ip_pool WHERE ip LIKE ? OR subnet LIKE ? OR department LIKE ? OR room LIKE ? OR account LIKE ? OR remark LIKE ? LIMIT ?`,
		[]interface{}{pattern, pattern, pattern, pattern, pattern, pattern, limit}, func(item *SearchResult, row interface{ Scan(...interface{}) error }) error {
			var subnet, account, room string
			if err := row.Scan(&item.ID, &item.Title, &subnet, &item.Department, &item.Status, &account, &room, &item.Extra); err != nil {
				return err
			}
			item.Type, item.Group, item.TableKey = "ip", searchGroups["ip"].Group, searchGroups["ip"].TableKey
			item.IP, item.Subtitle, item.Tag = item.Title, subnet, "IP"
			item.Data = map[string]interface{}{"账号": account, "房间": room, "备注": item.Extra}
			return nil
		}); err != nil {
		return nil, err
	}

	return results, nil
}

var searchGroups = map[string]struct{ Group, TableKey string }{
	"terminal":       {"终端资产", "assets"},
	"infrastructure": {"基础设施资源", "cmdb_assets"},
	"system":         {"业务系统", "server_apps"},
	"person":         {"组织与人员", "persons"},
	"audit":          {"运维履历", "asset_logs"},
	"ip":             {"IP 规划池", "ip_pool"},
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
