//! `/sitemap.xml`, `/robots.txt`, the three legacy-path redirects and the
//! 404 fallback.

use crate::state::SharedState;
use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use serde_json::{json, Value};
use th_core::dates::iso_datetime_from_epoch_ms;
use th_core::jsnum::js_number;

pub const SITE_BASE: &str = "https://tribunalharness.co.uk";

/// Port of `src/app/sitemap.ts` (17 public routes).
pub const SITEMAP_ROUTES: [(&str, f64, &str); 17] = [
    ("/", 1.0, "weekly"),
    ("/how-it-works", 0.9, "monthly"),
    ("/analysis-engine", 0.9, "weekly"),
    ("/pricing", 0.8, "monthly"),
    ("/about", 0.7, "monthly"),
    ("/era-2025", 0.9, "weekly"),
    ("/case-law-db", 0.8, "weekly"),
    ("/documentation", 0.8, "monthly"),
    ("/methodology", 0.7, "monthly"),
    ("/security", 0.6, "monthly"),
    ("/ethics", 0.6, "monthly"),
    ("/blog", 0.7, "weekly"),
    ("/product", 0.7, "monthly"),
    ("/contact", 0.5, "yearly"),
    ("/privacy", 0.4, "yearly"),
    ("/terms", 0.4, "yearly"),
    ("/request-access", 0.8, "monthly"),
];

/// The `MetadataRoute.Sitemap` entries (as JSON, `lastModified` as ISO).
pub fn sitemap_entries(now_ms: i64) -> Vec<Value> {
    let now = iso_datetime_from_epoch_ms(now_ms);
    SITEMAP_ROUTES
        .iter()
        .map(|(url, priority, freq)| json!({ "url": format!("{SITE_BASE}{url}"), "lastModified": now, "changeFrequency": freq, "priority": js_number(*priority) }))
        .collect()
}

/// The XML Next.js renders for a `sitemap.ts` route.
pub fn sitemap_xml(now_ms: i64) -> String {
    let now = iso_datetime_from_epoch_ms(now_ms);
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");
    for (url, priority, freq) in SITEMAP_ROUTES.iter() {
        out.push_str(&format!(
            "<url>\n<loc>{SITE_BASE}{url}</loc>\n<lastmod>{now}</lastmod>\n<changefreq>{freq}</changefreq>\n<priority>{}</priority>\n</url>\n",
            th_core::jsnum::js_number_to_string(&serde_json::Number::from_f64(*priority).unwrap())
        ));
    }
    out.push_str("</urlset>\n");
    out
}

pub async fn get_sitemap(State(state): State<SharedState>) -> Response {
    ([(header::CONTENT_TYPE, "application/xml")], sitemap_xml(state.now_ms())).into_response()
}

pub const ROBOTS_TXT: &str = "User-agent: *\nAllow: /\n\nSitemap: https://tribunalharness.co.uk/sitemap.xml\n";

pub async fn get_robots() -> Response {
    ([(header::CONTENT_TYPE, "text/plain; charset=utf-8")], ROBOTS_TXT).into_response()
}

/// `redirect()` from a server component during a GET → 307.
pub fn temporary_redirect(to: &'static str) -> Redirect {
    Redirect::temporary(to)
}

pub async fn not_found() -> Response {
    (StatusCode::NOT_FOUND, crate::ui::not_found_page()).into_response()
}
