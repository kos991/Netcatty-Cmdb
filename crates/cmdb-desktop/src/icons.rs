use std::borrow::Cow;

use cmdb_engine::Page;
use gpui::{prelude::*, px, rgb, svg, AssetSource, SharedString, Svg};

// Official, unmodified Lucide 0.560.0 SVGs:
// https://github.com/lucide-icons/lucide/tree/0.560.0/icons
// Upstream ISC and derivative notices are retained in assets/lucide/LICENSE.
const ASSETS: &[(&str, &[u8])] = &[
    ("lucide/monitor.svg", include_bytes!("../assets/lucide/monitor.svg")),
    ("lucide/server.svg", include_bytes!("../assets/lucide/server.svg")),
    ("lucide/app-window.svg", include_bytes!("../assets/lucide/app-window.svg")),
    ("lucide/users.svg", include_bytes!("../assets/lucide/users.svg")),
    ("lucide/hard-drive.svg", include_bytes!("../assets/lucide/hard-drive.svg")),
    ("lucide/network.svg", include_bytes!("../assets/lucide/network.svg")),
    ("lucide/clipboard-list.svg", include_bytes!("../assets/lucide/clipboard-list.svg")),
    ("lucide/x.svg", include_bytes!("../assets/lucide/x.svg")),
    ("lucide/plus.svg", include_bytes!("../assets/lucide/plus.svg")),
    ("lucide/columns-2.svg", include_bytes!("../assets/lucide/columns-2.svg")),
    ("lucide/panel-left-close.svg", include_bytes!("../assets/lucide/panel-left-close.svg")),
    ("product-logo.svg", include_bytes!("../assets/product-logo.svg")),
];

pub struct EmbeddedAssets;

impl AssetSource for EmbeddedAssets {
    fn load(&self, path: &str) -> gpui::Result<Option<Cow<'static, [u8]>>> {
        Ok(ASSETS.iter().find(|(name, _)| *name == path)
            .map(|(_, bytes)| Cow::Borrowed(*bytes)))
    }

    fn list(&self, path: &str) -> gpui::Result<Vec<SharedString>> {
        Ok(ASSETS.iter().filter(|(name, _)| {
            path.is_empty() || name.strip_prefix(path).is_some_and(|suffix| {
                path.ends_with('/') || suffix.starts_with('/') || suffix.is_empty()
            })
        }).map(|(name, _)| (*name).into()).collect())
    }
}

pub fn icon(path: &'static str, color: u32) -> Svg {
    svg().path(path).size(px(16.0)).flex_shrink_0().text_color(rgb(color))
}

pub fn page_icon(page: Page, color: u32) -> Svg {
    icon(
        match page {
            Page::Terminal => "lucide/monitor.svg",
            Page::Infrastructure => "lucide/server.svg",
            Page::Applications => "lucide/app-window.svg",
            Page::Organization => "lucide/users.svg",
            Page::Racks => "lucide/hard-drive.svg",
            Page::Network => "lucide/network.svg",
            Page::WorkOrders => "lucide/clipboard-list.svg",
        },
        color,
    )
}
