//! Lead capture persistence + optional Resend notification — port of the
//! non-HTTP parts of `src/app/api/request-access/route.ts`.

use crate::http::{HttpClient, HttpRequest};
use serde_json::{json, Value};
use std::io::Write;
use std::path::Path;

/// Append one JSON line to `<data_dir>/access-requests.jsonl`, creating the
/// directory. Failures are logged, never surfaced (F-19: ephemeral store).
pub fn persist_request(data_dir: &Path, record: &Value) {
    let path = data_dir.join("access-requests.jsonl");
    let result = std::fs::create_dir_all(data_dir).and_then(|_| {
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
        f.write_all(format!("{}\n", serde_json::to_string(record)?).as_bytes())
    });
    if let Err(e) = result {
        tracing::error!("[Request Access] Failed to persist to file: {e}");
    }
}

/// Send the notification email via Resend when configured; skipped silently
/// without `RESEND_API_KEY`, warned when `NOTIFY_EMAIL` is missing.
pub async fn send_email_notification(http: &dyn HttpClient, api_key: Option<&str>, notify_email: Option<&str>, record: &Value) {
    let Some(api_key) = api_key.filter(|k| !k.is_empty()) else { return };
    let Some(to) = notify_email.filter(|e| !e.is_empty()) else {
        tracing::warn!("[Request Access] RESEND_API_KEY is set, but NOTIFY_EMAIL is missing. Email notification skipped.");
        return;
    };
    let s = |k: &str| record.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let description = match record.get("description").and_then(Value::as_str) {
        Some(d) if !d.is_empty() => d.to_string(),
        _ => "(none)".to_string(),
    };
    let text = [
        "New access request received:".to_string(),
        format!("Name: {}", s("name")),
        format!("Email: {}", s("email")),
        format!("Type: {}", s("user_type")),
        format!("Description: {description}"),
        format!("Timestamp: {}", s("timestamp")),
    ]
    .join("\n");
    let body = json!({
        "from": "Tribunal Harness <noreply@tribunalharness.co.uk>",
        "to": [to],
        "subject": format!("New Access Request — {} — {}", s("user_type"), s("name")),
        "text": text,
    });
    let req = HttpRequest::post("https://api.resend.com/emails", serde_json::to_vec(&body).unwrap_or_default())
        .header("Authorization", &format!("Bearer {api_key}"))
        .header("Content-Type", "application/json");
    if let Err(e) = http.send(req).await {
        tracing::error!("[Request Access] Failed to send email notification: {e}");
    }
}
