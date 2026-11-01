use gpui::{App, AppContext, Bounds, Context, SharedString, Window, WindowBounds, WindowOptions, prelude::*, px, rgb};

struct MainWindow {
    tabs: Vec<TabItem>,
    active_tab: usize,
}

struct TabItem {
    id: String,
    title: SharedString,
}

impl gpui::Render for MainWindow {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .w_full()
            .h_full()
            .bg(rgb(0x1e1e1e))
            .text_color(rgb(0xe0e0e0))
            .child(self.render_titlebar())
            .child(self.render_content())
    }
}

impl MainWindow {
    fn render_titlebar(&self) -> impl IntoElement {
        div()
            .flex()
            .items_center()
            .h(px(40.0))
            .px_3()
            .bg(rgb(0x2d2d2d))
            .border_b_1()
            .border_color(rgb(0x3a3a3a))
            .gap_2()
            .child(div().text("◐ Cmdb").font_bold())
            .child(self.render_tabs())
    }

    fn render_tabs(&self) -> impl IntoElement {
        div()
            .flex()
            .gap_1()
            .child(div().text("+ Default").text_xs())
    }

    fn render_content(&self) -> impl IntoElement {
        div()
            .flex()
            .flex_1()
            .child(
                div()
                    .w_1_4()
                    .h_full()
                    .bg(rgb(0x252525))
                    .border_r_1()
                    .border_color(rgb(0x3a3a3a))
                    .p_3()
                    .child(div().text("资产").font_bold())
            )
            .child(
                div()
                    .flex_1()
                    .h_full()
                    .bg(rgb(0x1e1e1e))
                    .p_4()
                    .child(div().text("工作区"))
            )
    }
}

fn main() {
    App::new().run(|cx: &mut AppContext| {
        let bounds = Bounds::centered(None, gpui::size(px(1200.0), px(720.0)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |_, cx| {
                cx.new(|_| MainWindow {
                    tabs: vec![TabItem {
                        id: "default".into(),
                        title: "Default".into(),
                    }],
                    active_tab: 0,
                })
            },
        )
        .unwrap();
    });
}
