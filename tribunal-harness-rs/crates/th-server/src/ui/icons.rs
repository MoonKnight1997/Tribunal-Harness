//! The lucide icons the React components used, as inline SVG (lucide is
//! ISC-licensed; the path data is reproduced here so no icon font or JS
//! bundle is needed).

use maud::{html, Markup, PreEscaped};

pub struct Icon {
    pub name: &'static str,
    pub paths: &'static str,
}

pub const SHIELD_CHECK: Icon = Icon {
    name: "shield-check",
    paths: r#"<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>"#,
};
pub const CIRCLE_ALERT: Icon =
    Icon { name: "circle-alert", paths: r#"<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>"# };
pub const CIRCLE_X: Icon = Icon { name: "circle-x", paths: r#"<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>"# };
pub const LOADER_CIRCLE: Icon = Icon { name: "loader-circle", paths: r#"<path d="M21 12a9 9 0 1 1-6.219-8.56"/>"# };
pub const SCALE: Icon = Icon {
    name: "scale",
    paths: r#"<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>"#,
};
pub const FILE_TEXT: Icon = Icon {
    name: "file-text",
    paths: r#"<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>"#,
};
pub const CALENDAR: Icon = Icon { name: "calendar", paths: r#"<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>"# };
pub const CALENDAR_DAYS: Icon = Icon {
    name: "calendar-days",
    paths: r#"<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>"#,
};
pub const SHIELD_OFF: Icon = Icon {
    name: "shield-off",
    paths: r#"<path d="m2 2 20 20"/><path d="M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71"/><path d="M9.309 3.652A12.252 12.252 0 0 0 11.24 2.28a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7a9.784 9.784 0 0 1-.08 1.264"/>"#,
};
pub const SWORD: Icon = Icon {
    name: "sword",
    paths: r#"<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/>"#,
};
pub const GAVEL: Icon =
    Icon { name: "gavel", paths: r#"<path d="m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/>"# };
pub const CHEVRON_DOWN: Icon = Icon { name: "chevron-down", paths: r#"<path d="m6 9 6 6 6-6"/>"# };
pub const CHEVRON_RIGHT: Icon = Icon { name: "chevron-right", paths: r#"<path d="m9 18 6-6-6-6"/>"# };

/// Render an icon like `<Icon size={n} className="…" style={…} color="…" />`.
pub fn icon(i: &Icon, size: u32, class: &str, style: &str, color: Option<&str>) -> Markup {
    let class_attr = if class.is_empty() { format!("lucide lucide-{}", i.name) } else { format!("lucide lucide-{} {class}", i.name) };
    html! {
        svg xmlns="http://www.w3.org/2000/svg" width=(size) height=(size) viewBox="0 0 24 24" fill="none" stroke=(color.unwrap_or("currentColor")) stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class=(class_attr) style=[if style.is_empty() { None } else { Some(style) }] {
            (PreEscaped(i.paths))
        }
    }
}
