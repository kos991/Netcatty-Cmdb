# Netcatty-CMDB

[![CI](https://github.com/kos991/Netcatty-Cmdb/actions/workflows/ci.yml/badge.svg)](https://github.com/kos991/Netcatty-Cmdb/actions/workflows/ci.yml)
[![Release](https://github.com/kos991/Netcatty-Cmdb/actions/workflows/release.yml/badge.svg)](https://github.com/kos991/Netcatty-Cmdb/actions/workflows/release.yml)

Netcatty-CMDB 将本项目的 Go + SQLite CMDB 服务作为内置服务集成到
[Netcatty](https://github.com/binaricat/Netcatty) 桌面客户端。Netcatty 保留 SSH、SFTP、终端和主机管理能力，
Cmdb 提供设备资产统一查询、终端资产、基础设施、业务系统、组织架构、IPAM/IP、统计与履历和配置中心，直接复用 Netcatty 原生组件。

当前版本：`1.0.202610221542`（格式 `1.0.YYYYMMDDHHmm`，以 `VERSION` 为准）

## 集成结构

```text
Netcatty 桌面客户端
├─ 原有 SSH / SFTP / 终端能力
├─ 原生 Cmdb 工作区
│  ├─ 设备资产（终端资产 / 基础设施 / 业务系统）
│  ├─ 组织架构、IPAM/IP
│  ├─ 统计与履历
│  └─ 配置中心
└─ 自动管理 cmdb-server 子进程

cmdb-server
├─ Go HTTP API
└─ SQLite 数据库（只提供本地 API，不包含浏览器界面）
```

Netcatty 前端不直接访问 SQLite。桌面主进程在固定回环地址 `http://127.0.0.1:18080`
启动 CMDB 服务，原生工作区通过 preload IPC bridge 调用服务；应用退出时会回收服务进程。

## 仓库目录

```text
internal/                       Go API 与 SQLite 存储层
integrations/netcatty/cmdb/      唯一正式界面源码（Netcatty 原生组件）
integrations/netcatty/update/   集成版自动更新（指向本仓库 Release）
integrations/netcatty/electron/ CMDB 子进程生命周期模块与测试
integrations/netcatty/upstream.json  已验证的 Netcatty 上游提交
integrations/netcatty/patch/    离线 Cmdb 补丁的安装脚本与说明
scripts/prepare-netcatty.mjs    可重复的 Netcatty 集成装配器
scripts/build-cmdb-patch.mjs    生成离线 Cmdb 补丁包
.github/workflows/ci.yml        CMDB、原生 Bridge 和 Netcatty 集成验证
.github/workflows/release.yml   Windows 集成版客户端与离线补丁发布
.github/workflows/upstream-sync.yml  每天检查上游 Netcatty 新版本并开 PR
```

## 交互设计原型

当前评审原型、预览图片及资源说明见 [Cmdb 交互设计原型](docs/prototypes/cmdb/README.md)。
本地可直接打开 [HTML 交互入口](docs/prototypes/cmdb/device-assets-preview.html#terminal)，无需构建或启动后端。
原型仅用于设计评审，不是正式浏览器版产品；不连接真实数据，不能据此认定正式客户端已实现相同布局。

## 本地验证

测试并构建内置服务：

```powershell
go test ./...
go build -o build/cmdb-server.exe .
```

准备一份干净的 Netcatty 集成源码：

```powershell
$upstream = Get-Content integrations/netcatty/upstream.json | ConvertFrom-Json
git clone $upstream.repository build/netcatty
git -C build/netcatty checkout $upstream.commit
node scripts/prepare-netcatty.mjs --target build/netcatty
cd build/netcatty
npm.cmd install --ignore-scripts
npm.cmd run build
```

装配器会检查上游提交和修改锚点。提交不一致或上游结构变化时会直接失败，防止生成未经验证的客户端。

## 分支、PR 与发布

- `main` 只接受 PR 合并。每个修复或新功能单独开分支并提交 PR，按类型打 `fix` 或 `feature` 标签；PR 必须通过 CI。
- 每次推送到 `main` 和每个 PR 都会运行：版本格式校验、原生界面数据测试、Go 全量测试与服务端构建、UOS/Kylin 探针及 Python CLI、固定 Netcatty 上游装配、服务生命周期与 Bridge 测试、Netcatty lint 与完整前端构建。
- 发布：在 PR 中把 `VERSION` 和 `netcatty/package.json` 改为发布时的 `1.0.YYYYMMDDHHmm`，合并后在 `main` 上打同名 tag 并推送；同一天可多次发布。
- tag 必须指向已合并到 `main` 的提交，否则 Release 失败。Release 只构建 Windows x64：完整安装包 `Netcatty-Cmdb-<版本>-win-x64.exe`、离线补丁图形安装器 `Netcatty-Cmdb-patch-<版本>-win-x64.exe` 和 SHA-256 校验文件。宿主应用版本保持上游 Netcatty 版本，文件名使用 Cmdb 版本。
- Release 说明按自上个 tag 以来合并的 PR 自动汇总，分为“修复”“新功能”“其他变更”（见 `.github/release.yml`）。
- 宿主“软件更新”只检查上游 Netcatty 并提示，不下载或安装上游官方包，防止覆盖 Cmdb。Cmdb 升级用完整安装包或补丁安装器；补丁只替换 `app.asar` 和 `resources/cmdb`，安装前校验本机宿主 Netcatty 的上游提交与补丁一致。两者都不修改 `%APPDATA%\netcatty` 中的用户数据。
- 上游同步：`upstream-sync.yml` 每天检查上游 Netcatty 最新正式版本，有新版本时更新 `upstream.json`（含 mosh/et 版本）、尝试装配并开 PR，PR 正文写明装配是否成功。不会自动合并或发布；装配失败时需要在该分支上人工适配。

## 数据与功能边界

- 数据库默认位于 Netcatty 用户数据目录下的 `assets.db`。
- 删除资产采用注销归档，不物理删除历史记录。
- 资产导出使用当前筛选条件，导出全部匹配记录。
- 开发环境可通过 `NETCATTY_CMDB_SERVER_PATH` 和 `NETCATTY_CMDB_DB_PATH` 指定服务与数据库。
- 插件网络权限仅允许访问 `http://127.0.0.1:18080`。

## 许可证

本仓库自有代码采用 [MIT License](LICENSE)。发布的 Netcatty 集成客户端包含上游 Netcatty，遵循其
GPL-3.0-or-later 许可证；Netcatty 的版权与商标归其原作者所有。
