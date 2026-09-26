//! `/_ui/fragments/*` — server-rendered result markup the inline page
//! scripts swap into the page after calling the JSON API, so the view
//! logic (`th_core::ui_view`) and all legal wording stay in Rust.

use crate::query::Query;
use crate::ui::components;
use axum::body::Bytes;
use axum::extract::{Path, RawQuery};
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};
use serde_json::Value;
use th_core::schemas::get_schema;
use th_core::seed_cases::search as seed_search;

fn html(markup: maud::Markup) -> Response {
    Html(markup.into_string()).into_response()
}

/// `POST { results, timeline }` → `<AnalysisResultsPanel />`.
pub async fn analysis_results(body: Bytes) -> Response {
    let Ok(v) = serde_json::from_slice::<Value>(&body) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let results = v.get("results").cloned().unwrap_or(Value::Null);
    let timeline = v.get("timeline").cloned().unwrap_or(Value::Null);
    html(components::analysis_results_panel(&results, &timeline))
}

/// `POST <debate response>` → `<DebateResults />`.
pub async fn debate_results(body: Bytes) -> Response {
    let Ok(v) = serde_json::from_slice::<Value>(&body) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    html(components::debate_results(&v))
}

/// `GET /_ui/fragments/schema/{claim_type}` → the schema display card body.
pub async fn schema_display(Path(claim_type): Path<String>) -> Response {
    match get_schema(&claim_type) {
        Some(schema) => html(components::schema_display(schema)),
        None => html(components::schema_empty_state()),
    }
}

/// `GET /_ui/fragments/case-law-results?q=&claim_type=&limit=` → results list.
pub async fn case_law_results(RawQuery(raw): RawQuery) -> Response {
    let q = Query::parse(raw.as_deref());
    let outcome = seed_search(q.get("q"), q.get("claim_type"), q.get("tier"), q.get("limit"));
    html(components::case_law_results(&outcome))
}
