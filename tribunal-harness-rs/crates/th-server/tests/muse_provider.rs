//! End-to-end check of the Muse Spark provider (`LLM_PROVIDER=muse`): the
//! router is built with a Model API configuration and an HTTP mock that plays
//! the part of `POST https://api.meta.ai/v1/responses`. The fake server
//! validates the request shape, answers with an SSE stream whose terminal
//! event wraps the deterministic agent stand-in's JSON, and the resulting
//! route bodies must match what the stand-in provider produces directly
//! (only `refinement.source` differs, by design).
//!
//! Hermetic: no network. The recorded fixtures are the same ones the agent
//! route replay uses.

mod common;

use common::*;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use th_core::agent_provider::{generate_agent_response, AgentProviderRequest};
use th_core::claude_config::ENDPOINT_CONFIG;
use th_server::testkit::{call, post_json, post_multipart, MultipartPart};
use th_services::http::{HttpError, HttpResponse, MockHttp};
use th_services::muse::{reasoning_effort, MuseConfig};

fn fixture() -> Value {
    load("routes/responses.json")
}

/// A scripted Model API: every request is checked against the documented
/// Responses API shape, the endpoint is recovered from `max_output_tokens`
/// (unique per endpoint config), and the stand-in's answer is streamed back.
fn fake_model_api(calls: Arc<AtomicUsize>) -> Arc<MockHttp> {
    MockHttp::new(move |req| {
        if !req.url.ends_with("/responses") {
            // TNA etc. — unreachable, as in the recorded agent run.
            return Err(HttpError::Transport("connection refused".into()));
        }
        calls.fetch_add(1, Ordering::SeqCst);
        assert_eq!(req.url, "https://api.meta.ai/v1/responses");
        assert!(req.headers.iter().any(|(k, v)| k == "authorization" && v == "Bearer test-model-api-key"));
        let body: Value = serde_json::from_slice(req.body.as_ref().expect("body")).expect("json body");
        assert_eq!(body["model"], "muse-spark-1.3");
        assert_eq!(body["store"], false);
        assert_eq!(body["stream"], true);
        assert!(body.get("temperature").is_none());
        let max = body["max_output_tokens"].as_u64().unwrap() as u32;
        let (endpoint, cfg) = ENDPOINT_CONFIG.iter().find(|(_, c)| c.max_tokens == max).unwrap_or_else(|| panic!("no endpoint with max_tokens {max}"));
        assert_eq!(body["reasoning"]["effort"], reasoning_effort(cfg));
        let system = body["instructions"].as_str().expect("instructions");
        assert!(!system.is_empty());
        let user = body["input"][0]["content"][0]["text"].as_str().expect("input text");
        assert_eq!(body["input"][0]["role"], "user");
        assert_eq!(body["input"][0]["content"][0]["type"], "input_text");
        let text = generate_agent_response(&AgentProviderRequest { endpoint, system, user_message: user });
        let response = json!({
            "id": "resp_test", "object": "response", "status": "completed", "model": "muse-spark-1.3",
            "output": [
                {"id": "rs_1", "type": "reasoning", "summary": []},
                {"id": "msg_1", "type": "message", "role": "assistant", "status": "completed",
                 "content": [{"type": "output_text", "text": text, "annotations": []}]}
            ],
            "usage": {"input_tokens": 100, "output_tokens": 200, "total_tokens": 300}
        });
        let sse = format!(
            "event: response.created\ndata: {}\n\nevent: response.completed\ndata: {}\n\ndata: [DONE]\n\n",
            json!({"type": "response.created", "response": {"id": "resp_test", "status": "in_progress"}}),
            json!({"type": "response.completed", "response": response})
        );
        Ok(HttpResponse { status: 200, headers: vec![("content-type".into(), "text/event-stream".into())], body: sse.into_bytes() })
    })
}

fn muse_app(f: &Value, tag: &str, calls: Arc<AtomicUsize>) -> axum::Router {
    let mut config = hermetic_config(false, tag);
    config.llm.muse = Some(MuseConfig::new("test-model-api-key"));
    build_app(config, fake_model_api(calls), clock_at(f["generated_today"].as_str().unwrap()))
}

fn agent_app(f: &Value, tag: &str) -> axum::Router {
    build_app(hermetic_config(true, tag), MockHttp::transport_error(), clock_at(f["generated_today"].as_str().unwrap()))
}

/// The only expected differences: who produced the refinement pass, and the
/// token usage the debate engine sums (the stand-in estimates tokens; the
/// Model API reports real counts).
fn normalise(mut body: Value) -> Value {
    if let Some(src) = body.pointer_mut("/refinement/source") {
        if *src == json!("muse-spark") || *src == json!("agent-stand-in") {
            *src = json!("<provider>");
        }
    }
    if let Some(usage) = body.get_mut("usage") {
        if usage.get("total_input_tokens").is_some() {
            *usage = json!("<usage>");
        }
    }
    body
}

#[tokio::test]
async fn analyse_via_muse_matches_stand_in_output() {
    let f = fixture();
    let calls = Arc::new(AtomicUsize::new(0));
    let muse = muse_app(&f, "muse-analyse", calls.clone());
    let agent = agent_app(&f, "agent-analyse");
    for (i, c) in f["routes"]["analyse_agent"].as_array().unwrap().iter().enumerate() {
        let ip = format!("10.20.0.{}", i + 1);
        let m = call(&muse, post_json("/api/analyse", &c["body"], &[("x-forwarded-for", &ip)])).await;
        let a = call(&agent, post_json("/api/analyse", &c["body"], &[("x-forwarded-for", &ip)])).await;
        assert_eq!(m.status, 200, "muse analyse case {i}: {}", m.text());
        assert_eq!(m.status, a.status);
        let (mut mb, mut ab) = (m.json(), a.json());
        mb["request_id"] = json!("<uuid>");
        ab["request_id"] = json!("<uuid>");
        assert_json_eq(&normalise(mb), &normalise(ab), &format!("analyse via muse case {i}: {}", c["body"]["claim_type"]));
    }
    // Every case made at least one model call (analysis; refinement follows when enabled).
    assert!(calls.load(Ordering::SeqCst) >= f["routes"]["analyse_agent"].as_array().unwrap().len());
    let refined = call(&muse, post_json("/api/analyse", &json!({"claim_type": "unfair_dismissal", "mode": "narrative", "consent": true, "narrative_text": "I was dismissed on 3 March 2026 without any process after four years' service."}), &[("x-forwarded-for", "10.20.1.1")])).await;
    let body = refined.json();
    if body["refinement"]["applied"] == json!(true) {
        assert_eq!(body["refinement"]["source"], "muse-spark");
    }
}

#[tokio::test]
async fn triage_via_muse_matches_stand_in_output() {
    let f = fixture();
    let calls = Arc::new(AtomicUsize::new(0));
    let muse = muse_app(&f, "muse-triage", calls.clone());
    let agent = agent_app(&f, "agent-triage");
    let txt = load_text("documents/sample.txt");
    for parts in [
        vec![MultipartPart::file("document", "sample.txt", "text/plain", txt.clone())],
        vec![MultipartPart::file("document", "sample.txt", "text/plain", txt.clone()), MultipartPart::text("schema_state", "{\"claim_type\":\"unfair_dismissal\"}")],
    ] {
        let m = call(&muse, post_multipart("/api/triage", &parts)).await;
        let a = call(&agent, post_multipart("/api/triage", &parts)).await;
        assert_eq!(m.status, 200, "muse triage: {}", m.text());
        assert_json_eq(&normalise(m.json()), &normalise(a.json()), "triage via muse");
    }
    assert!(calls.load(Ordering::SeqCst) >= 2, "each triage made at least one model call");
}

#[tokio::test]
async fn debate_via_muse_matches_stand_in_output() {
    let f = fixture();
    let calls = Arc::new(AtomicUsize::new(0));
    let muse = muse_app(&f, "muse-debate", calls.clone());
    let agent = agent_app(&f, "agent-debate");
    for (i, c) in f["routes"]["debate"].as_array().unwrap().iter().enumerate() {
        if c["no_client"] == json!(true) {
            continue;
        }
        let ip = format!("10.21.0.{}", i + 1);
        let m = call(&muse, post_json("/api/debate", &c["body"], &[("x-forwarded-for", &ip)])).await;
        let a = call(&agent, post_json("/api/debate", &c["body"], &[("x-forwarded-for", &ip)])).await;
        assert_eq!(m.status, a.status, "debate case {i}: muse {} vs agent {}", m.text(), a.text());
        assert_json_eq(&normalise(m.json()), &normalise(a.json()), &format!("debate via muse case {i}: {}", c["body"]));
    }
    assert!(calls.load(Ordering::SeqCst) > 0, "the debate engine called the Model API");
}

#[tokio::test]
async fn model_api_failure_is_reported_not_simulated() {
    let f = fixture();
    let mut config = hermetic_config(false, "muse-failure");
    config.llm.muse = Some(MuseConfig::new("test-model-api-key"));
    let http = MockHttp::new(|req| {
        if req.url.ends_with("/responses") {
            Ok(HttpResponse { status: 401, headers: vec![], body: b"{\"error\":{\"type\":\"authentication_error\",\"message\":\"invalid api key\"}}".to_vec() })
        } else {
            Err(HttpError::Transport("connection refused".into()))
        }
    });
    let app = build_app(config, http, clock_at(f["generated_today"].as_str().unwrap()));
    let res = call(
        &app,
        post_json(
            "/api/analyse",
            &json!({"claim_type": "unfair_dismissal", "mode": "narrative", "consent": true, "narrative_text": "Dismissed without any process after four years of service."}),
            &[("x-forwarded-for", "10.22.0.1")],
        ),
    )
    .await;
    assert_eq!(res.status, 500, "{}", res.text());
    let body = res.json();
    assert!(body["error"].is_string(), "{body}");
    assert!(body.get("claims").is_none(), "no analysis is fabricated on an upstream error: {body}");
}
