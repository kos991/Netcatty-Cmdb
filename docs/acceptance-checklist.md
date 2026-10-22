# Cmdb 正确分支验收清单

本清单用于在隔离测试机上自测 `ci/native-settings-test-20261009` 分支的原生 Cmdb 客户端。所有操作只使用 `build/` 下的隔离产物与独立数据库，不读取、不写入正式安装数据。

## 一、准备（一次性）

在仓库根目录执行：

```powershell
# 1. 在锁定提交 d7a0c8ed 的干净宿主检出目录装配（不可重复向已装配目录打补丁）
node scripts/prepare-netcatty.mjs --target build/netcatty-prototype-layout

# 编译原生客户端资源；不要只装配源码却启动旧 dist
Push-Location build/netcatty-prototype-layout
npm.cmd run build
Pop-Location

# 2. 编译内置 Cmdb 服务
go build -trimpath -o build/cmdb-server-prototype-ci.exe .

# 3. 准备纯净基线数据库（验收数据的重置来源，勿指向正式数据）
Copy-Item build/ci-rack-preview/assets.db build/acceptance-base.db

# 4. 准备 Electron 运行时（本机已有缓存时解压即可）
Expand-Archive "$env:LOCALAPPDATA\electron\Cache\<hash>\electron-v42.3.3-win32-x64.zip" build\electron-runtime-preview -Force
```

## 二、启动

```powershell
# 日常重启：保留你已经修改的测试数据
node scripts/start-acceptance-preview.cjs

# 仅在明确需要丢弃本轮测试修改时：先完全退出测试机，再重置数据
node scripts/start-acceptance-preview.cjs --seed
```

启动后：顶部根标签点 **Cmdb**，默认进入「设备资产」。

- Cmdb 服务：`http://127.0.0.1:18974`
- 数据文件：`build/prototype-ci-preview/assets.db`
- 启动日志：`build/prototype-ci-preview/preview-stdout.log` / `preview-stderr.log`
- 当前客户端构建：`build/netcatty-prototype-layout`。日常启动脚本已指向此目录，不再启动旧 `netcatty-prototype-ci` 产物。
- [机柜测试机截图](../build/prototype-ci-preview/visual-acceptance/rack-native.png)、[工单测试机截图](../build/prototype-ci-preview/visual-acceptance/work-orders-native.png)、[三种宽度的测量记录](../build/prototype-ci-preview/visual-acceptance/layout-metrics.json)。
- 可双击 `build/启动原型验收测试机.cmd` 重开测试机（请先退出已经运行的窗口）；这个入口不带 `--seed`，保留你的验收修改。

重新灌数据：先退出客户端，再执行 `node scripts/seed-acceptance-data.cjs`（会从基线重建数据库，可重复执行）。

### 云桌面品牌型号与系统版本回归

在隔离测试客户端已启动并开放调试端口后运行（禁止连接正式 profile）：

```powershell
$env:NETCATTY_SMOKE_PLAYWRIGHT = 'C:/Users/Public/pwtemp/node_modules/playwright/test' # 改为本机 playwright/test 实际路径
$env:NETCATTY_SMOKE_DEBUG_URL = 'http://127.0.0.1:9254'
$env:NETCATTY_SMOKE_DATA = "$PWD/build/native-ui-preview" # 必须与隔离服务数据目录一致
node scripts/verify-native-terminal-fields.mjs
```

脚本先核对隔离存储路径且云同步关闭，再新增明确标记的验收云桌面，实际录入品牌、型号、统信 UOS 和版本；切换基本/硬件/网络页签后保存，API 与重新打开编辑均回读校验，并保存草稿和保存后截图。仅写隔离数据库；不连接真实主机，不为真实终端推测品牌、型号或版本。

## 三、验收项

### 1. 终端资产硬件信息（本轮重点）

| 步骤 | 期望 |
| --- | --- |
| 设备资产 → 终端资产，点「验收台式机」名称打开详情 | 「硬件信息」页签显示 品牌/厂商 联想、型号 ThinkCentre M90t、CPU 配置 Intel Core i5-12500、内存（MB）16384、硬盘/磁盘配置 512 GB SSD |
| 点「验收笔记本」名称打开详情 | 显示 Dell / Latitude 5440 / Intel Core i5-1345U / 16384 / 1 TB SSD |
| 点详情右上角铅笔进入编辑 | 同样出现硬件信息区块且值一致；改值保存后重新打开仍保留 |
| 查看打印机等非台式/笔记本设备（可先新增打印机类资产） | 不显示计算类硬件字段 |

### 2. IP 后的 Netcatty 连接入口（本轮重点）

| 步骤 | 期望 |
| --- | --- |
| 终端资产列表，悬停 IP 后的终端小图标 | 提示「使用 Netcatty 连接 <IP>」 |
| 点该图标 | 弹出「关联主机并连接」，显示所点地址与实际目标；未关联时可选或新建主机后连接 |
| 打开详情 → 网络配置 | 每个有效 IP 后同样有终端小图标 |
| 新增一台 IP 非法的终端（如 `192.168.10`） | 不显示连接图标 |

### 3. 业务系统注销归档

| 步骤 | 期望 |
| --- | --- |
| 设备资产 → 业务系统，对「验收业务系统」点注销归档并确认 | 提示已注销归档，列表默认不再显示该行 |
| 勾选「含已注销」或按状态筛选「已注销」 | 可查回该行，资料仍在 |
| 打开其详情 → 运维履历 | 有「注销归档」记录，且创建记录仍在 |

### 4. 机柜与网络

| 步骤 | 期望 |
| --- | --- |
| 机柜与网络 → 机柜，右侧目录选「验收主机房」的机柜 | 目录显示 A01、A02（各42U），管理区与设备属性同时保留 |
| 选 A01 | 机柜图显示 4 台已上架设备：验收核心交换机 39–40U、验收接入交换机 36U、验收虚拟化物理服务器 21–22U、验收超融合一体机 10–13U；摘要「已用 9U · 空闲 33U · 已上架 4 台」 |
| 选 A02 | 显示 验收下一代防火墙 30U、验收网络准入系统 28U、验收文件存储阵列 9–12U |
| 桌面工具栏 | 横向小图标“机柜／网络”二级导航和搜索；无重复新增管理按钮 |
| 三栏常驻 | 窄机柜图最大400px、设备属性/照片、右侧机房机柜管理同时显示；1240px以下管理下置，720px以下单列，不隐藏或替换 |
| 机柜与网络 → 地址池 | 有「验收内网业务地址池 192.168.10.0/24（内网）」和「验收专网地址池 10.20.30.0/24（专网）」；方格视图显示 192.168.10.201/202/203 已占用、.211 空闲 |
| 点已占用地址 | 可看到占用对象（验收台式机/笔记本/业务系统），预留/分配/释放可用 |
| 先录入服务器接口的附加业务 IP，由业务系统引用该地址，再新建覆盖该地址的网段（或为已有网段补 CIDR） | IPAM 归属仍为当前项目的基础设施，服务器可再次保存，原应用和新应用均可共享该业务 IP；不影响其他项目同 IP 的归属 |
| 历史终端、服务器、基础设施或应用留有 NULL 负责人/部门/机房等文本字段，且其地址不在目标网段内，再新建或编辑目标网段 | 网段正常保存，不回填网段外地址；有效的非空字段保持原值 |
| 在机柜属性、照片、机房/机柜或地址池/IP 保存请求未结束时，点击宿主其他模块；若放弃切换确认已打开则尝试确认 | 保存中侧栏模块不可选择，确认不能卸载当前页面；失败后原编辑内容与错误仍可见，保存结束才可切换。仅有未保存修改且无请求时仍保留放弃确认；机柜内切换地址池同样不能绕过保存中保护 |

### 5. 基础设施（基础设备）

设备资产 → 资产类别选「基础设施」，应看到以下类型（含原库交换机共 24 台）：

| 设备 | 类型 | 品牌 / 型号 | 位置 |
| --- | --- | --- | --- |
| 验收核心交换机 | 交换机 | H3C / S6850-56HF | 验收主机房 · A01 · 39–40U |
| 验收接入交换机 | 交换机 | 华为 / S5735-L48T4X | 验收主机房 · A01 · 36U |
| 验收虚拟化物理服务器 | 物理服务器 | Dell / PowerEdge R750 | 验收主机房 · A01 · 21–22U |
| 验收数据库物理服务器 | 物理服务器 | H3C / UniServer R4900 G5 | 验收主机房 · 未分配机柜（起始 U=0） |
| 验收下一代防火墙 | 安全设备 | 深信服 / AF-2000-B2100 | 验收主机房 · A02 · 30U |
| 验收网络准入系统 | 安全设备 | 深信服 / SIP-1000-B1200 | 验收主机房 · A02 · 28U |
| 验收文件存储阵列 | 存储设备 | 华为 / OceanStor 5300 | 验收主机房 · A02 · 9–12U |
| 验收超融合一体机 | 超融合 | 深信服 / aCloud HCI-2205 | 验收主机房 · A01 · 10–13U |
| 验收应用虚拟机 | virtual_machine | 不适用 | 无实体位置（虚拟机不显示机柜） |
| 验收已注销历史服务器 | 物理服务器 | 联想 / ThinkSystem SR550 | 状态「已注销」，默认列表隐藏，按状态筛选可查回 |

按「设备类型」筛选「安全设备」应只返回 2 台防火墙/准入系统；筛选「物理服务器」返回 3 台（含已注销）。

### 6. 其余模块回归（确认未被本轮改动破坏）

| 模块 | 期望 |
| --- | --- |
| 组织架构 | 左侧真实组织树 + 右侧人员列表；点人员打开详情，页签为 人员资料 / 组织归属 / 名下资产 / 资产交接 |
| 工单与统计 | 按用户工单原型检查：工单流转标题、四张横向阶段卡及箭头、独立弱化已取消卡；下方“工单列表 / 已选N张 / 批量关闭”标题栏和十列表格；分页默认10条 |
| 工单列表场景 | 已通过真实接口补齐16张工单，初始数量为新建5、处理中4、已解决3、已关闭3、已取消1；不是前端写死数字。日常测试修改会改变计数，不要为恢复截图而重置测试库 |
| 设置 | 左侧「Settings」→「Cmdb」页签，内有 资产目录 / 工单配置 / 导入模板 / 项目存储 / 同步维护 五个分区 |

### 7. 导入导出

| 步骤 | 期望 |
| --- | --- |
| 终端资产 → 导入/导出 → 下载模板 | 模板表头含 品牌/厂商、型号、CPU、内存（MB）、磁盘 |
| 按模板填一行台式机并导入 | 预览可识别硬件列，确认导入后详情显示这些值 |

## 四、停止

关闭 Netcatty 窗口即可；如需强制清理：

```powershell
Get-NetTCPConnection -LocalPort 18974 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

## 五、已知限制

- 验收数据为脚本写入的示例记录（`VERIFY-*`），仅用于验证功能，不代表真实资产。
- 本轮原型对照范围为用户提供的机柜页与工单列表页；其他模块的功能可达性结果不能当作视觉一致的结论。
- `integrations/netcatty/cmdb/modules/`、`core/`、`adapter/` 为未参与正式入口的草稿目录，不影响验收。

## 六、分支优先合入审核（2026-10-17）

- 合入基准是 `ci/native-settings-test-20261009` 的完整源码及未提交开发成果，不以主线旧实现重写，不剔除分支已有附件云同步、更新通道或模块草稿目录。主线 `37bcecf` 为该分支祖先，采用快进合入。
- 主线原有未提交修改及错误重实现已封存到 stash `236791c6b716596fb29eca35f7b75cd571dd1b85`，同时备份到 `build/branch-primary-recovery-20261017/`；不将其覆盖回分支。
- 分支专项修正：附加业务IP在后建网段时归基础设施、历史NULL字段兼容、盒子地址精确匹配、旧server_id承载筛选、机柜修改IP后的Netcatty跟随同步、实体机柜排除虚拟资源、保存中阻止侧栏卸载。
- 实际验证：分支原样快照 `build/branch-primary-review` 的 `go test ./...` 全量通过；装配/宿主设置/更新入口12项通过；装配后模型、快照、附件同步和桥接192项通过；最后机柜与连接模型35项通过；正式入口lint及宿主构建通过。Vite仍提示宿主大分包，不作为本轮新增功能失败。
- 独立API实测：旧承载投影按host_id查询及Excel导出成功；先服务器附加业务IP→应用→后建网段后，IP归基础设施且服务器仍能保存。真实Electron实测分支原界面及管理IP保存、保存期间侧栏禁用且仍留机柜页；截图 `build/branch-primary-evidence/rack-source-branch.png`。
- 本轮不声称验证真实远程SSH、S3服务端、跨平台安装或完整人工验收矩阵；没有发布或替换正式安装客户端。分支已有版本1.3.1保持不变。


## 七、已确认原型正式恢复（2026-10-17）

分支优先合入不能删掉用户此前确认的原型设计。此前 `c25452a` 仅带入分支原有正式页面与HTML归档，缺少最新交互；本次在分支完整实现基础上恢复，不整树回退，也不剔除附件云同步和更新通道。

| 已确认要求 | 本轮实际验证 | 证据 |
| --- | --- | --- |
| CPU／内存／磁盘紧凑组合、原文折叠 | 420px编辑侧栏三块控件为75／75／136px；CPU自定义、2.5PB U.2、1.5TB→1572864MB实际保存；RAID及未知混合原文保留 | `HardwareFields.jsx`、`hardwareFieldModel.test.js`、`build/prototype-restored-evidence/hardware.png` |
| 三栏常驻管理、窄柜、流光 | 1568px三栏同显，1024px管理下置、720px顺排，无全页面横向溢出；流光背景实际变化，减弱动画为none | `RackOverview.jsx`、`RackLocationEditor.jsx`、`rack-management.css`、`build/prototype-restored-evidence/rack-final.png` |
| 空U新增与已有上架 | 新建机房→29U空柜→29U新增服务器真实保存；另一已有2U设备在27U真实上架；41U缩柜拒绝、47U真实保存 | `RackMountDialog.jsx`、`RackView.jsx`、位置与资产真实API |
| 横向二级页与IP非遮罩 | 机柜／网络独立组件；192.0.2.21选中格与右详情同时可见，无模态遮罩 | `IPAM.jsx`、`NetworkAddressWorkspace.jsx`、`build/prototype-restored-evidence/network.png` |
| 访问地址在业务IP之前 | 实际显示完整https协议、8443端口、路径及查询参数，原业务IP保留 | `Systems.jsx`、`build/prototype-restored-evidence/systems.png` |
| 照片5:1、凭证两列对齐 | 正背面照片卡片实际宽高比5.0004；凭证两列y坐标及高度一致 | `DeviceImages.jsx`、`NetcattyConnectionFields.jsx` |
| SSH勾选回填、失败/取消不覆盖 | Netcatty真实主机配置→本机隔离SSH服务→执行Windows只读CIM命令；默认全部未选，仅勾选内存真实回填保存，CPU/磁盘原值不变；最终UTF8中文系统正确，取消回填保留CPU草稿 | `HardwareCollection.jsx`、`readHostHardware.js`、`readHostHardware.test.js` |

- 本轮装配/设置/更新12项、模型/附件同步/快照/桥接203项通过；修正lint后硬件模型7项、读取解析3项通过，最终eslint无错误警告、宿主完整构建通过。宿主仍有原有分包体积提示。
- 未改Go后端协议；沿用已验证分支后端与独立测试库，不触碰正式安装或业务数据。真实客户远程SSH、Linux远端、S3服务端和跨平台安装未在本轮验证。
- 当前隔离测试构建 `build/netcatty-prototype-restored`，独立库 `build/prototype-restored-smoke.db`。不将旧测试窗口或旧dist当作新界面。

## 八、五页视觉对齐复核（2026-10-17）

本轮只调整 Netcatty 原生 Cmdb 中的终端资产、基础设施、业务系统、机柜和网络页布局；以隔离装配目录 `build/netcatty-five-page-visual` 和隔离库 `build/five-page-visual-review/assets.db` 启动真实 Electron 客户端，窗口内容区 1568×751，按本目录原型图片对照。以下截图均为本机 `build/` 下的验收产物，未纳入版本控制。

| 页面 | 客户端实测 | 截图 |
| --- | --- | --- |
| 终端资产 | 紧凑顶栏、固定列表表头与行高，设备 IP、网络类型、状态及操作独立列；台式机、笔记本可从设备名称打开原有详情 | [终端资产](../build/five-page-visual-evidence/terminal.png) |
| 基础设施 | 资产类别切换后，设备类型、品牌／型号、IP、网络类型、位置、负责人及状态保持独立列 | [基础设施](../build/five-page-visual-evidence/infrastructure.png) |
| 业务系统 | 独立访问地址列在业务 IP 前，原有地址文本完整；资产类型、版本、承载设备、网络类型和状态可见 | [业务系统](../build/five-page-visual-evidence/systems.png) |
| 机柜 | 54px 单排页头容纳横向二级导航、机房／机柜选择及搜索；机柜图／设备属性／机房机柜管理三栏同时显示，右栏管理不覆盖设备属性 | [机柜](../build/five-page-visual-evidence/rack.png) |
| 网络 | 56px 页头、完整 `/24` 方格和底部分页；点击 `192.168.10.201` 后右侧详情同时可见。680px 窄窗口详情移至方格下方，可滚动查看并操作 | [网络桌面](../build/five-page-visual-evidence/network.png) / [网络窄屏详情](../build/five-page-visual-evidence/network-narrow-detail.png) |

验证：锁定宿主装配测试 1/1 通过；三类资产、地址池及机柜布局模型测试 31/31 通过；装配后 `npx eslint components/cmdb` 和 `npm run build` 通过。Vite 仍提示宿主既有的大分包。机柜在 1150px 时管理区下置、680px 时三区域单列顺排；680px 下方 IP 详情实际高度 220px，地址区域可滚动到详情。此轮未修改 Go 后端，未对正式安装目录、生产数据、远端连接或跨平台安装进行验证；不将视觉验证等同于全功能人工验收。

## 九、工单流转恢复原设计（2026-10-18）

- 用户明确撤销圆环节点与能量动画方案，恢复改版前“四张横向阶段卡片＋箭头＋右侧独立弱化已取消”的布局。
- 实现：[WorkOrders.jsx](../integrations/netcatty/cmdb/WorkOrders.jsx) 恢复原阶段区 JSX 和 `ArrowRight`，沿用真实阶段统计与点击筛选。删除本轮新增的 `WorkOrderFlow.jsx` 动画组件，并撤销 [装配脚本](../scripts/prepare-netcatty.mjs) 中仅供动画使用的 animejs 依赖注入。
- 客户端实测：重新构建并替换本机安装客户端前端包，正常重启后检查四阶段卡片及独立已取消卡片均为 48px 高；当前数量为 0／0／0／4／0。点击新建显示暂无数据且已关闭数量仍为 4，再次点击恢复 4 条工单。未修改工单记录。
- 验证：锁定宿主装配测试 1/1 通过；装配宿主 `npx eslint components/cmdb/WorkOrders.jsx` 和 `npx vite build` 通过。保留宿主既有分包体积、混合导入和浏览器兼容提示。本次恢复未改后端，未运行 Go 测试。
- 视觉证据：[原设计恢复后的客户端](../build/work-order-original-restored.png)。源码与安装客户端均已恢复，版本号不变；安装前备份为 `resources/app.asar.pre-original-flow-restore`。

