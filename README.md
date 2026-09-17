# Netcatty-CMDB

[![CI](https://github.com/kos991/Netcatty-Cmdb/actions/workflows/ci.yml/badge.svg)](https://github.com/kos991/Netcatty-Cmdb/actions/workflows/ci.yml)
[![Release](https://github.com/kos991/Netcatty-Cmdb/actions/workflows/release.yml/badge.svg)](https://github.com/kos991/Netcatty-Cmdb/actions/workflows/release.yml)

Netcatty-CMDB 将本项目的 Go + SQLite CMDB 服务作为内置服务集成到
[Netcatty](https://github.com/binaricat/Netcatty) 桌面客户端。Netcatty 保留 SSH、SFTP、终端和主机管理能力，
CMDB 提供全局查询、资产台账、服务器与应用、运维履历、IP 规划池以及资产生命周期管理。

当前版本：`1.2.0`

## 集成结构

```text
Netcatty 桌面客户端
├─ 原有 SSH / SFTP / 终端能力
├─ 原生 CMDB 资产管理工作区
│  ├─ 全局查询与终端资产
│  ├─ 基础设施资源与业务系统
│  ├─ 组织与人员、IP 规划池
│  └─ 统计概览与运维履历
└─ 自动管理 cmdb-server 子进程

cmdb-server
├─ Go HTTP API
├─ SQLite 数据库
└─ React 18 + Ant Design 5 管理界面
```

Netcatty 前端不直接访问 SQLite。桌面主进程在固定回环地址 `http://127.0.0.1:18080`
启动 CMDB 服务，原生工作区通过 preload IPC bridge 调用服务；应用退出时会回收服务进程。

## 仓库目录

```text
internal/                       Go API 与 SQLite 存储层
web/                            React + Ant Design 管理界面
integrations/netcatty/electron/ CMDB 子进程生命周期模块与测试
integrations/netcatty/upstream.json  已验证的 Netcatty 上游提交
scripts/prepare-netcatty.mjs    可重复的 Netcatty 集成装配器
.github/workflows/ci.yml        CMDB、原生 Bridge 和 Netcatty 集成验证
.github/workflows/release.yml   服务端与集成版客户端发布
```

## 本地验证

构建前端并测试后端：

```powershell
cd web
npm.cmd ci
npm.cmd run build
cd ..
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

## CI 与发布

每次推送到 `main` 都会验证：

- Ant Design 前端可构建；
- Go 全量测试和服务端构建；
- UOS/Kylin 探针及 Python CLI；
- 固定 Netcatty 上游提交可成功装配；
- CMDB 服务生命周期测试、原生 Bridge 测试、Netcatty lint 与完整前端构建。

推送与 `VERSION` 一致的标签会触发 Release。`v1.2.0` 发布内容包括：

- Windows、Linux、macOS 的独立 `cmdb-server`；
- Windows x64 集成版 Netcatty-CMDB Portable；
- SHA-256 校验文件。

## 数据与功能边界

- 数据库默认位于 Netcatty 用户数据目录下的 `assets.db`。
- 删除资产采用注销归档，不物理删除历史记录。
- 资产导出使用当前筛选条件，导出全部匹配记录。
- 开发环境可通过 `NETCATTY_CMDB_SERVER_PATH` 和 `NETCATTY_CMDB_DB_PATH` 指定服务与数据库。
- 插件网络权限仅允许访问 `http://127.0.0.1:18080`。

## 许可证

本仓库自有代码采用 [MIT License](LICENSE)。发布的 Netcatty 集成客户端包含上游 Netcatty，遵循其
GPL-3.0-or-later 许可证；Netcatty 的版权与商标归其原作者所有。
