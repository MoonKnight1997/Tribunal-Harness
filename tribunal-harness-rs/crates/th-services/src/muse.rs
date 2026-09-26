//! Meta Model API — Responses API client for **Muse Spark** (`muse-spark-1.3`).
//!
//! `POST {base_url}/responses` with bearer-token auth. The request is built
//! from the same per-endpoint configuration the Anthropic path uses
//! (`th_core::claude_config`), mapped as follows:
//!
//! | Tribunal Harness config           | Responses API field                                |
//! |-----------------------------------|----------------------------------------------------|
//! | system prompt                     | `instructions` (developer-level, resent every call) |
//! | user message                      | `input[0]` — a `user` message with one `input_text` |
//! | `max_tokens`                      | `max_output_tokens` (reasoning + visible output)     |
//! | `effort` / `thinking`             | `reasoning.effort` (see [`reasoning_effort`])        |
//! | `temperature`                     | omitted unless explicitly enabled (Muse Spark is tuned for the defaults) |
//! | —                                 | `store: false` — nothing is retained server-side     |
//! | —                                 | `stream: true` — long generations are exempt from the non-streaming 504 limit |
//!
//! The stream is consumed in full and the terminal event
//! (`response.completed` / `response.incomplete` / `response.failed`) carries
//! the complete response object, so streamed and non-streamed replies are
//! parsed by the same code. Reasoning is never surfaced as text by Muse Spark;
//! only `message` items with `output_text` blocks are read.
//!
//! Design note: the docs site (dev.meta.ai) is unreachable from the build
//! sandbox, so this module was written against the Responses API reference
//! supplied by the founder. Anything not covered by it is behind an
//! environment variable (base URL, model id, streaming, temperature) rather
//! than assumed. See DECISIONS.md.

use crate::http::{HttpClient, HttpError, HttpRequest};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use th_core::claude_config::{EffortLevel, EndpointConfig};

pub const DEFAULT_BASE_URL: &str = "https://api.meta.ai/v1";
pub const DEFAULT_MODEL: &str = "muse-spark-1.3";

/// Transient statuses retried with a short back-off (as the OpenAI SDK does).
const RETRY_STATUSES: [u16; 5] = [429, 500, 502, 503, 504];
const MAX_RETRIES: u32 = 2;

/// Settings for the Model API provider (`LLM_PROVIDER=muse`).
#[derive(Debug, Clone)]
pub struct MuseConfig {
    /// `MODEL_API_KEY`
    pub api_key: String,
    /// `MODEL_API_BASE_URL` (default [`DEFAULT_BASE_URL`]).
    pub base_url: String,
    /// `MODEL_API_MODEL` (default [`DEFAULT_MODEL`]).
    pub model: String,
    /// `MODEL_API_STREAM` (default `true`): request an SSE stream.
    pub stream: bool,
    /// `MODEL_API_USE_CONFIGURED_TEMPERATURE=1`: send the per-endpoint
    /// temperature from `claude_config` instead of the model default.
    pub use_configured_temperature: bool,
}

impl MuseConfig {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self { api_key: api_key.into(), base_url: DEFAULT_BASE_URL.to_string(), model: DEFAULT_MODEL.to_string(), stream: true, use_configured_temperature: false }
    }

    /// Read the `MODEL_API_*` variables; `None` when `MODEL_API_KEY` is unset
    /// or empty.
    pub fn from_env() -> Option<Self> {
        let api_key = std::env::var("MODEL_API_KEY").ok().filter(|k| !k.trim().is_empty())?;
        let mut c = Self::new(api_key.trim());
        if let Some(u) = std::env::var("MODEL_API_BASE_URL").ok().filter(|v| !v.trim().is_empty()) {
            c.base_url = u.trim().trim_end_matches('/').to_string();
        }
        if let Some(m) = std::env::var("MODEL_API_MODEL").ok().filter(|v| !v.trim().is_empty()) {
            c.model = m.trim().to_string();
        }
        if let Ok(v) = std::env::var("MODEL_API_STREAM") {
            c.stream = !matches!(v.trim(), "0" | "false" | "no");
        }
        c.use_configured_temperature = std::env::var("MODEL_API_USE_CONFIGURED_TEMPERATURE").map(|v| v == "1").unwrap_or(false);
        Some(c)
    }

    pub fn responses_url(&self) -> String {
        format!("{}/responses", self.base_url.trim_end_matches('/'))
    }
}

/// Map the endpoint's effort/thinking settings to `reasoning.effort`.
/// Muse Spark cannot switch reasoning off (`"none"` is rejected), so the
/// endpoints that disable Claude's extended thinking (triage, refine) run at
/// `"minimal"`; the others follow their configured effort level.
pub fn reasoning_effort(config: &EndpointConfig) -> &'static str {
    if !config.thinking.is_enabled() {
        return "minimal";
    }
    match config.effort {
        EffortLevel::Low => "low",
        EffortLevel::Medium => "medium",
        EffortLevel::High => "high",
        EffortLevel::Max => "xhigh",
    }
}

// ─── Request ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct InputContent {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct InputMessage {
    pub role: &'static str,
    pub content: Vec<InputContent>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Reasoning {
    pub effort: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResponsesRequest {
    pub model: String,
    pub instructions: String,
    pub input: Vec<InputMessage>,
    pub reasoning: Reasoning,
    pub max_output_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    pub store: bool,
    pub stream: bool,
}

impl ResponsesRequest {
    pub fn new(model: &str, system: &str, user_message: &str, effort: &'static str, max_output_tokens: u32, stream: bool) -> Self {
        Self {
            model: model.to_string(),
            instructions: system.to_string(),
            input: vec![InputMessage { role: "user", content: vec![InputContent { kind: "input_text", text: user_message.to_string() }] }],
            reasoning: Reasoning { effort },
            max_output_tokens: max_output_tokens.max(16),
            temperature: None,
            store: false,
            stream,
        }
    }
}

// ─── Response ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct OutputContent {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OutputItem {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub phase: Option<String>,
    #[serde(default)]
    pub content: Vec<OutputContent>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Usage {
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct IncompleteDetails {
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResponseError {
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResponsesResponse {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub output: Vec<OutputItem>,
    #[serde(default)]
    pub usage: Usage,
    #[serde(default)]
    pub incomplete_details: Option<IncompleteDetails>,
    #[serde(default)]
    pub error: Option<ResponseError>,
}

impl ResponsesResponse {
    /// True when the generation stopped because `max_output_tokens` was hit.
    pub fn truncated(&self) -> bool {
        self.status == "incomplete" && self.incomplete_details.as_ref().and_then(|d| d.reason.as_deref()) == Some("max_output_tokens")
    }

    /// The visible answer: `output_text` blocks of the assistant `message`
    /// items. Intermediate commentary (`phase: "commentary"`) is skipped when
    /// a final message exists.
    pub fn output_text(&self) -> String {
        let text_of = |item: &OutputItem| item.content.iter().filter(|c| c.kind == "output_text").filter_map(|c| c.text.clone()).collect::<Vec<_>>().join("");
        let messages: Vec<&OutputItem> = self.output.iter().filter(|i| i.kind == "message" && i.role.as_deref().unwrap_or("assistant") == "assistant").collect();
        let finals: Vec<&OutputItem> = messages.iter().copied().filter(|i| i.phase.as_deref() != Some("commentary")).collect();
        let chosen = if finals.is_empty() { messages } else { finals };
        chosen.iter().map(|i| text_of(i)).collect::<Vec<_>>().join("")
    }
}

#[derive(Debug, thiserror::Error)]
pub enum MuseError {
    #[error("Model API request failed: {0}")]
    Transport(#[from] HttpError),
    #[error("Model API returned {status}: {body}")]
    Status { status: u16, body: String },
    #[error("Model API response could not be parsed: {0}")]
    Parse(String),
    #[error("Model API event stream ended without a terminal event")]
    StreamIncomplete,
    #[error("Model API response {status}: {message}")]
    Failed { status: String, message: String },
}

/// Parse a Responses API reply: either a plain JSON response object or an
/// SSE stream whose terminal event carries the response object.
pub fn parse_response_body(body: &[u8]) -> Result<ResponsesResponse, MuseError> {
    let text = String::from_utf8_lossy(body);
    let trimmed = text.trim_start();
    if trimmed.starts_with('{') {
        let v: Value = serde_json::from_str(trimmed).map_err(|e| MuseError::Parse(e.to_string()))?;
        return response_from_value(v);
    }
    let mut terminal: Option<Value> = None;
    for event in sse_events(&text) {
        let Ok(v) = serde_json::from_str::<Value>(&event.data) else { continue };
        let kind = event.event.clone().or_else(|| v.get("type").and_then(|t| t.as_str()).map(|s| s.to_string())).unwrap_or_default();
        if matches!(kind.as_str(), "response.completed" | "response.incomplete" | "response.failed") {
            if let Some(r) = v.get("response") {
                terminal = Some(r.clone());
            }
        }
    }
    match terminal {
        Some(v) => response_from_value(v),
        None => Err(MuseError::StreamIncomplete),
    }
}

fn response_from_value(v: Value) -> Result<ResponsesResponse, MuseError> {
    serde_json::from_value(v).map_err(|e| MuseError::Parse(e.to_string()))
}

struct SseEvent {
    event: Option<String>,
    data: String,
}

/// Minimal server-sent-events framing: `event:` / `data:` lines, blank line
/// terminates an event, multiple `data:` lines are joined with `\n`.
fn sse_events(text: &str) -> Vec<SseEvent> {
    let mut out = Vec::new();
    let mut event: Option<String> = None;
    let mut data: Vec<String> = Vec::new();
    let flush = |event: &mut Option<String>, data: &mut Vec<String>, out: &mut Vec<SseEvent>| {
        if !data.is_empty() {
            let joined = data.join("\n");
            if joined != "[DONE]" {
                out.push(SseEvent { event: event.take(), data: joined });
            }
        }
        *event = None;
        data.clear();
    };
    for raw in text.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if line.is_empty() {
            flush(&mut event, &mut data, &mut out);
        } else if let Some(rest) = line.strip_prefix("event:") {
            event = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("data:") {
            data.push(rest.strip_prefix(' ').unwrap_or(rest).to_string());
        }
        // comments (`:`) and other fields are ignored
    }
    flush(&mut event, &mut data, &mut out);
    out
}

/// `POST /v1/responses`, retrying transient failures up to [`MAX_RETRIES`]
/// times. A response whose `status` is `failed` is an error; `incomplete` is
/// returned to the caller (see [`ResponsesResponse::truncated`]).
pub async fn create_response(http: &dyn HttpClient, config: &MuseConfig, params: &ResponsesRequest) -> Result<ResponsesResponse, MuseError> {
    let body = serde_json::to_vec(params).map_err(|e| MuseError::Parse(e.to_string()))?;
    let mut attempt = 0;
    loop {
        let req = HttpRequest::post(config.responses_url(), body.clone())
            .header("authorization", &format!("Bearer {}", config.api_key))
            .header("content-type", "application/json")
            .header("accept", if params.stream { "text/event-stream" } else { "application/json" })
            .timeout(Duration::from_secs(600));
        let outcome: Result<ResponsesResponse, MuseError> = match http.send(req).await {
            Ok(resp) if resp.ok() => return finish(parse_response_body(&resp.body)?),
            Ok(resp) => Err(MuseError::Status { status: resp.status, body: resp.text() }),
            Err(HttpError::Timeout) => Err(MuseError::Transport(HttpError::Timeout)),
            Err(e) => Err(MuseError::Transport(e)),
        };
        let err = outcome.unwrap_err();
        let retryable = match &err {
            MuseError::Status { status, .. } => RETRY_STATUSES.contains(status),
            MuseError::Transport(HttpError::Transport(_)) => true,
            _ => false,
        };
        if !retryable || attempt >= MAX_RETRIES {
            return Err(err);
        }
        attempt += 1;
        let delay = Duration::from_millis(500 * (1 << (attempt - 1)));
        tracing::warn!("[Muse] attempt {attempt} failed ({err}); retrying in {}ms", delay.as_millis());
        tokio::time::sleep(delay).await;
    }
}

fn finish(r: ResponsesResponse) -> Result<ResponsesResponse, MuseError> {
    if r.status == "failed" || r.status == "cancelled" {
        let message = r.error.as_ref().and_then(|e| e.message.clone()).unwrap_or_else(|| "no error message".into());
        let code = r.error.as_ref().and_then(|e| e.code.clone()).map(|c| format!(" [{c}]")).unwrap_or_default();
        return Err(MuseError::Failed { status: r.status.clone(), message: format!("{message}{code}") });
    }
    Ok(r)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::http::{HttpResponse, MockHttp};
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use th_core::claude_config::get_endpoint_config;

    pub(crate) fn completed_response(text: &str) -> Value {
        json!({
            "id": "resp_abc123",
            "object": "response",
            "status": "completed",
            "model": "muse-spark-1.3",
            "output": [
                {"id": "rs_1", "type": "reasoning", "summary": []},
                {"id": "msg_1", "type": "message", "role": "assistant", "status": "completed",
                 "content": [{"type": "output_text", "text": text, "annotations": []}]}
            ],
            "usage": {"input_tokens": 69, "output_tokens": 163, "total_tokens": 232}
        })
    }

    pub(crate) fn sse_stream(terminal_event: &str, response: &Value) -> String {
        format!(
            "event: response.created\ndata: {}\n\nevent: response.output_text.delta\ndata: {}\n\n: keep-alive\n\nevent: {terminal_event}\ndata: {}\n\ndata: [DONE]\n\n",
            json!({"type": "response.created", "response": {"id": "resp_abc123", "status": "in_progress"}}),
            json!({"type": "response.output_text.delta", "delta": "{\"ok\""}),
            json!({"type": terminal_event, "response": response})
        )
    }

    #[test]
    fn effort_mapping() {
        assert_eq!(reasoning_effort(&get_endpoint_config("triage")), "minimal");
        assert_eq!(reasoning_effort(&get_endpoint_config("refine")), "minimal");
        assert_eq!(reasoning_effort(&get_endpoint_config("analyse")), "medium");
        assert_eq!(reasoning_effort(&get_endpoint_config("critic")), "high");
        let mut max = get_endpoint_config("critic");
        max.effort = EffortLevel::Max;
        assert_eq!(reasoning_effort(&max), "xhigh");
    }

    #[test]
    fn request_shape() {
        let r = ResponsesRequest::new("muse-spark-1.3", "SYSTEM", "USER", "medium", 16_000, true);
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(
            v,
            json!({
                "model": "muse-spark-1.3",
                "instructions": "SYSTEM",
                "input": [{"role": "user", "content": [{"type": "input_text", "text": "USER"}]}],
                "reasoning": {"effort": "medium"},
                "max_output_tokens": 16000,
                "store": false,
                "stream": true
            })
        );
        assert_eq!(ResponsesRequest::new("m", "s", "u", "low", 4, false).max_output_tokens, 16);
    }

    #[test]
    fn parses_plain_json_and_sse() {
        let plain = serde_json::to_vec(&completed_response("{\"ok\":true}")).unwrap();
        let r = parse_response_body(&plain).unwrap();
        assert_eq!(r.output_text(), "{\"ok\":true}");
        assert_eq!((r.usage.input_tokens, r.usage.output_tokens), (69, 163));
        assert!(!r.truncated());

        let stream = sse_stream("response.completed", &completed_response("{\"ok\":true}"));
        let r = parse_response_body(stream.as_bytes()).unwrap();
        assert_eq!(r.output_text(), "{\"ok\":true}");
        assert_eq!(r.model, "muse-spark-1.3");

        // CRLF framing and a missing `event:` line (type taken from the data).
        let crlf = format!("data: {}\r\n\r\ndata: [DONE]\r\n\r\n", json!({"type": "response.completed", "response": completed_response("x")}));
        assert_eq!(parse_response_body(crlf.as_bytes()).unwrap().output_text(), "x");

        let no_terminal = "event: response.created\ndata: {\"type\":\"response.created\"}\n\n";
        assert!(matches!(parse_response_body(no_terminal.as_bytes()), Err(MuseError::StreamIncomplete)));
        assert!(matches!(parse_response_body(b"{not json"), Err(MuseError::Parse(_))));
    }

    #[test]
    fn incomplete_and_commentary() {
        let mut v = completed_response("partial");
        v["status"] = json!("incomplete");
        v["incomplete_details"] = json!({"reason": "max_output_tokens"});
        let r = parse_response_body(&serde_json::to_vec(&v).unwrap()).unwrap();
        assert!(r.truncated());

        let mut v = completed_response("FINAL");
        v["output"]
            .as_array_mut()
            .unwrap()
            .insert(0, json!({"type": "message", "role": "assistant", "phase": "commentary", "content": [{"type": "output_text", "text": "Let me think."}]}));
        let r = parse_response_body(&serde_json::to_vec(&v).unwrap()).unwrap();
        assert_eq!(r.output_text(), "FINAL");

        let only_commentary = json!({"status": "completed", "model": "m", "output": [
            {"type": "message", "role": "assistant", "phase": "commentary", "content": [{"type": "output_text", "text": "C"}]}
        ]});
        assert_eq!(parse_response_body(&serde_json::to_vec(&only_commentary).unwrap()).unwrap().output_text(), "C");
    }

    #[tokio::test]
    async fn sends_bearer_auth_and_retries_transient_failures() {
        let calls = Arc::new(AtomicUsize::new(0));
        let c2 = calls.clone();
        let http = MockHttp::new(move |_| {
            let n = c2.fetch_add(1, Ordering::SeqCst);
            if n == 0 {
                Ok(HttpResponse { status: 429, headers: vec![], body: b"{\"error\":{\"message\":\"slow down\"}}".to_vec() })
            } else {
                Ok(HttpResponse { status: 200, headers: vec![], body: sse_stream("response.completed", &completed_response("ok")).into_bytes() })
            }
        });
        let config = MuseConfig::new("test-key");
        let req = ResponsesRequest::new(&config.model, "s", "u", "low", 100, true);
        let r = create_response(http.as_ref(), &config, &req).await.unwrap();
        assert_eq!(r.output_text(), "ok");
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        let first = http.calls.lock().unwrap()[0].clone();
        assert_eq!(first.url, "https://api.meta.ai/v1/responses");
        assert!(first.headers.iter().any(|(k, v)| k == "authorization" && v == "Bearer test-key"));
        assert!(first.headers.iter().any(|(k, v)| k == "accept" && v == "text/event-stream"));

        let http = MockHttp::status(401);
        let e = create_response(http.as_ref(), &config, &req).await.unwrap_err();
        assert!(matches!(e, MuseError::Status { status: 401, .. }));
        assert_eq!(http.call_count(), 1, "4xx other than 429 is not retried");

        let failed = json!({"status": "failed", "model": "m", "output": [], "error": {"code": "server_error", "message": "boom"}});
        let http = MockHttp::new(move |_| Ok(HttpResponse { status: 200, headers: vec![], body: sse_stream("response.failed", &failed).into_bytes() }));
        let e = create_response(http.as_ref(), &config, &req).await.unwrap_err();
        assert_eq!(e.to_string(), "Model API response failed: boom [server_error]");
    }

    #[test]
    fn config_urls() {
        let mut c = MuseConfig::new("k");
        c.base_url = "https://example.test/v1/".into();
        assert_eq!(c.responses_url(), "https://example.test/v1/responses");
    }
}
