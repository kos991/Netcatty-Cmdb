# Netcatty 原生 CMDB 集成实施计划

> **面向执行代理：** 必须使用 `executing-plans`（当前会话执行）或 `subagent-driven-development`（分任务执行）逐项实施；每完成一个任务立即勾选并提交。

**目标：** 将完整 CMDB 工作区直接编译进 Netcatty 主渲染进程，以固定 `cmdb` 根标签交付，不再打开浏览器或依赖插件网页视图。

**架构：** Go + SQLite 继续作为只监听回环地址的本机 API，Electron 主进程负责生命周期并通过专用 IPC 代理请求、导入和导出。`web/src` 是唯一业务界面源码：独立构建继续使用 React 18，复制到 Netcatty 后复用宿主 React 19 运行时和 antd 5，避免同一渲染进程加载两份 React。装配脚本只修改锁定上游的唯一锚点，任一锚点变化立即失败。

**技术栈：** Go 1.25、SQLite、Electron、Node.js 22、React、Ant Design 5、Vite、Node Test Runner。

---

## 文件边界

```text
main.go / main_test.go                         API-only 模式
internal/server.go                            健康检查与 API 路由
internal/store/cmdb_store.go                  基础设施资源筛选
internal/store/legacy_store.go                六类全局查询
web/src/CmdbWorkspace.jsx                     六入口 CMDB 工作区
web/src/cmdbWorkspaceState.js                 可测试的导航状态
web/src/cmdbTransport.js                      浏览器/IPC 双环境传输
web/src/api.js + web/src/cmdb/cmdbApi.js      业务 API
integrations/netcatty/electron/cmdbService.cjs Go 子进程生命周期
integrations/netcatty/electron/cmdbBridge.cjs  专用 IPC 桥
scripts/prepare-netcatty.mjs                  锁定上游装配
```

装配后新增：

```text
components/cmdb/                              从 web/src 复制
electron/cmdbService.cjs
electron/bridges/cmdbBridge.cjs
```

## 任务 1：增加 API-only 服务模式

**文件：**

- 新建：`main_test.go`
- 修改：`main.go`
- 修改：`internal/server.go`

- [ ] **步骤 1：先写失败测试**

```go
package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"czfy-assets/internal"
)

func TestNewHTTPHandlerAPIOnly(t *testing.T) {
	h, err := newHTTPHandler(&internal.Server{}, true)
	if err != nil {
		t.Fatalf("创建 API-only handler 失败: %v", err)
	}
	health := httptest.NewRecorder()
	h.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if health.Code != http.StatusOK {
		t.Fatalf("健康检查状态码=%d，期望 200", health.Code)
	}
	root := httptest.NewRecorder()
	h.ServeHTTP(root, httptest.NewRequest(http.MethodGet, "/", nil))
	if root.Code != http.StatusNotFound {
		t.Fatalf("API-only 根路径状态码=%d，期望 404", root.Code)
	}
}
```

- [ ] **步骤 2：确认测试失败**

```powershell
go test . -run TestNewHTTPHandlerAPIOnly -count=1
```

预期：`newHTTPHandler` 尚不存在，编译失败。

- [ ] **步骤 3：实现路由开关**

`internal/server.go` 的 `RegisterRoutes` 首行注册：

```go
mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
})
```

`main.go` 增加 `-api-only` 并抽取：

```go
func newHTTPHandler(srv *internal.Server, apiOnly bool) (http.Handler, error) {
	mux := http.NewServeMux()
	srv.RegisterRoutes(mux)
	if apiOnly {
		return mux, nil
	}
	dist, err := fs.Sub(webFS, "web/dist")
	if err != nil {
		return nil, fmt.Errorf("加载前端资源失败: %w", err)
	}
	mux.Handle("/", http.FileServer(http.FS(dist)))
	return mux, nil
}
```

`api-only` 为真时不注册静态页面，也不执行浏览器打开逻辑。

- [ ] **步骤 4：验证并提交**

```powershell
go test . -run TestNewHTTPHandlerAPIOnly -count=1
go test ./...
git add main.go main_test.go internal/server.go
git commit -m "feat(server): add api-only mode for Netcatty"
```

## 任务 2：补齐基础设施筛选和六类全局查询

**文件：**

- 修改：`internal/store/cmdb_store.go`
- 修改：`internal/server_cmdb_io.go`
- 修改：`internal/store/legacy_models.go`
- 修改：`internal/store/legacy_store.go`
- 修改：`internal/store/cmdb_store_test.go`
- 新建：`internal/store/global_search_test.go`

- [ ] **步骤 1：写基础设施筛选失败测试**

测试库插入“交换机”和“云桌面终端”，然后断言：

```go
list, total, err := s.QueryCmdbAssets(CmdbAssetQuery{
	ResourceScope: "infrastructure",
	Page: 1,
	PageSize: 20,
})
if err != nil {
	t.Fatal(err)
}
if total != 1 || len(list) != 1 || list[0].CategoryName != "交换机" {
	t.Fatalf("基础设施筛选异常: total=%d list=%+v", total, list)
}
```

- [ ] **步骤 2：写六类全局查询失败测试**

临时库分别插入终端、交换机、应用、人员、履历和 IP，断言结果分组：

```go
want := map[string]bool{
	"终端资产": false,
	"基础设施资源": false,
	"业务系统": false,
	"组织与人员": false,
	"运维履历": false,
	"IP 规划池": false,
}
for _, item := range results {
	if _, ok := want[item.Group]; ok {
		want[item.Group] = true
	}
}
for group, found := range want {
	if !found {
		t.Fatalf("全局查询缺少 %q: %+v", group, results)
	}
}
```

- [ ] **步骤 3：确认测试失败**

```powershell
go test ./internal/store -run "TestQueryCmdbAssetsInfrastructureScope|TestGlobalSearchSixGroups" -count=1
```

- [ ] **步骤 4：实现资源域筛选**

给 `CmdbAssetQuery` 增加 `ResourceScope string`，`cmdbQueryFromRequest` 读取 `scope`。`buildCmdbWhere` 仅识别 `infrastructure`：

```go
if strings.EqualFold(strings.TrimSpace(q.ResourceScope), "infrastructure") {
	where = append(where, `(a.source_type = 'legacy_server'
		OR lower(IFNULL(a.device_type,'')) IN ('server','physical_server','virtual_machine','switch','router','security_device','storage')
		OR EXISTS (
			SELECT 1 FROM cmdb_device_categories scope_category
			WHERE scope_category.id = a.category_id
			AND (scope_category.name LIKE '%服务器%'
				OR scope_category.name LIKE '%虚拟机%'
				OR scope_category.name LIKE '%交换机%'
				OR scope_category.name LIKE '%路由器%'
				OR scope_category.name LIKE '%安全设备%'
				OR scope_category.name LIKE '%存储设备%')
		))`)
}
```

该条件必须同时用于列表、总数和导出。

- [ ] **步骤 5：实现六类结构化查询**

扩展结果模型：

```go
type SearchResult struct {
	Type       string                 `json:"type"`
	Group      string                 `json:"group"`
	TableKey   string                 `json:"tableKey"`
	ID         int64                  `json:"id"`
	Title      string                 `json:"title"`
	Subtitle   string                 `json:"subtitle"`
	Tag        string                 `json:"tag"`
	Status     string                 `json:"status"`
	Extra      string                 `json:"extra"`
	IP         string                 `json:"ip"`
	Department string                 `json:"department"`
	Data       map[string]interface{} `json:"data,omitempty"`
}
```

`GlobalSearch` 分别对真实来源执行参数化 `LIKE` 查询，映射固定为：

```go
var searchGroups = map[string]struct{ Group, TableKey string }{
	"terminal":       {"终端资产", "assets"},
	"infrastructure": {"基础设施资源", "cmdb_assets"},
	"system":         {"业务系统", "server_apps"},
	"person":         {"组织与人员", "persons"},
	"audit":          {"运维履历", "asset_logs"},
	"ip":             {"IP 规划池", "ip_pool"},
}
```

任一查询失败立即返回错误，不返回残缺结果或空结果伪装成功。

- [ ] **步骤 6：验证并提交**

```powershell
go test ./internal/store -run "TestQueryCmdbAssetsInfrastructureScope|TestGlobalSearchSixGroups" -count=1
go test ./...
git add internal/store/cmdb_store.go internal/server_cmdb_io.go internal/store/legacy_models.go internal/store/legacy_store.go internal/store/cmdb_store_test.go internal/store/global_search_test.go
git commit -m "feat(search): cover CMDB business domains"
```

## 任务 3：实现 API-only 生命周期和专用 IPC

**文件：**

- 修改：`integrations/netcatty/electron/cmdbService.cjs`
- 修改：`integrations/netcatty/electron/cmdbService.test.cjs`
- 新建：`integrations/netcatty/electron/cmdbBridge.cjs`
- 新建：`integrations/netcatty/electron/cmdbBridge.test.cjs`

- [ ] **步骤 1：先更新生命周期测试**

```js
assert.deepEqual(calls[0].args, [
  "-port", "18080", "-db", "C:/assets.db", "-api-only",
]);
```

新增提前退出测试，断言错误包含 `CMDB 服务提前退出`。

- [ ] **步骤 2：先写桥接边界测试**

```js
test("rejects absolute and escaped API paths", () => {
  assert.throws(() => normalizeApiPath("https://example.com/api/assets"), /CMDB API 路径/);
  assert.throws(() => normalizeApiPath("/api/../admin"), /CMDB API 路径/);
});

test("surfaces non-2xx response errors", async () => {
  await assert.rejects(
    requestCmdb({
      service: { baseUrl: "http://127.0.0.1:18080" },
      path: "/api/assets",
      fetchImpl: async () => new Response('{"error":"数据库忙"}', { status: 500 }),
    }),
    /数据库忙/,
  );
});
```

测试还要覆盖 JSON、二进制、服务未启动、超时、导入取消和导出取消。

- [ ] **步骤 3：确认测试失败**

```powershell
node --test integrations/netcatty/electron/cmdbService.test.cjs integrations/netcatty/electron/cmdbBridge.test.cjs
```

- [ ] **步骤 4：切换服务参数**

将健康检查改为 `/api/health`，参数改为：

```js
const args = [
  "-port", String(port),
  ...(databasePath ? ["-db", databasePath] : []),
  "-api-only",
];
```

- [ ] **步骤 5：实现 IPC 桥**

模块导出：

```js
module.exports = {
  CMDB_CHANNELS: Object.freeze({
    status: "netcatty:cmdb:status",
    request: "netcatty:cmdb:request",
    importFile: "netcatty:cmdb:import-file",
    exportFile: "netcatty:cmdb:export-file",
  }),
  normalizeApiPath,
  requestCmdb,
  registerCmdbBridge,
};
```

规则：只允许规范化后仍以 `/api/` 开头的相对路径；base URL 只能来自 `getService()`；请求超时 30 秒；非 2xx 原样抛出 `{error}` 或响应文本。导入只允许 `/api/import/sangfor` 和 `/api/cmdb/assets/import`，主进程用内存 token 保存文件选择；导出由主进程取得二进制并打开保存对话框。

- [ ] **步骤 6：验证并提交**

```powershell
node --test integrations/netcatty/electron/cmdbService.test.cjs integrations/netcatty/electron/cmdbBridge.test.cjs
git add integrations/netcatty/electron/cmdbService.cjs integrations/netcatty/electron/cmdbService.test.cjs integrations/netcatty/electron/cmdbBridge.cjs integrations/netcatty/electron/cmdbBridge.test.cjs
git commit -m "feat(netcatty): add native CMDB service bridge"
```

## 任务 4：建立统一前端传输层

**文件：**

- 新建：`web/src/cmdbTransport.js`
- 新建：`web/src/cmdbTransport.test.js`
- 修改：`web/src/api.js`
- 修改：`web/src/cmdb/cmdbApi.js`
- 修改：`web/src/AssetCenter.jsx`
- 修改：`web/src/ServerCenter.jsx`
- 修改：`web/src/IPManager.jsx`
- 修改：`web/src/cmdb/CmdbResources.jsx`

- [ ] **步骤 1：写环境选择和错误透传测试**

```js
test("native request uses Netcatty bridge", async () => {
  const calls = [];
  const bridge = { cmdbRequest: async (payload) => { calls.push(payload); return { ok: true }; } };
  const result = await requestJson("/api/health", {}, { bridge, fetchImpl: null });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{ path: "/api/health", method: "GET", body: undefined }]);
});
```

浏览器分支用 500 响应断言真实错误文本未被吞掉。

- [ ] **步骤 2：确认测试失败**

```powershell
node --test web/src/cmdbTransport.test.js
```

- [ ] **步骤 3：实现统一传输 API**

```js
function resolveDeps(deps) {
  const bridge = Object.prototype.hasOwnProperty.call(deps, 'bridge')
    ? deps.bridge
    : globalThis.window?.netcatty;
  const fetchImpl = Object.prototype.hasOwnProperty.call(deps, 'fetchImpl')
    ? deps.fetchImpl
    : globalThis.fetch;
  return { bridge, fetchImpl };
}

async function readBrowserError(response) {
  const text = await response.text();
  try {
    return JSON.parse(text).error || text || `HTTP ${response.status}`;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

export function hasNativeCmdbBridge(bridge = globalThis.window?.netcatty) {
  return typeof bridge?.cmdbRequest === 'function';
}

export async function requestJson(path, options = {}, deps = {}) {
  const { bridge, fetchImpl } = resolveDeps(deps);
  const method = options.method || 'GET';
  if (hasNativeCmdbBridge(bridge)) {
    return bridge.cmdbRequest({ path, method, body: options.body });
  }
  if (typeof fetchImpl !== 'function') throw new Error('CMDB 请求通道不可用');
  const response = await fetchImpl(path, {
    ...options,
    method,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) throw new Error(await readBrowserError(response));
  return response.status === 204 ? null : response.json();
}

export async function importFile(path, options = {}, deps = {}) {
  const { bridge, fetchImpl } = resolveDeps(deps);
  if (typeof bridge?.cmdbImportFile === 'function') {
    return bridge.cmdbImportFile({ path, commit: !!options.commit, token: options.token });
  }
  if (!options.file) throw new Error('请选择导入文件');
  const form = new FormData();
  form.append('file', options.file);
  const response = await fetchImpl(`${path}${options.commit ? '?commit=1' : ''}`, {
    method: 'POST',
    body: form,
  });
  if (!response.ok) throw new Error(await readBrowserError(response));
  return response.json();
}

export async function exportFile(path, suggestedName, deps = {}) {
  const { bridge, fetchImpl } = resolveDeps(deps);
  if (typeof bridge?.cmdbExportFile === 'function') {
    return bridge.cmdbExportFile({ path, suggestedName });
  }
  const response = await fetchImpl(path);
  if (!response.ok) throw new Error(await readBrowserError(response));
  const href = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = suggestedName;
  anchor.click();
  URL.revokeObjectURL(href);
  return { cancelled: false };
}
```

`api.js` 和 `cmdbApi.js` 的请求统一走 `requestJson`。URL 型导出改为执行型：

```js
exportAssets: (params = {}) => exportFile(`/api/export/assets?${toQuery(params)}`, "czfy_assets.xlsx"),
exportIPPool: (params = {}) => exportFile(`/api/ip_pool/export?${toQuery(params)}`, "ip_pool.xlsx"),
```

按钮从 `href` 改为 `onClick`，保留当前筛选；导入预览保存 bridge token，确认时复用同一 token。

- [ ] **步骤 4：验证并提交**

```powershell
node --test web/src/cmdbTransport.test.js
Set-Location web
npm.cmd run build
Set-Location ..
git add web/src/cmdbTransport.js web/src/cmdbTransport.test.js web/src/api.js web/src/cmdb/cmdbApi.js web/src/AssetCenter.jsx web/src/ServerCenter.jsx web/src/IPManager.jsx web/src/cmdb/CmdbResources.jsx
git commit -m "refactor(web): route CMDB through native transport"
```

## 任务 5：重构为六入口工作区

**文件：**

- 新建：`web/src/CmdbWorkspace.jsx`
- 新建：`web/src/cmdbWorkspaceState.js`
- 新建：`web/src/cmdbWorkspaceState.test.js`
- 新建：`web/src/components/ModuleTabs.jsx`
- 新建：`web/src/cmdb-workspace.css`
- 修改：`web/src/App.jsx`
- 修改：`web/src/modules/search/GlobalSearch.jsx`
- 修改：`web/src/cmdb/CmdbResources.jsx`
- 修改：`web/src/ServerCenter.jsx`
- 修改：`web/src/modules/org/OrgPersonCenter.jsx`
- 修改：`web/src/Dashboard.jsx`
- 修改：`web/src/AuditLogs.jsx`
- 修改：`web/src/app.css`
- 修改：`web/src/cmdb/cmdb.css`
- 修改：`web/src/cmdb/resource-ledger.css`
- 修改：`web/src/modules/app-rebuild.css`
- 修改：`web/src/modules/cmdb/cmdb-new.css`
- 修改：`web/src/modules/ippool/ip-pool-new.css`
- 修改：`web/src/modules/org/org-person.css`
- 修改：`web/src/modules/search/search.css`
- 修改：`web/package.json`
- 修改：`web/package-lock.json`

- [ ] **步骤 1：先写导航状态测试**

```js
assert.deepEqual(MODULES.map((item) => item.key), [
  "search", "assets", "infrastructure", "systems", "base", "operations",
]);
assert.deepEqual(SUBMODULES.base.map((item) => item.key), ["people", "ip"]);
assert.deepEqual(SUBMODULES.operations.map((item) => item.key), ["dashboard", "audit"]);
assert.deepEqual(resolveSearchTarget({ tableKey: "persons", id: 7 }), {
  module: "base",
  submodule: "people",
  focusTarget: { tableKey: "persons", id: 7 },
});
```

再覆盖 `assets`、`cmdb_assets`、`server_apps`、`asset_logs` 和 `ip_pool`。

- [ ] **步骤 2：实现固定信息架构**

```js
export const MODULES = [
  { key: "search", label: "全局查询" },
  { key: "assets", label: "终端资产" },
  { key: "infrastructure", label: "基础设施资源" },
  { key: "systems", label: "业务系统" },
  { key: "base", label: "基础管理" },
  { key: "operations", label: "运维分析" },
];

export const SUBMODULES = {
  base: [{ key: "people", label: "组织与人员" }, { key: "ip", label: "IP 规划池" }],
  operations: [{ key: "dashboard", label: "统计概览" }, { key: "audit", label: "运维履历" }],
};
```

- [ ] **步骤 3：接入真实业务组件并保留页面状态**

```jsx
const panelKey = module === 'base'
  ? `base:${baseTab}`
  : module === 'operations'
    ? `operations:${operationsTab}`
    : module;

const panels = [
  ['search', <GlobalSearch onNavigate={handleSearchNavigate} />],
  ['assets', <AssetCenter meta={meta} focusTarget={focusTarget} />],
  ['infrastructure', <CmdbResources meta={meta} scope="infrastructure" title="基础设施资源" />],
  ['systems', <ServerCenter meta={meta} section="apps" focusTarget={focusTarget} />],
  ['base:people', <OrgPersonCenter focusTarget={focusTarget} />],
  ['base:ip', <IPManager meta={meta} focusTarget={focusTarget} />],
  ['operations:dashboard', <Dashboard />],
  ['operations:audit', <AuditLogs meta={meta} focusTarget={focusTarget} />],
];

return panels.map(([key, content]) => visited.has(key) && (
  <section key={key} hidden={panelKey !== key} className="cmdb-module-panel">
    {content}
  </section>
));
```

进入页面时把 `panelKey` 加入 `visited`，已访问页面只隐藏不卸载。`CmdbResources` 把 `scope` 传给列表和导出；`ServerCenter(section="apps")` 隐藏内部服务器/应用切换。全局查询固定六类分组，不再显示“物理服务器”旧名称。

`OrgPersonCenter` 使用 `listPersons({ keyword, department, page, page_size })` 的服务端总数驱动分页，不再先取默认页再做客户端假分页。人员详情、部分/全部资产交接仍使用现有接口。

- [ ] **步骤 4：实现主题和布局约束**

`CmdbWorkspace` 使用 antd `ConfigProvider`，颜色来自 Netcatty CSS 变量，圆角固定 4px。为 Netcatty 的 React 19 增加并导入 `@ant-design/v5-patch-for-react-19`；独立 React 18 构建继续复用同一份组件。

上述 CSS 文件中的业务选择器全部收口到 `.cmdb-workspace` 下；`body`、`:root`、`#root` 规则只保留在独立入口加载的基础样式中，不随 `CmdbWorkspace` 导入。宽表稳定横向滚动，详情使用右侧 Drawer，不新增卡片嵌套。

工作区启动先调用 `cmdbStatus`（浏览器调试环境则直接加载 `/api/meta`）。服务不可用时显示包含真实原因和“重试”按钮的错误页；模块查询失败保留既有列表、筛选和页码。`Dashboard`、`AuditLogs`、`OrgPersonCenter` 不得在 catch 中写入空对象或空数组伪装成功，而是保存并渲染错误状态。

- [ ] **步骤 5：复用同一工作区入口**

`App.jsx` 仅保留开发预览和 `<CmdbWorkspace />`，删除旧 `TopHeader` 装配；`main.jsx` 只服务独立构建检查，不进入 Netcatty 发布物。

- [ ] **步骤 6：验证并提交**

```powershell
node --test web/src/cmdbWorkspaceState.test.js
Set-Location web
npm.cmd run build
Set-Location ..
git add web/src web/package.json web/package-lock.json
git commit -m "feat(web): build native CMDB workspace navigation"
```

## 任务 6：接入 Netcatty 根标签、AppView 和 preload

**文件：**

- 修改：`scripts/prepare-netcatty.mjs`
- 修改：`integrations/netcatty/README.md`
- 装配修改：`components/TopTabs.tsx`
- 装配修改：`application/app/AppView.tsx`
- 装配修改：`application/app/workTabSurface.ts`
- 装配修改：`application/app/AppActiveTabChrome.tsx`
- 装配修改：`electron/main.cjs`
- 装配修改：`electron/main/registerBridges.cjs`
- 装配修改：`electron/preload/api.cjs`
- 装配修改：`global.d.ts`
- 装配修改：`package.json`
- 装配修改：`electron-builder.config.cjs`

- [ ] **步骤 1：装配前校验全部唯一锚点**

在任何写入前检查：

```js
[
  ["components/TopTabs.tsx", "{/* Fixed left tabs: Vaults and SFTP */}"],
  ["application/app/AppView.tsx", "<AppVaultThemeSurface VaultViewContainer={VaultViewContainer}>"],
  ["application/app/workTabSurface.ts", "return activeTabId === 'vault' || activeTabId === 'sftp';"],
  ["electron/preload/api.cjs", "function createPreloadApi"],
  ["global.d.ts", "interface NetcattyBridge {"],
].forEach(([file, anchor]) => assertContainsOnce(file, anchor));
```

缺失或重复时必须在复制前退出。

- [ ] **步骤 2：复制原生源码**

```js
cpSync(join(repositoryRoot, "web", "src"), join(target, "components", "cmdb"), {
  recursive: true,
  force: true,
});
cpSync(join(integrationRoot, "electron", "cmdbService.cjs"), join(target, "electron", "cmdbService.cjs"));
cpSync(join(integrationRoot, "electron", "cmdbBridge.cjs"), join(target, "electron", "bridges", "cmdbBridge.cjs"));
```

不再复制 `integrations/netcatty/plugin/`。

- [ ] **步骤 3：新增固定根标签**

在 Vaults 与 SFTP 之间增加：

```tsx
<RootTopTab
  tabId="cmdb"
  label="CMDB 资产管理"
  icon={<Database size={14} />}
  className="rounded-t-md"
  compact={rootTabsCompact}
/>
```

`isRootPageTabId` 将 `cmdb` 视为根页面；窗口标题映射为 `CMDB 资产管理`。

- [ ] **步骤 4：在 AppView 保活挂载**

```tsx
const CmdbSurface = React.memo(() => {
  const active = useIsTabActive('cmdb');
  return (
    <section className={active ? 'flex min-h-0 flex-1' : 'hidden'} aria-hidden={!active}>
      <CmdbWorkspace />
    </section>
  );
});
```

与 Vault、SFTP 同级挂载，不进入 `PluginContributionHost`，隐藏时不卸载。

- [ ] **步骤 5：接入 bridge 和类型**

主进程向 `registerBridges` 注入 `getCmdbService`。preload 增加：

```js
cmdbStatus: () => ipcRenderer.invoke("netcatty:cmdb:status"),
cmdbRequest: (payload) => ipcRenderer.invoke("netcatty:cmdb:request", payload),
cmdbImportFile: (payload) => ipcRenderer.invoke("netcatty:cmdb:import-file", payload),
cmdbExportFile: (payload) => ipcRenderer.invoke("netcatty:cmdb:export-file", payload),
```

`global.d.ts` 增加对应 Promise 签名。退出时只调用一次 `cmdbService.stop()`。

- [ ] **步骤 6：更新依赖和打包**

`package.json` 增加 `antd`、`@ant-design/icons`、`@ant-design/v5-patch-for-react-19`、`dayjs`；`electron-builder.config.cjs` 只增加 `cmdb-server`。删除 `cmdb-netcatty.ncpkg` 和 CMDB 插件 workspace 构建逻辑。

- [ ] **步骤 7：在全新上游 Release 装配并验证**

```powershell
git clone https://github.com/binaricat/Netcatty.git build/netcatty-native-validation
Set-Location build/netcatty-native-validation
git checkout v1.1.83
Set-Location ../..
node scripts/prepare-netcatty.mjs --target build/netcatty-native-validation
Set-Location build/netcatty-native-validation
npm.cmd install
node --test electron/cmdbService.test.cjs electron/bridges/cmdbBridge.test.cjs
npm.cmd run lint
npm.cmd run build
Set-Location ../..
```

预期：全部退出码为 0，存在 `components/cmdb/CmdbWorkspace.jsx`，不存在 `examples/plugins/cmdb-netcatty`。

- [ ] **步骤 8：提交**

```powershell
git add scripts/prepare-netcatty.mjs integrations/netcatty/electron integrations/netcatty/README.md
git commit -m "feat(netcatty): mount CMDB as a native root workspace"
```

## 任务 7：移除旧插件并完成原生验收

**文件：**

- 删除：`integrations/netcatty/plugin/`
- 修改：`integrations/netcatty/README.md`
- 新建：`docs/Netcatty原生CMDB-验收记录.md`

- [ ] **步骤 1：确认装配链不再引用旧插件**

```powershell
rg -n "cmdb-netcatty|view\.html|ncpkg|integrationRoot, \"plugin\"" scripts/prepare-netcatty.mjs integrations/netcatty/README.md
```

预期：没有安装或打包旧插件的引用。

- [ ] **步骤 2：使用 `apply_patch` 删除旧插件文件并提交**

```powershell
git add -A integrations/netcatty/plugin integrations/netcatty/README.md scripts/prepare-netcatty.mjs
git commit -m "refactor(netcatty): remove legacy CMDB web plugin"
```

- [ ] **步骤 3：运行全量自动化验证**

```powershell
go test ./...
node --test integrations/netcatty/electron/cmdbService.test.cjs integrations/netcatty/electron/cmdbBridge.test.cjs web/src/cmdbTransport.test.js web/src/cmdbWorkspaceState.test.js
Set-Location web
npm.cmd run build
Set-Location ..
node scripts/prepare-netcatty.mjs --target build/netcatty-native-validation
Set-Location build/netcatty-native-validation
npm.cmd run lint
npm.cmd run build
Set-Location ../..
```

- [ ] **步骤 4：启动原生窗口手测**

```powershell
go build -o build/cmdb-server.exe .
$env:NETCATTY_CMDB_SERVER_PATH = (Resolve-Path 'build/cmdb-server.exe').Path
$env:NETCATTY_CMDB_DB_PATH = (Resolve-Path 'assets.db').Path
Set-Location build/netcatty-native-validation
npm.cmd run dev
```

逐项验证：固定 CMDB 根标签、不打开浏览器、六个一级入口、四个组合页签、六类全局查询、终端资产全流程、含交换机的基础设施台账、业务系统、组织人员与资产交接、IP 分配释放、统计与履历、跨根标签状态保留、明暗主题、服务失败错误页。

- [ ] **步骤 5：记录真实证据并提交**

`docs/Netcatty原生CMDB-验收记录.md` 写入实际命令、退出码、截图路径、失败修复和未通过项，不得把未执行项写成通过。

```powershell
git add docs/Netcatty原生CMDB-验收记录.md
git commit -m "docs(netcatty): record native CMDB acceptance"
git status --short
```

预期：除用户原有无关改动外工作区干净。
