package store

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestMigrateCMDBFullSchema(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "migrate_test.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite failed: %v", err)
	}
	defer db.Close()

	// 模拟旧版本数据库（只有基础字段的 cmdb_assets 和 cmdb_asset_interfaces）
	oldSchema := `
	CREATE TABLE cmdb_assets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		status TEXT DEFAULT '在库',
		mgmt_ip TEXT,
		mac TEXT,
		data_center TEXT,
		start_u INTEGER DEFAULT 0,
		height_u INTEGER DEFAULT 1,
		install_date TEXT,
		warranty_date TEXT,
		remark TEXT,
		address TEXT
	);
	CREATE TABLE cmdb_asset_interfaces (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		asset_id INTEGER NOT NULL,
		if_name TEXT,
		ip TEXT,
		net_zone TEXT
	);
	INSERT INTO cmdb_assets (name, mgmt_ip, mac, data_center, start_u, height_u, install_date, warranty_date, remark, address)
	VALUES ('老服务器1', '192.168.1.100', '00:11:22:33:44:55', '机房A', 10, 2, '2024-01-01', '2027-01-01', '老系统', '常州市新北区');
	INSERT INTO cmdb_asset_interfaces (asset_id, if_name, ip, net_zone)
	VALUES (1, 'eth0', '192.168.1.100', '业务专网');
	`
	if _, err := db.Exec(oldSchema); err != nil {
		t.Fatalf("setup old schema failed: %v", err)
	}

	// 执行迁移
	if err := MigrateCMDBFullSchema(db); err != nil {
		t.Fatalf("MigrateCMDBFullSchema failed: %v", err)
	}

	// 验证同义列回填
	var manageIP, macAddr, area, desc, geoAddr, purchaseAt, warrantyAt string
	var uStart, uHeight int
	err = db.QueryRow(`SELECT manage_ip, mac_address, area, description, geo_address, purchase_at, warranty_at, u_start, u_height
		FROM cmdb_assets WHERE id = 1`).Scan(&manageIP, &macAddr, &area, &desc, &geoAddr, &purchaseAt, &warrantyAt, &uStart, &uHeight)
	if err != nil {
		t.Fatalf("query migrated asset failed: %v", err)
	}

	if manageIP != "192.168.1.100" {
		t.Errorf("expected manage_ip 192.168.1.100, got %s", manageIP)
	}
	if macAddr != "00:11:22:33:44:55" {
		t.Errorf("expected mac_address 00:11:22:33:44:55, got %s", macAddr)
	}
	if area != "" {
		t.Errorf("机房与区域不再互相回填，expected empty area, got %s", area)
	}
	if desc != "老系统" {
		t.Errorf("expected description 老系统, got %s", desc)
	}
	if uStart != 10 || uHeight != 2 {
		t.Errorf("expected u_start=10, u_height=2, got %d, %d", uStart, uHeight)
	}
	if purchaseAt != "2024-01-01" || warrantyAt != "2027-01-01" {
		t.Errorf("expected purchase_at/warranty_at, got %s, %s", purchaseAt, warrantyAt)
	}

	// 验证网卡列与 asset_name 关联回填
	var ifName, name, ifNetZone, netZone, assetName string
	err = db.QueryRow(`SELECT if_name, name, net_zone, network_zone, asset_name FROM cmdb_asset_interfaces WHERE id = 1`).
		Scan(&ifName, &name, &ifNetZone, &netZone, &assetName)
	if err != nil {
		t.Fatalf("query migrated interface failed: %v", err)
	}
	if name != "eth0" || netZone != "业务专网" || assetName != "老服务器1" {
		t.Errorf("interface migration mismatch: name=%s, net_zone=%s, asset_name=%s", name, netZone, assetName)
	}

	// 验证 cmdb_persons 表已建立
	var personCount int
	if err := db.QueryRow("SELECT COUNT(*) FROM cmdb_persons").Scan(&personCount); err != nil {
		t.Fatalf("query cmdb_persons failed: %v", err)
	}

	// 验证 cmdb_custom_fields 表已建立
	var cfCount int
	if err := db.QueryRow("SELECT COUNT(*) FROM cmdb_custom_fields").Scan(&cfCount); err != nil {
		t.Fatalf("query cmdb_custom_fields failed: %v", err)
	}

	// 再次执行迁移验证幂等性
	if err := MigrateCMDBFullSchema(db); err != nil {
		t.Fatalf("MigrateCMDBFullSchema second run failed: %v", err)
	}
}

func TestStoreOpenRunsMigration(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "store_open_migration_test.db"))
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer st.Close()

	// 验证两张新表存在
	if _, err := st.db.Exec("SELECT id, person_code, name, department FROM cmdb_persons LIMIT 1"); err != nil {
		t.Fatalf("cmdb_persons not properly created: %v", err)
	}
	if _, err := st.db.Exec("SELECT id, field_key, field_name FROM cmdb_custom_fields LIMIT 1"); err != nil {
		t.Fatalf("cmdb_custom_fields not properly created: %v", err)
	}
	if _, err := st.DefaultProject(); err != nil {
		t.Fatalf("default project not created after migrations: %v", err)
	}
	if _, err := st.db.Exec("SELECT project_id, sync_id, revision, updated_at, deleted_at FROM cmdb_assets LIMIT 1"); err != nil {
		t.Fatalf("cmdb_assets project metadata not created: %v", err)
	}
}
