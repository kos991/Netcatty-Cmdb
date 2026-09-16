package store

type SeedV2 struct {
	Version   int              `json:"version"`
	Assets    []Asset          `json:"assets"`
	AssetLogs []AssetLog       `json:"asset_logs"`
	IPPool    []IPEntry        `json:"ip_pool"`
	Servers   []PhysicalServer `json:"servers"`
	Apps      []ServerApp      `json:"apps"`
}

func (s *Store) MarkSeededV2() error {
	return s.SetSeededV2()
}

func (s *Store) ImportSeedV2(seed *SeedV2) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Assets
	stmtAsset, err := tx.Prepare(`INSERT INTO assets (asset_code, box_sn, display_sn, user_name, department, room, ip, terminal_ip, security_software, status, net_type, remark, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmtAsset.Close()
	for _, a := range seed.Assets {
		_, _ = stmtAsset.Exec(a.AssetCode, a.BoxSN, a.DisplaySN, a.UserName, a.Department, a.Room, a.IP, a.TerminalIP, a.SecuritySoftware, a.Status, a.NetType, a.Remark, a.CreatedAt, a.UpdatedAt)
	}

	// 2. Asset Logs
	stmtLog, err := tx.Prepare(`INSERT INTO asset_logs (asset_id, log_type, from_user, to_user, from_location, to_location, old_sn, new_sn, operator, description, log_time)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmtLog.Close()
	for _, l := range seed.AssetLogs {
		_, _ = stmtLog.Exec(l.AssetID, l.LogType, l.FromUser, l.ToUser, l.FromLocation, l.ToLocation, l.OldSN, l.NewSN, l.Operator, l.Description, l.LogTime)
	}

	// 3. IP Pool
	stmtIP, err := tx.Prepare(`INSERT INTO ip_pool (subnet, ip, department, room, account, status, remark)
		VALUES (?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmtIP.Close()
	for _, ip := range seed.IPPool {
		_, _ = stmtIP.Exec(ip.Subnet, ip.IP, ip.Department, ip.Room, ip.Account, ip.Status, ip.Remark)
	}

	// 4. Servers
	stmtServer, err := tx.Prepare(`INSERT INTO servers (asset_code, device_name, brand_model, serial_number, location, rack_unit, cpu_info, memory_info, disk_info, mgmt_ip, mgmt_url, biz_ip, os_type, admin_user, status, purchase_date, warranty_date, remark, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmtServer.Close()
	for _, srv := range seed.Servers {
		_, _ = stmtServer.Exec(srv.AssetCode, srv.DeviceName, srv.BrandModel, srv.SerialNumber, srv.Location, srv.RackUnit, srv.CPUInfo, srv.MemoryInfo, srv.DiskInfo, srv.MgmtIP, srv.MgmtURL, srv.BizIP, srv.OSType, srv.AdminUser, srv.Status, srv.PurchaseDate, srv.WarrantyDate, srv.Remark, srv.CreatedAt, srv.UpdatedAt)
	}

	return tx.Commit()
}

func (s *Store) EnsureServersSeeded(seed *SeedV2) error {
	var count int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM servers").Scan(&count)
	if count > 0 {
		return nil
	}
	for _, srv := range seed.Servers {
		_, _ = s.CreateServer(&srv, "system")
	}
	return nil
}
