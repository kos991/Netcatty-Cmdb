# 前端交接说明（给 Google Antigravity）

本文件是「常州中院云桌面资产管理工具」前端部分的交接文档，供接手前端 UI 打磨的人快速上手。
后端 + 数据已全部就绪并验证通过，前端功能也已完成，本轮只需要做 **UI / 视觉 / 交互打磨**，不要动数据结构和 API。

## 1. 技术栈

- React 18 + Ant Design 5（`antd` + `@ant-design/icons`）
- Vite 5 构建
- 纯 JavaScript（无 TS），无路由库（用 state 切换页面），无状态管理库
- 前端构建产物会 `go:embed` 进 exe，由 Go 后端同源提供（无跨域问题）

## 2. 目录结构（前端源码在 `web/`）

```
web/
├─ index.html
├─ package.json
├─ vite.config.js        base='./'，build 输出到 dist/
├─ src/
│  ├─ main.jsx           入口（ConfigProvider + 主题色 #1f4e79）
│  ├─ App.jsx            布局：Sider 菜单 + Header + Content，state 切换页面
│  ├─ api.js             所有后端请求的封装
│  ├─ Dashboard.jsx      统计看板
│  ├─ TablePage.jsx      通用数据表页（15 张表复用这一个组件）
│  ├─ Duplicates.jsx     SN 查重
│  └─ GlobalSearch.jsx   全局搜索
└─ dist/                 Vite 构建产物（不要手改）
```

## 3. 本地开发 / 构建

```bat
cd web
npm.cmd install          :: 已装过可跳过
npm.cmd run dev          :: 开发服务器，但 API 走不到 → 见下方联调
npm.cmd run build        :: 构建到 web/dist
```

**联调方式**：前端 fetch 用的是相对路径 `/api/...`，开发时若用 `vite dev`，API 请求会打到 vite 的端口而 404。
推荐两种：
1. 先 `npm.cmd run build`，再用后端跑（`go run . --no-browser`，后端在 127.0.0.1 某端口同时提供静态页面 + API），浏览器打开后端地址直接看效果。
2. 或在 `vite.config.js` 加 `server.proxy` 把 `/api` 代理到后端端口。

改完前端记得 `npm.cmd run build` 后 `go build` 重新打包 exe（见根目录 `使用说明.md`）。

## 4. API 契约（全部 JSON，同源，无需鉴权）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/meta` | 元数据 |
| GET | `/api/tables/{key}` | 某表全部行 |
| POST | `/api/tables/{key}` | 新增一行 |
| PUT | `/api/tables/{key}/{id}` | 更新一行 |
| DELETE | `/api/tables/{key}/{id}` | 删除一行 |
| GET | `/api/search?q=` | 全局搜索 |
| GET | `/api/stats` | 看板统计 |
| GET | `/api/duplicates` | SN 查重 |
| GET | `/api/export/{key}?format=csv|xlsx` | 导出下载 |

### 元数据
```json
GET /api/meta
{ "tables": [
  { "key": "dengji", "name": "登记", "group": "资产台账",
    "columns": ["资产编码","显示器SN","盒子SN","显示器SN前缀","显示器SN后4位","盒子SN前缀","盒子SN后5位","房间","安元软件情况","业务IP","姓名","备注","更新日期"] },
  ...
] }
```

### 列表 / 行
```json
GET /api/tables/dengji
{ "rows": [ { "id": 1, "data": { "资产编码":"...", "显示器SN":"...", "姓名":"..." } } ], "total": 683 }
```

### 新增 / 更新（body）
```json
{ "data": { "字段名": "值", ... } }
```

### 全局搜索
```json
GET /api/search?q=邹婷婷
{ "results": [ { "tableKey":"dengji", "table":"登记", "group":"资产台账", "id":2, "data":{...} } ], "total": 3 }
```

### 统计（看板）
```json
GET /api/stats
{ "count_dengji":683, "count_hezi":501, "count_xianshi":641, "count_weixiu":1,
  "hezi_zaiyong":500, "hezi_xianzhi":1, "hezi_sunhuai":0, "hezi_weichai":9, "hezi_cangku":145,
  "xianshi_zaiyong":453, "xianshi_xianzhi":0, "xianshi_sunhuai":8, "xianshi_weichai":1, "xianshi_cangku":179,
  "ip_used":600, "ip_unused":123, "waiwang_used":75, "count_waiwang":255, ... }
```
> `count_<key>` 对 15 张表都有。`ip_used`/`ip_unused` 是专网 7/8/9/10 段「帐号非空且非『未使用』/含『未使用』」的计数。

### SN 查重
```json
GET /api/duplicates
{ "duplicates": [ { "sn":"TGME...", "count":2, "where":["xianshi#17","xianshi#25"] } ], "total": 20 }
```
> `where` 形如 `表key#行id`。

## 5. 表清单（key / 名称 / 分组）

| key | 名称 | 分组 |
|---|---|---|
| dengji | 登记 | 资产台账 |
| hezi | 盒子登记 | 资产台账 |
| xianshi | 显示器登记 | 资产台账 |
| weixiu | 维修替换 | 资产台账 |
| huishou | 云桌面回收 | 资产台账 |
| laodalou | 从老大楼拿回的屏 | 资产台账 |
| zw7 / zw8 / zw9 / zw10 | 专网7/8/9/10段 | IP规划 |
| heziip | 专网盒子IP | IP规划 |
| waiwang | 外网IP | IP规划 |
| fating | 法庭房间查询 | IP规划 |
| guihua | 专网规划 | IP规划 |
| anyuan | 未安装安元的法庭 | IP规划 |

## 6. 现有实现的关键点（打磨时别破坏）

- `App.jsx` 的菜单 key 约定：看板=`dashboard`、全局搜索=`gsearch`、SN 查重=`duplicates`、数据表=`table:<key>`。
- `TablePage.jsx` 是 15 张表的通用页：行数据被拍平成 `{...data, __id: id}`，`rowKey="__id"`；列由 `table.columns` 动态生成；搜索是**客户端**关键字过滤；导出用 `<Button href={api.exportUrl(...)}>` 直接跳转下载。
- 表格宽度用 `scroll={{ x: 'max-content' }}` 横向滚动（登记表有 13 列）。
- 新增/编辑弹窗：一个 `Form.Item` 对应一列，全 `Input`，提交时把值装回 `{字段:值}`。

## 7. 可打磨方向（供参考，自行取舍）

- 侧边栏视觉、顶部 Header、看板卡片更精致（配色/间距/图标/空状态）
- 长表（登记 13 列）的列宽、固定列、默认显示列
- 编辑弹窗对 13 个字段做分栏布局（如 2~3 列栅格）而非单列长滚动
- 手机/窄屏响应式体验
- 状态列（在用在/闲置/损坏…）用彩色 Tag 渲染
- 空值显示、日期列对齐、关键字高亮
- 加载态 / 错误态 / 空态统一处理
