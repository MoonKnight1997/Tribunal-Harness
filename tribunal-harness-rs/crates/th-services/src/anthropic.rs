//! Anthropic Messages API over plain HTTP — the request shape the TypeScript
//! app sends through `@anthropic-ai/sdk` (`client.messages.create`).

use crate::http::{HttpClient, HttpError, HttpRequest};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

pub const MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
pub const API_VERSION: &str = "2023-06-01";

#[derive(Debug, Clone, Serialize)]
pub struct MessageParam {
    pub role: &'static str,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ThinkingParam {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub budget_tokens: u32,
}

/// `MessageCreateParamsNonStreaming` — keys in the order the SDK request has them.
#[derive(Debug, Clone, Serialize)]
pub struct MessageCreateParams {
    pub model: String,
    pub max_tokens: u32,
    pub system: String,
    pub messages: Vec<MessageParam>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<ThinkingParam>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ContentBlock {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MessageResponse {
    pub content: Vec<ContentBlock>,
    pub usage: Usage,
    pub model: String,
    #[serde(default)]
    pub stop_reason: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum AnthropicError {
    #[error("Anthropic API request failed: {0}")]
    Transport(#[from] HttpError),
    #[error("Anthropic API returned {status}: {body}")]
    Status { status: u16, body: String },
    #[error("Anthropic API response could not be parsed: {0}")]
    Parse(String),
}

/// POST /v1/messages.
pub async fn create_message(http: &dyn HttpClient, api_key: &str, params: &MessageCreateParams) -> Result<MessageResponse, AnthropicError> {
    let body = serde_json::to_vec(params).map_err(|e| AnthropicError::Parse(e.to_string()))?;
    let req = HttpRequest::post(MESSAGES_URL, body)
        .header("x-api-key", api_key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .timeout(Duration::from_secs(600));
    let resp = http.send(req).await?;
    if !resp.ok() {
        return Err(AnthropicError::Status { status: resp.status, body: resp.text() });
    }
    let v: Value = serde_json::from_slice(&resp.body).map_err(|e| AnthropicError::Parse(e.to_string()))?;
    serde_json::from_value(v).map_err(|e| AnthropicError::Parse(e.to_string()))
}
