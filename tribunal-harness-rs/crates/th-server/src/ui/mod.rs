//! Server-rendered UI (maud). Pages are ported from the Next.js `src/app/**`
//! tree; this module is filled in by `pages/`.

use crate::state::SharedState;
use axum::Router;
use maud::{html, Markup, DOCTYPE};

/// Next's default not-found document.
pub fn not_found_page() -> Markup {
    html! {
        (DOCTYPE)
        html lang="en" {
            head {
                meta charset="utf-8";
                meta name="viewport" content="width=device-width, initial-scale=1";
                title { "404: This page could not be found." }
                title { "Tribunal Harness | Structured Legal Analysis" }
            }
            body style="font-family:system-ui,sans-serif;background:#000;color:#fff;height:100vh;display:flex;align-items:center;justify-content:center;margin:0" {
                div style="display:flex;align-items:center;gap:20px" {
                    h1 style="font-size:24px;font-weight:500;margin:0;padding-right:23px;border-right:1px solid rgba(255,255,255,.3)" { "404" }
                    h2 style="font-size:14px;font-weight:400;margin:0" { "This page could not be found." }
                }
            }
        }
    }
}

pub fn pages_router() -> Router<SharedState> {
    Router::new()
}
