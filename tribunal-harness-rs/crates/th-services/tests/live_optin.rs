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

use std::sync::Arc;
use th_core::dates::SystemClock;
use th_core::find_case_law::{LookupStatus, VerifySource};
use th_core::types::TrustLevel;
use th_services::http::ReqwestClient;
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
