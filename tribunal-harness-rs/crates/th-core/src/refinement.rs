//! Legal-writing refinement — the pure parts of
//! `src/services/legal-writing-refinement.ts`: per-endpoint prose allowlists,
//! dotted-path expansion, get/set by path, splice and response parsing. The
//! async driver (`refine_for_user`) is in `th-services::refinement`.

use crate::jsnum::js_number_of_str;
use serde_json::{Map, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefineEndpoint {
    Analyse,
    Triage,
    Debate,
}

impl RefineEndpoint {
    pub fn as_str(&self) -> &'static str {
        match self {
            RefineEndpoint::Analyse => "analyse",
            RefineEndpoint::Triage => "triage",
            RefineEndpoint::Debate => "debate",
        }
    }
}

/// `[]` denotes "iterate every element of the array at this position".
pub fn endpoint_prose_fields(endpoint: RefineEndpoint) -> &'static [&'static str] {
    match endpoint {
        RefineEndpoint::Analyse => &[
            "claims[].reasoning",
            "claims[].legal_test_elements[].evidence",
            "authorities[].principle",
            "statutory_provisions[].relevance",
            "procedural_notes[]",
            "era_2025_flags[].reason",
        ],
        RefineEndpoint::Triage => &["document_summary", "query_array[].question", "query_array[].legal_relevance"],
        RefineEndpoint::Debate => &[
            "drafter.factual_summary",
            "drafter.application[].facts_supporting",
            "drafter.remedies[].basis",
            "drafter.overall_assessment",
            "critic.attacks[].weakness",
            "critic.attacks[].legal_basis",
            "critic.factual_gaps[].missing_fact",
            "critic.factual_gaps[].why_it_matters",
            "critic.procedural_risks[].risk",
            "critic.procedural_risks[].consequence",
            "critic.overall_vulnerability_assessment",
            "judge.synthesis",
            "judge.score_breakdown.legal_test_completeness.reasoning",
            "judge.score_breakdown.evidential_sufficiency.reasoning",
            "judge.score_breakdown.procedural_compliance.reasoning",
            "judge.score_breakdown.era_2025_awareness.reasoning",
            "judge.score_breakdown.authority_quality.reasoning",
            "judge.key_vulnerabilities[]",
            "judge.evidentiary_requirements[]",
            "judge.procedural_recommendations[]",
        ],
    }
}

struct PathStep<'a> {
    key: &'a str,
    iterate: bool,
}

fn parse_path(path: &str) -> Vec<PathStep<'_>> {
    path.split('.')
        .map(|seg| match seg.strip_suffix("[]") {
            Some(k) => PathStep { key: k, iterate: true },
            None => PathStep { key: seg, iterate: false },
        })
        .collect()
}

/// Expand a template path against a payload → concrete leaf paths whose
/// value is a string (e.g. `claims.0.reasoning`).
pub fn expand_path(payload: &Value, path: &str) -> Vec<String> {
    let steps = parse_path(path);
    let mut results = Vec::new();
    fn walk(node: &Value, steps: &[PathStep<'_>], idx: usize, crumbs: &mut Vec<String>, out: &mut Vec<String>) {
        if idx == steps.len() {
            if node.is_string() {
                out.push(crumbs.join("."));
            }
            return;
        }
        let step = &steps[idx];
        let Some(obj) = node.as_object() else { return };
        let Some(next) = obj.get(step.key) else { return };
        crumbs.push(step.key.to_string());
        if step.iterate {
            if let Some(arr) = next.as_array() {
                for (i, item) in arr.iter().enumerate() {
                    crumbs.push(i.to_string());
                    walk(item, steps, idx + 1, crumbs, out);
                    crumbs.pop();
                }
            }
        } else {
            walk(next, steps, idx + 1, crumbs, out);
        }
        crumbs.pop();
    }
    walk(payload, &steps, 0, &mut Vec::new(), &mut results);
    results
}

/// JS `Number(p)` → integer index, or `None` (NaN / non-integer).
fn js_index(p: &str) -> Option<usize> {
    let n = js_number_of_str(p)?;
    if n.fract() != 0.0 || n < 0.0 {
        return None;
    }
    Some(n as usize)
}

/// Read the leaf at a concrete dotted path (numeric segments index arrays).
pub fn get_by_path<'a>(obj: &'a Value, path: &str) -> Option<&'a Value> {
    let mut cur = obj;
    for p in path.split('.') {
        match cur {
            Value::Array(a) => {
                let i = js_index(p)?;
                cur = a.get(i)?;
            }
            Value::Object(m) => {
                cur = m.get(p)?;
            }
            _ => return None,
        }
    }
    Some(cur)
}

/// Set the leaf at a concrete dotted path in place. Returns false if the
/// parent path is missing or of the wrong shape.
pub fn set_by_path(obj: &mut Value, path: &str, value: Value) -> bool {
    let parts: Vec<&str> = path.split('.').collect();
    let mut cur = obj;
    for p in &parts[..parts.len() - 1] {
        let next = match cur {
            Value::Array(a) => match js_index(p) {
                Some(i) => a.get_mut(i),
                None => return false,
            },
            Value::Object(m) => m.get_mut(*p),
            _ => return false,
        };
        match next {
            Some(v) if !v.is_null() => cur = v,
            _ => return false,
        }
    }
    let last = parts[parts.len() - 1];
    match cur {
        Value::Array(a) => match js_index(last) {
            Some(i) => {
                if i < a.len() {
                    a[i] = value;
                } else {
                    // JS `cur[idx] = value` grows the array (holes become null).
                    while a.len() < i {
                        a.push(Value::Null);
                    }
                    a.push(value);
                }
                true
            }
            None => false,
        },
        Value::Object(m) => {
            m.insert(last.to_string(), value);
            true
        }
        _ => false,
    }
}

/// Collect the allowlisted non-empty prose strings, keyed by concrete path
/// (insertion order = template order then array order).
pub fn collect_prose_fields(endpoint: RefineEndpoint, payload: &Value) -> Map<String, Value> {
    let mut out = Map::new();
    for template in endpoint_prose_fields(endpoint) {
        for cp in expand_path(payload, template) {
            if let Some(Value::String(s)) = get_by_path(payload, &cp) {
                if !s.is_empty() {
                    out.insert(cp, Value::String(s.clone()));
                }
            }
        }
    }
    out
}

pub fn same_keys(a: &Map<String, Value>, b: &Map<String, Value>) -> bool {
    a.len() == b.len() && b.keys().all(|k| a.contains_key(k))
}

/// Splice refined strings into a clone of the payload; returns (clone, changes).
pub fn splice_refined_fields(original: &Value, refined: &Map<String, Value>) -> (Value, usize) {
    let mut next = original.clone();
    let mut changes = 0;
    for (path, value) in refined {
        let Value::String(new) = value else { continue };
        let prev = match get_by_path(&next, path) {
            Some(Value::String(s)) => s.clone(),
            _ => continue,
        };
        if &prev != new && set_by_path(&mut next, path, Value::String(new.clone())) {
            changes += 1;
        }
    }
    (next, changes)
}

pub struct RefineResponse {
    pub refined_fields: Map<String, Value>,
    pub notes: String,
}

/// Parse the model's JSON, tolerating ``` fences; `None` on any shape problem.
pub fn parse_claude_json(content: &str) -> Option<RefineResponse> {
    let mut text = content.trim().to_string();
    if text.starts_with("```") {
        // /^```(?:json)?\s*/i then /```\s*$/i
        let lower = text.to_lowercase();
        let head = if lower.starts_with("```json") { 7 } else { 3 };
        let rest = &text[head..];
        let rest = rest.trim_start_matches(|c: char| c.is_whitespace());
        let mut r = rest.to_string();
        let trimmed_end = r.trim_end_matches(|c: char| c.is_whitespace());
        if let Some(stripped) = trimmed_end.strip_suffix("```") {
            r = stripped.to_string();
        }
        text = r;
    }
    let parsed: Value = serde_json::from_str(&text).ok()?;
    let obj = parsed.as_object()?;
    let refined = obj.get("refined_fields")?.as_object()?;
    if !refined.values().all(|v| v.is_string()) {
        return None;
    }
    let notes = obj.get("notes").and_then(|n| n.as_str()).unwrap_or("").to_string();
    Some(RefineResponse { refined_fields: refined.clone(), notes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn paths() {
        let mut p = json!({"claims": [{"reasoning": "a"}, {"reasoning": "b"}], "document_summary": "before"});
        assert_eq!(get_by_path(&p, "claims.1.reasoning"), Some(&json!("b")));
        assert_eq!(get_by_path(&p, "claims.5.reasoning"), None);
        assert_eq!(get_by_path(&p, "claims.abc.reasoning"), None);
        assert!(set_by_path(&mut p, "claims.1.reasoning", json!("B")));
        assert_eq!(get_by_path(&p, "claims.1.reasoning"), Some(&json!("B")));
        assert!(!set_by_path(&mut p, "absent.path", json!("x")));
        assert_eq!(expand_path(&p, "claims[].reasoning"), vec!["claims.0.reasoning", "claims.1.reasoning"]);
        let fields = collect_prose_fields(RefineEndpoint::Triage, &p);
        assert_eq!(fields.keys().collect::<Vec<_>>(), vec!["document_summary"]);
    }

    #[test]
    fn fences() {
        let r = parse_claude_json("```json\n{\"refined_fields\": {\"a\": \"b\"}, \"notes\": \"n\"}\n```").unwrap();
        assert_eq!(r.refined_fields["a"], json!("b"));
        assert!(parse_claude_json("{\"refined_fields\": {\"a\": 1}}").is_none());
        assert!(parse_claude_json("not json").is_none());
    }
}
