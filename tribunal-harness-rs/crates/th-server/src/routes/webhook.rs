//! `POST /api/webhook` — HMAC-SHA256 signed, timestamp-bound (F-35 replay
//! defence). Phase 4 durable-state integration is not yet wired.

use super::{error_json, json_response};
use crate::state::SharedState;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;

// F-35: max clock skew / replay window either side of "now".
const REPLAY_WINDOW_MS: f64 = 5.0 * 60.0 * 1000.0;

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn verify_signature(signed_payload: &str, signature: &str, secret: &str) -> bool {
    let mut mac = match Hmac::<Sha256>::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(signed_payload.as_bytes());
    let expected = format!("sha256={}", hex::encode(mac.finalize().into_bytes()));
    // `timingSafeEqual` throws on a length mismatch → false.
    constant_time_eq(signature.as_bytes(), expected.as_bytes())
}

/// F-35: `/^\d+$/` then `parseInt(...) * 1000` within ±5 minutes of now.
pub fn is_fresh_timestamp(raw: &str, now_ms: i64) -> bool {
    if raw.is_empty() || !raw.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let ts_ms = raw.parse::<f64>().unwrap_or(f64::NAN) * 1000.0;
    (now_ms as f64 - ts_ms).abs() <= REPLAY_WINDOW_MS
}

pub async fn post_webhook(State(state): State<SharedState>, headers: HeaderMap, body: Bytes) -> Response {
    let Some(secret) = state.config.webhook_secret.as_deref() else {
        return error_json(503, "Webhook endpoint not configured. Set WEBHOOK_SECRET in environment.");
    };
    let raw_body = String::from_utf8_lossy(&body).into_owned();
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let signature = header("x-webhook-signature");
    let timestamp = header("x-webhook-timestamp");

    if !is_fresh_timestamp(&timestamp, state.now_ms()) {
        return error_json(403, "Missing, malformed, or stale X-Webhook-Timestamp (replay protection)");
    }
    if !verify_signature(&format!("{timestamp}.{raw_body}"), &signature, secret) {
        return error_json(403, "Invalid or missing webhook signature");
    }
    let parsed: Value = match serde_json::from_str(&raw_body) {
        Ok(v) => v,
        Err(_) => return error_json(400, "Invalid JSON payload"),
    };
    let event = parsed.get("event").filter(|e| crate::jsval::truthy(Some(e))).map(crate::jsval::template).unwrap_or_else(|| "unknown".to_string());
    tracing::info!(
        "[Webhook Received] event={event} timestamp={} payload={}",
        th_core::dates::iso_datetime_from_epoch_ms(state.now_ms()),
        crate::jsval::substring_to(&raw_body, 500)
    );
    json_response(
        200,
        json!({
            "status": "acknowledged",
            "phase": 4,
            "message": "Webhook received and verified. Durable state machine integration available in Phase 4.",
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_and_timestamp_rules() {
        assert!(is_fresh_timestamp("1000", 1_000_000 + 300_000));
        assert!(!is_fresh_timestamp("1000", 1_000_000 + 300_001));
        assert!(!is_fresh_timestamp("", 0));
        assert!(!is_fresh_timestamp("12a", 0));
        let sig = {
            let mut mac = Hmac::<Sha256>::new_from_slice(b"s").unwrap();
            mac.update(b"1.{}");
            format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
        };
        assert!(verify_signature("1.{}", &sig, "s"));
        assert!(!verify_signature("1.{}", "sha256=ab", "s"));
        assert!(!verify_signature("1.{}", &sig, "other"));
    }
}
