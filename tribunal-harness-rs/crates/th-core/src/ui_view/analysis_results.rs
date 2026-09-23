//! F-9 / F-7 / F-37: the view model the analysis results panel renders.

use crate::analyse_contract::normalise_analyse_response;
use crate::types::{Authority, ClaimAnalysis, Era2025Flag, EraFlagStatus, TrustLevel};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResultsView {
    pub claims: Vec<ClaimAnalysis>,
    pub displayed_authorities: Vec<Authority>,
    pub era_flags: Vec<Era2025Flag>,
    pub stripped_quarantine_count: usize,
}

/// Parse (not cast) into the canonical shape, drop QUARANTINED authorities,
/// and surface only an aggregate count (server count preferred).
pub fn build_analysis_results_view(results: &Value) -> AnalysisResultsView {
    let normalised = normalise_analyse_response(results);
    let displayed: Vec<Authority> = normalised.authorities.iter().filter(|a| a.trust_level != Some(TrustLevel::Quarantined)).cloned().collect();
    let stripped_in_list = normalised.authorities.len() - displayed.len();
    let summary_quarantined = results.get("quarantine_summary").and_then(|s| s.get("quarantined")).and_then(Value::as_f64).map(|f| f.max(0.0) as usize).unwrap_or(0);
    AnalysisResultsView {
        claims: normalised.claims,
        displayed_authorities: displayed,
        era_flags: normalised.era_2025_flags,
        stripped_quarantine_count: stripped_in_list.max(summary_quarantined),
    }
}

/// F-37 / Hard Rule 6: keep the three ERA-flag states distinct.
pub fn flag_status_label(status: EraFlagStatus) -> &'static str {
    match status {
        EraFlagStatus::InForce => "IN FORCE",
        EraFlagStatus::Upcoming => "UPCOMING",
        EraFlagStatus::Tbc => "DATE TBC",
    }
}
