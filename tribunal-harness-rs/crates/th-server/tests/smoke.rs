//! The Rust smoke harness must produce the same section results (statuses,
//! checks and extracts) as the TypeScript `npm run smoke` report recorded in
//! `fixtures/smoke/ts-smoke-report.json` (timings and environment excluded).

mod common;

use common::*;
use serde_json::{json, Value};
use std::sync::Arc;
use th_server::smoke;
use th_services::http::NoNetwork;

fn sections<'a>(r: &'a smoke::Report) -> [(&'static str, &'a smoke::SectionReport); 7] {
    [
        ("schema_lookup", &r.schema_lookup),
        ("triage", &r.triage),
        ("analyse", &r.analyse),
        ("deadlines", &r.deadlines),
        ("case_law_search", &r.case_law_search),
        ("era_2025_tracker", &r.era_2025_tracker),
        ("debate", &r.debate),
    ]
}

#[tokio::test]
async fn smoke_run_matches_typescript_report() {
    let expected = load("smoke/ts-smoke-report.json");
    // Pin "today" to the TS run's date so days_remaining agrees.
    let ts_date = &expected["environment"]["timestamp"].as_str().unwrap()[..10];
    let app = build_app(hermetic_config(true, "smoke"), Arc::new(NoNetwork), clock_at(ts_date));
    let report = smoke::run(&app, "agent", false).await;

    for (name, sec) in sections(&report) {
        let exp = &expected[name];
        assert_eq!(sec.status, "OK", "section {name}: {:?}", sec.checks);
        assert_eq!(sec.status, exp["status"].as_str().unwrap(), "section {name} status");
        assert_eq!(json!(sec.http_status), exp["http_status"], "section {name} http_status");
        assert_json_eq(&to_value(&sec.checks), &exp["checks"], &format!("section {name} checks"));
        assert_json_eq(&to_value(&sec.extract), &exp["extract"], &format!("section {name} extract"));
        // Raw bodies are compared field-by-field in the route replay; here
        // only the tracker/deadline raw bodies are deterministic enough.
        if name == "era_2025_tracker" || name == "deadlines" {
            assert_json_eq(&to_value(&sec.raw), &exp["raw"], &format!("section {name} raw"));
        }
    }
    let s = &report.summary;
    assert_eq!(json!({ "ok": s.ok, "fail": s.fail, "total": s.total, "overall_status": s.overall_status }), json!({ "ok": 7, "fail": 0, "total": 7, "overall_status": "PASS" }));
    assert_eq!(expected["summary"]["overall_status"], json!("PASS"));

    // The Markdown report has the same structure (section headings) as the TS one.
    let md = smoke::render_markdown(&report);
    let heads = |s: &str| s.lines().filter(|l| l.starts_with("## ")).map(str::to_string).collect::<Vec<_>>();
    assert_eq!(heads(&md), heads(&load_text("smoke/ts-smoke-report.md")));
    assert!(md.contains("**Overall status: ✅ PASS**"));
    let _: Value = serde_json::to_value(&report).unwrap();
}
