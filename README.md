# Netcatty-CMDB

[![CI](https://github.com/kos991/Netcatty-Cmdb/actions/workflows/ci.yml/badge.svg)](https://github.com/kos991/Netcatty-Cmdb/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Go Version](https://img.shields.io/badge/Go-%3E%3D1.22-00ADD8.svg)](https://golang.org)
[![Netcatty](https://img.shields.io/badge/Netcatty-Extension-brightgreen.svg)](https://github.com/binaricat/Netcatty)

> 基于 [Netcatty](https://github.com/binaricat/Netcatty) 的现代化 CMDB 资产管理与虚拟机补丁盘点扩展平台。专为批量控制**统信 UOS**与**银河麒麟（KylinOS）**虚拟机、盘点安装包与仓库软件源安全补丁而设计。

---

## 🌟 核心特性

### 1. Netcatty 深度内嵌与联动 (方案 1)
- **客户端内嵌主面板**：无缝融入 Netcatty 原生界面，可在客户端侧边栏内直接浏览、搜索和维护 CMDB 资产。
- **主机库双向同步**：一键将 CMDB 中的虚拟机、操作系统标签、IP 和负责人导出并同步至 Netcatty 的 Hosts 列表。
- **快捷指令集 (Snippets)**：内置针对统信 UOS 与银河麒麟的批量检查探针，一键下发到多台终端并发执行。
- **AI 助手智能技能 (User Skill)**：支持在 Netcatty 对话框输入自然语言指令（例如：“扫描所有 UOS 虚拟机的安全补丁”）。

### 2. 统信 UOS & 银河麒麟 免安装轻量探针
- **免侵入零依赖**：无须在虚拟机上安装任何 Daemon 常驻进程或第三方 Agent，纯 Shell 编写，直接利用系统原生包管理器。
- **统信 UOS 探针 (`probes/uos_probe.sh`)**：基于 `dpkg-query` 盘点全部已安装软件，基于 `apt-get -s upgrade` 安全仿真比对软件源 CVE 补丁。
- **银河麒麟 KylinOS 探针 (`probes/kylin_probe.sh`)**：基于 `/etc/kylin-release`、`rpm -qa` 与 `dnf/yum check-update -q` 提取安全更新与已安装清单。
- **自动化结果回填**：探针输出结构化 JSON，自动同步更新至 CMDB 资产的自定义字段与盘点明细。

### 3. 企业级 CMDB 核心能力
- **资产全生命周期与动态字段**：内置字段设计器，支持文本、数字、布尔、单选/多选动态扩展。
- **组织架构与人员穿透**：部门多级树状管理，人员名下资产即时穿透抽屉，支持离职/调岗一键批量转交。
- **IP 规划池**：IP 段自动规范化、状态分配流转（已分配、空闲、预留）与子网统计。
- **单二进制自包含**：Go + 内嵌 React/Vite 前端，零外部依赖，自带高性能 SQLite 引擎。

---

## 📂 项目结构

```text
Netcatty-Cmdb/
├── .github/workflows/
│   ├── ci.yml                 # CI 流水线 (前端构建 / 后端测试 / 探针静态分析)
│   └── release.yml            # 自动化 Release (多架构打包与发布)
├── cli/
│   └── cmdb_cli.py            # Netcatty CLI 驱动核心 (查询/下发探针/回填)
├── netcatty/
│   ├── package.json           # Netcatty 插件清单配置
│   ├── embed_loader.js        # Netcatty 内嵌面板加载器
│   ├── host_sync.py           # CMDB 与 Netcatty 主机双向同步器
│   ├── snippets.json          # 预设 Netcatty 快捷运维命令
│   └── SKILL.md               # Netcatty AI Agent 技能定义
├── probes/
│   ├── uos_probe.sh           # 统信 UOS 轻量安全探针
│   ├── kylin_probe.sh         # 银河麒麟轻量安全探针
│   └── test_probes.sh         # 探针语法与逻辑自检测试
├── internal/
│   ├── api/                   # HTTP RESTful API 路由与控制器
│   └── store/                 # SQLite 存储层与平滑迁移引擎
├── web/                       # 现代化前端工程 (React + Vite + Tailwind)
├── main.go                    # 服务端主入口 (支持单文件直接启动)
└── go.mod
```

---

## 🚀 快速上手

### 1. 启动 CMDB 服务
直接运行编译后的二进制程序：
```bash
# Windows
cmdb-server.exe -port 8080

# Linux / macOS
./cmdb-server -port 8080
```
服务将在 `http://127.0.0.1:8080` 启动，包含完整的 CMDB 管理面板。

### 2. 在 Netcatty 中安装与使用

#### 方法 A：安装 AI Agent 技能 (User Skill)
将 `netcatty/` 目录拷贝到 Netcatty 的技能目录：
- **Windows**: `%APPDATA%\netcatty\Skills\CMDB\`
- **macOS/Linux**: `~/.config/netcatty/Skills/CMDB/`

在 Netcatty 对话框中即可直接通过自然语言下发指令。

#### 方法 B：同步 CMDB 主机至 Netcatty
运行主机同步工具，导出包含分组与标签的 JSON：
```bash
python netcatty/host_sync.py --os all -o netcatty_hosts.json
```
在 Netcatty 界面中点击 **[设置] -> [导入]**，即可载入全部虚拟机。

---

## 🛠️ 本地开发与构建

### 1. 前端构建
```bash
cd web
npm install
npm run build
```

### 2. 后端测试与编译
```bash
# 执行全量单元测试
go test -v -count=1 ./...

# 编译统一单二进制
go build -o cmdb-server .
```

### 3. 探针测试
```bash
bash probes/test_probes.sh
```

---

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源协议。
