//! OPT-IN LIVE CHECKS — NOT part of the hermetic suite.
//!
//! These hit The National Archives Find Case Law over the network. They are
//! `#[ignore]`d and additionally skip themselves unless `RUN_LIVE_CASELAW=1`
//! is set, so `cargo test` never touches the network:
//!
//! ```bash
//! RUN_LIVE_CASELAW=1 cargo test -p th-services --test live_optin -- --ignored --nocapture
//! ```
//!
//! They assert only stable properties (status is not an upstream failure; the
//! landmark Essop citation verifies), never a specific result set.
//!
//! The Muse Spark check calls Meta's Model API with `MODEL_API_KEY` and is
//! likewise gated behind `RUN_LIVE_MUSE=1`:
//!
//! ```bash
//! RUN_LIVE_MUSE=1 MODEL_API_KEY=... cargo test -p th-services --test live_optin -- --ignored --nocapture
//! ```

use std::sync::Arc;
use th_core::dates::SystemClock;
use th_core::find_case_law::{LookupStatus, VerifySource};
use th_core::types::TrustLevel;
use th_services::claude_client::{CallClaudeParams, LlmClient, LlmConfig};
use th_services::http::ReqwestClient;
use th_services::muse::MuseConfig;
use th_services::tna::{SearchOptions, TnaClient};

fn live_enabled() -> bool {
    std::env::var("RUN_LIVE_CASELAW").map(|v| v == "1").unwrap_or(false)
}

fn client() -> TnaClient {
    TnaClient::new(Arc::new(ReqwestClient::new().expect("reqwest client")), Arc::new(SystemClock))
}

#[tokio::test]
#[ignore = "live network check; set RUN_LIVE_CASELAW=1 and pass --ignored"]
async fn live_find_case_law_search() {
    if !live_enabled() {
        eprintln!("RUN_LIVE_CASELAW not set — skipping live search");
        return;
    }
    let env = client().search_case_law(&SearchOptions { query: "unfair dismissal".into(), court: Some("eat".into()), limit: Some(5), ..Default::default() }).await;
    eprintln!("live search status: {:?} ({} results)", env.status, env.results.len());
    assert!(matches!(env.status, LookupStatus::Ok | LookupStatus::Empty), "upstream failure: {:?} {:?}", env.status, env.detail);
}

#[tokio::test]
#[ignore = "live network check; set RUN_LIVE_CASELAW=1 and pass --ignored"]
async fn live_verify_landmark_citation() {
    if !live_enabled() {
        eprintln!("RUN_LIVE_CASELAW not set — skipping live verify");
        return;
    }
    let r = client().verify_citation(Some("[2017] UKSC 27"), Some("Essop v Home Office")).await;
    eprintln!("live verify: {:?}", r);
    assert_eq!(r.source, VerifySource::FindCaseLaw, "upstream unavailable: {}", r.reason);
    assert_eq!(r.trust_level, TrustLevel::Verified, "{}", r.reason);
}

/// One real `triage`-configured call to Muse Spark through the same client the
/// routes use. Asserts only that the call succeeds, reports usage, and that
/// the model followed a trivial JSON instruction.
#[tokio::test]
#[ignore = "live network check; set RUN_LIVE_MUSE=1 and MODEL_API_KEY, then pass --ignored"]
async fn live_muse_spark_responses_call() {
    if std::env::var("RUN_LIVE_MUSE").map(|v| v != "1").unwrap_or(true) {
        eprintln!("RUN_LIVE_MUSE not set — skipping live Muse Spark call");
        return;
    }
    let Some(muse) = MuseConfig::from_env() else {
        eprintln!("MODEL_API_KEY not set — skipping live Muse Spark call");
        return;
    };
    let llm = LlmClient::new(LlmConfig { muse: Some(muse), ..Default::default() }, Arc::new(ReqwestClient::new().expect("reqwest client")), Arc::new(SystemClock));
    let r = llm
        .call_claude(CallClaudeParams {
            endpoint: "triage",
            system: "Reply with exactly the JSON object {\"ok\":true} and nothing else.",
            user_message: "ping",
            prompt_version: "live-check",
            config_override: None,
        })
        .await
        .expect("Model API call failed")
        .expect("client unavailable");
    eprintln!("live muse: model={} usage={:?} content={:?}", r.debug.model, r.usage, r.content);
    assert!(r.usage.output_tokens > 0);
    let json_slice = match (r.content.find('{'), r.content.rfind('}')) {
        (Some(a), Some(b)) if b > a => &r.content[a..=b],
        _ => "",
    };
    let v: serde_json::Value = serde_json::from_str(json_slice).unwrap_or(serde_json::Value::Null);
    assert_eq!(v["ok"], serde_json::Value::Bool(true), "unexpected content: {}", r.content);
}
