//! Claude Client — port of `src/lib/claude-client.ts`. Routes every model
//! call either to the offline agent stand-in (`LLM_PROVIDER=agent`) or to the
//! Anthropic Messages API, applying the centralised endpoint configuration.

use crate::anthropic::{create_message, MessageCreateParams, MessageParam, ThinkingParam};
use crate::http::HttpClient;
use serde::Serialize;
use std::sync::Arc;
use th_core::agent_provider::{estimate_tokens, generate_agent_response, AgentProviderRequest, AGENT_STAND_IN_MODEL};
use th_core::claude_config::{estimate_cost, get_endpoint_config, CostEstimate, EndpointConfig, ThinkingConfig};
use th_core::dates::Clock;

/// Environment-derived LLM settings (read once at start-up).
#[derive(Debug, Clone, Default)]
pub struct LlmConfig {
    /// `LLM_PROVIDER=agent`
    pub agent_provider: bool,
    /// `ANTHROPIC_API_KEY`
    pub api_key: Option<String>,
    /// `NODE_ENV`
    pub node_env: Option<String>,
    /// `REFINEMENT_DISABLED=1`
    pub refinement_disabled: bool,
}

impl LlmConfig {
    pub fn from_env() -> Self {
        Self {
            agent_provider: std::env::var("LLM_PROVIDER").map(|v| v == "agent").unwrap_or(false),
            api_key: std::env::var("ANTHROPIC_API_KEY").ok().filter(|k| !k.is_empty()),
            node_env: std::env::var("NODE_ENV").ok(),
            refinement_disabled: std::env::var("REFINEMENT_DISABLED").map(|v| v == "1").unwrap_or(false),
        }
    }
    pub fn is_production(&self) -> bool {
        self.node_env.as_deref() == Some("production")
    }
    pub fn is_development(&self) -> bool {
        self.node_env.as_deref() == Some("development")
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeDebug {
    pub model: String,
    pub endpoint_config: String,
    pub prompt_version: String,
    pub duration_ms: i64,
    pub effort: &'static str,
    pub thinking_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_budget: Option<u32>,
    pub cost_estimate: CostEstimate,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeCallResult {
    pub content: String,
    pub usage: ClaudeUsage,
    pub debug: ClaudeDebug,
}

/// Overrides for dynamic routing (`configOverride`).
#[derive(Debug, Clone, Default)]
pub struct ConfigOverride {
    pub max_tokens: Option<u32>,
    pub thinking: Option<ThinkingConfig>,
    pub temperature: Option<Option<f64>>,
}

pub struct CallClaudeParams<'a> {
    pub endpoint: &'a str,
    pub system: &'a str,
    pub user_message: &'a str,
    pub prompt_version: &'a str,
    pub config_override: Option<ConfigOverride>,
}

#[derive(Debug, thiserror::Error)]
pub enum ClaudeError {
    #[error("LLM_PROVIDER=agent (offline stand-in) is not permitted when NODE_ENV=production: it would serve SIMULATED — not real legal analysis. Configure a real provider (ANTHROPIC_API_KEY) instead.")]
    AgentInProduction,
    /// F-21: `stop_reason === "max_tokens"` — the output is incomplete.
    #[error("Claude response truncated: hit max_tokens ({max_tokens}) for {label}. The output is incomplete and must not be presented as a normal result.")]
    Truncated { label: String, max_tokens: u32 },
    #[error(transparent)]
    Api(#[from] crate::anthropic::AnthropicError),
}

impl ClaudeError {
    /// Stable machine-readable discriminator (`ClaudeTruncatedResponseError.code`).
    pub fn code(&self) -> Option<&'static str> {
        match self {
            ClaudeError::Truncated { .. } => Some("response_truncated_max_tokens"),
            _ => None,
        }
    }
}

pub struct LlmClient {
    pub config: LlmConfig,
    http: Arc<dyn HttpClient>,
    clock: Arc<dyn Clock>,
}

impl LlmClient {
    pub fn new(config: LlmConfig, http: Arc<dyn HttpClient>, clock: Arc<dyn Clock>) -> Self {
        Self { config, http, clock }
    }

    /// True when an API key is configured OR the agent stand-in is selected.
    pub fn is_client_available(&self) -> bool {
        self.config.agent_provider || self.config.api_key.is_some()
    }

    /// Make a Claude call using the centralised configuration. Returns
    /// `Ok(None)` when no client is configured (graceful degradation).
    pub async fn call_claude(&self, params: CallClaudeParams<'_>) -> Result<Option<ClaudeCallResult>, ClaudeError> {
        let start = self.clock.now_epoch_ms();
        let mut config: EndpointConfig = get_endpoint_config(params.endpoint);
        if let Some(o) = &params.config_override {
            if let Some(m) = o.max_tokens {
                config.max_tokens = m;
            }
            if let Some(t) = o.thinking {
                config.thinking = t;
            }
            if let Some(temp) = o.temperature {
                config.temperature = temp;
            }
        }

        // ─── Agent stand-in path ────────────────────────────────────────
        if self.config.agent_provider {
            // F-22: refuse to serve simulated analysis in a production build.
            if self.config.is_production() {
                return Err(ClaudeError::AgentInProduction);
            }
            let content = generate_agent_response(&AgentProviderRequest { endpoint: params.endpoint, system: params.system, user_message: params.user_message });
            let input_tokens = estimate_tokens(params.user_message) + estimate_tokens(params.system);
            let output_tokens = estimate_tokens(&content);
            let duration = self.clock.now_epoch_ms() - start;
            let cost = estimate_cost(config.model, input_tokens, output_tokens);
            tracing::info!(
                "[Claude:agent] {} | {}ms | {}→{} tokens | £{} | {}",
                config.label, duration, input_tokens, output_tokens, cost.cost_gbp, params.prompt_version
            );
            return Ok(Some(ClaudeCallResult {
                content,
                usage: ClaudeUsage { input_tokens, output_tokens },
                debug: ClaudeDebug {
                    model: AGENT_STAND_IN_MODEL.to_string(),
                    endpoint_config: params.endpoint.to_string(),
                    prompt_version: params.prompt_version.to_string(),
                    duration_ms: duration,
                    effort: config.effort.as_str(),
                    thinking_enabled: config.thinking.is_enabled(),
                    thinking_budget: config.thinking.budget_tokens,
                    cost_estimate: cost,
                },
            }));
        }

        // ─── Real Anthropic API path ────────────────────────────────────
        let Some(api_key) = self.config.api_key.clone() else { return Ok(None) };

        let mut request = MessageCreateParams {
            model: config.model.to_string(),
            max_tokens: config.max_tokens,
            system: params.system.to_string(),
            messages: vec![MessageParam { role: "user", content: params.user_message.to_string() }],
            temperature: config.temperature,
            thinking: None,
        };
        if config.thinking.is_enabled() {
            if let Some(mut budget) = config.thinking.budget_tokens {
                // F-4: budget_tokens must be strictly LESS than max_tokens.
                if budget >= config.max_tokens {
                    let clamped = config.max_tokens - 1;
                    tracing::warn!(
                        "[Claude] thinking.budget_tokens ({budget}) >= max_tokens ({}) for {}; clamping to {clamped}.",
                        config.max_tokens, config.label
                    );
                    budget = clamped;
                }
                request.thinking = Some(ThinkingParam { kind: "enabled", budget_tokens: budget });
                // The API requires temperature to be unset when thinking is enabled.
                request.temperature = None;
            }
        }

        let response = create_message(self.http.as_ref(), &api_key, &request).await?;
        if response.stop_reason.as_deref() == Some("max_tokens") {
            return Err(ClaudeError::Truncated { label: config.label.to_string(), max_tokens: config.max_tokens });
        }
        let content = response.content.iter().find(|b| b.kind == "text").and_then(|b| b.text.clone()).unwrap_or_default();
        let duration = self.clock.now_epoch_ms() - start;
        let cost = estimate_cost(config.model, response.usage.input_tokens, response.usage.output_tokens);
        tracing::info!(
            "[Claude] {} | {}ms | {}→{} tokens | £{} | {}",
            config.label, duration, response.usage.input_tokens, response.usage.output_tokens, cost.cost_gbp, params.prompt_version
        );
        Ok(Some(ClaudeCallResult {
            content,
            usage: ClaudeUsage { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
            debug: ClaudeDebug {
                model: response.model,
                endpoint_config: params.endpoint.to_string(),
                prompt_version: params.prompt_version.to_string(),
                duration_ms: duration,
                effort: config.effort.as_str(),
                thinking_enabled: config.thinking.is_enabled(),
                thinking_budget: config.thinking.budget_tokens,
                cost_estimate: cost,
            },
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::{HttpResponse, MockHttp};
    use serde_json::{json, Value};
    use th_core::dates::FixedClock;

    fn ok_response(overrides: Value) -> Arc<MockHttp> {
        MockHttp::new(move |_| {
            let mut v = json!({
                "content": [{"type": "text", "text": "{\"ok\":true}"}],
                "usage": {"input_tokens": 10, "output_tokens": 20},
                "model": "claude-sonnet-4-20250514",
                "stop_reason": "end_turn"
            });
            if let Some(o) = overrides.as_object() {
                for (k, val) in o {
                    v[k] = val.clone();
                }
            }
            Ok(HttpResponse { status: 200, headers: vec![], body: serde_json::to_vec(&v).unwrap() })
        })
    }

    fn client(config: LlmConfig, http: Arc<MockHttp>) -> LlmClient {
        LlmClient::new(config, http, Arc::new(FixedClock(0)))
    }

    #[tokio::test]
    async fn agent_path_and_degradation() {
        let c = client(LlmConfig { agent_provider: true, ..Default::default() }, MockHttp::transport_error());
        assert!(c.is_client_available());
        let r = c.call_claude(CallClaudeParams { endpoint: "analyse", system: "sys", user_message: "claim_type: unfair_dismissal", prompt_version: "v2", config_override: None }).await.unwrap().unwrap();
        assert_eq!(r.debug.model, "agent-stand-in");
        assert!(r.usage.input_tokens > 0);
        let v: Value = serde_json::from_str(&r.content).unwrap();
        assert!(v["claims"].is_array());

        let c = client(LlmConfig::default(), MockHttp::transport_error());
        assert!(!c.is_client_available());
        assert!(c.call_claude(CallClaudeParams { endpoint: "analyse", system: "s", user_message: "u", prompt_version: "v2", config_override: None }).await.unwrap().is_none());

        let c = client(LlmConfig { agent_provider: true, node_env: Some("production".into()), ..Default::default() }, MockHttp::transport_error());
        let e = c.call_claude(CallClaudeParams { endpoint: "analyse", system: "s", user_message: "u", prompt_version: "v2", config_override: None }).await.unwrap_err();
        assert!(matches!(e, ClaudeError::AgentInProduction));
    }

    #[tokio::test]
    async fn real_path_clamps_budget_and_surfaces_truncation() {
        let http = ok_response(json!({}));
        let c = client(LlmConfig { api_key: Some("sk-test-key".into()), ..Default::default() }, http.clone());
        let r = c
            .call_claude(CallClaudeParams {
                endpoint: "analyse",
                system: "s",
                user_message: "u",
                prompt_version: "v2",
                config_override: Some(ConfigOverride { max_tokens: Some(1000), thinking: Some(ThinkingConfig::enabled(5000)), temperature: None }),
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(r.content, "{\"ok\":true}");
        let sent: Value = serde_json::from_slice(http.calls.lock().unwrap()[0].body.as_ref().unwrap()).unwrap();
        assert_eq!(sent["thinking"]["type"], "enabled");
        assert_eq!(sent["thinking"]["budget_tokens"], 999);
        assert!(sent.get("temperature").is_none());
        assert_eq!(sent["model"], "claude-sonnet-5");
        let req = &http.calls.lock().unwrap()[0];
        assert!(req.headers.iter().any(|(k, v)| k == "x-api-key" && v == "sk-test-key"));
        assert!(req.headers.iter().any(|(k, v)| k == "anthropic-version" && v == "2023-06-01"));

        let http = ok_response(json!({"stop_reason": "max_tokens", "content": [{"type": "text", "text": "{\"claims\":[{\"partial"}]}));
        let c = client(LlmConfig { api_key: Some("k".into()), ..Default::default() }, http);
        let e = c.call_claude(CallClaudeParams { endpoint: "analyse", system: "s", user_message: "u", prompt_version: "v2", config_override: Some(ConfigOverride { thinking: Some(ThinkingConfig::disabled()), ..Default::default() }) }).await.unwrap_err();
        assert_eq!(e.code(), Some("response_truncated_max_tokens"));
    }
}
