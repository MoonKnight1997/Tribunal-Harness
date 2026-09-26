//! API route handlers — one module per Next.js route file.

use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

pub mod analyse;
pub mod case_law;
pub mod deadlines;
pub mod debate;
pub mod meta;
pub mod request_access;
pub mod roadmap;
pub mod schema;
pub mod tracker;
pub mod triage;
pub mod webhook;

/// `NextResponse.json(body, { status })`.
pub fn json_response(status: u16, body: Value) -> Response {
    (StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(body)).into_response()
}

/// `NextResponse.json({ error }, { status })`.
pub fn error_json(status: u16, message: impl Into<String>) -> Response {
    json_response(status, json!({ "error": message.into() }))
}

/// F-27: a generic 500 carrying only a correlation id; the detail is logged
/// server-side, never sent to the client.
pub fn internal_error(route: &str, detail: impl std::fmt::Display) -> Response {
    let request_id = uuid::Uuid::new_v4().to_string();
    tracing::error!("[API {route}] Error (requestId={request_id}): {detail}");
    json_response(500, json!({ "error": "Internal server error", "request_id": request_id }))
}

/// F-20: the rate-limit key — the trusted proxy hop (last `X-Forwarded-For` entry).
pub fn client_key(headers: &HeaderMap) -> String {
    th_core::rate_limit::client_key_from_xff(headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()))
}

/// `await request.json()`.
pub fn parse_json_body(bytes: &[u8]) -> Result<Value, serde_json::Error> {
    serde_json::from_slice(bytes)
}

/// The `refinement` marker on degraded (no-LLM) responses.
pub fn llm_unavailable_marker() -> Value {
    json!({ "applied": false, "reason": "llm-unavailable" })
}
