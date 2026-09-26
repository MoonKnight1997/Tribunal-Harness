//! Shared application state: configuration, clock, HTTP transport, the Find
//! Case Law client, the LLM client and the two per-route rate limiters.

use crate::config::AppConfig;
use std::sync::Arc;
use th_core::dates::{CivilDate, Clock};
use th_core::rate_limit::RateLimiter;
use th_services::claude_client::LlmClient;
use th_services::http::HttpClient;
use th_services::tna::TnaClient;

const RATE_WINDOW_MS: i64 = 60 * 60 * 1000;
const RATE_MAX_REQUESTS: usize = 10;

pub struct AppState {
    pub config: AppConfig,
    pub clock: Arc<dyn Clock>,
    pub http: Arc<dyn HttpClient>,
    pub tna: TnaClient,
    pub llm: LlmClient,
    /// `/api/analyse` — 10 requests/hour keyed on the trusted XFF hop (F-20).
    pub analyse_limiter: RateLimiter,
    /// `/api/debate` — a SEPARATE bucket with the same policy (F-8).
    pub debate_limiter: RateLimiter,
}

pub type SharedState = Arc<AppState>;

impl AppState {
    pub fn new(config: AppConfig, http: Arc<dyn HttpClient>, clock: Arc<dyn Clock>) -> SharedState {
        let tna = TnaClient::new(http.clone(), clock.clone());
        let llm = LlmClient::new(config.llm.clone(), http.clone(), clock.clone());
        Arc::new(Self {
            config,
            clock,
            http,
            tna,
            llm,
            analyse_limiter: RateLimiter::new(RATE_WINDOW_MS, RATE_MAX_REQUESTS),
            debate_limiter: RateLimiter::new(RATE_WINDOW_MS, RATE_MAX_REQUESTS),
        })
    }

    pub fn now_ms(&self) -> i64 {
        self.clock.now_epoch_ms()
    }

    pub fn today(&self) -> CivilDate {
        self.clock.today_utc()
    }

    /// `process.env.NODE_ENV === "development"` — gates `_debug` metadata.
    pub fn is_dev(&self) -> bool {
        self.config.llm.is_development()
    }
}
