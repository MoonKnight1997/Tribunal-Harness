//! F-29 (UI): helpers for the adversarial-debate workspace.

use crate::types::TrustLevel;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DebateMode {
    SinglePass,
    Adversarial,
}

impl DebateMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            DebateMode::SinglePass => "single_pass",
            DebateMode::Adversarial => "adversarial",
        }
    }
    pub fn parse(s: &str) -> Option<DebateMode> {
        match s {
            "single_pass" => Some(DebateMode::SinglePass),
            "adversarial" => Some(DebateMode::Adversarial),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebateModeOption {
    pub id: DebateMode,
    pub label: &'static str,
    pub tagline: &'static str,
    pub cost_tag: &'static str,
    pub higher_cost: bool,
    pub cost_note: &'static str,
    pub description: &'static str,
}

pub const DEBATE_MODES: [DebateModeOption; 2] = [
    DebateModeOption {
        id: DebateMode::SinglePass,
        label: "Single pass",
        tagline: "One Drafter → Critic → Judge round.",
        cost_tag: "Lower cost · one round",
        higher_cost: false,
        cost_note: "Runs a single round of three model calls. Faster and cheaper.",
        description: "One pass: the Drafter builds the strongest version of your argument, the Critic attacks it once, and the Judge scores viability. Best for a quick first read on a claim.",
    },
    DebateModeOption {
        id: DebateMode::Adversarial,
        label: "Adversarial (Draft → Attack → Revise → Score)",
        tagline: "Multiple rounds of drafting, adversarial critique and revision.",
        cost_tag: "Higher cost · runs multiple rounds",
        higher_cost: true,
        cost_note: "More expensive and slower to run: up to three iterations, each looping Critic → Drafter revision → Judge, with additional higher-tier (Opus) model calls.",
        description: "The Drafter produces an initial argument, then up to three rounds of Critic attack, Drafter revision and Judge scoring, stopping early once the Judge scores the draft viable (≥ 70). It surfaces and repairs weaknesses your opponent would exploit, at a higher cost.",
    },
];

pub fn get_debate_mode(id: &str) -> &'static DebateModeOption {
    DEBATE_MODES.iter().find(|m| m.id.as_str() == id).unwrap_or(&DEBATE_MODES[0])
}

fn pick_string(rec: &serde_json::Map<String, Value>, keys: &[&str]) -> String {
    for k in keys {
        if let Some(Value::String(s)) = rec.get(*k) {
            if !s.trim().is_empty() {
                return s.clone();
            }
        }
    }
    String::new()
}

/// The Drafter's argument prose (tolerant of the JSON-parse fallback shape).
pub fn get_argument_text(drafter: Option<&Value>) -> String {
    match drafter {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Object(o)) => pick_string(o, &["argument", "draft", "text", "content"]),
        _ => String::new(),
    }
}

pub fn get_synthesis_text(judge: Option<&Value>) -> String {
    match judge {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Object(o)) => pick_string(o, &["synthesis", "summary", "reasoning", "content"]),
        _ => String::new(),
    }
}

fn finite_number(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|f| f.is_finite())
}

/// The Judge's numeric score if present and finite (round first, then judge block).
pub fn get_score(round: Option<&Value>, judge: Option<&Value>) -> Option<f64> {
    if let Some(s) = round.and_then(|r| r.get("score")).and_then(|v| finite_number(Some(v))) {
        return Some(s);
    }
    judge.and_then(|j| j.as_object()).and_then(|j| finite_number(j.get("score")))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayAuthority {
    pub title: String,
    pub citation: String,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trust_level: Option<TrustLevel>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Partition {
    pub displayed: Vec<DisplayAuthority>,
    pub quarantined: usize,
}

/// Turn a citation-bearing array into display authorities, partitioning the
/// QUARANTINED ones out (Hard Rule 2 / F-7: never render their text).
pub fn partition_authorities(items: Option<&Value>, name_key: Option<&str>) -> Partition {
    let Some(Value::Array(items)) = items else {
        return Partition { displayed: vec![], quarantined: 0 };
    };
    let mut displayed = Vec::new();
    let mut quarantined = 0;
    for item in items {
        let Some(rec) = item.as_object() else { continue };
        let trust_level = match rec.get("trust_level").and_then(Value::as_str) {
            Some("VERIFIED") => Some(TrustLevel::Verified),
            Some("CHECK") => Some(TrustLevel::Check),
            Some("QUARANTINED") => Some(TrustLevel::Quarantined),
            _ => None,
        };
        if trust_level == Some(TrustLevel::Quarantined) {
            quarantined += 1;
            continue;
        }
        let mut name_keys: Vec<&str> = Vec::new();
        if let Some(k) = name_key {
            name_keys.push(k);
        }
        name_keys.extend(["matched_case", "authority", "name", "weakness", "point", "title"]);
        let title = pick_string(rec, &name_keys);
        let detail = pick_string(rec, &["validation_reason", "principle", "explanation", "weakness", "detail", "reason"]);
        let citation = pick_string(rec, &["citation", "matched_citation"]);
        if title.is_empty() && citation.is_empty() && detail.is_empty() {
            continue;
        }
        let title = if !title.is_empty() {
            title
        } else if !citation.is_empty() {
            citation.clone()
        } else {
            "Cited authority".to_string()
        };
        displayed.push(DisplayAuthority { title, citation, detail, trust_level });
    }
    Partition { displayed, quarantined }
}

/// Integer with thousands separators.
pub fn format_int(n: f64) -> String {
    if !n.is_finite() {
        return "0".to_string();
    }
    let r = crate::jsnum::js_round(n) as i64;
    let s = r.abs().to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    if r < 0 {
        format!("-{out}")
    } else {
        out
    }
}

pub fn format_usage(usage: Option<&Value>) -> String {
    let get = |k: &str| usage.and_then(|u| u.get(k)).and_then(Value::as_f64).unwrap_or(0.0);
    format!("{} input · {} output tokens", format_int(get("total_input_tokens")), format_int(get("total_output_tokens")))
}

pub fn describe_rounds(mode: DebateMode, rounds_run: Option<i64>, stopped_early: bool) -> String {
    let n = rounds_run.filter(|r| *r > 0).unwrap_or(0);
    if mode == DebateMode::SinglePass {
        return "Single pass — one Drafter → Critic → Judge round.".to_string();
    }
    let word = if n == 1 { "round" } else { "rounds" };
    let base = format!("Adversarial mode ran {n} scored {word}");
    if stopped_early {
        format!("{base} — stopped early once the Judge scored a viable draft (≥ 70).")
    } else {
        format!("{base} — reached the maximum without a viable score.")
    }
}

pub fn viability_label(viable: Option<bool>) -> &'static str {
    match viable {
        Some(true) => "Viable",
        Some(false) => "Not yet viable",
        None => "No score returned",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn helpers() {
        assert_eq!(format_int(12345.0), "12,345");
        assert_eq!(format_int(999.0), "999");
        assert_eq!(format_int(1_000_000.0), "1,000,000");
        assert_eq!(format_usage(Some(&json!({"total_input_tokens": 12345, "total_output_tokens": 6789}))), "12,345 input · 6,789 output tokens");
        assert_eq!(format_usage(None), "0 input · 0 output tokens");
        assert!(describe_rounds(DebateMode::Adversarial, Some(2), true).contains("2 scored rounds"));
        assert_eq!(get_score(Some(&json!({"score": 82})), None), Some(82.0));
        assert_eq!(get_score(Some(&json!({"score": null})), Some(&json!({"score": 71}))), Some(71.0));
        let p = partition_authorities(
            Some(&json!([
                {"authority": "Polkey v AE Dayton", "citation": "[1988] ICR 142", "trust_level": "VERIFIED", "validation_reason": "Matched."},
                {"authority": "Made Up v Nobody", "citation": "[2099] FAKE 1", "trust_level": "QUARANTINED"},
                {"authority": "Iceland", "citation": "[1982] IRLR 439", "trust_level": "CHECK"}
            ])),
            Some("authority"),
        );
        assert_eq!(p.quarantined, 1);
        assert_eq!(p.displayed.len(), 2);
        assert_eq!(get_debate_mode("nonsense").id, DebateMode::SinglePass);
    }
}
