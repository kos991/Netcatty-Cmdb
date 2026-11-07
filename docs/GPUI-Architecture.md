# Cmdb 原生桌面架构 (BUI / GPUI)

当前版本：`1.0.202610221542`，来自 `VERSION`；本次为开发构建，不创建新发布。

## 当前实现

Rust workspace 包含真正可执行的 `cmdb-desktop` 和实际被调用的 `cmdb-engine`。依据用户最新决定，原生桌面采用 [BUI (Blender UI)](https://github.com/ppmpreetham/BUI)（`blenderui = "0.4.1"`），直接使用 Blender 解耦的 GPU 加速原生 C 渲染核（Windows Direct3D 11 / GDI）和内置的 `shadcn::DataTable` 虚拟数据表格。入口是 `crates/cmdb-desktop/src/main.rs`。

共享库 `cmdb-engine` 继续负责标签身份、选择、关闭后的选择恢复、双栏切换与两栏交换规则，保持纯 Rust 独立无 UI 状态设计。桌面通过 BUI `Application::new().gpu(true)` 创建原生 Windows 窗口，响应鼠标、键盘及分栏操作。

界面为 Blender 工业质感高密度暗色工作区、多标签和左右分栏。终端资产页面已接入原生 `DataTable`，支持千级虚拟化滚动、多列固定、排序列与条纹样式，彻底替代 HTML iframe 网页外壳。
## 四层职责与实施边界

| 层 | 当前状态 | 边界 |
| --- | --- | --- |
| cmdb-desktop | 已实现原生窗口和工作区交互 | GPUI 渲染、窗口生命周期、键盘与点击事件 |
| cmdb-engine | 已实现纯 Rust 布局规则并被桌面调用 | 不含 I/O、数据库、HTTP 或伪造业务校验 |
| cmdbd | 未实现；无可执行 crate | 后续业务服务职责，尚无协议、端口、schema 或数据库迁移承诺 |
| cmdb-agent | 未实现；无可执行 crate | 后续采集与本机操作职责，尚无凭证、终端或文件操作实现 |

四层是职责边界，不代表四个服务已经运行。已删除原先恒定返回 `true` 的 IP／机柜“校验”以及只打印文字的服务入口。现有可执行程序不启动子进程、不读写业务数据库、不连接生产系统。后续业务实现必须依据真实存量资料与用户授权，不从本文虚构接口或表结构。

## 可复现 Windows 依赖

- BUI 采用官方发布版本 `blenderui = "0.4.1"`。
- Rust 固定 `1.91.1`，MSVC x64。
- `blenderui-sys` 通过 CMake 编译 BUI C kit 核心静态库（`bui_kit`、`bui_gpu`、`bui_core`），在 Windows 下走 Direct3D 11 GPU 渲染并链接 `user32` 与 `gdi32`。
- CI 使用 Windows Server 2022 runner、MSVC x64、CMake 及 Windows SDK。
- CI 编译实际 `cmdb-desktop` binary，上传明确的 `cmdb-desktop.exe`、校验值和锁文件。
- 许可证：`GPL-3.0-or-later`（源自 BUI / Blender 核心）。
- 版本保持 `VERSION`，不打新 tag。
## 设计依据

[Tern 官方主题说明](https://docs.stencil.so/tern/guides/themes.md) 描述暗色背景、较深的 chrome、面板、细边框与强调色。当前使用这些层次组织原生标签与分栏，不宣称复制 Tern 精确主题，也不采用其插件架构。

业务版式约束继续以 [现有原型](prototypes/cmdb/README.md) 为准。资产详情、可编辑机柜、地址池、筛选分页与 CRUD 尚未迁移，不能以空列头作为这些业务已经完成的证据。当前用户验收范围是先有可运行 Windows 原生桌面及真实工作区交互。

## 验收

GitHub Actions 执行共享布局规则测试并编译 Windows exe；本机不执行 cargo build。下载制品后在真实 Windows 桌面启动，观察原生窗口，手动验证新增、选择、关闭、分栏、合并及窗口生命周期，并记录截图或窗口句柄证据。CI 通过与原生运行是两个不同证据，不能用 HTML 截图替代。
