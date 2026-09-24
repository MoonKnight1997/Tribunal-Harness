//! Claude Client — port of `src/lib/claude-client.ts`. Routes every model
//! call to the offline agent stand-in (`LLM_PROVIDER=agent`), to Meta's Model
//! API running Muse Spark (`LLM_PROVIDER=muse`, [`crate::muse`]) or to the
//! Anthropic Messages API, applying the centralised endpoint configuration.

use crate::anthropic::{create_message, MessageCreateParams, MessageParam, ThinkingParam};
use crate::http::HttpClient;
use crate::muse::{create_response, reasoning_effort, MuseConfig, ResponsesRequest};
use serde::Serialize;
use std::sync::Arc;
use th_core::agent_provider::{estimate_tokens, generate_agent_response, AgentProviderRequest, AGENT_STAND_IN_MODEL};
use th_core::claude_config::{estimate_cost, get_endpoint_config, CostEstimate, EndpointConfig, ThinkingConfig};
use th_core::dates::Clock;

/// Environment-derived LLM settings (read once at start-up).
///
/// Provider resolution (`LLM_PROVIDER`):
/// - `agent` → the offline stand-in;
/// - `muse` (also `meta`, `model-api`) → Meta Model API with `MODEL_API_KEY`;
/// - `anthropic` → Anthropic with `ANTHROPIC_API_KEY`;
/// - unset → Anthropic when `ANTHROPIC_API_KEY` is set, otherwise Muse when
///   `MODEL_API_KEY` is set, otherwise no provider (degraded responses).
#[derive(Debug, Clone, Default)]
pub struct LlmConfig {
    /// `LLM_PROVIDER=agent`
    pub agent_provider: bool,
    /// `ANTHROPIC_API_KEY`
    pub api_key: Option<String>,
    /// Meta Model API (Muse Spark) — `Some` when it is the selected provider.
    pub muse: Option<MuseConfig>,
    /// `NODE_ENV`
    pub node_env: Option<String>,
    /// `REFINEMENT_DISABLED=1`
    pub refinement_disabled: bool,
}

impl LlmConfig {
    pub fn from_env() -> Self {
        let provider = std::env::var("LLM_PROVIDER").ok().map(|v| v.trim().to_ascii_lowercase()).filter(|v| !v.is_empty());
        let anthropic_key = std::env::var("ANTHROPIC_API_KEY").ok().filter(|k| !k.is_empty());
        let muse_env = MuseConfig::from_env();
        let (agent_provider, api_key, muse) = match provider.as_deref() {
            Some("agent") => (true, None, None),
            Some("muse") | Some("meta") | Some("model-api") => {
                if muse_env.is_none() {
                    tracing::warn!("LLM_PROVIDER={} but MODEL_API_KEY is not set — model calls will be degraded.", provider.as_deref().unwrap_or("muse"));
                }
                (false, None, muse_env)
            }
            Some("anthropic") => (false, anthropic_key, None),
            Some(other) => {
                tracing::warn!("Unknown LLM_PROVIDER={other:?}; using the key-based default.");
                (false, anthropic_key.clone(), if anthropic_key.is_none() { muse_env } else { None })
            }
            None => (false, anthropic_key.clone(), if anthropic_key.is_none() { muse_env } else { None }),
        };
        Self {
            agent_provider,
            api_key,
            muse,
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
    /// Human-readable description of the active provider (start-up log).
    pub fn provider_label(&self) -> String {
        if self.agent_provider {
            "agent stand-in (SIMULATED analysis)".to_string()
        } else if let Some(m) = &self.muse {
            format!("Meta Model API — {} via {}", m.model, m.base_url)
        } else if self.api_key.is_some() {
            "Anthropic Messages API".to_string()
        } else {
            "none (no ANTHROPIC_API_KEY or MODEL_API_KEY — model routes degrade)".to_string()
        }
    }
    /// The `refinement.source` value reported for a successful refinement.
    pub fn refinement_source(&self) -> &'static str {
        if self.agent_provider {
            "agent-stand-in"
        } else if self.muse.is_some() {
            "muse-spark"
        } else {
            "claude-sonnet"
        }
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
    #[error(transparent)]
    Muse(#[from] crate::muse::MuseError),
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

    /// True when a real provider is configured OR the agent stand-in is selected.
    pub fn is_client_available(&self) -> bool {
        self.config.agent_provider || self.config.muse.is_some() || self.config.api_key.is_some()
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
            tracing::info!("[Claude:agent] {} | {}ms | {}→{} tokens | £{} | {}", config.label, duration, input_tokens, output_tokens, cost.cost_gbp, params.prompt_version);
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

        // ─── Meta Model API (Muse Spark) path ───────────────────────────
        if let Some(muse) = &self.config.muse {
            return self.call_muse(muse, &config, &params, start).await.map(Some);
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
                    tracing::warn!("[Claude] thinking.budget_tokens ({budget}) >= max_tokens ({}) for {}; clamping to {clamped}.", config.max_tokens, config.label);
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
            config.label,
            duration,
            response.usage.input_tokens,
            response.usage.output_tokens,
            cost.cost_gbp,
            params.prompt_version
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

    /// One Responses API call. The per-endpoint `max_tokens` becomes
    /// `max_output_tokens` (both budgets cover reasoning plus visible output)
    /// and the effort/thinking pair becomes `reasoning.effort`. A reply that
    /// stopped on `max_output_tokens` is surfaced as [`ClaudeError::Truncated`]
    /// exactly like an Anthropic `stop_reason: "max_tokens"`.
    async fn call_muse(&self, muse: &MuseConfig, config: &EndpointConfig, params: &CallClaudeParams<'_>, start: i64) -> Result<ClaudeCallResult, ClaudeError> {
        let effort = reasoning_effort(config);
        let mut request = ResponsesRequest::new(&muse.model, params.system, params.user_message, effort, config.max_tokens, muse.stream);
        if muse.use_configured_temperature {
            request.temperature = config.temperature;
        }
        let response = create_response(self.http.as_ref(), muse, &request).await?;
        if response.truncated() {
            return Err(ClaudeError::Truncated { label: config.label.to_string(), max_tokens: config.max_tokens });
        }
        let content = response.output_text();
        let duration = self.clock.now_epoch_ms() - start;
        let model = if response.model.is_empty() { muse.model.clone() } else { response.model.clone() };
        let cost = estimate_cost(&model, response.usage.input_tokens, response.usage.output_tokens);
        tracing::info!(
            "[Claude:muse] {} | {}ms | {}→{} tokens | effort={effort} | status={} | {}",
            config.label,
            duration,
            response.usage.input_tokens,
            response.usage.output_tokens,
            response.status,
            params.prompt_version
        );
        Ok(ClaudeCallResult {
            content,
            usage: ClaudeUsage { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
            debug: ClaudeDebug {
                model,
                endpoint_config: params.endpoint.to_string(),
                prompt_version: params.prompt_version.to_string(),
                duration_ms: duration,
                effort,
                // Muse Spark always reasons; there is no token budget to report.
                thinking_enabled: true,
                thinking_budget: None,
                cost_estimate: cost,
            },
        })
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
        let r = c
            .call_claude(CallClaudeParams { endpoint: "analyse", system: "sys", user_message: "claim_type: unfair_dismissal", prompt_version: "v2", config_override: None })
            .await
            .unwrap()
            .unwrap();
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
        let headers = http.calls.lock().unwrap()[0].headers.clone();
        assert!(headers.iter().any(|(k, v)| k == "x-api-key" && v == "sk-test-key"));
        assert!(headers.iter().any(|(k, v)| k == "anthropic-version" && v == "2023-06-01"));

        let http = ok_response(json!({"stop_reason": "max_tokens", "content": [{"type": "text", "text": "{\"claims\":[{\"partial"}]}));
        let c = client(LlmConfig { api_key: Some("k".into()), ..Default::default() }, http);
        let e = c
            .call_claude(CallClaudeParams {
                endpoint: "analyse",
                system: "s",
                user_message: "u",
                prompt_version: "v2",
                config_override: Some(ConfigOverride { thinking: Some(ThinkingConfig::disabled()), ..Default::default() }),
            })
            .await
            .unwrap_err();
        assert_eq!(e.code(), Some("response_truncated_max_tokens"));
    }

    #[tokio::test]
    async fn muse_path_maps_config_and_surfaces_truncation() {
        use crate::muse::tests::{completed_response, sse_stream};

        let http = MockHttp::new(|_| Ok(HttpResponse { status: 200, headers: vec![], body: sse_stream("response.completed", &completed_response("{\"ok\":true}")).into_bytes() }));
        let config = LlmConfig { muse: Some(MuseConfig::new("mk")), ..Default::default() };
        assert_eq!(config.refinement_source(), "muse-spark");
        assert!(config.provider_label().contains("muse-spark-1.3"));
        let c = client(config, http.clone());
        assert!(c.is_client_available());
        let r = c.call_claude(CallClaudeParams { endpoint: "critic", system: "SYS", user_message: "USER", prompt_version: "v2", config_override: None }).await.unwrap().unwrap();
        assert_eq!(r.content, "{\"ok\":true}");
        assert_eq!(r.debug.model, "muse-spark-1.3");
        assert_eq!(r.debug.effort, "high");
        assert!(r.debug.thinking_enabled && r.debug.thinking_budget.is_none());
        assert_eq!((r.usage.input_tokens, r.usage.output_tokens), (69, 163));
        assert_eq!(r.debug.cost_estimate.cost_usd, 0.0, "no published price is assumed");
        let call = http.calls.lock().unwrap()[0].clone();
        assert_eq!(call.url, "https://api.meta.ai/v1/responses");
        assert!(call.headers.iter().any(|(k, v)| k == "authorization" && v == "Bearer mk"));
        let sent: Value = serde_json::from_slice(call.body.as_ref().unwrap()).unwrap();
        assert_eq!(sent["model"], "muse-spark-1.3");
        assert_eq!(sent["instructions"], "SYS");
        assert_eq!(sent["input"][0]["content"][0]["text"], "USER");
        assert_eq!(sent["reasoning"]["effort"], "high");
        assert_eq!(sent["max_output_tokens"], 20_000);
        assert_eq!(sent["store"], false);
        assert_eq!(sent["stream"], true);
        assert!(sent.get("temperature").is_none(), "temperature stays at the model default unless enabled");

        // Thinking-disabled endpoints run at minimal effort; configured temperature is opt-in.
        let http = MockHttp::new(|_| Ok(HttpResponse { status: 200, headers: vec![], body: serde_json::to_vec(&completed_response("x")).unwrap() }));
        let mut muse = MuseConfig::new("mk");
        muse.use_configured_temperature = true;
        muse.stream = false;
        let c = client(LlmConfig { muse: Some(muse), ..Default::default() }, http.clone());
        c.call_claude(CallClaudeParams { endpoint: "triage", system: "s", user_message: "u", prompt_version: "v2", config_override: None }).await.unwrap().unwrap();
        let sent: Value = serde_json::from_slice(http.calls.lock().unwrap()[0].body.as_ref().unwrap()).unwrap();
        assert_eq!(sent["reasoning"]["effort"], "minimal");
        assert_eq!(sent["temperature"], 0.3);
        assert_eq!(sent["stream"], false);

        // max_output_tokens hit → the same truncation error as the Anthropic path.
        let mut v = completed_response("{\"claims\":[{\"partial");
        v["status"] = json!("incomplete");
        v["incomplete_details"] = json!({"reason": "max_output_tokens"});
        let http = MockHttp::new(move |_| Ok(HttpResponse { status: 200, headers: vec![], body: sse_stream("response.incomplete", &v).into_bytes() }));
        let c = client(LlmConfig { muse: Some(MuseConfig::new("mk")), ..Default::default() }, http);
        let e = c.call_claude(CallClaudeParams { endpoint: "analyse", system: "s", user_message: "u", prompt_version: "v2", config_override: None }).await.unwrap_err();
        assert_eq!(e.code(), Some("response_truncated_max_tokens"));
        assert!(e.to_string().contains("max_tokens (16000)"));

        // An API error is a typed error, never a degraded `None`.
        let c = client(LlmConfig { muse: Some(MuseConfig::new("mk")), ..Default::default() }, MockHttp::status(401));
        let e = c.call_claude(CallClaudeParams { endpoint: "analyse", system: "s", user_message: "u", prompt_version: "v2", config_override: None }).await.unwrap_err();
        assert!(matches!(e, ClaudeError::Muse(crate::muse::MuseError::Status { status: 401, .. })));

        // The stand-in still wins when both are configured.
        let c = client(LlmConfig { agent_provider: true, muse: Some(MuseConfig::new("mk")), ..Default::default() }, MockHttp::transport_error());
        assert_eq!(
            c.call_claude(CallClaudeParams { endpoint: "analyse", system: "s", user_message: "u", prompt_version: "v2", config_override: None })
                .await
                .unwrap()
                .unwrap()
                .debug
                .model,
            "agent-stand-in"
        );
    }
}
