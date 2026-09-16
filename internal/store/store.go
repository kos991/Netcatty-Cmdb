package store

import (
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
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

	// 显式执行 PRAGMA，确保连接配置生效
	pragmas := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=ON",
	}
	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			return nil, fmt.Errorf("pragma %s: %w", p, err)
		}
	}

	s := &Store{db: db}
	if err := s.InitSchema(); err != nil {
		return nil, err
	}
	// 先执行全量扩展迁移，确保已有旧表已被平滑补充 owner_id、custom_fields 等列
	if err := MigrateCMDBFullSchema(s.db); err != nil {
		return nil, fmt.Errorf("migrate cmdb full schema: %w", err)
	}
	if err := s.InitCmdbSchema(); err != nil {
		return nil, fmt.Errorf("init cmdb schema: %w", err)
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
		asset_code TEXT,
		box_sn TEXT,
		display_sn TEXT,
		user_name TEXT,
		department TEXT,
		room TEXT,
		ip TEXT,
		terminal_ip TEXT,
		security_software TEXT,
		status TEXT,
		net_type TEXT,
		remark TEXT,
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
		access_url TEXT,
		status TEXT,
		remark TEXT,
		created_at TEXT,
		updated_at TEXT
	);

	CREATE INDEX IF NOT EXISTS idx_server_apps_server ON server_apps(server_id);
	CREATE INDEX IF NOT EXISTS idx_server_apps_name ON server_apps(app_name);
	`
	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("init schema: %w", err)
	}
	if err := s.InitIPSubnetSchema(); err != nil {
		return fmt.Errorf("init ip subnet schema: %w", err)
	}
	return nil
}

func (s *Store) IsSeeded() (bool, error) {
	var val string
	err := s.db.QueryRow("SELECT v FROM _meta WHERE k = 'seeded'").Scan(&val)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return val == "true", nil
}

func (s *Store) SetSeeded() error {
	_, err := s.db.Exec("INSERT OR REPLACE INTO _meta (k, v) VALUES ('seeded', 'true')")
	return err
}

func (s *Store) IsSeededV2() (bool, error) {
	var val string
	err := s.db.QueryRow("SELECT v FROM _meta WHERE k = 'seeded_v2'").Scan(&val)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return val == "true", nil
}

func (s *Store) SetSeededV2() error {
	_, err := s.db.Exec("INSERT OR REPLACE INTO _meta (k, v) VALUES ('seeded_v2', 'true')")
	return err
}
