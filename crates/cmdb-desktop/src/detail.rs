use blenderui::prelude::*;
use crate::{Desktop, assets::TerminalAsset, icons::{self, Icon}};

impl Desktop {
    pub(crate) fn render_terminal_drawer(&self, tab_id: usize, cx: &mut Context<Self>) -> Div {
        let state = &self.terminal_states[&tab_id];
        let Some(selected_id) = state.selected else { return div(); };
        let Some(asset) = self.terminals.iter().find(|item| item.id == selected_id) else {
            return div();
        };
        let is_expanded = state.expanded;
        let columns = state.detail_columns;
        div().id(format!("terminal-detail-{tab_id}"))
            .class(if is_expanded { "detail-drawer expanded" } else { "detail-drawer" })
            .child(div().class("drawer-header")
                .child(div().class("drawer-title-box")
                    .child(div().class("drawer-title").id(format!("terminal-detail-name-{tab_id}")).child(asset.name))
                    .child(div().class("drawer-code").id(format!("terminal-detail-code-{tab_id}")).child(format!("资产编码: {}", asset.code))))
                .child(div().class("drawer-header-actions")
                    .child(div().class("drawer-close")
                        .id(format!("terminal-expand-{tab_id}"))
                        .attr("title", if is_expanded { "还原面板宽度" } else { "展开面板宽度" })
                        .child(icons::icon(if is_expanded { Icon::Restore } else { Icon::Expand }))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.focused_tab = Some(tab_id);
                            let state = this.terminal_states.get_mut(&tab_id).unwrap();
                            state.expanded = !state.expanded;
                            cx.notify();
                        })))
                    .child(div().class("drawer-close")
                        .id(format!("terminal-close-{tab_id}"))
                        .attr("title", "关闭资产详情 (Esc)")
                        .child(icons::icon(Icon::Close))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.focused_tab = Some(tab_id);
                            this.terminal_states.get_mut(&tab_id).unwrap().close_detail();
                            cx.notify();
                        })))))
            .child(div().class("drawer-actions")
                .child(div().class("drawer-btn disabled").id(format!("action-edit-{tab_id}"))
                    .attr("title", "编辑资产不可用：业务服务尚未接入")
                    .child(icons::icon(Icon::Edit)).child("编辑资产"))
                .child(div().class("drawer-btn disabled").id(format!("action-swap-{tab_id}"))
                    .attr("title", "调换使用人不可用：业务服务尚未接入")
                    .child(icons::icon(Icon::Swap)).child("调换使用人"))
                .child(div().class("drawer-btn disabled").id(format!("action-wrench-{tab_id}"))
                    .attr("title", "维修换件不可用：业务服务尚未接入")
                    .child(icons::icon(Icon::Wrench)).child("维修换件"))
                .child(div().class("drawer-btn disabled").id(format!("action-clone-{tab_id}"))
                    .attr("title", "克隆设备不可用：业务服务尚未接入")
                    .child(icons::icon(Icon::Clone)).child("克隆设备"))
                .child(div().class("drawer-btn disabled").id(format!("action-archive-{tab_id}"))
                    .attr("title", "注销归档不可用：业务服务尚未接入")
                    .child(icons::icon(Icon::Archive)).child("注销归档"))
                .child(div().class(if columns == 1 { "drawer-btn active" } else { "drawer-btn" })
                    .id(format!("detail-cols-1-{tab_id}"))
                    .attr("title", "切换为 1 列排版")
                    .child(icons::icon(Icon::Columns))
                    .child("1列")
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.focused_tab = Some(tab_id);
                        this.terminal_states.get_mut(&tab_id).unwrap().detail_columns = 1;
                        cx.notify();
                    })))
                .child(div().class(if columns == 2 { "drawer-btn active" } else { "drawer-btn" })
                    .id(format!("detail-cols-2-{tab_id}"))
                    .attr("title", "切换为 2 列排版")
                    .child(icons::icon(Icon::Columns))
                    .child("2列")
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.focused_tab = Some(tab_id);
                        this.terminal_states.get_mut(&tab_id).unwrap().detail_columns = 2;
                        cx.notify();
                    }))))
            .child(div().class("drawer-body")
                .child(render_section("身份与状态", columns == 2, &[
                    ("设备类型", asset.device_type),
                    ("设备状态", asset.status),
                    ("主机 SN", asset.box_sn),
                    ("品牌/厂商", asset.brand),
                    ("设备型号", asset.model),
                ]))
                .child(render_section("使用与归属位置", columns == 2, &[
                    ("使用人员", asset.user),
                    ("归属部门", asset.dept),
                    ("房间号", asset.room),
                ]))
                .child(render_section("网络系统", columns == 2, &[
                    ("IP 地址", asset.ip),
                    ("网络类型", asset.net_type),
                    ("操作系统", operating_system(asset)),
                ]))
                .child(render_hardware_section(asset, columns == 2)))
    }
}

fn render_section(heading: &str, two_cols: bool, fields: &[(&str, &str)]) -> Div {
    div().class("drawer-section")
        .child(div().class("section-title").child(heading))
        .child(div().class(if two_cols { "prop-grid two-columns" } else { "prop-grid" })
            .children(fields.iter().copied().flat_map(|(label, value)| [
                span().class("prop-label").child(label),
                span().class("prop-value").child(value),
            ])))
}

fn render_hardware_section(asset: &TerminalAsset, two_cols: bool) -> Div {
    if asset.device_type == "打印机" {
        return div().class("drawer-section")
            .child(div().class("section-title").child("硬件配置详情"))
            .child(div().class(if two_cols { "prop-grid two-columns" } else { "prop-grid" })
                .child(span().class("prop-label").child("设备架构"))
                .child(span().class("prop-value").child("外设打印控制器"))
                .child(span().class("prop-label").child("控制内存"))
                .child(span().class("prop-value").child(asset.memory)));
    }
    div().class("drawer-section")
        .child(div().class("section-title").child("硬件配置详情"))
        .child(div().class(if two_cols { "prop-grid two-columns" } else { "prop-grid" })
            .child(span().class("prop-label").child("CPU 配置"))
            .child(span().class("prop-value").child(asset.cpu))
            .child(span().class("prop-label").child("系统内存"))
            .child(span().class("prop-value").child(asset.memory))
            .child(span().class("prop-label").child("主存储"))
            .child(span().class("prop-value").child(asset.disk)))
}

fn operating_system(asset: &TerminalAsset) -> &'static str {
    match asset.device_type {
        "云桌面" => "统信 UOS 20 专业版（云主机镜像）",
        "云桌面盒子" => "嵌入式瘦客户机 Linux",
        "打印机" => "未配置 / 无独立宿主操作系统",
        _ => "未配置 / 待同步资产资产库",
    }
}
