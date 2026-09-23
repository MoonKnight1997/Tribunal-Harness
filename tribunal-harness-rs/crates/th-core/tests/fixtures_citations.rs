mod common;
use common::*;
use serde_json::{json, Value};
use th_core::citation_validator::*;
use th_core::find_case_law::*;

#[test]
fn validate_citation_cases() {
    let f = load("citations/validate.json");
    let cases = f["cases"].as_array().unwrap();
    assert!(cases.len() > 150);
    for c in cases {
        let r = validate_citation(c["input"].as_str().unwrap());
        assert_json_eq(&to_value(&r), &c["result"], &format!("validate {:?}", c["input"]));
    }
    for c in f["extract_validator"].as_array().unwrap() {
        assert_eq!(extract_neutral_citation(c["input"].as_str().unwrap()).as_deref(), c["result"].as_str(), "extract(validator) {:?}", c["input"]);
    }
    for c in f["extract_fcl"].as_array().unwrap() {
        assert_eq!(th_core::find_case_law::extract_neutral_citation(c["input"].as_str().unwrap()).as_deref(), c["result"].as_str(), "extract(fcl) {:?}", c["input"]);
    }
    for c in f["normalise"].as_array().unwrap() {
        assert_eq!(normalise_citation(c["input"].as_str().unwrap()), c["result"].as_str().unwrap());
    }
    for c in f["tokens"].as_array().unwrap() {
        assert_json_eq(&json!(significant_party_tokens(c["input"].as_str().unwrap())), &c["result"], &format!("tokens {:?}", c["input"]));
    }
    for c in f["batches"].as_array().unwrap() {
        let cites: Vec<String> = c["authorities"].as_array().unwrap().iter().map(|a| a["citation"].as_str().unwrap().to_string()).collect();
        assert_json_eq(&to_value(&validate_all_citations(&cites)), &c["result"], "batch");
    }
}

fn envelope_for(mode: &str, feeds: &Value) -> SearchEnvelope {
    // "ok:FEED" | "status:503" | "abort" | "reject" — reproduce what the TS
    // searchCaseLaw produced for that canned fetch behaviour.
    if let Some(name) = mode.strip_prefix("ok:") {
        return envelope_from_feed(feeds[name].as_str().unwrap(), 10);
    }
    if let Some(code) = mode.strip_prefix("status:") {
        let (status, detail) = status_for_response(code.parse().unwrap());
        return SearchEnvelope { status, results: vec![], detail: Some(detail), total: None };
    }
    if mode == "abort" {
        return SearchEnvelope { status: LookupStatus::UpstreamTimeout, results: vec![], detail: Some("Find Case Law timed out — it may be slow; retry.".into()), total: None };
    }
    SearchEnvelope { status: LookupStatus::UpstreamUnavailable, results: vec![], detail: Some("Could not reach Find Case Law.".into()), total: None }
}

#[test]
fn parse_and_verify_cases() {
    let feeds = load("find-case-law/feeds.json");
    let f = load("find-case-law/parse.json");
    for c in f["cases"].as_array().unwrap() {
        let xml = feeds[c["feed"].as_str().unwrap()].as_str().unwrap();
        let p = parse_atom_feed(xml, c["limit"].as_u64().unwrap() as usize);
        let mut v = json!({ "hits": p.hits });
        if let Some(t) = p.total {
            v["total"] = json!(t);
        }
        assert_json_eq(&v, &c["result"], &format!("parse {} limit {}", c["feed"], c["limit"]));
    }

    let f = load("find-case-law/search.json");
    for c in f["cases"].as_array().unwrap() {
        let mode = c["mode"].as_str().unwrap();
        let limit = c["opts"]["limit"].as_u64().map(|l| (l as usize).clamp(1, 50)).unwrap_or(10);
        let env = if let Some(name) = mode.strip_prefix("ok:") { envelope_from_feed(feeds[name].as_str().unwrap(), limit) } else { envelope_for(mode, &feeds) };
        assert_json_eq(&to_value(&env), &c["result"], &format!("search {mode} {:?}", c["opts"]));
    }

    let f = load("find-case-law/verify.json");
    for c in f["cases"].as_array().unwrap() {
        let mode = c["mode"].as_str().unwrap();
        let q = verify_query(c["input"]["citation"].as_str(), c["input"]["caseName"].as_str());
        let r = match &q.query {
            None => no_query_result(),
            Some(_) => decide_verification(&q, &envelope_for(mode, &feeds)).0,
        };
        assert_json_eq(&to_value(&r), &c["result"], &format!("verify {mode} {:?}", c["input"]));
        // The TS code only fetched when there was a query.
        assert_eq!(c["fetched"].as_array().unwrap().is_empty(), q.query.is_none(), "fetch gating {:?}", c["input"]);
    }
}

fn authoritative_offline(citation: &str, name: Option<&str>, mode: &str, feeds: &Value) -> (AuthoritativeValidation, bool) {
    // Mirrors validateCitationAuthoritative with a canned upstream; returns
    // (result, fetched?).
    let stat = validate_citation(citation);
    if let Some(v) = curated_verified(citation, &stat) {
        return (v, false);
    }
    let q = verify_query(Some(citation), name);
    match &q.query {
        None => (merge_with_live(citation, &stat, &no_query_result()), false),
        Some(_) => {
            let live = decide_verification(&q, &envelope_for(mode, feeds)).0;
            if live.source == VerifySource::Unavailable {
                (curated_fallback(citation, &stat), true)
            } else {
                (merge_with_live(citation, &stat, &live), true)
            }
        }
    }
}

#[test]
fn authoritative_merge_cases() {
    let feeds = load("find-case-law/feeds.json");
    let f = load("citations/authoritative.json");
    for c in f["cases"].as_array().unwrap() {
        let mode = c["mode"].as_str().unwrap();
        let citation = c["input"]["citation"].as_str().unwrap();
        let (result, fetched) = authoritative_offline(citation, c["input"]["name"].as_str(), mode, &feeds);
        assert_json_eq(&to_value(&result), &c["result"], &format!("authoritative {mode} {citation:?}"));
        assert_eq!(fetched, c["fetched"].as_u64().unwrap() > 0, "fetch gating {citation:?}");
    }
    let batch = f["batch_abort"].clone();
    let results: Vec<AuthoritativeValidation> = batch["results"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| authoritative_offline(r["originalCitation"].as_str().unwrap(), None, "abort", &feeds).0)
        .collect();
    assert_json_eq(&json!({"results": results, "summary": summarise_authoritative(&results)}), &batch, "batch abort");
}
