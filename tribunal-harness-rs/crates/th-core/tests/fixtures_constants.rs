mod common;
use common::*;
use serde_json::{json, Value};
use th_core::claude_config::{estimate_cost, get_endpoint_config, CLAUDE_MODELS, ENDPOINT_CONFIG};
use th_core::constants::*;
use th_core::verified_authorities::*;

#[test]
fn era_2025_constants_match_fixture() {
    let f = load("constants/constants.json");
    let era: Value = ERA_2025_ENTRIES.iter().map(|(k, v)| (k.to_string(), json!(v))).collect::<serde_json::Map<_, _>>().into();
    assert_json_eq(&era, &f["ERA_2025"], "ERA_2025");
    assert_json_eq(&to_value(&ERA_2025_TRACKER.to_vec()), &f["ERA_2025_TRACKER"], "ERA_2025_TRACKER");
    let tl = TimeLimitConfig::default();
    assert_json_eq(
        &json!({"PRE_ERA_2025_MONTHS": tl.pre_era_2025_months, "POST_ERA_2025_MONTHS": tl.post_era_2025_months, "COMMENCEMENT_DATE": tl.commencement_date, "TIME_LIMIT_SI_CONFIRMED": tl.time_limit_si_confirmed}),
        &f["TIME_LIMIT_CONFIG"],
        "TIME_LIMIT_CONFIG",
    );
    assert_json_eq(
        &json!({"PRE_ERA_2025_YEARS": QUALIFYING_PERIOD_CONFIG.pre_era_2025_years, "POST_ERA_2025_MONTHS": QUALIFYING_PERIOD_CONFIG.post_era_2025_months, "COMMENCEMENT_DATE": QUALIFYING_PERIOD_CONFIG.commencement_date}),
        &f["QUALIFYING_PERIOD_CONFIG"],
        "QUALIFYING_PERIOD_CONFIG",
    );
    assert_json_eq(&to_value(&CLAIM_TYPES.to_vec()), &f["CLAIM_TYPES"], "CLAIM_TYPES");
    assert_json_eq(&to_value(&FSM_STATES.to_vec()), &f["FSM_STATES"], "FSM_STATES");
    assert_json_eq(&to_value(&tbc_commencement_keys()), &f["TBC_COMMENCEMENT_KEYS"], "TBC keys");
    for s in f["format_samples"].as_array().unwrap() {
        let iso = s["iso"].as_str().unwrap();
        assert_eq!(format_commencement_date(iso), s["date"].as_str().unwrap(), "date {iso}");
        assert_eq!(format_commencement_month(iso), s["month"].as_str().unwrap(), "month {iso}");
        assert_eq!(format_commencement_label(iso, true), s["label_tbc"].as_str().unwrap(), "tbc {iso}");
        assert_eq!(format_commencement_label(iso, false), s["label_fixed"].as_str().unwrap(), "fixed {iso}");
    }
    for c in f["is_tbc"].as_array().unwrap() {
        assert_eq!(is_commencement_tbc(c["key"].as_str().unwrap()), c["tbc"].as_bool().unwrap());
    }
    for c in f["resolve_time_limit_commencement"].as_array().unwrap() {
        let input = c["input"].as_str().unwrap();
        match resolve_time_limit_commencement(Some(input)) {
            Ok(v) => assert_eq!(Some(v.as_str()), c["ok"].as_str(), "override {input:?}"),
            Err(e) => assert_eq!(Some(e.as_str()), c["error"].as_str(), "override {input:?}"),
        }
    }
    assert_eq!(resolve_time_limit_commencement(None).unwrap(), f["resolve_undefined"].as_str().unwrap());
}

#[test]
fn verified_authorities_match_fixture() {
    let f = load("constants/verified-authorities.json");
    assert_json_eq(&to_value(&VERIFIED_AUTHORITIES.to_vec()), &f["VERIFIED_AUTHORITIES"], "VERIFIED_AUTHORITIES");
    for c in f["find_by_short_name"].as_array().unwrap() {
        let r = find_authority_by_short_name(c["input"].as_str().unwrap()).map(|a| a.short_name);
        assert_eq!(r, c["result"].as_str(), "short {}", c["input"]);
    }
    for c in f["find_by_partial"].as_array().unwrap() {
        let r = find_authority_by_partial_match(c["input"].as_str().unwrap()).map(|a| a.short_name);
        assert_eq!(r, c["result"].as_str(), "partial {}", c["input"]);
    }
}

#[test]
fn claude_config_matches_fixture() {
    let f = load("constants/claude-config.json");
    let models: Value = CLAUDE_MODELS.iter().map(|(k, v)| (k.to_string(), json!(v))).collect::<serde_json::Map<_, _>>().into();
    assert_json_eq(&models, &f["CLAUDE_MODELS"], "CLAUDE_MODELS");
    let cfg: Value = ENDPOINT_CONFIG.iter().map(|(k, v)| (k.to_string(), to_value(v))).collect::<serde_json::Map<_, _>>().into();
    assert_json_eq(&cfg, &f["ENDPOINT_CONFIG"], "ENDPOINT_CONFIG");
    for c in f["cost_samples"].as_array().unwrap() {
        let r = estimate_cost(c["model"].as_str().unwrap(), c["input_tokens"].as_u64().unwrap(), c["output_tokens"].as_u64().unwrap());
        assert_json_eq(&to_value(&r), &c["result"], &format!("cost {}", c["model"]));
    }
    assert_eq!(get_endpoint_config("does-not-exist").label, f["unknown_endpoint_falls_back_to"].as_str().unwrap());
}

#[test]
fn schemas_match_fixture() {
    let f = load("schemas/all-schemas.json");
    let all: Value = th_core::schemas::get_all_schemas().iter().map(|s| (s.id.to_string(), to_value(s))).collect::<serde_json::Map<_, _>>().into();
    assert_json_eq(&all, &f["SCHEMAS"], "SCHEMAS");
    let order: Vec<&str> = th_core::schemas::get_all_schemas().iter().map(|s| s.id).collect();
    assert_json_eq(&json!(order), &f["order"], "order");
    assert!(f["unknown"].is_null());
}

#[test]
fn prompts_are_byte_identical() {
    let f = load("prompts/prompts.json");
    use th_core::prompts::*;
    assert_eq!(*ANALYSE_PROMPT_V2, f["ANALYSE_PROMPT_v2"].as_str().unwrap());
    assert_eq!(TRIAGE_PROMPT_V2, f["TRIAGE_PROMPT_v2"].as_str().unwrap());
    assert_eq!(*DRAFTER_PROMPT_V2, f["DRAFTER_PROMPT_v2"].as_str().unwrap());
    assert_eq!(CRITIC_PROMPT_V2, f["CRITIC_PROMPT_v2"].as_str().unwrap());
    assert_eq!(JUDGE_PROMPT_V2, f["JUDGE_PROMPT_v2"].as_str().unwrap());
    assert_eq!(LEGAL_WRITING_REFINEMENT_PROMPT_V1, f["LEGAL_WRITING_REFINEMENT_PROMPT_v1"].as_str().unwrap());
    #[allow(deprecated)]
    {
        assert_eq!(*ANALYSE_PROMPT_V1, f["ANALYSE_PROMPT_v1"].as_str().unwrap());
        assert_eq!(TRIAGE_PROMPT_V1, f["TRIAGE_PROMPT_v1"].as_str().unwrap());
        assert_eq!(DRAFTER_PROMPT_V1, f["DRAFTER_PROMPT_v1"].as_str().unwrap());
        assert_eq!(CRITIC_PROMPT_V1, f["CRITIC_PROMPT_v1"].as_str().unwrap());
        assert_eq!(JUDGE_PROMPT_V1, f["JUDGE_PROMPT_v1"].as_str().unwrap());
    }
    assert_eq!(versions::ANALYSE, f["PROMPT_VERSIONS"]["ANALYSE"].as_str().unwrap());
    assert_eq!(versions::TRIAGE, f["PROMPT_VERSIONS"]["TRIAGE"].as_str().unwrap());
    assert_eq!(versions::DRAFTER, f["PROMPT_VERSIONS"]["DRAFTER"].as_str().unwrap());
    assert_eq!(versions::CRITIC, f["PROMPT_VERSIONS"]["CRITIC"].as_str().unwrap());
    assert_eq!(versions::JUDGE, f["PROMPT_VERSIONS"]["JUDGE"].as_str().unwrap());
    assert_eq!(versions::REFINEMENT, f["PROMPT_VERSIONS"]["REFINEMENT"].as_str().unwrap());
    assert_eq!(REFINEMENT_PROMPT_VERSION, f["REFINEMENT_PROMPT_VERSION"].as_str().unwrap());
}

#[test]
fn tracker_and_roadmap_match_route_fixtures() {
    let f = load("routes/responses.json");
    let tracker = json!({ "changes": th_core::tracker::tracker_data() });
    assert_json_eq(&tracker, &f["routes"]["tracker"]["body"], "tracker");
    assert_eq!(f["routes"]["tracker"]["status"], 200);
    let rm = th_core::roadmap::roadmap_for_case("case-123");
    assert_json_eq(&rm, &f["routes"]["roadmap_case"]["body"], "roadmap case");
}
