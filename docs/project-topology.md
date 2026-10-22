# Netcatty-Cmdb 项目拓扑与逻辑

> 版本 1.0.20261022 · 更新于 2026-10-22

---

## 一、项目目录结构

```
Netcatty-Cmdb/
├── main.go                      # Go 入口：启动 HTTP 服务、注册路由
├── main_test.go                 # 入口测试（健康检查、启动参数）
├── go.mod / go.sum              # Go 依赖（modernc.org/sqlite、excelize）
├── VERSION                      # 当前版本号（格式 1.0.YYYYMMDD）
├── AGENTS.md                    # 项目规则与约束（代码生成强制遵守）
├── 使用说明.md                   # 产品使用文档
│
├── internal/                    # ★ Go 后端核心
│   ├── server.go                # HTTP 路由注册（~120 条）+ 全部 handler 入口
│   │
│   │   ── 终端资产 ──
│   ├── server_cmdb.go           # 终端资产 CRUD handler
│   ├── server_legacy_asset_io.go# 终端导入/导出（兼容旧 Excel 模板）
│   ├── server_terminal_batch.go # 终端批量操作
│   │
│   │   ── 基础设施 ──
│   ├── server_cmdb_modules.go   # 基础设施过滤/分页/导出/批量
│   ├── server_cmdb_write.go     # 基础设施写入（批量编辑/克隆/归档）
│   ├── server_cmdb_snapshot.go  # 云同步快照
│   ├── server_cmdb_switch_snapshot.go # 交换机配置快照
│   ├── server_cmdb_netcatty_links.go  # Netcatty 主机连接管理
│   │
│   │   ── 业务系统 ──
│   ├── server_apps.go           # 业务系统 CRUD
│   │
│   │   ── 工单 ──
│   ├── server_cmdb_work_order_export.go # 工单导出
│   ├── server_work_order_records.go     # 工单处理记录
│   ├── server_work_order_attachments.go # 工单附件
│   │
│   │   ── IPAM / 网络 ──
│   ├── server_ip_pool.go        # IP 地址池 CRUD
│   ├── server_naming_subnets.go # 编码/子网命名
│   │
│   │   ── 配置 / 通用 ──
│   ├── server_cmdb_taxonomy.go  # 设备分类目录
│   ├── server_cmdb_io.go        # 资产导入导出
│   ├── server_cmdb_config_test.go
│   ├── server_asset_images.go   # 设备照片
│   ├── server_attachment_storage.go # 通用附件存储
│   ├── server_rack_migration.go # 机柜迁移
│   ├── server_projects.go       # 项目管理
│   ├── server_cmdb_person_custom.go # 人员自定义字段
│   │
│   └── store/                   # ★ 数据访问层（DAL）
│       │
│       │   ── 初始化 & 迁移 ──
│       ├── store.go             # DB Open → WAL/FK → 迁移 → 返回 *Store
│       ├── project_schema.go    # 项目级 DDL 迁移 + 目录/型号自动补全
│       ├── cmdb_schema.go       # CMDB 表结构迁移（cmdb_assets 等）
│       ├── config_schema.go     # 配置表结构迁移（cmdb_groups 等）
│       ├── cmdb_migrate.go      # 旧表 → 新表数据迁移
│       ├── seed.go              # 初始数据种子
│       │
│       │   ── 终端资产 ──
│       ├── legacy_store.go      # 终端资产完整 CRUD（兼容层，74KB）
│       ├── legacy_models.go     # 终端资产结构体
│       ├── terminal_naming.go   # 终端编码自动命名
│       ├── terminal_batch.go    # 终端批量导入
│       │
│       │   ── 基础设施 ──
│       ├── cmdb_store.go        # CMDB 基础设施读取
│       ├── cmdb_write.go        # CMDB 基础设施写入（事务内自动收录型号）
│       ├── cmdb_modules.go      # 基础设施模块 store
│       ├── cmdb_links.go        # 资产间链路 store
│       ├── cmdb_netcatty_links.go # Netcatty 连接关联 store
│       ├── cmdb_interface_update.go # 网络接口更新
│       ├── cmdb_snapshot.go     # 云同步快照 store
│       ├── cmdb_switch_snapshot.go  # 交换机快照 store
│       │
│       │   ── 工单 ──
│       ├── project_scope_modules_store.go # 工单 CRUD + 状态流转
│       ├── work_order_attachments.go      # 工单附件
│       ├── work_order_import.go           # 工单导入
│       ├── work_order_logs.go             # 工单履历
│       │
│       │   ── IPAM ──
│       ├── ip_pool.go           # IP 地址池 CRUD（49KB）
│       ├── ip_subnet.go         # 子网定义
│       ├── ip_subnet_suggest.go # 子网推荐
│       │
│       │   ── 配置中心 ──
│       ├── config_store.go      # 组织/分类/规则 CRUD
│       ├── project_scope_taxonomy_store.go # 设备分类目录 CRUD
│       ├── project_scope_custom_field_store.go
│       │
│       │   ── 人员 / 组织 ──
│       ├── person_store.go      # 人员 CRUD
│       │
│       │   ── 机柜 ──
│       ├── rack_registry.go     # 机柜/机房注册
│       ├── rack_location.go     # U 位定位
│       ├── rack_migration.go    # 机柜迁移
│       │
│       │   ── 附件 / 标签 ──
│       ├── attachment_storage.go # 通用附件
│       ├── asset_images.go      # 设备照片
│       ├── cmdb_labels.go       # 资产标签
│       │
│       │   ── 导入导出 / 同步 ──
│       ├── cmdb_io.go           # 导入导出 store
│       ├── project_scope_cmdb_io_store.go
│       ├── project_scope_cmdb_sync_store.go
│       ├── sangfor_import.go    # 深信服导入
│       │
│       │   ── 项目作用域 ──
│       ├── project_scope.go     # 项目作用域解析
│       ├── project_scope_ip_subnet_store.go
│       ├── project_scope_sangfor_import_store.go
│       │
│       │   ── 其他 ──
│       ├── cmdb_taxonomy.go     # 分类目录 store
│       ├── cmdb_meta.go         # 元数据
│       ├── cmdb_history.go      # 变更历史
│       ├── cmdb_sync.go         # 同步标记
│       ├── database_backup.go   # 数据库备份
│       ├── global_search_test.go
│       └── *_test.go            # 各 store 单元/集成测试
│
├── integrations/netcatty/       # ★ Netcatty 桌面客户端集成层
│   ├── CmdbSurface.tsx          # 顶层 Cmdb 面板（侧栏导航 + 工作区壳）
│   ├── CmdbCloudSync.ts         # 云同步逻辑
│   ├── CmdbSyncSnapshot.ts      # 快照差异计算
│   ├── CmdbAttachmentCloudSync.ts # 附件云同步
│   ├── upstream.json            # 锁定 Netcatty 上游版本/commit
│   ├── electron/                # Electron 主进程集成补丁
│   ├── update/                  # 集成版自动更新（指向本仓库 Release）
│   │
│   └── cmdb/                    # ★ 前端业务页面 + 纯逻辑模型
│       │
│       │   ── 顶层路由 ──
│       ├── CmdbWorkspace.jsx    # 工作区路由分发器
│       ├── index.js             # 模块导出
│       │
│       │   ── 设备资产模块 ──
│       ├── DeviceAssets.jsx     # "设备资产"壳：统一搜索 + 三子页切换
│       ├── TerminalAssets.jsx   # 终端资产台账（列表/详情/新增/编辑）
│       ├── Infrastructure.jsx   # 基础设施列表 + 侧边详情
│       ├── InfrastructureEditor.jsx # 基础设施新增/编辑抽屉
│       ├── Systems.jsx          # 业务系统列表 + 详情
│       ├── DeviceWorkspace.jsx  # 基础设施设备工作区（交换机/路由器/服务器）
│       ├── DeviceRelations.jsx  # 资产关联详情（链路/IPAM/履历/连接）
│       ├── AssetPanel.jsx       # 终端资产详情面板
│       ├── AssetDetailTabs.jsx  # 详情页签切换
│       ├── Fields.jsx           # 通用字段组件
│       ├── AssetFilterPicker.jsx# 筛选条件选择器
│       ├── AssetTransferMenu.jsx# 调换使用人菜单
│       ├── ImportDialog.jsx     # 导入预览弹窗
│       │
│       │   ── 基础设施子组件 ──
│       ├── HardwareFields.jsx   # 硬件字段录入（CPU/内存/磁盘）
│       ├── HardwareCollection.jsx # 远程硬件采集
│       ├── DeviceImages.jsx     # 设备照片管理
│       ├── VendorBrandIcon.jsx  # 品牌图标渲染
│       ├── VendorBrandInput.jsx # 品牌型号输入
│       ├── OperatingSystemCell.jsx # 操作系统图标+文字
│       ├── ServerOperations.jsx # 服务器承载应用列表
│       ├── SwitchWorkspace.jsx  # 交换机端口面板
│       ├── RouterOperations.jsx # 路由器接口表
│       ├── InfrastructureQuickConnect.jsx # 快速连接按钮
│       │
│       │   ── 机柜与网络模块 ──
│       ├── IPAM.jsx             # "机柜与网络"壳（机柜/网络二级导航）
│       ├── RackOverview.jsx     # 机柜全景视图
│       ├── RackView.jsx         # 单机柜正面图
│       ├── RackLocationEditor.jsx # 机柜位置编辑
│       ├── RackDeviceEditor.jsx # 机柜设备快编
│       ├── RackMountDialog.jsx  # 设备上架弹窗
│       ├── NetworkAddressWorkspace.jsx # IPAM 网络地址管理
│       ├── SubnetMaintenance.jsx# 子网维护
│       ├── SubnetSuggestions.jsx# 子网推荐
│       │
│       │   ── 组织架构模块 ──
│       ├── People.jsx           # 人员列表 + 详情
│       ├── PersonDetailPanel.jsx# 人员详情面板
│       ├── Organizations.jsx    # 组织架构树
│       │
│       │   ── 工单与统计模块 ──
│       ├── Operations.jsx       # 入口壳 → WorkOrders
│       ├── WorkOrders.jsx       # 工单列表 + 创建/编辑/详情/结单（45KB）
│       ├── WorkOrderDetail.jsx  # 工单详情弹窗
│       ├── WorkOrderList.jsx    # 工单列表子组件
│       │
│       │   ── 配置中心 ──
│       ├── ConfigCenter.jsx     # 配置中心页面
│       ├── Taxonomy.jsx         # 设备分类目录弹窗
│       ├── SettingsCatalogEditor.jsx # 设置中目录编辑器
│       ├── Catalog.jsx          # 目录选择器
│       ├── SettingsProjectStorage.jsx # 项目存储设置
│       ├── SettingsSyncMaintenance.jsx # 同步维护
│       │
│       │   ── 其他功能 ──
│       ├── Labels.jsx           # 资产标签打印
│       ├── Credentials.jsx      # 凭据管理
│       │
│       │   ── Netcatty 宿主适配 ──
│       ├── NetcattyConnectionFields.jsx  # 连接配置字段组
│       ├── NetcattyLinks.jsx    # Netcatty 主机连接列表
│       ├── NetcattyDirectory.jsx# Netcatty 目录 Provider
│       ├── adapter/             # 适配器层（密钥库/Telnet/连接桥）
│       │   ├── netcattyVaultActions.js
│       │   ├── NetcattyConnection.js
│       │   ├── NetcattyConnectionFields.jsx
│       │   ├── NetcattyLinks.jsx
│       │   ├── NetcattyDirectory.jsx
│       │   └── readTelnetConfiguration.js
│       │
│       │   ── 核心抽象层 ──
│       ├── core/
│       │   ├── api.js           # 全部 API 调用封装（144 个方法）
│       │   ├── transport.js     # fetch 传输层（JSON 序列化/错误处理）
│       │   ├── state.js         # 模块路由/搜索目标/云桌面/IP 呈现
│       │   └── hooks.js         # useQuery / useAction / useDirectory
│       │
│       │   ── 纯逻辑模型 ──
│       ├── state.js             # 模块定义、搜索目标解析、云桌面判定
│       ├── transport.js         # 传输层（实际运行时版本）
│       ├── hooks.js             # React hooks
│       ├── deviceWorkspaceModel.js    # 设备工作区模型（硬件/网络/品牌）
│       ├── infrastructureEditorModel.js # 编辑器模型（网络地址行计算）
│       ├── infrastructureTableModel.js  # 列表列定义
│       ├── hardwareFieldModel.js      # 硬件字段模型
│       ├── readHostHardware.js        # 远程硬件读取
│       ├── assetTableModel.js         # 资产表列定义
│       ├── assetFilterModel.js        # 筛选条件模型
│       ├── vendorBrandModel.js        # 品牌型号匹配
│       ├── taxonomyModel.js           # 分类目录模型
│       ├── switchPortPanel.js         # 交换机端口面板模型
│       ├── switchConfig.js            # 交换机配置解析
│       ├── rackLayoutModel.js         # 机柜布局计算
│       ├── ipamLayoutModel.js         # IPAM 布局模型
│       ├── organizationEditorModel.js # 组织编辑模型
│       ├── peopleToolbarModel.js      # 人员工具栏模型
│       ├── workOrderStatsModel.js     # 工单统计模型
│       ├── workOrderFormModel.js      # 工单表单模型
│       ├── attachmentStorageModel.js   # 附件存储模型
│       ├── directorySync.js           # 目录同步
│       ├── settingsNavigation.js      # 设置导航
│       │
│       │   ── 模块级状态 ──
│       ├── modules/
│       │   ├── assets/          # 资产模块状态
│       │   ├── ipam/            # IPAM 模块状态
│       │   ├── org/             # 组织模块状态
│       │   ├── settings/        # 设置模块状态
│       │   └── workorders/      # 工单模块状态
│       │
│       │   ── 共享 UI 组件 ──
│       ├── ui/
│       │   ├── ui.jsx           # DataTable / Pagination / Toolbar / StatusPill
│       │   ├── Labels.jsx       # 标签组件
│       │   ├── Fields.jsx       # 字段组件
│       │   ├── AssetFilterPicker.jsx
│       │   └── index.js
│       │
│       │   ── 测试 ──
│       ├── *.test.js            # 前端纯逻辑测试（~25 个测试文件）
│       │
│       │   ── 品牌图标 ──
│       ├── vendor-icons/        # 60+ 品牌 SVG/PNG 图标
│       │   ├── h3c.svg / huawei.svg / dell.svg / vmware.svg ...
│       │   └── SOURCES.md       # 图标来源说明
│       └── device-assets.css / rack-management.css
│
├── scripts/                     # 构建 / 装配 / 验证脚本
│   ├── prepare-netcatty.mjs     # ★ 装配脚本：注入 cmdb 到 Netcatty 源码
│   ├── prepare-netcatty.test.mjs
│   ├── netcatty-settings-integration.mjs  # 设置页集成补丁
│   ├── netcatty-update-integration.mjs    # 更新模块集成
│   ├── start-native-preview.cjs # 本地预览启动器
│   ├── verify-native-*.mjs      # 自动化验收脚本
│   └── check-version.mjs        # 版本格式与 tag 一致性校验
│
├── probes/                      # 操作系统探针
│   ├── kylin_probe.sh           # 麒麟探针
│   └── uos_probe.sh             # 统信 UOS 探针
│
├── cli/cmdb_cli.py              # CLI 管理工具
├── netcatty/                    # 主机同步脚本与 Cmdb 扩展元数据
├── docs/                        # 验收清单、拓扑与原型文档
└── .github/                     # CI、Windows 发布、PR 模板与发布说明分组
```

---

## 二、系统拓扑

```
┌──────────────────────────────────────────────────────────────────┐
│  Netcatty 桌面客户端 (Electron)                                   │
│                                                                  │
│  ┌─────────────┐   ┌──────────────────────────────────────────┐ │
│  │  CmdbSurface │──▶│  CmdbWorkspace (模块路由)                 │ │
│  │  侧栏导航    │   │                                          │ │
│  │  ┌─────────┐ │   │  ┌────────────┐  ┌────────────────────┐ │ │
│  │  │设备资产  │─┼──▶│  │DeviceAssets│  │ 终端资产            │ │ │
│  │  │组织架构  │ │   │  │  统一搜索   │  │ 基础设施            │ │ │
│  │  │机柜与网络│ │   │  │  三子页切换 │  │ 业务系统            │ │ │
│  │  │工单与统计│ │   │  └────────────┘  └────────────────────┘ │ │
│  │  └─────────┘ │   │  ┌────────────┐  ┌────────────────────┐ │ │
│  └─────────────┘   │  │People      │  │ IPAM (机柜+网络)    │ │ │
│                     │  │组织架构    │  │ RackOverview        │ │ │
│                     │  └────────────┘  │ NetworkAddress      │ │ │
│                     │  ┌────────────┐  └────────────────────┘ │ │
│                     │  │WorkOrders  │                          │ │
│                     │  │工单与统计  │                          │ │
│                     │  └────────────┘                          │ │
│                     └──────────────────────────────────────────┘ │
│                              │                                   │
│                     core/api.js (144 方法)                        │
│                     core/transport.js (fetch)                    │
│                              │                                   │
│  adapter/ ◄── Netcatty 密钥库 / SSH / Telnet                     │
│  CmdbCloudSync ◄── 云同步快照                                    │
└──────────────┬───────────────────────────────────────────────────┘
               │  HTTP JSON (127.0.0.1:port)
               ▼
┌──────────────────────────────────────────────────────────────────┐
│  Go HTTP 服务 (main.go)                                          │
│                                                                  │
│  server.go  RegisterRoutes(mux)  ~120 条路由                     │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ Handler 层                                                   ││
│  │  server_cmdb*.go        终端/基础设施/业务系统                ││
│  │  server_cmdb_modules.go 工单/统计/导出                       ││
│  │  server_ip_pool.go      IPAM                                 ││
│  │  server_cmdb_taxonomy.go 分类目录                            ││
│  │  server_*attachment*.go  附件/照片                            ││
│  │  server_rack_*.go        机柜                                ││
│  └──────────────────────────────────────────────────────────────┘│
│                              │                                   │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ store/  数据访问层 (DAL)                                     ││
│  │  store.go           Open → 迁移 → *Store                    ││
│  │  project_schema.go  DDL + 目录补全 + 型号反填                ││
│  │  legacy_store.go    终端资产 CRUD (74KB)                     ││
│  │  cmdb_store.go      基础设施读取                             ││
│  │  cmdb_write.go      基础设施写入（事务内型号自动收录）        ││
│  │  project_scope_modules_store.go  工单 CRUD + 状态流转        ││
│  │  ip_pool.go         IP 地址池 (49KB)                         ││
│  │  person_store.go    人员                                     ││
│  │  config_store.go    组织/分类/规则                            ││
│  │  rack_*.go          机柜/U位/迁移                            ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────┬───────────────────────────────────────────────────┘
               │  SQL (单连接 MaxOpenConns=1)
               ▼
          ┌──────────┐
          │ assets.db │  SQLite WAL + FK
          │  ~50 张表  │
          └──────────┘
```

### 装配流程

```
scripts/prepare-netcatty.mjs --target <netcatty-source>
  1. 校验 upstream.json 锁定的 commit
  2. 复制 integrations/netcatty/cmdb/ → <target>/components/cmdb/
  3. 复制 CmdbSurface.tsx → <target>/components/
  4. 注入 Cmdb 标签到 TopTabs.tsx（根标签栏）
  5. 注入设置页 Cmdb 分区到 SettingsPage.jsx
  6. 注入 Electron main.cjs 中 Cmdb 服务启动/停止逻辑
  7. 补丁更新模块（自动更新 Cmdb 二进制）
```

---

## 三、数据流与请求链路

### 启动链路

```
main.go
  └→ store.Open(dbPath)
       ├→ sql.Open("sqlite", dsn)       [WAL + FK + busy_timeout]
       ├→ NeedsProjectMigration?        [版本检测]
       │   └→ BackupDatabase            [迁移前自动备份]
       ├→ MigrateProjectSchema          [DDL + 目录补全 + 型号反填]
       │   ├→ seedDefaultAssetCategories [终端/基础设施类型补齐]
       │   ├→ backfillAssetModels        [从真实资产反填型号库]
       │   └→ createAssetModelCatalogTriggers [写入时自动收录新型号]
       └→ SeedIPSubnetsFromPool         [IP 子网初始化]
  └→ internal.Server{Store}
  └→ RegisterRoutes(mux)                [~120 条路由]
  └→ http.Serve(127.0.0.1:port)
```

### 请求处理链路

| 层 | 职责 | 关键约定 |
|---|---|---|
| **Transport** (`core/transport.js`) | `fetch` → JSON 解析 → 错误抛出 | 所有请求 `Content-Type: application/json` |
| **API** (`core/api.js`) | 144 个方法映射 120+ 条后端路由 | 分页 `page` + `page_size`；筛选 `keyword`/`dept`/`status` |
| **Handler** (`server*.go`) | 解析请求 → 校验 → 调 store → 返回 JSON | 项目隔离 `requestProjectScope(r)`；错误 `writeErr(w, 4xx)` |
| **Store** (`store/*.go`) | 事务内 SQL → 返回结构体 | 单连接 `SetMaxOpenConns(1)`；写操作在事务内 |
| **SQLite** (`assets.db`) | WAL 模式 + FK 约束 | `cmdb_` 前缀（新模型）vs 无前缀（旧终端） |

---

## 四、核心数据模型

### 主要表结构

| 表 | 对应页面 | 关键字段 |
|---|---|---|
| `assets` | 终端资产 | asset_code, device_type, box_sn, ip, terminal_ip, department, room, status |
| `cmdb_assets` | 基础设施 | asset_code, device_type, vendor, model, mgmt_ip, biz_ip, category_id |
| `cmdb_asset_interfaces` | 基础设施网口 | asset_id, name, ip, mac, gateway, network_zone, main_ip_purpose |
| `cmdb_device_categories` | 设备类型目录 | name, scope (terminal/infrastructure), parent_id, sort_order |
| `cmdb_device_models` | 型号库 | vendor, model, height_u, rated_power_w |
| `server_apps` | 业务系统 | app_name, app_type, version, service_ip, url, status, cmdb_asset_id |
| `cmdb_persons` | 人员 | name, department, group_id |
| `cmdb_groups` | 组织架构 | name, parent_id, sort_order |
| `ip_pool` | IPAM | ip, subnet_id, status, owner_type, asset_id, ip_field |
| `ip_subnet` | 子网定义 | cidr, name, zone |
| `cmdb_work_orders` | 工单 | order_no, subject, status, priority, biz_type |
| `cmdb_work_order_asset_links` | 工单↔资产 | work_order_id, asset_type, asset_id, asset_name |
| `cmdb_work_order_logs` | 工单履历 | work_order_id, action, content |
| `cmdb_work_order_attachments` | 工单附件 | work_order_id, file_name, hash |
| `cmdb_netcatty_links` | Netcatty 连接 | asset_type, asset_id, host_name, protocol |
| `asset_logs` | 运维履历 | asset_id, operation, operator, details |
| `cmdb_labels` | 资产标签 | asset_type, asset_id, code, status |
| `cmdb_asset_images` | 设备照片 | kind, asset_id, side, data |
| `rack_cabinets` | 机柜 | data_center, floor, name, total_u |
| `cmdb_custom_fields` | 自定义字段 | field_key, field_name, scope |

---

## 五、双 IP 逻辑

系统中有两类资产涉及多 IP 地址：

### 1. 终端资产双 IP（云桌面设备）

**判定规则**：设备类型名称包含"云桌面""云盒"或"盒子"的设备视为云桌面设备。

```
state.js:isCloudDevice(value)  →  /云桌面|云盒|盒子/.test(value)
```

| 设备类型 | 显示字段 | 数据库字段 | IPAM ip_field |
|---|---|---|---|
| 云桌面终端/云桌面盒子/云盒 | 业务/虚拟机 IP + 终端物理 IP | `assets.ip` + `assets.terminal_ip` | `ip` / `terminal_ip` |
| 台式电脑/笔记本/打印机等 | 设备 IP | `assets.ip`（`terminal_ip` 清空） | `ip` |

**切换规则**：编辑时把云桌面改为普通设备 → `normalizeAsset()` 自动清空 `display_sn` 和 `terminal_ip`。

### 2. 基础设施双 IP（服务器/网络设备）

**字段结构**：

| 字段 | 含义 | 对应 UI 标签 | IPAM ip_field |
|---|---|---|---|
| `cmdb_assets.mgmt_ip` | 管理口 IP（默认连接地址） | 管理 IP | `mgmt_ip` |
| `cmdb_assets.biz_ip` | 业务口 IP（兼容字段） | 业务 IP | `biz_ip` |
| `cmdb_assets.public_ip` | 公网 IP | 公网 IP | `public_ip` |
| `cmdb_asset_interfaces.ip` | 网口级别 IP（每个接口独立） | 接口名 + IP | — |

**层次关系**：

```
基础设施资产
├── 管理 IP (mgmt_ip)          ← 默认连接地址，用于 Netcatty SSH/Telnet
├── 业务 IP (biz_ip)           ← 兼容字段，业务流量地址
├── 公网 IP (public_ip)        ← 可选
└── 网络接口 (interfaces[])
    ├── eth0: ip, mac, gateway, network_zone, main_ip_purpose
    │   └── additional_ips_json: [{ip, purpose, ...}]  ← 一个接口可绑多个地址
    ├── eth1: ...
    └── ...
```

**地址用途标签** (`main_ip_purpose`)：
- `management` — 管理地址（与顶层 mgmt_ip 一致时自动标记）
- `business` — 业务地址
- `out_of_band` — 带外管理
- `business_out_of_band` — 兼做业务和带外

**网络地址行计算** (`infrastructureEditorModel.js:networkAddressRows`)：

```javascript
// 1. 先将 mgmt_ip 作为"管理"地址加入
add(asset.mgmt_ip, 'management', { network_zone: asset.net_type })
// 2. 将 biz_ip 作为"业务"地址加入
add(asset.biz_ip, 'business')
// 3. 遍历每个接口的主 IP 和附加地址
for (iface of asset.interfaces) {
  add(iface.ip, purpose, iface)           // 接口主地址
  for (addr of iface.additional_ips_json)  // 接口附加地址
    add(addr.ip, addr.purpose, iface)
}
// 去重：相同 IP 合并用途标签
```

**IPAM 分配时地址用途选择**（`NetworkAddressWorkspace.jsx`）：

```
基础设施资产 → 可选: 管理 IP / 业务 IP / 公网 IP
终端云桌面   → 可选: 业务/虚拟机 IP / 终端物理 IP
终端普通设备 → 固定: 设备 IP
业务系统     → 固定: 业务 IP
```

**Netcatty 连接默认地址**：始终优先使用 `mgmt_ip`（管理口），修改管理 IP 时自动同步跟随的 Netcatty 主机目标地址。

### 3. 业务系统 IP

| 字段 | 含义 |
|---|---|
| `server_apps.service_ip` | 业务系统自身 IP（非承载设备管理 IP） |
| `server_apps.url` | 访问地址 |
| 承载设备的 `mgmt_ip` / `biz_ip` | 通过 `cmdb_asset_id` 关联查看 |

---

## 六、前端模块导航逻辑

### 模块定义 (`state.js`)

```javascript
const MODULES = [
  { key: 'assets',     label: '设备资产',   icon: 'Monitor' },
  { key: 'people',     label: '组织架构',   icon: 'Users' },
  { key: 'ip',         label: '机柜与网络', icon: 'Network' },
  { key: 'operations', label: '工单与统计', icon: 'ChartNoAxesCombined' },
]
```

### 搜索目标路由 (`resolveSearchTarget`)

```javascript
const SEARCH_TARGETS = {
  assets:      { module: 'assets', assetTab: 'terminals' },
  cmdb_assets: { module: 'assets', assetTab: 'infrastructure' },
  server_apps: { module: 'assets', assetTab: 'systems' },
  servers:     { module: 'assets', assetTab: 'systems' },
  persons:     { module: 'people' },
  asset_logs:  { module: 'operations' },
  ip_pool:     { module: 'ip' },
}
```

### 跨模块跳转

```
统一搜索 (DeviceAssets 顶部)
  ├─ tableKey=assets      → 终端资产详情
  ├─ tableKey=cmdb_assets → 基础设施工作区
  ├─ tableKey=server_apps → 业务系统详情
  ├─ tableKey=persons     → 人员详情
  ├─ tableKey=ip_pool     → IPAM 网络地址
  └─ tableKey=rack_cabinet→ 机柜视图

终端详情 → 关联基础设施 → 基础设施工作区
基础设施工作区 → 承载业务系统 → 业务系统详情
基础设施工作区 → IP 地址 → IPAM 网络地址
工单详情 → 关联资源按钮 → 终端/基础设施/业务系统

导航载体：focusTarget = { id, tableKey, ... }
          通过 onNavigate(result) → resolveSearchTarget → setActiveModule + setTab
```

### 快捷键

| 快捷键 | 功能 |
|---|---|
| `Ctrl+K` / `Cmd+K` | 聚焦设备资产统一搜索框 |

---

## 七、关键业务规则速查

| 规则 | 实现位置 |
|---|---|
| 云桌面设备显示双 IP，普通设备单 IP | `state.js:isCloudDevice` → `TerminalAssets.jsx` |
| 服务器管理口+业务口双 IP | `InfrastructureEditor.jsx:156-158` + `networkAddressRows()` |
| IPAM 分配地址用途随资产类型变化 | `NetworkAddressWorkspace.jsx:170-174` |
| 管理 IP 改变同步 Netcatty 主机目标 | `RackDeviceEditor.jsx:48-50` + `syncFollowingNetcattyHosts` |
| 注销归档保留记录+履历 | handler 标记 `deleted_at` + 写入 `asset_logs` |
| 导出不受当前页限制 | handler 去掉 `page_size` 参数，导出全部匹配 |
| 工单状态流转 新建→处理中→已解决→已关闭 | `project_scope_modules_store.go:validateWorkOrderStatusTransition` |
| 设备类型目录首次补全 | `project_schema.go:seedDefaultAssetCategories` + `_meta.cmdb_asset_catalog_seeded_v1` |
| 型号自动收录 | `cmdb_write.go` 写入事务触发器 `INSERT INTO cmdb_device_models` |
| IP 分配→更新资产 IP | `ip_pool.go` 同事务更新 `assets.ip` / `cmdb_assets.mgmt_ip` / `biz_ip` |
| 机柜 U 位定位 | `rack_location.go` + `RackView.jsx` 渲染机柜正面图 |
| 网口接口多地址 | `additional_ips_json` JSON 数组存储同一接口的附加 IP |

---

## 八、后端 API 路由总览

### 终端资产

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/assets` | 列表（分页/筛选） |
| GET | `/api/assets/{id}` | 详情 |
| GET | `/api/assets/{id}/relations` | 关联数据 |
| POST | `/api/assets` | 新增 |
| POST | `/api/assets/batch` | 批量导入 |
| PUT | `/api/assets/{id}` | 更新 |
| DELETE | `/api/assets/{id}` | 注销归档 |
| POST | `/api/assets/{id}/transfer` | 调换使用人 |
| POST | `/api/assets/{id}/maintenance` | 维修换件 |
| GET | `/api/export/assets` | 导出 |
| POST | `/api/import/assets` | 导入 |
| GET | `/api/template/assets` | 下载模板 |
| GET | `/api/assets/name-backfill` | 编码预览 |
| POST | `/api/assets/name-backfill` | 编码应用 |

### 基础设施

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/cmdb/assets` | 列表 |
| GET | `/api/cmdb/assets/{id}` | 详情 |
| POST | `/api/cmdb/assets` | 新增 |
| POST | `/api/cmdb/assets/batch` | 批量操作 |
| PUT | `/api/cmdb/assets/{id}` | 更新 |
| PUT | `/api/cmdb/assets/{id}/full` | 整体替换 |
| DELETE | `/api/cmdb/assets/{id}` | 删除 |
| GET | `/api/cmdb/assets/filters` | 筛选选项 |
| GET | `/api/cmdb/assets/export` | 导出 |
| POST | `/api/cmdb/assets/import` | 导入 |
| GET | `/api/cmdb/assets/template` | 下载模板 |
| GET | `/api/cmdb/assets/{id}/links` | 资产链路 |
| POST | `/api/cmdb/assets/{id}/links` | 创建链路 |
| GET | `/api/cmdb/assets/{id}/switch-snapshot` | 交换机快照 |
| PUT | `/api/cmdb/assets/{id}/switch-snapshot` | 更新快照 |
| GET | `/api/cmdb/asset-images/{kind}/{id}` | 设备照片 |
| PUT | `/api/cmdb/asset-images/{kind}/{id}` | 上传照片 |

### 业务系统

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/apps` | 列表 |
| GET | `/api/apps/{id}` | 详情 |
| POST | `/api/apps` | 新增 |
| PUT | `/api/apps/{id}` | 更新 |
| DELETE | `/api/apps/{id}` | 删除 |
| GET | `/api/apps/export` | 导出 |
| GET | `/api/servers/{id}/apps` | 承载应用 |

### 基础设施服务器

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/servers` | 列表 |
| GET | `/api/servers/{id}` | 详情 |
| POST | `/api/servers` | 新增 |
| PUT | `/api/servers/{id}` | 更新 |
| DELETE | `/api/servers/{id}` | 删除 |

### 工单管理

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/cmdb/work-orders` | 列表 |
| GET | `/api/cmdb/work-orders/{id}` | 详情 |
| POST | `/api/cmdb/work-orders` | 创建 |
| PUT | `/api/cmdb/work-orders/{id}` | 更新/状态流转 |
| POST | `/api/cmdb/work-orders/batch` | 批量关闭 |
| DELETE | `/api/cmdb/work-orders/{id}` | 删除 |
| GET | `/api/cmdb/work-orders/export` | 导出 |
| GET | `/api/cmdb/work-orders/template` | 下载模板 |
| POST | `/api/cmdb/work-orders/import` | 导入 |
| GET | `/api/cmdb/work-orders/{id}/logs` | 处理记录 |
| POST | `/api/cmdb/work-orders/{id}/logs` | 添加记录 |
| GET | `/api/cmdb/work-orders/{id}/attachments` | 附件列表 |
| POST | `/api/cmdb/work-orders/{id}/attachments` | 上传附件 |
| DELETE | `/api/cmdb/work-orders/{id}/attachments/{aid}` | 删除附件 |

### IPAM / 网段

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ip_pool` | IP 列表 |
| GET | `/api/ip_pool/summary` | 汇总 |
| GET | `/api/ip_pool/visualization` | CIDR 可视化 |
| POST | `/api/ip_pool` | 新增 |
| PUT | `/api/ip_pool/{id}` | 更新 |
| DELETE | `/api/ip_pool/{id}` | 删除 |
| POST | `/api/ip_pool/{id}/allocate` | 分配 IP |
| POST | `/api/ip_pool/{id}/release` | 释放 IP |
| GET | `/api/ip_pool/export` | 导出 |
| POST | `/api/ip_pool/import` | 导入 |
| GET | `/api/ip_subnets` | 子网列表 |
| POST | `/api/ip_subnets` | 新建子网 |
| PUT | `/api/ip_subnets/{id}` | 更新子网 |
| DELETE | `/api/ip_subnets/{id}` | 删除子网 |

### Netcatty 连接

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/cmdb/netcatty-links` | 连接列表 |
| GET | `/api/cmdb/netcatty-links/host-usage` | 主机使用情况 |
| POST | `/api/cmdb/netcatty-links` | 创建连接 |
| PUT | `/api/cmdb/netcatty-links/{id}` | 更新连接 |
| PUT | `/api/cmdb/netcatty-links/{id}/state` | 更新连接状态 |
| PUT | `/api/cmdb/netcatty-links/{id}/default` | 设为默认 |
| DELETE | `/api/cmdb/netcatty-links/{id}` | 删除连接 |

### 配置 / 分类 / 元数据

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/meta` | 全局元数据 |
| GET | `/api/cmdb/meta` | CMDB 元数据 |
| GET | `/api/cmdb/config/{kind}` | 配置项列表 |
| POST | `/api/cmdb/config/{kind}` | 新增配置 |
| PUT | `/api/cmdb/config/{kind}/{id}` | 更新配置 |
| DELETE | `/api/cmdb/config/{kind}/{id}` | 删除配置 |
| GET | `/api/cmdb/taxonomy/{kind}` | 分类树 |
| POST | `/api/cmdb/taxonomy/{kind}` | 新增分类 |
| PUT | `/api/cmdb/taxonomy/{kind}/{id}` | 更新分类 |
| DELETE | `/api/cmdb/taxonomy/{kind}/{id}` | 删除分类 |
| GET | `/api/cmdb/models` | 型号库 |
| POST | `/api/cmdb/models` | 新增型号 |
| PUT | `/api/cmdb/models/{id}` | 更新型号 |
| DELETE | `/api/cmdb/models/{id}` | 删除型号 |
| GET | `/api/cmdb/custom-fields` | 自定义字段 |
| POST | `/api/cmdb/custom-fields` | 保存自定义字段 |
| DELETE | `/api/cmdb/custom-fields/{id}` | 删除自定义字段 |

### 人员 / 组织

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/cmdb/persons` | 人员列表 |
| POST | `/api/cmdb/persons` | 新增 |
| PUT | `/api/cmdb/persons/{id}` | 更新 |
| DELETE | `/api/cmdb/persons/{id}` | 删除 |
| GET | `/api/cmdb/persons/{id}/assets` | 名下资产 |
| POST | `/api/cmdb/persons/transfer` | 批量交接 |
| GET | `/api/cmdb/config/org-tree` | 组织树 |

### 其他

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/search` | 全局搜索 |
| GET | `/api/stats` | 统计概览 |
| GET | `/api/cmdb/dashboard` | CMDB 仪表盘 |
| GET | `/api/logs` | 运维履历 |
| GET | `/api/cmdb/labels` | 资产标签 |
| GET | `/api/cmdb/credentials` | 凭据管理 |
| GET | `/api/cmdb/rack-migration` | 机柜迁移预览 |
| POST | `/api/cmdb/sync/legacy` | 旧数据同步 |
| POST | `/api/cmdb/sync/export` | 快照导出 |
| POST | `/api/cmdb/sync/preflight` | 同步预检 |
| POST | `/api/cmdb/sync/apply` | 同步应用 |
| GET | `/api/health` | 健康检查 |
