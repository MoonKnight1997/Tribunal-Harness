//! Analyse response contract — normalisation (F-9). Port of
//! `src/schemas/analyse-contract.ts`. Maps ANY drifted payload into the
//! canonical [`AnalyseResponse`]; never fails; unknown values degrade to the
//! conservative defaults (WEAK / QUARANTINED / tbc).

use crate::jsnum::js_string_of_scalar;
use crate::types::*;
use serde_json::Value;

pub fn is_record(v: &Value) -> bool {
    v.is_object()
}

/// Coerce to string; non-scalars (incl. null) become "".
fn as_string(v: Option<&Value>) -> String {
    v.and_then(js_string_of_scalar).unwrap_or_default()
}

/// Only a literal `true` is true.
fn as_bool(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Bool(true)))
}

fn as_array(v: Option<&Value>) -> Vec<Value> {
    match v {
        Some(Value::Array(a)) => a.clone(),
        _ => vec![],
    }
}

/// First present key (a JSON `null` counts as present, like TS `!== undefined`).
fn pick<'a>(obj: &'a serde_json::Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|k| obj.get(*k))
}

pub fn normalise_strength(v: Option<&Value>) -> ClaimStrength {
    match as_string(v).trim().to_uppercase().as_str() {
        "STRONG" => ClaimStrength::Strong,
        "MODERATE" => ClaimStrength::Moderate,
        _ => ClaimStrength::Weak,
    }
}

pub fn normalise_trust_level(v: Option<&Value>) -> TrustLevel {
    match as_string(v).trim().to_uppercase().as_str() {
        "VERIFIED" => TrustLevel::Verified,
        "CHECK" => TrustLevel::Check,
        _ => TrustLevel::Quarantined,
    }
}

pub fn normalise_flag_status(v: Option<&Value>) -> EraFlagStatus {
    match as_string(v).trim().to_lowercase().as_str() {
        "in_force" => EraFlagStatus::InForce,
        "upcoming" => EraFlagStatus::Upcoming,
        _ => EraFlagStatus::Tbc,
    }
}

fn normalise_element(raw: &Value) -> LegalTestElement {
    let Some(obj) = raw.as_object() else {
        return LegalTestElement { element: as_string(Some(raw)), satisfied: false, evidence: None };
    };
    let satisfied = if obj.contains_key("satisfied") { as_bool(obj.get("satisfied")) } else { as_bool(obj.get("met")) };
    let evidence = pick(obj, &["evidence", "reasoning"]);
    let mut el = LegalTestElement { element: as_string(pick(obj, &["element", "label", "name"])), satisfied, evidence: None };
    if let Some(e) = evidence {
        let s = as_string(Some(e));
        if !s.is_empty() {
            el.evidence = Some(s);
        }
    }
    el
}

fn normalise_claim(raw: &Value) -> ClaimAnalysis {
    let Some(obj) = raw.as_object() else {
        return ClaimAnalysis { claim_type: as_string(Some(raw)), strength: ClaimStrength::Weak, reasoning: String::new(), legal_test_elements: vec![] };
    };
    let elements = pick(obj, &["legal_test_elements", "elements"]);
    ClaimAnalysis {
        claim_type: as_string(pick(obj, &["type", "claim_type"])),
        strength: normalise_strength(obj.get("strength")),
        reasoning: as_string(pick(obj, &["reasoning", "summary"])),
        legal_test_elements: as_array(elements).iter().map(normalise_element).collect(),
    }
}

fn normalise_authority(raw: &Value) -> Authority {
    let Some(obj) = raw.as_object() else {
        return Authority { name: as_string(Some(raw)), trust_level: Some(TrustLevel::Quarantined), ..Default::default() };
    };
    let mut a = Authority {
        name: as_string(pick(obj, &["name", "matched_case"])),
        citation: as_string(obj.get("citation")),
        principle: as_string(pick(obj, &["principle", "relevance"])),
        trust_level: Some(normalise_trust_level(pick(obj, &["trust_level", "trust"]))),
        ..Default::default()
    };
    if obj.contains_key("verified") {
        a.verified = Some(as_bool(obj.get("verified")));
    }
    let s = as_string(obj.get("validation_reason"));
    if !s.is_empty() {
        a.validation_reason = Some(s);
    }
    let s = as_string(obj.get("matched_case"));
    if !s.is_empty() {
        a.matched_case = Some(s);
    }
    let s = as_string(obj.get("matched_citation"));
    if !s.is_empty() {
        a.matched_citation = Some(s);
    }
    let s = as_string(obj.get("source_url"));
    if !s.is_empty() {
        a.source_url = Some(s);
    }
    let s = as_string(obj.get("verification_source"));
    if !s.is_empty() {
        a.verification_source = Some(s);
    }
    if obj.contains_key("citation_corrected") {
        a.citation_corrected = Some(as_bool(obj.get("citation_corrected")));
    }
    let s = as_string(obj.get("original_citation"));
    if !s.is_empty() {
        a.original_citation = Some(s);
    }
    a
}

fn normalise_statutory_provision(raw: &Value) -> StatutoryProvision {
    let Some(obj) = raw.as_object() else {
        return StatutoryProvision { statute: as_string(Some(raw)), section: String::new(), relevance: String::new() };
    };
    StatutoryProvision { statute: as_string(obj.get("statute")), section: as_string(obj.get("section")), relevance: as_string(obj.get("relevance")) }
}

fn normalise_flag(raw: &Value) -> Era2025Flag {
    let Some(obj) = raw.as_object() else {
        return Era2025Flag { provision: as_string(Some(raw)), applies: false, reason: String::new(), commencement_date: String::new(), status: EraFlagStatus::Tbc };
    };
    Era2025Flag {
        provision: as_string(obj.get("provision")),
        applies: as_bool(obj.get("applies")),
        reason: as_string(obj.get("reason")),
        commencement_date: as_string(pick(obj, &["commencement_date", "commencementDate"])),
        status: normalise_flag_status(obj.get("status")),
    }
}

/// Map a model / agent-stand-in payload into the canonical contract.
pub fn normalise_analyse_response(raw: &Value) -> AnalyseResponse {
    let empty = serde_json::Map::new();
    let obj = raw.as_object().unwrap_or(&empty);
    AnalyseResponse {
        claims: as_array(obj.get("claims")).iter().map(normalise_claim).collect(),
        authorities: as_array(obj.get("authorities")).iter().map(normalise_authority).collect(),
        statutory_provisions: as_array(obj.get("statutory_provisions")).iter().map(normalise_statutory_provision).collect(),
        procedural_notes: as_array(obj.get("procedural_notes")).iter().map(|v| as_string(Some(v))).filter(|s| !s.is_empty()).collect(),
        era_2025_flags: as_array(obj.get("era_2025_flags")).iter().map(normalise_flag).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tolerant_of_old_shape_and_conservative_defaults() {
        let out = normalise_analyse_response(&json!({
            "claims": [{"claim_type": "harassment", "strength": "strong", "summary": "Old.", "elements": [{"element": "U", "met": true, "reasoning": "A."}]}],
            "authorities": [{"name": "X", "citation": "[2020] EAT 1", "relevance": "Old.", "trust": "check"}],
            "era_2025_flags": [{"provision": "P", "applies": true, "reason": "r", "commencement_date": "d", "status": "awaiting_si"}]
        }));
        assert_eq!(out.claims[0].claim_type, "harassment");
        assert_eq!(out.claims[0].strength, ClaimStrength::Strong);
        assert_eq!(out.claims[0].legal_test_elements[0].evidence.as_deref(), Some("A."));
        assert_eq!(out.authorities[0].trust_level, Some(TrustLevel::Check));
        assert_eq!(out.era_2025_flags[0].status, EraFlagStatus::Tbc);
        let out = normalise_analyse_response(
            &json!({"claims": [{"type": "x", "strength": "wobbly"}], "authorities": [{"name": "y"}], "era_2025_flags": [{"provision": "q"}], "procedural_notes": ["keep", "", null, "also"]}),
        );
        assert_eq!(out.claims[0].strength, ClaimStrength::Weak);
        assert_eq!(out.authorities[0].trust_level, Some(TrustLevel::Quarantined));
        assert_eq!(out.procedural_notes, vec!["keep", "also"]);
        assert!(normalise_analyse_response(&Value::Null).claims.is_empty());
    }
}
