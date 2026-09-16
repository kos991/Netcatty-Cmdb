# MUI 全量迁移（第 2 批）— 验收记录

- 日期：2026-09-14
- 范围：把剩余全部页面从 antd 迁到 Material UI，并移除 antd 依赖
- 触发需求：用户「整个应用迁到 MUI」「直接改 把界面给我改了」

## 1. 本轮目标与范围

第 1 批已迁移：全局查询、运维履历总账、统计看板、工作台、应用外壳（`App.jsx` + `muiTheme.js`）。

本轮把**其余全部页面**迁到 MUI，并在迁完后**移除 antd 依赖**，使构建产物只包含 MUI：

1. IP 规划池（`IPManager.jsx`）+ 网段管理（`IPSubnetManager.jsx`）
2. CMDB 全部页签：资源管理、仪表盘、云桌面终端台账、物理服务器与应用、编码与标签、工单管理、凭证中心、配置中心
3. 分类管理（组织 / 分组 / 类型）、左侧分类树
4. 表格兜底页（`TablePage.jsx`）、重复编号页（`Duplicates.jsx`）
5. 外壳收尾：挂载 MUI 通知条、移除 antd `ConfigProvider` 与 `antd/dist/reset.css`、从 `package.json` 删除 `antd` / `@ant-design/icons`

## 2. 改动文件清单

### 2.1 新增

| 文件 | 职责 |
| --- | --- |
| `web/src/ui/DataTable.jsx` | MUI 通用表格：表头、空状态、加载态、勾选、排序、分页；另导出独立分页条 `Pager` |
| `web/src/ui/Detail.jsx` | 详情分组块 `DetailSection` / 键值行 `DetailRow` / 时间轴 `TimelineList`（替代 antd `Timeline`） |
| `tools/ui-check/interact.py` | Playwright 交互自检脚本：真的点开弹窗、切换页签、读 DOM 断言，而不只是截图 |

### 2.2 改写为 MUI

| 文件 | 说明 |
| --- | --- |
| `web/src/IPManager.jsx` | 网段卡片、方格图矩阵、列表、详情抽屉、分配/编辑/补录弹窗、释放/删除/强制删除二次确认 |
| `web/src/IPSubnetManager.jsx` | 网段定义的表格式管理 + 新增/编辑弹窗（类别用 `Autocomplete freeSolo` 支持自定义） |
| `web/src/AssetCenter.jsx` | 云桌面终端台账：占用总览、筛选卡片、卡片/列表双视图、履历抽屉（含时间轴与关联信息）、调换人/维修换件/新增编辑弹窗、注销归档确认 |
| `web/src/ServerCenter.jsx` | 物理服务器台账：机房侧栏、状态条、清单/机架概览、应用抽屉、全院应用总览、深信服导入预览、服务器与应用表单 |
| `web/src/TablePage.jsx` | 通用表格兜底页（盒子/显示器等登记表） |
| `web/src/Duplicates.jsx` | 重复设备编号统计 |
| `web/src/cmdb/CmdbLayout.jsx` | 顶部 CMDB 页签改为 MUI `Tabs`（图标换成 `@mui/icons-material`） |
| `web/src/cmdb/CmdbResources.jsx` | 资源台账主页面（最重的页面，约 1000 行） |
| `web/src/cmdb/CmdbDashboard.jsx` | 仪表盘 8 个分区 |
| `web/src/cmdb/CmdbLabels.jsx` | 编码与标签（含扫码定位、编码规则、打印审计） |
| `web/src/cmdb/CmdbWorkOrders.jsx` | 工单管理（含导出 CSV） |
| `web/src/cmdb/CmdbCredentials.jsx` | 凭证中心 |
| `web/src/cmdb/CmdbConfig.jsx` | 配置中心（设备模型库 + 批量导入 + SNMP 说明） |
| `web/src/cmdb/CmdbTaxonomy.jsx` | 分类管理弹窗 |
| `web/src/cmdb/CmdbSideTree.jsx` | 左侧分类树（MUI 递归组件替代 antd `Tree`） |
| `web/src/cmdb/columns.js` | 30 列定义改为 MUI 渲染（`Chip` 等），筛选项改为供工具栏使用的选项数据 |
| `web/src/main.jsx` | 只保留 `ThemeProvider` + `CssBaseline`，移除 antd `ConfigProvider` 与 reset.css |

### 2.3 小改

| 文件 | 说明 |
| --- | --- |
| `web/src/App.jsx` | 挂载 `<Notifier />`；移除旧页 `CMDBResources` 的引用与 `case 'cmdb'` 分支（该页面仍在磁盘上，见「已知限制」） |
| `web/src/muiTheme.js` | 增加 `MuiButton` 全局 `whiteSpace: nowrap`（工具栏中文按钮不再折行） |
| `web/package.json` | 删除依赖 `antd`、`@ant-design/icons` |
| `web/src/CMDBResources.jsx` | 加文件头说明：已不在构建中，恢复需先改写为 MUI |
| `web/src/cmdb/CmdbInventory.jsx` | 同上（资产盘点已按用户要求下线） |

## 3. 保留的能力（未因换框架而删减）

- 全局查询作为默认首页、各模块独立页面、分页、导出（导出仍按当前筛选条件导出全部匹配记录）
- 资产联动：资产详情展示使用人 / 部门 / 房间 / IP / 关联服务器 / 关联应用 / 履历时间轴
- 资产新增、修改、调换使用人、维修换件、履历、注销归档
- 删除仍为「注销归档」，不物理删除；映射自旧台账的 CMDB 记录仍拒绝删除
- 批量编辑 / 批量克隆 / 批量删除（注销归档）、批量导入（校验 → 确认导入）、模板下载、资产导出
- 工单、凭证、编码、设备模型、分类管理（组织 / 分组 / 类型）的全部 CRUD
- 服务端筛选与排序仍然回到后端：原来挂在 antd 列头上的 4 个筛选（状态 / 设备分类 / 操作系统类型 / 操作系统版本）改为工具栏显式下拉，参数与后端接口不变；可排序列改为 MUI `TableSortLabel`
- 依赖采集端的能力（SNMP 采集配置、业务监控列、工作台部分卡片）仍然显式标注原因，不造假数据

## 4. 实际验证

### 4.1 构建

```
cd web && npm.cmd run build
dist/assets/index-DdcHmPTU.css   19.60 kB │ gzip:   4.37 kB
dist/assets/index-RKBdUQ_0.js   717.97 kB │ gzip: 222.46 kB
✓ built in 4.36s          （vite build 退出码 0）
```

迁移前同一入口的产物是 `index-trcDgTY_.js 1,832.00 kB`；移除 antd 后降到 **717.97 kB（gzip 222.46 kB）**，说明 antd 已完全不在产物里。

### 4.2 后端

```
go vet ./...     → 退出码 0，无输出
go test ./...    → ok czfy-assets/internal、ok czfy-assets/internal/store
go test ./internal/... -count=1 -v | 统计 "--- PASS" → 40 条，0 条 FAIL
```

### 4.3 页面渲染（Playwright 截图，13 页）

```
python tools/ui-check/screenshot.py 18080
[OK] 01-search 02-workbench 03-cmdb-resources 04-cmdb-dashboard 05-cmdb-assets
     06-cmdb-servers 07-cmdb-labels 08-cmdb-workorders 09-cmdb-credentials
     10-cmdb-config 11-logs 12-ip-pool 13-dashboard
控制台 error：(无)   页面未捕获异常：(无)   控制台 warning：0
```

截图与 `console.json` 落在 `%TEMP%\ui-check\`。

### 4.4 页面交互（Playwright 真点击，10 项）

```
python tools/ui-check/interact.py 18080
```

| 用例 | 结果 |
| --- | --- |
| CMDB 资源管理 / 新增资产弹窗（含必填校验、取消关闭） | OK |
| CMDB 资源管理 / 状态筛选（切「在线」后出现「清除筛选」并可清除） | OK |
| CMDB 资源管理 / 分类管理弹窗（组织/分组/类型三页签 + 新增表单） | OK |
| 云桌面终端台账 / 列表·卡片切换 + 履历抽屉（含当前设备概况、关联信息） | OK |
| 物理服务器与应用 / 机架概览·清单切换 + 应用抽屉 + 全院应用总览 | OK |
| 编码与标签 / 扫码定位弹窗输入并定位 | OK |
| 工单管理 / 新增工单弹窗 | OK |
| 凭证中心 / 新增凭证弹窗（含不存明文口令说明） | OK |
| 配置中心 / 新增模型弹窗 + SNMP 页签说明 | OK |
| IP 规划池 / 网段管理（含新增网段）与补录 IP 弹窗 | OK |

**10/10 通过**，控制台 error 0、页面未捕获异常 0。结果文件：`%TEMP%\ui-check\interact.json`。

### 4.5 过程中发现并修掉的真实问题

1. `@mui/icons-material/DeleteOutline` 在 MUI v9 不存在（应为 `DeleteOutlined`），构建直接失败 → 已修正。
2. `Tooltip` 默认会把 `title` 写到子元素的 `aria-label` 上，导致可见文字为「应用」的按钮可访问名变成「应用管理」，屏幕阅读器读到的名字与可见文字不一致 → 该处改为 `describeChild`，并根据 Playwright 复核，该按钮的可访问名已恢复为「应用」（`exact 应用 命中数: 3`）。
3. 工具栏中文按钮被折成两行（「新增工单」显示为两行）→ 主题里给 `MuiButton` 加 `whiteSpace: nowrap`。
4. 物理服务器「承载系统应用」抽屉原本没有可见的关闭按钮（只能点遮罩或 Esc），与同一套 UI 的其它抽屉不一致 → 补上「关闭」按钮。

## 5. 版本同步清单

- 本轮未改后端代码，未改数据库结构，未改接口；`assets.db` 中的 5 张旧表结构未动。
- 未 bump 版本号（用户未要求）。
- 未新增修复报告（用户未要求，且本轮属于界面框架迁移）。

## 6. 风险与已知限制

1. **旧页面留在磁盘但不参与构建**：`web/src/CMDBResources.jsx`（旧的「统一资源管理」）与 `web/src/cmdb/CmdbInventory.jsx`（已下线的资产盘点）仍使用 antd，而 antd 已从依赖中移除。它们已不再被任何文件引用，因此不影响构建；**若要恢复，必须先改写为 MUI，或把 antd 加回依赖**，否则会报 `Failed to resolve import "antd"`。两个文件头部都写了这条说明。
2. **列头筛选改成了工具栏下拉**：MUI 核心表格没有 antd 那样的列头筛选菜单。4 个筛选条件（状态 / 设备分类 / 操作系统类型 / 操作系统版本）改为工具栏显式下拉，服务端参数与行为不变；其余 26 列本来就没有筛选，未受影响。
3. **`web/node_modules` 里 antd 仍然存在**：只删了 `package.json` 的声明，没有执行 `npm install` 清理磁盘。要彻底清掉可执行 `cd web && npm.cmd install`。
4. **时间输入改用原生控件**：antd `DatePicker showTime` 换成 `<input type="datetime-local">`（MUI 的日期选择器在 `@mui/x-date-pickers`，本项目未引入该依赖）。格式仍是 `YYYY-MM-DD HH:mm`，与后端一致；但原生控件的浏览器外观与 MUI 组件不完全统一。
5. **工作台的部分卡片仍无法给出真实数据**（值班表、项目管理、备忘录等需要新表），迁移没有改变这一点，卡片仍按原样标注依赖原因。
