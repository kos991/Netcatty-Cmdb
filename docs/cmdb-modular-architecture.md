# CMDB 模块化重构与独立扩展标准规范

## 1. 架构定位

- **形态**：标准的 Netcatty 独立扩展/插件（Plugin / Extension），打包为标准 `.ncpkg` 格式，支持双平台/多平台离线分发。
- **跨平台适配**：完整支持 Windows (x64) 以及 Linux（统信 UOS、银河麒麟、中科方德等国产 Linux 发行版，支持 x86_64 与 aarch64 双架构）。
- **界面风格**：严格沿用 Netcatty 原生风格（Tailwind + Radix UI + Lucide），适配宿主暗黑/明亮主题与 CSS 变量。
- **模块关系**：由原先平铺混乱的单目录，梳理为高内聚、低耦合的分层架构。

---

## 2. 跨平台伴随架构（Linux & Windows）

Netcatty 的 Companion 机制允许在同一个 `.ncpkg` 插件包中声明多平台的伴随可执行文件（`variants`）：

```json
"companionExecutables": [
  {
    "id": "com.netcatty.cmdb.server",
    "variants": [
      {
        "path": "backend/cmdb-server.exe",
        "platforms": ["win32-x64"],
        "sha256": "..."
      },
      {
        "path": "backend/cmdb-server-linux-amd64",
        "platforms": ["linux-x64"],
        "sha256": "..."
      },
      {
        "path": "backend/cmdb-server-linux-arm64",
        "platforms": ["linux-arm64"],
        "sha256": "..."
      }
    ]
  }
]
```

### 运行时自动适配机制（`embed_loader.js`）
1. **架构与平台识别**：根据 `process.platform` 与 `process.arch` 自动选择对应的二进制可执行文件；
2. **Linux 权限自修复**：在 Linux / 国产 OS 下自动执行 `chmod 0755`，防止因打包解压导致的执行位缺失；
3. **安全生命周期**：伴随宿主退出自动执行 `SIGTERM/kill`，杜绝后台残留。

---

## 3. 代码分层与模块关系

```text
integrations/netcatty/cmdb/
├── core/                        # 核心支撑层（通信与基础状态）
│   ├── api.js                   # REST API 统一调用封装
│   ├── hooks.js                 # 通用 hooks (useQuery, useAction, useDirectory)
│   ├── state.js                 # 核心状态机与数据规格化
│   └── transport.js             # 传输状态与原生状态探测
├── ui/                          # 基础原子 UI（保持现有视觉风格）
│   ├── ui.jsx                   # DataTable, ModalForm, SearchBox, SelectControl, Toolbar
│   ├── Fields.jsx               # 表单基础字段
│   ├── Labels.jsx               # 标签体系
│   └── AssetFilterPicker.jsx    # 高级多字段动态筛选器
├── adapter/                     # Netcatty 宿主连接适配层
│   ├── NetcattyConnection.js    # 连接桥接与联动
│   ├── NetcattyConnectionFields.jsx # 连接表单
│   ├── NetcattyDirectory.jsx    # 主机/密钥目录注入
│   ├── NetcattyLinks.jsx        # 资产连接卡片
│   ├── netcattyVaultActions.js  # 密钥库联动
│   └── readTelnetConfiguration.js # Telnet 自动化读取
├── modules/                     # 五大核心业务域
│   ├── assets/                  # 1. 资产域
│   │   ├── DeviceAssets.jsx     # 资产综合总控入口
│   │   ├── TerminalAssets.jsx   # 终端资产主视图
│   │   ├── Infrastructure.jsx   # 基础设施主视图
│   │   ├── InfrastructureEditor.jsx # 基础设施编辑表单
│   │   ├── InfrastructureQuickConnect.jsx # 管理 IP 快速连接
│   │   ├── Systems.jsx          # 业务系统主视图
│   │   ├── AssetPanel.jsx       # 资产详情抽屉
│   │   ├── AssetTransferMenu.jsx # 资产交接调换
│   │   ├── DeviceImages.jsx     # 资产照片
│   │   ├── DeviceRelations.jsx  # 资产关联穿透
│   │   ├── DeviceOwnershipBar.jsx # 资产归属条
│   │   ├── OperatingSystemCell.jsx # 操作系统标签
│   │   ├── models/              # 资产模型逻辑
│   │   ├── taxonomy/            # 分类树、厂商型号与品牌图标
│   │   └── workspace/           # 设备工作区与交换机端口面板
│   ├── org/                     # 2. 组织人员域
│   │   ├── Organizations.jsx    # 组织机构树管理
│   │   └── People.jsx           # 人员档案与名下资产联动
│   ├── ipam/                    # 3. IPAM 域
│   │   └── IPAM.jsx             # IP 规划池、网段容量与双向联动
│   ├── workorders/              # 4. 工单履历域
│   │   ├── WorkOrders.jsx       # 工单工作台
│   │   ├── WorkOrderList.jsx    # 工单列表
│   │   ├── Operations.jsx       # 运维看板
│   │   ├── RouterOperations.jsx # 路由器运维
│   │   └── ServerOperations.jsx # 服务器运维
│   └── settings/                # 5. 配置中心域
│       ├── ConfigCenter.jsx     # 项目配置与数据维护
│       ├── Credentials.jsx      # 凭证中心
│       └── ImportDialog.jsx     # 批量导入弹窗
├── CmdbWorkspace.jsx            # CMDB 顶层工作区容器
└── index.js                     # 模块聚合入口
```

---

## 4. 打包与产物验证

```bash
# 执行打包生成多平台 .ncpkg
node scripts/pack-cmdb-plugin.mjs
# 输出文件：build/netcatty-cmdb-1.3.0.ncpkg (内部包含 win32-x64, linux-x64, linux-arm64 全架构二进制)
```
