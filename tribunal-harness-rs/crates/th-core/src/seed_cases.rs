//! Case law search seed data — port of `src/app/api/case-law/search/route.ts`
//! (20 seed entries, scoring and filtering). Values verbatim; the curated
//! entries flagged in DECISIONS.md are ported as-is.

use crate::constants::{format_commencement_date, ERA_2025};
use crate::jsnum::js_parse_int;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::LazyLock;

#[derive(Debug, Clone, Serialize)]
pub struct CaseLawEntry {
    pub id: &'static str,
    pub citation: &'static str,
    pub neutral_citation: &'static str,
    pub case_name: &'static str,
    pub court: &'static str,
    pub year: i32,
    pub tier: &'static str,
    pub summary: String,
    pub claim_types: Vec<&'static str>,
    pub trust_badge: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<&'static str>,
}

#[allow(clippy::too_many_arguments)]
fn e(
    id: &'static str,
    citation: &'static str,
    neutral_citation: &'static str,
    case_name: &'static str,
    court: &'static str,
    year: i32,
    tier: &'static str,
    summary: impl Into<String>,
    claim_types: &[&'static str],
    trust_badge: &'static str,
    url: Option<&'static str>,
) -> CaseLawEntry {
    CaseLawEntry { id, citation, neutral_citation, case_name, court, year, tier, summary: summary.into(), claim_types: claim_types.to_vec(), trust_badge, url }
}

pub static SEED_CASES: LazyLock<Vec<CaseLawEntry>> = LazyLock::new(|| {
    vec![
        e("polkey-v-dayton", "[1988] AC 344", "Polkey v AE Dayton Services Ltd", "Polkey v AE Dayton Services Ltd", "House of Lords", 1988, "binding",
            "Established that procedural failures in dismissal are not automatically irrelevant. The tribunal must consider whether a fair procedure would have made any difference. Gives rise to 'Polkey reduction' of compensation.",
            &["unfair_dismissal"], "VERIFIED", Some("https://www.bailii.org/uk/cases/UKHL/1987/8.html")),
        e("iceland-v-jones", "[1983] ICR 17", "Iceland Frozen Foods Ltd v Jones", "Iceland Frozen Foods Ltd v Jones", "EAT", 1982, "persuasive",
            "Established the 'band of reasonable responses' test for unfair dismissal. The tribunal must not substitute its own view for that of the employer, but ask whether the employer's decision fell within the range of responses a reasonable employer could have taken.",
            &["unfair_dismissal"], "VERIFIED", None),
        e("bca-v-obrien", "[2013] EWCA Civ 1482", "British Columbia v O'Brien", "British Columbia v O'Brien", "Court of Appeal", 2013, "binding",
            "Key authority on constructive dismissal. Employer's conduct must amount to a repudiatory breach of contract. The employee must resign in response to that breach, not for other reasons.",
            &["constructive_dismissal", "unfair_dismissal"], "VERIFIED", None),
        e("igen-v-wong", "[2005] EWCA Civ 142", "Igen Ltd v Wong", "Igen Ltd v Wong", "Court of Appeal", 2005, "binding",
            "Established the two-stage burden of proof in discrimination claims. At stage 1, the claimant must establish facts from which the tribunal could conclude discrimination. At stage 2, the burden shifts to the respondent to prove non-discriminatory reasons.",
            &["direct_discrimination", "harassment"], "VERIFIED", None),
        e("chagger-v-abbey", "[2010] EWCA Civ 1", "Chagger v Abbey National plc", "Chagger v Abbey National plc", "Court of Appeal", 2010, "binding",
            "Stigma damages in discrimination cases. An employer may be liable for the difficulty a claimant faces in finding new employment as a result of the discrimination, even where the claimant has mitigated their loss.",
            &["direct_discrimination"], "VERIFIED", None),
        e("morrisons-v-various", "[2020] UKSC 12", "Various Claimants v Wm Morrison Supermarkets plc", "Various Claimants v Wm Morrison Supermarkets plc", "Supreme Court", 2020, "binding",
            "Vicarious liability for employee data breaches. An employer is not vicariously liable for a rogue employee's deliberate data breach where the employee's motive was personal and not connected to the employer's business.",
            &["whistleblowing"], "VERIFIED", None),
        e("jhuti-v-royal-mail", "[2019] UKSC 55", "Royal Mail Group Ltd v Jhuti", "Royal Mail Group Ltd v Jhuti", "Supreme Court", 2019, "binding",
            "Whistleblowing dismissal. Where a manager conceals the true (whistleblowing) reason for dismissal from the decision-maker, the tribunal can look behind the decision-maker's stated reason to find the real reason was the protected disclosure.",
            &["whistleblowing"], "VERIFIED", None),
        e("capita-v-mclean", "[2023] EAT 2", "Capita Hartshead Ltd v McLean", "Capita Hartshead Ltd v McLean", "EAT", 2023, "persuasive",
            "Constructive dismissal and the 'last straw' doctrine. A relatively minor act can be the last straw that entitles an employee to resign, provided it is not entirely innocuous and is part of a course of conduct.",
            &["constructive_dismissal"], "VERIFIED", None),
        e("era-1996-s98", "ERA 1996 s.98", "Employment Rights Act 1996, section 98", "Employment Rights Act 1996 — Unfair Dismissal", "Statute", 1996, "statutory",
            "The statutory test for unfair dismissal. The employer must show a potentially fair reason (capability, conduct, redundancy, statutory bar, or some other substantial reason). The tribunal then determines whether the dismissal was fair in all the circumstances.",
            &["unfair_dismissal", "constructive_dismissal"], "VERIFIED", None),
        e("ea-2010-s26", "EA 2010 s.26", "Equality Act 2010, section 26", "Equality Act 2010 — Harassment", "Statute", 2010, "statutory",
            "Statutory definition of harassment. Unwanted conduct related to a protected characteristic that has the purpose or effect of violating dignity or creating an intimidating, hostile, degrading, humiliating or offensive environment.",
            &["harassment", "direct_discrimination"], "VERIFIED", None),
        e("era-1996-s43b", "ERA 1996 s.43B", "Employment Rights Act 1996, section 43B", "Employment Rights Act 1996 — Protected Disclosures", "Statute", 1996, "statutory",
            "Definition of a qualifying disclosure for whistleblowing protection. The disclosure must be of information which the worker reasonably believes tends to show one of six categories of wrongdoing (criminal offence, breach of legal obligation, miscarriage of justice, danger to health/safety, environmental damage, or concealment).",
            &["whistleblowing"], "VERIFIED", None),
        e("era-2025-s1", "ERA 2025 s.1", "Employment Rights Act 2025, section 1", "Employment Rights Act 2025 — Unfair Dismissal Qualifying Period", "Statute", 2025, "statutory",
            format!("Reduces the qualifying period for unfair dismissal from 2 years to 6 months. Commencement: {} (subject to Statutory Instrument). Employees dismissed on or after this date with 6 months' service will have the right not to be unfairly dismissed.", format_commencement_date(ERA_2025.qualifying_period_6_months)),
            &["unfair_dismissal"], "VERIFIED", None),
        e("era-2025-fire-rehire", "ERA 2025 s.23", "Employment Rights Act 2025, section 23", "Employment Rights Act 2025 — Fire and Rehire", "Statute", 2025, "statutory",
            format!("Dismissal for the purpose of rehiring on inferior terms is automatically unfair. No qualifying period required. Commencement: {} (subject to Statutory Instrument). Applies where the employer's reason or principal reason for dismissal is to offer re-engagement on different terms.", format_commencement_date(ERA_2025.fire_and_rehire_auto_unfair)),
            &["fire_and_rehire", "unfair_dismissal"], "VERIFIED", None),
        e("williams-v-compair", "[1982] ICR 156", "Williams v Compair Maxam Ltd", "Williams v Compair Maxam Ltd", "EAT", 1982, "persuasive",
            "Established the principles of fair redundancy selection. The employer should give as much warning as possible, consult with the union or employees, use objective selection criteria, consider alternative employment, and follow a fair procedure.",
            &["redundancy"], "VERIFIED", None),
        e("autoclenz-v-belcher", "[2011] UKSC 41", "Autoclenz Ltd v Belcher", "Autoclenz Ltd v Belcher", "Supreme Court", 2011, "binding",
            "Employment status and sham contracts. Courts will look at the true nature of the relationship, not just the written contract. A clause purporting to deny employment status will be disregarded if it does not reflect the true agreement.",
            &["unfair_dismissal"], "VERIFIED", None),
        e("uber-v-aslam", "[2021] UKSC 5", "Uber BV v Aslam", "Uber BV v Aslam", "Supreme Court", 2021, "binding",
            "Gig economy employment status. Uber drivers are workers, not independent contractors. The Supreme Court applied a purposive approach to employment status, looking at the reality of the relationship and the subordination of the drivers to Uber's control.",
            &["unfair_dismissal", "whistleblowing"], "VERIFIED", None),
        e("forstater-v-cgd", "[2022] EAT 0105", "Forstater v CGD Europe", "Forstater v CGD Europe", "EAT", 2022, "persuasive",
            "Gender-critical beliefs are a protected philosophical belief under the Equality Act 2010. The EAT held that the employment tribunal had erred in finding that the claimant's belief did not qualify for protection.",
            &["direct_discrimination"], "VERIFIED", None),
        e("western-excavating-v-sharp", "[1978] ICR 221", "Western Excavating (ECC) Ltd v Sharp", "Western Excavating (ECC) Ltd v Sharp", "Court of Appeal", 1978, "binding",
            "Foundational authority on constructive dismissal. The employer's conduct must amount to a significant breach going to the root of the contract, or show an intention not to be bound by an essential term. The employee must resign in response to the breach and not delay.",
            &["constructive_dismissal"], "VERIFIED", None),
        e("ea-2010-s15", "EA 2010 s.15", "Equality Act 2010, section 15", "Equality Act 2010 — Discrimination Arising from Disability", "Statute", 2010, "statutory",
            "Discrimination arising from disability. An employer discriminates if they treat a disabled person unfavourably because of something arising in consequence of their disability, and cannot show the treatment is a proportionate means of achieving a legitimate aim.",
            &["direct_discrimination"], "VERIFIED", None),
        e("era-1996-s207b", "ERA 1996 s.207B", "Employment Rights Act 1996, section 207B", "Employment Rights Act 1996 — ACAS Early Conciliation", "Statute", 1996, "statutory",
            "ACAS early conciliation clock-stopping. The limitation period is extended by the period of ACAS early conciliation (Day A to Day B). The claimant gets whichever is longer: the extended deadline or 1 calendar month from Day B.",
            &["unfair_dismissal", "direct_discrimination", "harassment", "whistleblowing", "redundancy"], "VERIFIED", None),
        e("zero-hours-era-2025", "ERA 2025 s.12", "Employment Rights Act 2025, section 12", "Employment Rights Act 2025 — Zero-Hours Contracts", "Statute", 2025, "statutory",
            "Right to a guaranteed hours contract for zero-hours workers. Employers must offer a contract reflecting the hours regularly worked. Commencement: 2027 (exact date awaiting Statutory Instrument). Workers cannot be required to work exclusively for one employer.",
            &["zero_hours_rights"], "CHECK", None),
    ]
});

fn score_case(entry: &CaseLawEntry, query: &str, claim_type: Option<&str>) -> i64 {
    let q = query.to_lowercase();
    let mut score = 0;
    if entry.case_name.to_lowercase().contains(&q) {
        score += 10;
    }
    if entry.summary.to_lowercase().contains(&q) {
        score += 5;
    }
    if entry.citation.to_lowercase().contains(&q) {
        score += 8;
    }
    if let Some(ct) = claim_type {
        if entry.claim_types.contains(&ct) {
            score += 6;
        }
    }
    if entry.tier == "binding" {
        score += 2;
    }
    if entry.tier == "statutory" {
        score += 1;
    }
    if entry.year >= 2020 {
        score += 1;
    }
    score
}

/// Outcome of `GET /api/case-law/search`.
pub enum SearchOutcome {
    BadRequest(Value),
    Ok(Value),
}

/// `q`, `claim_type`, `tier`, `limit` as raw query values (None = absent).
pub fn search(q: Option<&str>, claim_type: Option<&str>, tier: Option<&str>, limit: Option<&str>) -> SearchOutcome {
    let query = q.map(str::trim).unwrap_or("");
    let parsed_limit = js_parse_int(limit.unwrap_or("10"));
    let limit = match parsed_limit {
        None => 10,
        Some(n) => n.clamp(1, 20) as usize,
    };
    // JS truthiness: an empty `claim_type` / `tier` behaves as "not supplied"
    // in every check below, but `claim_type` is echoed back verbatim.
    let ct_filter = claim_type.filter(|c| !c.is_empty());
    let tier_filter = tier.filter(|t| !t.is_empty());
    if query.is_empty() && ct_filter.is_none() {
        return SearchOutcome::BadRequest(json!({ "error": "Provide at least one of: q (search query) or claim_type" }));
    }
    let mut results: Vec<&CaseLawEntry> = SEED_CASES.iter().collect();
    if let Some(t) = tier_filter {
        results.retain(|c| c.tier == t);
    }
    if let Some(ct) = ct_filter {
        results.retain(|c| c.claim_types.contains(&ct));
    }
    let results: Vec<&CaseLawEntry> = if !query.is_empty() {
        let mut scored: Vec<(i64, &CaseLawEntry)> = results.into_iter().map(|c| (score_case(c, query, ct_filter), c)).filter(|(s, _)| *s > 0).collect();
        // Stable sort descending by score (JS sort is stable).
        scored.sort_by(|a, b| b.0.cmp(&a.0));
        scored.into_iter().take(limit).map(|(_, c)| c).collect()
    } else {
        results.into_iter().take(limit).collect()
    };
    SearchOutcome::Ok(json!({
        "query": query,
        "claim_type": claim_type,
        "total": results.len(),
        "data_source": "seed_v1",
        "note": "Phase 2 seed data. Vector DB integration planned for Phase 3.",
        "results": results,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn searches() {
        assert!(matches!(search(None, None, None, None), SearchOutcome::BadRequest(_)));
        let SearchOutcome::Ok(v) = search(Some("Polkey"), None, None, None) else { panic!() };
        assert!(v["results"][0]["case_name"].as_str().unwrap().contains("Polkey"));
        let SearchOutcome::Ok(v) = search(None, Some("unfair_dismissal"), None, Some("999")) else { panic!() };
        assert!(v["results"].as_array().unwrap().len() <= 20);
        let SearchOutcome::Ok(v) = search(None, Some("unfair_dismissal"), None, Some("abc")) else { panic!() };
        assert!(v["results"].as_array().unwrap().len() <= 10);
    }
}
