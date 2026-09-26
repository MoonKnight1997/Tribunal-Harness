//! The Axum router — identical routes to the Next.js app.

use crate::routes::{analyse, case_law, deadlines, debate, meta, request_access, roadmap, schema, tracker, triage, webhook};
use crate::state::SharedState;
use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::Router;

/// Uploads are capped at 10 MB by `/api/triage` itself; the transport limit
/// only needs to let the oversize case through so it can be rejected with 413.
const BODY_LIMIT_BYTES: usize = 64 * 1024 * 1024;

pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/analyse", post(analyse::post_analyse))
        .route("/api/triage", post(triage::post_triage))
        .route("/api/deadlines", post(deadlines::post_deadlines))
        .route("/api/schema", get(schema::get_schema_empty))
        .route("/api/schema/", get(schema::get_schema_empty))
        .route("/api/schema/{claim_type}", get(schema::get_schema_route))
        .route("/api/case-law/search", get(case_law::search))
        .route("/api/case-law/find", get(case_law::find))
        .route("/api/case-law/judgment", get(case_law::judgment))
        .route("/api/era-2025/tracker", get(tracker::get_tracker))
        .route("/api/request-access", post(request_access::post_request_access))
        .route("/api/roadmap", post(roadmap::post_roadmap))
        .route("/api/roadmap/{case_id}", get(roadmap::get_roadmap))
        .route("/api/webhook", post(webhook::post_webhook))
        .route("/api/debate", post(debate::post_debate))
        .route("/sitemap.xml", get(meta::get_sitemap))
        .route("/robots.txt", get(meta::get_robots))
        .route("/analysis", get(|| async { meta::temporary_redirect("/analysis-engine") }))
        .route("/case-law", get(|| async { meta::temporary_redirect("/case-law-db") }))
        .route("/docs", get(|| async { meta::temporary_redirect("/documentation") }))
        .merge(crate::ui::pages_router())
        .fallback(meta::not_found)
        .layer(DefaultBodyLimit::max(BODY_LIMIT_BYTES))
        .with_state(state)
}
