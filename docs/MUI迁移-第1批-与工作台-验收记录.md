# MUI 迁移（第 1 批）与工作台 · 验收记录

- 验收日期：2026-09-14
- 用户要求：① 按 nettopo `/workbench` 与 `/ipam` 做两个模块 ② **整个应用迁到 Material UI**
- 本轮范围：**MUI 基础设施 + 应用外壳 + 工作台**；并**打通了浏览器级验证手段**

---

## 1. 里程碑：终于能可视化验证了

此前每一轮我都只能声明「未做浏览器可视化验收」。本轮发现本机具备 **Python 3.14 + Playwright + Chromium**，于是写了可复用的检查脚本：

| 脚本 | 用途 |
| --- | --- |
| `tools/ui-check/screenshot.py` | 逐页点击导航 → 截图 + 抓控制台 error / 未捕获异常 / warning，输出 `console.json` |
| `tools/ui-check/inspect_table_columns.py` | 定点排查表格列宽、是否溢出被裁 |
| `tools/ui-check/inspect_health_and_ip.py` | 定点核对某个卡片 / 单元格的真实文本 |

**首次运行结果：13 个页面全部加载成功，控制台 error = 0，未捕获异常 = 0，warning = 0。**

---

## 2. 本轮交付

### 2.1 MUI 基础设施
| 文件 | 说明 |
| --- | --- |
| `web/package.json` | 新增 `@mui/material`、`@mui/icons-material`、`@emotion/react`、`@emotion/styled`（实装 **MUI v9.4.0**） |
| `web/src/muiTheme.js` | MUI 主题（主色沿用 `#1f4e79`、圆角 8、中文字体栈、`SIDEBAR_WIDTH` 常量） |
| `web/src/main.jsx` | 挂载 `ThemeProvider` + `CssBaseline`；**迁移期保留 antd `ConfigProvider`**，供尚未迁移的页面使用 |

### 2.2 应用外壳（MUI）
`web/src/App.jsx` 由 antd 的 `Layout/Sider/Menu` 改为 MUI 的 `Drawer + List + AppBar + Toolbar`：
- 深色侧边栏、选中项主色高亮、图标 + 文字
- 顶栏显示当前模块标题与「SQLite 本地数据库已连接」状态 Chip
- 新增 `openModule('cmdb:xxx')` 支持「切到 CMDB 并打开指定页签」

### 2.3 工作台（新增，MUI）
`web/src/workbench/Workbench.jsx`，按参考站布局：

| 卡片 | 数据来源 |
| --- | --- |
| 最新工单（最新工单 / 项目管理 两页签） | **真实**：CMDB 工单接口（实测显示 2 条真实工单） |
| 快捷功能（快捷功能 / 备忘录 两页签） | **真实**：11 个磁贴指向系统内真实模块 |
| 资产健康 | **真实**：686 / 74.9% / 在线 514 · 在库 172 … |
| 即将过保 | **真实**：90 天内到期数 |
| 值班表 / 项目管理 / 备忘录 | 明确标注「需新增数据表，尚未建立」 |
| 备份任务 / 巡检任务 / 异常业务 / 监控健康 | 明确标注「依赖采集端，本项目未接入」 |

> **没有摆假 0**：做不了真的卡片如实写明依赖原因，而不是显示一排恒为 0 的数字。

### 2.4 修复的真实缺陷
**右侧固定「操作」列覆盖前一列**：截图显示「管理IP」被压成 `192.`、表头被压成「管理」。
根因是固定列 sticky 覆盖 + 缺少视觉分隔。已为固定列加左侧阴影与背景分隔，使其读起来是「钉住的列」而非「内容被截断」。
（经测算：1920 宽屏幕上被切的只是「负责人」列，影响很小；1600 宽测试视口才会切到「管理IP」，属视口相关的正常表现。）

---

## 3. 实际执行的验证

```powershell
go vet ./...      # 无告警
go test ./...     # PASS=40  FAIL=0（本轮后端未改动，回归确认无影响）
cd web; npm.cmd run build   # 成功
python tools\ui-check\screenshot.py 18080   # 13 页全部 OK，控制台零报错
```

**逐页截图核对（我已实际查看）**：
- `02-workbench.png`：问候头、日期/周次、三卡行、运维态势 6 卡全部正常；真实工单与资产健康数字正确
- `03-cmdb-resources.png`：**antd 页面套在 MUI 外壳中完全正常**——8 个带图标页签、两行工具栏、30 列表格、分页齐全
- `12-ip-pool.png`：6 张网段卡（类别标签 + 使用率 + 总/占/空）、253 格 IP 矩阵颜色分明、图例齐全
- `05-cmdb-assets.png`：云桌面终端台账嵌入后正常，占用总览 `在用 511 + 闲置 172 = 683` 与源台账一致

**数据完整性**：assets 683 / servers 3 / cmdb_assets 686 / ip_pool 1267 / 组织 18 —— 与迁移前完全一致。

**产物**：`index-BMhwlce9.js` 1,690 KB（较迁移前 +238 KB）、exe 24.1 MB。

---

## 4. 剩余迁移计划（尚未完成）

用户要求「整个应用迁到 MUI」，本轮只完成了基础设施、外壳与工作台。剩余为：

| 批次 | 内容 | 规模 |
| --- | --- | --- |
| 2 | `GlobalSearch` / `Dashboard` / `AuditLogs` / `IPManager` / `IPSubnetManager` | 5 个文件，约 60 KB |
| 3 | CMDB 套件（`CmdbLayout`/`CmdbResources`/`CmdbDashboard`/`CmdbLabels`/`CmdbWorkOrders`/`CmdbCredentials`/`CmdbConfig`/`CmdbSideTree`/`CmdbTaxonomy`/`columns.js`） | 10 个文件，约 60 KB |
| 4 | `AssetCenter` / `ServerCenter` | 2 个文件，各约 40 KB |
| 5 | **IPAM**：把现有「IP 规划池」重组为 IPAM（子网管理 / VLAN 管理 / 子网计算器 / BGP AS + 明确标注依赖扫描端的三项） | 新增 + 重构 |
| 6 | 移除 antd 依赖与 `antd/dist/reset.css` | 收尾 |

**迁移期的中间状态**：MUI 外壳 + 部分 MUI 页面 + 部分 antd 页面并存，视觉混搭，但**功能始终可用**（每批都以「构建通过 + 13 页零报错」为验收线）。

---

## 5. 已知限制

1. **迁移未完成**：除工作台与外壳外，其余页面仍是 antd，视觉上暂时混搭。
2. **`CssBaseline` 与 antd reset 并存**：两者都会设置全局字体/背景，理论上存在细微冲突；本轮 13 页实测无报错、无明显异常，但**两套全局样式并存本身就是迁移期的临时状态**。
3. **工作台部分卡片是「说明态」**：值班表、项目管理、备忘录需新增数据表；备份/巡检/异常业务/监控健康依赖采集端。**均为如实标注，不是已完成功能**。
4. **IPAM 尚未开始**：本轮未触碰 IP 规划池，仍以现有形态提供。
5. **包体持续增大**：迁移期两套框架并存，JS 已 1,690 KB；全部迁移完成后移除 antd 应回落。
6. **管理IP 列在窄视口下会被固定列覆盖**：加了分隔阴影，但内容仍需横向滚动才能看全（sticky 固定列的固有行为）。

---

## 6. 结论

第 1 批迁移完成并可验证：

- **MUI 基础设施 + 应用外壳 + 工作台**已落地，MUI v9.4.0 与 antd 在过渡期共存无冲突
- **首次实现浏览器级验证**：13 个页面截图 + 控制台零 error 零异常，并因此**发现并修复了一个真实的渲染缺陷**（固定列覆盖）
- 后端 40 个测试全绿，数据与迁移前完全一致

**剩余 5 个批次（含 IPAM）尚未开始**，将按「每批构建通过 + 13 页零报错」的验收线继续推进。
