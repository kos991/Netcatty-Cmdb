package store

import (
	"database/sql"
	"strings"
	"time"
)

// CmdbSyncResult 记录一次旧台账映射的写入结果。
type CmdbSyncResult struct {
	OrgInserted    int `json:"org_inserted"`
	AssetInserted  int `json:"asset_inserted"`
	ServerInserted int `json:"server_inserted"`
	Skipped        int `json:"skipped"`
}

// mapLegacyAssetStatus 旧终端台账状态 → CMDB 状态白名单。
func mapLegacyAssetStatus(s string) string {
	switch strings.TrimSpace(s) {
	case "在用":
		return "在线"
	case "闲置", "仓库备用":
		return "在库"
	case "维修中":
		return "维护中"
	case "待报废", "已报废":
		return "报废"
	default:
		return "在库"
	}
}

// mapLegacyServerStatus 旧物理服务器状态 → CMDB 状态白名单。
func mapLegacyServerStatus(s string) string {
	switch strings.TrimSpace(s) {
	case "运行中":
		return "在线"
	case "已停机":
		return "离线"
	case "维护中":
		return "维护中"
	case "备用":
		return "在库"
	default:
		return "在库"
	}
}

// AllServers 读取全部物理服务器（不分页）。
// 现有 QueryServers 的 pageSize 上限为 500，超过会回退到默认值 20，
// 映射同步需要完整数据，因此这里单独提供无上限读取。
func (s *Store) AllServers() ([]PhysicalServer, error) {
	rows, err := s.db.Query(`SELECT id, IFNULL(asset_code,''), IFNULL(device_name,''), IFNULL(brand_model,''),
		IFNULL(serial_number,''), IFNULL(location,''), IFNULL(rack_unit,''), IFNULL(cpu_info,''),
		IFNULL(memory_info,''), IFNULL(disk_info,''), IFNULL(mgmt_ip,''), IFNULL(mgmt_url,''),
		IFNULL(biz_ip,''), IFNULL(os_type,''), IFNULL(admin_user,''), IFNULL(status,''),
		IFNULL(purchase_date,''), IFNULL(warranty_date,''), IFNULL(remark,''),
		IFNULL(created_at,''), IFNULL(updated_at,'')
		FROM servers ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]PhysicalServer, 0, 16)
	for rows.Next() {
		var srv PhysicalServer
		if err := rows.Scan(&srv.ID, &srv.AssetCode, &srv.DeviceName, &srv.BrandModel, &srv.SerialNumber,
			&srv.Location, &srv.RackUnit, &srv.CPUInfo, &srv.MemoryInfo, &srv.DiskInfo, &srv.MgmtIP,
			&srv.MgmtURL, &srv.BizIP, &srv.OSType, &srv.AdminUser, &srv.Status, &srv.PurchaseDate,
			&srv.WarrantyDate, &srv.Remark, &srv.CreatedAt, &srv.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, srv)
	}
	return list, rows.Err()
}

func (s *Store) cmdbOrgNameToID() (map[string]int64, error) {
	orgs, err := s.ListCmdbOrgs()
	if err != nil {
		return nil, err
	}
	m := make(map[string]int64, len(orgs))
	for _, o := range orgs {
		m[o.Name] = o.ID
	}
	return m, nil
}

// cmdbAssetExists 判断某个来源记录是否已经映射过（幂等键：source_type + source_id）。
func (s *Store) cmdbAssetExists(sourceType string, sourceID int64) (bool, error) {
	var id int64
	err := s.db.QueryRow(`SELECT id FROM cmdb_assets WHERE source_type = ? AND source_id = ?`,
		sourceType, sourceID).Scan(&id)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// insertCmdbInterface 写入一条资产网络接口记录。
func (s *Store) insertCmdbInterface(assetID, isPrimary int64, ip, netZone, remark string) error {
	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := s.db.Exec(`INSERT INTO cmdb_asset_interfaces
		(asset_id, is_primary, if_name, ip, mask, gateway, mac, net_zone, remark, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
		assetID, isPrimary, "", ip, "", "", "", netZone, remark, now, now)
	return err
}

// SyncLegacyToCmdb 把现有 assets / servers 单向幂等映射进 cmdb_assets。
// 重复执行不会产生重复数据：写入前按 source_type + source_id 判重。
func (s *Store) SyncLegacyToCmdb() (*CmdbSyncResult, error) {
	res := &CmdbSyncResult{}

	assets, err := s.AllAssets()
	if err != nil {
		return nil, err
	}

	// 1) 先把旧台账里的科室灌入 CMDB 组织表
	departments := make([]string, 0, len(assets))
	for _, a := range assets {
		departments = append(departments, a.Department)
	}
	added, err := s.SeedCmdbOrgsFromDepartments(departments)
	if err != nil {
		return nil, err
	}
	res.OrgInserted = added

	orgMap, err := s.cmdbOrgNameToID()
	if err != nil {
		return nil, err
	}

	// 2) 云桌面终端 → cmdb_assets
	for _, a := range assets {
		exists, err := s.cmdbAssetExists("legacy_asset", a.ID)
		if err != nil {
			return nil, err
		}
		if exists {
			res.Skipped++
			continue
		}

		name := strings.TrimSpace(a.UserName)
		if name != "" {
			name = name + " 的云桌面"
		} else {
			name = "公用云桌面"
		}

		item := &CmdbAsset{
			AssetCode:  a.AssetCode,
			Name:       name,
			Status:     mapLegacyAssetStatus(a.Status),
			AssetClass: "physical",
			SN:         a.BoxSN,
			OrgID:      orgMap[strings.TrimSpace(a.Department)],
			Department: a.Department,
			Owner:      a.UserName, // 终端的使用人即 CMDB 的负责人
			MgmtIP:     a.TerminalIP, // 业务 IP 不覆盖管理 IP
			SourceType: "legacy_asset",
			SourceID:   a.ID,
		}
		id, err := s.InsertCmdbAsset(item)
		if err != nil {
			return nil, err
		}
		res.AssetInserted++

		if ip := strings.TrimSpace(a.IP); ip != "" {
			if err := s.insertCmdbInterface(id, 1, ip, "业务网", "旧终端台账业务IP"); err != nil {
				return nil, err
			}
		}
	}

	// 3) 物理服务器 → cmdb_assets
	servers, err := s.AllServers()
	if err != nil {
		return nil, err
	}
	for _, sv := range servers {
		exists, err := s.cmdbAssetExists("legacy_server", sv.ID)
		if err != nil {
			return nil, err
		}
		if exists {
			res.Skipped++
			continue
		}

		item := &CmdbAsset{
			AssetCode:    sv.AssetCode,
			Name:         sv.DeviceName,
			Status:       mapLegacyServerStatus(sv.Status),
			AssetClass:   "physical",
			SN:           sv.SerialNumber,
			Model:        sv.BrandModel, // 品牌型号整体写入 model，vendor 留空
			Owner:        sv.AdminUser,
			CabinetName:  sv.Location,
			MgmtIP:       sv.MgmtIP,
			OSType:       sv.OSType,
			InstallDate:  sv.PurchaseDate,
			WarrantyDate: sv.WarrantyDate,
			SourceType:   "legacy_server",
			SourceID:     sv.ID,
		}
		id, err := s.InsertCmdbAsset(item)
		if err != nil {
			return nil, err
		}
		res.ServerInserted++

		if ip := strings.TrimSpace(sv.BizIP); ip != "" {
			if err := s.insertCmdbInterface(id, 1, ip, "业务网", "旧服务器业务IP"); err != nil {
				return nil, err
			}
		}
	}

	return res, nil
}
