//! `GET /api/roadmap/[caseId]` (static 16-stage template) and
//! `POST /api/roadmap` (timeline from a date of last act).

use super::{error_json, internal_error, json_response, parse_json_body};
use crate::jsval::{template, truthy};
use crate::routes::deadlines::split_iso;
use crate::state::SharedState;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::response::Response;
use serde_json::Value;
use th_core::dates::CivilDate;
use th_core::roadmap::{roadmap_for_case, timeline};

pub async fn get_roadmap(Path(case_id): Path<String>) -> Response {
    json_response(200, roadmap_for_case(&case_id))
}

/// `isValidISODate` — shape plus a `Date.UTC` round trip (years 0–99 fail the
/// round trip because `Date.UTC` maps them to 1900–1999).
fn valid_iso_date(v: &Value) -> Option<&str> {
    let s = v.as_str()?;
    let (y, m, d) = split_iso(s)?;
    if y < 100 || !CivilDate::new(y, m, d).is_valid() {
        return None;
    }
    Some(s)
}

pub async fn post_roadmap(State(state): State<SharedState>, body: Bytes) -> Response {
    let body = match parse_json_body(&body) {
        Ok(v) => v,
        Err(e) => return internal_error("/api/roadmap", e),
    };
    if body.is_null() {
        return internal_error("/api/roadmap", "TypeError: Cannot destructure 'body' as it is null.");
    }
    let date = body.get("dateOfLastAct");
    if !truthy(date) {
        return error_json(400, "dateOfLastAct is required");
    }
    let Some(date_str) = date.and_then(valid_iso_date) else {
        return error_json(400, "dateOfLastAct must be a valid date in YYYY-MM-DD format");
    };
    let claim_type = body.get("claimType").filter(|v| truthy(Some(v))).map(template);
    match timeline(&state.config.time_limit, &state.today(), state.now_ms(), date_str, claim_type.as_deref()) {
        Ok(stages) => json_response(200, stages),
        Err(e) => internal_error("/api/roadmap", e),
    }
}
