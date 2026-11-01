# Cmdb GPUI 原生桌面架构

## 当前版本状态

**当前版本**：`1.0.202610221542`

现有正式架构为 **Netcatty + Go/SQLite**，集成运行在 Netcatty 桌面客户端中。本文档规划后续的 **Rust + GPUI** 原生桌面版本架构，仅为设计规划，尚未启动实施。

## 设计目标

- 原生 Windows/macOS/Linux 可执行程序，使用 Rust + GPUI 框架
- 保留现有功能完整性：资产、组织、IP、机柜、工单、履历、配置
- 界面交互沿用已确认的原型设计
- 数据持久化、同步、认证等保留或升级

## 四层架构

```
┌─────────────────────────────────────┐
│   cmdb-desktop (GPUI桌面进程)        │  用户界面、窗口管理、交互
│   - 顶栏：Logo、标签页、+、控制按钮 │  - 资产、组织、机柜、地址池、工单页面
│   - 下方沿用原型布局                │  - 关联导航、详情展开
└──────────────┬──────────────────────┘
               │ IPC 或 HTTP
┌──────────────▼──────────────────────┐
│   cmdb-agent (本地采集代理)           │  权限隔离、系统操作
│   - 终端连接、命令执行              │  - 凭证存储、密钥调用
│   - 主机信息采集                    │  - 文件导入导出
└──────────────┬──────────────────────┘
               │ HTTP 18080
┌──────────────▼──────────────────────┐
│   cmdbd (业务服务进程)               │  资产与配置管理
│   - 资产 CRUD、组织维护             │  - IP 分配与占用跟踪
│   - 机柜容量、U位冲突防护           │  - 工单状态流转、履历记录
│   - 配置目录维护                    │  - 同步、备份、导入导出
└──────────────┬──────────────────────┘
               │ Rust 库调用
┌──────────────▼──────────────────────┐
│   cmdb-engine (共用业务规则库)       │  关联、验证、计算
│   - 资产与人员、IP、机柜的关联      │  - IP 占用冲突检测、U位越界检测
│   - 工单状态转移验证                │  - 机房、机柜、位置的树形维护
│   - 日期、数据转换、加密            │
└─────────────────────────────────────┘
```

### 层级职责

#### 1. cmdb-desktop (GPUI 桌面进程)

- **职责**：用户交互、界面渲染、窗口生命周期
- **通信**：调用 `cmdbd` HTTP API（默认 `http://127.0.0.1:18080`）
- **窗口**：
  - 顶栏：Logo、标签页（设备资产、组织架构、机柜、地址池、工单）、`+` 新建、最小化、最大化／还原、关闭
  - 左侧导航：资产分类、配置、帮助
  - 主体：各业务页面沿用现有原型布局（三资产列表、详情右栏420px、机柜三柜等分、地址池摘要卡片）
  - 业务操作：新增、编辑、关联、导出、筛选等保留在各业务页面
- **数据绑定**：实时同步后端状态，不缓存业务数据

#### 2. cmdb-agent (本地采集代理)

- **职责**：需要本机权限的操作，隔离风险
- **通信**：接收 `cmdbd` 或 `cmdb-desktop` 的请求
- **功能**：
  - SSH 连接、命令执行、SFTP 文件传输（可选，暂不实施）
  - 凭证调用（密钥库）
  - 主机信息采集（操作系统、网络、硬件）
  - 文件导入导出、备份还原
  - 日志收集与诊断
- **生命周期**：随 `cmdb-desktop` 启动，由主进程管理

#### 3. cmdbd (业务服务进程)

- **职责**：资产、配置、工单、履历等业务逻辑
- **入口**：HTTP API，监听 `127.0.0.1:18080`
- **数据**：SQLite 数据库（位置可配置，默认用户数据目录）
- **功能**：
  - 资产 CRUD（终端、基础设施、业务系统）
  - 组织架构维护、人员与部门关系
  - 地址池管理、IP 占用跟踪
  - 机房、机柜、U 位管理
  - 工单创建、状态流转、处理时间计算
  - 运维履历记录与查询
  - 配置目录维护（资产类型、工单分类、导入模板等）
  - 导入导出、备份恢复
- **调用**：使用 `cmdb-engine` 库进行验证和计算
- **生命周期**：由 `cmdb-desktop` 主进程启动、监管、退出时回收

#### 4. cmdb-engine (共用业务规则库)

- **职责**：不涉及存储或网络的业务规则
- **属性**：Rust 库，编译链接到 `cmdbd` 与 `cmdb-agent`
- **功能**：
  - 资产与人员、IP、机柜的关联规则
  - IP 占用冲突检测、U 位越界检测
  - 工单状态转移合法性验证
  - 机房树、机柜列表、地址池树的维护算法
  - 日期计算、时区处理、加密工具
  - 导入数据预验证
- **不包含**：数据库操作、HTTP 调用、UI 渲染、文件 I/O（由上层负责）

## 通信协议

### Desktop ↔ Backend (HTTP)

```
GET /api/assets?type=terminal&page=1&limit=10
GET /api/assets/{id}
POST /api/assets
PATCH /api/assets/{id}
DELETE /api/assets/{id}

GET /api/organizations
GET /api/organizations/{id}/people
POST /api/organizations
PATCH /api/organizations/{id}

GET /api/ip-pools?category=core
GET /api/ip-pools/{id}/addresses
POST /api/ip-pools/{id}/addresses
PATCH /api/ip-pools/{id}/addresses/{addr}

GET /api/racks
GET /api/racks/{id}
POST /api/racks/{id}/devices
PATCH /api/racks/{id}/devices/{deviceId}

GET /api/work-orders?status=open
POST /api/work-orders
PATCH /api/work-orders/{id}/status

GET /api/config/asset-types
POST /api/config/asset-types
```

### Backend → Agent (按需)

```
POST /agent/ssh-connect
POST /agent/cmd-exec
POST /agent/file-import
GET /agent/system-info
```

## 界面设计

### 顶栏（36–40px 高）

```
┌──────────────────────────────────────────────────────┐
│ [◐] [资产全景 ✕] [设备资产 ✕] [机柜 · 核心机房A02 ✕] [+] │  ⊖  ◲  ✕
└──────────────────────────────────────────────────────┘
```

- **Logo**：固定左上，约 16×16px，旋转动画（可选）
- **标签页**：可切换、可关闭，长名称截断
- **`+` 按钮**：打开"新增业务"菜单（资产、人员、机柜、工单等）
- **窗口控制**：最小化、最大化/还原、关闭，右对齐

### 下方主体

**沿用现有原型**，不重新设计：

- **资产列表**：终端、基础设施、业务系统，保留筛选、排序、分页
- **资产详情**：右侧 420px 可拖拖宽，关联导航链接到人员、机柜、IP
- **机柜**：三柜等分或按可见宽度分组，每 U 24px，端口在设备边界内
  - 1U 设备：24px 单行，隐藏型号副行，名称与端口紧凑
  - 2U 及以上：保留副行
  - U 位标尺独立，不与端口重叠
- **组织架构**：树形结构、人员列表、名下资产链接
- **地址池**：可展开摘要卡片、分段统计、IP 分配面板
- **工单**：按状态流转展示，新建→处理中→已解决→已关闭，处理时间自动计算
- **配置**：资产类型、工单分类、导入模板、项目设置、同步维护

## 数据库设计

使用 SQLite，表结构沿用 Go 版本（见 `internal/store/`），支持：

- `assets` / `asset_terminals` / `asset_infrastructure` / `asset_applications`
- `organizations` / `departments` / `people`
- `ip_pools` / `ip_addresses`
- `racks` / `rack_devices` / `rack_connections`
- `work_orders` / `work_order_records`
- `asset_history` / `maintenance_records`
- `config_asset_types` / `config_work_categories` / `config_import_templates`

迁移策略：存量 Go 版本的 `assets.db` 可直接使用，Rust 版本读取现有表并支持增量同步。

## 版本同步与发布

- **开发版**：`cmdb-desktop`、`cmdbd`、`cmdb-agent` 分别编译测试
- **集成测试**：三进程协同运行，验证 API 调用链、数据一致性、错误处理
- **发布**：Windows x64、macOS (Intel/Apple Silicon)、Linux (x64)
- **版本号**：格式同 `1.0.YYYYMMDDHHmm`，`VERSION` 文件一源

## 现有代码复用

- **Go 版本 API 规范**：`internal/server.go` 定义的路由与响应格式
- **数据模型**：`internal/store/` 的表结构与字段
- **业务规则**：关联、IP 冲突、U 位检测、工单流转等逻辑可参考 Go 实现或用 Rust 重写 `cmdb-engine`
- **原型设计**：`docs/prototypes/cmdb/` 的界面交互、字段排布、样式参数

## 已知限制与待定项

- **目前尚未启动**：本文档为规划，Rust 代码不存在
- **工具链**：需配置 Rust 1.70+、cargo、MSVC / GCC 编译器
- **认证与加密**：暂未定义（可复用 Go 版本的密钥库集成或 Netcatty 的凭证管理）
- **云同步**：暂不实施，可保留本地数据库架构为后续扩展预留
- **跨进程通信**：暂定 HTTP，可考虑升级为 gRPC
- **热更新**：不支持（发布新版本需重启）

## 后续步骤

1. **架构确认**：收集反馈，确定四层模块边界、通信方式
2. **Rust 项目初始化**：创建 `cmdb-desktop`、`cmdbd`、`cmdb-agent`、`cmdb-engine` 四个 crate
3. **API 适配**：Rust 版本 `cmdbd` 实现 Go 版本的所有 HTTP 端点
4. **UI 实现**：GPUI 绑定原型设计，逐页面集成
5. **集成测试**：三进程协同验证，数据一致性、错误恢复
6. **发布验证**：打包、签名、CI/CD 流程
