# CMDB 全要素重构实施计划

## 1. 目标与定位

1. **品牌与命名规范**：全面移除“中院/常州中院”前缀，系统整体统一定名为 **「CMDB」**（CMDB 资产管理平台）。
2. **标准数据模型升级**：以用户提供的标准 CMDB 表头模板（42 项主表字段 + 7 项网络接口多网卡字段）为基准，深度融合现有系统中的硬件、安防、带外等特有业务字段。
3. **组织架构与人员强关联**：构建“所属组织 $\rightarrow$ 所属分组 $\rightarrow$ 部门 $\rightarrow$ 人员档案”的四级架构，实现“人员可穿透查看名下资产”、“资产可关联归属人员与部门”、“人员变动支持资产一键交接”。
4. **自定义字段引擎（Custom Fields）**：提供无代码字段扩展能力，支持管理员自由新增文本、数值、下拉单选、日期、布尔等自定义属性，并在资产录入、表格筛选、Excel 导出和详情抽屉中动态生效。
5. **IP 规划池（IPAM）深度双向联动**：将 IP 规划池全面纳入 CMDB 统一生命周期管理，资产网卡配 IP 自动占位、资产报废一键释放 IP、在 IP 池可穿透回查绑定资产。
6. **模版级导入导出**：支持按照标准表头模板进行全字段 Excel 批量导入、导出与校验。

---

## 2. 范围边界

- **保留项**：保留现有的全局搜索（Global Search）、资产全生命周期运维履历（AuditLogs/Timeline）、SQLite 单文件无额外中间件依赖与离线单可执行程序架构。
- **重构项**：
  - CMDB 资源总账与录入/编辑表单对齐 48+7 字段及自定义字段；
  - 组织架构增加人员（User/Personnel）管理实体与资产关联视图；
  - 增加自定义字段定义中心（Custom Fields Manager）；
  - 升级 IP 规划池（IPAM），打通多网卡接口与子网段管理。
- **技术栈约束**：继续沿用 Go 1.22+ + SQLite3（后端）与 React 18 + Ant Design 5（前端），不引入复杂 ORM、不引入外部重型依赖。

---

## 3. 核心数据模型设计

### 3.1 组织架构与人员体系模型
```sql
-- 组织机构与分组（沿用并扩展现有 cmdb_orgs / cmdb_groups）
-- 人员档案表
CREATE TABLE IF NOT EXISTS cmdb_persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_code TEXT,                  -- 工号/编号
    name TEXT NOT NULL,                -- 姓名
    org_id INTEGER NOT NULL DEFAULT 0, -- 所属组织
    group_id INTEGER NOT NULL DEFAULT 0,-- 所属分组
    department TEXT NOT NULL,          -- 部门
    title TEXT,                        -- 岗位/职务
    phone TEXT,                        -- 联系电话
    email TEXT,                        -- 邮箱
    status TEXT NOT NULL DEFAULT '在职',-- 在职/离职/兼岗
    remark TEXT,
    created_at TEXT,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cmdb_persons_name ON cmdb_persons(name);
CREATE INDEX IF NOT EXISTS idx_cmdb_persons_dept ON cmdb_persons(department);
```

### 3.2 自定义字段定义模型
```sql
-- 自定义字段元数据配置表
CREATE TABLE IF NOT EXISTS cmdb_custom_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field_key TEXT NOT NULL UNIQUE,     -- 字段标识 key (如: env_type, contract_no)
    field_name TEXT NOT NULL,           -- 字段展示名称 (如: 运行环境, 合同编号)
    field_type TEXT NOT NULL,           -- text, number, select, date, boolean
    options_json TEXT,                  -- 当类型为 select 时的选项列表 JSON (如: ["生产","测试","容灾"])
    asset_class TEXT NOT NULL DEFAULT 'all', -- 适用范围: all, physical, virtual, cloud, desktop
    required INTEGER NOT NULL DEFAULT 0,-- 是否必填 (1=是, 0=否)
    show_in_list INTEGER NOT NULL DEFAULT 1, -- 表格是否默认可选展示
    export_excel INTEGER NOT NULL DEFAULT 1, -- 导出 Excel 时是否包含该列
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    updated_at TEXT
);
```

### 3.3 融合后的 CMDB 资产宽表（标准 42 + 特有 6 + 自定义 JSON）
在现有 `cmdb_assets` 基础上补齐扩展：
1. **基础标识**：`name` (名称*), `asset_code` (资产编码), `asset_class` (资产大类*), `status` (状态), `device_type` (设备分类*), `sn` (SN), `box_sn` (云桌面盒子SN), `display_sn` (显示器SN), `tags` (标签 key:value), `description` (描述)
2. **组织与人员**：`organization` (所属组织), `group` (所属分组), `department` (部门), `owner` (负责人/使用人), `owner_id` (关联人员ID), `admin_user` (运维管理员), `biz_user` (业务负责人), `room` (房间/工位)
3. **网络与带外**：`manage_ip` (管理IP), `mac_address` (MAC地址), `mgmt_url` (带外控制台URL), `biz_ip` (主业务IP), `port_count` (端口数量)
4. **动力与规格**：`vendor` (厂商), `model` (型号), `vcpu` (CPU核), `cpu_info` (CPU型号详情), `memory_mb` (内存MB), `disk_info` (磁盘存储详情), `power_type` (电源类型), `redundant_power` (冗余电源)
5. **机柜与位置**：`area` (数据中心/区域), `floor` (楼层), `cabinet_name` (机柜名称), `cabinet_pos` (机柜位置), `u_height` (高度U), `u_start` (起始U位), `rack_unit` (U位简写如A02-12U)
6. **维保与系统**：`purchase_at` (安装日期), `warranty_at` (保修日期), `os_type` (操作系统类型), `os_version` (操作系统版本), `security_software` (安防软件状态), `net_type` (网络类型)
7. **地理位置**：`country` (国家), `province` (省份), `city` (城市), `district` (区县), `longitude` (经度), `latitude` (纬度), `geo_address` (详细地址)
8. **云与虚拟机**：`provider` (云厂商/供应商), `region` (地域), `zone` (可用区), `instance_type` (实例规格), `public_ip` (公网IP), `cluster_name` (集群名称)
9. **自定义扩展**：`custom_fields` (TEXT, 存储 JSON 字典，如 `{"env_type":"生产","contract_no":"HT-2026-001"}`)

### 3.4 网络接口与 IP 规划池（IPAM）联动模型
```sql
-- 资产网络接口表 (对齐用户提供的图片 2)
CREATE TABLE IF NOT EXISTS cmdb_asset_interfaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    asset_name TEXT NOT NULL,           -- 资产名称(关联键)*
    name TEXT NOT NULL,                 -- 接口名称* (eth0, bond0)
    ip TEXT,                            -- IP地址
    mask TEXT,                          -- 掩码/前缀
    gateway TEXT,                       -- 网关
    network_zone TEXT,                  -- 网络分区
    is_primary INTEGER NOT NULL DEFAULT 0, -- 主接口
    vlan_id INTEGER NOT NULL DEFAULT 0, -- VLAN号
    mac TEXT,                           -- 网卡独立MAC
    created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cmdb_if_ip ON cmdb_asset_interfaces(ip);
CREATE INDEX IF NOT EXISTS idx_cmdb_if_asset ON cmdb_asset_interfaces(asset_id);

-- IP 规划池（在原 ip_pool 基础上扩充与 CMDB 接口资产关联）
-- 字段：subnet, ip, status('空闲'/'已分配'/'预留'), network_zone, vlan_id, 
--       bound_asset_id, bound_asset_name, bound_interface_name, department, owner
```

---

## 4. 实施阶段与步骤

### 阶段一：品牌净化与底层 Schema 扩展
1. **去前缀处理**：
   - 全局替换前端 `TopHeader`、`ShellPreview`、`index.html` 以及后端日志、标题中包含的“中院/常州中院”字样，统一定名为 **「CMDB」**；
2. **后端数据库表升级**：
   - 增加 `cmdb_persons` 表及初始人员数据；
   - 增加 `cmdb_custom_fields` 表；
   - 扩充 `cmdb_assets`、`cmdb_asset_interfaces`、`ip_pool` 表字段，编写平滑兼容升级迁移（ALTER TABLE IF NOT EXISTS 或动态检测补列）；
   - 更新后端实体结构体（Go Struct）及 JSON 序列化映射。

### 阶段二：后端 API 扩展与业务逻辑
1. **组织与人员接口**：
   - 实现 `GET/POST/PUT/DELETE /api/cmdb/persons`（人员增删改查）；
   - 实现 `GET /api/cmdb/persons/{id}/assets`（查询指定人员名下的所有资产列表）；
   - 实现 `POST /api/cmdb/persons/transfer`（人员转岗/离职资产批量交接）。
2. **自定义字段管理接口**：
   - 实现 `GET/POST/PUT/DELETE /api/cmdb/custom-fields`（动态字段元数据管理）。
3. **资产全要素读写与多网卡/IP 池联动**：
   - 升级 `GET /api/cmdb/assets` 与 `POST /api/cmdb/assets`，支持接收和输出全部 48 项字段、多网卡数组以及 `custom_fields` 键值字典；
   - **双向联动逻辑**：资产网卡保存 IP 时，自动将 IP 池对应条目置为“已分配”并记录资产；资产删除/报废时自动解绑释放；
   - 升级 Excel 导入导出处理器，匹配用户提供的两张 Sheet 表头规范。
4. **IP 规划池接口增强**：
   - 增强 `GET /api/ip_pool`，支持按网络分区（network_zone）、VLAN、分配状态筛选，并返回关联资产详情。

### 阶段三：前端界面升级与用户体验闭环
1. **顶部导航结构重组**：
   - 【全局查询】
   - 【CMDB 资产总账】（资源列表、多维度组织树/分类树穿透、表格列显隐、筛选）
   - 【组织与人员】（组织架构树、人员花名册、名下资产穿透抽屉、资产交接）
   - 【自定义字段】（无代码字段配置中心）
   - 【IP 规划池】（网段利用率看板、IP 分配拓扑、一键关联资产与释放）
2. **资产详情与录入抽屉对齐**：
   - 表单按模块分折叠面板：*基本信息、组织与责任人（下拉联动人员）、规格与硬件、多网卡网络配置（支持直接从 IP 池选择可用 IP）、机柜与位置、地理坐标、云属性、自定义属性区*；
   - 资产详情抽屉直观展示关联人员卡片与多网卡列表。
3. **人员画像抽屉**：
   - 点击人员姓名，右侧滑出抽屉展示人员基础信息及其名下的桌面、服务器、虚拟机资产表格，支持一键调换。

---

## 5. 验证与验收标准

1. **名称核查**：界面任一视窗、Tab 标题、提示文案中均无“中院/常州中院”字样，完整展示为「CMDB」。
2. **组织人员与资产强关联验证**：
   - 在人员列表中能看到每位人员名下绑定的资产数量；
   - 点击人员能穿透查看具体设备详情；
   - 资产编辑时可下拉选择人员并同步带出其所属部门与组织。
3. **自定义字段验证**：
   - 在字段管理中新增一个名为“安全等保级别”（select 类型，选项：二级、三级）的字段；
   - 进入资产新增/编辑页面，表单能自动加载出该下拉项；
   - 保存后，表格可勾选展示该列，详情抽屉正确回显。
4. **IP 规划池与网卡联动验证**：
   - 在资产网络接口添加 IP `10.128.8.88`，IP 规划池中该 IP 自动变为“已分配”，显示关联该资产；
   - 在 IP 规划池中点击该 IP，能直接跳转查看该资产。
5. **导入导出验证**：
   - 使用包含图片 1 和图片 2 的两张表头 Excel 导入，资产与多网卡能正确入库并自动关联对应人员；
   - 导出的 Excel 表头与图片定义 100% 一致。
6. **构建验证**：
   - 后端 `go test ./...` 测试全部通过；
   - 前端 `npm run build` 成功，无编译错误。

---

## 6. 不做事项（防跑偏约束）

- 不破坏已有的时间轴履历流水逻辑；
- 不引入外部重量级中间件（保持纯净本地 Go + SQLite 单程序）；
- 保持数据向下兼容，已有历史录入数据不丢失、不损坏。
