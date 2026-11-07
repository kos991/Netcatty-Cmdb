use blenderui::prelude::*;
use cmdb_engine::Tab;
use crate::{Desktop, icons::{self, Icon}, terminal_state::DEVICE_TYPES};

impl Desktop {
    pub(crate) fn render_terminal_page(&self, tab: Tab, cx: &mut Context<Self>) -> Div {
        let tab_id = tab.id;
        let state = &self.terminal_states[&tab_id];
        let list: Vec<_> = self.terminals.iter().filter(|asset| state.matches(asset)).collect();
        let count = list.len();
        let pages = state.page_count(count);
        let range = state.visible_range(count);
        let rows = list[range.clone()].iter().enumerate().map(|(index, asset)| {
            let asset_id = asset.id;
            tr().id(format!("terminal-row-{tab_id}-{asset_id}"))
                .class(if state.selected == Some(asset_id) { "selected" } else { "" })
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.focused_tab = Some(tab_id);
                    this.terminal_states.get_mut(&tab_id).unwrap().selected = Some(asset_id);
                    cx.notify();
                }))
                .child(td().child((range.start + index + 1).to_string()))
                .child(td().child(
                    div().class("cell-identity")
                        .child(span().class(format!("net-indicator net-{}", asset.net_type)))
                        .child(div().class("cell-text")
                            .child(span().class("cell-primary").child(asset.name))
                            .child(span().class("cell-sub").child(asset.box_sn)))))
                .child(td().child(asset.device_type))
                .child(td().child(div().class("cell-text").child(span().child(asset.brand)).child(span().class("cell-sub").child(asset.model))))
                .child(td().child(div().class("cell-text").child(span().child(asset.user)).child(span().class("cell-sub").child(asset.dept))))
                .child(td().child(asset.room))
                .child(td().class("ip-address").child(asset.ip))
                .child(td().child(asset.net_type))
                .child(td().child(span().class(format!("badge badge-{}", asset.status)).child(asset.status)))
                .child(td().child(div().class("drawer-btn")
                    .id(format!("terminal-view-{tab_id}-{asset_id}"))
                    .attr("title", "查看此资产详情")
                    .child("查看详情")
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.focused_tab = Some(tab_id);
                        this.terminal_states.get_mut(&tab_id).unwrap().selected = Some(asset_id);
                        cx.notify();
                    }))))
        });
        let mut body = tbody().children(rows);
        if count == 0 {
            body = body.child(tr().child(td().attr("colspan", "10")
                .class("empty-state").id(format!("terminal-empty-{tab_id}"))
                .child("没有匹配的样例资产，请调整搜索或筛选条件")));
        }
        let is_prev_disabled = state.page == 0;
        let mut previous = div().id(format!("terminal-prev-{tab_id}"))
            .class(if is_prev_disabled { "drawer-btn disabled" } else { "drawer-btn" })
            .attr("title", "上一页")
            .child(icons::icon(Icon::ChevronLeft))
            .child("上一页");
        if !is_prev_disabled {
            previous = previous.on_click(cx.listener(move |this, _, _, cx| {
                this.focused_tab = Some(tab_id);
                let state = this.terminal_states.get_mut(&tab_id).unwrap();
                state.page = state.page.saturating_sub(1);
                state.close_detail();
                cx.notify();
            }));
        }
        let is_next_disabled = pages == 0 || state.page + 1 >= pages;
        let mut next = div().id(format!("terminal-next-{tab_id}"))
            .class(if is_next_disabled { "drawer-btn disabled" } else { "drawer-btn" })
            .attr("title", "下一页")
            .child("下一页")
            .child(icons::icon(Icon::ChevronRight));
        if !is_next_disabled {
            next = next.on_click(cx.listener(move |this, _, _, cx| {
                this.focused_tab = Some(tab_id);
                let state = this.terminal_states.get_mut(&tab_id).unwrap();
                let count = this.terminals.iter().filter(|asset| state.matches(asset)).count();
                if state.page + 1 < state.page_count(count) {
                    state.page += 1;
                    state.close_detail();
                }
                cx.notify();
            }));
        }
        div().class("pane").id(format!("terminal-list-{tab_id}"))
            .child(div().class("toolbar")
                .child(div().class("toolbar-left")
                    .child(span().class("toolbar-title").child("终端资产台账"))
                    .child(input().class("search-input").id(format!("terminal-search-{tab_id}"))
                        .attr("title", "搜索设备名称、资产编码、SN、使用人或 IP")
                        .placeholder("搜索名称/编码/SN/人/IP")
                        .value(state.query.clone())
                        .on_input(cx.listener(move |this, event: &ChangeEvent, _, cx| {
                            this.focused_tab = Some(tab_id);
                            this.terminal_states.get_mut(&tab_id).unwrap().set_query(&event.value);
                            cx.notify();
                        })))
                    .child(select().class("type-filter").id(format!("terminal-type-{tab_id}"))
                        .attr("title", "设备类型").value(state.device_type.clone())
                        .on_change(cx.listener(move |this, event: &ChangeEvent, _, cx| {
                            this.focused_tab = Some(tab_id);
                            let state = this.terminal_states.get_mut(&tab_id).unwrap();
                            if DEVICE_TYPES.contains(&event.value.as_str()) {
                                state.device_type = event.value.clone();
                                state.reset_results();
                            }
                            cx.notify();
                        }))
                        .children(DEVICE_TYPES.into_iter().map(|kind| option().value(kind)
                            .child(if kind == "全部" { "全部设备类型" } else { kind }))))
                    .child(select().class("type-filter").id(format!("terminal-archived-{tab_id}"))
                        .attr("title", "是否包含已注销资产")
                        .value(if state.include_archived { "include" } else { "hide" })
                        .child(option().value("hide").child("隐藏已注销"))
                        .child(option().value("include").child("含已注销"))
                        .on_change(cx.listener(move |this, event: &ChangeEvent, _, cx| {
                            this.focused_tab = Some(tab_id);
                            let state = this.terminal_states.get_mut(&tab_id).unwrap();
                            state.include_archived = event.value == "include";
                            state.reset_results();
                            cx.notify();
                        }))))
                .child(div().class("toolbar-right")
                    .child(div().class("btn-secondary disabled").id(format!("terminal-export-{tab_id}"))
                        .attr("title", "导出不可用：业务服务尚未接入")
                        .child(icons::icon(Icon::Download)).child("按条件导出"))
                    .child(div().class("btn-primary disabled").id(format!("terminal-add-{tab_id}"))
                        .attr("title", "新增不可用：业务服务尚未接入")
                        .child(icons::icon(Icon::Plus)).child("新增终端"))))
            .child(div().class("preview-notice").child("离线样例 · 未连接业务数据库"))
            .child(div().class("table-container").id(format!("terminal-scroll-{tab_id}"))
                .child(table().class("cmdb-table")
                    .child(thead().child(tr().children([
                        "序号", "设备名称 / SN", "设备类型", "品牌 / 型号", "使用人 / 部门",
                        "房间号", "IP 地址", "网络类型", "设备状态", "操作",
                    ].into_iter().map(|heading| th().child(heading)))))
                    .child(body)))
            .child(div().class("statusbar")
                .child(div().class("status-left").id(format!("terminal-count-{tab_id}"))
                    .child(format!("共 {count} 条 · 显示 {}–{} 条", if count == 0 { 0 } else { range.start + 1 }, range.end)))
                .child(div().class("status-right")
                    .child(select().class("page-size").id(format!("terminal-page-size-{tab_id}"))
                        .attr("title", "每页条数").value(state.page_size.to_string())
                        .child(option().value("10").child("10 条 / 页"))
                        .child(option().value("20").child("20 条 / 页"))
                        .on_change(cx.listener(move |this, event: &ChangeEvent, _, cx| {
                            this.focused_tab = Some(tab_id);
                            let state = this.terminal_states.get_mut(&tab_id).unwrap();
                            state.page_size = if event.value == "20" { 20 } else { 10 };
                            state.reset_results();
                            cx.notify();
                        })))
                    .child(span().id(format!("terminal-page-{tab_id}"))
                        .child(format!("第 {}/{} 页", if pages == 0 { 0 } else { state.page + 1 }, pages)))
                    .child(previous).child(next)))
    }
}
