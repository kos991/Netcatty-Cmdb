#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use cmdb_engine::{Page, Tab, Workspace};
use gpui::{
    div, prelude::*, px, rgb, size, App, Application, Bounds, Context,
    FocusHandle, TitlebarOptions, Window, WindowBounds, WindowOptions,
};

const BACKGROUND: u32 = 0x181b20;
const CHROME: u32 = 0x14171b;
const PANEL: u32 = 0x1d2127;
const BORDER: u32 = 0x303640;
const TEXT: u32 = 0xdde2e9;
const MUTED: u32 = 0xa2abb8;
const ACCENT: u32 = 0x89b4fa;

struct Desktop {
    workspace: Workspace,
    menu_open: bool,
    focus: FocusHandle,
}

impl Desktop {
    fn open(&mut self, page: Page, cx: &mut Context<Self>) {
        self.workspace.open(page);
        self.menu_open = false;
        cx.notify();
    }

    fn tab(&self, tab: Tab, cx: &mut Context<Self>) -> impl IntoElement {
        let active = self.workspace.active() == Some(tab);
        div()
            .flex().items_center().h_full().min_w(px(140.0)).px_2().gap_3()
            .border_r_1().border_color(rgb(BORDER))
            .bg(rgb(if active { PANEL } else { CHROME }))
            .child(
                div().id(("tab", tab.id)).flex_1().py_3().cursor_pointer()
                    .text_color(rgb(if active { ACCENT } else { MUTED }))
                    .child(tab.page.title())
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.workspace.activate(tab.id);
                        cx.notify();
                    })),
            )
            .child(
                div().id(("close-tab", tab.id)).px_1().cursor_pointer()
                    .text_color(rgb(MUTED)).hover(|style| style.text_color(rgb(TEXT)))
                    .child("×")
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.workspace.close(tab.id);
                        cx.notify();
                    })),
            )
    }

    fn pane(&self, tab: Tab, secondary: bool) -> impl IntoElement {
        div().flex().flex_col().flex_1().min_w_0().h_full().overflow_hidden()
            .border_l_1().border_color(rgb(BORDER)).bg(rgb(BACKGROUND))
            .child(
                div().flex().items_center().justify_between().px_5().h(px(58.0))
                    .flex_shrink_0().border_b_1().border_color(rgb(BORDER))
                    .child(div().text_base().child(tab.page.title()))
                    .child(div().text_xs().text_color(rgb(MUTED))
                        .child(if secondary { "右侧工作区" } else { "当前工作区" })),
            )
            .child(
                div().id(("columns", tab.id)).overflow_x_scroll().flex_shrink_0()
                    .child(div().flex().min_w(px(680.0)).h(px(40.0)).items_center()
                        .bg(rgb(PANEL)).border_b_1().border_color(rgb(BORDER))
                        .children(tab.page.columns().iter().map(|column| {
                            div().flex_1().px_3().text_xs().text_color(rgb(MUTED)).child(*column)
                        }))),
            )
            .child(
                div().flex().flex_col().flex_1().items_center().justify_center().gap_3().p_6()
                    .child(div().text_base().child("业务服务尚未接入"))
                    .child(div().text_sm().text_color(rgb(MUTED))
                        .child("当前可使用多标签和左右分栏。"))
                    .child(div().text_xs().text_color(rgb(MUTED))
                        .child("未加载资产数据，也不会读写已有数据库。")),
            )
    }
}

impl Render for Desktop {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let mut tabs = div().id("tabs").flex().flex_1().min_w_0().h_full().overflow_x_scroll();
        for tab in self.workspace.tabs() {
            tabs = tabs.child(self.tab(*tab, cx));
        }
        let mut menu = div().flex().flex_wrap().gap_2().px_4().py_3().bg(rgb(PANEL))
            .border_b_1().border_color(rgb(BORDER));
        for (index, page) in Page::ALL.into_iter().enumerate() {
            menu = menu.child(
                div().id(("new-page", index)).px_3().py_2().rounded_md()
                    .cursor_pointer().bg(rgb(BACKGROUND))
                    .hover(|style| style.bg(rgb(BORDER))).child(page.title())
                    .on_click(cx.listener(move |this, _, _, cx| this.open(page, cx))),
            );
        }
        let mut navigation = div().flex().flex_col().w(px(164.0)).flex_shrink_0()
            .h_full().px_2().py_4().gap_1().bg(rgb(CHROME))
            .child(div().px_3().pb_3().text_xs().text_color(rgb(MUTED)).child("工作区"));
        for (index, page) in Page::ALL.into_iter().enumerate() {
            let selected = self.workspace.active().is_some_and(|tab| tab.page == page);
            navigation = navigation.child(
                div().id(("navigation", index)).px_3().py_2().rounded_md().cursor_pointer()
                    .bg(rgb(if selected { PANEL } else { CHROME }))
                    .text_color(rgb(if selected { ACCENT } else { MUTED }))
                    .hover(|style| style.bg(rgb(BORDER))).child(page.title())
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let existing = this.workspace.tabs().iter().find(|tab| tab.page == page).copied();
                        if let Some(tab) = existing {
                            this.workspace.activate(tab.id);
                            this.menu_open = false;
                            cx.notify();
                        } else {
                            this.open(page, cx);
                        }
                    })),
            );
        }
        let mut content = div().flex().flex_1().min_w_0().h_full();
        if let Some(tab) = self.workspace.active() {
            content = content.child(self.pane(tab, false));
            if let Some(tab) = self.workspace.secondary() {
                content = content.child(self.pane(tab, true));
            }
        } else {
            content = content.child(
                div().flex().flex_col().flex_1().items_center().justify_center().gap_3()
                    .child("所有标签已关闭")
                    .child(div().text_color(rgb(MUTED)).child("点击 + 或左侧导航打开工作区。")),
            );
        }
        div().track_focus(&self.focus).flex().flex_col().size_full()
            .font_family("Microsoft YaHei UI").text_sm().text_color(rgb(TEXT)).bg(rgb(BACKGROUND))
            .on_key_down(cx.listener(|this, event: &gpui::KeyDownEvent, _, cx| {
                if event.keystroke.modifiers.control {
                    match event.keystroke.key.as_str() {
                        "t" => this.menu_open = !this.menu_open,
                        "w" => {
                            if let Some(tab) = this.workspace.active() { this.workspace.close(tab.id); }
                        }
                        "\\" => this.workspace.toggle_split(),
                        _ => return,
                    }
                    cx.notify();
                } else if event.keystroke.key == "escape" {
                    this.menu_open = false;
                    cx.notify();
                }
            }))
            .child(
                div().flex().items_center().h(px(44.0)).flex_shrink_0().bg(rgb(CHROME))
                    .border_b_1().border_color(rgb(BORDER))
                    .child(div().w(px(48.0)).flex_shrink_0().text_center().text_lg()
                        .text_color(rgb(ACCENT)).child("◈"))
                    .child(tabs)
                    .child(div().id("add-tab").px_4().py_2().cursor_pointer().text_lg()
                        .hover(|style| style.bg(rgb(BORDER))).child("+")
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.menu_open = !this.menu_open;
                            cx.notify();
                        })))
                    .child(div().id("split").px_4().py_2().cursor_pointer()
                        .hover(|style| style.bg(rgb(BORDER)))
                        .child(if self.workspace.secondary().is_some() { "合并分栏" } else { "左右分栏" })
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.workspace.toggle_split();
                            cx.notify();
                        }))),
            )
            .when(self.menu_open, |root| root.child(menu))
            .child(div().flex().flex_1().min_h_0().child(navigation).child(content))
            .child(div().flex().justify_between().px_4().py_2().flex_shrink_0()
                .border_t_1().border_color(rgb(BORDER)).bg(rgb(CHROME)).text_xs().text_color(rgb(MUTED))
                .child("开发构建 · 业务服务未实现")
                .child("Ctrl+T 新标签   Ctrl+W 关闭标签   Ctrl+\\ 分栏"))
    }
}

fn main() {
    Application::new().run(|cx: &mut App| {
        cx.on_window_closed(|cx| {
            if cx.windows().is_empty() { cx.quit(); }
        }).detach();
        let bounds = Bounds::centered(None, size(px(1280.0), px(800.0)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                titlebar: Some(TitlebarOptions { title: Some("Cmdb".into()), ..Default::default() }),
                window_min_size: Some(size(px(800.0), px(500.0))),
                ..Default::default()
            },
            |window, cx| cx.new(|cx| {
                let focus = cx.focus_handle();
                focus.focus(window);
                Desktop { workspace: Workspace::default(), menu_open: false, focus }
            }),
        ).expect("Failed to create the native GPUI window");
        cx.activate(true);
    });
}
