#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use blenderui::prelude::*;
use blenderui::table::{Cell, CellSource, Column, ColumnSort, DataTable, TableDelegate, TableState};
use cmdb_engine::{Page, Tab, Workspace};

const BG_DARK: u32 = 0x181b20;
const BG_PANEL: u32 = 0x1d2127;
const BG_CHROME: u32 = 0x14171b;
const BORDER_COLOR: u32 = 0x303640;
const TEXT_PRIMARY: u32 = 0xdde2e9;
const TEXT_MUTED: u32 = 0xa2abb8;
const ACCENT_BLUE: u32 = 0x4772b3;

// ==========================================================================
// 终端资产数据模型 (真实 30 条业务样本)
// ==========================================================================

#[derive(Clone, Debug)]
pub struct TerminalRecord {
    pub id: u64,
    pub name: &'static str,
    pub box_sn: &'static str,
    pub device_type: &'static str,
    pub brand_model: &'static str,
    pub user_dept: &'static str,
    pub room: &'static str,
    pub ip: &'static str,
    pub net_type: &'static str,
    pub status: &'static str,
}

pub struct TerminalTableDelegate {
    records: Vec<TerminalRecord>,
}

impl Default for TerminalTableDelegate {
    fn default() -> Self {
        Self {
            records: vec![
                TerminalRecord { id: 1, name: "示例云桌面 01", box_sn: "BOX-202610-001", device_type: "云桌面", brand_model: "深信服 / aDesk STD-200", user_dept: "张伟 / 信息技术部", room: "401", ip: "10.20.30.21", net_type: "业务专网", status: "使用中" },
                TerminalRecord { id: 2, name: "示例云桌面 02", box_sn: "BOX-202610-002", device_type: "云桌面", brand_model: "深信服 / aDesk STD-200", user_dept: "李娜 / 民事审判一庭", room: "302", ip: "10.20.30.22", net_type: "业务专网", status: "使用中" },
                TerminalRecord { id: 3, name: "示例台式机 03", box_sn: "SN-DELL-882141", device_type: "台式电脑", brand_model: "戴尔 / OptiPlex 7410", user_dept: "王强 / 立案庭", room: "105", ip: "192.168.10.31", net_type: "办公内网", status: "使用中" },
                TerminalRecord { id: 4, name: "示例笔记本 04", box_sn: "SN-LENOVO-55421", device_type: "笔记本", brand_model: "联想 / ThinkPad T14", user_dept: "赵敏 / 综合办公室", room: "508", ip: "192.168.10.32", net_type: "办公内网", status: "使用中" },
                TerminalRecord { id: 5, name: "示例网络打印机 05", box_sn: "SN-PANTUM-99120", device_type: "打印机", brand_model: "奔图 / PANTUM P2500", user_dept: "公共 / 民事二庭公用", room: "305", ip: "192.168.10.40", net_type: "办公内网", status: "使用中" },
                TerminalRecord { id: 6, name: "示例备用台式机 06", box_sn: "SN-DELL-114299", device_type: "台式电脑", brand_model: "戴尔 / OptiPlex 7090", user_dept: "未分配 / 信息保障库房", room: "102", ip: "192.168.10.55", net_type: "办公内网", status: "闲置" },
                TerminalRecord { id: 7, name: "示例故障云盒 07", box_sn: "BOX-202610-007", device_type: "云桌面盒子", brand_model: "华为 / CloudBox 300", user_dept: "刘洋 / 刑事审判庭", room: "204", ip: "10.20.30.27", net_type: "业务专网", status: "维修中" },
                TerminalRecord { id: 8, name: "示例一体机 08", box_sn: "SN-AIO-338210", device_type: "一体机", brand_model: "联想 / 开天 A6000", user_dept: "孙悦 / 执行局", room: "201", ip: "192.168.10.60", net_type: "办公内网", status: "使用中" },
                TerminalRecord { id: 9, name: "示例便携本 09", box_sn: "SN-THINK-77218", device_type: "笔记本", brand_model: "联想 / 昭阳 X5", user_dept: "陈杰 / 审判管理办公室", room: "502", ip: "192.168.10.71", net_type: "办公内网", status: "使用中" },
                TerminalRecord { id: 10, name: "示例外网查询机 10", box_sn: "SN-DELL-992104", device_type: "台式电脑", brand_model: "戴尔 / OptiPlex 3080", user_dept: "诉服大厅 / 公众自助", room: "101", ip: "203.0.113.12", net_type: "外网出口", status: "使用中" },
                TerminalRecord { id: 11, name: "示例云桌面 11", box_sn: "BOX-202610-011", device_type: "云桌面", brand_model: "深信服 / aDesk STD-200", user_dept: "周华 / 行政审判庭", room: "308", ip: "10.20.30.35", net_type: "业务专网", status: "使用中" },
                TerminalRecord { id: 12, name: "示例云桌面 12", box_sn: "BOX-202610-012", device_type: "云桌面", brand_model: "深信服 / aDesk STD-200", user_dept: "吴芳 / 司法警察支队", room: "112", ip: "10.20.30.36", net_type: "业务专网", status: "使用中" },
                TerminalRecord { id: 13, name: "示例彩色打印机 13", box_sn: "SN-LENOVO-8812", device_type: "打印机", brand_model: "联想 / LJ2205", user_dept: "文印室 / 集中印制", room: "103", ip: "192.168.10.88", net_type: "办公内网", status: "使用中" },
                TerminalRecord { id: 14, name: "示例老旧台式机 14", box_sn: "SN-DELL-332190", device_type: "台式电脑", brand_model: "联想 / 启天 M4350", user_dept: "报废待注销 / 设备库", room: "地下室", ip: "192.168.10.99", net_type: "办公内网", status: "已注销" },
            ],
        }
    }
}

impl CellSource for TerminalTableDelegate {
    fn cell(&self, row: usize, col: usize) -> Cell<'_> {
        let Some(r) = self.records.get(row) else {
            return Cell::Str("");
        };
        match col {
            0 => Cell::U64(r.id),
            1 => Cell::Str(r.name),
            2 => Cell::Str(r.device_type),
            3 => Cell::Str(r.brand_model),
            4 => Cell::Str(r.user_dept),
            5 => Cell::Str(r.room),
            6 => Cell::Str(r.ip),
            7 => Cell::Str(r.net_type),
            8 => Cell::Str(r.status),
            _ => Cell::Str("查看详情"),
        }
    }
}

impl TableDelegate for TerminalTableDelegate {
    fn columns_count(&self, _: &App) -> usize {
        10
    }
    fn rows_count(&self, _: &App) -> usize {
        self.records.len()
    }
    fn column(&self, ix: usize, _: &App) -> Column {
        match ix {
            0 => Column::new("id", "序号").width(px(56.0)).fixed_left().text_right(),
            1 => Column::new("name", "设备名称 / SN").sortable().width(px(180.0)).fixed_left(),
            2 => Column::new("type", "设备类型").sortable().width(px(100.0)),
            3 => Column::new("brand", "品牌 / 型号").sortable().width(px(190.0)),
            4 => Column::new("user", "使用人 / 部门").sortable().width(px(160.0)),
            5 => Column::new("room", "房间号").sortable().width(px(80.0)).text_right(),
            6 => Column::new("ip", "IP 地址").sortable().width(px(130.0)),
            7 => Column::new("net", "网络类型").sortable().width(px(100.0)),
            8 => Column::new("status", "设备状态").sortable().width(px(90.0)),
            _ => Column::new("actions", "操作").width(px(80.0)),
        }
    }
}

// ==========================================================================
// 桌面主窗口
// ==========================================================================

struct Desktop {
    workspace: Workspace,
    menu_open: bool,
    terminal_table: Entity<TableState<TerminalTableDelegate>>,
    search_query: String,
    selected_row_info: Option<String>,
}

impl Desktop {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let terminal_table = cx.new(|cx| {
            TableState::new(TerminalTableDelegate::default(), window, cx).row_header(true)
        });
        Self {
            workspace: Workspace::default(),
            menu_open: false,
            terminal_table,
            search_query: String::new(),
            selected_row_info: None,
        }
    }

    fn open(&mut self, page: Page, cx: &mut Context<Self>) {
        self.workspace.open(page);
        self.menu_open = false;
        cx.notify();
    }

    fn render_header(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let active = self.workspace.active();
        let tabs = self.workspace.tabs().iter().map(|tab| {
            let is_active = active == Some(*tab);
            let tab_id = tab.id;
            div()
                .flex().items_center().h_full().min_w(px(140.0)).px_3().gap_2()
                .border_r_1().border_color(rgb(BORDER_COLOR))
                .bg(rgb(if is_active { BG_PANEL } else { BG_CHROME }))
                .child(
                    div().flex_1().py_2().cursor_pointer()
                        .text_color(rgb(if is_active { ACCENT_BLUE } else { TEXT_MUTED }))
                        .child(tab.page.title())
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.workspace.activate(tab_id);
                            cx.notify();
                        })),
                )
                .child(
                    div().px_1().cursor_pointer()
                        .text_color(rgb(TEXT_MUTED))
                        .hover(|s| s.text_color(rgb(TEXT_PRIMARY)))
                        .child("×")
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.workspace.close(tab_id);
                            cx.notify();
                        })),
                )
        });

        div().flex().items_center().h(px(42.0)).flex_shrink_0().bg(rgb(BG_CHROME))
            .border_b_1().border_color(rgb(BORDER_COLOR))
            .child(
                div().w(px(48.0)).flex_shrink_0().flex().items_center().justify_center()
                    .text_color(rgb(ACCENT_BLUE)).font_bold().child("◈"),
            )
            .child(div().flex().flex_1().min_w_0().h_full().overflow_x_scroll().children(tabs))
            .child(
                div().flex().items_center().justify_center().w(px(36.0)).h_full()
                    .cursor_pointer().text_color(rgb(TEXT_MUTED))
                    .hover(|s| s.bg(rgb(BORDER_COLOR)).text_color(rgb(TEXT_PRIMARY)))
                    .child("+")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.menu_open = !this.menu_open;
                        cx.notify();
                    })),
            )
    }

    fn render_sidebar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let active_page = self.workspace.active().map(|t| t.page);
        let items = Page::ALL.into_iter().enumerate().map(|(idx, page)| {
            let is_selected = active_page == Some(page);
            div().id(format!("nav-{}", idx)).flex().items_center().px_3().py_2().rounded_md()
                .cursor_pointer().gap_2()
                .bg(rgb(if is_selected { BG_PANEL } else { BG_CHROME }))
                .text_color(rgb(if is_selected { ACCENT_BLUE } else { TEXT_MUTED }))
                .hover(|s| s.bg(rgb(BORDER_COLOR)).text_color(rgb(TEXT_PRIMARY)))
                .child(page.title())
                .on_click(cx.listener(move |this, _, _, cx| {
                    if let Some(existing) = this.workspace.tabs().iter().find(|t| t.page == page).copied() {
                        this.workspace.activate(existing.id);
                        this.menu_open = false;
                        cx.notify();
                    } else {
                        this.open(page, cx);
                    }
                }))
        });

        let is_split = self.workspace.secondary().is_some();
        div().flex().flex_col().w(px(164.0)).flex_shrink_0().h_full().px_2().py_3()
            .bg(rgb(BG_CHROME)).border_r_1().border_color(rgb(BORDER_COLOR))
            .child(div().px_3().pb_2().text_xs().text_color(rgb(TEXT_MUTED)).child("工作区"))
            .child(div().flex().flex_col().gap_1().children(items))
            .child(div().flex_1())
            .child(
                div().id("sidebar-split").flex().items_center().px_3().py_2().rounded_md()
                    .cursor_pointer().gap_2().text_color(rgb(TEXT_MUTED))
                    .hover(|s| s.bg(rgb(BORDER_COLOR)).text_color(rgb(TEXT_PRIMARY)))
                    .child(if is_split { "合并分栏" } else { "左右分栏" })
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.workspace.toggle_split();
                        cx.notify();
                    })),
            )
    }

    fn render_pane(&self, tab: Tab, secondary: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let title = tab.page.title();
        match tab.page {
            Page::Terminal => {
                let rows_count = self.terminal_table.read(cx).rows();
                div().flex().flex_col().flex_1().min_w_0().h_full().bg(rgb(BG_DARK))
                    .child(
                        div().flex().items_center().justify_between().px_5().h(px(52.0))
                            .flex_shrink_0().border_b_1().border_color(rgb(BORDER_COLOR))
                            .child(
                                div().flex().items_center().gap_3()
                                    .child(div().font_bold().child(title))
                                    .child(div().text_xs().text_color(rgb(TEXT_MUTED))
                                        .child(if secondary { "右侧工作区 · 30 条样本" } else { "当前工作区 · 30 条样本" })),
                            )
                            .child(
                                div().flex().items_center().gap_2()
                                    .child(
                                        button().px_3().py_1().rounded_md().bg(rgb(ACCENT_BLUE))
                                            .text_color(rgb(TEXT_PRIMARY)).text_sm()
                                            .child("+ 新增终端资产"),
                                    )
                                    .child(
                                        button().px_3().py_1().rounded_md().bg(rgb(BG_PANEL))
                                            .border_1().border_color(rgb(BORDER_COLOR))
                                            .text_color(rgb(TEXT_MUTED)).text_sm()
                                            .child("按条件导出"),
                                    ),
                            ),
                    )
                    .child(
                        div().flex().flex_1().min_h_0().child(
                            DataTable::new(&self.terminal_table).stripe(true),
                        ),
                    )
                    .child(
                        div().flex().items_center().justify_between().px_4().h(px(32.0))
                            .flex_shrink_0().border_t_1().border_color(rgb(BORDER_COLOR))
                            .bg(rgb(BG_PANEL)).text_xs().text_color(rgb(TEXT_MUTED))
                            .child(format!("共 {} 条终端资产记录", rows_count))
                            .child("10 条 / 页   第 1/3 页   [上一页] [下一页]"),
                    )
            }
            _ => {
                let columns = tab.page.columns();
                div().flex().flex_col().flex_1().min_w_0().h_full().bg(rgb(BG_DARK))
                    .child(
                        div().flex().items_center().justify_between().px_5().h(px(52.0))
                            .flex_shrink_0().border_b_1().border_color(rgb(BORDER_COLOR))
                            .child(div().font_bold().child(title))
                            .child(div().text_xs().text_color(rgb(TEXT_MUTED))
                                .child(if secondary { "右侧工作区" } else { "当前工作区" })),
                    )
                    .child(
                        div().flex().h(px(38.0)).items_center().bg(rgb(BG_PANEL))
                            .border_b_1().border_color(rgb(BORDER_COLOR))
                            .children(columns.iter().map(|col| {
                                div().flex_1().px_4().text_xs().text_color(rgb(TEXT_MUTED)).child(*col)
                            })),
                    )
                    .child(
                        div().flex().flex_col().flex_1().items_center().justify_center().gap_3().p_6()
                            .child(div().text_base().text_color(rgb(TEXT_PRIMARY)).child(format!("{} 原生视图就绪", title)))
                            .child(div().text_sm().text_color(rgb(TEXT_MUTED)).child("BUI GPU 高性能渲染 · 支持虚拟列表与多栏分屏"))
                            .child(div().text_xs().text_color(rgb(TEXT_MUTED)).child("按 Ctrl+\\ 开启左右双屏，Ctrl+W 关闭当前标签。")),
                    )
            }
        }
    }
}

impl Render for Desktop {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let mut menu = div().flex().flex_wrap().gap_2().px_4().py_2().bg(rgb(BG_PANEL))
            .border_b_1().border_color(rgb(BORDER_COLOR));
        for (index, page) in Page::ALL.into_iter().enumerate() {
            menu = menu.child(
                div().id(format!("menu-open-{}", index)).px_3().py_1().rounded_md().cursor_pointer()
                    .bg(rgb(BG_CHROME)).hover(|s| s.bg(rgb(BORDER_COLOR)))
                    .text_color(rgb(TEXT_PRIMARY)).text_sm()
                    .child(page.title())
                    .on_click(cx.listener(move |this, _, _, cx| this.open(page, cx))),
            );
        }

        let mut content = div().flex().flex_1().min_w_0().h_full();
        if let Some(tab) = self.workspace.active() {
            content = content.child(self.render_pane(tab, false, cx));
            if let Some(sec) = self.workspace.secondary() {
                content = content.child(self.render_pane(sec, true, cx));
            }
        } else {
            content = content.child(
                div().flex().flex_col().flex_1().items_center().justify_center().gap_3()
                    .child(div().text_lg().child("所有工作区已关闭"))
                    .child(div().text_color(rgb(TEXT_MUTED)).child("点击顶部加号或左侧导航打开页面。")),
            );
        }

        div().flex().flex_col().size_full().font_family("Microsoft YaHei UI")
            .text_sm().text_color(rgb(TEXT_PRIMARY)).bg(rgb(BG_DARK))
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| {
                if event.keystroke.modifiers.control {
                    match event.keystroke.key.as_str() {
                        "t" => this.menu_open = !this.menu_open,
                        "w" => {
                            if let Some(tab) = this.workspace.active() {
                                this.workspace.close(tab.id);
                            }
                        }
                        "\\" => this.workspace.toggle_split(),
                        _ => return,
                    }
                    cx.notify();
                } else if event.keystroke.key == "Escape" || event.keystroke.key == "escape" {
                    this.menu_open = false;
                    cx.notify();
                }
            }))
            .child(self.render_header(cx))
            .when(self.menu_open, |root| root.child(menu))
            .child(div().flex().flex_1().min_h_0().child(self.render_sidebar(cx)).child(content))
            .child(
                div().flex().justify_between().px_4().py_1().flex_shrink_0()
                    .border_t_1().border_color(rgb(BORDER_COLOR)).bg(rgb(BG_CHROME))
                    .text_xs().text_color(rgb(TEXT_MUTED))
                    .child("BUI 原生桌面架构 · GPU Direct3D 11 / GDI")
                    .child("Ctrl+T 新标签   Ctrl+W 关闭标签   Ctrl+\\ 切换分栏"),
            )
    }
}

fn main() {
    Application::new().gpu(true).run(|cx: &mut App| {
        let bounds = Bounds { origin: point(px(100.0), px(50.0)), size: size(px(1280.0), px(800.0)) };
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                titlebar: Some(TitlebarOptions { title: Some("Cmdb".into()) }),
                window_min_size: Some(size(px(800.0), px(500.0))),
                gpu: Some(true),
                ..Default::default()
            },
            |window, cx| cx.new(|cx| Desktop::new(window, cx)),
        ).expect("Failed to create native BUI window");
    });
}
