mod common;
use common::*;
use serde_json::Value;
use th_core::constants::TimeLimitConfig;
use th_core::dates::CivilDate;
use th_core::deadlines::*;
use th_core::qualifying_period::qualifying_period;

fn today_of(f: &Value) -> CivilDate {
    CivilDate::parse_utc(f["generated_today"].as_str().unwrap()).unwrap()
}

fn strs(v: &Value) -> Vec<String> {
    v.as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_string()).collect()
}

#[test]
fn add_months_less_one_day_grid() {
    let f = load("deadlines/add-months-less-one-day.json");
    let cases = f["cases"].as_array().unwrap();
    assert!(cases.len() > 7000);
    for c in cases {
        let d = CivilDate::parse_utc(c["date"].as_str().unwrap()).unwrap();
        let r = add_months_less_one_day(&d, c["months"].as_i64().unwrap());
        assert_eq!(r.to_iso(), c["result"].as_str().unwrap(), "{} + {}", c["date"], c["months"]);
    }
}

#[test]
fn no_acas_grid() {
    let f = load("deadlines/grid-no-acas.json");
    let today = today_of(&f);
    let cfg = TimeLimitConfig::default();
    let cases = f["cases"].as_array().unwrap();
    assert!(cases.len() > 1800);
    for c in cases {
        let r = calculate_deadlines(&cfg, &today, c["date_of_act"].as_str().unwrap(), &strs(&c["claim_types"]), None, None).unwrap();
        assert_json_eq(&to_value(&r), &c["result"], &format!("act {}", c["date_of_act"]));
    }
}

#[test]
fn acas_grid() {
    let f = load("deadlines/grid-acas.json");
    let today = today_of(&f);
    let cfg = TimeLimitConfig::default();
    let cases = f["cases"].as_array().unwrap();
    assert!(cases.len() > 2500);
    for c in cases {
        let a = c["acas_day_a"].as_str();
        let b = c["acas_day_b"].as_str();
        let r = calculate_deadlines(&cfg, &today, c["date_of_act"].as_str().unwrap(), &strs(&c["claim_types"]), a, b).unwrap();
        assert_json_eq(&to_value(&r), &c["result"], &format!("act {} A {:?} B {:?}", c["date_of_act"], a, b));
        let s = calculate_deadline(&cfg, &today, c["date_of_act"].as_str().unwrap(), a, b, Some("unfair_dismissal")).unwrap();
        assert_json_eq(&to_value(&s), &c["single"], &format!("single act {} A {:?} B {:?}", c["date_of_act"], a, b));
    }
}

#[test]
fn multi_single_and_invalid() {
    let cfg = TimeLimitConfig::default();
    let f = load("deadlines/multi.json");
    let today = today_of(&f);
    for c in f["cases"].as_array().unwrap() {
        let r = calculate_deadlines(&cfg, &today, c["date_of_act"].as_str().unwrap(), &strs(&c["claim_types"]), c["acas_day_a"].as_str(), c["acas_day_b"].as_str()).unwrap();
        assert_json_eq(&to_value(&r), &c["result"], &format!("multi {}", c["date_of_act"]));
    }
    let f = load("deadlines/single.json");
    let today = today_of(&f);
    for c in f["cases"].as_array().unwrap() {
        let r = calculate_deadline(&cfg, &today, c["date_of_act"].as_str().unwrap(), c["acas_day_a"].as_str(), c["acas_day_b"].as_str(), c["claim_type"].as_str()).unwrap();
        assert_json_eq(&to_value(&r), &c["result"], &format!("single {}", c["date_of_act"]));
    }
    let f = load("deadlines/invalid.json");
    let today = today_of(&f);
    for c in f["cases"].as_array().unwrap() {
        let r = calculate_deadline(&cfg, &today, c["date_of_act"].as_str().unwrap(), c["acas_day_a"].as_str(), c["acas_day_b"].as_str(), None);
        match r {
            Ok(v) => assert_json_eq(&to_value(&v), &c["ok"], &format!("invalid-ok {}", c["date_of_act"])),
            Err(e) => assert_eq!(Some(e.to_string().as_str()), c["error"].as_str(), "invalid-err {}", c["date_of_act"]),
        }
    }
}

#[test]
fn qualifying_period_grid() {
    let f = load("qualifying-period/grid.json");
    let cases = f["cases"].as_array().unwrap();
    assert!(cases.len() > 1500);
    for c in cases {
        let r = qualifying_period(c["employment_start"].as_str().unwrap(), c["edt"].as_str().unwrap());
        match r {
            Ok(v) => assert_json_eq(&to_value(&v), &c["result"], &format!("qp {} {}", c["employment_start"], c["edt"])),
            Err(e) => assert_eq!(Some(e.to_string().as_str()), c["error"].as_str(), "qp err {} {}", c["employment_start"], c["edt"]),
        }
    }
}
