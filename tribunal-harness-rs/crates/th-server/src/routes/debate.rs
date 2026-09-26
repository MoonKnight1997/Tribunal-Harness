//! `POST /api/debate` — the adversarial Drafter → Critic → Judge engine.

use super::{client_key, error_json, internal_error, json_response, parse_json_body};
use crate::jsval::{template, truthy, utf16_len};
use crate::state::SharedState;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;
use serde_json::Value;
use th_core::ui_view::debate_modes::DebateMode;
use th_services::debate::{run_debate, DebateError, MAX_FACTS_LENGTH};

pub async fn post_debate(State(state): State<SharedState>, headers: HeaderMap, body: Bytes) -> Response {
    let start = state.now_ms();
    // F-8: rate limit before doing any work (separate bucket from /api/analyse).
    let key = client_key(&headers);
    if !state.debate_limiter.check(&key, start) {
        tracing::warn!("[API /api/debate] Rate limit exceeded for key: {key}");
        return error_json(429, "Rate limit exceeded. Please try again later.");
    }

    let body = match parse_json_body(&body) {
        Ok(v) => v,
        Err(e) => return internal_error("/api/debate", e),
    };
    if body.is_null() {
        return internal_error("/api/debate", "TypeError: Cannot destructure 'body' as it is null.");
    }
    let facts = body.get("facts");
    let claim_type = body.get("claim_type");
    if !truthy(facts) || !truthy(claim_type) {
        return error_json(400, "facts and claim_type are required");
    }
    // F-8: cap the free-text facts length.
    if let Some(Value::String(f)) = facts {
        if utf16_len(f) > MAX_FACTS_LENGTH {
            return error_json(400, format!("facts exceeds the maximum length of {MAX_FACTS_LENGTH} characters"));
        }
    }
    // F-29: user-selectable debate mode; default single_pass; anything else → 400.
    let mode = match body.get("mode") {
        None => DebateMode::SinglePass,
        Some(Value::String(s)) => match DebateMode::parse(s) {
            Some(m) => m,
            None => return error_json(400, "mode must be 'single_pass' or 'adversarial'"),
        },
        Some(_) => return error_json(400, "mode must be 'single_pass' or 'adversarial'"),
    };
    if !state.llm.is_client_available() {
        return error_json(500, "ANTHROPIC_API_KEY not configured");
    }

    let facts_text = template(facts.unwrap());
    let claim_type_text = template(claim_type.unwrap());
    let clock = state.clock.clone();
    match run_debate(&state.llm, &state.tna, &facts_text, &claim_type_text, mode, state.is_dev(), start, move || clock.now_epoch_ms()).await {
        Ok(outcome) => json_response(200, outcome.body),
        Err(e @ DebateError::AgentFailed(_)) => error_json(500, e.to_string()),
        Err(DebateError::Claude(e)) => internal_error("/api/debate", e),
    }
}
