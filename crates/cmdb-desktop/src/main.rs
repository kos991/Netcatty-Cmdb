#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use blenderui::prelude::*;
use cmdb_engine::{Page, Tab, Workspace};

// ==========================================================================
// 业务数据模型
// ==========================================================================

#[derive(Clone, Debug)]
pub struct TerminalAsset {
    pub id: u64,
    pub name: &'static str,
    pub box_sn: &'static str,
    pub code: &'static str,
    pub device_type: &'static str,
    pub brand: &'static str,
    pub model: &'static str,
    pub user: &'static str,
    pub dept: &'static str,
    pub room: &'static str,
    pub ip: &'static str,
    pub net_type: &'static str,
    pub status: &'static str,
    pub cpu: &'static str,
    pub memory: &'static str,
    pub disk: &'static str,
}

pub fn sample_terminals() -> Vec<TerminalAsset> {
    vec![
        TerminalAsset { id: 1, name: "示例云桌面 01", box_sn: "BOX-202610-001", code: "ZCY-DZ-202610-001", device_type: "云桌面", brand: "深信服", model: "aDesk STD-200", user: "张伟", dept: "信息技术部", room: "401", ip: "10.20.30.21", net_type: "专网", status: "使用中", cpu: "4 vCPU", memory: "8192 MB", disk: "128 GB SSD" },
        TerminalAsset { id: 2, name: "示例云桌面 02", box_sn: "BOX-202610-002", code: "ZCY-DZ-202610-002", device_type: "云桌面", brand: "深信服", model: "aDesk STD-200", user: "李娜", dept: "民事审判一庭", room: "302", ip: "10.20.30.22", net_type: "专网", status: "使用中", cpu: "4 vCPU", memory: "8192 MB", disk: "128 GB SSD" },
        TerminalAsset { id: 3, name: "示例台式机 03", box_sn: "SN-DELL-882141", code: "ZCY-DZ-202610-003", device_type: "台式电脑", brand: "戴尔 Dell", model: "OptiPlex 7410", user: "王强", dept: "立案庭", room: "105", ip: "192.168.10.31", net_type: "内网", status: "使用中", cpu: "1 × Intel Core i5-12500", memory: "16384 MB", disk: "512 GB NVMe" },
        TerminalAsset { id: 4, name: "示例笔记本 04", box_sn: "SN-LENOVO-55421", code: "ZCY-DZ-202610-004", device_type: "笔记本", brand: "联想 Lenovo", model: "ThinkPad T14", user: "赵敏", dept: "综合办公室", room: "508", ip: "192.168.10.32", net_type: "内网", status: "使用中", cpu: "1 × AMD Ryzen 7 PRO", memory: "16384 MB", disk: "512 GB SSD" },
        TerminalAsset { id: 5, name: "示例网络打印机 05", box_sn: "SN-PANTUM-99120", code: "ZCY-DZ-202610-005", device_type: "打印机", brand: "奔图 PANTUM", model: "P2500", user: "民事二庭公用", dept: "民事审判二庭", room: "305", ip: "192.168.10.40", net_type: "内网", status: "使用中", cpu: "内置控制器", memory: "256 MB", disk: "无" },
        TerminalAsset { id: 6, name: "示例备用台式机 06", box_sn: "SN-DELL-114299", code: "ZCY-DZ-202610-006", device_type: "台式电脑", brand: "戴尔 Dell", model: "OptiPlex 7090", user: "未分配", dept: "信息保障库房", room: "102", ip: "192.168.10.55", net_type: "内网", status: "闲置", cpu: "1 × Intel Core i5-11500", memory: "8192 MB", disk: "256 GB SSD" },
        TerminalAsset { id: 7, name: "示例故障云盒 07", box_sn: "BOX-202610-007", code: "ZCY-DZ-202610-007", device_type: "云桌面盒子", brand: "华为 Huawei", model: "CloudBox 300", user: "刘洋", dept: "刑事审判庭", room: "204", ip: "10.20.30.27", net_type: "专网", status: "维修中", cpu: "4 核 ARM", memory: "4096 MB", disk: "64 GB eMMC" },
        TerminalAsset { id: 8, name: "示例一体机 08", box_sn: "SN-AIO-338210", code: "ZCY-DZ-202610-008", device_type: "一体机", brand: "联想 Lenovo", model: "开天 A6000", user: "孙悦", dept: "执行局", room: "201", ip: "192.168.10.60", net_type: "内网", status: "使用中", cpu: "1 × 兆芯 KX-6640MA", memory: "8192 MB", disk: "256 GB SSD" },
        TerminalAsset { id: 9, name: "示例便携本 09", box_sn: "SN-THINK-77218", code: "ZCY-DZ-202610-009", device_type: "笔记本", brand: "联想 Lenovo", model: "昭阳 X5", user: "陈杰", dept: "审判管理办公室", room: "502", ip: "192.168.10.71", net_type: "内网", status: "使用中", cpu: "1 × Intel Core i7-1260P", memory: "16384 MB", disk: "1 TB NVMe" },
        TerminalAsset { id: 10, name: "示例外网查询机 10", box_sn: "SN-DELL-992104", code: "ZCY-DZ-202610-010", device_type: "台式电脑", brand: "戴尔 Dell", model: "OptiPlex 3080", user: "诉服大厅公用", dept: "立案庭（诉讼服务中心）", room: "101", ip: "203.0.113.12", net_type: "外网", status: "使用中", cpu: "1 × Intel Core i3-10105", memory: "8192 MB", disk: "256 GB SSD" },
        TerminalAsset { id: 11, name: "示例云桌面 11", box_sn: "BOX-202610-011", code: "ZCY-DZ-202610-011", device_type: "云桌面", brand: "深信服", model: "aDesk STD-200", user: "周华", dept: "行政审判庭", room: "308", ip: "10.20.30.35", net_type: "专网", status: "使用中", cpu: "4 vCPU", memory: "8192 MB", disk: "128 GB SSD" },
        TerminalAsset { id: 12, name: "示例云桌面 12", box_sn: "BOX-202610-012", code: "ZCY-DZ-202610-012", device_type: "云桌面", brand: "深信服", model: "aDesk STD-200", user: "吴芳", dept: "司法警察支队", room: "112", ip: "10.20.30.36", net_type: "专网", status: "使用中", cpu: "4 vCPU", memory: "8192 MB", disk: "128 GB SSD" },
        TerminalAsset { id: 13, name: "示例彩色打印机 13", box_sn: "SN-LENOVO-8812", code: "ZCY-DZ-202610-013", device_type: "打印机", brand: "联想 Lenovo", model: "LJ2205", user: "集中印制室", dept: "综合办公室", room: "103", ip: "192.168.10.88", net_type: "内网", status: "使用中", cpu: "内置控制器", memory: "512 MB", disk: "无" },
        TerminalAsset { id: 14, name: "示例报废台式机 14", box_sn: "SN-DELL-332190", code: "ZCY-DZ-202610-014", device_type: "台式电脑", brand: "联想 Lenovo", model: "启天 M4350", user: "已清退", dept: "设备库房", room: "地下室", ip: "192.168.10.99", net_type: "内网", status: "已注销", cpu: "1 × Intel Core i3-3220", memory: "4096 MB", disk: "500 GB HDD" },
    ]
}

// ==========================================================================
// 样式定义 (现代暗色企业级高密度桌面)
// ==========================================================================

const CSS_STYLESHEET: &str = r#"
* { box-sizing: border-box; }
body { margin: 0; padding: 0; background-color: #121519; color: #f1f5f9; font-family: 'Microsoft YaHei UI', -apple-system, sans-serif; overflow: hidden; height: 100vh; }

.app-root { display: flex; flex-direction: column; width: 100vw; height: 100vh; }

/* 顶栏 */
.topbar { display: flex; align-items: center; height: 42px; background-color: #16191f; border-bottom: 1px solid #282f3a; padding: 0 10px; flex-shrink: 0; gap: 8px; }
.logo-icon { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 16px; color: #3b82f6; font-weight: bold; margin-right: 4px; }
.tabs-container { display: flex; align-items: center; height: 100%; flex: 1; overflow-x: auto; gap: 4px; }
.tab-item { display: flex; align-items: center; height: 32px; padding: 0 12px; background-color: #1c2129; border: 1px solid #282f3a; border-radius: 6px; font-size: 12px; color: #94a3b8; cursor: pointer; gap: 8px; }
.tab-item:hover { background-color: #242c38; color: #f8fafc; }
.tab-item.active { background-color: #202732; border-color: #3b82f6; color: #60a5fa; font-weight: 600; }
.tab-close { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 3px; font-size: 12px; color: #64748b; margin-left: 2px; }
.tab-close:hover { background-color: #ef4444; color: white; }
.tab-add-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; background-color: #1c2129; border: 1px solid #282f3a; color: #94a3b8; cursor: pointer; font-size: 16px; }
.tab-add-btn:hover { background-color: #282f3a; color: #f8fafc; }

/* 主工作区布局 */
.main-layout { display: flex; flex: 1; min-height: 0; }

/* 左侧导航 */
.sidebar { width: 164px; background-color: #16191f; border-right: 1px solid #282f3a; display: flex; flex-direction: column; padding: 10px 8px; flex-shrink: 0; }
.sidebar-title { font-size: 11px; color: #64748b; font-weight: 600; padding: 4px 8px 8px 8px; letter-spacing: 0.5px; }
.nav-item { display: flex; align-items: center; padding: 8px 10px; border-radius: 6px; font-size: 12px; color: #94a3b8; cursor: pointer; margin-bottom: 2px; text-decoration: none; border-left: 3px solid transparent; }
.nav-item:hover { background-color: #1f2530; color: #f1f5f9; }
.nav-item.active { background-color: #1e293b; color: #60a5fa; font-weight: 600; border-left-color: #3b82f6; }
.sidebar-bottom { margin-top: auto; padding-top: 8px; border-top: 1px solid #282f3a; }

/* 页面内容区 */
.content-area { flex: 1; display: flex; min-width: 0; height: 100%; position: relative; }
.pane { flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100%; background-color: #121519; border-right: 1px solid #282f3a; }

/* 工具栏 */
.toolbar { display: flex; align-items: center; justify-content: space-between; height: 50px; padding: 0 16px; background-color: #16191f; border-bottom: 1px solid #282f3a; flex-shrink: 0; gap: 12px; }
.toolbar-left { display: flex; align-items: center; gap: 10px; flex: 1; }
.toolbar-title { font-size: 14px; font-weight: 700; color: #f8fafc; margin-right: 6px; }
.search-input { height: 30px; width: 240px; background-color: #1f2530; border: 1px solid #333d4d; border-radius: 6px; color: #f1f5f9; font-size: 12px; padding: 0 10px; }
.search-input:focus { border-color: #3b82f6; outline: none; }
.type-filter { height: 30px; background-color: #1f2530; border: 1px solid #333d4d; border-radius: 6px; color: #cbd5e1; font-size: 12px; padding: 0 8px; }
.toolbar-right { display: flex; align-items: center; gap: 8px; }
.btn-primary { height: 30px; padding: 0 12px; background-color: #2563eb; color: #ffffff; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px; }
.btn-primary:hover { background-color: #1d4ed8; }
.btn-secondary { height: 30px; padding: 0 10px; background-color: #1f2530; color: #cbd5e1; border: 1px solid #333d4d; border-radius: 6px; font-size: 12px; cursor: pointer; }
.btn-secondary:hover { background-color: #283241; color: #ffffff; }

/* 数据表格 */
.table-container { flex: 1; overflow: auto; background-color: #121519; }
.cmdb-table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; }
.cmdb-table th { background-color: #181d24; color: #94a3b8; font-weight: 600; padding: 10px 12px; border-bottom: 1px solid #282f3a; position: sticky; top: 0; z-index: 10; white-space: nowrap; }
.cmdb-table td { padding: 9px 12px; border-bottom: 1px solid #1f2530; color: #e2e8f0; vertical-align: middle; white-space: nowrap; }
.cmdb-table tr:hover td { background-color: #1e2633; cursor: pointer; }
.cmdb-table tr.selected td { background-color: #1e3550; color: #ffffff; }

/* 单元格微样式 */
.cell-primary { font-weight: 600; color: #f8fafc; }
.cell-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
.net-indicator { display: inline-block; width: 3px; height: 12px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.net-专网 { background-color: #3b82f6; }
.net-内网 { background-color: #10b981; }
.net-外网 { background-color: #f59e0b; }

/* 状态胶囊 */
.badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 500; }
.badge-使用中 { background-color: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
.badge-闲置 { background-color: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3); }
.badge-维修中 { background-color: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
.badge-已注销 { background-color: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }

/* 底部分页条 */
.statusbar { height: 32px; background-color: #16191f; border-top: 1px solid #282f3a; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; font-size: 11px; color: #64748b; flex-shrink: 0; }
.status-left { display: flex; align-items: center; gap: 8px; }
.status-right { display: flex; align-items: center; gap: 12px; }

/* 420px 原生详情抽屉 */
.detail-drawer { width: 420px; background-color: #16191f; border-left: 1px solid #282f3a; display: flex; flex-direction: column; flex-shrink: 0; height: 100%; box-shadow: -6px 0 20px rgba(0, 0, 0, 0.5); z-index: 20; }
.drawer-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid #282f3a; background-color: #191e26; }
.drawer-title-box { display: flex; flex-direction: column; gap: 4px; }
.drawer-title { font-size: 14px; font-weight: 700; color: #f8fafc; }
.drawer-code { font-size: 11px; color: #64748b; }
.drawer-close { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; border-radius: 4px; color: #94a3b8; cursor: pointer; border: 1px solid #2b3340; background-color: #202632; }
.drawer-close:hover { background-color: #ef4444; color: white; border-color: #ef4444; }

.drawer-actions { display: flex; align-items: center; gap: 6px; padding: 8px 16px; background-color: #14171d; border-bottom: 1px solid #282f3a; }
.drawer-btn { height: 26px; padding: 0 8px; font-size: 11px; border-radius: 4px; border: 1px solid #2b3340; background-color: #1f2530; color: #cbd5e1; cursor: pointer; }
.drawer-btn:hover { background-color: #283241; color: white; }

.drawer-body { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
.drawer-section { background-color: #1a1f28; border: 1px solid #282f3a; border-radius: 6px; padding: 10px 12px; }
.section-title { font-size: 11px; font-weight: 700; color: #3b82f6; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px; border-bottom: 1px solid #232a35; padding-bottom: 4px; }
.prop-grid { display: grid; grid-template-columns: 80px 1fr; row-gap: 6px; column-gap: 8px; font-size: 12px; }
.prop-label { color: #64748b; }
.prop-value { color: #e2e8f0; font-weight: 500; word-break: break-all; }
"#;

// ==========================================================================
// 桌面状态管理
// ==========================================================================

struct Desktop {
    workspace: Workspace,
    terminals: Vec<TerminalAsset>,
    search_query: String,
    type_filter: String,
    selected_asset_id: Option<u64>,
}

impl Desktop {
    fn new() -> Self {
        Self {
            workspace: Workspace::default(),
            terminals: sample_terminals(),
            search_query: String::new(),
            type_filter: "全部".to_string(),
            selected_asset_id: Some(1), // 默认选中第 1 项
        }
    }

    fn open(&mut self, page: Page, cx: &mut Context<Self>) {
        self.workspace.open(page);
        cx.notify();
    }

    fn filtered_terminals(&self) -> Vec<&TerminalAsset> {
        self.terminals.iter().filter(|t| {
            let matches_type = self.type_filter == "全部" || t.device_type == self.type_filter;
            let query = self.search_query.trim().to_lowercase();
            let matches_query = query.is_empty()
                || t.name.to_lowercase().contains(&query)
                || t.box_sn.to_lowercase().contains(&query)
                || t.user.to_lowercase().contains(&query)
                || t.ip.to_lowercase().contains(&query);
            matches_type && matches_query
        }).collect()
    }

    fn render_tabs(&self, cx: &mut Context<Self>) -> Div {
        let active = self.workspace.active();
        let tabs = self.workspace.tabs().iter().map(|tab| {
            let is_active = active == Some(*tab);
            let tab_id = tab.id;
            div().class(if is_active { "tab-item active" } else { "tab-item" })
                .child(
                    span().child(tab.page.title()).on_click(cx.listener(move |this, _, _, cx| {
                        this.workspace.activate(tab_id);
                        cx.notify();
                    })),
                )
                .child(
                    span().class("tab-close").child("×").on_click(cx.listener(move |this, _, _, cx| {
                        this.workspace.close(tab_id);
                        cx.notify();
                    })),
                )
        });

        div().class("tabs-container").children(tabs)
    }

    fn render_sidebar(&self, cx: &mut Context<Self>) -> Div {
        let active_page = self.workspace.active().map(|t| t.page);
        let nav_items = Page::ALL.into_iter().map(|page| {
            let is_active = active_page == Some(page);
            div().class(if is_active { "nav-item active" } else { "nav-item" })
                .child(page.title())
                .on_click(cx.listener(move |this, _, _, cx| {
                    if let Some(existing) = this.workspace.tabs().iter().find(|t| t.page == page).copied() {
                        this.workspace.activate(existing.id);
                        cx.notify();
                    } else {
                        this.open(page, cx);
                    }
                }))
        });

        let is_split = self.workspace.secondary().is_some();
        div().class("sidebar")
            .child(div().class("sidebar-title").child("工作区导航"))
            .children(nav_items)
            .child(
                div().class("sidebar-bottom").child(
                    div().class(if is_split { "nav-item active" } else { "nav-item" })
                        .child(if is_split { "▣ 合并分栏" } else { "◫ 左右分栏" })
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.workspace.toggle_split();
                            cx.notify();
                        })),
                ),
            )
    }

    fn render_terminal_page(&self, secondary: bool, cx: &mut Context<Self>) -> Div {
        let list = self.filtered_terminals();
        let count = list.len();
        let selected_id = self.selected_asset_id;

        let rows = list.into_iter().enumerate().map(|(idx, asset)| {
            let is_sel = selected_id == Some(asset.id);
            let asset_id = asset.id;


            tr().class(if is_sel { "selected" } else { "" })
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.selected_asset_id = Some(asset_id);
                    cx.notify();
                }))
                .child(td().style("color: #64748b; font-weight: 500;").child(format!("{}", idx + 1)))
                .child(
                    td().child(
                        div()
                            .child(span().class(format!("net-indicator net-{}", asset.net_type)))
                            .child(span().class("cell-primary").child(asset.name))
                            .child(div().class("cell-sub").child(asset.box_sn)),
                    ),
                )
                .child(td().child(asset.device_type))
                .child(
                    td().child(
                        div().child(asset.brand).child(div().class("cell-sub").child(asset.model)),
                    ),
                )
                .child(
                    td().child(
                        div().child(asset.user).child(div().class("cell-sub").child(asset.dept)),
                    ),
                )
                .child(td().child(asset.room))
                .child(td().style("font-family: monospace; color: #38bdf8;").child(asset.ip))
                .child(td().child(format!("{}网络", asset.net_type)))
                .child(td().child(span().class(format!("badge badge-{}", asset.status)).child(asset.status)))
                .child(
                    td().child(
                        button().class("drawer-btn").child("查看详情").on_click(cx.listener(move |this, _, _, cx| {
                            this.selected_asset_id = Some(asset_id);
                            cx.notify();
                        })),
                    ),
                )
        });

        div().class("pane")
            .child(
                div().class("toolbar")
                    .child(
                        div().class("toolbar-left")
                            .child(span().class("toolbar-title").child("终端资产台账"))
                            .child(
                                input().class("search-input")
                                    .placeholder("搜索设备名称、SN、使用人或IP...")
                                    .value(self.search_query.clone())
                                    .on_input(cx.listener(|this, e: &ChangeEvent, _, cx| {
                                        this.search_query = e.value.clone();
                                        cx.notify();
                                    })),
                            )
                            .child(
                                select().class("type-filter")
                                    .on_change(cx.listener(|this, e: &ChangeEvent, _, cx| {
                                        this.type_filter = e.value.clone();
                                        cx.notify();
                                    }))
                                    .child(option().value("全部").child("全部设备类型"))
                                    .child(option().value("云桌面").child("云桌面"))
                                    .child(option().value("台式电脑").child("台式电脑"))
                                    .child(option().value("笔记本").child("笔记本"))
                                    .child(option().value("打印机").child("打印机"))
                                    .child(option().value("云桌面盒子").child("云桌面盒子"))
                                    .child(option().value("一体机").child("一体机")),
                            ),
                    )
                    .child(
                        div().class("toolbar-right")
                            .child(button().class("btn-secondary").child("按条件导出"))
                            .child(button().class("btn-primary").child("+ 新增终端")),
                    ),
            )
            .child(
                div().class("table-container").child(
                    table().class("cmdb-table")
                        .child(
                            thead().child(
                                tr()
                                    .child(th().style("width: 48px;").child("序号"))
                                    .child(th().style("width: 190px;").child("设备名称 / SN"))
                                    .child(th().style("width: 100px;").child("设备类型"))
                                    .child(th().style("width: 180px;").child("品牌 / 型号"))
                                    .child(th().style("width: 150px;").child("使用人 / 部门"))
                                    .child(th().style("width: 80px;").child("房间号"))
                                    .child(th().style("width: 130px;").child("IP 地址"))
                                    .child(th().style("width: 90px;").child("网络类型"))
                                    .child(th().style("width: 90px;").child("设备状态"))
                                    .child(th().style("width: 80px;").child("操作")),
                            ),
                        )
                        .child(tbody().children(rows)),
                ),
            )
            .child(
                div().class("statusbar")
                    .child(
                        div().class("status-left")
                            .child(format!("共 {} 条终端设备记录", count))
                            .child(if secondary { "（右侧分栏视图）" } else { "（主工作区）" }),
                    )
                    .child(
                        div().class("status-right")
                            .child("10 条 / 页")
                            .child("第 1/2 页")
                            .child(button().class("drawer-btn").child("上一页"))
                            .child(button().class("drawer-btn").child("下一页")),
                    ),
            )
    }

    fn render_detail_drawer(&self, cx: &mut Context<Self>) -> Div {
        let selected = self.selected_asset_id.and_then(|id| self.terminals.iter().find(|t| t.id == id));
        let Some(t) = selected else {
            return div();
        };

        div().class("detail-drawer")
            .child(
                div().class("drawer-header")
                    .child(
                        div().class("drawer-title-box")
                            .child(div().class("drawer-title").child(t.name))
                            .child(div().class("drawer-code").child(format!("资产编码: {}", t.code))),
                    )
                    .child(
                        span().class("drawer-close").child("×").on_click(cx.listener(|this, _, _, cx| {
                            this.selected_asset_id = None;
                            cx.notify();
                        })),
                    ),
            )
            .child(
                div().class("drawer-actions")
                    .child(button().class("drawer-btn").child("编辑资产"))
                    .child(button().class("drawer-btn").child("调换使用人"))
                    .child(button().class("drawer-btn").child("维修换件"))
                    .child(button().class("drawer-btn").child("克隆设备"))
                    .child(button().class("drawer-btn").style("color: #f87171;").child("注销归档")),
            )
            .child(
                div().class("drawer-body")
                    .child(
                        div().class("drawer-section")
                            .child(div().class("section-title").child("身份与状态"))
                            .child(
                                div().class("prop-grid")
                                    .child(span().class("prop-label").child("设备类型"))
                                    .child(span().class("prop-value").child(t.device_type))
                                    .child(span().class("prop-label").child("设备状态"))
                                    .child(span().class("prop-value").child(t.status))
                                    .child(span().class("prop-label").child("主机 SN"))
                                    .child(span().class("prop-value").style("font-family: monospace;").child(t.box_sn))
                                    .child(span().class("prop-label").child("品牌/厂商"))
                                    .child(span().class("prop-value").child(t.brand))
                                    .child(span().class("prop-label").child("设备型号"))
                                    .child(span().class("prop-value").child(t.model)),
                            ),
                    )
                    .child(
                        div().class("drawer-section")
                            .child(div().class("section-title").child("使用与归属位置"))
                            .child(
                                div().class("prop-grid")
                                    .child(span().class("prop-label").child("使用人员"))
                                    .child(span().class("prop-value").child(t.user))
                                    .child(span().class("prop-label").child("归属部门"))
                                    .child(span().class("prop-value").child(t.dept))
                                    .child(span().class("prop-label").child("房间号"))
                                    .child(span().class("prop-value").child(format!("{} 室", t.room))),
                            ),
                    )
                    .child(
                        div().class("drawer-section")
                            .child(div().class("section-title").child("网络系统"))
                            .child(
                                div().class("prop-grid")
                                    .child(span().class("prop-label").child("IP 地址"))
                                    .child(span().class("prop-value").style("font-family: monospace; color: #38bdf8;").child(t.ip))
                                    .child(span().class("prop-label").child("网络类型"))
                                    .child(span().class("prop-value").child(format!("{}网络", t.net_type)))
                                    .child(span().class("prop-label").child("操作系统"))
                                    .child(span().class("prop-value").child("统信 UOS 20 专业版")),
                            ),
                    )
                    .child(
                        div().class("drawer-section")
                            .child(div().class("section-title").child("硬件配置详情"))
                            .child(
                                div().class("prop-grid")
                                    .child(span().class("prop-label").child("CPU 配置"))
                                    .child(span().class("prop-value").child(t.cpu))
                                    .child(span().class("prop-label").child("系统内存"))
                                    .child(span().class("prop-value").child(t.memory))
                                    .child(span().class("prop-label").child("主存储"))
                                    .child(span().class("prop-value").child(t.disk)),
                            ),
                    ),
            )
    }

    fn render_pane(&self, tab: Tab, secondary: bool, cx: &mut Context<Self>) -> Div {
        match tab.page {
            Page::Terminal => self.render_terminal_page(secondary, cx),
            _ => {
                let title = tab.page.title();
                let columns = tab.page.columns();
                div().class("pane")
                    .child(
                        div().class("toolbar")
                            .child(span().class("toolbar-title").child(format!("{} 模块", title)))
                            .child(button().class("btn-primary").child(format!("+ 新增{}", title))),
                    )
                    .child(
                        div().class("table-container").child(
                            table().class("cmdb-table")
                                .child(
                                    thead().child(
                                        tr().children(columns.iter().map(|c| th().child(*c))),
                                    ),
                                )
                                .child(
                                    tbody().child(
                                        tr().child(
                                            td().attr("colspan", columns.len().to_string())
                                                .style("text-align: center; padding: 60px 20px; color: #64748b;")
                                                .child(format!("{} 原生视图已加载 · 点击左侧切换其他页面", title)),
                                        ),
                                    ),
                                ),
                        ),
                    )
            }
        }
    }
}

impl Render for Desktop {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let is_terminal_active = self.workspace.active().map(|t| t.page) == Some(Page::Terminal);
        let show_drawer = is_terminal_active && self.selected_asset_id.is_some() && self.workspace.secondary().is_none();

        let mut panes = div().class("content-area");
        if let Some(tab) = self.workspace.active() {
            panes = panes.child(self.render_pane(tab, false, cx));
            if let Some(sec) = self.workspace.secondary() {
                panes = panes.child(self.render_pane(sec, true, cx));
            }
        }

        if show_drawer {
            panes = panes.child(self.render_detail_drawer(cx));
        }

        html().styled()
            .child(head().child(style().child(CSS_STYLESHEET)))
            .child(
                body().child(
                    div().class("app-root")
                        .child(
                            div().class("topbar")
                                .child(div().class("logo-icon").child("◈"))
                                .child(self.render_tabs(cx))
                                .child(
                                    div().class("tab-add-btn").child("+").on_click(cx.listener(|this, _, _, cx| {
                                        this.open(Page::Infrastructure, cx);
                                    })),
                                ),
                        )
                        .child(
                            div().class("main-layout")
                                .child(self.render_sidebar(cx))
                                .child(panes),
                        ),
                ),
            )
    }
}

fn main() {
    Application::new().gpu(true).run(|cx: &mut App| {
        let bounds = Bounds { origin: point(px(60.0), px(40.0)), size: size(px(1440.0), px(860.0)) };
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                titlebar: Some(TitlebarOptions { title: Some("Cmdb 资产与服务器全景管理".into()) }),
                window_min_size: Some(size(px(960.0), px(600.0))),
                gpu: Some(true),
                ..Default::default()
            },
            |_, cx| cx.new(|_| Desktop::new()),
        ).expect("Failed to create native BUI window");
    });
}
