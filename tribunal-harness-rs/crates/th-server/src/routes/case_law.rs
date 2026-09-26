//! `GET /api/case-law/search` (curated seed data), `GET /api/case-law/find`
//! (live Find Case Law) and `GET /api/case-law/judgment` (judgment → Markdown).

use super::{error_json, json_response};
use crate::query::Query;
use crate::state::SharedState;
use axum::extract::{RawQuery, State};
use axum::response::Response;
use th_core::jsnum::js_parse_int;
use th_core::seed_cases::{search as seed_search, SearchOutcome};
use th_services::tna::SearchOptions;

pub async fn search(RawQuery(raw): RawQuery) -> Response {
    let q = Query::parse(raw.as_deref());
    match seed_search(q.get("q"), q.get("claim_type"), q.get("tier"), q.get("limit")) {
        SearchOutcome::BadRequest(body) => json_response(400, body),
        SearchOutcome::Ok(body) => json_response(200, body),
    }
}

pub async fn find(State(state): State<SharedState>, RawQuery(raw): RawQuery) -> Response {
    let params = Query::parse(raw.as_deref());
    // `(get("q") || get("query") || "").trim()`
    let q = params.get("q").filter(|s| !s.is_empty()).or_else(|| params.get("query").filter(|s| !s.is_empty())).unwrap_or("").trim();
    if q.is_empty() {
        return error_json(400, "Query parameter 'q' is required.");
    }
    let court = params.get("court").map(str::trim).filter(|c| !c.is_empty()).map(String::from);
    let limit = match js_parse_int(params.get("limit").filter(|s| !s.is_empty()).unwrap_or("10")) {
        Some(n) => n.clamp(1, 50) as usize,
        None => 10,
    };
    let envelope = state.tna.search_case_law(&SearchOptions { query: q.to_string(), court, limit: Some(limit), ..Default::default() }).await;
    // Always 200 with the structured envelope — `status` carries the distinction.
    json_response(200, serde_json::to_value(envelope).unwrap_or_default())
}

pub async fn judgment(State(state): State<SharedState>, RawQuery(raw): RawQuery) -> Response {
    let params = Query::parse(raw.as_deref());
    let slug = params.get("slug").unwrap_or("").trim();
    if slug.is_empty() {
        return error_json(400, "Query parameter 'slug' is required (e.g. ?slug=eat/2026/90).");
    }
    let result = state.tna.get_judgment_markdown(slug).await;
    json_response(200, serde_json::to_value(result).unwrap_or_default())
}
