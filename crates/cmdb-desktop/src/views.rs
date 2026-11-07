use blenderui::prelude::*;
use cmdb_engine::{Page, Tab};
use crate::{Desktop, icons::{self, Icon}};

impl Desktop {
    pub(crate) fn render_placeholder_page(&self, tab: Tab, _cx: &mut Context<Self>) -> Div {
        let tab_id = tab.id;
        let title = tab.page.title();
        let columns = tab.page.columns();
        div().class("pane").id(format!("pane-{tab_id}"))
            .child(div().class("toolbar")
                .child(div().class("toolbar-left")
                    .child(span().class("toolbar-title").child(format!("{title} 模块"))
                        .id(format!("toolbar-title-{tab_id}"))))
                .child(div().class("toolbar-right")
                    .child(div().class("btn-primary disabled").id(format!("action-new-{tab_id}"))
                        .attr("title", format!("新增{title}不可用：业务服务尚未接入"))
                        .child(icons::icon(Icon::Plus)).child(format!("新增{title}")))))
            .child(div().class("preview-notice").child("离线样例 · 未连接业务数据库"))
            .child(div().class("table-container")
                .child(table().class("cmdb-table")
                    .child(thead().child(tr().children(columns.iter().map(|name| th().child(*name)))))
                    .child(tbody().child(tr().child(td().attr("colspan", columns.len().to_string())
                        .class("placeholder-notice").id(format!("placeholder-notice-{tab_id}"))
                        .child(format!("{title}业务服务尚未接入 · 暂无可用离线样例")))))))
            .child(div().class("statusbar")
                .child(div().class("status-left").child("离线样例 · 未连接业务数据库"))
                .child(div().class("status-right").child("服务离线")))
    }

    pub(crate) fn render_empty_workspace(&self, cx: &mut Context<Self>) -> Div {
        div().class("pane empty-workspace").id("empty-workspace")
            .child(div().class("empty-workspace-card")
                .child(div().class("empty-workspace-title").child("当前工作区无打开标签页"))
                .child(div().class("empty-workspace-hint").child("可点击左侧导航栏、顶栏加号菜单或下方按钮重新打开"))
                .child(div().class("btn-primary").id("empty-reopen-terminal")
                    .attr("title", "打开终端资产台账")
                    .child(icons::page_icon(Page::Terminal)).child("打开终端资产")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.open(Page::Terminal, cx);
                    }))))
    }
}
