#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod assets;
mod detail;
mod icons;
mod terminal;
mod terminal_state;
mod views;

use std::collections::HashMap;
use blenderui::prelude::*;
use cmdb_engine::{Page, Tab, Workspace};
use assets::{sample_terminals, TerminalAsset};
use icons::Icon;
use terminal_state::TerminalState;

const CSS_STYLESHEET: &str = include_str!("style.css");

pub struct Desktop {
    pub(crate) workspace: Workspace,
    pub(crate) terminals: Vec<TerminalAsset>,
    pub(crate) terminal_states: HashMap<usize, TerminalState>,
    pub(crate) add_menu_open: bool,
    pub(crate) focused_tab: Option<usize>,
}

impl Desktop {
    fn new() -> Self {
        let workspace = Workspace::default();
        let mut terminal_states = HashMap::new();
        if let Some(tab) = workspace.active() {
            terminal_states.insert(tab.id, TerminalState::default());
        }
        Self {
            focused_tab: workspace.active().map(|tab| tab.id),
            workspace,
            terminals: sample_terminals(),
            terminal_states,
            add_menu_open: false,
        }
    }

    pub(crate) fn open(&mut self, page: Page, cx: &mut Context<Self>) {
        self.workspace.open(page);
        if let Some(tab) = self.workspace.active() {
            self.terminal_states.entry(tab.id).or_default();
            self.focused_tab = Some(tab.id);
        }
        self.add_menu_open = false;
        cx.notify();
    }

    fn active_target_tab(&self) -> Option<usize> {
        self.focused_tab.filter(|id| self.workspace.tabs().iter().any(|tab| tab.id == *id))
            .or_else(|| self.workspace.active().map(|tab| tab.id))
    }

    fn render_tabs(&self, cx: &mut Context<Self>) -> Div {
        let active = self.workspace.active();
        let tabs = self.workspace.tabs().iter().map(|tab| {
            let is_active = active == Some(*tab);
            let tab_id = tab.id;
            div().id(format!("tab-item-{tab_id}"))
                .class(if is_active { "tab-item active" } else { "tab-item" })
                .child(div().class("tab-select")
                    .child(icons::page_icon(tab.page))
                    .child(span().class("tab-title").child(tab.page.title()))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.focused_tab = Some(tab_id);
                        this.workspace.activate(tab_id);
                        this.add_menu_open = false;
                        cx.notify();
                    })))
                .child(div().class("tab-close").id(format!("tab-close-{tab_id}"))
                    .attr("title", "关闭标签页 (Ctrl+W)")
                    .child(icons::icon(Icon::Close))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.workspace.close(tab_id);
                        this.terminal_states.remove(&tab_id);
                        this.focused_tab = this.workspace.active().map(|tab| tab.id);
                        this.add_menu_open = false;
                        cx.notify();
                    })))
        });
        div().class("tabs-container").children(tabs)
    }

    fn render_sidebar(&self, cx: &mut Context<Self>) -> Div {
        let active_page = self.workspace.active().map(|tab| tab.page);
        let nav_items = Page::ALL.into_iter().map(|page| {
            let is_active = active_page == Some(page);
            div().id(format!("nav-{:?}", page).to_lowercase())
                .class(if is_active { "nav-item active" } else { "nav-item" })
                .attr("tabindex", "0")
                .attr("title", format!("切换到{}", page.title()))
                .child(icons::page_icon(page))
                .child(span().child(page.title()))
                .on_click(cx.listener(move |this, _, _, cx| {
                    if let Some(existing) = this.workspace.tabs().iter().find(|tab| tab.page == page).copied() {
                        this.workspace.activate(existing.id);
                        this.focused_tab = Some(existing.id);
                    } else {
                        this.open(page, cx);
                    }
                    this.add_menu_open = false;
                    cx.notify();
                }))
        });
        let is_split = self.workspace.secondary().is_some();
        div().class("sidebar")
            .child(div().class("sidebar-title").child("工作区导航"))
            .children(nav_items)
            .child(div().class("sidebar-bottom")
                .child(div().class(if is_split { "nav-item active" } else { "nav-item" })
                    .id("workspace-split-toggle")
                    .attr("tabindex", "0")
                    .attr("title", if is_split { "合并分栏 (Ctrl+\\)" } else { "左右分栏 (Ctrl+\\)" })
                    .child(icons::icon(if is_split { Icon::Merge } else { Icon::Split }))
                    .child(span().child(if is_split { "合并分栏" } else { "左右分栏" }))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.workspace.toggle_split();
                        if let Some(secondary) = this.workspace.secondary() {
                            this.terminal_states.entry(secondary.id).or_default();
                        }
                        this.add_menu_open = false;
                        cx.notify();
                    }))))
    }

    fn render_add_menu(&self, cx: &mut Context<Self>) -> Div {
        if !self.add_menu_open { return div(); }
        let menu_items = Page::ALL.into_iter().map(|page| {
            div().class("tab-menu-item").id(format!("menu-add-{:?}", page).to_lowercase())
                .attr("title", format!("新建{}标签页", page.title()))
                .child(icons::page_icon(page))
                .child(span().child(page.title()))
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.open(page, cx);
                }))
        });
        div().class("tab-menu").id("add-page-menu").children(menu_items)
    }

    fn render_pane(&self, tab: Tab, cx: &mut Context<Self>) -> Div {
        match tab.page {
            Page::Terminal => self.render_terminal_page(tab, cx),
            _ => self.render_placeholder_page(tab, cx),
        }
    }
}

impl Render for Desktop {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let active_tab = self.workspace.active();
        let secondary_tab = self.workspace.secondary();
        let target_tab = self.active_target_tab();
        let target_is_terminal = target_tab
            .and_then(|id| self.workspace.tabs().iter().find(|tab| tab.id == id))
            .map(|tab| tab.page) == Some(Page::Terminal);
        let show_drawer = target_is_terminal && target_tab.and_then(|id| self.terminal_states.get(&id))
            .and_then(|state| state.selected).is_some();

        let mut panes = div().class("content-area");
        if let Some(tab) = active_tab {
            panes = panes.child(self.render_pane(tab, cx));
            if let Some(sec) = secondary_tab {
                panes = panes.child(self.render_pane(sec, cx));
            }
        } else {
            panes = panes.child(self.render_empty_workspace(cx));
        }
        if show_drawer {
            if let Some(tab_id) = target_tab {
                panes = panes.child(self.render_terminal_drawer(tab_id, cx));
            }
        }

        html().styled()
            .child(head().child(style().child(CSS_STYLESHEET)))
            .child(body().child(
                div().class("app-root").id("app-root")
                    .attr("tabindex", "0")
                    .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| {
                        if event.keystroke.modifiers.control {
                            match event.keystroke.key.as_str() {
                                "t" | "T" => {
                                    this.open(Page::Terminal, cx);
                                }
                                "w" | "W" => {
                                    if let Some(tab_id) = this.active_target_tab() {
                                        this.workspace.close(tab_id);
                                        this.terminal_states.remove(&tab_id);
                                        this.focused_tab = this.workspace.active().map(|tab| tab.id);
                                        this.add_menu_open = false;
                                        cx.notify();
                                    }
                                }
                                "\\" => {
                                    this.workspace.toggle_split();
                                    if let Some(secondary) = this.workspace.secondary() {
                                        this.terminal_states.entry(secondary.id).or_default();
                                    }
                                    this.add_menu_open = false;
                                    cx.notify();
                                }
                                _ => {}
                            }
                        } else if event.keystroke.key == "Escape" || event.keystroke.key == "escape" {
                            if this.add_menu_open {
                                this.add_menu_open = false;
                                cx.notify();
                            } else if let Some(tab_id) = this.active_target_tab() {
                                if let Some(state) = this.terminal_states.get_mut(&tab_id) {
                                    if state.selected.is_some() {
                                        state.close_detail();
                                        cx.notify();
                                    }
                                }
                            }
                        }
                    }))
                    .child(div().class("topbar")
                        .child(icons::logo())
                        .child(self.render_tabs(cx))
                        .child(div().class("tab-add-btn").id("tab-add-btn")
                            .attr("title", "选择新建标签页 (Ctrl+T 默认终端资产)")
                            .child(icons::icon(Icon::Plus))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.add_menu_open = !this.add_menu_open;
                                cx.notify();
                            })))
                        .child(self.render_add_menu(cx)))
                    .child(div().class("main-layout")
                        .child(self.render_sidebar(cx))
                        .child(panes)),
            ))
    }
}

fn main() {
    icons::init_cache();
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
