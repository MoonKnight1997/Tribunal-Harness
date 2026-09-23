//! Fixture-diff tests for th-services: every network-facing service replayed
//! against the canned upstream responses the TypeScript suite recorded
//! (`fixtures/`). No test here touches the network.

mod common;

use common::*;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use th_core::dates::FixedClock;
use th_core::prompts::{versions, CRITIC_PROMPT_V2, LEGAL_WRITING_REFINEMENT_PROMPT_V1};
use th_core::refinement::RefineEndpoint;
use th_services::citation_authority::{validate_all_citations_authoritative, validate_citation_authoritative};
use th_services::claude_client::{CallClaudeParams, ClaudeError, ConfigOverride, LlmClient, LlmConfig};
use th_services::docx::extract_raw_text;
use th_services::http::{HttpError, HttpResponse, MockHttp};
use th_services::pdf_to_markdown::{fetch_pdf_as_markdown, is_allowed_pdf_url, looks_like_pdf, pdf_buffer_to_markdown, tidy_to_markdown, PdfStatus};
use th_services::refinement::refine_for_user;
use th_services::tna::{SearchOptions, TnaClient};
use th_core::claude_config::ThinkingConfig;

fn clock() -> Arc<FixedClock> {
    Arc::new(FixedClock(0))
}

/// Scripted HTTP client reproducing the generator's `FetchMode` for a mode label.
fn mock_for_mode(mode: &str, feeds: &Value) -> Arc<MockHttp> {
    let mode = mode.to_string();
    let feeds = feeds.clone();
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

// ─── Find Case Law ────────────────────────────────────────────────────────

#[tokio::test]
async fn find_case_law_search_cases() {
    let feeds = load("find-case-law/feeds.json");
    let f = load("find-case-law/search.json");
    for c in f["cases"].as_array().unwrap() {
        let mode = c["mode"].as_str().unwrap();
        let http = mock_for_mode(mode, &feeds);
        let tna = TnaClient::new(http.clone(), clock());
        let o = &c["opts"];
        let opts = SearchOptions {
            query: o["query"].as_str().unwrap().to_string(),
            court: o["court"].as_str().map(String::from),
            party: o["party"].as_str().map(String::from),
            limit: o["limit"].as_u64().map(|v| v as usize),
            page: o["page"].as_u64().map(|v| v as u32),
            timeout_ms: None,
        };
        let env = tna.search_case_law(&opts).await;
        assert_json_eq(&to_value(&env), &c["result"], &format!("search {mode} {o}"));
        assert_eq!(json!(http.urls()), c["fetched"], "fetched urls for search {mode} {o}");
    }
}

#[tokio::test]
async fn find_case_law_verify_cases_and_cache() {
    let feeds = load("find-case-law/feeds.json");
    let f = load("find-case-law/verify.json");
    for c in f["cases"].as_array().unwrap() {
        let mode = c["mode"].as_str().unwrap();
        let http = mock_for_mode(mode, &feeds);
        let tna = TnaClient::new(http.clone(), clock());
        let input = &c["input"];
        let r = tna.verify_citation(input["citation"].as_str(), input["caseName"].as_str()).await;
        assert_json_eq(&to_value(&r), &c["result"], &format!("verify {mode} {input}"));
        assert_eq!(json!(http.urls()), c["fetched"], "fetched urls for verify {mode} {input}");
    }
    // 1-hour cache: second call answered from cache even though upstream now times out.
    let feed = feeds["FEED"].as_str().unwrap().to_string();
    let calls = AtomicUsize::new(0);
    let http = MockHttp::new(move |_| {
        if calls.fetch_add(1, Ordering::SeqCst) == 0 {
            Ok(HttpResponse { status: 200, headers: vec![], body: feed.clone().into_bytes() })
        } else {
            Err(HttpError::Timeout)
        }
    });
    let tna = TnaClient::new(http.clone(), clock());
    let first = tna.verify_citation(Some("[2017] UKSC 27"), Some("Essop v Home Office")).await;
    let second = tna.verify_citation(Some("[2017] UKSC 27"), Some("Essop v Home Office")).await;
    assert_json_eq(&to_value(&first), &f["cache"]["first"], "cache first");
    assert_json_eq(&to_value(&second), &f["cache"]["second"], "cache second");
    assert_eq!(http.call_count() as u64, f["cache"]["fetch_calls_total"].as_u64().unwrap());
}

#[tokio::test]
async fn authoritative_validation_cases() {
    let feeds = load("find-case-law/feeds.json");
    let f = load("citations/authoritative.json");
    for c in f["cases"].as_array().unwrap() {
        let mode = c["mode"].as_str().unwrap();
        let http = mock_for_mode(mode, &feeds);
        let tna = TnaClient::new(http.clone(), clock());
        let citation = c["input"]["citation"].as_str().unwrap();
        let name = c["input"]["name"].as_str();
        let r = validate_citation_authoritative(&tna, citation, name).await;
        assert_json_eq(&to_value(&r), &c["result"], &format!("authoritative {mode} {citation:?}"));
        assert_eq!(http.call_count() as u64, c["fetched"].as_u64().unwrap(), "fetch count {mode} {citation:?}");
    }
    let tna = TnaClient::new(mock_for_mode("abort", &feeds), clock());
    let inputs = vec![
        ("Polkey v AE Dayton Services Ltd [1987] UKHL 8".to_string(), Some("Polkey v AE Dayton Services Ltd".to_string())),
        ("Some Invented Case [2099] UKSC 999".to_string(), None),
        ("BHS v Burchell [1978]".to_string(), None),
    ];
    let (results, summary) = validate_all_citations_authoritative(&tna, &inputs).await;
    assert_json_eq(&json!({ "results": results, "summary": summary }), &f["batch_abort"], "batch abort");
}

// ─── PDF → Markdown ───────────────────────────────────────────────────────

#[test]
fn pdf_helpers_match_fixtures() {
    let f = load("pdf-to-markdown/cases.json");
    for c in f["tidy"].as_array().unwrap() {
        assert_eq!(tidy_to_markdown(c["input"].as_str().unwrap()), c["result"].as_str().unwrap(), "tidy {:?}", c["input"]);
    }
    for c in f["looks_like_pdf"].as_array().unwrap() {
        assert_eq!(looks_like_pdf(c["input"].as_str().unwrap().as_bytes()), c["result"].as_bool().unwrap(), "looks_like_pdf {:?}", c["input"]);
    }
    for c in f["allowed_url"].as_array().unwrap() {
        assert_eq!(is_allowed_pdf_url(c["input"].as_str().unwrap()), c["result"].as_bool().unwrap(), "allowed_url {:?}", c["input"]);
    }
    assert_json_eq(&to_value(&pdf_buffer_to_markdown(b"")), &f["buffer_empty"], "buffer_empty");
    assert_json_eq(&to_value(&pdf_buffer_to_markdown(b"hello")), &f["buffer_not_pdf"], "buffer_not_pdf");
    // Corrupt input: same status; the detail carries the extractor's own
    // message (pdf.js: "Invalid PDF structure"), so only the prefix is shared.
    let corrupt = pdf_buffer_to_markdown(b"%PDF-1.4 garbage garbage");
    assert_eq!(to_value(&corrupt)["status"], f["buffer_corrupt"]["status"]);
    assert!(corrupt.detail.as_deref().unwrap_or("").starts_with("PDF parse failed: "), "{:?}", corrupt.detail);
    assert!(corrupt.markdown.is_none());
}

/// The sample PDF's text: identical words, whitespace differs between
/// pdf-extract and pdf.js (PARITY F9 — `[partial]`).
fn assert_pdf_result_matches(actual: &Value, expected: &Value, context: &str) {
    assert_eq!(actual["status"], expected["status"], "{context}: status");
    assert_eq!(actual["pages"], expected["pages"], "{context}: pages");
    assert_eq!(actual["sourceUrl"], expected["sourceUrl"], "{context}: sourceUrl");
    assert_eq!(actual["detail"], expected["detail"], "{context}: detail");
    assert_eq!(normalise_ws(actual["markdown"].as_str().unwrap_or("")), normalise_ws(expected["markdown"].as_str().unwrap_or("")), "{context}: markdown words");
}

#[test]
fn pdf_sample_buffer() {
    let f = load("pdf-to-markdown/cases.json");
    let r = pdf_buffer_to_markdown(&load_bytes("documents/sample.pdf"));
    assert_eq!(r.status, PdfStatus::Ok);
    assert_pdf_result_matches(&to_value(&r), &f["buffer_sample"], "buffer_sample");
}

#[tokio::test]
async fn pdf_fetch_and_judgment_cases() {
    let feeds = load("find-case-law/feeds.json");
    let f = load("pdf-to-markdown/cases.json");
    for c in f["fetch"].as_array().unwrap() {
        let mode = c["mode"].as_str().unwrap();
        let url = c["url"].as_str().unwrap();
        let http = mock_for_mode(mode, &feeds);
        let r = fetch_pdf_as_markdown(http.as_ref(), url, None).await;
        let actual = to_value(&r);
        let context = format!("fetch {mode} {url}");
        if r.status == PdfStatus::Ok {
            assert_pdf_result_matches(&actual, &c["result"], &context);
        } else {
            assert_json_eq(&actual, &c["result"], &context);
        }
        assert_eq!(json!(http.urls()), c["fetched"], "fetched urls {context}");
    }
    let http = mock_for_mode("pdf:sample", &feeds);
    let tna = TnaClient::new(http, clock());
    for (slug, expected) in ["eat/2026/90", "/eat/2026/90/", "", "///"].iter().zip(f["judgment"].as_array().unwrap()) {
        let r = tna.get_judgment_markdown(slug).await;
        let actual = to_value(&r);
        let context = format!("judgment {slug:?}");
        assert_eq!(actual["slug"], expected["slug"], "{context}: slug");
        if r.status == PdfStatus::Ok {
            assert_pdf_result_matches(&actual, expected, &context);
        } else {
            assert_json_eq(&actual, expected, &context);
        }
    }
}

// ─── Documents (what /api/triage extracts) ───────────────────────────────

#[test]
fn document_extraction_matches_fixtures() {
    let e = load("documents/expected-text.json");
    // DOCX: byte-for-byte equal to mammoth.extractRawText.
    let docx = extract_raw_text(&load_bytes("documents/sample.docx")).unwrap();
    assert_eq!(docx, e["docx_text"].as_str().unwrap());
    assert_eq!(e["docx_messages"].as_array().map(|a| a.len()), Some(0));
    // TXT: read as UTF-8.
    let txt = String::from_utf8(load_bytes("documents/sample.txt")).unwrap();
    assert_eq!(txt, e["txt"].as_str().unwrap());
    // PDF: same words, whitespace differs (PARITY F9 `[partial]`).
    let pdf = pdf_buffer_to_markdown(&load_bytes("documents/sample.pdf"));
    assert_eq!(pdf.status, PdfStatus::Ok);
    assert_eq!(pdf.pages, e["pdf_markdown"]["pages"].as_u64());
    assert_eq!(normalise_ws(pdf.markdown.as_deref().unwrap()), normalise_ws(e["pdf_markdown"]["markdown"].as_str().unwrap()));
    assert_eq!(normalise_ws(pdf.markdown.as_deref().unwrap()), normalise_ws(e["pdf_text_raw"].as_str().unwrap()));
}

// ─── Claude client (agent stand-in path) ─────────────────────────────────

fn strip_duration(mut v: Value) -> Value {
    v["debug"]["duration_ms"] = json!("<varies>");
    v
}

#[tokio::test]
async fn claude_client_cases() {
    let f = load("claude-client/cases.json");
    let messages = load("agent-provider/cases.json")["messages"].clone();
    let agent = LlmClient::new(LlmConfig { agent_provider: true, ..Default::default() }, MockHttp::transport_error(), clock());
    assert_eq!(agent.is_client_available(), f["available_agent"].as_bool().unwrap());

    let r1 = agent
        .call_claude(CallClaudeParams { endpoint: "analyse", system: "sys", user_message: "claim_type: unfair_dismissal", prompt_version: "v2", config_override: None })
        .await
        .unwrap()
        .unwrap();
    assert_json_eq(&strip_duration(to_value(&r1)), &f["analyse_agent"], "analyse_agent");

    let r2 = agent
        .call_claude(CallClaudeParams {
            endpoint: "critic",
            system: CRITIC_PROMPT_V2,
            user_message: messages["debate_facts"].as_str().unwrap(),
            prompt_version: versions::CRITIC,
            config_override: None,
        })
        .await
        .unwrap()
        .unwrap();
    assert_json_eq(&strip_duration(to_value(&r2)), &f["critic_agent"], "critic_agent");

    let r3 = agent
        .call_claude(CallClaudeParams {
            endpoint: "refine",
            system: LEGAL_WRITING_REFINEMENT_PROMPT_V1,
            user_message: messages["refine_ok"].as_str().unwrap(),
            prompt_version: "v1",
            config_override: Some(ConfigOverride { max_tokens: Some(1000), thinking: Some(ThinkingConfig::enabled(5000)), temperature: None }),
        })
        .await
        .unwrap()
        .unwrap();
    assert_json_eq(&strip_duration(to_value(&r3)), &f["refine_agent_override"], "refine_agent_override");

    let none = LlmClient::new(LlmConfig::default(), MockHttp::transport_error(), clock());
    assert_eq!(none.is_client_available(), f["available_none"].as_bool().unwrap());
    let r = none.call_claude(CallClaudeParams { endpoint: "analyse", system: "sys", user_message: "claim_type: unfair_dismissal", prompt_version: "v2", config_override: None }).await.unwrap();
    assert!(r.is_none());
    assert!(f["call_none"].is_null());

    let prod = LlmClient::new(LlmConfig { agent_provider: true, node_env: Some("production".into()), ..Default::default() }, MockHttp::transport_error(), clock());
    let e = prod.call_claude(CallClaudeParams { endpoint: "analyse", system: "sys", user_message: "x", prompt_version: "v2", config_override: None }).await.unwrap_err();
    assert_eq!(e.to_string(), f["production_refusal"].as_str().unwrap());

    let t = ClaudeError::Truncated { label: "Analysis (Sonnet)".into(), max_tokens: 16000 };
    assert_eq!(t.to_string(), f["truncated_error_message"].as_str().unwrap());
    assert_eq!(t.code().unwrap(), f["truncated_error_code"].as_str().unwrap());
}

// ─── Legal-writing refinement ────────────────────────────────────────────

fn endpoint_of(s: &str) -> RefineEndpoint {
    match s {
        "analyse" => RefineEndpoint::Analyse,
        "triage" => RefineEndpoint::Triage,
        "debate" => RefineEndpoint::Debate,
        other => panic!("unknown endpoint {other}"),
    }
}

#[tokio::test]
async fn refinement_cases() {
    let f = load("refinement/cases.json");
    let llm = LlmClient::new(LlmConfig { agent_provider: true, ..Default::default() }, MockHttp::transport_error(), clock());
    for (i, c) in f["refine"].as_array().unwrap().iter().enumerate() {
        let r = refine_for_user(&llm, endpoint_of(c["endpoint"].as_str().unwrap()), c["payload"].clone()).await;
        assert_json_eq(&json!({ "payload": r.payload, "refinement": r.refinement }), &c["result"], &format!("refine case {i} ({})", c["endpoint"]));
    }
    let disabled = LlmClient::new(LlmConfig { agent_provider: true, refinement_disabled: true, ..Default::default() }, MockHttp::transport_error(), clock());
    let payload = f["disabled"]["result"]["payload"].clone();
    let r = refine_for_user(&disabled, RefineEndpoint::Analyse, payload).await;
    assert_json_eq(&json!({ "payload": r.payload, "refinement": r.refinement }), &f["disabled"]["result"], "disabled");
    let no_client = LlmClient::new(LlmConfig::default(), MockHttp::transport_error(), clock());
    let r = refine_for_user(&no_client, RefineEndpoint::Analyse, f["no_client"]["payload"].clone()).await;
    assert_json_eq(&json!({ "payload": r.payload, "refinement": r.refinement }), &f["no_client"], "no_client");
}
