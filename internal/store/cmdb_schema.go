package store

// cmdbSchema 为 nettopo CMDB 复刻的六张基础表 DDL。
// 全部使用 IF NOT EXISTS，可重复执行。
const cmdbSchema = `
-- 组织架构（对应 nettopo 左侧「组织」维度）
CREATE TABLE IF NOT EXISTS cmdb_orgs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);

-- 业务分组（对应「分组」维度）
CREATE TABLE IF NOT EXISTS cmdb_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);

-- 设备分类（对应「类型」维度，表单中「设备分类 *」的取值来源）
CREATE TABLE IF NOT EXISTS cmdb_device_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);

-- 设备模型库（对应「配置中心 → 设备模型库」表格列）
CREATE TABLE IF NOT EXISTS cmdb_device_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor TEXT,
    model TEXT,
    height_u INTEGER NOT NULL DEFAULT 1,
    rated_power_w INTEGER NOT NULL DEFAULT 0,
    max_power_w INTEGER NOT NULL DEFAULT 0,
    weight_kg REAL NOT NULL DEFAULT 0,
    depth_mm INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);

-- CMDB 资产主表（扩展 48 核心列 + custom_fields 动态 JSON 字典）
CREATE TABLE IF NOT EXISTS cmdb_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_code TEXT,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '在库',
    asset_class TEXT NOT NULL DEFAULT 'physical',
    category_id INTEGER NOT NULL DEFAULT 0,
    model_id INTEGER NOT NULL DEFAULT 0,
    sn TEXT,
    vendor TEXT,
    model TEXT,
    tags TEXT,
    org_id INTEGER NOT NULL DEFAULT 0,
    group_id INTEGER NOT NULL DEFAULT 0,
    department TEXT,
    owner TEXT,
    data_center TEXT,
    floor TEXT,
    cabinet_name TEXT,
    cabinet_row TEXT,
    cabinet_col INTEGER NOT NULL DEFAULT 0,
    start_u INTEGER NOT NULL DEFAULT 0,
    height_u INTEGER NOT NULL DEFAULT 1,
    province TEXT,
    city TEXT,
    district TEXT,
    longitude REAL,
    latitude REAL,
    address TEXT,
    mgmt_ip TEXT,
    mac TEXT,
    port_count INTEGER NOT NULL DEFAULT 0,
    rated_power_w INTEGER NOT NULL DEFAULT 0,
    max_power_w INTEGER NOT NULL DEFAULT 0,
    power_type TEXT,
    redundant_power INTEGER NOT NULL DEFAULT 0,
    weight_kg REAL NOT NULL DEFAULT 0,
    os_type TEXT,
    os_version TEXT,
    install_date TEXT,
    warranty_date TEXT,
    remark TEXT,
    source_type TEXT NOT NULL DEFAULT 'manual',
    source_id INTEGER NOT NULL DEFAULT 0,
    -- 48+ 扩展字段与对齐字段
    device_type TEXT DEFAULT '',
    manage_ip TEXT DEFAULT '',
    mac_address TEXT DEFAULT '',
    organization TEXT DEFAULT '',
    group_name TEXT DEFAULT '',
    area TEXT DEFAULT '',
    cabinet_pos TEXT DEFAULT '',
    u_height INTEGER DEFAULT 1,
    u_start INTEGER DEFAULT 0,
    purchase_at TEXT DEFAULT '',
    warranty_at TEXT DEFAULT '',
    description TEXT DEFAULT '',
    country TEXT DEFAULT '中国',
    geo_address TEXT DEFAULT '',
    provider TEXT DEFAULT '',
    region TEXT DEFAULT '',
    zone TEXT DEFAULT '',
    vcpu INTEGER DEFAULT 0,
    memory_mb INTEGER DEFAULT 0,
    instance_type TEXT DEFAULT '',
    public_ip TEXT DEFAULT '',
    box_sn TEXT DEFAULT '',
    display_sn TEXT DEFAULT '',
    cpu_info TEXT DEFAULT '',
    disk_info TEXT DEFAULT '',
    mgmt_url TEXT DEFAULT '',
    biz_ip TEXT DEFAULT '',
    rack_unit TEXT DEFAULT '',
    security_software TEXT DEFAULT '',
    net_type TEXT DEFAULT '',
    admin_user TEXT DEFAULT '',
    room TEXT DEFAULT '',
    owner_id INTEGER DEFAULT 0,
    custom_fields TEXT DEFAULT '',
    created_at TEXT,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cmdb_assets_code ON cmdb_assets(asset_code);
CREATE INDEX IF NOT EXISTS idx_cmdb_assets_name ON cmdb_assets(name);
CREATE INDEX IF NOT EXISTS idx_cmdb_assets_sn ON cmdb_assets(sn);
CREATE INDEX IF NOT EXISTS idx_cmdb_assets_mgmt_ip ON cmdb_assets(mgmt_ip);
CREATE INDEX IF NOT EXISTS idx_cmdb_assets_category ON cmdb_assets(category_id);
CREATE INDEX IF NOT EXISTS idx_cmdb_assets_org ON cmdb_assets(org_id);
CREATE INDEX IF NOT EXISTS idx_cmdb_assets_status ON cmdb_assets(status);
CREATE INDEX IF NOT EXISTS idx_cmdb_assets_owner ON cmdb_assets(owner);
CREATE INDEX IF NOT EXISTS idx_cmdb_assets_owner_id ON cmdb_assets(owner_id);

-- 资产网络接口（对应表单「网络配置（多网卡）」与详情面板「端口与链路」）
CREATE TABLE IF NOT EXISTS cmdb_asset_interfaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    asset_name TEXT DEFAULT '',
    name TEXT DEFAULT '',
    if_name TEXT,
    ip TEXT,
    mask TEXT,
    gateway TEXT,
    mac TEXT,
    network_zone TEXT DEFAULT '',
    net_zone TEXT,
    is_primary INTEGER NOT NULL DEFAULT 0,
    vlan_id INTEGER NOT NULL DEFAULT 0,
    remark TEXT,
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY(asset_id) REFERENCES cmdb_assets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cmdb_iface_asset ON cmdb_asset_interfaces(asset_id);
CREATE INDEX IF NOT EXISTS idx_cmdb_iface_ip ON cmdb_asset_interfaces(ip);

-- ============ CMDB 其余模块（对应顶部 7 项导航中的 6 个非资源页） ============

-- 工单管理（对应 /cmdb/work-orders 实测 11 列表格）
CREATE TABLE IF NOT EXISTS cmdb_work_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT,
    priority TEXT,
    subject TEXT NOT NULL,
    biz_type TEXT,
    status TEXT,
    plan_time TEXT,
    actual_time TEXT,
    result TEXT,
    owner TEXT,
    maintainer TEXT,
    asset_id INTEGER NOT NULL DEFAULT 0,
    remark TEXT,
    created_at TEXT,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cmdb_wo_status ON cmdb_work_orders(status);
CREATE INDEX IF NOT EXISTS idx_cmdb_wo_asset ON cmdb_work_orders(asset_id);

-- 资产盘点（对应 /cmdb/inventory 实测 8 列表格）
CREATE TABLE IF NOT EXISTS cmdb_inventory_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_no TEXT,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '待执行',
    progress INTEGER NOT NULL DEFAULT 0,
    abnormal INTEGER NOT NULL DEFAULT 0,
    deadline TEXT,
    remark TEXT,
    created_at TEXT,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cmdb_inv_status ON cmdb_inventory_tasks(status);

-- 凭证中心（对应 /cmdb/credentials 实测 7 列表格）
-- 说明：本阶段不存储明文口令，仅登记凭证的名称/类型/描述与关联资产。
CREATE TABLE IF NOT EXISTS cmdb_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cred_type TEXT,
    description TEXT,
    asset_id INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cmdb_cred_type ON cmdb_credentials(cred_type);

-- 编码与标签（对应 /cmdb/labels 的编码注册表；资产信息通过 asset_id 关联 cmdb_assets，不重复存储）
CREATE TABLE IF NOT EXISTS cmdb_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    asset_id INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT '使用中',
    printed INTEGER NOT NULL DEFAULT 0,
    print_batch TEXT,
    created_at TEXT,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cmdb_labels_asset ON cmdb_labels(asset_id);
CREATE INDEX IF NOT EXISTS idx_cmdb_labels_status ON cmdb_labels(status);

-- 人员档案表（对应 /cmdb/persons）
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

-- 自定义字段定义表（对应 /cmdb/custom-fields）
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

// InitCmdbSchema 幂等创建 CMDB 相关表，可重复调用。
func (s *Store) InitCmdbSchema() error {
	if _, err := s.db.Exec(cmdbSchema); err != nil {
		return err
	}
	return nil
}
