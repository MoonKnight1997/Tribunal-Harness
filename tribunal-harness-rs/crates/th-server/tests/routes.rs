//! Route replay: every request the TypeScript generator sent to the Next.js
//! route handlers (`fixtures/routes/responses.json`) is sent to the Axum
//! router and the status + JSON body must match byte-for-byte (key order
//! included). Time-dependent values are pinned with a fixed clock at the
//! fixture's `generated_today` / `now_seconds`.

mod common;

use common::*;
use serde_json::{json, Value};
use std::sync::Arc;
use th_core::dates::FixedClock;
use th_server::routes::meta::{sitemap_entries, sitemap_xml, ROBOTS_TXT};
use th_server::testkit::{call, get, post_json, post_multipart, post_raw, MultipartPart};
use th_services::http::MockHttp;

fn fixture() -> Value {
    load("routes/responses.json")
}

fn today(f: &Value) -> Arc<FixedClock> {
    clock_at(f["generated_today"].as_str().unwrap())
}

/// A hermetic app: agent stand-in on/off, upstream unreachable (the generator
/// left its fetch stub in "reject" mode for the analyse/debate sections).
fn app(f: &Value, agent: bool, tag: &str) -> axum::Router {
    build_app(hermetic_config(agent, tag), MockHttp::transport_error(), today(f))
}

/// `{ body }` → JSON POST; `{ raw_body }` → raw string POST.
fn post_case(uri: &str, case: &Value, extra: &[(&str, &str)]) -> axum::http::Request<axum::body::Body> {
    match case.get("raw_body") {
        Some(raw) => post_raw(uri, raw.as_str().unwrap().to_string(), "application/json", extra),
        None => post_json(uri, &case["body"], extra),
    }
}

#[tokio::test]
async fn schema_routes() {
    let f = fixture();
    let app = app(&f, true, "schema");
    for c in f["routes"]["schema"].as_array().unwrap() {
        let ct = c["claim_type"].as_str().unwrap();
        let uri = if ct.is_empty() { "/api/schema/".to_string() } else { format!("/api/schema/{ct}") };
        let res = call(&app, get(&uri)).await;
        assert_response(&res, &c["response"], &format!("schema {ct:?}"));
    }
}

#[tokio::test]
async fn deadlines_routes() {
    let f = fixture();
    let app = app(&f, true, "deadlines");
    for (i, c) in f["routes"]["deadlines"].as_array().unwrap().iter().enumerate() {
        let res = call(&app, post_case("/api/deadlines", c, &[])).await;
        assert_response(&res, &c["response"], &format!("deadlines case {i}: {}", c.get("body").map(|b| b.to_string()).unwrap_or_default()));
    }
}

#[tokio::test]
async fn tracker_and_roadmap_routes() {
    let f = fixture();
    let app = app(&f, true, "roadmap");
    let res = call(&app, get("/api/era-2025/tracker")).await;
    assert_response(&res, &f["routes"]["tracker"], "tracker");
    let res = call(&app, get("/api/roadmap/case-123")).await;
    assert_response(&res, &f["routes"]["roadmap_case"], "roadmap case");
    for (i, c) in f["routes"]["roadmap_post"].as_array().unwrap().iter().enumerate() {
        let res = call(&app, post_case("/api/roadmap", c, &[])).await;
        assert_response(&res, &c["response"], &format!("roadmap post case {i}: {}", c.get("body").map(|b| b.to_string()).unwrap_or_default()));
    }
}

#[tokio::test]
async fn case_law_search_routes() {
    let f = fixture();
    let app = app(&f, true, "cls");
    for c in f["routes"]["case_law_search"].as_array().unwrap() {
        let qs = c["query"].as_str().unwrap();
        let res = call(&app, get(&format!("/api/case-law/search{qs}"))).await;
        assert_response(&res, &c["response"], &format!("case-law search {qs:?}"));
    }
}

#[tokio::test]
async fn case_law_find_and_judgment_routes() {
    let f = fixture();
    // The generator recorded only the fetch-mode kind; the feed / status per
    // case mirrors its call list.
    let find_modes = ["reject", "ok:FEED", "status:503", "ok:FEED_VARIANT", "ok:EMPTY_FEED", "reject", "abort"];
    for (c, mode) in f["routes"]["case_law_find"].as_array().unwrap().iter().zip(find_modes) {
        assert!(mode.starts_with(c["mode"].as_str().unwrap()), "mode kind mismatch");
        let http = mock_for_mode(mode);
        let app = build_app(hermetic_config(true, "find"), http.clone(), today(&f));
        let qs = c["query"].as_str().unwrap();
        let res = call(&app, get(&format!("/api/case-law/find{qs}"))).await;
        assert_response(&res, &c["response"], &format!("case-law find {qs:?} ({mode})"));
        assert_eq!(json!(http.urls()), c["fetched"], "fetched urls for find {qs:?}");
    }
    let judgment_modes = ["reject", "pdf:sample", "pdf:sample", "status:503", "reject"];
    for (c, mode) in f["routes"]["case_law_judgment"].as_array().unwrap().iter().zip(judgment_modes) {
        assert!(mode.starts_with(c["mode"].as_str().unwrap()), "mode kind mismatch");
        let http = mock_for_mode(mode);
        let app = build_app(hermetic_config(true, "judgment"), http.clone(), today(&f));
        let qs = c["query"].as_str().unwrap();
        let res = call(&app, get(&format!("/api/case-law/judgment{qs}"))).await;
        let context = format!("case-law judgment {qs:?} ({mode})");
        assert_eq!(res.status as u64, c["response"]["status"].as_u64().unwrap(), "{context}");
        let body = res.json();
        let expected = &c["response"]["body"];
        if body["status"] == json!("ok") {
            // PDF text: same words, whitespace differs between pdf-extract and pdf.js (PARITY F9).
            assert_eq!(body["slug"], expected["slug"], "{context}");
            assert_eq!(body["pages"], expected["pages"], "{context}");
            assert_eq!(body["sourceUrl"], expected["sourceUrl"], "{context}");
            assert_eq!(normalise_ws(body["markdown"].as_str().unwrap()), normalise_ws(expected["markdown"].as_str().unwrap()), "{context}");
        } else {
            assert_json_eq(&body, expected, &context);
        }
        assert_eq!(json!(http.urls()), c["fetched"], "fetched urls for judgment {qs:?}");
    }
}

#[tokio::test]
async fn request_access_routes_and_persistence() {
    let f = fixture();
    let config = hermetic_config(true, "ra");
    let data_dir = config.data_dir.clone();
    let app = build_app(config, MockHttp::transport_error(), today(&f));
    for (i, c) in f["routes"]["request_access"].as_array().unwrap().iter().enumerate() {
        let res = call(&app, post_case("/api/request-access", c, &[])).await;
        assert_response(&res, &c["response"], &format!("request-access case {i}: {}", c.get("body").map(|b| b.to_string()).unwrap_or_default()));
    }
    let persisted = std::fs::read_to_string(data_dir.join("access-requests.jsonl")).expect("persisted leads");
    let lines: Vec<Value> = persisted
        .trim()
        .lines()
        .map(|l| {
            let mut v: Value = serde_json::from_str(l).unwrap();
            assert!(v["timestamp"].as_str().unwrap().ends_with('Z'));
            v["timestamp"] = json!("<iso-timestamp>");
            v
        })
        .collect();
    assert_json_eq(&json!(lines), &f["routes"]["request_access_persisted"], "persisted leads");
    let _ = std::fs::remove_dir_all(&data_dir);
}

#[tokio::test]
async fn webhook_routes() {
    let f = fixture();
    for c in f["routes"]["webhook"].as_array().unwrap() {
        let label = c["label"].as_str().unwrap();
        let mut config = hermetic_config(true, "webhook");
        config.webhook_secret = c["secret_env"].as_str().map(String::from);
        // The generator recorded `now_seconds = floor(Date.now() / 1000)` and
        // then handled the request a few hundred ms later, so the ±300 s
        // window boundary fell mid-second: `edge-299` was accepted, `edge-300`
        // rejected. Replaying at +500 ms reproduces every recorded verdict
        // with the same `<= REPLAY_WINDOW_MS` rule.
        let now_ms = c["now_seconds"].as_i64().unwrap() * 1000 + 500;
        let app = build_app(config, MockHttp::transport_error(), Arc::new(FixedClock(now_ms)));
        let mut headers: Vec<(&str, &str)> = vec![];
        if let Some(sig) = c["sig"].as_str() {
            headers.push(("x-webhook-signature", sig));
        }
        if let Some(ts) = c["ts"].as_str() {
            headers.push(("x-webhook-timestamp", ts));
        }
        let res = call(&app, post_raw("/api/webhook", c["raw"].as_str().unwrap().to_string(), "application/json", &headers)).await;
        assert_response(&res, &c["response"], &format!("webhook {label}"));
    }
}

#[tokio::test]
async fn analyse_routes() {
    let f = fixture();
    let mut ip = 0u32;
    let mut xff = || {
        ip += 1;
        format!("10.0.0.{ip}")
    };
    // 400s (agent on, never reached) — degraded (no client) — agent stand-in.
    let app_agent = app(&f, true, "analyse-agent");
    for (i, c) in f["routes"]["analyse_400"].as_array().unwrap().iter().enumerate() {
        let h = xff();
        let res = call(&app_agent, post_json("/api/analyse", &c["body"], &[("x-forwarded-for", &h)])).await;
        assert_response(&res, &c["response"], &format!("analyse 400 case {i}: {}", c["body"]));
    }
    let app_degraded = app(&f, false, "analyse-degraded");
    for (i, c) in f["routes"]["analyse_degraded"].as_array().unwrap().iter().enumerate() {
        let h = xff();
        let res = call(&app_degraded, post_json("/api/analyse", &c["body"], &[("x-forwarded-for", &h)])).await;
        assert_response(&res, &c["response"], &format!("analyse degraded case {i}: {}", c["body"]["claim_type"]));
    }
    for (i, c) in f["routes"]["analyse_agent"].as_array().unwrap().iter().enumerate() {
        let h = xff();
        let res = call(&app_agent, post_json("/api/analyse", &c["body"], &[("x-forwarded-for", &h)])).await;
        assert_response(&res, &c["response"], &format!("analyse agent case {i}: {}", c["body"]["claim_type"]));
    }
    // Rate limit: the 11th call from one key → 429.
    let mut last = None;
    for _ in 0..11 {
        last = Some(call(&app_agent, post_json("/api/analyse", &json!({ "claim_type": "unfair_dismissal" }), &[("x-forwarded-for", "203.0.113.7, 198.51.100.1")])).await);
    }
    assert_response(&last.unwrap(), &f["routes"]["analyse_rate_limited_11th"], "analyse rate limited");
    let res = call(&app_agent, post_raw("/api/analyse", "{bad", "application/json", &[("x-forwarded-for", "10.9.9.9")])).await;
    assert_response(&res, &f["routes"]["analyse_bad_json"], "analyse bad json");
}

fn triage_parts(label: &str) -> Vec<MultipartPart> {
    let txt = load_text("documents/sample.txt");
    let pdf = load_bytes("documents/sample.pdf");
    let docx = load_bytes("documents/sample.docx");
    match label {
        "no-document" => vec![],
        "string-document" => vec![MultipartPart::text("document", "I am a string, not a file")],
        "oversize" => vec![MultipartPart::file("document", "big.txt", "text/plain", "a".repeat(10 * 1024 * 1024 + 1))],
        "unsupported-ext" => vec![MultipartPart::file("document", "evidence.exe", "application/octet-stream", "binary-ish content")],
        "uppercase-ext-agent" => vec![MultipartPart::file("document", "NOTES.TXT", "text/plain", txt)],
        "txt-agent" => vec![MultipartPart::file("document", "sample.txt", "text/plain", txt)],
        "pdf-agent" | "pdf-degraded" => vec![MultipartPart::file("document", "sample.pdf", "application/pdf", pdf)],
        "docx-agent" => vec![MultipartPart::file("document", "sample.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx)],
        "docx-degraded" => vec![MultipartPart::file("document", "sample.docx", "application/octet-stream", docx)],
        "pdf-corrupt" => vec![MultipartPart::file("document", "bad.pdf", "application/pdf", "%PDF-1.4 garbage")],
        "docx-corrupt" => vec![MultipartPart::file("document", "bad.docx", "application/octet-stream", "PK garbage")],
        "txt-agent-with-schema-state" => {
            vec![MultipartPart::file("document", "sample.txt", "text/plain", txt), MultipartPart::text("schema_state", "{\"claim_type\":\"unfair_dismissal\"}")]
        }
        "txt-agent-long" | "txt-degraded-long" => vec![MultipartPart::file("document", "long.txt", "text/plain", txt.repeat(80))],
        "txt-degraded" => vec![MultipartPart::file("document", "narrative.txt", "text/plain", "I was dismissed on 14 January 2025 without any disciplinary process.")],
        other => panic!("unknown triage label {other}"),
    }
}

#[tokio::test]
async fn triage_routes() {
    let f = fixture();
    let app_agent = app(&f, true, "triage-agent");
    let app_degraded = app(&f, false, "triage-degraded");
    for c in f["routes"]["triage"].as_array().unwrap() {
        let label = c["label"].as_str().unwrap();
        let app = if label.contains("degraded") { &app_degraded } else { &app_agent };
        let res = call(app, post_multipart("/api/triage", &triage_parts(label))).await;
        let context = format!("triage {label}");
        if label == "pdf-degraded" {
            // pdf-extract vs pdf.js: same words, different whitespace, so the
            // character count and the extracted text differ (PARITY R2 `[partial]`).
            assert_eq!(res.status as u64, c["response"]["status"].as_u64().unwrap(), "{context}");
            let body = res.json();
            let expected = &c["response"]["body"];
            assert_eq!(body.as_object().unwrap().keys().collect::<Vec<_>>(), expected.as_object().unwrap().keys().collect::<Vec<_>>(), "{context}: keys");
            assert_eq!(body["updated_fields"], expected["updated_fields"]);
            assert_eq!(body["query_array"], expected["query_array"]);
            assert_eq!(body["refinement"], expected["refinement"]);
            assert!(
                body["document_summary"].as_str().unwrap().starts_with("Extracted ")
                    && body["document_summary"].as_str().unwrap().ends_with(" characters from sample.pdf. AI triage requires an Anthropic API key.")
            );
            assert_eq!(normalise_ws(body["extracted_text"].as_str().unwrap()), normalise_ws(expected["extracted_text"].as_str().unwrap()), "{context}: extracted text words");
        } else {
            assert_response(&res, &c["response"], &context);
        }
    }
}

#[tokio::test]
async fn debate_routes() {
    let f = fixture();
    let app_agent = app(&f, true, "debate-agent");
    let app_degraded = app(&f, false, "debate-degraded");
    for (i, c) in f["routes"]["debate"].as_array().unwrap().iter().enumerate() {
        let app = if c["no_client"] == json!(true) { &app_degraded } else { &app_agent };
        let h = format!("10.1.0.{}", i + 1);
        let res = call(app, post_json("/api/debate", &c["body"], &[("x-forwarded-for", &h)])).await;
        assert_response(&res, &c["response"], &format!("debate case {i}: {}", c["body"]));
    }
    let res = call(&app_agent, post_raw("/api/debate", "{bad", "application/json", &[("x-forwarded-for", "10.9.9.8")])).await;
    assert_response(&res, &f["routes"]["debate_bad_json"], "debate bad json");
}

#[tokio::test]
async fn sitemap_robots_redirects_and_404() {
    let f = fixture();
    let clock = today(&f);
    let app = build_app(hermetic_config(true, "meta"), MockHttp::transport_error(), clock.clone());

    // sitemap.ts entries
    let expected_entries = load("ui/sitemap.json");
    let mut entries = json!(sitemap_entries(clock.0));
    for e in entries.as_array_mut().unwrap() {
        e["lastModified"] = json!("<now>");
    }
    assert_json_eq(&entries, &expected_entries, "sitemap entries");

    // rendered sitemap.xml (lastmod varies)
    let res = call(&app, get("/sitemap.xml")).await;
    assert_eq!(res.status, 200);
    assert!(res.header("content-type").unwrap_or("").starts_with("application/xml"));
    let strip_lastmod = |s: &str| -> String { s.lines().filter(|l| !l.starts_with("<lastmod>")).collect::<Vec<_>>().join("\n") };
    assert_eq!(strip_lastmod(&res.text()), strip_lastmod(&load_text("pages/sitemap.xml")));
    assert_eq!(strip_lastmod(&sitemap_xml(clock.0)), strip_lastmod(&load_text("pages/sitemap.xml")));

    // robots.txt
    let res = call(&app, get("/robots.txt")).await;
    assert_eq!(res.status, 200);
    assert_eq!(res.text(), load_text("pages/robots.txt"));
    assert_eq!(ROBOTS_TXT, load_text("pages/robots.txt"));

    // legacy-path redirects (307)
    for (from, to) in [("/analysis", "/analysis-engine"), ("/case-law", "/case-law-db"), ("/docs", "/documentation")] {
        let res = call(&app, get(from)).await;
        assert_eq!(res.status, 307, "{from}");
        assert_eq!(res.header("location"), Some(to), "{from}");
    }

    // 404
    let res = call(&app, get("/this-does-not-exist")).await;
    assert_eq!(res.status, 404);
    assert!(res.text().contains("This page could not be found."));
    let res = call(&app, get("/api/nope")).await;
    assert_eq!(res.status, 404);
}
