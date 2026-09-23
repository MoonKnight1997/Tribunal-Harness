//! Shared helpers for the th-server fixture tests.
#![allow(dead_code)]

use serde_json::Value;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use th_core::dates::{CivilDate, FixedClock};
use th_server::testkit::Captured;
use th_server::{router, AppConfig, AppState};
use th_services::http::{HttpClient, HttpError, HttpResponse, MockHttp};

pub fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

pub fn load(rel: &str) -> Value {
    let p = fixtures_dir().join(rel);
    let text = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", p.display()))
}

pub fn load_bytes(rel: &str) -> Vec<u8> {
    let p = fixtures_dir().join(rel);
    std::fs::read(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()))
}

pub fn load_text(rel: &str) -> String {
    String::from_utf8(load_bytes(rel)).expect("utf-8 fixture")
}

/// Compare two JSON values as their compact serialisation (checks key order).
#[track_caller]
pub fn assert_json_eq(actual: &Value, expected: &Value, context: &str) {
    let a = serde_json::to_string(actual).unwrap();
    let e = serde_json::to_string(expected).unwrap();
    if a != e {
        let idx = a.bytes().zip(e.bytes()).position(|(x, y)| x != y).unwrap_or(a.len().min(e.len()));
        let lo = idx.saturating_sub(160);
        panic!(
            "JSON mismatch ({context})\n  first difference at byte {idx}\n  actual  : …{}…\n  expected: …{}…",
            &a[lo..(idx + 220).min(a.len())],
            &e[lo..(idx + 220).min(e.len())]
        );
    }
}

pub fn to_value<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap()
}

pub fn normalise_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s.bytes().enumerate().all(|(i, b)| if matches!(i, 8 | 13 | 18 | 23) { b == b'-' } else { b.is_ascii_hexdigit() })
}

/// Compare a captured response with a recorded `{ status, body }`. A recorded
/// `request_id: "<uuid>"` only checks the shape of the actual id.
#[track_caller]
pub fn assert_response(actual: &Captured, expected: &Value, context: &str) {
    assert_eq!(actual.status as u64, expected["status"].as_u64().unwrap(), "{context}: status (body: {})", actual.text());
    let mut body = actual.json();
    if expected["body"]["request_id"] == Value::String("<uuid>".into()) {
        let id = body["request_id"].as_str().unwrap_or("").to_string();
        assert!(is_uuid(&id), "{context}: request_id {id:?} is not a UUID");
        body["request_id"] = Value::String("<uuid>".into());
    }
    assert_json_eq(&body, &expected["body"], context);
}

/// A fresh temp data dir for request-access persistence.
pub fn temp_data_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("th-server-tests-{}-{tag}-{}", std::process::id(), rand_suffix()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn rand_suffix() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
}

pub fn clock_at(iso_date: &str) -> Arc<FixedClock> {
    Arc::new(FixedClock::at_date(CivilDate::parse_utc(iso_date).expect("iso date")))
}

pub fn hermetic_config(agent: bool, tag: &str) -> AppConfig {
    let mut c = AppConfig::hermetic(temp_data_dir(tag));
    c.llm.agent_provider = agent;
    c
}

pub fn build_app(config: AppConfig, http: Arc<dyn HttpClient>, clock: Arc<FixedClock>) -> axum::Router {
    router(AppState::new(config, http, clock))
}

/// Scripted HTTP client reproducing the generator's `FetchMode` for a label.
pub fn mock_for_mode(mode: &str) -> Arc<MockHttp> {
    let mode = mode.to_string();
    let feeds = load("find-case-law/feeds.json");
    let pdf = load_bytes("documents/sample.pdf");
    let calls = AtomicUsize::new(0);
    MockHttp::new(move |_req| {
        let n = calls.fetch_add(1, Ordering::SeqCst);
        let pdf_resp = |content_length: Option<&str>| {
            let headers = content_length.map(|v| vec![("content-length".to_string(), v.to_string())]).unwrap_or_default();
            Ok(HttpResponse { status: 200, headers, body: pdf.clone() })
        };
        let redirect = |loc: &str| Ok(HttpResponse { status: 302, headers: vec![("location".to_string(), loc.to_string())], body: vec![] });
        if let Some(feed) = mode.strip_prefix("ok:") {
            let body = feeds[feed].as_str().unwrap_or_else(|| panic!("feed {feed} missing")).to_string();
            return Ok(HttpResponse { status: 200, headers: vec![], body: body.into_bytes() });
        }
        if let Some(code) = mode.strip_prefix("status:") {
            return Ok(HttpResponse { status: code.parse().unwrap(), headers: vec![], body: vec![] });
        }
        match mode.as_str() {
            "abort" => Err(HttpError::Timeout),
            "reject" => Err(HttpError::Transport("connection refused".into())),
            "pdf:sample" => pdf_resp(None),
            "pdf:too-large-header" => pdf_resp(Some("103809024")),
            "pdf:not-pdf" => Ok(HttpResponse { status: 200, headers: vec![], body: b"not a pdf at all".to_vec() }),
            "redirect:forbidden" => redirect("https://169.254.169.254/latest/meta-data"),
            "redirect:allowed" => {
                if n == 0 {
                    redirect("https://assets.caselaw.nationalarchives.gov.uk/final.pdf")
                } else {
                    pdf_resp(None)
                }
            }
            "redirect:relative" => {
                if n == 0 {
                    redirect("/relative/final.pdf")
                } else {
                    pdf_resp(None)
                }
            }
            other => panic!("unknown fetch mode {other}"),
        }
    })
}
