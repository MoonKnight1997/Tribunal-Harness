mod common;
use common::*;
use serde_json::{json, Value};
use th_core::agent_provider::*;
use th_core::analyse_contract::*;
use th_core::refinement::*;

#[test]
fn analyse_contract_cases() {
    let f = load("analyse-contract/cases.json");
    for c in f["cases"].as_array().unwrap() {
        let r = normalise_analyse_response(&c["input"]);
        assert_json_eq(&to_value(&r), &c["result"], &format!("normalise {}", c["input"]));
    }
    for c in f["strength"].as_array().unwrap() {
        let input = if c["input"].is_null() { None } else { Some(&c["input"]) };
        assert_eq!(normalise_strength(input).as_str(), c["result"].as_str().unwrap());
    }
    for c in f["trust"].as_array().unwrap() {
        let input = if c["input"].is_null() { None } else { Some(&c["input"]) };
        assert_eq!(normalise_trust_level(input).as_str(), c["result"].as_str().unwrap());
    }
    for c in f["flag"].as_array().unwrap() {
        let input = if c["input"].is_null() { None } else { Some(&c["input"]) };
        assert_eq!(normalise_flag_status(input).as_str(), c["result"].as_str().unwrap());
    }
    for c in f["is_record"].as_array().unwrap() {
        assert_eq!(is_record(&c["input"]), c["result"].as_bool().unwrap());
    }
}

#[test]
fn agent_provider_cases() {
    let f = load("agent-provider/cases.json");
    assert_eq!(AGENT_STAND_IN_MODEL, f["AGENT_STAND_IN_MODEL"].as_str().unwrap());
    let messages = f["messages"].as_object().unwrap();
    for c in f["cases"].as_array().unwrap() {
        let endpoint = c["endpoint"].as_str().unwrap();
        let key = c["message_key"].as_str().unwrap();
        let msg = messages[key].as_str().unwrap();
        let content = generate_agent_response(&AgentProviderRequest { endpoint, system: "sys", user_message: msg });
        assert_eq!(content, c["content"].as_str().unwrap(), "agent {endpoint} {key}");
    }
    for c in f["extract_claim_type"].as_array().unwrap() {
        let msg = messages[c["key"].as_str().unwrap()].as_str().unwrap();
        assert_eq!(extract_claim_type(msg), c["result"].as_str().unwrap());
    }
    for c in f["estimate_tokens"].as_array().unwrap() {
        let len = c["len"].as_u64().unwrap() as usize;
        assert_eq!(estimate_tokens(&"x".repeat(len)), c["result"].as_u64().unwrap(), "tokens len {len}");
    }
}

#[test]
fn refinement_pure_cases() {
    let f = load("refinement/cases.json");
    for (ep, key) in [(RefineEndpoint::Analyse, "analyse"), (RefineEndpoint::Triage, "triage"), (RefineEndpoint::Debate, "debate")] {
        assert_json_eq(&json!(endpoint_prose_fields(ep)), &f["ENDPOINT_PROSE_FIELDS"][key], key);
    }
    for c in f["get_by_path"].as_array().unwrap() {
        let r = get_by_path(&c["obj"], c["path"].as_str().unwrap()).cloned().unwrap_or(Value::Null);
        assert_json_eq(&r, &c["result"], &format!("get {}", c["path"]));
    }
    for c in f["set_by_path"].as_array().unwrap() {
        let mut obj = c["obj"].clone();
        let ok = set_by_path(&mut obj, c["path"].as_str().unwrap(), c["value"].clone());
        assert_eq!(ok, c["ok"].as_bool().unwrap(), "set ok {}", c["path"]);
        assert_json_eq(&obj, &c["after"], &format!("set after {}", c["path"]));
    }
    // The agent stand-in pass-through: collected prose fields must round-trip
    // and the refined payload must equal the input (changes: 0).
    for c in f["refine"].as_array().unwrap() {
        let ep = match c["endpoint"].as_str().unwrap() {
            "analyse" => RefineEndpoint::Analyse,
            "triage" => RefineEndpoint::Triage,
            _ => RefineEndpoint::Debate,
        };
        let prose = collect_prose_fields(ep, &c["payload"]);
        let expected_meta = &c["result"]["refinement"];
        if prose.is_empty() {
            assert_eq!(expected_meta["reason"], "empty_input", "{}", c["payload"]);
            continue;
        }
        let user_message = json!({ "endpoint": ep.as_str(), "prose_fields": prose }).to_string();
        let content = generate_agent_response(&AgentProviderRequest { endpoint: "refine", system: "", user_message: &user_message });
        let parsed = parse_claude_json(&content).expect("parseable");
        assert!(same_keys(&prose, &parsed.refined_fields));
        let (payload, changes) = splice_refined_fields(&c["payload"], &parsed.refined_fields);
        assert_json_eq(&payload, &c["result"]["payload"], "refined payload");
        assert_eq!(changes as u64, expected_meta["changes"].as_u64().unwrap());
        assert_eq!(expected_meta["applied"], true);
        assert_eq!(expected_meta["source"], "agent-stand-in");
    }
    assert_eq!(f["disabled"]["result"]["refinement"]["reason"], "disabled");
    assert_eq!(f["no_client"]["refinement"]["reason"], "llm_error");
}

#[test]
fn rate_limit_cases() {
    let f = load("rate-limit/cases.json");
    for c in f["client_key"].as_array().unwrap() {
        assert_eq!(th_core::rate_limit::client_key_from_xff(c["xff"].as_str()), c["result"].as_str().unwrap());
    }
    let rl = th_core::rate_limit::RateLimiter::new(1000, 3);
    for (i, c) in f["sequence"].as_array().unwrap().iter().enumerate() {
        assert_eq!(rl.check(c["key"].as_str().unwrap(), i as i64), c["allowed"].as_bool().unwrap(), "seq {i}");
    }
}

#[test]
fn ui_helper_cases() {
    use th_core::ui_view::debate_modes::*;
    let f = load("ui/debate-modes.json");
    assert_json_eq(&to_value(&DEBATE_MODES.to_vec()), &f["DEBATE_MODES"], "DEBATE_MODES");
    for c in f["get_mode"].as_array().unwrap() {
        assert_eq!(get_debate_mode(c["id"].as_str().unwrap()).id.as_str(), c["result"].as_str().unwrap());
    }
    for c in f["describe_rounds"].as_array().unwrap() {
        let mode = DebateMode::parse(c["mode"].as_str().unwrap()).unwrap();
        assert_eq!(describe_rounds(mode, c["rounds"].as_i64(), c["stopped"].as_bool().unwrap()), c["result"].as_str().unwrap());
    }
    for c in f["format_int"].as_array().unwrap() {
        let n = c["n"].as_f64().unwrap_or(f64::NAN);
        assert_eq!(format_int(n), c["result"].as_str().unwrap(), "format_int {n}");
    }
    for c in f["format_usage"].as_array().unwrap() {
        let u = if c["usage"].is_null() { None } else { Some(&c["usage"]) };
        assert_eq!(format_usage(u), c["result"].as_str().unwrap());
    }
    for c in f["viability"].as_array().unwrap() {
        assert_eq!(viability_label(c["v"].as_bool()), c["result"].as_str().unwrap());
    }
    for c in f["argument_text"].as_array().unwrap() {
        let d = if c["input"].is_null() { None } else { Some(&c["input"]) };
        assert_eq!(get_argument_text(d), c["result"].as_str().unwrap(), "argument {}", c["input"]);
    }
    for c in f["synthesis_text"].as_array().unwrap() {
        let d = if c["input"].is_null() { None } else { Some(&c["input"]) };
        assert_eq!(get_synthesis_text(d), c["result"].as_str().unwrap());
    }
    for c in f["score"].as_array().unwrap() {
        let r = if c["round"].is_null() { None } else { Some(&c["round"]) };
        let j = if c["judge"].is_null() { None } else { Some(&c["judge"]) };
        assert_eq!(get_score(r, j).map(th_core::jsnum::js_number), if c["result"].is_null() { None } else { Some(c["result"].clone()) }, "score {} {}", c["round"], c["judge"]);
    }
    for c in f["partition"].as_array().unwrap() {
        let items = if c["items"].is_null() { None } else { Some(&c["items"]) };
        let r = partition_authorities(items, c["name_key"].as_str());
        assert_json_eq(&to_value(&r), &c["result"], &format!("partition {}", c["items"]));
    }

    let f = load("ui/analysis-results-view.json");
    for c in f["cases"].as_array().unwrap() {
        let r = th_core::ui_view::analysis_results::build_analysis_results_view(&c["input"]);
        assert_json_eq(&to_value(&r), &c["result"], &format!("view {}", c["input"]));
    }
}

#[test]
fn seed_case_search_cases() {
    let f = load("routes/responses.json");
    for c in f["routes"]["case_law_search"].as_array().unwrap() {
        let qs = c["query"].as_str().unwrap().trim_start_matches('?');
        let mut q = None;
        let mut ct = None;
        let mut tier = None;
        let mut limit = None;
        for pair in qs.split('&').filter(|p| !p.is_empty()) {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            let v = percent_decode(v);
            match k {
                "q" => q = Some(v),
                "claim_type" => ct = Some(v),
                "tier" => tier = Some(v),
                "limit" => limit = Some(v),
                _ => {}
            }
        }
        let out = th_core::seed_cases::search(q.as_deref(), ct.as_deref(), tier.as_deref(), limit.as_deref());
        let (status, body) = match out {
            th_core::seed_cases::SearchOutcome::BadRequest(b) => (400, b),
            th_core::seed_cases::SearchOutcome::Ok(b) => (200, b),
        };
        assert_eq!(status, c["response"]["status"].as_i64().unwrap(), "status {}", c["query"]);
        assert_json_eq(&body, &c["response"]["body"], &format!("search {}", c["query"]));
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                if let Ok(v) = u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("zz"), 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}
