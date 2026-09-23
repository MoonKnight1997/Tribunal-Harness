//! `th-server` — serve the API and UI. Reads `.env.local` (without overriding
//! the process environment), refuses to start on a malformed
//! `ERA_2025_TIME_LIMIT_COMMENCEMENT`, listens on `PORT` (default 3000).

use std::net::SocketAddr;
use std::sync::Arc;
use th_core::dates::SystemClock;
use th_server::{router, AppConfig, AppState};
use th_services::http::ReqwestClient;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    let _ = dotenvy::from_filename(".env.local");
    tracing_subscriber::fmt().with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))).init();

    let config = match AppConfig::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    if config.llm.agent_provider {
        tracing::warn!("LLM_PROVIDER=agent — the offline agent stand-in will answer every model call (SIMULATED analysis).");
    }
    let http = match ReqwestClient::new() {
        Ok(c) => Arc::new(c),
        Err(e) => {
            eprintln!("Failed to build the HTTP client: {e}");
            std::process::exit(1);
        }
    };
    let port = config.port;
    let state = AppState::new(config, http, Arc::new(SystemClock));
    let app = router(state);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Failed to bind {addr}: {e}");
            std::process::exit(1);
        }
    };
    tracing::info!("Tribunal Harness listening on http://{addr}");
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("Server error: {e}");
        std::process::exit(1);
    }
}
