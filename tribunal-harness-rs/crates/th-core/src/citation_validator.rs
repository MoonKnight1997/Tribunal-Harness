//! Citation Validator — Phase 2a Epistemic Quarantine (offline part). Port of
//! `src/services/citation-validator.ts`.
//!
//! Trust levels:
//! - VERIFIED: case name matches a verified authority AND the neutral citation
//!   supplied in the input exactly matches that authority's neutral citation.
//! - CHECK: case name matches, but the citation is absent, differs, or cannot
//!   be extracted.
//! - QUARANTINED: no match found.
//!
//! The live double-check against Find Case Law (`validateCitationAuthoritative`)
//! lives in `th-services::citation_authority`; the merge logic it needs
//! (`higher_trust`, the `AuthoritativeValidation` shape) is here.

use crate::find_case_law::normalise_citation;
use crate::types::TrustLevel;
use crate::verified_authorities::{find_authority_by_partial_match, find_authority_by_short_name, VerifiedAuthority};
use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;

/// `/\[\s*\d{4}\s*\]\s*[A-Za-z][A-Za-z./ ]*?\s*[\d_]+/` — handles "[2025] UKSC 99",
/// "[2007] EWCA Civ 33", "[1988] ICR 142" and EAT references with underscores.
static NEUTRAL_CITE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[\s*\d{4}\s*\]\s*[A-Za-z][A-Za-z./ ]*?\s*[\d_]+").unwrap());
static WS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

/// Pull a neutral-citation token out of a free-text citation string, with
/// internal whitespace collapsed to single spaces.
pub fn extract_neutral_citation(input: &str) -> Option<String> {
    NEUTRAL_CITE_RE.find(input).map(|m| WS_RE.replace_all(m.as_str(), " ").trim().to_string())
}

fn citations_equal(a: &str, b: &str) -> bool {
    normalise_citation(a) == normalise_citation(b)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationValidationResult {
    pub original_citation: String,
    pub trust_level: TrustLevel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_authority: Option<&'static VerifiedAuthority>,
    pub reason: String,
}

/// Resolve a name match to a trust level — the single choke point: a name
/// match can never award VERIFIED on its own.
fn resolve_name_match(trimmed: &str, authority: &'static VerifiedAuthority) -> CitationValidationResult {
    let input_citation = extract_neutral_citation(trimmed);
    if let Some(ic) = &input_citation {
        if citations_equal(ic, authority.neutral_citation) {
            return CitationValidationResult {
                original_citation: trimmed.to_string(),
                trust_level: TrustLevel::Verified,
                matched_authority: Some(authority),
                reason: format!("Exact match: {} {}", authority.full_name, authority.neutral_citation),
            };
        }
    }
    CitationValidationResult {
        original_citation: trimmed.to_string(),
        trust_level: TrustLevel::Check,
        matched_authority: Some(authority),
        reason: match input_citation {
            Some(ic) => format!(
                "Case name matches {}, but the cited neutral citation ({}) does not match the verified citation {}. Manual check recommended.",
                authority.full_name, ic, authority.neutral_citation
            ),
            None => format!(
                "Case name matches {}, but no neutral citation was supplied to verify against {}. Manual check recommended.",
                authority.full_name, authority.neutral_citation
            ),
        },
    }
}

/// Validate a single citation string against the verified authorities database.
pub fn validate_citation(citation: &str) -> CitationValidationResult {
    if citation.trim().is_empty() {
        return CitationValidationResult {
            original_citation: citation.to_string(),
            trust_level: TrustLevel::Quarantined,
            matched_authority: None,
            reason: "Empty citation string".to_string(),
        };
    }
    let trimmed = citation.trim();

    // Strategy 1: first word as a short name, then 4/3/2-word prefixes.
    let words: Vec<&str> = WS_RE.split(trimmed).collect();
    let first_word = words.first().copied().unwrap_or("");
    if let Some(a) = find_authority_by_short_name(first_word) {
        return resolve_name_match(trimmed, a);
    }
    for n in [4usize, 3, 2] {
        let pattern = words.iter().take(n).copied().collect::<Vec<_>>().join(" ");
        if let Some(a) = find_authority_by_short_name(&pattern) {
            return resolve_name_match(trimmed, a);
        }
    }

    // Strategy 2: partial match against the full citation text.
    if let Some(a) = find_authority_by_partial_match(trimmed) {
        return resolve_name_match(trimmed, a);
    }

    // Strategy 3: no match.
    CitationValidationResult {
        original_citation: trimmed.to_string(),
        trust_level: TrustLevel::Quarantined,
        matched_authority: None,
        reason: "Citation not found in verified authorities database. May be valid but cannot be independently verified.".to_string(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationSummary {
    pub total: usize,
    pub verified: usize,
    pub check: usize,
    pub quarantined: usize,
    pub verified_percentage: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BatchValidation {
    pub results: Vec<CitationValidationResult>,
    pub summary: ValidationSummary,
}

/// `Math.round((verified / total) * 100)` — JS rounds half toward +∞.
pub fn js_round_percentage(verified: usize, total: usize) -> i64 {
    if total == 0 {
        return 0;
    }
    ((verified as f64 / total as f64) * 100.0 + 0.5).floor() as i64
}

pub fn validate_all_citations(citations: &[String]) -> BatchValidation {
    let results: Vec<CitationValidationResult> = citations.iter().map(|c| validate_citation(c)).collect();
    let verified = results.iter().filter(|r| r.trust_level == TrustLevel::Verified).count();
    let check = results.iter().filter(|r| r.trust_level == TrustLevel::Check).count();
    let quarantined = results.iter().filter(|r| r.trust_level == TrustLevel::Quarantined).count();
    let total = results.len();
    BatchValidation { results, summary: ValidationSummary { total, verified, check, quarantined, verified_percentage: js_round_percentage(verified, total) } }
}

// ---------------------------------------------------------------------------
// Authoritative validation types (curated + live). The async driver is in
// th-services; the decision merge is pure and lives here.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum CitationSource {
    #[serde(rename = "verified_db")]
    VerifiedDb,
    #[serde(rename = "find_case_law")]
    FindCaseLaw,
    #[serde(rename = "verified_db+find_case_law")]
    Both,
    #[serde(rename = "unavailable")]
    Unavailable,
}

impl CitationSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            CitationSource::VerifiedDb => "verified_db",
            CitationSource::FindCaseLaw => "find_case_law",
            CitationSource::Both => "verified_db+find_case_law",
            CitationSource::Unavailable => "unavailable",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoritativeValidation {
    pub original_citation: String,
    pub trust_level: TrustLevel,
    pub reason: String,
    pub source: CitationSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_citation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

pub fn higher_trust(a: TrustLevel, b: TrustLevel) -> TrustLevel {
    if a >= b {
        a
    } else {
        b
    }
}

/// The curated verdict when it is VERIFIED — authoritative on its own.
pub fn curated_verified(citation: &str, stat: &CitationValidationResult) -> Option<AuthoritativeValidation> {
    if stat.trust_level != TrustLevel::Verified {
        return None;
    }
    Some(AuthoritativeValidation {
        original_citation: citation.to_string(),
        trust_level: TrustLevel::Verified,
        reason: stat.reason.clone(),
        source: CitationSource::VerifiedDb,
        matched_name: stat.matched_authority.map(|a| a.short_name.to_string()),
        matched_citation: stat.matched_authority.map(|a| a.neutral_citation.to_string()),
        url: None,
    })
}

/// Fall back to the curated verdict when the upstream is unreachable.
pub fn curated_fallback(citation: &str, stat: &CitationValidationResult) -> AuthoritativeValidation {
    AuthoritativeValidation {
        original_citation: citation.to_string(),
        trust_level: stat.trust_level,
        reason: format!("{} (Live Find Case Law check unavailable; based on curated database only.)", stat.reason),
        source: CitationSource::Unavailable,
        matched_name: stat.matched_authority.map(|a| a.short_name.to_string()),
        matched_citation: stat.matched_authority.map(|a| a.neutral_citation.to_string()),
        url: None,
    }
}

/// Merge the curated and live verdicts (live is not `unavailable` here).
pub fn merge_with_live(citation: &str, stat: &CitationValidationResult, live: &crate::find_case_law::VerifyResult) -> AuthoritativeValidation {
    if live.trust_level == TrustLevel::Verified {
        return AuthoritativeValidation {
            original_citation: citation.to_string(),
            trust_level: TrustLevel::Verified,
            reason: live.reason.clone(),
            source: CitationSource::FindCaseLaw,
            matched_name: live.matched_title.clone().or_else(|| stat.matched_authority.map(|a| a.short_name.to_string())),
            matched_citation: live.matched_citation.clone(),
            url: live.url.clone(),
        };
    }
    let trust_level = higher_trust(stat.trust_level, live.trust_level);
    let reason = if live.trust_level == TrustLevel::Check {
        live.reason.clone()
    } else if stat.trust_level == TrustLevel::Check {
        stat.reason.clone()
    } else {
        live.reason.clone()
    };
    AuthoritativeValidation {
        original_citation: citation.to_string(),
        trust_level,
        reason,
        source: CitationSource::Both,
        matched_name: live.matched_title.clone().or_else(|| stat.matched_authority.map(|a| a.short_name.to_string())),
        matched_citation: live.matched_citation.clone().or_else(|| stat.matched_authority.map(|a| a.neutral_citation.to_string())),
        url: live.url.clone(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoritativeSummary {
    pub total: usize,
    pub verified: usize,
    pub check: usize,
    pub quarantined: usize,
    pub verified_percentage: i64,
    pub live_checks: usize,
}

pub fn summarise_authoritative(results: &[AuthoritativeValidation]) -> AuthoritativeSummary {
    let verified = results.iter().filter(|r| r.trust_level == TrustLevel::Verified).count();
    let check = results.iter().filter(|r| r.trust_level == TrustLevel::Check).count();
    let quarantined = results.iter().filter(|r| r.trust_level == TrustLevel::Quarantined).count();
    let live_checks = results.iter().filter(|r| r.source != CitationSource::VerifiedDb).count();
    let total = results.len();
    AuthoritativeSummary { total, verified, check, quarantined, verified_percentage: js_round_percentage(verified, total), live_checks }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verified_only_on_exact_citation() {
        assert_eq!(validate_citation("Polkey v AE Dayton Services Ltd [1987] UKHL 8").trust_level, TrustLevel::Verified);
        assert_eq!(validate_citation("Shamoon v Chief Constable [2003] UKHL 11").trust_level, TrustLevel::Verified);
        assert_eq!(validate_citation("BHS v Burchell [1978] UKEAT 0108_78_2007").trust_level, TrustLevel::Verified);
        assert_eq!(validate_citation("Iceland Frozen Foods Ltd v Jones [1982] UKEAT 0062_82_2207").trust_level, TrustLevel::Verified);
        let r = validate_citation("BHS v Burchell [1978]");
        assert_eq!(r.trust_level, TrustLevel::Check);
        assert_eq!(r.matched_authority.unwrap().short_name, "BHS v Burchell");
        assert_eq!(validate_citation("Essop v Home Office [2017] UKSC 27").trust_level, TrustLevel::Verified);
        assert_eq!(validate_citation("Polkey v AE Dayton Services Ltd [1988] AC 344").trust_level, TrustLevel::Check);
        assert_eq!(validate_citation("Polkey v AE Dayton Services Ltd [2025] UKSC 99").trust_level, TrustLevel::Check);
        let r = validate_citation("Nonexistent Authority v Someone [1987] UKHL 8");
        assert_eq!(r.trust_level, TrustLevel::Quarantined);
        assert!(r.matched_authority.is_none());
        let r = validate_citation("Chief Constable of West Yorkshire Police v Vento (No 2) [2002]");
        assert_eq!(r.trust_level, TrustLevel::Check);
        assert_eq!(r.matched_authority.unwrap().short_name, "Vento");
        let r = validate_citation("Smith v Acme Corp [2025] EAT 999");
        assert_eq!(r.trust_level, TrustLevel::Quarantined);
        assert!(r.reason.contains("not found"));
        assert!(validate_citation("").reason.contains("Empty"));
        assert_eq!(validate_citation("polkey v AE Dayton Services Ltd [1987] UKHL 8").trust_level, TrustLevel::Verified);
        let r = validate_citation("Tesco Stores Ltd v Union of Shop, Distributive and Allied Workers [2024] UKSC 28");
        assert_eq!(r.trust_level, TrustLevel::Verified);
        assert!(r.matched_authority.unwrap().claim_types.contains(&"fire_and_rehire"));
    }

    #[test]
    fn batch_summary() {
        let b = validate_all_citations(&[
            "Polkey v AE Dayton Services Ltd [1987] UKHL 8".into(),
            "Shamoon v Chief Constable [2003] UKHL 11".into(),
            "Made Up Case v Nobody [2025] EAT 000".into(),
        ]);
        assert_eq!((b.summary.total, b.summary.verified, b.summary.quarantined, b.summary.verified_percentage), (3, 2, 1, 67));
        assert_eq!(validate_all_citations(&[]).summary.verified_percentage, 0);
    }

    #[test]
    fn extraction() {
        assert_eq!(extract_neutral_citation("BHS v Burchell [1978] UKEAT 0108_78_2007").as_deref(), Some("[1978] UKEAT 0108_78_2007"));
        assert_eq!(extract_neutral_citation("Polkey  v   AE Dayton  [ 1987 ]  UKHL  8").as_deref(), Some("[ 1987 ] UKHL 8"));
        assert_eq!(extract_neutral_citation("no cite"), None);
    }
}
