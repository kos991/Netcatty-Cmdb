# Cmdb GPUI 原生桌面架构

当前版本：`1.0.202610221542`，来自 `VERSION`；本次为开发构建，不创建新发布。

## 当前实现

Rust workspace 包含真正可执行的 `cmdb-desktop` 和实际被调用的 `cmdb-engine`。桌面通过 GPUI `Application` 创建 Windows 原生窗口，入口是 `crates/cmdb-desktop/src/main.rs`。共享库负责标签身份、选择、关闭后的选择恢复、双栏切换与两栏交换；桌面事件直接调用这些规则，再通知 GPUI 重绘。

界面为暗色、多标签和左右分栏。`+` 打开页面选择菜单，标签可重复新增、切换和关闭，单标签分栏会新建同类标签。关闭所有标签后显示重新打开提示。左侧导航定位已打开的页面，未打开时新增。窗口控制使用 Windows 标题栏；关闭最后窗口退出进程。没有全局搜索、通知栏或虚假保存按钮，Logo 不附带产品文字。

页面沿用已确认的终端资产、基础设施、业务系统、组织架构、设备机柜、地址池、工单与统计分类及字段语义。未接入业务时明确显示服务未实现，不伪造记录、统计、保存或网络状态。既有 HTML 原型保持设计参考身份，不嵌入桌面，也不用于原生运行验收。

## 四层职责与实施边界

| 层 | 当前状态 | 边界 |
| --- | --- | --- |
| cmdb-desktop | 已实现原生窗口和工作区交互 | GPUI 渲染、窗口生命周期、键盘与点击事件 |
| cmdb-engine | 已实现纯 Rust 布局规则并被桌面调用 | 不含 I/O、数据库、HTTP 或伪造业务校验 |
| cmdbd | 未实现；无可执行 crate | 后续业务服务职责，尚无协议、端口、schema 或数据库迁移承诺 |
| cmdb-agent | 未实现；无可执行 crate | 后续采集与本机操作职责，尚无凭证、终端或文件操作实现 |

四层是职责边界，不代表四个服务已经运行。已删除原先恒定返回 `true` 的 IP／机柜“校验”以及只打印文字的服务入口。现有可执行程序不启动子进程、不读写业务数据库、不连接生产系统。后续业务实现必须依据真实存量资料与用户授权，不从本文虚构接口或表结构。

## 可复现 Windows 依赖

- GPUI 来自官方 Zed `v0.218.7`，固定提交 `41bab92dac34777ae4256e5041f7b7236fd16cdd`，不是浮动 main。
- Rust 固定 `1.91.1`，与该提交的 [rust-toolchain.toml](https://github.com/zed-industries/zed/blob/41bab92dac34777ae4256e5041f7b7236fd16cdd/rust-toolchain.toml) 一致。
- CI 使用 Windows Server 2022 runner、MSVC x64、Windows SDK；具体前置依赖见该提交的 [官方 Windows 文档](https://github.com/zed-industries/zed/blob/41bab92dac34777ae4256e5041f7b7236fd16cdd/docs/src/development/windows.md)。应用采用 GPUI 原生 Windows 渲染，不要求浏览器。
- `.cargo/config.toml` 固定静态 CRT 和 `windows_slim_errors`。只启用所需 GPUI Windows manifest 功能。
- CI 编译实际 `cmdb-desktop` binary，上传明确的 `cmdb-desktop.exe`、校验值和锁文件。依赖锁文件随最终交付固定。
- 不承诺 macOS/Linux 发行，也不产出空服务 exe。版本保持 `VERSION`，不打新 tag。

## 设计依据

[Tern 官方主题说明](https://docs.stencil.so/tern/guides/themes.md) 描述暗色背景、较深的 chrome、面板、细边框与强调色。当前使用这些层次组织原生标签与分栏，不宣称复制 Tern 精确主题，也不采用其插件架构。

业务版式约束继续以 [现有原型](prototypes/cmdb/README.md) 为准。资产详情、可编辑机柜、地址池、筛选分页与 CRUD 尚未迁移，不能以空列头作为这些业务已经完成的证据。当前用户验收范围是先有可运行 Windows 原生桌面及真实工作区交互。

## 验收

GitHub Actions 执行共享布局规则测试并编译 Windows exe；本机不执行 cargo build。下载制品后在真实 Windows 桌面启动，观察原生窗口，手动验证新增、选择、关闭、分栏、合并及窗口生命周期，并记录截图或窗口句柄证据。CI 通过与原生运行是两个不同证据，不能用 HTML 截图替代。
