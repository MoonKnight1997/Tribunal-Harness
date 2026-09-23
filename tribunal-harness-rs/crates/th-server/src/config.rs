//! Process configuration — every environment variable the Next.js app reads,
//! resolved once at start-up (the TypeScript app reads most of them lazily at
//! request time; the observable behaviour is the same for a given process
//! environment).

use std::path::PathBuf;
use th_core::constants::{resolve_time_limit_commencement, TimeLimitConfig};
use th_services::claude_client::LlmConfig;

#[derive(Debug, Clone)]
pub struct AppConfig {
    /// `LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `NODE_ENV`, `REFINEMENT_DISABLED`.
    pub llm: LlmConfig,
    /// `WEBHOOK_SECRET` — `None` when unset or empty (JS falsy).
    pub webhook_secret: Option<String>,
    /// `RESEND_API_KEY` — `None` when unset or empty.
    pub resend_api_key: Option<String>,
    /// `NOTIFY_EMAIL` — `None` when unset or empty.
    pub notify_email: Option<String>,
    /// `TIME_LIMIT_CONFIG` with `ERA_2025_TIME_LIMIT_COMMENCEMENT` applied.
    pub time_limit: TimeLimitConfig,
    /// `PORT` (default 3000, as `next start`).
    pub port: u16,
    /// `<cwd>/data` — where `/api/request-access` appends its JSON lines.
    pub data_dir: PathBuf,
}

fn non_empty(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.is_empty())
}

impl AppConfig {
    /// Read the process environment. Fails (so the server refuses to start)
    /// when `ERA_2025_TIME_LIMIT_COMMENCEMENT` is set to a malformed date.
    pub fn from_env() -> Result<Self, String> {
        let override_value = std::env::var("ERA_2025_TIME_LIMIT_COMMENCEMENT").ok();
        let commencement = resolve_time_limit_commencement(override_value.as_deref())?;
        let port = match std::env::var("PORT") {
            Ok(p) if !p.trim().is_empty() => p.trim().parse::<u16>().map_err(|_| format!("Invalid PORT={p:?}: expected a number"))?,
            _ => 3000,
        };
        Ok(Self {
            llm: LlmConfig::from_env(),
            webhook_secret: non_empty("WEBHOOK_SECRET"),
            resend_api_key: non_empty("RESEND_API_KEY"),
            notify_email: non_empty("NOTIFY_EMAIL"),
            time_limit: TimeLimitConfig::with_commencement(commencement),
            port,
            data_dir: std::env::current_dir().map_err(|e| e.to_string())?.join("data"),
        })
    }

    /// The hermetic configuration used by the smoke harness and the route
    /// replay tests: agent stand-in, no keys, no webhook secret.
    pub fn hermetic(data_dir: PathBuf) -> Self {
        Self {
            llm: LlmConfig { agent_provider: true, api_key: None, node_env: None, refinement_disabled: false },
            webhook_secret: None,
            resend_api_key: None,
            notify_email: None,
            time_limit: TimeLimitConfig::default(),
            port: 3000,
            data_dir,
        }
    }
}
