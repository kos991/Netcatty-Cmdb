# 换回 Ant Design 框架 — 验收记录

- 日期：2026-09-14
- 触发需求：用户看到 MUI 成品后明确否定 ——「太丑了，换回原来的框架，全部替换」
- 结论：全站界面已换回 Ant Design 5，MUI 相关代码与依赖已移除；13 页零报错、10 项交互全通过

---

## 1. 必须先说明的一件事：原 antd 源码已被覆盖，本轮是「重新写回」而不是「还原文件」

这一点必须如实记录，因为它决定了本轮工作的性质：

1. 本仓库**没有 git**（`git rev-parse` 报 `not a git repository`），没有版本历史可回滚。
2. 上一轮迁移时，antd 版页面是**被原地覆盖**的（`write` 覆盖同名文件），不是新增文件。
3. 已全盘搜索 `C:\`、`D:\`（仅这两个盘），未找到任何备份：既没有其它项目副本，也没有旧构建产物（Vite 默认 `emptyOutDir` 会清空 `dist`，旧 antd 包已被清掉）。搜索命中只有当前这一份文件。

因此：**「原来的 antd 源码」在磁盘上已经不存在了**，本轮是照着会话中读过的原始内容逐页写回。差别如下：

| 类别 | 文件 | 说明 |
| --- | --- | --- |
| 逐页写回原始内容 | `AssetCenter`、`ServerCenter`、`IPManager`、`CmdbResources`、`CmdbLayout`、`CmdbDashboard`、`CmdbLabels`、`CmdbWorkOrders`、`CmdbCredentials`、`CmdbConfig`、`CmdbTaxonomy`、`CmdbSideTree`、`columns.js`、`TablePage`、`Duplicates` | 本轮开始时这些文件的原始 antd 内容已在会话中完整读过，按原文重新写入 |
| 按原能力重写 | `App.jsx`（应用外壳）、`GlobalSearch`、`AuditLogs`、`Dashboard`、`IPSubnetManager` | 这 5 个文件的 antd 版内容不在会话里（前 4 个在更早的批次就已改写、`IPSubnetManager` 只读过开头），按现有能力用 antd 重写，功能一致、实现细节可能与最初版本有差异 |
| 删除 | `web/src/muiTheme.js`、`web/src/ui/DataTable.jsx`、`web/src/ui/Detail.jsx`、`web/src/ui/Notifier.jsx`、`web/src/ui/notify.js` | MUI 迁移期新增的专用文件，antd 下不再需要（`ui/` 目录已整体删除） |

**行数对照（写回后 / 迁移前读到的原始行数）**：`AssetCenter` 1169/1174、`ServerCenter` 1224/1232、`CmdbResources` 1011/1016、`IPManager` 720/729、`CmdbLabels` 409/411、`CmdbWorkOrders` 352/352、`CmdbConfig` 319/321、`CmdbCredentials` 241/243、`CmdbDashboard` 234/236、`CmdbTaxonomy` 285/286、`CmdbLayout` 90/94、`CmdbSideTree` 107/108、`columns.js` 125/133、`TablePage` 197/202、`Duplicates` 59/60（差额来自文件头说明注释与末尾空行的计数方式）。

如果后续能拿到迁移前的备份（另一台机器、U 盘、Antigravity 的工作区等），建议用备份覆盖一次以获得逐字节一致的原始版本。

---

## 2. 改动文件清单

### 2.1 换回 antd（改写）

| 文件 | 内容 |
| --- | --- |
| `web/src/main.jsx` | 恢复 `ConfigProvider` + `zhCN` + `antd/dist/reset.css`，移除 `ThemeProvider` / `CssBaseline` |
| `web/src/App.jsx` | 应用外壳改回 antd `Layout` / `Sider` / `Menu` / `Header` / `Content`，左侧深色导航与顶部标题栏恢复原样 |
| `web/src/GlobalSearch.jsx` | 全局查询：`Card` + `Input.Search` + 分组 `List`，结果「查看」跳转逻辑不变 |
| `web/src/AuditLogs.jsx` | 运维履历总账：条件区 + antd `Table`（7 列、类型色标、人员交接与 SN 换件渲染） |
| `web/src/Dashboard.jsx` | 统计看板：`Statistic` 四卡 + `Progress type="circle"` 三环 + 部门分布 `Table` |
| `web/src/workbench/Workbench.jsx` | 工作台：问候头、最新工单/值班表/快捷功能三卡、运维态势六卡（真实数据与「依赖采集端」标注原样保留） |
| `web/src/IPManager.jsx` | IP 规划池：网段卡片、方格图矩阵、列表、详情抽屉、分配/编辑/补录弹窗、释放/删除强制删除二次确认 |
| `web/src/IPSubnetManager.jsx` | 网段管理：`Modal` + `Table` + `Form`；类别用 `AutoComplete` 保留「可选预设也可自定义」 |
| `web/src/AssetCenter.jsx` | 云桌面终端台账：占用总览、筛选卡、卡片/列表两视图、履历抽屉（`Timeline` + 关联信息）、调换人/维修换件/新增编辑弹窗 |
| `web/src/ServerCenter.jsx` | 物理服务器与应用：机房侧栏、状态条、清单/机架概览、应用抽屉、全院应用总览、深信服导入预览、服务器与应用表单 |
| `web/src/TablePage.jsx`、`web/src/Duplicates.jsx` | 通用表格兜底页、重复编号页 |
| `web/src/cmdb/*`（`CmdbLayout`、`CmdbResources`、`CmdbDashboard`、`CmdbLabels`、`CmdbWorkOrders`、`CmdbCredentials`、`CmdbConfig`、`CmdbTaxonomy`、`CmdbSideTree`、`columns.js`） | CMDB 全套页面回到 antd：横向 `Menu` 页签、左侧 `Tree`、30 列 `Table`（**列头筛选与列头排序恢复**）、抽屉/弹窗表单 |

### 2.2 依赖与清理

- `web/package.json`：恢复 `antd ^5.21.6`、`@ant-design/icons ^5.5.1`；移除 `@mui/material`、`@mui/icons-material`、`@emotion/react`、`@emotion/styled`
- 删除 `web/src/muiTheme.js` 与整个 `web/src/ui/` 目录（MUI 专用）
- `web/src/CMDBResources.jsx`、`web/src/cmdb/CmdbInventory.jsx`：更新文件头说明（这两个未被引用的旧页本身就是 antd，现在与全站框架一致，恢复入口可直接挂回）
- `tools/ui-check/interact.py`：交互自检脚本改为 antd 定位方式（`.ant-modal-content`、`ant-modal-wrap:visible`、`.ant-segmented-item-label`、`tr.ant-table-row` 等）
- `AGENTS.md`：技术栈事实改回 Ant Design 5，并写明「新增或修改页面一律用 antd，不得再引入 MUI」

### 2.3 本轮修掉的真实缺陷

**① 分类管理弹窗的页签点不动**（`web/src/cmdb/CmdbTaxonomy.jsx`）：

- 现象：在「分类管理」里点「分组」「类型」页签，内容弹回「组织」，页签实际无法切换。
- 根因：`load` 是 `useCallback(..., [activeKind])`，而入口副作用写的是 `useEffect(..., [open, kind, load])`；`load` 随 `activeKind` 变化 → 副作用重新执行 → `setActiveKind(kind)` 把页签重置回外部传入的 `kind`。
- 修复：依赖改为 `[open, kind]`，并加注释说明为什么不能把 `load` 放进去。修复后 Playwright 断言「切到分组后主按钮变为『新增分组』、切到类型后变为『新增设备分类』」。

> 这个缺陷是随「写回原始内容」一起回来的，MUI 版当时恰好因为 effect 依赖写法不同而没有暴露；属于历史遗留问题，本轮一并修掉。

**② 工作台「快捷功能」磁贴被卡片底部裁掉**（`web/src/workbench/Workbench.jsx`）：

- 现象：截图显示 11 个磁贴只露出 8 个，第三行标签被卡片下沿切掉。
- 根因：三张卡写死 `height: 260/272`，而 antd `Tabs` 的导航栏还占高度，内容区不足以容纳三行磁贴，被 `.ant-card` 的 `overflow: hidden` 裁掉。
- 修复：卡片高度改为 `minHeight`（同一行由 CSS grid 自动等高），去掉磁贴区的 `maxHeight` 限制，让内容自然撑开。修复后 11 个磁贴完整显示。

---

## 3. 实际验证

### 3.1 构建

```
cd web && npm.cmd run build
dist/assets/index-BPcQeoMf.css   22.54 kB │ gzip:   5.39 kB
dist/assets/index-DySjFVYN.js  1,415.49 kB │ gzip: 442.29 kB
✓ built in 9.92s          （vite build 退出码 0）
```

- CSS 产物哈希 `BPcQeoMf` 与本次会话最早那版 **antd 构建完全相同**，说明 `app.css` + antd `reset.css` 的组合已回到迁移前状态。
- JS：MUI 版 717.89 KB → 换回 antd 后 1,415.49 KB（antd 本身的体积）。

### 3.2 后端（本轮未改后端，回归确认）

```
go vet ./...     → 退出码 0，无输出
go test ./...    → ok czfy-assets/internal、ok czfy-assets/internal/store
go test ./internal/... -count=1 -v 统计 PASS → 40 条，0 条 FAIL
```

### 3.3 页面渲染（13 页截图）

```
python tools\ui-check\screenshot.py 18080
13/13 OK ；控制台 error (无) ；页面未捕获异常 (无) ；warning 0
```

截图落在 `%TEMP%\ui-check\`。抽查确认：`03-cmdb-resources.png` 为 antd 深色侧栏 + 横向页签 + 两行工具栏 + 30 列表格（带列头筛选/排序箭头）+ 快速跳转分页；`12-ip-pool.png` 为 antd 网段卡 + `Segmented` + 253 格矩阵。

### 3.4 页面交互（10 项真点击）

```
python tools\ui-check\interact.py 18080
```

| 用例 | 结果 |
| --- | --- |
| CMDB 资源管理 / 新增资产弹窗（必填校验 + 取消关闭） | OK |
| CMDB 资源管理 / 状态**列头筛选**菜单（选项来自后端真实取值） | OK |
| CMDB 资源管理 / 分类管理三页签内容真实切换 + 新增表单 | OK |
| 云桌面终端台账 / 列表·卡片切换 + 履历抽屉（概况 + 关联信息 + 时间轴） | OK |
| 物理服务器与应用 / 机架概览·清单切换 + 应用抽屉 + 全院应用总览 | OK |
| 编码与标签 / 扫码定位弹窗 | OK |
| 工单管理 / 新增工单弹窗 | OK |
| 凭证中心 / 新增凭证弹窗（含不存明文口令说明） | OK |
| 配置中心 / 新增模型弹窗 + SNMP「依赖采集端」说明 | OK |
| IP 规划池 / 网段管理（含新增网段）+ 补录 IP 弹窗 | OK |

**10/10 通过**，控制台 error 0、页面未捕获异常 0。结果文件 `%TEMP%\ui-check\interact.json`。

### 3.5 功能未被删减的核对

全局查询首页、五个模块独立页面与分页、资产详情联动（人员/部门/房间/IP/关联服务器/关联应用/履历时间轴）、新增/修改/调换使用人/维修换件/注销归档、按筛选条件导出全量、批量编辑·克隆·注销归档、导入校验→确认导入、组织/分组/类型分类管理与自定义、工单/凭证/编码/设备模型 CRUD —— 全部保留，仅框架实现变化。

---

## 4. 版本同步清单

- 未改后端代码、未改数据库结构、未改接口；`assets.db` 的 5 张旧表结构未动。
- 未 bump 版本号（用户未要求）。
- 未创建修复报告（用户未要求；本轮主体是框架回退）。

---

## 5. 风险与已知限制

1. **不是逐字节还原**：见第 1 节。有 5 个文件的 antd 版本是按能力重写的，外观与交互按项目一贯风格实现，可能与最初版本存在细节差异。若能找到迁移前备份，建议覆盖一次。
2. **`web/node_modules` 里 MUI 仍在磁盘上**：只删了 `package.json` 的声明，没有执行 `npm install` 清理。要彻底清掉可执行 `cd web && npm.cmd install`。
3. **本轮没有做像素级比对**：判断依据是截图与 DOM 断言（框架特征元素：`.ant-modal`、`.ant-table`、`.ant-segmented`、antd 深色 `Menu`），不是与迁移前截图的逐像素差异。
4. 迁移期写下的 `docs/MUI全量迁移-第2批-验收记录.md` 保留在仓库中作为过程记录，其中的「前端已迁到 MUI」描述已被本轮取代。
