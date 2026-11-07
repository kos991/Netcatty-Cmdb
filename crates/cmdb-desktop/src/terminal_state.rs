use crate::assets::TerminalAsset;

pub const DEVICE_TYPES: [&str; 7] = ["全部", "云桌面", "台式电脑", "笔记本", "打印机", "云桌面盒子", "一体机"];

#[derive(Debug)]
pub struct TerminalState {
    pub query: String,
    normalized_query: String,
    pub device_type: String,
    pub include_archived: bool,
    pub page: usize,
    pub page_size: usize,
    pub selected: Option<u64>,
    pub expanded: bool,
    pub detail_columns: usize,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            query: String::new(), normalized_query: String::new(),
            device_type: "全部".into(), include_archived: false,
            page: 0, page_size: 10, selected: None, expanded: false, detail_columns: 1,
        }
    }
}

impl TerminalState {
    pub fn set_query(&mut self, value: &str) {
        self.query = value.into();
        self.normalized_query = value.trim().to_lowercase();
        self.reset_results();
    }

    pub fn reset_results(&mut self) {
        self.page = 0;
        self.close_detail();
    }

    pub fn close_detail(&mut self) {
        self.selected = None;
        self.expanded = false;
    }

    pub fn matches(&self, asset: &TerminalAsset) -> bool {
        (self.include_archived || asset.status != "已注销")
            && (self.device_type == "全部" || self.device_type == asset.device_type)
            && (self.normalized_query.is_empty()
                || [asset.name, asset.code, asset.box_sn, asset.user, asset.ip]
                    .into_iter().any(|value| contains_query(value, &self.normalized_query)))
    }

    pub fn page_count(&self, count: usize) -> usize {
        count.div_ceil(self.page_size)
    }

    pub fn visible_range(&self, count: usize) -> std::ops::Range<usize> {
        let start = self.page.saturating_mul(self.page_size).min(count);
        start..start.saturating_add(self.page_size).min(count)
    }
}

// Sample searchable fields contain Chinese and ASCII. Byte windows preserve Chinese
// substrings and compare ASCII identifiers without allocating once per row.
fn contains_query(value: &str, query: &str) -> bool {
    value.as_bytes().windows(query.len())
        .any(|part| part.eq_ignore_ascii_case(query.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assets::sample_terminals;

    #[test]
    fn search_matches_all_supported_fields_and_hides_archived() {
        let assets = sample_terminals();
        let mut state = TerminalState::default();
        assert_eq!(assets.iter().filter(|asset| state.matches(asset)).count(), 13);
        for query in ["示例云桌面 01", "zcy-dz-202610-001", "box-202610-001", "张伟", "10.20.30.21"] {
            state.set_query(&format!("  {query}  "));
            let ids: Vec<_> = assets.iter().filter(|asset| state.matches(asset)).map(|asset| asset.id).collect();
            assert_eq!(ids, [1]);
        }
        state.set_query("ZCY-DZ-202610-014");
        assert!(!assets.iter().any(|asset| state.matches(asset)));
        state.include_archived = true;
        assert!(state.matches(&assets[13]));
        state.device_type = "打印机".into();
        assert!(!assets.iter().any(|asset| state.matches(asset)));
    }

    #[test]
    fn pagination_and_filter_reset_cover_empty_and_last_page() {
        let mut state = TerminalState::default();
        assert_eq!(state.page_count(0), 0);
        assert_eq!(state.visible_range(0), 0..0);
        assert_eq!(state.page_count(13), 2);
        state.page = 1;
        assert_eq!(state.visible_range(13), 10..13);
        state.selected = Some(1);
        state.expanded = true;
        state.set_query("missing");
        assert_eq!(state.page, 0);
        assert_eq!(state.selected, None);
        assert!(!state.expanded);
        state.page_size = 20;
        assert_eq!(state.page_count(13), 1);
        assert_eq!(state.visible_range(13), 0..13);
    }
}
