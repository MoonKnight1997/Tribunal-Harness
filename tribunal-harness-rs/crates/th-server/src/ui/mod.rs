//! Server-rendered UI (maud) — a port of the Next.js `src/app/**` pages,
//! `components/layout/{NavBar,Footer}.tsx`, the `ui/` primitives and the
//! analysis / debate result panels. Interactive pages use small inline
//! scripts that call the same `/api/*` routes the React pages called and
//! then ask `/_ui/fragments/*` for the server-rendered result markup, so
//! every piece of legal wording lives in Rust.

pub mod components;
pub mod fragments;
pub mod icons;
pub mod layout;
pub mod pages;
pub mod scripts;

use crate::state::SharedState;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;

pub use layout::not_found_page;

const APP_CSS: &str = include_str!("../../static/app.css");
const FONTS_CSS: &str = include_str!("../../static/fonts.css");

async fn app_css() -> Response {
    ([(header::CONTENT_TYPE, "text/css; charset=utf-8"), (header::CACHE_CONTROL, "public, max-age=3600")], APP_CSS).into_response()
}

async fn fonts_css() -> Response {
    ([(header::CONTENT_TYPE, "text/css; charset=utf-8"), (header::CACHE_CONTROL, "public, max-age=3600")], FONTS_CSS).into_response()
}

async fn font_file(axum::extract::Path(file): axum::extract::Path<String>) -> Response {
    let bytes: Option<&'static [u8]> = match file.as_str() {
        "firacode-normal-300_700.woff2" => Some(include_bytes!("../../static/fonts/firacode-normal-300_700.woff2")),
        "outfit-normal-300_600.woff2" => Some(include_bytes!("../../static/fonts/outfit-normal-300_600.woff2")),
        "playfairdisplay-italic-400_700.woff2" => Some(include_bytes!("../../static/fonts/playfairdisplay-italic-400_700.woff2")),
        "playfairdisplay-normal-400_700.woff2" => Some(include_bytes!("../../static/fonts/playfairdisplay-normal-400_700.woff2")),
        _ => None,
    };
    match bytes {
        Some(b) => ([(header::CONTENT_TYPE, "font/woff2"), (header::CACHE_CONTROL, "public, max-age=31536000, immutable")], b).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

pub fn pages_router() -> Router<SharedState> {
    Router::new()
        .route("/", get(pages::home::page))
        .route("/adversarial-debate", get(pages::adversarial_debate::page))
        .route("/analysis-engine", get(pages::analysis_engine::page))
        .route("/case-law-db", get(pages::case_law_db::page))
        .route("/schema-builder", get(pages::schema_builder::page))
        .route("/request-access", get(pages::request_access::page))
        .route("/era-2025", get(pages::legal::era_2025))
        .route("/about", get(pages::institutional::about))
        .route("/blog", get(pages::institutional::blog))
        .route("/contact", get(pages::institutional::contact))
        .route("/documentation", get(pages::institutional::documentation))
        .route("/how-it-works", get(pages::institutional::how_it_works))
        .route("/pricing", get(pages::institutional::pricing))
        .route("/ethics", get(pages::legal::ethics))
        .route("/methodology", get(pages::legal::methodology))
        .route("/privacy", get(pages::legal::privacy))
        .route("/product", get(pages::legal::product))
        .route("/security", get(pages::legal::security))
        .route("/terms", get(pages::legal::terms))
        .route("/static/app.css", get(app_css))
        .route("/static/fonts.css", get(fonts_css))
        .route("/static/fonts/{file}", get(font_file))
        .route("/_ui/fragments/analysis-results", post(fragments::analysis_results))
        .route("/_ui/fragments/debate-results", post(fragments::debate_results))
        .route("/_ui/fragments/schema/{claim_type}", get(fragments::schema_display))
        .route("/_ui/fragments/case-law-results", get(fragments::case_law_results))
}
