//! `cargo run --bin smoke` — hermetic end-to-end smoke run (no API key, no
//! network): the offline agent stand-in answers every model call and the
//! network transport is disabled. Writes `smoke-report.json` and
//! `smoke-report.md` to the current directory; exits 0 iff every section is OK.

use std::sync::Arc;
use th_core::dates::SystemClock;
use th_server::{router, smoke, AppConfig, AppState};
use th_services::http::NoNetwork;

#[tokio::main]
async fn main() {
    let _ = dotenvy::from_filename(".env.local");
    // IMPORTANT: the provider is forced to the stand-in, as `npm run smoke` does.
    let provider = std::env::var("LLM_PROVIDER").ok().filter(|v| !v.is_empty()).unwrap_or_else(|| "agent".to_string());
    let api_key_present = std::env::var("ANTHROPIC_API_KEY").map(|v| !v.is_empty()).unwrap_or(false);
    let mut config = AppConfig::from_env().unwrap_or_else(|e| {
        eprintln!("[smoke] fatal: {e}");
        std::process::exit(1);
    });
    config.llm.agent_provider = provider == "agent";
    let state = AppState::new(config, Arc::new(NoNetwork), Arc::new(SystemClock));
    let app = router(state);

    let report = smoke::run(&app, &provider, api_key_present).await;
    let cwd = std::env::current_dir().expect("cwd");
    let json_path = cwd.join("smoke-report.json");
    let md_path = cwd.join("smoke-report.md");
    std::fs::write(&json_path, serde_json::to_string_pretty(&report).expect("serialise")).expect("write smoke-report.json");
    std::fs::write(&md_path, smoke::render_markdown(&report)).expect("write smoke-report.md");

    let s = &report.summary;
    let sections = [&report.schema_lookup, &report.triage, &report.analyse, &report.deadlines, &report.case_law_search, &report.era_2025_tracker, &report.debate];
    let failures: Vec<&str> = sections.iter().filter(|x| x.status == "FAIL").map(|x| x.name.as_str()).collect();
    if s.overall_status == "PASS" {
        println!("[smoke] PASS — {}/{} sections OK in {}ms", s.ok, s.total, s.duration_ms);
    } else {
        println!("[smoke] FAIL — {}/{} failing: {}", s.fail, s.total, failures.join(", "));
    }
    println!("[smoke] wrote {}", json_path.display());
    println!("[smoke] wrote {}", md_path.display());
    std::process::exit(if s.overall_status == "PASS" { 0 } else { 1 });
}
