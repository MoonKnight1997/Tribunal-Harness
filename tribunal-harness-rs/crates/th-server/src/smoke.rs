//! End-to-end smoke run — port of `scripts/smoke-run.ts`. Invokes every
//! important API route in-process with the offline agent stand-in, builds
//! `smoke-report.json` + `smoke-report.md`, and reports PASS/FAIL.

use crate::jsval::substring_to;
use crate::testkit::{call, get, post_json, post_multipart, MultipartPart};
use axum::Router;
use serde::Serialize;
use serde_json::{json, Map, Value};

#[derive(Debug, Clone, Serialize)]
pub struct Check {
    pub description: String,
    pub pass: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

fn check(description: &str, pass: bool, detail: Option<String>) -> Check {
    Check { description: description.to_string(), pass, detail }
}

#[derive(Debug, Clone, Serialize)]
pub struct SectionReport {
    pub name: String,
    pub status: &'static str,
    pub duration_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extract: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checks: Option<Vec<Check>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Environment {
    pub node_version: String,
    pub platform: String,
    pub llm_provider: String,
    pub anthropic_api_key_present: bool,
    pub cwd: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Summary {
    pub ok: usize,
    pub fail: usize,
    pub total: usize,
    pub duration_ms: i64,
    pub overall_status: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub environment: Environment,
    pub schema_lookup: SectionReport,
    pub triage: SectionReport,
    pub analyse: SectionReport,
    pub deadlines: SectionReport,
    pub case_law_search: SectionReport,
    pub era_2025_tracker: SectionReport,
    pub debate: SectionReport,
    pub summary: Summary,
}

pub const NARRATIVE: &str = "Warehouse employee with ~4 years' service, summarily dismissed on 3 March 2026 for alleged 'gross misconduct' shortly after raising written health and safety concerns. No investigation meeting was held.";

const TRIAGE_TEXT: &str = "Claimant: warehouse employee with ~4 years' service. Dismissed 3 March 2026 for alleged gross misconduct shortly after raising written health and safety concerns. No investigation meeting was held. Employer: Acme Logistics Ltd. EDT: 2026-03-03.";

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Build an object inserting only the `Some` values (an `undefined` property
/// is omitted by `JSON.stringify`).
fn obj(entries: Vec<(&str, Option<Value>)>) -> Value {
    let mut m = Map::new();
    for (k, v) in entries {
        if let Some(v) = v {
            m.insert(k.to_string(), v);
        }
    }
    Value::Object(m)
}

fn is_object(v: &Value) -> bool {
    v.is_object()
}

fn arr_len(v: Option<&Value>) -> Option<Value> {
    Some(v.and_then(Value::as_array).map(|a| json!(a.len())).unwrap_or(Value::Null))
}

fn section(name: &str, duration_ms: i64, status: u16, checks: Vec<Check>, extract: Value, raw: Value) -> SectionReport {
    let ok = checks.iter().all(|c| c.pass);
    SectionReport {
        name: name.to_string(),
        status: if ok { "OK" } else { "FAIL" },
        duration_ms,
        http_status: Some(status),
        error: None,
        extract: Some(extract),
        raw: Some(raw),
        checks: Some(checks),
    }
}

fn refinement_checks(body: &Value) -> (Check, Value, Value, Value) {
    let r = body.get("refinement").cloned().unwrap_or(json!({}));
    let applied = r.get("applied").cloned();
    let source = r.get("source").cloned();
    let changes = r.get("changes").cloned();
    let pass = applied == Some(json!(true)) && source == Some(json!("agent-stand-in"));
    let show = |v: &Option<Value>| v.as_ref().map(crate::jsval::template).unwrap_or_else(|| "undefined".into());
    let c = check("refinement applied", pass, Some(format!("applied={} source={} reason={}", show(&applied), show(&source), show(&r.get("reason").cloned()))));
    (c, applied.unwrap_or(Value::Null), source.unwrap_or(Value::Null), changes.unwrap_or(Value::Null))
}

fn opt(v: Option<&Value>) -> Option<Value> {
    v.cloned()
}

async fn run_schema_lookup(app: &Router) -> SectionReport {
    let start = now_ms();
    let res = call(app, get("/api/schema/unfair_dismissal")).await;
    let body = res.json();
    let duration = now_ms() - start;
    let checks = vec![
        check("HTTP 200", res.status == 200, Some(format!("got {}", res.status))),
        check("schema.label present", body["label"].is_string(), Some(format!("label={}", crate::jsval::template_or_undefined(body.get("label"))))),
        check("schema.statute present", body["statute"].is_string(), Some(format!("statute={}", crate::jsval::template_or_undefined(body.get("statute"))))),
    ];
    let extract = obj(vec![
        ("label", opt(body.get("label"))),
        ("statute", opt(body.get("statute"))),
        ("description", opt(body.get("description"))),
        ("field_count", arr_len(body.get("fields"))),
    ]);
    section("schema_lookup", duration, res.status, checks, extract, body)
}

async fn run_triage(app: &Router) -> SectionReport {
    let start = now_ms();
    let res = call(app, post_multipart("/api/triage", &[MultipartPart::file("document", "sample.txt", "text/plain", TRIAGE_TEXT)])).await;
    let body = res.json();
    let duration = now_ms() - start;
    let (rc, applied, source, changes) = refinement_checks(&body);
    let pct_len = body.get("potential_claim_types").and_then(Value::as_array).map(|a| a.len().to_string()).unwrap_or_else(|| "n/a".into());
    let checks = vec![
        check("HTTP 200", res.status == 200, Some(format!("got {}", res.status))),
        check("updated_fields present", body.get("updated_fields").map(is_object).unwrap_or(false), None),
        check("query_array is array", body["query_array"].is_array(), None),
        check("document_summary present", body["document_summary"].is_string(), None),
        check("potential_claim_types is array", body["potential_claim_types"].is_array(), Some(format!("len={pct_len}"))),
        rc,
    ];
    let keys: Vec<Value> = body.get("updated_fields").and_then(Value::as_object).map(|m| m.keys().map(|k| json!(k)).collect()).unwrap_or_default();
    let extract = obj(vec![
        ("document_summary", opt(body.get("document_summary"))),
        ("potential_claim_types", opt(body.get("potential_claim_types"))),
        ("query_array_len", arr_len(body.get("query_array"))),
        ("updated_field_keys", Some(json!(keys))),
        ("refinement_applied", Some(applied).filter(|v| !v.is_null())),
        ("refinement_source", Some(source).filter(|v| !v.is_null())),
        ("refinement_changes", Some(changes).filter(|v| !v.is_null())),
    ]);
    section("triage", duration, res.status, checks, extract, body)
}

async fn run_analyse(app: &Router) -> SectionReport {
    let start = now_ms();
    let res = call(app, post_json("/api/analyse", &json!({ "claim_type": "unfair_dismissal", "mode": "narrative", "narrative_text": NARRATIVE, "consent": true }), &[])).await;
    let body = res.json();
    let duration = now_ms() - start;
    let authorities: Vec<Value> = body.get("authorities").and_then(Value::as_array).cloned().unwrap_or_default();
    let first = authorities.first();
    let (rc, applied, source, changes) = refinement_checks(&body);
    let checks = vec![
        check("HTTP 200", res.status == 200, Some(format!("got {}", res.status))),
        check(
            "claims present",
            body["claims"].is_array(),
            Some(format!("len={}", body.get("claims").and_then(Value::as_array).map(|a| a.len().to_string()).unwrap_or_else(|| "n/a".into()))),
        ),
        check("authorities present", body["authorities"].is_array(), Some(format!("len={}", authorities.len()))),
        check("statutory_provisions present", body["statutory_provisions"].is_array(), None),
        check("procedural_notes present", body["procedural_notes"].is_array(), None),
        check("era_2025_flags present", body["era_2025_flags"].is_array(), None),
        check(
            "authority has trust_level",
            first.map(|f| f["trust_level"].is_string()).unwrap_or(false),
            Some(first.map(|f| format!("trust_level={}", crate::jsval::template_or_undefined(f.get("trust_level")))).unwrap_or_else(|| "no authorities returned".into())),
        ),
        rc,
    ];
    let first_authority = first
        .map(|f| {
            obj(vec![
                ("name", opt(f.get("name"))),
                ("citation", opt(f.get("citation"))),
                ("trust_level", opt(f.get("trust_level"))),
                ("verification_source", opt(f.get("verification_source"))),
            ])
        })
        .unwrap_or(Value::Null);
    let extract = obj(vec![
        ("claim_count", arr_len(body.get("claims"))),
        ("authority_count", Some(json!(authorities.len()))),
        ("first_authority", Some(first_authority)),
        ("statutory_provisions_count", arr_len(body.get("statutory_provisions"))),
        ("era_2025_flag_count", arr_len(body.get("era_2025_flags"))),
        ("quarantine_summary", opt(body.get("quarantine_summary"))),
        ("refinement_applied", Some(applied).filter(|v| !v.is_null())),
        ("refinement_source", Some(source).filter(|v| !v.is_null())),
        ("refinement_changes", Some(changes).filter(|v| !v.is_null())),
    ]);
    section("analyse", duration, res.status, checks, extract, body)
}

async fn run_deadlines(app: &Router) -> SectionReport {
    let start = now_ms();
    let res = call(app, post_json("/api/deadlines", &json!({ "effective_date_of_termination": "2026-03-03", "claim_types": ["unfair_dismissal"] }), &[])).await;
    let body = res.json();
    let duration = now_ms() - start;
    let deadlines: Vec<Value> = body.get("deadlines").and_then(Value::as_array).cloned().unwrap_or_default();
    let first = deadlines.first();
    let regime_raw = first.and_then(|f| f.get("regime")).and_then(Value::as_str).map(str::to_string);
    let regime_normalised: Option<&str> = regime_raw.as_deref().and_then(|r| {
        if r.starts_with("post") {
            Some("post")
        } else if r.starts_with("pre") {
            Some("pre")
        } else {
            None
        }
    });
    let checks = vec![
        check("HTTP 200", res.status == 200, Some(format!("got {}", res.status))),
        check("at least one deadline returned", !deadlines.is_empty(), Some(format!("count={}", deadlines.len()))),
        check(
            "deadline has deadline_date / original_deadline",
            first.map(|f| f.get("original_deadline").or(f.get("deadline_date")).map(Value::is_string).unwrap_or(false)).unwrap_or(false),
            Some(first.map(|f| format!("original_deadline={}", crate::jsval::template_or_undefined(f.get("original_deadline")))).unwrap_or_else(|| "no deadlines".into())),
        ),
        check(
            "regime is 'pre' or 'post'",
            matches!(regime_normalised, Some("pre") | Some("post")),
            Some(format!("raw={} normalised={}", regime_raw.clone().unwrap_or_else(|| "undefined".into()), regime_normalised.unwrap_or("null"))),
        ),
        check(
            "claim_type present",
            first.map(|f| f["claim_type"].is_string()).unwrap_or(false),
            Some(first.map(|f| format!("claim_type={}", crate::jsval::template_or_undefined(f.get("claim_type")))).unwrap_or_else(|| "no deadlines".into())),
        ),
    ];
    let first_deadline = first
        .map(|f| {
            obj(vec![
                ("claim_type", opt(f.get("claim_type"))),
                ("deadline_date", opt(f.get("original_deadline"))),
                ("regime", Some(regime_normalised.map(|r| json!(r)).unwrap_or(Value::Null))),
                ("raw_regime", opt(f.get("regime"))),
                ("days_remaining", opt(f.get("days_remaining"))),
                ("is_expired", opt(f.get("is_expired"))),
            ])
        })
        .unwrap_or(Value::Null);
    let extract = obj(vec![
        ("time_limit_regime", opt(body.get("time_limit_regime"))),
        ("deadline_count", Some(json!(deadlines.len()))),
        ("first_deadline", Some(first_deadline)),
        ("warnings_count", arr_len(body.get("warnings"))),
    ]);
    section("deadlines", duration, res.status, checks, extract, body)
}

async fn run_case_law_search(app: &Router) -> SectionReport {
    let start = now_ms();
    let res = call(app, get("/api/case-law/search?q=burchell")).await;
    let body = res.json();
    let duration = now_ms() - start;
    let results: Vec<Value> = body.get("results").and_then(Value::as_array).cloned().unwrap_or_default();
    // burchell is not in seed data — fall back to q=polkey to satisfy the contract.
    let mut second_try: Option<Vec<Value>> = None;
    if results.is_empty() {
        let res2 = call(app, get("/api/case-law/search?q=polkey")).await;
        if let Ok(b2) = serde_json::from_slice::<Value>(&res2.body) {
            second_try = Some(b2.get("results").and_then(Value::as_array).cloned().unwrap_or_default());
        }
    }
    let effective = second_try.clone().unwrap_or_else(|| results.clone());
    let checks = vec![
        check("HTTP 200", res.status == 200, Some(format!("got {}", res.status))),
        check("results is array", body["results"].is_array(), None),
        check("search returns at least one result (q=burchell, fallback q=polkey)", !effective.is_empty(), Some(format!("len={}", effective.len()))),
    ];
    let extract = obj(vec![
        ("query", opt(body.get("query"))),
        ("total", opt(body.get("total"))),
        ("data_source", opt(body.get("data_source"))),
        ("fallback_query_used", Some(json!(results.is_empty() && second_try.as_ref().map(|s| !s.is_empty()).unwrap_or(false)))),
        ("first_result_name", Some(effective.first().and_then(|r| r.get("case_name")).filter(|v| v.is_string()).cloned().unwrap_or(Value::Null))),
    ]);
    section("case_law_search", duration, res.status, checks, extract, body)
}

async fn run_tracker(app: &Router) -> SectionReport {
    let start = now_ms();
    let res = call(app, get("/api/era-2025/tracker")).await;
    let body = res.json();
    let duration = now_ms() - start;
    let tracker = body.get("changes").or(body.get("tracker")).cloned();
    let arr = tracker.as_ref().and_then(Value::as_array);
    let len_detail = arr.map(|a| a.len().to_string()).unwrap_or_else(|| "n/a".into());
    let checks = vec![
        check("HTTP 200", res.status == 200, Some(format!("got {}", res.status))),
        check("tracker/changes array present", arr.is_some(), Some(format!("len={len_detail}"))),
        check("at least one provision", arr.map(|a| !a.is_empty()).unwrap_or(false), Some(format!("len={len_detail}"))),
    ];
    let mut statuses: Vec<Value> = Vec::new();
    for t in arr.into_iter().flatten() {
        if let Some(s) = t.get("status").filter(|s| s.is_string()) {
            if !statuses.contains(s) {
                statuses.push(s.clone());
            }
        }
    }
    let extract = obj(vec![
        ("tracker_count", Some(arr.map(|a| json!(a.len())).unwrap_or(Value::Null))),
        ("sample_provision", Some(arr.and_then(|a| a.first()).and_then(|t| t.get("provision")).cloned().unwrap_or(Value::Null))),
        ("statuses_seen", Some(json!(statuses))),
    ]);
    let raw = obj(vec![("tracker", tracker), ("changes", opt(body.get("changes")))]);
    section("era_2025_tracker", duration, res.status, checks, extract, raw)
}

async fn run_debate(app: &Router) -> SectionReport {
    let start = now_ms();
    let res = call(app, post_json("/api/debate", &json!({ "facts": NARRATIVE, "claim_type": "unfair_dismissal" }), &[])).await;
    let body = res.json();
    let duration = now_ms() - start;
    let (rc, applied, source, changes) = refinement_checks(&body);
    let checks = vec![
        check("HTTP 200", res.status == 200, Some(format!("got {}", res.status))),
        check("drafter present", body.get("drafter").map(is_object).unwrap_or(false), None),
        check("critic present", body.get("critic").map(is_object).unwrap_or(false), None),
        check("judge present", body.get("judge").map(is_object).unwrap_or(false), None),
        check("viable is boolean", body["viable"].is_boolean(), Some(format!("viable={}", crate::jsval::template_or_undefined(body.get("viable"))))),
        rc,
    ];
    let judge = body.get("judge").cloned().unwrap_or(json!({}));
    let keys = |v: Option<&Value>| -> Value { json!(v.and_then(Value::as_object).map(|m| m.keys().cloned().collect::<Vec<_>>()).unwrap_or_default()) };
    let extract = obj(vec![
        ("viable", opt(body.get("viable"))),
        ("judge_score", opt(judge.get("score"))),
        ("judge_synthesis", Some(judge.get("synthesis").and_then(Value::as_str).map(|s| json!(substring_to(s, 240))).unwrap_or(Value::Null))),
        ("drafter_keys", Some(keys(body.get("drafter")))),
        ("critic_keys", Some(keys(body.get("critic")))),
        ("judge_keys", Some(keys(Some(&judge)))),
        ("refinement_applied", Some(applied).filter(|v| !v.is_null())),
        ("refinement_source", Some(source).filter(|v| !v.is_null())),
        ("refinement_changes", Some(changes).filter(|v| !v.is_null())),
    ]);
    section("debate", duration, res.status, checks, extract, body)
}

/// Run all seven sections against an in-process router.
pub async fn run(app: &Router, llm_provider: &str, api_key_present: bool) -> Report {
    let overall_start = now_ms();
    let environment = Environment {
        node_version: format!("rust ({} {})", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION")),
        platform: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        llm_provider: llm_provider.to_string(),
        anthropic_api_key_present: api_key_present,
        cwd: std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default(),
        timestamp: th_core::dates::iso_datetime_from_epoch_ms(overall_start),
    };
    let schema_lookup = run_schema_lookup(app).await;
    let triage = run_triage(app).await;
    let analyse = run_analyse(app).await;
    let deadlines = run_deadlines(app).await;
    let case_law_search = run_case_law_search(app).await;
    let era_2025_tracker = run_tracker(app).await;
    let debate = run_debate(app).await;
    let sections = [&schema_lookup, &triage, &analyse, &deadlines, &case_law_search, &era_2025_tracker, &debate];
    let ok = sections.iter().filter(|s| s.status == "OK").count();
    let fail = sections.len() - ok;
    Report {
        environment,
        schema_lookup: schema_lookup.clone(),
        triage: triage.clone(),
        analyse: analyse.clone(),
        deadlines: deadlines.clone(),
        case_law_search: case_law_search.clone(),
        era_2025_tracker: era_2025_tracker.clone(),
        debate: debate.clone(),
        summary: Summary { ok, fail, total: sections.len(), duration_ms: now_ms() - overall_start, overall_status: if fail == 0 { "PASS" } else { "FAIL" } },
    }
}

// ─── Markdown rendering (port of renderMarkdown) ─────────────────────────

fn fmt_kv(obj: Option<&Map<String, Value>>) -> String {
    let Some(obj) = obj else { return "_(none)_".into() };
    obj.iter()
        .map(|(k, v)| {
            let display = match v {
                Value::Null => "_null_".to_string(),
                Value::String(s) => {
                    if crate::jsval::utf16_len(s) > 200 {
                        format!("{}…", substring_to(s, 200))
                    } else {
                        s.clone()
                    }
                }
                Value::Array(a) => format!("[{} item{}]: {}", a.len(), if a.len() == 1 { "" } else { "s" }, substring_to(&serde_json::to_string(v).unwrap_or_default(), 200)),
                Value::Object(_) => format!("```\n{}\n```", substring_to(&serde_json::to_string_pretty(v).unwrap_or_default(), 800)),
                other => crate::jsval::template(other),
            };
            format!("- **{k}**: {display}")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn fmt_checks(checks: Option<&Vec<Check>>) -> String {
    match checks {
        Some(cs) if !cs.is_empty() => cs
            .iter()
            .map(|c| format!("- [{}] {}{}", if c.pass { "x" } else { " " }, c.description, c.detail.as_ref().map(|d| format!("  _({d})_")).unwrap_or_default()))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

pub fn render_markdown(report: &Report) -> String {
    let e = &report.environment;
    let s = &report.summary;
    let sections: [(&SectionReport, &str); 7] = [
        (&report.schema_lookup, "Schema lookup — GET /api/schema/unfair_dismissal"),
        (&report.triage, "Triage — POST /api/triage"),
        (&report.analyse, "Analyse — POST /api/analyse"),
        (&report.deadlines, "Deadlines — POST /api/deadlines"),
        (&report.case_law_search, "Case Law search — GET /api/case-law/search"),
        (&report.era_2025_tracker, "ERA 2025 tracker — GET /api/era-2025/tracker"),
        (&report.debate, "Debate — POST /api/debate"),
    ];
    let mut parts: Vec<String> = vec![
        "# Tribunal Harness — Smoke Run Report".into(),
        format!("_{}_", e.timestamp),
        String::new(),
        format!("**Overall status: {}**", if s.overall_status == "PASS" { "✅ PASS" } else { "❌ FAIL" }),
        format!("Sections OK: {}/{} — Failures: {} — Total duration: {} ms", s.ok, s.total, s.fail, s.duration_ms),
        String::new(),
        "## Environment".into(),
        fmt_kv(serde_json::to_value(e).ok().as_ref().and_then(Value::as_object)),
        String::new(),
    ];
    for (sec, title) in sections {
        let icon = if sec.status == "OK" { "✅" } else { "❌" };
        parts.push(format!("## {icon} {title}"));
        parts.push(format!("- **status**: {}{}", sec.status, sec.http_status.map(|h| format!(" (HTTP {h})")).unwrap_or_default()));
        parts.push(format!("- **duration**: {} ms", sec.duration_ms));
        if let Some(err) = &sec.error {
            parts.push(format!("- **error**: `{err}`"));
        }
        let checks_md = fmt_checks(sec.checks.as_ref());
        if !checks_md.is_empty() {
            parts.push(String::new());
            parts.push("**Checks**".into());
            parts.push(checks_md);
        }
        if let Some(extract) = &sec.extract {
            parts.push(String::new());
            parts.push("**Extract**".into());
            parts.push(fmt_kv(extract.as_object()));
        }
        parts.push(String::new());
    }
    parts.push("## Summary".into());
    parts.push(fmt_kv(serde_json::to_value(s).ok().as_ref().and_then(Value::as_object)));
    parts.push(String::new());
    parts.push("---".into());
    parts.push("_This is an automated smoke run. The agent stand-in (LLM_PROVIDER=agent) was used for LLM-backed routes; no Anthropic API calls were made._".into());
    parts.join("\n")
}
