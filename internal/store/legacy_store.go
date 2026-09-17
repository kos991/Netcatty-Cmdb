package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Legacy Store CRUD operations

func (s *Store) AllAssets() ([]Asset, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.AllAssetsForProject(scope)
}

func (s *Store) AllAssetsForProject(scope ProjectScope) ([]Asset, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT id, project_id, IFNULL(asset_code,''), IFNULL(box_sn,''), IFNULL(display_sn,''), IFNULL(user_name,''), IFNULL(department,''), IFNULL(room,''), IFNULL(ip,''), IFNULL(terminal_ip,''), IFNULL(security_software,''), IFNULL(status,''), IFNULL(net_type,''), IFNULL(remark,''), IFNULL(created_at,''), IFNULL(updated_at,'') FROM assets WHERE project_id=? ORDER BY id DESC`, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Asset
	for rows.Next() {
		var a Asset
		if err := rows.Scan(&a.ID, &a.ProjectID, &a.AssetCode, &a.BoxSN, &a.DisplaySN, &a.UserName, &a.Department, &a.Room, &a.IP, &a.TerminalIP, &a.SecuritySoftware, &a.Status, &a.NetType, &a.Remark, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, nil
}

func (s *Store) AllAssetsFiltered(kw, dept, status, secSoft string, includeArchived bool) ([]Asset, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.AllAssetsFilteredForProject(scope, kw, dept, status, secSoft, includeArchived)
}

func (s *Store) AllAssetsFilteredForProject(scope ProjectScope, kw, dept, status, secSoft string, includeArchived bool) ([]Asset, error) {
	assets, err := s.AllAssetsForProject(scope)
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
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, 0, err
	}
	return s.QueryAssetsWithArchivedForProject(scope, kw, dept, status, secSoft, page, pageSize, includeArchived)
}

func (s *Store) QueryAssetsWithArchivedForProject(scope ProjectScope, kw, dept, status, secSoft string, page, pageSize int, includeArchived bool) ([]Asset, int, error) {
	assets, err := s.AllAssetsForProject(scope)
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
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.AssetStatusSummaryForProject(scope, kw, dept, secSoft, includeArchived)
}

func (s *Store) AssetStatusSummaryForProject(scope ProjectScope, kw, dept, secSoft string, includeArchived bool) (map[string]int, error) {
	assets, err := s.AllAssetsForProject(scope)
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
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, nil, err
	}
	return s.GetAssetForProject(scope, id)
}

func (s *Store) GetAssetForProject(scope ProjectScope, id int64) (*Asset, []AssetLog, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, nil, err
	}
	var a Asset
	err := s.db.QueryRow(`SELECT id, project_id, IFNULL(asset_code,''), IFNULL(box_sn,''), IFNULL(display_sn,''), IFNULL(user_name,''), IFNULL(department,''), IFNULL(room,''), IFNULL(ip,''), IFNULL(terminal_ip,''), IFNULL(security_software,''), IFNULL(status,''), IFNULL(net_type,''), IFNULL(remark,''), IFNULL(created_at,''), IFNULL(updated_at,'') FROM assets WHERE id = ? AND project_id=?`, id, scope.ProjectID).Scan(
		&a.ID, &a.ProjectID, &a.AssetCode, &a.BoxSN, &a.DisplaySN, &a.UserName, &a.Department, &a.Room, &a.IP, &a.TerminalIP, &a.SecuritySoftware, &a.Status, &a.NetType, &a.Remark, &a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil, errors.Join(ErrProjectScopedNotFound, sql.ErrNoRows)
		}
		return nil, nil, err
	}
	rows, err := s.db.Query(`SELECT id, project_id, asset_id, IFNULL(log_type,''), IFNULL(from_user,''), IFNULL(to_user,''),
		IFNULL(from_location,''), IFNULL(to_location,''), IFNULL(old_sn,''), IFNULL(new_sn,''),
		IFNULL(operator,''), IFNULL(description,''), IFNULL(log_time,'')
		FROM asset_logs WHERE asset_id = ? AND project_id=? ORDER BY log_time DESC, id DESC`, id, scope.ProjectID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	logs := make([]AssetLog, 0)
	for rows.Next() {
		var log AssetLog
		if err := rows.Scan(&log.ID, &log.ProjectID, &log.AssetID, &log.LogType, &log.FromUser, &log.ToUser,
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
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.GetAssetRelationsForProject(scope, id)
}

func (s *Store) GetAssetRelationsForProject(scope ProjectScope, id int64) (map[string]interface{}, error) {
	asset, _, err := s.GetAssetForProject(scope, id)
	if err != nil {
		return nil, err
	}

	ips := make([]IPEntry, 0)
	rows, err := s.db.Query(`SELECT id, IFNULL(subnet,''), IFNULL(ip,''), IFNULL(department,''),
		IFNULL(room,''), IFNULL(account,''), IFNULL(status,''), IFNULL(remark,'')
		FROM ip_pool
		WHERE project_id=? AND ((? <> '' AND ip = ?) OR (? <> '' AND ip = ?))
		ORDER BY id`, scope.ProjectID, asset.IP, asset.IP, asset.TerminalIP, asset.TerminalIP)
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
		WHERE project_id=? AND ((? <> '' AND (mgmt_ip = ? OR biz_ip = ?)) OR (? <> '' AND (mgmt_ip = ? OR biz_ip = ?)))
		ORDER BY id`, scope.ProjectID, asset.IP, asset.IP, asset.IP, asset.TerminalIP, asset.TerminalIP, asset.TerminalIP)
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
		IFNULL(app.port,''), IFNULL(app.access_url,''), IFNULL(app.middleware,''), IFNULL(app.database_info,''),
		IFNULL(app.owner,''), IFNULL(app.status,''), IFNULL(app.remark,''), IFNULL(app.created_at,''), IFNULL(app.updated_at,'')
		FROM server_apps app JOIN servers server ON server.id = app.server_id
		WHERE app.project_id=? AND server.project_id=? AND ((? <> '' AND (server.mgmt_ip = ? OR server.biz_ip = ?)) OR (? <> '' AND (server.mgmt_ip = ? OR server.biz_ip = ?)))
		ORDER BY app.id`, scope.ProjectID, scope.ProjectID, asset.IP, asset.IP, asset.IP, asset.TerminalIP, asset.TerminalIP, asset.TerminalIP)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var app ServerApp
		if err := scanServerApp(rows, &app); err != nil {
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
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.CreateAssetForProject(scope, a, operator)
}

func (s *Store) CreateAssetForProject(scope ProjectScope, a *Asset, operator string) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if a == nil {
		return 0, fmt.Errorf("资产信息不能为空")
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := s.db.Exec(`INSERT INTO assets (project_id, asset_code, box_sn, display_sn, user_name, department, room, ip, terminal_ip, security_software, status, net_type, remark, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		scope.ProjectID, a.AssetCode, a.BoxSN, a.DisplaySN, a.UserName, a.Department, a.Room, a.IP, a.TerminalIP, a.SecuritySoftware, a.Status, a.NetType, a.Remark, now, now,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) UpdateAsset(a *Asset, operator string) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.UpdateAssetForProject(scope, a, operator)
}

func (s *Store) UpdateAssetForProject(scope ProjectScope, a *Asset, operator string) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	if a == nil {
		return fmt.Errorf("资产信息不能为空")
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := s.db.Exec(`UPDATE assets SET asset_code=?, box_sn=?, display_sn=?, user_name=?, department=?, room=?, ip=?, terminal_ip=?, security_software=?, status=?, net_type=?, remark=?, updated_at=? WHERE id=? AND project_id=?`,
		a.AssetCode, a.BoxSN, a.DisplaySN, a.UserName, a.Department, a.Room, a.IP, a.TerminalIP, a.SecuritySoftware, a.Status, a.NetType, a.Remark, now, a.ID, scope.ProjectID,
	)
	if err != nil {
		return err
	}
	return requireAffected(res, "资产不存在")
}

func (s *Store) DeleteAsset(id int64, reason, operator string) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.DeleteAssetForProject(scope, id, reason, operator)
}

func (s *Store) DeleteAssetForProject(scope ProjectScope, id int64, reason, operator string) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	asset, err := legacyAssetSnapshotInTx(tx, id, scope.ProjectID)
	if err != nil {
		return err
	}
	if isArchivedAssetStatus(asset.Status) {
		return fmt.Errorf("资产已归档，不能重复注销")
	}
	now := legacyOperationTime("")
	res, err := tx.Exec(`UPDATE assets SET status='已报废', updated_at=? WHERE id=? AND project_id=?`, now, id, scope.ProjectID)
	if err != nil {
		return err
	}
	if err := requireAffected(res, "资产不存在"); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO asset_logs
		(project_id, asset_id, log_type, from_user, from_location, operator, description, log_time)
		VALUES (?, ?, '设备回收注销', ?, ?, ?, ?, ?)`,
		scope.ProjectID, id, asset.UserName, formatAssetLocation(asset.Department, asset.Room), operator, reason, now); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE cmdb_assets SET status='报废', updated_at=? WHERE project_id=? AND source_type='legacy_asset' AND source_id=?`, now, scope.ProjectID, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) TransferUser(id int64, req TransferReq) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.TransferUserForProject(scope, id, req)
}

func (s *Store) TransferUserForProject(scope ProjectScope, id int64, req TransferReq) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	toUser := strings.TrimSpace(req.ToUser)
	if toUser == "" {
		return fmt.Errorf("新使用人姓名不能为空")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	asset, err := legacyAssetSnapshotInTx(tx, id, scope.ProjectID)
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
	res, err := tx.Exec(`UPDATE assets SET user_name=?, department=?, room=?, ip=?, updated_at=? WHERE id=? AND project_id=?`,
		toUser, department, room, ip, logTime, id, scope.ProjectID)
	if err != nil {
		return err
	}
	if err := requireAffected(res, "资产不存在"); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO asset_logs
		(project_id, asset_id, log_type, from_user, to_user, from_location, to_location, operator, description, log_time)
		VALUES (?, ?, '调换使用人', ?, ?, ?, ?, ?, ?, ?)`, scope.ProjectID, id, asset.UserName, toUser,
		formatAssetLocation(asset.Department, asset.Room), formatAssetLocation(department, room), req.Operator, description, logTime); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE cmdb_assets SET owner=?, department=?, room=?, updated_at=?
		WHERE project_id=? AND source_type='legacy_asset' AND source_id=?`, toUser, department, room, logTime, scope.ProjectID, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Maintenance(id int64, req MaintenanceReq) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.MaintenanceForProject(scope, id, req)
}

func (s *Store) MaintenanceForProject(scope ProjectScope, id int64, req MaintenanceReq) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	asset, err := legacyAssetSnapshotInTx(tx, id, scope.ProjectID)
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
		res, err = tx.Exec(`UPDATE assets SET box_sn=?, status=?, updated_at=? WHERE id=? AND project_id=?`, newSN, status, logTime, id, scope.ProjectID)
	case "display":
		res, err = tx.Exec(`UPDATE assets SET display_sn=?, status=?, updated_at=? WHERE id=? AND project_id=?`, newSN, status, logTime, id, scope.ProjectID)
	default:
		res, err = tx.Exec(`UPDATE assets SET status=?, updated_at=? WHERE id=? AND project_id=?`, status, logTime, id, scope.ProjectID)
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
		(project_id, asset_id, log_type, old_sn, new_sn, operator, description, log_time)
		VALUES (?, ?, '设备维修更换', ?, ?, ?, ?, ?)`, scope.ProjectID, id, oldSN, newSN, req.Operator, req.Description, logTime)
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
			(project_id, asset_code, box_sn, display_sn, status, remark, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, scope.ProjectID, oldPartCode, boxSN, displaySN, oldPartStatus, remark, logTime, logTime); err != nil {
			return err
		}
	}
	mappedStatus := mapLegacyAssetStatus(status)
	switch partType {
	case "box":
		_, err = tx.Exec(`UPDATE cmdb_assets SET sn=?, box_sn=?, status=?, updated_at=?
			WHERE project_id=? AND source_type='legacy_asset' AND source_id=?`, newSN, newSN, mappedStatus, logTime, scope.ProjectID, id)
	case "display":
		_, err = tx.Exec(`UPDATE cmdb_assets SET display_sn=?, status=?, updated_at=?
			WHERE project_id=? AND source_type='legacy_asset' AND source_id=?`, newSN, mappedStatus, logTime, scope.ProjectID, id)
	default:
		_, err = tx.Exec(`UPDATE cmdb_assets SET status=?, updated_at=?
			WHERE project_id=? AND source_type='legacy_asset' AND source_id=?`, mappedStatus, logTime, scope.ProjectID, id)
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

func legacyAssetSnapshotInTx(tx *sql.Tx, id, projectID int64) (legacyAssetSnapshot, error) {
	var asset legacyAssetSnapshot
	err := tx.QueryRow(`SELECT IFNULL(asset_code,''), IFNULL(box_sn,''), IFNULL(display_sn,''),
		IFNULL(user_name,''), IFNULL(department,''), IFNULL(room,''), IFNULL(ip,''), IFNULL(status,'')
		FROM assets WHERE id=? AND project_id=?`, id, projectID).Scan(&asset.AssetCode, &asset.BoxSN, &asset.DisplaySN,
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
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, 0, err
	}
	return s.QueryServersForProject(scope, kw, loc, status, page, pageSize)
}

func (s *Store) QueryServersForProject(scope ProjectScope, kw, loc, status string, page, pageSize int) ([]PhysicalServer, int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, 0, err
	}
	page, pageSize = normalizeLegacyPage(page, pageSize)
	where := []string{"project_id=?"}
	args := []interface{}{scope.ProjectID}
	if kw = strings.TrimSpace(kw); kw != "" {
		pattern := "%" + kw + "%"
		where = append(where, `(asset_code LIKE ? OR device_name LIKE ? OR brand_model LIKE ? OR serial_number LIKE ?
			OR mgmt_ip LIKE ? OR biz_ip LIKE ? OR admin_user LIKE ?)`)
		for i := 0; i < 7; i++ {
			args = append(args, pattern)
		}
	}
	if loc = strings.TrimSpace(loc); loc != "" {
		where = append(where, "location = ?")
		args = append(args, loc)
	}
	if status = strings.TrimSpace(status); status != "" {
		where = append(where, "status = ?")
		args = append(args, status)
	}
	whereSQL := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM servers WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	queryArgs := append(append([]interface{}{}, args...), pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(`SELECT id, project_id, IFNULL(asset_code,''), IFNULL(device_name,''), IFNULL(brand_model,''),
		IFNULL(serial_number,''), IFNULL(location,''), IFNULL(rack_unit,''), IFNULL(cpu_info,''),
		IFNULL(memory_info,''), IFNULL(disk_info,''), IFNULL(mgmt_ip,''), IFNULL(mgmt_url,''),
		IFNULL(biz_ip,''), IFNULL(os_type,''), IFNULL(admin_user,''), IFNULL(status,''),
		IFNULL(purchase_date,''), IFNULL(warranty_date,''), IFNULL(remark,''), IFNULL(created_at,''), IFNULL(updated_at,'')
		FROM servers WHERE `+whereSQL+` ORDER BY id DESC LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	list := make([]PhysicalServer, 0)
	for rows.Next() {
		var server PhysicalServer
		if err := rows.Scan(&server.ID, &server.ProjectID, &server.AssetCode, &server.DeviceName, &server.BrandModel, &server.SerialNumber,
			&server.Location, &server.RackUnit, &server.CPUInfo, &server.MemoryInfo, &server.DiskInfo, &server.MgmtIP,
			&server.MgmtURL, &server.BizIP, &server.OSType, &server.AdminUser, &server.Status, &server.PurchaseDate,
			&server.WarrantyDate, &server.Remark, &server.CreatedAt, &server.UpdatedAt); err != nil {
			return nil, 0, err
		}
		list = append(list, server)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

func (s *Store) GetServer(id int64) (*PhysicalServer, []ServerApp, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, nil, err
	}
	return s.GetServerForProject(scope, id)
}

func (s *Store) GetServerForProject(scope ProjectScope, id int64) (*PhysicalServer, []ServerApp, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, nil, err
	}
	var srv PhysicalServer
	err := s.db.QueryRow(`SELECT id, project_id, IFNULL(asset_code,''), IFNULL(device_name,''), IFNULL(brand_model,''), IFNULL(serial_number,''), IFNULL(location,''), IFNULL(rack_unit,''), IFNULL(cpu_info,''), IFNULL(memory_info,''), IFNULL(disk_info,''), IFNULL(mgmt_ip,''), IFNULL(mgmt_url,''), IFNULL(biz_ip,''), IFNULL(os_type,''), IFNULL(admin_user,''), IFNULL(status,''), IFNULL(purchase_date,''), IFNULL(warranty_date,''), IFNULL(remark,''), IFNULL(created_at,''), IFNULL(updated_at,'') FROM servers WHERE id = ? AND project_id=?`, id, scope.ProjectID).Scan(
		&srv.ID, &srv.ProjectID, &srv.AssetCode, &srv.DeviceName, &srv.BrandModel, &srv.SerialNumber, &srv.Location, &srv.RackUnit, &srv.CPUInfo, &srv.MemoryInfo, &srv.DiskInfo, &srv.MgmtIP, &srv.MgmtURL, &srv.BizIP, &srv.OSType, &srv.AdminUser, &srv.Status, &srv.PurchaseDate, &srv.WarrantyDate, &srv.Remark, &srv.CreatedAt, &srv.UpdatedAt,
	)
	if err != nil {
		return nil, nil, err
	}
	apps, err := s.GetAppsByServerIDForProject(scope, id)
	if err != nil {
		return nil, nil, err
	}
	return &srv, apps, nil
}

func (s *Store) CreateServer(srv *PhysicalServer, operator string) (int64, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.CreateServerForProject(scope, srv, operator)
}

func (s *Store) CreateServerForProject(scope ProjectScope, srv *PhysicalServer, operator string) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if srv == nil {
		return 0, fmt.Errorf("服务器信息不能为空")
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := s.db.Exec(`INSERT INTO servers (project_id, asset_code, device_name, brand_model, serial_number, location, rack_unit, cpu_info, memory_info, disk_info, mgmt_ip, mgmt_url, biz_ip, os_type, admin_user, status, purchase_date, warranty_date, remark, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		scope.ProjectID, srv.AssetCode, srv.DeviceName, srv.BrandModel, srv.SerialNumber, srv.Location, srv.RackUnit, srv.CPUInfo, srv.MemoryInfo, srv.DiskInfo, srv.MgmtIP, srv.MgmtURL, srv.BizIP, srv.OSType, srv.AdminUser, srv.Status, srv.PurchaseDate, srv.WarrantyDate, srv.Remark, now, now,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) UpdateServer(srv *PhysicalServer, operator string) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.UpdateServerForProject(scope, srv, operator)
}

func (s *Store) UpdateServerForProject(scope ProjectScope, srv *PhysicalServer, operator string) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	if srv == nil {
		return fmt.Errorf("服务器信息不能为空")
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	result, err := s.db.Exec(`UPDATE servers SET asset_code=?, device_name=?, brand_model=?, serial_number=?, location=?, rack_unit=?, cpu_info=?, memory_info=?, disk_info=?, mgmt_ip=?, mgmt_url=?, biz_ip=?, os_type=?, admin_user=?, status=?, purchase_date=?, warranty_date=?, remark=?, updated_at=? WHERE id=? AND project_id=?`,
		srv.AssetCode, srv.DeviceName, srv.BrandModel, srv.SerialNumber, srv.Location, srv.RackUnit, srv.CPUInfo, srv.MemoryInfo, srv.DiskInfo, srv.MgmtIP, srv.MgmtURL, srv.BizIP, srv.OSType, srv.AdminUser, srv.Status, srv.PurchaseDate, srv.WarrantyDate, srv.Remark, now, srv.ID, scope.ProjectID,
	)
	if err != nil {
		return err
	}
	return requireAffected(result, "服务器不存在")
}

func (s *Store) DeleteServer(id int64) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.DeleteServerForProject(scope, id)
}

func (s *Store) DeleteServerForProject(scope ProjectScope, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM server_apps WHERE server_id = ? AND project_id=?`, id, scope.ProjectID); err != nil {
		return err
	}
	result, err := tx.Exec(`DELETE FROM servers WHERE id = ? AND project_id=?`, id, scope.ProjectID)
	if err != nil {
		return err
	}
	if err := requireAffected(result, "服务器不存在"); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) GetAppsByServerID(id int64) ([]ServerApp, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.GetAppsByServerIDForProject(scope, id)
}

func (s *Store) GetAppsByServerIDForProject(scope ProjectScope, id int64) ([]ServerApp, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	var exists int
	if err := s.db.QueryRow(`SELECT 1 FROM servers WHERE id = ? AND project_id=?`, id, scope.ProjectID).Scan(&exists); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT id, project_id, server_id, IFNULL(app_name,''), IFNULL(app_type,''),
		IFNULL(port,''), IFNULL(access_url,''), IFNULL(middleware,''), IFNULL(database_info,''),
		IFNULL(owner,''), IFNULL(status,''), IFNULL(remark,''), IFNULL(created_at,''), IFNULL(updated_at,'')
		FROM server_apps WHERE server_id = ? AND project_id=? ORDER BY id DESC`, id, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	apps := make([]ServerApp, 0)
	for rows.Next() {
		var app ServerApp
		if err := scanServerAppForProject(rows, &app); err != nil {
			return nil, err
		}
		apps = append(apps, app)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return apps, nil
}

func (s *Store) CreateApp(app *ServerApp) (int64, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.CreateAppForProject(scope, app)
}

func (s *Store) CreateAppForProject(scope ProjectScope, app *ServerApp) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if app == nil {
		return 0, fmt.Errorf("应用信息不能为空")
	}
	app.AppName = strings.TrimSpace(app.AppName)
	if app.AppName == "" {
		return 0, fmt.Errorf("应用名称不能为空")
	}
	var exists int
	if err := s.db.QueryRow(`SELECT 1 FROM servers WHERE id = ? AND project_id=?`, app.ServerID, scope.ProjectID).Scan(&exists); err != nil {
		return 0, err
	}
	applyLegacyServerAppFallbacks(app)
	now := time.Now().Format("2006-01-02 15:04:05")
	result, err := s.db.Exec(`INSERT INTO server_apps
		(project_id, server_id, app_name, app_type, port, access_url, middleware, database_info, owner, status, remark, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, scope.ProjectID, app.ServerID, app.AppName, app.AppType, app.Port,
		app.AccessURL, app.Middleware, app.DatabaseInfo, app.Owner, app.Status, app.Remark, now, now)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (s *Store) UpdateApp(app *ServerApp) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.UpdateAppForProject(scope, app)
}

func (s *Store) UpdateAppForProject(scope ProjectScope, app *ServerApp) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	if app == nil {
		return fmt.Errorf("应用信息不能为空")
	}
	app.AppName = strings.TrimSpace(app.AppName)
	if app.AppName == "" {
		return fmt.Errorf("应用名称不能为空")
	}
	applyLegacyServerAppFallbacks(app)
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if app.ServerID != 0 {
		var exists int
		if err := tx.QueryRow(`SELECT 1 FROM servers WHERE id = ? AND project_id=?`, app.ServerID, scope.ProjectID).Scan(&exists); err != nil {
			return err
		}
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	result, err := tx.Exec(`UPDATE server_apps SET server_id=CASE WHEN ?=0 THEN server_id ELSE ? END,
		app_name=?, app_type=?, port=?, access_url=?, middleware=?, database_info=?, owner=?, status=?, remark=?, updated_at=?
		WHERE id=? AND project_id=?`, app.ServerID, app.ServerID, app.AppName, app.AppType, app.Port, app.AccessURL, app.Middleware,
		app.DatabaseInfo, app.Owner, app.Status, app.Remark, now, app.ID, scope.ProjectID)
	if err != nil {
		return err
	}
	if err := requireAffected(result, "应用不存在"); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeleteApp(id int64) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.DeleteAppForProject(scope, id)
}

func (s *Store) DeleteAppForProject(scope ProjectScope, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	result, err := s.db.Exec(`DELETE FROM server_apps WHERE id = ? AND project_id=?`, id, scope.ProjectID)
	if err != nil {
		return err
	}
	return requireAffected(result, "应用不存在")
}

func (s *Store) QueryAllApps(kw, appType, status string, page, pageSize int) ([]ServerApp, int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, 0, err
	}
	return s.QueryAllAppsForProject(scope, kw, appType, status, page, pageSize)
}

func (s *Store) QueryAllAppsForProject(scope ProjectScope, kw, appType, status string, page, pageSize int) ([]ServerApp, int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, 0, err
	}
	page, pageSize = normalizeLegacyPage(page, pageSize)
	where := []string{"app.project_id=?", "server.project_id=?"}
	args := []interface{}{scope.ProjectID, scope.ProjectID}
	if kw = strings.TrimSpace(kw); kw != "" {
		pattern := "%" + kw + "%"
		where = append(where, `(app.app_name LIKE ? OR app.app_type LIKE ? OR app.access_url LIKE ?
			OR app.middleware LIKE ? OR app.database_info LIKE ? OR app.owner LIKE ? OR app.remark LIKE ?)`)
		for i := 0; i < 7; i++ {
			args = append(args, pattern)
		}
	}
	if appType = strings.TrimSpace(appType); appType != "" {
		where = append(where, "app.app_type = ?")
		args = append(args, appType)
	}
	if status = strings.TrimSpace(status); status != "" {
		where = append(where, "app.status = ?")
		args = append(args, status)
	}
	whereSQL := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM server_apps app JOIN servers server ON server.id=app.server_id WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	queryArgs := append(append([]interface{}{}, args...), pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(`SELECT app.id, app.project_id, app.server_id, IFNULL(app.app_name,''), IFNULL(app.app_type,''),
		IFNULL(app.port,''), IFNULL(app.access_url,''), IFNULL(app.middleware,''), IFNULL(app.database_info,''),
		IFNULL(app.owner,''), IFNULL(app.status,''), IFNULL(app.remark,''), IFNULL(app.created_at,''), IFNULL(app.updated_at,''),
		IFNULL(server.device_name,''), IFNULL(server.biz_ip,'')
		FROM server_apps app JOIN servers server ON server.id = app.server_id
		WHERE `+whereSQL+` ORDER BY app.id DESC LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	apps := make([]ServerApp, 0)
	for rows.Next() {
		var app ServerApp
		if err := rows.Scan(&app.ID, &app.ProjectID, &app.ServerID, &app.AppName, &app.AppType, &app.Port, &app.AccessURL,
			&app.Middleware, &app.DatabaseInfo, &app.Owner, &app.Status, &app.Remark, &app.CreatedAt,
			&app.UpdatedAt, &app.ServerName, &app.ServerBizIP); err != nil {
			return nil, 0, err
		}
		setLegacyServerAppFields(&app)
		apps = append(apps, app)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return apps, total, nil
}

func (s *Store) QueryLogs(assetID int64, logType, kw string, page, pageSize int) ([]AssetLog, int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, 0, err
	}
	return s.QueryLogsForProject(scope, assetID, logType, kw, page, pageSize)
}

func (s *Store) QueryLogsForProject(scope ProjectScope, assetID int64, logType, kw string, page, pageSize int) ([]AssetLog, int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, 0, err
	}
	page, pageSize = normalizeLegacyPage(page, pageSize)
	where := []string{"project_id=?"}
	args := []interface{}{scope.ProjectID}
	if assetID > 0 {
		where = append(where, "asset_id = ?")
		args = append(args, assetID)
	}
	if logType = strings.TrimSpace(logType); logType != "" {
		where = append(where, "log_type = ?")
		args = append(args, logType)
	}
	if kw = strings.TrimSpace(kw); kw != "" {
		pattern := "%" + kw + "%"
		where = append(where, `(description LIKE ? OR operator LIKE ? OR from_user LIKE ? OR to_user LIKE ?
			OR from_location LIKE ? OR to_location LIKE ? OR old_sn LIKE ? OR new_sn LIKE ?)`)
		for i := 0; i < 8; i++ {
			args = append(args, pattern)
		}
	}
	whereSQL := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM asset_logs WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	queryArgs := append(append([]interface{}{}, args...), pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(`SELECT id, project_id, asset_id, IFNULL(log_type,''), IFNULL(from_user,''), IFNULL(to_user,''),
		IFNULL(from_location,''), IFNULL(to_location,''), IFNULL(old_sn,''), IFNULL(new_sn,''),
		IFNULL(operator,''), IFNULL(description,''), IFNULL(log_time,'')
		FROM asset_logs WHERE `+whereSQL+` ORDER BY log_time DESC, id DESC LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	logs := make([]AssetLog, 0)
	for rows.Next() {
		var log AssetLog
		if err := rows.Scan(&log.ID, &log.ProjectID, &log.AssetID, &log.LogType, &log.FromUser, &log.ToUser,
			&log.FromLocation, &log.ToLocation, &log.OldSN, &log.NewSN, &log.Operator,
			&log.Description, &log.LogTime); err != nil {
			return nil, 0, err
		}
		logs = append(logs, log)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return logs, total, nil
}

func normalizeLegacyPage(page, pageSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 20
	}
	return page, pageSize
}

func scanServerApp(scanner interface{ Scan(...interface{}) error }, app *ServerApp) error {
	if err := scanner.Scan(&app.ID, &app.ServerID, &app.AppName, &app.AppType, &app.Port, &app.AccessURL,
		&app.Middleware, &app.DatabaseInfo, &app.Owner, &app.Status, &app.Remark, &app.CreatedAt, &app.UpdatedAt); err != nil {
		return err
	}
	setLegacyServerAppFields(app)
	return nil
}

func scanServerAppForProject(scanner interface{ Scan(...interface{}) error }, app *ServerApp) error {
	if err := scanner.Scan(&app.ID, &app.ProjectID, &app.ServerID, &app.AppName, &app.AppType, &app.Port, &app.AccessURL,
		&app.Middleware, &app.DatabaseInfo, &app.Owner, &app.Status, &app.Remark, &app.CreatedAt, &app.UpdatedAt); err != nil {
		return err
	}
	setLegacyServerAppFields(app)
	return nil
}

func applyLegacyServerAppFallbacks(app *ServerApp) {
	if app.Middleware == "" {
		app.Middleware = app.Version
	}
	if app.Remark == "" {
		app.Remark = app.Description
	}
}

func setLegacyServerAppFields(app *ServerApp) {
	app.Version = app.Middleware
	app.Description = app.Remark
}

func (s *Store) GlobalSearch(q string, limit int) ([]SearchResult, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.GlobalSearchForProject(scope, q, limit)
}

func (s *Store) GlobalSearchForProject(scope ProjectScope, q string, limit int) ([]SearchResult, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	// 保持已有六组查询的呈现结构，项目条件必须位于每张业务表的 WHERE 中。
	return s.globalSearchForProject(scope, q, limit)
}

func (s *Store) globalSearchForProject(scope ProjectScope, q string, limit int) ([]SearchResult, error) {
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

	if err := query(`SELECT id, project_id, IFNULL(user_name,''), IFNULL(department,''), IFNULL(room,''), IFNULL(ip,''), IFNULL(status,''), IFNULL(asset_code,'')
		FROM assets WHERE project_id=? AND (user_name LIKE ? OR asset_code LIKE ? OR box_sn LIKE ? OR display_sn LIKE ? OR ip LIKE ? OR terminal_ip LIKE ? OR department LIKE ? OR room LIKE ?) LIMIT ?`,
		[]interface{}{scope.ProjectID, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, limit}, func(item *SearchResult, row interface{ Scan(...interface{}) error }) error {
			var room, assetCode string
			if err := row.Scan(&item.ID, &item.ProjectID, &item.Title, &item.Department, &room, &item.IP, &item.Status, &assetCode); err != nil {
				return err
			}
			item.Type, item.Group, item.TableKey = "terminal", searchGroups["terminal"].Group, searchGroups["terminal"].TableKey
			item.Subtitle, item.Tag, item.Extra = room, "云桌面终端", assetCode
			item.Data = map[string]interface{}{"资产编号": assetCode, "房间": room}
			return nil
		}); err != nil {
		return nil, err
	}

	if err := query(`SELECT a.id, a.project_id, a.name, COALESCE(NULLIF(a.manage_ip,''), a.mgmt_ip, ''), IFNULL(a.department,''), IFNULL(a.status,''), IFNULL(c.name,''), IFNULL(a.asset_code,'')
		FROM cmdb_assets a LEFT JOIN cmdb_device_categories c ON c.id = a.category_id
		WHERE a.project_id=? AND (a.name LIKE ? OR a.asset_code LIKE ? OR a.sn LIKE ? OR a.mgmt_ip LIKE ? OR a.manage_ip LIKE ? OR a.owner LIKE ? OR a.department LIKE ?)
		AND (a.source_type = 'legacy_server'
			OR lower(IFNULL(a.device_type,'')) IN ('server','physical_server','virtual_machine','switch','router','security_device','storage')
			OR EXISTS (SELECT 1 FROM cmdb_device_categories scope_category WHERE scope_category.id = a.category_id
				AND (scope_category.name LIKE '%服务器%' OR scope_category.name LIKE '%虚拟机%' OR scope_category.name LIKE '%交换机%' OR scope_category.name LIKE '%路由器%' OR scope_category.name LIKE '%安全设备%' OR scope_category.name LIKE '%存储设备%')))
		LIMIT ?`,
		[]interface{}{scope.ProjectID, pattern, pattern, pattern, pattern, pattern, pattern, pattern, limit}, func(item *SearchResult, row interface{ Scan(...interface{}) error }) error {
			var category, assetCode string
			if err := row.Scan(&item.ID, &item.ProjectID, &item.Title, &item.IP, &item.Department, &item.Status, &category, &assetCode); err != nil {
				return err
			}
			item.Type, item.Group, item.TableKey = "infrastructure", searchGroups["infrastructure"].Group, searchGroups["infrastructure"].TableKey
			item.Subtitle, item.Tag, item.Extra = category, category, assetCode
			item.Data = map[string]interface{}{"资产编号": assetCode, "设备分类": category}
			return nil
		}); err != nil {
		return nil, err
	}

	if err := query(`SELECT id, project_id, IFNULL(app_name,''), IFNULL(app_type,''), IFNULL(access_url,''), IFNULL(status,''), IFNULL(remark,'')
		FROM server_apps WHERE project_id=? AND (app_name LIKE ? OR app_type LIKE ? OR access_url LIKE ? OR remark LIKE ?) LIMIT ?`,
		[]interface{}{scope.ProjectID, pattern, pattern, pattern, pattern, limit}, func(item *SearchResult, row interface{ Scan(...interface{}) error }) error {
			if err := row.Scan(&item.ID, &item.ProjectID, &item.Title, &item.Tag, &item.IP, &item.Status, &item.Extra); err != nil {
				return err
			}
			item.Type, item.Group, item.TableKey = "system", searchGroups["system"].Group, searchGroups["system"].TableKey
			item.Subtitle = item.Tag
			item.Data = map[string]interface{}{"访问地址": item.IP, "备注": item.Extra}
			return nil
		}); err != nil {
		return nil, err
	}

	if err := query(`SELECT id, project_id, name, IFNULL(person_code,''), IFNULL(department,''), IFNULL(status,''), IFNULL(title,''), IFNULL(phone,'')
		FROM cmdb_persons WHERE project_id=? AND (name LIKE ? OR person_code LIKE ? OR phone LIKE ? OR email LIKE ? OR department LIKE ?) LIMIT ?`,
		[]interface{}{scope.ProjectID, pattern, pattern, pattern, pattern, pattern, limit}, func(item *SearchResult, row interface{ Scan(...interface{}) error }) error {
			var personCode, title, phone string
			if err := row.Scan(&item.ID, &item.ProjectID, &item.Title, &personCode, &item.Department, &item.Status, &title, &phone); err != nil {
				return err
			}
			item.Type, item.Group, item.TableKey = "person", searchGroups["person"].Group, searchGroups["person"].TableKey
			item.Subtitle, item.Tag, item.Extra = title, "人员", personCode
			item.Data = map[string]interface{}{"人员编号": personCode, "联系电话": phone}
			return nil
		}); err != nil {
		return nil, err
	}

	if err := query(`SELECT id, project_id, IFNULL(log_type,''), IFNULL(description,''), IFNULL(operator,''), IFNULL(log_time,''), asset_id
		FROM asset_logs WHERE project_id=? AND (log_type LIKE ? OR description LIKE ? OR operator LIKE ? OR from_user LIKE ? OR to_user LIKE ?) LIMIT ?`,
		[]interface{}{scope.ProjectID, pattern, pattern, pattern, pattern, pattern, limit}, func(item *SearchResult, row interface{ Scan(...interface{}) error }) error {
			var operator, logTime string
			var assetID int64
			if err := row.Scan(&item.ID, &item.ProjectID, &item.Title, &item.Subtitle, &operator, &logTime, &assetID); err != nil {
				return err
			}
			item.Type, item.Group, item.TableKey = "audit", searchGroups["audit"].Group, searchGroups["audit"].TableKey
			item.Tag, item.Extra = "运维履历", logTime
			item.Data = map[string]interface{}{"资产ID": assetID, "操作人": operator, "发生时间": logTime}
			return nil
		}); err != nil {
		return nil, err
	}

	if err := query(`SELECT id, project_id, IFNULL(ip,''), IFNULL(subnet,''), IFNULL(department,''), IFNULL(status,''), IFNULL(account,''), IFNULL(room,''), IFNULL(remark,'')
		FROM ip_pool WHERE project_id=? AND (ip LIKE ? OR subnet LIKE ? OR department LIKE ? OR room LIKE ? OR account LIKE ? OR remark LIKE ?) LIMIT ?`,
		[]interface{}{scope.ProjectID, pattern, pattern, pattern, pattern, pattern, pattern, limit}, func(item *SearchResult, row interface{ Scan(...interface{}) error }) error {
			var subnet, account, room string
			if err := row.Scan(&item.ID, &item.ProjectID, &item.Title, &subnet, &item.Department, &item.Status, &account, &room, &item.Extra); err != nil {
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
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.GetStatsForProject(scope)
}

func (s *Store) GetStatsForProject(scope ProjectScope) (map[string]interface{}, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	var assetTotal, serverTotal int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM cmdb_assets WHERE project_id=?", scope.ProjectID).Scan(&assetTotal); err != nil {
		return nil, err
	}
	if err := s.db.QueryRow("SELECT COUNT(*) FROM servers WHERE project_id=?", scope.ProjectID).Scan(&serverTotal); err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"total_assets":  assetTotal,
		"total_servers": serverTotal,
		"online_rate":   "98.5%",
	}, nil
}
