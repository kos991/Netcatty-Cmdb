package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

type schemaExecutor interface {
	Exec(query string, args ...interface{}) (sql.Result, error)
	Query(query string, args ...interface{}) (*sql.Rows, error)
}

// MigrateCMDBFullSchema 负责检查并平滑补齐 CMDB 所需的所有扩展列与新建表。
// 支持在全新数据库以及已有旧版本数据库上安全幂等执行。
func MigrateCMDBFullSchema(db *sql.DB) error {
	if err := addMissingColumns(db, "cmdb_netcatty_links", map[string]string{"follow_asset_ip": "INTEGER NOT NULL DEFAULT 0"}); err != nil {
		return err
	}
	if err := addMissingColumns(db, "cmdb_device_categories", map[string]string{
		"asset_scope": "TEXT NOT NULL DEFAULT 'infrastructure'",
	}); err != nil {
		return fmt.Errorf("migrate cmdb_device_categories columns: %w", err)
	}

	// 1. 扩充 cmdb_assets 表列
	assetColsToAdd := map[string]string{
		"device_type":       "TEXT DEFAULT ''",
		"manage_ip":         "TEXT DEFAULT ''",
		"mac_address":       "TEXT DEFAULT ''",
		"organization":      "TEXT DEFAULT ''",
		"group_name":        "TEXT DEFAULT ''",
		"area":              "TEXT DEFAULT ''",
		"cabinet_pos":       "TEXT DEFAULT ''",
		"u_height":          "INTEGER DEFAULT 1",
		"u_start":           "INTEGER DEFAULT 0",
		"purchase_at":       "TEXT DEFAULT ''",
		"warranty_at":       "TEXT DEFAULT ''",
		"description":       "TEXT DEFAULT ''",
		"country":           "TEXT DEFAULT '中国'",
		"geo_address":       "TEXT DEFAULT ''",
		"provider":          "TEXT DEFAULT ''",
		"region":            "TEXT DEFAULT ''",
		"zone":              "TEXT DEFAULT ''",
		"vcpu":              "INTEGER DEFAULT 0",
		"memory_mb":         "INTEGER DEFAULT 0",
		"instance_type":     "TEXT DEFAULT ''",
		"public_ip":         "TEXT DEFAULT ''",
		"box_sn":            "TEXT DEFAULT ''",
		"display_sn":        "TEXT DEFAULT ''",
		"cpu_info":          "TEXT DEFAULT ''",
		"disk_info":         "TEXT DEFAULT ''",
		"mgmt_url":          "TEXT DEFAULT ''",
		"biz_ip":            "TEXT DEFAULT ''",
		"rack_unit":         "TEXT DEFAULT ''",
		"security_software": "TEXT DEFAULT ''",
		"net_type":          "TEXT DEFAULT ''",
		"admin_user":        "TEXT DEFAULT ''",
		"room":              "TEXT DEFAULT ''",
		"owner_id":          "INTEGER DEFAULT 0",
		"custom_fields":     "TEXT DEFAULT ''",
		"front_image":       "TEXT NOT NULL DEFAULT ''",
		"back_image":        "TEXT NOT NULL DEFAULT ''",
	}

	if err := addMissingColumns(db, "cmdb_assets", assetColsToAdd); err != nil {
		return fmt.Errorf("migrate cmdb_assets columns: %w", err)
	}

	// 2. 扩充 cmdb_asset_interfaces 表列
	ifaceColsToAdd := map[string]string{
		"additional_ips_json": "TEXT NOT NULL DEFAULT '[]'",
		"asset_name":          "TEXT DEFAULT ''",
		"name":                "TEXT DEFAULT ''",
		"network_zone":        "TEXT DEFAULT ''",
		"vlan_id":             "INTEGER DEFAULT 0",
	}

	if err := addMissingColumns(db, "cmdb_asset_interfaces", ifaceColsToAdd); err != nil {
		return fmt.Errorf("migrate cmdb_asset_interfaces columns: %w", err)
	}
	if err := addMissingColumns(db, "ip_subnets", map[string]string{
		"vni": "TEXT DEFAULT ''",
	}); err != nil {
		return fmt.Errorf("migrate ip_subnets columns: %w", err)
	}
	if err := addMissingColumns(db, "cmdb_work_orders", map[string]string{
		"operation_type": "TEXT DEFAULT ''",
		"work_minutes":   "INTEGER NOT NULL DEFAULT 0",
	}); err != nil {
		return fmt.Errorf("migrate cmdb_work_orders columns: %w", err)
	}

	// 3. 创建人员表 cmdb_persons
	personsDDL := `
	CREATE TABLE IF NOT EXISTS cmdb_persons (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		person_code TEXT,
		name TEXT NOT NULL,
		org_name TEXT,
		group_name TEXT,
		department TEXT NOT NULL,
		title TEXT,
		phone TEXT,
		email TEXT,
		status TEXT NOT NULL DEFAULT '在职',
		remark TEXT,
		created_at TEXT,
		updated_at TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_cmdb_persons_name ON cmdb_persons(name);
	CREATE INDEX IF NOT EXISTS idx_cmdb_persons_dept ON cmdb_persons(department);
	CREATE INDEX IF NOT EXISTS idx_cmdb_persons_code ON cmdb_persons(person_code);
	`
	if _, err := db.Exec(personsDDL); err != nil {
		return fmt.Errorf("create cmdb_persons table: %w", err)
	}

	// 4. 创建自定义字段定义表 cmdb_custom_fields
	customFieldsDDL := `
	CREATE TABLE IF NOT EXISTS cmdb_custom_fields (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		field_key TEXT NOT NULL,
		field_name TEXT NOT NULL,
		field_type TEXT NOT NULL,
		options_json TEXT,
		asset_class TEXT NOT NULL DEFAULT 'all',
		required INTEGER NOT NULL DEFAULT 0,
		show_in_list INTEGER NOT NULL DEFAULT 1,
		export_excel INTEGER NOT NULL DEFAULT 1,
		sort_order INTEGER NOT NULL DEFAULT 0,
		created_at TEXT,
		updated_at TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_cmdb_cf_class ON cmdb_custom_fields(asset_class);
	`
	if _, err := db.Exec(customFieldsDDL); err != nil {
		return fmt.Errorf("create cmdb_custom_fields table: %w", err)
	}

	// 5. 存量兼容性双向平滑回填
	syncSqls := []string{
		// cmdb_assets 同义列同步
		"UPDATE cmdb_assets SET manage_ip = mgmt_ip WHERE (manage_ip IS NULL OR manage_ip = '') AND mgmt_ip IS NOT NULL AND mgmt_ip <> ''",
		"UPDATE cmdb_assets SET mgmt_ip = manage_ip WHERE (mgmt_ip IS NULL OR mgmt_ip = '') AND manage_ip IS NOT NULL AND manage_ip <> ''",
		"UPDATE cmdb_assets SET mac_address = mac WHERE (mac_address IS NULL OR mac_address = '') AND mac IS NOT NULL AND mac <> ''",
		"UPDATE cmdb_assets SET mac = mac_address WHERE (mac IS NULL OR mac = '') AND mac_address IS NOT NULL AND mac_address <> ''",
		"UPDATE cmdb_assets SET area = data_center WHERE (area IS NULL OR area = '') AND data_center IS NOT NULL AND data_center <> ''",
		"UPDATE cmdb_assets SET data_center = area WHERE (data_center IS NULL OR data_center = '') AND area IS NOT NULL AND area <> ''",
		"UPDATE cmdb_assets SET description = remark WHERE (description IS NULL OR description = '') AND remark IS NOT NULL AND remark <> ''",
		"UPDATE cmdb_assets SET remark = description WHERE (remark IS NULL OR remark = '') AND description IS NOT NULL AND description <> ''",
		"UPDATE cmdb_assets SET geo_address = address WHERE (geo_address IS NULL OR geo_address = '') AND address IS NOT NULL AND address <> ''",
		"UPDATE cmdb_assets SET address = geo_address WHERE (address IS NULL OR address = '') AND geo_address IS NOT NULL AND geo_address <> ''",
		"UPDATE cmdb_assets SET purchase_at = install_date WHERE (purchase_at IS NULL OR purchase_at = '') AND install_date IS NOT NULL AND install_date <> ''",
		"UPDATE cmdb_assets SET install_date = purchase_at WHERE (install_date IS NULL OR install_date = '') AND purchase_at IS NOT NULL AND purchase_at <> ''",
		"UPDATE cmdb_assets SET warranty_at = warranty_date WHERE (warranty_at IS NULL OR warranty_at = '') AND warranty_date IS NOT NULL AND warranty_date <> ''",
		"UPDATE cmdb_assets SET warranty_date = warranty_at WHERE (warranty_date IS NULL OR warranty_date = '') AND warranty_at IS NOT NULL AND warranty_at <> ''",
		"UPDATE cmdb_assets SET u_start = start_u WHERE start_u > 0 AND (u_start IS NULL OR u_start = 0)",
		"UPDATE cmdb_assets SET start_u = u_start WHERE u_start > 0 AND (start_u IS NULL OR start_u = 0)",
		"UPDATE cmdb_assets SET u_height = height_u WHERE height_u > 0 AND (u_height IS NULL OR u_height = 0 OR u_height = 1)",
		"UPDATE cmdb_assets SET height_u = u_height WHERE u_height > 0 AND (height_u IS NULL OR height_u = 0 OR height_u = 1)",
		// cmdb_asset_interfaces 同义列同步
		"UPDATE cmdb_asset_interfaces SET name = if_name WHERE (name IS NULL OR name = '') AND if_name IS NOT NULL AND if_name <> ''",
		"UPDATE cmdb_asset_interfaces SET if_name = name WHERE (if_name IS NULL OR if_name = '') AND name IS NOT NULL AND name <> ''",
		"UPDATE cmdb_asset_interfaces SET network_zone = net_zone WHERE (network_zone IS NULL OR network_zone = '') AND net_zone IS NOT NULL AND net_zone <> ''",
		"UPDATE cmdb_asset_interfaces SET net_zone = network_zone WHERE (net_zone IS NULL OR net_zone = '') AND network_zone IS NOT NULL AND network_zone <> ''",
		// 关联回填 asset_name
		"UPDATE cmdb_asset_interfaces SET asset_name = (SELECT name FROM cmdb_assets WHERE cmdb_assets.id = cmdb_asset_interfaces.asset_id) WHERE (asset_name IS NULL OR asset_name = '')",
	}

	for _, q := range syncSqls {
		_, _ = db.Exec(q)
	}
	if err := migrateLegacyInterfacePurpose(db); err != nil {
		return fmt.Errorf("migrate legacy interface purpose: %w", err)
	}

	return nil
}

// 初版开发库可能有计划外的 purpose 列；仅在一次性迁移中读取，不纳入常规读写。
func migrateLegacyInterfacePurpose(db *sql.DB) error {
	cols, err := getTableColumns(db, "cmdb_asset_interfaces")
	if err != nil || !cols["purpose"] {
		return err
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS _meta (k TEXT PRIMARY KEY, v TEXT)`); err != nil {
		return err
	}
	var migrated string
	err = db.QueryRow(`SELECT v FROM _meta WHERE k='cmdb_interface_purpose_migrated_v1'`).Scan(&migrated)
	if err == nil && migrated == "1" {
		return nil
	}
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	rows, err := db.Query(`SELECT id, IFNULL(name,''), IFNULL(ip,''), IFNULL(is_primary,0), IFNULL(additional_ips_json,'[]'), IFNULL(purpose,'') FROM cmdb_asset_interfaces`)
	if err != nil {
		return err
	}
	type legacyAddressUpdate struct {
		id   int64
		json string
	}
	var updates []legacyAddressUpdate
	for rows.Next() {
		var id int64
		var iface CmdbAssetInterface
		var purpose string
		if err := rows.Scan(&id, &iface.Name, &iface.IP, &iface.IsPrimary, &iface.AdditionalIPsJSON, &purpose); err != nil {
			rows.Close()
			return err
		}
		if strings.TrimSpace(iface.IP) == "" || !validInterfacePurpose(purpose) {
			continue
		}
		var addresses []cmdbInterfaceAddress
		if err := json.Unmarshal([]byte(interfaceAdditionalIPs(iface)), &addresses); err != nil || addresses == nil {
			continue // 保留损坏的原值，由接口详情返回可见错误；迁移不得覆盖它。
		}
		mainIPHasPurpose := false
		for _, address := range addresses {
			if strings.TrimSpace(address.IP) == strings.TrimSpace(iface.IP) {
				mainIPHasPurpose = true
				break
			}
		}
		if mainIPHasPurpose {
			continue // JSON 中的主 IP 显式用途优先于旧列默认值。
		}
		addresses = append(addresses, cmdbInterfaceAddress{IP: iface.IP, Purpose: purpose})
		encoded, err := json.Marshal(addresses)
		if err != nil {
			rows.Close()
			return err
		}
		iface.AdditionalIPsJSON = string(encoded)
		if err := normalizeInterfaceAddresses(&iface); err != nil {
			continue // 非法历史项仍由接口详情报错，不伪造正常数据。
		}
		updates = append(updates, legacyAddressUpdate{id: id, json: iface.AdditionalIPsJSON})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, update := range updates {
		if _, err := tx.Exec(`UPDATE cmdb_asset_interfaces SET additional_ips_json=? WHERE id=?`, update.json, update.id); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`INSERT INTO _meta (k,v) VALUES ('cmdb_interface_purpose_migrated_v1','1') ON CONFLICT(k) DO UPDATE SET v='1'`); err != nil {
		return err
	}
	return tx.Commit()
}

func addMissingColumns(db schemaExecutor, tableName string, cols map[string]string) error {
	existingCols, err := getTableColumns(db, tableName)
	if err != nil {
		return err
	}
	if len(existingCols) == 0 {
		return nil // 表尚不存在，将在后续建表语句中直接建好
	}

	for colName, colDef := range cols {
		if !existingCols[strings.ToLower(colName)] {
			query := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", tableName, colName, colDef)
			if _, err := db.Exec(query); err != nil {
				return fmt.Errorf("exec %s: %w", query, err)
			}
		}
	}
	return nil
}

func getTableColumns(db interface {
	Query(query string, args ...interface{}) (*sql.Rows, error)
}, tableName string) (map[string]bool, error) {
	rows, err := db.Query(fmt.Sprintf("PRAGMA table_info(%s)", tableName))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols := make(map[string]bool)
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dfltVal sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dfltVal, &pk); err != nil {
			return nil, err
		}
		cols[strings.ToLower(name)] = true
	}
	return cols, rows.Err()
}
