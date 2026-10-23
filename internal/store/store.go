package store

import (
	"database/sql"
	"fmt"
	"strings"
	"sync"

	_ "modernc.org/sqlite"
)

type Store struct {
	db               *sql.DB
	path             string
	attachmentTempMu sync.Mutex
	attachmentTemps  map[string]attachmentTempTarget
}

func Open(path string) (*Store, error) {
	existingDatabase := existingDatabaseFile(path)
	// modernc.org/sqlite: 启用 WAL 模式、外键约束与忙碌重试超时
	dsn := path
	if !strings.Contains(dsn, "?") {
		dsn += "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)"
	}

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("打开数据库失败: %w", err)
	}

	// SQLite 单文件读写：限制最大打开连接数，避免高并发锁冲突
	db.SetMaxOpenConns(1)
	backupPath := ""
	fail := func(err error) (*Store, error) {
		_ = db.Close()
		if backupPath != "" {
			return nil, &MigrationError{BackupPath: backupPath, Err: err}
		}
		return nil, err
	}

	// 显式执行 PRAGMA，确保连接配置生效
	pragmas := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=ON",
	}
	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			return fail(fmt.Errorf("pragma %s: %w", p, err))
		}
	}
	if existingDatabase {
		needsMigration, err := NeedsProjectMigration(db)
		if err != nil {
			return fail(err)
		}
		if needsMigration {
			backupPath, err = BackupDatabase(db, path)
			if err != nil {
				return fail(fmt.Errorf("创建迁移安全备份失败: %w", err))
			}
		}
	}

	cleanPath, _ := databaseFilePath(path)
	s := &Store{db: db, path: cleanPath}
	if err := s.InitSchema(); err != nil {
		return fail(err)
	}
	if err := s.InitCmdbSchema(); err != nil {
		return fail(fmt.Errorf("init cmdb schema: %w", err))
	}
	// 建表后再执行扩展迁移，旧表补列与全新表初始化走同一顺序。
	if err := MigrateCMDBFullSchema(s.db); err != nil {
		return fail(fmt.Errorf("migrate cmdb full schema: %w", err))
	}
	if err := s.InitConfigSchema(); err != nil {
		return fail(err)
	}
	if err := MigrateProjectSchema(s.db); err != nil {
		return fail(fmt.Errorf("migrate project schema: %w", err))
	}
	if err := s.migrateServerAppPrototypeFields(); err != nil {
		return fail(fmt.Errorf("migrate app detail fields: %w", err))
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) InitSchema() error {
	schema := `
	CREATE TABLE IF NOT EXISTS _meta (
		k TEXT PRIMARY KEY,
		v TEXT
	);

	CREATE TABLE IF NOT EXISTS assets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		asset_name TEXT NOT NULL DEFAULT '',
		asset_code TEXT,
		device_type TEXT,
		box_sn TEXT,
		display_sn TEXT,
		user_name TEXT,
		department TEXT,
		room TEXT,
		ip TEXT,
		terminal_ip TEXT,
		os_type TEXT DEFAULT '',
		os_version TEXT DEFAULT '',
		vendor TEXT NOT NULL DEFAULT '',
		model TEXT NOT NULL DEFAULT '',
		cpu_info TEXT NOT NULL DEFAULT '',
		memory_mb INTEGER NOT NULL DEFAULT 0 CHECK(memory_mb >= 0),
		disk_info TEXT NOT NULL DEFAULT '',
		security_software TEXT,
		status TEXT,
		net_type TEXT,
		group_id INTEGER NOT NULL DEFAULT 0,
		remark TEXT,
		front_image TEXT NOT NULL DEFAULT '',
		back_image TEXT NOT NULL DEFAULT '',
		created_at TEXT,
		updated_at TEXT
	);

	CREATE INDEX IF NOT EXISTS idx_assets_sn ON assets(box_sn, display_sn);
	CREATE INDEX IF NOT EXISTS idx_assets_user ON assets(user_name);
	CREATE INDEX IF NOT EXISTS idx_assets_room ON assets(room);
	CREATE INDEX IF NOT EXISTS idx_assets_dept ON assets(department);
	CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);

	CREATE TABLE IF NOT EXISTS asset_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		asset_id INTEGER,
		log_type TEXT,
		from_user TEXT,
		to_user TEXT,
		from_location TEXT,
		to_location TEXT,
		old_sn TEXT,
		new_sn TEXT,
		operator TEXT,
		description TEXT,
		log_time TEXT
	);

	CREATE TABLE IF NOT EXISTS ip_pool (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		subnet TEXT,
		ip TEXT,
		department TEXT,
		room TEXT,
		account TEXT,
		status TEXT,
		remark TEXT
	);

	CREATE TABLE IF NOT EXISTS servers (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		asset_code TEXT,
		device_name TEXT,
		brand_model TEXT,
		serial_number TEXT,
		location TEXT,
		rack_unit TEXT,
		cpu_info TEXT,
		memory_info TEXT,
		disk_info TEXT,
		mgmt_ip TEXT,
		mgmt_url TEXT,
		biz_ip TEXT,
		os_type TEXT,
		admin_user TEXT,
		status TEXT,
		purchase_date TEXT,
		warranty_date TEXT,
		remark TEXT,
		created_at TEXT,
		updated_at TEXT
	);

	CREATE INDEX IF NOT EXISTS idx_servers_sn ON servers(serial_number);
	CREATE INDEX IF NOT EXISTS idx_servers_mgmt_ip ON servers(mgmt_ip);
	CREATE INDEX IF NOT EXISTS idx_servers_biz_ip ON servers(biz_ip);
	CREATE INDEX IF NOT EXISTS idx_servers_status ON servers(status);

	CREATE TABLE IF NOT EXISTS server_apps (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		server_id INTEGER,
		app_name TEXT,
		app_type TEXT,
		port TEXT,
		access_url TEXT,
		middleware TEXT,
		database_info TEXT,
		provider TEXT,
		owner TEXT,
		status TEXT,
		remark TEXT,
		created_at TEXT,
		updated_at TEXT
	);
	`
	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("init schema: %w", err)
	}
	if err := addMissingColumns(s.db, "assets", map[string]string{
		"asset_name":  "TEXT NOT NULL DEFAULT ''",
		"device_type": "TEXT DEFAULT ''", "os_type": "TEXT DEFAULT ''", "os_version": "TEXT DEFAULT ''",
		"vendor": "TEXT NOT NULL DEFAULT ''", "model": "TEXT NOT NULL DEFAULT ''",
		"cpu_info": "TEXT NOT NULL DEFAULT ''", "disk_info": "TEXT NOT NULL DEFAULT ''",
		"memory_mb":   "INTEGER NOT NULL DEFAULT 0 CHECK(memory_mb >= 0)",
		"group_id":    "INTEGER NOT NULL DEFAULT 0",
		"front_image": "TEXT NOT NULL DEFAULT ''", "back_image": "TEXT NOT NULL DEFAULT ''",
	}); err != nil {
		return fmt.Errorf("migrate assets columns: %w", err)
	}
	if err := addMissingColumns(s.db, "ip_pool", map[string]string{
		"owner_type": "TEXT DEFAULT ''", "owner_id": "INTEGER NOT NULL DEFAULT 0", "owner_name": "TEXT DEFAULT ''",
	}); err != nil {
		return fmt.Errorf("migrate ip_pool owner columns: %w", err)
	}
	serverAppColumns := map[string]string{
		"service_ip":          "TEXT NOT NULL DEFAULT ''",
		"asset_code":          "TEXT NOT NULL DEFAULT ''",
		"version":             "TEXT",
		"department":          "TEXT NOT NULL DEFAULT ''",
		"network_type":        "TEXT",
		"description":         "TEXT",
		"deployment":          "TEXT NOT NULL DEFAULT ''",
		"deployment_location": "TEXT NOT NULL DEFAULT ''",
		"server_id":           "INTEGER",
		"cmdb_asset_id":       "INTEGER DEFAULT 0",
		"app_name":            "TEXT",
		"app_type":            "TEXT",
		"port":                "TEXT DEFAULT ''",
		"access_url":          "TEXT DEFAULT ''",
		"middleware":          "TEXT DEFAULT ''",
		"database_info":       "TEXT DEFAULT ''",
		"provider":            "TEXT DEFAULT ''",
		"owner":               "TEXT DEFAULT ''",
		"status":              "TEXT DEFAULT ''",
		"group_id":            "INTEGER NOT NULL DEFAULT 0",
		"remark":              "TEXT DEFAULT ''",
		"created_at":          "TEXT DEFAULT ''",
		"updated_at":          "TEXT DEFAULT ''",
	}
	if err := addMissingColumns(s.db, "server_apps", serverAppColumns); err != nil {
		return fmt.Errorf("migrate server_apps columns: %w", err)
	}
	if _, err := s.db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_server_apps_server ON server_apps(server_id);
		CREATE INDEX IF NOT EXISTS idx_server_apps_name ON server_apps(app_name);
	`); err != nil {
		return fmt.Errorf("init server_apps indexes: %w", err)
	}
	if err := s.InitServerAppHistorySchema(); err != nil {
		return fmt.Errorf("init app history schema: %w", err)
	}
	if err := s.InitIPSubnetSchema(); err != nil {
		return fmt.Errorf("init ip subnet schema: %w", err)
	}
	if _, err := s.db.Exec(ipSubnetSegmentsSchema); err != nil {
		return fmt.Errorf("init ip subnet segments schema: %w", err)
	}
	return nil
}
