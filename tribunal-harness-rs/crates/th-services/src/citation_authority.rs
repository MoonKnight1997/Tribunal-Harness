//! Authoritative citation validation — curated list first, then a live
//! double-check against Find Case Law. Port of the async half of
//! `src/services/citation-validator.ts`. Never fails; the upstream being
//! unreachable degrades to the curated verdict, never to a false VERIFIED.

use crate::tna::TnaClient;
use th_core::citation_validator::*;
use th_core::find_case_law::VerifySource;

pub async fn validate_citation_authoritative(tna: &TnaClient, citation: &str, name: Option<&str>) -> AuthoritativeValidation {
    let stat = validate_citation(citation);
    if let Some(v) = curated_verified(citation, &stat) {
        return v;
    }
    let live = tna.verify_citation(Some(citation), name).await;
    if live.source == VerifySource::Unavailable {
        return curated_fallback(citation, &stat);
    }
    merge_with_live(citation, &stat, &live)
}

/// Runs the per-authority checks concurrently (order preserved).
pub async fn validate_all_citations_authoritative(tna: &TnaClient, authorities: &[(String, Option<String>)]) -> (Vec<AuthoritativeValidation>, AuthoritativeSummary) {
    let futures = authorities.iter().map(|(c, n)| validate_citation_authoritative(tna, c, n.as_deref()));
    let results = futures_util::future::join_all(futures).await;
    let summary = summarise_authoritative(&results);
    (results, summary)
}
