//! Lucide 0.560.0 icons and CMDB product logo for BlenderUI (BUI 0.4.1).
//!
//! SVG source files remain unmodified on disk (preserving upstream currentColor and ISC/MIT licensing).
//! Because NanoSVG (used by BUI's image decoding pipeline) does not inherit CSS currentColor,
//! the icon tint (#9eacbd) is injected once in memory during decoding, and the resulting
//! `Arc<Image>` is cached via `LazyLock`. Rendering per-frame only clones the Arc pointer.

use std::sync::{Arc, LazyLock};

use blenderui::element::Div;
use blenderui::html::img;
use blenderui::paint::Image;
use blenderui::styled::Styled;

/// Default muted slate-gray color for dark theme icon strokes and fills.
pub const ICON_COLOR: &str = "#9eacbd";

/// Icon variants required across CMDB desktop navigation, toolbars, and asset details.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(usize)]
pub enum Icon {
    Monitor = 0,
    Server = 1,
    Applications = 2,
    Users = 3,
    Racks = 4,
    Network = 5,
    WorkOrders = 6,
    Close = 7,
    Plus = 8,
    Split = 9,
    Merge = 10,
    Search = 11,
    ChevronLeft = 12,
    ChevronRight = 13,
    ChevronDown = 14,
    Expand = 15,
    Restore = 16,
    Columns = 17,
    Edit = 18,
    Swap = 19,
    Wrench = 20,
    Clone = 21,
    Archive = 22,
    Download = 23,
}

pub const ICON_COUNT: usize = 24;

pub const ALL_ICONS: [Icon; ICON_COUNT] = [
    Icon::Monitor,
    Icon::Server,
    Icon::Applications,
    Icon::Users,
    Icon::Racks,
    Icon::Network,
    Icon::WorkOrders,
    Icon::Close,
    Icon::Plus,
    Icon::Split,
    Icon::Merge,
    Icon::Search,
    Icon::ChevronLeft,
    Icon::ChevronRight,
    Icon::ChevronDown,
    Icon::Expand,
    Icon::Restore,
    Icon::Columns,
    Icon::Edit,
    Icon::Swap,
    Icon::Wrench,
    Icon::Clone,
    Icon::Archive,
    Icon::Download,
];

impl Icon {
    /// Returns the raw unmodified upstream SVG string embedded at compile time.
    pub const fn raw_svg(self) -> &'static str {
        match self {
            Icon::Monitor => include_str!("../assets/lucide/monitor.svg"),
            Icon::Server => include_str!("../assets/lucide/server.svg"),
            Icon::Applications => include_str!("../assets/lucide/app-window.svg"),
            Icon::Users => include_str!("../assets/lucide/users.svg"),
            Icon::Racks => include_str!("../assets/lucide/hard-drive.svg"),
            Icon::Network => include_str!("../assets/lucide/network.svg"),
            Icon::WorkOrders => include_str!("../assets/lucide/clipboard-list.svg"),
            Icon::Close => include_str!("../assets/lucide/x.svg"),
            Icon::Plus => include_str!("../assets/lucide/plus.svg"),
            Icon::Split => include_str!("../assets/lucide/columns-2.svg"),
            Icon::Merge => include_str!("../assets/lucide/panel-left-close.svg"),
            Icon::Search => include_str!("../assets/lucide/search.svg"),
            Icon::ChevronLeft => include_str!("../assets/lucide/chevron-left.svg"),
            Icon::ChevronRight => include_str!("../assets/lucide/chevron-right.svg"),
            Icon::ChevronDown => include_str!("../assets/lucide/chevron-down.svg"),
            Icon::Expand => include_str!("../assets/lucide/maximize-2.svg"),
            Icon::Restore => include_str!("../assets/lucide/minimize-2.svg"),
            Icon::Columns => include_str!("../assets/lucide/columns-2.svg"),
            Icon::Edit => include_str!("../assets/lucide/pencil.svg"),
            Icon::Swap => include_str!("../assets/lucide/arrow-left-right.svg"),
            Icon::Wrench => include_str!("../assets/lucide/wrench.svg"),
            Icon::Clone => include_str!("../assets/lucide/copy.svg"),
            Icon::Archive => include_str!("../assets/lucide/archive.svg"),
            Icon::Download => include_str!("../assets/lucide/download.svg"),
        }
    }

    /// Descriptive identifier for debugging and error messages.
    pub const fn name(self) -> &'static str {
        match self {
            Icon::Monitor => "monitor",
            Icon::Server => "server",
            Icon::Applications => "applications",
            Icon::Users => "users",
            Icon::Racks => "racks",
            Icon::Network => "network",
            Icon::WorkOrders => "work-orders",
            Icon::Close => "close",
            Icon::Plus => "plus",
            Icon::Split => "split",
            Icon::Merge => "merge",
            Icon::Search => "search",
            Icon::ChevronLeft => "chevron-left",
            Icon::ChevronRight => "chevron-right",
            Icon::ChevronDown => "chevron-down",
            Icon::Expand => "expand",
            Icon::Restore => "restore",
            Icon::Columns => "columns",
            Icon::Edit => "edit",
            Icon::Swap => "swap",
            Icon::Wrench => "wrench",
            Icon::Clone => "clone",
            Icon::Archive => "archive",
            Icon::Download => "download",
        }
    }
}

/// Official CMDB product logo with 4 vector paths.
const PRODUCT_LOGO_SVG: &str = include_str!("../assets/product-logo.svg");

static ICON_CACHE: LazyLock<[Arc<Image>; ICON_COUNT]> = LazyLock::new(|| {
    ALL_ICONS.map(|icon| decode_svg(icon.raw_svg(), icon.name(), 0, 0))
});

static LOGO_IMAGE: LazyLock<Arc<Image>> = LazyLock::new(|| {
    decode_svg(PRODUCT_LOGO_SVG, "product-logo", 0, 0)
});

/// Decodes an SVG string with `currentColor` replaced by `ICON_COLOR`.
///
/// Returns an `Arc<Image>`. If decode fails, panics explicitly with the asset name
/// so errors are immediately surfaced at startup instead of producing silent blank elements.
fn decode_svg(svg_src: &str, name: &str, max_w: u32, max_h: u32) -> Arc<Image> {
    let prepared = svg_src.replace("currentColor", ICON_COLOR);
    let bytes = prepared.as_bytes();
    match Image::decode(bytes, max_w, max_h) {
        Some(image) => Arc::new(image),
        None => panic!(
            "Failed to decode SVG icon '{name}': blenderui::paint::Image::decode returned None for {} bytes",
            bytes.len()
        ),
    }
}

/// Obtains the cached `Arc<Image>` for a given Lucide icon.
pub fn cached_image(icon: Icon) -> &'static Arc<Image> {
    &ICON_CACHE[icon as usize]
}

/// Obtains the cached `Arc<Image>` for the CMDB product logo.
pub fn cached_logo() -> &'static Arc<Image> {
    &LOGO_IMAGE
}

/// Eagerly pre-warms all icon and logo decodes.
///
/// Can be invoked at application startup to verify asset integrity early.
pub fn init_cache() {
    let _ = &*ICON_CACHE;
    let _ = &*LOGO_IMAGE;
}

/// Renders a 16px Lucide icon element styled with `.ui-icon`, `inline-block`, and `flex-shrink: 0`.
pub fn icon(icon: Icon) -> Div {
    let image = cached_image(icon);
    img()
        .image(Arc::clone(image))
        .class("ui-icon")
        .style("width: 16px; height: 16px; display: inline-block; flex-shrink: 0;")
        .inline_block()
        .flex_shrink_0()
}

/// Maps each CMDB navigation page to its corresponding 16px Lucide icon.
pub fn page_icon(page: cmdb_engine::Page) -> Div {
    match page {
        cmdb_engine::Page::Terminal => icon(Icon::Monitor),
        cmdb_engine::Page::Infrastructure => icon(Icon::Server),
        cmdb_engine::Page::Applications => icon(Icon::Applications),
        cmdb_engine::Page::Organization => icon(Icon::Users),
        cmdb_engine::Page::Racks => icon(Icon::Racks),
        cmdb_engine::Page::Network => icon(Icon::Network),
        cmdb_engine::Page::WorkOrders => icon(Icon::WorkOrders),
    }
}

/// Renders the 22px CMDB product logo (4-path vector silhouette) with `.ui-icon` and `.ui-logo`.
pub fn logo() -> Div {
    let image = cached_logo();
    img()
        .image(Arc::clone(image))
        .class("ui-icon ui-logo")
        .style("width: 22px; height: 22px; display: inline-block; flex-shrink: 0;")
        .inline_block()
        .flex_shrink_0()
}
