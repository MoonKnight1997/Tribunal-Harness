//! `POST /api/deadlines` — ET claim deadlines under the correct regime.

use super::{error_json, json_response, parse_json_body};
use crate::jsval::{template, truthy};
use crate::state::SharedState;
use axum::body::Bytes;
use axum::extract::State;
use axum::response::Response;
use serde_json::{json, Value};
use th_core::dates::CivilDate;
use th_core::deadlines::calculate_deadlines;

// F-10: accept only a real YYYY-MM-DD calendar date within a sane range.
const MIN_YEAR: i32 = 1990;
const MAX_YEAR: i32 = 2100;

/// `isValidCalendarDate` — shape, year range and calendar validity.
fn valid_calendar_date(v: &Value) -> Option<&str> {
    let s = v.as_str()?;
    let (y, m, d) = split_iso(s)?;
    if !(MIN_YEAR..=MAX_YEAR).contains(&y) {
        return None;
    }
    if CivilDate::new(y, m, d).is_valid() {
        Some(s)
    } else {
        None
    }
}

/// `/^\d{4}-\d{2}-\d{2}$/` then `split("-").map(Number)`.
pub fn split_iso(s: &str) -> Option<(i32, u32, u32)> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    if b.iter().enumerate().any(|(i, c)| i != 4 && i != 7 && !c.is_ascii_digit()) {
        return None;
    }
    Some((s[0..4].parse().ok()?, s[5..7].parse().ok()?, s[8..10].parse().ok()?))
}

fn server_error(detail: impl std::fmt::Display) -> Response {
    let request_id = uuid::Uuid::new_v4().to_string();
    tracing::error!("[deadlines] {request_id} {detail}");
    json_response(500, json!({ "error": "Internal server error while calculating deadlines.", "request_id": request_id }))
}

pub async fn post_deadlines(State(state): State<SharedState>, body: Bytes) -> Response {
    let body = match parse_json_body(&body) {
        Ok(v) => v,
        Err(e) => return server_error(e),
    };
    if body.is_null() {
        // `body.effective_date_of_termination` on null throws → 500.
        return server_error("TypeError: Cannot read properties of null");
    }
    let field = |k: &str| body.get(k);

    // Determine the relevant date (`a || b`).
    let date_of_act = if truthy(field("effective_date_of_termination")) {
        field("effective_date_of_termination")
    } else if truthy(field("date_of_last_act")) {
        field("date_of_last_act")
    } else {
        None
    };
    let Some(date_of_act) = date_of_act else {
        return error_json(400, "Either effective_date_of_termination or date_of_last_act is required");
    };
    let Some(date_str) = valid_calendar_date(date_of_act) else {
        return error_json(
            400,
            format!(
                "The date of the act must be a real calendar date in YYYY-MM-DD format between {MIN_YEAR} and {MAX_YEAR} (received: {}).",
                serde_json::to_string(date_of_act).unwrap_or_default()
            ),
        );
    };

    // `!body.claim_types || body.claim_types.length === 0`
    let claim_types: Vec<String> = match field("claim_types") {
        v if !truthy(v) => return error_json(400, "At least one claim_type is required"),
        Some(Value::Array(items)) => {
            if items.is_empty() {
                return error_json(400, "At least one claim_type is required");
            }
            items.iter().map(template).collect()
        }
        // `for (const claimType of "string")` iterates code points.
        Some(Value::String(s)) => s.chars().map(|c| c.to_string()).collect(),
        // A number/object/boolean passes the length check and then throws in
        // `for..of` → 500.
        _ => return server_error("TypeError: claim_types is not iterable"),
    };

    // F-10 / F-14: ACAS dates — both or neither, real dates, Day B ≥ Day A.
    let day_a = field("acas_day_a");
    let day_b = field("acas_day_b");
    let (a_truthy, b_truthy) = (truthy(day_a), truthy(day_b));
    if (a_truthy && !b_truthy) || (b_truthy && !a_truthy) {
        return error_json(400, "Both acas_day_a (EC notification) and acas_day_b (certificate) must be provided together, or neither.");
    }
    let (mut acas_a, mut acas_b) = (None, None);
    if a_truthy && b_truthy {
        let (a, b) = (day_a.unwrap(), day_b.unwrap());
        let Some(a_str) = valid_calendar_date(a) else {
            return error_json(
                400,
                format!("acas_day_a must be a real calendar date in YYYY-MM-DD format between {MIN_YEAR} and {MAX_YEAR} (received: {}).", serde_json::to_string(a).unwrap_or_default()),
            );
        };
        let Some(b_str) = valid_calendar_date(b) else {
            return error_json(
                400,
                format!("acas_day_b must be a real calendar date in YYYY-MM-DD format between {MIN_YEAR} and {MAX_YEAR} (received: {}).", serde_json::to_string(b).unwrap_or_default()),
            );
        };
        if b_str < a_str {
            return error_json(400, "acas_day_b (certificate date) must be on or after acas_day_a (notification date).");
        }
        acas_a = Some(a_str);
        acas_b = Some(b_str);
    }

    match calculate_deadlines(&state.config.time_limit, &state.today(), date_str, &claim_types, acas_a, acas_b) {
        Ok(result) => json_response(200, serde_json::to_value(result).unwrap_or_default()),
        Err(e) => server_error(e),
    }
}
