# Cmdb 原生桌面

[![Windows CI](https://github.com/kos991/Netcatty-Cmdb/actions/workflows/rust.yml/badge.svg)](https://github.com/kos991/Netcatty-Cmdb/actions/workflows/rust.yml)

当前版本：`1.0.202610221542`，以 `VERSION` 为准。本分支是 Rust + GPUI Windows 原生桌面开发构建，没有创建新发布版本。

当前已实现原生窗口、暗色界面、可新增／切换／关闭的标签、左右分栏与合并、页面导航和键盘操作。Logo 只有图形，无“资产全景”文字，也没有额外全局搜索或通知工具。窗口由 GPUI 绘制，不使用 HTML、WebView 或 Electron。

业务页面保持已确认的分类与字段语义，未迁移的业务明确显示“业务服务尚未接入”，不会注入原型示例数据、生成虚假资产或把空列表标成真实查询结果。资产 CRUD、组织维护、地址分配、机柜编辑、工单、数据库、认证、采集与导入导出尚未实现。本次只交付可运行的桌面工作区，不宣称完成全业务迁移。

## 运行

从本分支 [Windows CI](https://github.com/kos991/Netcatty-Cmdb/actions/workflows/rust.yml) 的成功运行下载 `cmdb-desktop-windows-x64` 制品，解压后运行 `cmdb-desktop.exe`。制品同时包含 `SHA256SUMS.txt` 与实际解析的 `Cargo.lock`。这是开发构建，不是安装器或正式 Release。

- 点击 `+` 选择页面，可重复打开同类页面。
- 点击标签切换，点击标签上的 `×` 关闭；全部关闭后可以重新打开。
- 点击“左右分栏”并排查看两个标签；点击右侧对应标签会交换两栏；“合并分栏”恢复单栏。
- `Ctrl+T` 打开标签菜单，`Ctrl+W` 关闭当前标签，`Ctrl+\` 切换分栏，`Esc` 关闭菜单。
- 最小化、最大化／还原、关闭使用真实 Windows 标题栏。关闭最后一个窗口退出进程。

## 源码与构建

```text
crates/cmdb-desktop/src/main.rs   GPUI 桌面 binary 与事件绑定
crates/cmdb-engine/src/lib.rs     无 UI 依赖的标签／分栏状态规则
.github/workflows/rust.yml       Windows x64 CI 与 exe 制品
rust-toolchain.toml              固定 Rust 1.91.1
.cargo/config.toml               MSVC 静态运行库与 GPUI Windows 配置
```

GPUI 固定为官方 Zed [v0.218.7](https://github.com/zed-industries/zed/tree/41bab92dac34777ae4256e5041f7b7236fd16cdd) 的提交 `41bab92dac34777ae4256e5041f7b7236fd16cdd`。Rust 版本遵循该提交的官方工具链文件。Windows 构建使用 `windows-2022`、MSVC x64 和 Windows SDK；依赖依据 [官方 Windows 构建文档](https://github.com/zed-industries/zed/blob/41bab92dac34777ae4256e5041f7b7236fd16cdd/docs/src/development/windows.md)。

按用户约束，编译在 GitHub Actions 完成，不在本机运行 `cargo build`。CI 执行共享状态规则测试与 `cargo build --release -p cmdb-desktop --bin cmdb-desktop --target x86_64-pc-windows-msvc`，push 到 `feature/**`、`fix/**`、main、PR 和手动触发均可运行。旧 Go／Netcatty CI、发行与上游同步工作流已移除，不再调用被删除的源码。没有自动发布任务。

## 设计与边界

暗色层次、标签与并排工作区参考 [Tern](https://docs.stencil.so/tern/)；不引入 Tern 插件 SDK，不重画既有业务原型。原型继续保存在 [docs/prototypes/cmdb](docs/prototypes/cmdb/README.md)，仅是设计资料，不能作为原生窗口运行证据。

四层职责及已实现／未实现范围见 [GPUI 架构文档](docs/GPUI-Architecture.md)，操作见 [使用说明](使用说明.md)。`cmdbd` 与 `cmdb-agent` 仍是未实施职责，不编译空服务、不监听端口，也不声明数据库兼容。当前程序不访问旧 `%APPDATA%\netcatty` 数据，关闭后标签状态不保存。

所有变更通过独立分支和 PR，不直接推送 main；版本保持 `VERSION`，没有发布授权时不打 tag、不生成新版本号。

本仓库自有代码采用 [MIT License](LICENSE)，GPUI 遵循其上游 Apache-2.0 许可证。
