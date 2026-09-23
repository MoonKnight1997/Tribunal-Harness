//! Agent Stand-In LLM Provider — port of `src/lib/llm/agent-provider.ts`.
//!
//! A deterministic, OFFLINE stand-in for the LLM. When `LLM_PROVIDER=agent`
//! every model call is answered here with well-formed, schema-conformant JSON
//! derived from the real claim schemas and the ERA 2025 constants.
//!
//! HERMETICITY (legal-safety critical): the authorities synthesised here cite
//! ONLY curated short names whose leading tokens match
//! `verified_authorities`, and carry the EXACT neutral citation, so
//! `/api/analyse` re-verifies them from the curated list with no network call.
//!
//! This produces legal INFORMATION, not legal advice. It is a fixture, not a
//! substitute for a real model's judgement.

use crate::constants::{format_commencement_date, ERA_2025};
use crate::schemas::get_schema;
use regex::Regex;
use serde_json::{json, Value};
use std::sync::LazyLock;

/// Pseudo "model" id surfaced in debug metadata.
pub const AGENT_STAND_IN_MODEL: &str = "agent-stand-in";

pub struct AgentProviderRequest<'a> {
    pub endpoint: &'a str,
    #[allow(dead_code)]
    pub system: &'a str,
    pub user_message: &'a str,
}

struct Cite {
    name: &'static str,
    citation: &'static str,
    principle: &'static str,
}

const POLKEY: Cite = Cite {
    name: "Polkey v AE Dayton Services Ltd",
    citation: "Polkey v AE Dayton Services Ltd [1987] UKHL 8",
    principle: "A procedurally unfair dismissal is not saved by the argument that a fair procedure would have made no difference; that question goes to remedy (the 'Polkey reduction'), not liability.",
};
const BURCHELL: Cite = Cite {
    name: "British Home Stores Ltd v Burchell",
    citation: "BHS v Burchell [1978] UKEAT 0108_78_2007",
    principle: "For a conduct dismissal the employer must genuinely believe in the misconduct, on reasonable grounds, after a reasonable investigation.",
};
const ICELAND: Cite = Cite {
    name: "Iceland Frozen Foods Ltd v Jones",
    citation: "Iceland Frozen Foods Ltd v Jones [1982] UKEAT 0062_82_2207",
    principle: "The tribunal must not substitute its own view; it asks whether dismissal fell within the band of reasonable responses open to a reasonable employer.",
};

fn cite_json(c: &Cite, trust: &str) -> Value {
    json!({ "name": c.name, "citation": c.citation, "principle": c.principle, "trust_level": trust })
}

static CLAIM_TYPE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)claim[_ ]?type:\s*([a-z][a-z_]*)").unwrap());
static NARRATIVE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)Narrative:\s*(.*?)(?:\n\n[A-Z][a-z]|$)").unwrap());
static FACTS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)Facts:\s*(.*?)(?:\n\n[A-Z][a-z]|$)").unwrap());

/// Extract the claim type id from a route-built user message (default
/// `unfair_dismissal`).
pub fn extract_claim_type(user_message: &str) -> String {
    CLAIM_TYPE_RE
        .captures(user_message)
        .map(|c| c[1].to_lowercase())
        .unwrap_or_else(|| "unfair_dismissal".to_string())
}

fn extract_facts(user_message: &str) -> String {
    if let Some(c) = NARRATIVE_RE.captures(user_message) {
        return c[1].trim().to_string();
    }
    if let Some(c) = FACTS_RE.captures(user_message) {
        return c[1].trim().to_string();
    }
    user_message.trim().to_string()
}

static DETECT: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    vec![
        (Regex::new(r"dismiss|terminat|sacked|let go|gross misconduct").unwrap(), "unfair_dismissal"),
        (Regex::new(r"safety|whistle|disclosure|protected|raised concerns|wrongdoing").unwrap(), "whistleblowing"),
        (Regex::new(r"discriminat|pregnan|race|disab|religion|sex|age").unwrap(), "direct_discrimination"),
        (Regex::new(r"harass|offensive|hostile|intimidat").unwrap(), "harassment"),
        (Regex::new(r"resign|constructive|breach of contract").unwrap(), "wrongful_dismissal"),
    ]
});

fn detect_claim_types(text: &str) -> Vec<&'static str> {
    let t = text.to_lowercase();
    let types: Vec<&'static str> = DETECT.iter().filter(|(re, _)| re.is_match(&t)).map(|(_, id)| *id).collect();
    if types.is_empty() {
        vec!["unfair_dismissal"]
    } else {
        types
    }
}

/// `claimType.replace(/_/g, " ")`
fn humanise(claim_type: &str) -> String {
    claim_type.replace('_', " ")
}

fn synth_analyse(claim_type: &str) -> Value {
    let schema = get_schema(claim_type);
    let label = schema.map(|s| s.label).unwrap_or("Unfair Dismissal");
    let statute = schema.map(|s| s.statute).unwrap_or("ERA 1996 s98");
    let default_test = [
        "The claimant was an employee with the requisite qualifying service",
        "The claimant was dismissed within the meaning of s95 ERA 1996",
        "The employer cannot show a potentially fair reason under s98(1)-(2)",
        "The dismissal was not fair in all the circumstances under s98(4)",
    ];
    let legal_test: Vec<String> = match schema {
        Some(s) if !s.legal_test.is_empty() => s.legal_test.clone(),
        _ => default_test.iter().map(|s| s.to_string()).collect(),
    };
    let lower_label = label.to_lowercase();

    // `statute.split(" ").slice(0, 2).join(" ") || "ERA 1996"`
    let statute_head = statute.split(' ').take(2).collect::<Vec<_>>().join(" ");
    let statute_head = if statute_head.is_empty() { "ERA 1996".to_string() } else { statute_head };
    // `statute.replace(/^[A-Za-z0-9]+\s[0-9]+\s?/, "") || "s98"`
    static SECTION_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9]+\s[0-9]+\s?").unwrap());
    let section = SECTION_RE.replacen(statute, 1, "").to_string();
    let section = if section.is_empty() { "s98".to_string() } else { section };

    json!({
        "claims": [{
            "type": claim_type,
            "strength": "MODERATE",
            "reasoning": format!("On the facts provided there is a viable {lower_label} claim. The absence of any investigation meeting before a 'gross misconduct' dismissal is a strong indicator of procedural unfairness under s98(4). Strength is MODERATE rather than STRONG because the merits turn on disputed facts (the reason for dismissal and what investigation, if any, occurred) that require evidence to resolve."),
            "legal_test_elements": legal_test.iter().enumerate().map(|(i, element)| json!({
                "element": element,
                "satisfied": i < 2,
                "evidence": if i < 2 {
                    "Supported by the narrative facts (employment relationship and dismissal are not in dispute)."
                } else {
                    "Fact-dependent — requires disclosure of the investigation record and the employer's stated reason."
                },
            })).collect::<Vec<_>>(),
        }],
        "authorities": [cite_json(&BURCHELL, "VERIFIED"), cite_json(&ICELAND, "VERIFIED"), cite_json(&POLKEY, "VERIFIED")],
        "statutory_provisions": [
            {
                "statute": statute_head,
                "section": section,
                "relevance": format!("Primary statutory test for {lower_label}: reason for dismissal and overall fairness."),
            },
            {
                "statute": "ERA 1996",
                "section": "s207B",
                "relevance": "ACAS Early Conciliation clock-stop: the limitation period is extended by the Day A → Day B period (or one month from Day B, whichever is longer).",
            }
        ],
        "procedural_notes": [
            "Time limit (act before October 2026): three months less one day from the effective date of termination.",
            "ACAS Early Conciliation is mandatory before an ET1 can be presented; obtain the EC certificate first.",
            "Request written reasons for dismissal under s92 ERA 1996 if not already provided.",
        ],
        "era_2025_flags": [
            {
                "provision": "Unfair dismissal qualifying period reduced to 6 months",
                "applies": false,
                "reason": "The effective date of termination is before the commencement date, so the 2-year qualifying period regime still applies on these facts.",
                "commencement_date": format_commencement_date(ERA_2025.qualifying_period_6_months),
                "status": "upcoming",
            },
            {
                "provision": "ET time limit extended to 6 months less one day",
                "applies": false,
                "reason": "The act complained of pre-dates commencement; the three-months-less-one-day limit applies. Exact commencement date to be confirmed by Statutory Instrument.",
                "commencement_date": format_commencement_date(ERA_2025.et_time_limit_6_months),
                "status": "upcoming",
            }
        ]
    })
}

fn synth_triage(text: &str) -> Value {
    let detected = detect_claim_types(text);
    json!({
        "updated_fields": { "edt": "2026-03-03", "employment_start_date": "2022-01-10", "dismissal_reason": "gross misconduct" },
        "query_array": [
            {
                "field_id": "investigation_held",
                "question": "Was an investigation meeting or disciplinary hearing held before your dismissal?",
                "ui_component": "radio",
                "options": ["Yes", "No", "Not sure"],
                "legal_relevance": "Absence of a fair procedure (investigation, hearing, appeal) is central to fairness under s98(4) ERA 1996.",
            },
            {
                "field_id": "acas_ec_started",
                "question": "Have you started ACAS Early Conciliation, and if so on what date?",
                "ui_component": "date",
                "options": null,
                "legal_relevance": "ACAS EC is mandatory before presenting an ET1 and stops the limitation clock between Day A and Day B.",
            }
        ],
        "document_summary": "Synthetic narrative: a warehouse employee with approximately four years' service was dismissed on 3 March 2026 for 'gross misconduct' shortly after raising written health and safety concerns. The narrative states no investigation meeting was held, raising both ordinary unfair dismissal (procedure) and a potential protected-disclosure dimension.",
        "potential_claim_types": detected,
        "extracted_dates": { "edt": "2026-03-03", "last_act": "2026-03-03", "acas_day_a": null, "acas_day_b": null, "employment_start": "2022-01-10" },
    })
}

fn synth_drafter(claim_type: &str) -> Value {
    json!({
        "factual_summary": "The claimant, a warehouse employee of around four years' standing, was summarily dismissed on 3 March 2026 for alleged 'gross misconduct' shortly after raising written health and safety concerns. No investigation meeting or disciplinary hearing was held before the decision.",
        "legal_framework": [
            { "element": "Reasonable investigation", "authority": BURCHELL.name, "citation": BURCHELL.citation },
            { "element": "Band of reasonable responses", "authority": ICELAND.name, "citation": ICELAND.citation },
            { "element": "Effect of procedural defects", "authority": POLKEY.name, "citation": POLKEY.citation },
        ],
        "application": [
            { "element": "Reasonable investigation (Burchell)", "facts_supporting": "No investigation meeting was held, so the employer cannot show it formed its belief in misconduct on reasonable grounds after a reasonable investigation.", "strength": "STRONG" },
            { "element": "Fair procedure / Polkey", "facts_supporting": "The complete absence of a hearing or appeal points to a procedurally unfair dismissal; any 'would have dismissed anyway' argument goes to a Polkey reduction in remedy, not liability.", "strength": "STRONG" },
            { "element": "Reason for dismissal", "facts_supporting": "Dismissal closely following protected health-and-safety concerns raises a question over the true reason, which is fact-sensitive and to be tested in evidence.", "strength": "MODERATE" },
        ],
        "remedies": [
            { "type": "Basic award", "basis": "s119 ERA 1996 — calculated on age, length of service and a week's pay." },
            { "type": "Compensatory award", "basis": "s123 ERA 1996 — loss flowing from the dismissal, subject to the statutory cap for a pre-2027 EDT and to any Polkey reduction." },
            { "type": "Reinstatement / re-engagement", "basis": "ss113-116 ERA 1996 — available but rarely ordered; the claimant should indicate preference." },
        ],
        "overall_assessment": format!("The {} claim is arguable and, on procedure, strong. The principal exposure is evidential — establishing the true reason for dismissal and rebutting any band-of-reasonable-responses defence.", humanise(claim_type)),
    })
}

fn synth_critic(claim_type: &str) -> Value {
    json!({
        "attacks": [
            { "weakness": "Qualifying service and reason may be contested; gross misconduct, if proven, is a potentially fair conduct reason.", "legal_basis": "s98(1)-(2) ERA 1996; band of reasonable responses", "citation": ICELAND.citation, "severity": "SIGNIFICANT" },
            { "weakness": "Even if the procedure was flawed, compensation may be heavily reduced if dismissal was inevitable on the facts.", "legal_basis": "Polkey reduction to the compensatory award", "citation": POLKEY.citation, "severity": "SIGNIFICANT" },
        ],
        "factual_gaps": [
            { "missing_fact": "Whether any investigation, hearing or appeal occurred at all (the narrative asserts none, but the employer's records are not before us).", "why_it_matters": "Determines whether the Burchell reasonable-investigation limb is breached." },
            { "missing_fact": "The precise content and audience of the health and safety concerns raised.", "why_it_matters": "Goes to whether there is a qualifying protected disclosure capable of making the dismissal automatically unfair." },
        ],
        "procedural_risks": [
            { "risk": "Time limit: three months less one day from the EDT (pre-October-2026 regime).", "consequence": "A late ET1 is liable to be struck out unless it was not reasonably practicable to present in time." },
            { "risk": "ACAS Early Conciliation not yet shown as commenced.", "consequence": "An ET1 presented without a valid EC certificate will be rejected." },
        ],
        "overall_vulnerability_assessment": format!("The {} claim's procedural footing is solid but its value is exposed to a Polkey reduction and to a conduct-reason defence. The protected-disclosure angle is promising but presently under-evidenced.", humanise(claim_type)),
    })
}

fn synth_judge(claim_type: &str) -> Value {
    let score = 21 + 17 + 15 + 13 + 13;
    json!({
        "score": score,
        "score_breakdown": {
            "legal_test_completeness": { "score": 21, "max": 25, "reasoning": "All s98 elements identified and addressed; minor gaps on qualifying-service evidence." },
            "evidential_sufficiency": { "score": 17, "max": 25, "reasoning": "Procedural unfairness is well-supported; the true reason for dismissal is under-evidenced." },
            "procedural_compliance": { "score": 15, "max": 20, "reasoning": "Correct time-limit regime and ACAS EC identified; EC certificate not yet obtained." },
            "era_2025_awareness": { "score": 13, "max": 15, "reasoning": "Correctly applies the pre-commencement regime to a March 2026 EDT and flags the upcoming changes." },
            "authority_quality": { "score": 13, "max": 15, "reasoning": "Authorities (Burchell, Iceland Frozen Foods, Polkey) are real, binding/persuasive and correctly applied." },
        },
        "synthesis": format!("The {} claim is viable. The strongest ground is procedural unfairness (no investigation, contrary to Burchell), with the principal contest being the true reason for dismissal and the size of any Polkey reduction. On the rubric the argument scores {score}/100 and crosses the 70-point viability threshold.", humanise(claim_type)),
        "key_vulnerabilities": [
            "A conduct-reason defence if the employer can evidence reasonable grounds and investigation.",
            "A Polkey reduction substantially cutting the compensatory award.",
            "The protected-disclosure angle is currently under-evidenced.",
        ],
        "evidentiary_requirements": [
            "Disclosure of the investigation and disciplinary records (or proof none exist).",
            "Contemporaneous evidence of the health and safety concerns raised and to whom.",
            "Pay and continuity records to fix qualifying service and quantum.",
        ],
        "procedural_recommendations": [
            "Commence ACAS Early Conciliation immediately and preserve the certificate.",
            "Calculate and diarise the three-months-less-one-day limit from the EDT.",
            "Request written reasons for dismissal under s92 ERA 1996.",
        ],
        "viable": score >= 70,
    })
}

/// Refinement stand-in: echoes `prose_fields` back under `refined_fields`.
fn synth_refine(user_message: &str) -> String {
    match serde_json::from_str::<Value>(user_message) {
        Ok(v) => {
            let prose = v.get("prose_fields").and_then(|p| p.as_object()).cloned().unwrap_or_default();
            json!({ "refined_fields": Value::Object(prose), "notes": "agent stand-in pass-through" }).to_string()
        }
        Err(_) => json!({ "refined_fields": {}, "notes": "agent stand-in pass-through (no parseable prose_fields)" }).to_string(),
    }
}

/// Generate a well-formed JSON response string for the given endpoint — the
/// value `call_claude` returns as `content` when `LLM_PROVIDER=agent`.
pub fn generate_agent_response(req: &AgentProviderRequest<'_>) -> String {
    match req.endpoint {
        "analyse" | "analyse_complex" => synth_analyse(&extract_claim_type(req.user_message)).to_string(),
        "triage" => synth_triage(&extract_facts(req.user_message)).to_string(),
        "drafter" => synth_drafter(&extract_claim_type(req.user_message)).to_string(),
        "critic" => synth_critic(&extract_claim_type(req.user_message)).to_string(),
        "judge" => synth_judge(&extract_claim_type(req.user_message)).to_string(),
        "refine" => synth_refine(req.user_message),
        other => json!({
            "note": format!("agent stand-in has no synthesiser for endpoint '{other}'"),
            "claim_type": extract_claim_type(req.user_message),
        })
        .to_string(),
    }
}

/// Rough token estimate (~4 chars/token, JS string length = UTF-16 units).
pub fn estimate_tokens(text: &str) -> u64 {
    let len = text.encode_utf16().count() as u64;
    len.div_ceil(4).max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claim_type_extraction_and_tokens() {
        assert_eq!(extract_claim_type("Claim type: harassment\nMode: x"), "harassment");
        assert_eq!(extract_claim_type("claim_type: WHISTLEBLOWING and more"), "whistleblowing");
        assert_eq!(extract_claim_type("nothing"), "unfair_dismissal");
        assert_eq!(estimate_tokens(""), 1);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2);
    }

    #[test]
    fn analyse_shape() {
        let s = generate_agent_response(&AgentProviderRequest { endpoint: "analyse", system: "", user_message: "claim_type: unfair_dismissal" });
        let v: Value = serde_json::from_str(&s).unwrap();
        for k in ["claims", "authorities", "statutory_provisions", "procedural_notes", "era_2025_flags"] {
            assert!(v[k].is_array(), "{k}");
        }
        assert_eq!(v["authorities"].as_array().unwrap().len(), 3);
    }
}
