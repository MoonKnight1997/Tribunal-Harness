//! `POST /api/request-access` — interest-capture form: validate, append to
//! `data/access-requests.jsonl`, optionally notify via Resend.

use super::{error_json, json_response, parse_json_body};
use crate::jsval::{substring_to, template, truthy};
use crate::state::SharedState;
use axum::body::Bytes;
use axum::extract::State;
use axum::response::Response;
use regex::Regex;
use serde_json::{json, Value};
use std::sync::LazyLock;
use th_core::dates::iso_datetime_from_epoch_ms;
use th_services::request_access::{persist_request, send_email_notification};

static EMAIL_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").unwrap());
const VALID_TYPES: [&str; 5] = ["lip", "solicitor", "legal_aid", "researcher", "other"];

fn caught(details: impl Into<String>) -> Response {
    json_response(500, json!({ "error": "Internal server error", "details": details.into() }))
}

pub async fn post_request_access(State(state): State<SharedState>, body: Bytes) -> Response {
    let body = match parse_json_body(&body) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("[RequestAccess] Failed to parse request body: {e}");
            return error_json(400, "Invalid request payload");
        }
    };
    if body.is_null() {
        return caught("TypeError: Cannot destructure property 'name' of 'body' as it is null.");
    }
    let (name, email, user_type, description) = (body.get("name"), body.get("email"), body.get("user_type"), body.get("description"));

    if !truthy(name) || !truthy(email) || !truthy(user_type) {
        return error_json(400, "name, email, and user_type are required");
    }
    if !EMAIL_RE.is_match(&template(email.unwrap())) {
        return error_json(400, "Invalid email format");
    }
    if !user_type.and_then(Value::as_str).map(|t| VALID_TYPES.contains(&t)).unwrap_or(false) {
        return error_json(400, format!("user_type must be one of: {}", VALID_TYPES.join(", ")));
    }
    // `description?.substring(0, 500) ?? ""`
    let description = match description {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => substring_to(s, 500),
        Some(_) => return caught("TypeError: description?.substring is not a function"),
    };
    let record = json!({
        "name": name.unwrap(),
        "email": email.unwrap(),
        "user_type": user_type.unwrap(),
        "description": description,
        "timestamp": iso_datetime_from_epoch_ms(state.now_ms()),
    });

    persist_request(&state.config.data_dir, &record);
    send_email_notification(state.http.as_ref(), state.config.resend_api_key.as_deref(), state.config.notify_email.as_deref(), &record).await;

    // F-18: never log PII — only non-identifying metadata.
    tracing::info!("[Request Access] Persisted lead: user_type={} timestamp={}", template(user_type.unwrap()), record["timestamp"].as_str().unwrap_or(""));

    json_response(200, json!({ "success": true, "message": "Thank you for your interest. We will be in touch when Tribunal Harness launches." }))
}
