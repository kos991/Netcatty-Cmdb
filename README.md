# Cmdb 原生桌面

[![Windows CI](https://github.com/kos991/Netcatty-Cmdb/actions/workflows/rust.yml/badge.svg)](https://github.com/kos991/Netcatty-Cmdb/actions/workflows/rust.yml)

当前版本：`1.0.202610221542`，以 `VERSION` 为准。本分支是基于 [BUI (Blender UI)](https://github.com/ppmpreetham/BUI)（`blenderui = "0.4.1"`）构建的 Windows 原生桌面，采用 Blender 原生 C kit 与 Direct3D 11 GPU 硬件加速渲染，彻底替代 HTML iframe 网页缝合外壳。

当前已实现原生暗色工作区、多标签新增／切换／关闭、左侧暗色导航栏、左右分栏与状态行。终端资产页面已直接接入原生虚拟数据表格（`DataTable`），支持真实字段（序号、设备名称/SN、设备类型、品牌/型号、使用人/部门、房间号、IP 地址、网络类型、设备状态），并通过 Windows GDI 引擎原生渲染微软雅黑清晰中文字体。窗口由 BUI 原生绘制，不使用 HTML、WebView、Chromium 或 Electron。

## 运行

从本分支 [Windows CI](https://github.com/kos991/Netcatty-Cmdb/actions/workflows/rust.yml) 的成功运行下载 `cmdb-desktop-windows-x64` 制品，解压后运行 `cmdb-desktop.exe`。制品同时包含 `SHA256SUMS.txt` 与实际解析的 `Cargo.lock`。这是开发构建，不是安装器或正式 Release。

- 点击 `+` 选择页面，可重复打开同类页面。
- 点击标签切换，点击标签上的 `×` 关闭；全部关闭后可以重新打开。
- 点击“左右分栏”并排查看两个标签；点击右侧对应标签会交换两栏；“合并分栏”恢复单栏。
- `Ctrl+T` 打开标签菜单，`Ctrl+W` 关闭当前标签，`Ctrl+\` 切换分栏，`Esc` 关闭菜单。
- 最小化、最大化／还原、关闭使用真实 Windows 标题栏。关闭最后一个窗口退出进程。

本轮验收：提交 `780afda` 的 [Windows CI #42351111074](https://github.com/kos991/Netcatty-Cmdb/actions/runs/42351111074) 已通过共享状态规则测试、BUI C kit 编译与原生桌面构建（用时 1 分 24 秒）。下载产物后在 Windows 本机启动，观察到标题为 `Cmdb` 的 Windows 原生暗色高密度窗口，顶栏纯 Logo、标签页（带关闭按钮）和加号均正常渲染，左侧为纯原生暗色紧凑导航；终端资产列表直接渲染原生虚拟数据表格（包含 30 条真实资产样本，支持条纹隔行与表头列排序），中文显示为原生微软雅黑，无豆腐块或乱码。exe 大小仅 5.22 MB，SHA-256（`aaee94381ab60b72790db2a5a8a8dafa6ffb3f4a7e4781ec157764f1a59da294`）与制品校验文件一致。本地证据位于 `build/native-ci/bui-native-window.png`，未在本地执行 cargo build。

## 源码与构建

```text
crates/cmdb-desktop/src/main.rs   BUI 原生桌面 binary 与 DataTable 数据绑定
crates/cmdb-engine/src/lib.rs     无 UI 依赖的标签／分栏状态规则
.github/workflows/rust.yml       Windows x64 CI 与 exe 制品
rust-toolchain.toml              固定 Rust 1.91.1
.cargo/config.toml               MSVC 动态运行库配置
```

BUI 采用官方 crates.io 发行版本 `blenderui = "0.4.1"`。Windows 构建使用 `windows-2022`、MSVC x64、CMake 3.20+ 与 Windows SDK。

按用户约束，编译在 GitHub Actions 完成，不在本机运行 `cargo build`。CI 执行共享状态规则测试与 `cargo build --release -p cmdb-desktop --bin cmdb-desktop --target x86_64-pc-windows-msvc`，push 到 `feature/**`、`fix/**`、main、PR 和手动触发均可运行。旧 Go／Netcatty CI、发行与上游同步工作流已移除，不再调用被删除的源码。没有自动发布任务。

## 设计与边界

暗色层次、标签与并排工作区参考 [Tern](https://docs.stencil.so/tern/)；不引入 Tern 插件 SDK，不重画既有业务原型。原型继续保存在 [docs/prototypes/cmdb](docs/prototypes/cmdb/README.md)，仅是设计资料，不能作为原生窗口运行证据。

四层职责及已实现／未实现范围见 [GPUI 架构文档](docs/GPUI-Architecture.md)，操作见 [使用说明](使用说明.md)。`cmdbd` 与 `cmdb-agent` 仍是未实施职责，不编译空服务、不监听端口，也不声明数据库兼容。当前程序不访问旧 `%APPDATA%\netcatty` 数据，关闭后标签状态不保存。

所有变更通过独立分支和 PR，不直接推送 main；版本保持 `VERSION`，没有发布授权时不打 tag、不生成新版本号。

本仓库自有代码采用 [MIT License](LICENSE)，GPUI 遵循其上游 Apache-2.0 许可证。
