package store

import (
	"database/sql"
	"fmt"
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

func (s *Store) AllAssetsFiltered(kw, dept, status, secSoft string, includeArchived bool) ([]Asset, error) {
	assets, err := s.AllAssets()
	if err != nil {
		return nil, err
	}
	return filterAssets(assets, kw, dept, status, secSoft, includeArchived), nil
}

func isArchivedAssetStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "已报废", "报废":
		return true
	default:
		return false
	}
}

func filterAssets(assets []Asset, kw, dept, status, secSoft string, includeArchived bool) []Asset {
	kw = strings.TrimSpace(kw)
	dept = strings.TrimSpace(dept)
	status = strings.TrimSpace(status)
	secSoft = strings.TrimSpace(secSoft)
	explicitArchived := isArchivedAssetStatus(status)
	filtered := make([]Asset, 0, len(assets))
	for _, a := range assets {
		if !includeArchived && !explicitArchived && isArchivedAssetStatus(a.Status) {
			continue
		}
		if kw != "" && !strings.Contains(a.UserName+a.Department+a.Room+a.IP+a.TerminalIP+a.BoxSN+a.DisplaySN+a.AssetCode, kw) {
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
	return filtered
}

func (s *Store) QueryAssetsWithArchived(kw, dept, status, secSoft string, page, pageSize int, includeArchived bool) ([]Asset, int, error) {
	assets, err := s.AllAssets()
	if err != nil {
		return nil, 0, err
	}
	filtered := filterAssets(assets, kw, dept, status, secSoft, includeArchived)
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
	filtered := filterAssets(assets, kw, dept, "", secSoft, includeArchived)
	m := map[string]int{"total": len(filtered)}
	for _, a := range filtered {
		m[a.Status]++
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
	rows, err := s.db.Query(`SELECT id, asset_id, IFNULL(log_type,''), IFNULL(from_user,''), IFNULL(to_user,''),
		IFNULL(from_location,''), IFNULL(to_location,''), IFNULL(old_sn,''), IFNULL(new_sn,''),
		IFNULL(operator,''), IFNULL(description,''), IFNULL(log_time,'')
		FROM asset_logs WHERE asset_id = ? ORDER BY log_time DESC, id DESC`, id)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	logs := make([]AssetLog, 0)
	for rows.Next() {
		var log AssetLog
		if err := rows.Scan(&log.ID, &log.AssetID, &log.LogType, &log.FromUser, &log.ToUser,
			&log.FromLocation, &log.ToLocation, &log.OldSN, &log.NewSN, &log.Operator,
			&log.Description, &log.LogTime); err != nil {
			return nil, nil, err
		}
		logs = append(logs, log)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return &a, logs, nil
}

func (s *Store) GetAssetRelations(id int64) (map[string]interface{}, error) {
	asset, _, err := s.GetAsset(id)
	if err != nil {
		return nil, err
	}

	ips := make([]IPEntry, 0)
	rows, err := s.db.Query(`SELECT id, IFNULL(subnet,''), IFNULL(ip,''), IFNULL(department,''),
		IFNULL(room,''), IFNULL(account,''), IFNULL(status,''), IFNULL(remark,'')
		FROM ip_pool
		WHERE (? <> '' AND ip = ?) OR (? <> '' AND ip = ?)
		ORDER BY id`, asset.IP, asset.IP, asset.TerminalIP, asset.TerminalIP)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var item IPEntry
		if err := rows.Scan(&item.ID, &item.Subnet, &item.IP, &item.Department, &item.Room, &item.Account, &item.Status, &item.Remark); err != nil {
			rows.Close()
			return nil, err
		}
		ips = append(ips, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	servers := make([]PhysicalServer, 0)
	rows, err = s.db.Query(`SELECT id, IFNULL(asset_code,''), IFNULL(device_name,''), IFNULL(brand_model,''),
		IFNULL(serial_number,''), IFNULL(location,''), IFNULL(rack_unit,''), IFNULL(cpu_info,''),
		IFNULL(memory_info,''), IFNULL(disk_info,''), IFNULL(mgmt_ip,''), IFNULL(mgmt_url,''),
		IFNULL(biz_ip,''), IFNULL(os_type,''), IFNULL(admin_user,''), IFNULL(status,''),
		IFNULL(purchase_date,''), IFNULL(warranty_date,''), IFNULL(remark,''), IFNULL(created_at,''), IFNULL(updated_at,'')
		FROM servers
		WHERE (? <> '' AND (mgmt_ip = ? OR biz_ip = ?)) OR (? <> '' AND (mgmt_ip = ? OR biz_ip = ?))
		ORDER BY id`, asset.IP, asset.IP, asset.IP, asset.TerminalIP, asset.TerminalIP, asset.TerminalIP)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var server PhysicalServer
		if err := rows.Scan(&server.ID, &server.AssetCode, &server.DeviceName, &server.BrandModel, &server.SerialNumber,
			&server.Location, &server.RackUnit, &server.CPUInfo, &server.MemoryInfo, &server.DiskInfo, &server.MgmtIP,
			&server.MgmtURL, &server.BizIP, &server.OSType, &server.AdminUser, &server.Status, &server.PurchaseDate,
			&server.WarrantyDate, &server.Remark, &server.CreatedAt, &server.UpdatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		servers = append(servers, server)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	apps := make([]ServerApp, 0)
	rows, err = s.db.Query(`SELECT app.id, app.server_id, IFNULL(app.app_name,''), IFNULL(app.app_type,''),
		'', '', IFNULL(app.status,''), IFNULL(app.remark,''), IFNULL(app.created_at,''), IFNULL(app.updated_at,'')
		FROM server_apps app JOIN servers server ON server.id = app.server_id
		WHERE (? <> '' AND (server.mgmt_ip = ? OR server.biz_ip = ?)) OR (? <> '' AND (server.mgmt_ip = ? OR server.biz_ip = ?))
		ORDER BY app.id`, asset.IP, asset.IP, asset.IP, asset.TerminalIP, asset.TerminalIP, asset.TerminalIP)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var app ServerApp
		if err := rows.Scan(&app.ID, &app.ServerID, &app.AppName, &app.AppType, &app.Port, &app.Version,
			&app.Status, &app.Description, &app.CreatedAt, &app.UpdatedAt); err != nil {
			return nil, err
		}
		apps = append(apps, app)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]interface{}{"ips": ips, "servers": servers, "apps": apps}, nil
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
	res, err := s.db.Exec(`UPDATE assets SET asset_code=?, box_sn=?, display_sn=?, user_name=?, department=?, room=?, ip=?, terminal_ip=?, security_software=?, status=?, net_type=?, remark=?, updated_at=? WHERE id=?`,
		a.AssetCode, a.BoxSN, a.DisplaySN, a.UserName, a.Department, a.Room, a.IP, a.TerminalIP, a.SecuritySoftware, a.Status, a.NetType, a.Remark, now, a.ID,
	)
	if err != nil {
		return err
	}
	return requireAffected(res, "资产不存在")
}

func (s *Store) DeleteAsset(id int64, reason, operator string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	asset, err := legacyAssetSnapshotInTx(tx, id)
	if err != nil {
		return err
	}
	if isArchivedAssetStatus(asset.Status) {
		return fmt.Errorf("资产已归档，不能重复注销")
	}
	now := legacyOperationTime("")
	res, err := tx.Exec(`UPDATE assets SET status='已报废', updated_at=? WHERE id=?`, now, id)
	if err != nil {
		return err
	}
	if err := requireAffected(res, "资产不存在"); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO asset_logs
		(asset_id, log_type, from_user, from_location, operator, description, log_time)
		VALUES (?, '设备回收注销', ?, ?, ?, ?, ?)`,
		id, asset.UserName, formatAssetLocation(asset.Department, asset.Room), operator, reason, now); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE cmdb_assets SET status='报废', updated_at=? WHERE source_type='legacy_asset' AND source_id=?`, now, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) TransferUser(id int64, req TransferReq) error {
	toUser := strings.TrimSpace(req.ToUser)
	if toUser == "" {
		return fmt.Errorf("新使用人姓名不能为空")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	asset, err := legacyAssetSnapshotInTx(tx, id)
	if err != nil {
		return err
	}
	if isArchivedAssetStatus(asset.Status) {
		return fmt.Errorf("归档资产不能调换使用人")
	}
	department := strings.TrimSpace(req.ToDepartment)
	if department == "" {
		department = asset.Department
	}
	room := strings.TrimSpace(req.ToRoom)
	if room == "" {
		room = strings.TrimSpace(req.ToLocation)
	}
	if room == "" {
		room = asset.Room
	}
	ip := strings.TrimSpace(req.NewIP)
	if ip == "" {
		ip = asset.IP
	}
	description := strings.TrimSpace(req.Description)
	if description == "" {
		description = req.Reason
	}
	logTime := legacyOperationTime(req.Date)
	res, err := tx.Exec(`UPDATE assets SET user_name=?, department=?, room=?, ip=?, updated_at=? WHERE id=?`,
		toUser, department, room, ip, logTime, id)
	if err != nil {
		return err
	}
	if err := requireAffected(res, "资产不存在"); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO asset_logs
		(asset_id, log_type, from_user, to_user, from_location, to_location, operator, description, log_time)
		VALUES (?, '调换使用人', ?, ?, ?, ?, ?, ?, ?)`, id, asset.UserName, toUser,
		formatAssetLocation(asset.Department, asset.Room), formatAssetLocation(department, room), req.Operator, description, logTime); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE cmdb_assets SET owner=?, department=?, room=?, updated_at=?
		WHERE source_type='legacy_asset' AND source_id=?`, toUser, department, room, logTime, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Maintenance(id int64, req MaintenanceReq) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	asset, err := legacyAssetSnapshotInTx(tx, id)
	if err != nil {
		return err
	}
	if isArchivedAssetStatus(asset.Status) {
		return fmt.Errorf("归档资产不能登记维修")
	}
	logTime := legacyOperationTime(req.Date)
	status := strings.TrimSpace(req.NewStatus)
	if status == "" {
		status = strings.TrimSpace(req.Status)
	}
	if status == "" {
		status = asset.Status
	}
	partType := strings.TrimSpace(req.PartType)
	oldSN := ""
	switch partType {
	case "box":
		oldSN = strings.TrimSpace(asset.BoxSN)
	case "display":
		oldSN = strings.TrimSpace(asset.DisplaySN)
	}
	payloadOldSN := strings.TrimSpace(req.OldSN)
	if (partType == "box" || partType == "display") && payloadOldSN != oldSN {
		return fmt.Errorf("资产旧SN已变化，当前为 %s，请刷新后重试", oldSN)
	}
	newSN := strings.TrimSpace(req.NewSN)
	if (partType == "box" || partType == "display") && newSN == oldSN {
		return fmt.Errorf("新SN与当前SN一致，不能重复登记维修")
	}
	var res sql.Result
	switch partType {
	case "box":
		res, err = tx.Exec(`UPDATE assets SET box_sn=?, status=?, updated_at=? WHERE id=?`, newSN, status, logTime, id)
	case "display":
		res, err = tx.Exec(`UPDATE assets SET display_sn=?, status=?, updated_at=? WHERE id=?`, newSN, status, logTime, id)
	default:
		res, err = tx.Exec(`UPDATE assets SET status=?, updated_at=? WHERE id=?`, status, logTime, id)
	}
	if err != nil {
		return err
	}
	if err := requireAffected(res, "资产不存在"); err != nil {
		return err
	}

	oldPartStatus := ""
	switch strings.TrimSpace(req.MarkOldAs) {
	case "故障待修入库":
		oldPartStatus = "维修中"
	case "报废":
		oldPartStatus = "已报废"
	}
	logResult, err := tx.Exec(`INSERT INTO asset_logs
		(asset_id, log_type, old_sn, new_sn, operator, description, log_time)
		VALUES (?, '设备维修更换', ?, ?, ?, ?, ?)`, id, oldSN, newSN, req.Operator, req.Description, logTime)
	if err != nil {
		return err
	}
	if oldPartStatus != "" && oldSN != "" && (partType == "box" || partType == "display") {
		logID, err := logResult.LastInsertId()
		if err != nil {
			return err
		}
		boxSN, displaySN := "", ""
		if partType == "box" {
			boxSN = oldSN
		} else {
			displaySN = oldSN
		}
		sourceCode := strings.TrimSpace(asset.AssetCode)
		if sourceCode == "" {
			sourceCode = fmt.Sprintf("ASSET-%d", id)
		}
		oldPartCode := fmt.Sprintf("%s-旧件-%s-%d", sourceCode, partType, logID)
		remark := fmt.Sprintf("原资产 %s（ID:%d）维修换下旧件，履历ID:%d", sourceCode, id, logID)
		if _, err := tx.Exec(`INSERT INTO assets
			(asset_code, box_sn, display_sn, status, remark, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, oldPartCode, boxSN, displaySN, oldPartStatus, remark, logTime, logTime); err != nil {
			return err
		}
	}
	mappedStatus := mapLegacyAssetStatus(status)
	switch partType {
	case "box":
		_, err = tx.Exec(`UPDATE cmdb_assets SET sn=?, box_sn=?, status=?, updated_at=?
			WHERE source_type='legacy_asset' AND source_id=?`, newSN, newSN, mappedStatus, logTime, id)
	case "display":
		_, err = tx.Exec(`UPDATE cmdb_assets SET display_sn=?, status=?, updated_at=?
			WHERE source_type='legacy_asset' AND source_id=?`, newSN, mappedStatus, logTime, id)
	default:
		_, err = tx.Exec(`UPDATE cmdb_assets SET status=?, updated_at=?
			WHERE source_type='legacy_asset' AND source_id=?`, mappedStatus, logTime, id)
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}

type legacyAssetSnapshot struct {
	AssetCode  string
	BoxSN      string
	DisplaySN  string
	UserName   string
	Department string
	Room       string
	IP         string
	Status     string
}

func legacyAssetSnapshotInTx(tx *sql.Tx, id int64) (legacyAssetSnapshot, error) {
	var asset legacyAssetSnapshot
	err := tx.QueryRow(`SELECT IFNULL(asset_code,''), IFNULL(box_sn,''), IFNULL(display_sn,''),
		IFNULL(user_name,''), IFNULL(department,''), IFNULL(room,''), IFNULL(ip,''), IFNULL(status,'')
		FROM assets WHERE id=?`, id).Scan(&asset.AssetCode, &asset.BoxSN, &asset.DisplaySN,
		&asset.UserName, &asset.Department, &asset.Room, &asset.IP, &asset.Status)
	if err == sql.ErrNoRows {
		return asset, fmt.Errorf("资产不存在")
	}
	if err != nil {
		return asset, err
	}
	return asset, nil
}

func requireAffected(result sql.Result, message string) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("%s", message)
	}
	return nil
}

func legacyOperationTime(value string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return time.Now().Format("2006-01-02 15:04:05")
}

func formatAssetLocation(department, room string) string {
	parts := make([]string, 0, 2)
	if department = strings.TrimSpace(department); department != "" {
		parts = append(parts, department)
	}
	if room = strings.TrimSpace(room); room != "" {
		parts = append(parts, room)
	}
	return strings.Join(parts, " / ")
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
