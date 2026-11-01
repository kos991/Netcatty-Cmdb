//! Native workspace state; deliberately independent of rendering, storage and services.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Page {
    Terminal,
    Infrastructure,
    Applications,
    Organization,
    Racks,
    Network,
    WorkOrders,
}

impl Page {
    pub const ALL: [Self; 7] = [
        Self::Terminal, Self::Infrastructure, Self::Applications,
        Self::Organization, Self::Racks, Self::Network, Self::WorkOrders,
    ];

    pub fn title(self) -> &'static str {
        match self {
            Self::Terminal => "终端资产",
            Self::Infrastructure => "基础设施",
            Self::Applications => "业务系统",
            Self::Organization => "组织架构",
            Self::Racks => "设备机柜",
            Self::Network => "地址池",
            Self::WorkOrders => "工单与统计",
        }
    }

    pub fn columns(self) -> &'static [&'static str] {
        match self {
            Self::Terminal => &["设备名称 / SN", "设备类型", "使用人 / 部门", "房间号", "IP 地址", "网络类型", "设备状态"],
            Self::Infrastructure => &["名称 / 编码", "设备类型", "IP 地址", "网络类型", "位置", "负责人", "设备状态"],
            Self::Applications => &["系统名称", "系统类型", "版本", "承载设备", "业务 IP", "网络类型", "状态"],
            Self::Organization => &["姓名", "所属组织", "部门", "房间号", "联系电话"],
            Self::Racks => &["机房", "机柜", "总 U 数", "已上架设备"],
            Self::Network => &["地址池", "CIDR", "网络类型", "VLAN / VNI", "地址分段"],
            Self::WorkOrders => &["工单号", "优先级", "维护主题", "维护类型", "关联资产", "处理时间", "维护状态"],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tab {
    pub id: usize,
    pub page: Page,
}

#[derive(Debug)]
pub struct Workspace {
    tabs: Vec<Tab>,
    active: Option<usize>,
    secondary: Option<usize>,
    next_id: usize,
}

impl Default for Workspace {
    fn default() -> Self {
        let mut state = Self { tabs: Vec::new(), active: None, secondary: None, next_id: 0 };
        state.open(Page::Terminal);
        state
    }
}

impl Workspace {
    pub fn tabs(&self) -> &[Tab] { &self.tabs }
    pub fn active(&self) -> Option<Tab> { self.find(self.active) }
    pub fn secondary(&self) -> Option<Tab> { self.find(self.secondary) }
    fn find(&self, id: Option<usize>) -> Option<Tab> {
        self.tabs.iter().find(|tab| Some(tab.id) == id).copied()
    }

    pub fn open(&mut self, page: Page) {
        let id = self.next_id;
        self.next_id += 1;
        self.tabs.push(Tab { id, page });
        self.activate(id);
    }

    pub fn activate(&mut self, id: usize) {
        if !self.tabs.iter().any(|tab| tab.id == id) { return; }
        if self.secondary == Some(id) { self.secondary = self.active; }
        self.active = Some(id);
    }

    pub fn close(&mut self, id: usize) {
        let Some(index) = self.tabs.iter().position(|tab| tab.id == id) else { return; };
        self.tabs.remove(index);
        if self.secondary == Some(id) { self.secondary = None; }
        if self.active == Some(id) {
            self.active = self.tabs.get(index).or_else(|| self.tabs.last()).map(|tab| tab.id);
            if self.active == self.secondary { self.secondary = None; }
        }
    }

    pub fn toggle_split(&mut self) {
        if self.secondary.take().is_some() { return; }
        let Some(active) = self.active() else { return; };
        if let Some(other) = self.tabs.iter().find(|tab| tab.id != active.id) {
            self.secondary = Some(other.id);
        } else {
            let id = self.next_id;
            self.next_id += 1;
            self.tabs.push(Tab { id, page: active.page });
            self.secondary = Some(id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_switch_close_preserves_valid_distinct_panes() {
        let mut workspace = Workspace::default();
        workspace.toggle_split();
        let left = workspace.active().unwrap().id;
        let right = workspace.secondary().unwrap().id;
        assert_ne!(left, right);
        workspace.activate(right);
        assert_eq!(workspace.secondary().unwrap().id, left);
        workspace.close(right);
        assert_eq!(workspace.active().unwrap().id, left);
        assert!(workspace.secondary().is_none());
        workspace.close(left);
        assert!(workspace.active().is_none());
        workspace.toggle_split();
        assert!(workspace.secondary().is_none());
        workspace.open(Page::Network);
        assert_eq!(workspace.active().unwrap().page, Page::Network);
    }

    #[test]
    fn closing_background_tab_keeps_selection() {
        let mut workspace = Workspace::default();
        let initial = workspace.active().unwrap().id;
        workspace.open(Page::Organization);
        let selected = workspace.active();
        workspace.close(initial);
        assert_eq!(workspace.active(), selected);
    }
}
