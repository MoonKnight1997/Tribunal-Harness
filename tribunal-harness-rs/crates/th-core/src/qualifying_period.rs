//! Qualifying Period Calculator — UK Unfair Dismissal (ERA 1996 s108).
//! Port of `src/services/qualifying-period.ts`.
//!
//! Regime is selected by the effective date of termination (EDT):
//! - EDT before the `QUALIFYING_PERIOD_6_MONTHS` commencement: 2 years
//! - EDT on or after commencement: 6 months
//!
//! Automatically-unfair dismissals need NO qualifying period; the result
//! always surfaces `auto_unfair_may_apply = true` as a caveat.

use crate::constants::QUALIFYING_PERIOD_CONFIG;
use crate::dates::CivilDate;
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum QualifyingPeriodError {
    #[error("qualifyingPeriod: employmentStart and edt must be valid ISO dates (YYYY-MM-DD)")]
    InvalidDates,
    #[error("qualifyingPeriod: edt must not be before employmentStart")]
    EdtBeforeStart,
    #[error("qualifyingPeriod: QUALIFYING_PERIOD_6_MONTHS commencement date is invalid")]
    InvalidCommencement,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct QualifyingPeriodResult {
    #[serde(rename = "hasQualifyingService")]
    pub has_qualifying_service: bool,
    #[serde(rename = "requiredMonths")]
    pub required_months: u32,
    #[serde(rename = "actualMonths")]
    pub actual_months: i64,
    pub regime: &'static str,
    #[serde(rename = "autoUnfairMayApply")]
    pub auto_unfair_may_apply: bool,
    pub note: String,
}

/// `parseUTCStrict` — trims, requires the ISO shape, rejects overflow.
fn parse_utc_strict(iso: &str) -> Option<CivilDate> {
    CivilDate::parse_utc(iso.trim())
}

/// Complete calendar months of continuous service (partial months round DOWN).
fn complete_months_between(start: &CivilDate, end: &CivilDate) -> i64 {
    let mut months = (end.year as i64 - start.year as i64) * 12 + (end.month as i64 - start.month as i64);
    if end.day < start.day {
        months -= 1;
    }
    months
}

pub fn qualifying_period(employment_start: &str, edt: &str) -> Result<QualifyingPeriodResult, QualifyingPeriodError> {
    let start = parse_utc_strict(employment_start);
    let edt_date = parse_utc_strict(edt);
    let (start, edt_date) = match (start, edt_date) {
        (Some(s), Some(e)) => (s, e),
        _ => return Err(QualifyingPeriodError::InvalidDates),
    };
    if edt_date < start {
        return Err(QualifyingPeriodError::EdtBeforeStart);
    }
    let commencement = parse_utc_strict(QUALIFYING_PERIOD_CONFIG.commencement_date).ok_or(QualifyingPeriodError::InvalidCommencement)?;

    let is_post = edt_date >= commencement;
    let required_months = if is_post { QUALIFYING_PERIOD_CONFIG.post_era_2025_months } else { QUALIFYING_PERIOD_CONFIG.pre_era_2025_years * 12 };
    let actual_months = complete_months_between(&start, &edt_date);
    let has_qualifying_service = actual_months >= required_months as i64;

    let regime_note = if is_post {
        format!(
            "On or after the ERA 2025 commencement ({}), the qualifying period for ordinary unfair dismissal is 6 months' continuous service.",
            QUALIFYING_PERIOD_CONFIG.commencement_date
        )
    } else {
        format!(
            "Before the ERA 2025 commencement ({}), the qualifying period for ordinary unfair dismissal is 2 years' continuous service.",
            QUALIFYING_PERIOD_CONFIG.commencement_date
        )
    };
    let note = format!(
        "{regime_note} On these dates you have {actual_months} complete month(s) of service against a {required_months}-month requirement, so you {verdict} the qualifying period for an ORDINARY unfair dismissal claim. CAVEAT: automatically-unfair dismissals (e.g. whistleblowing, pregnancy/maternity, trade union, health & safety, assertion of a statutory right, TUPE) require NO qualifying period at all. If your dismissal may fall into one of those categories, the qualifying period above does not apply. This is legal information, not legal advice.",
        verdict = if has_qualifying_service { "appear to meet" } else { "do NOT appear to meet" }
    );

    Ok(QualifyingPeriodResult { has_qualifying_service, required_months, actual_months, regime: if is_post { "post" } else { "pre" }, auto_unfair_may_apply: true, note })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regime_and_threshold() {
        let r = qualifying_period("2020-01-01", "2026-12-31").unwrap();
        assert_eq!((r.regime, r.required_months), ("pre", 24));
        let r = qualifying_period("2020-01-01", "2027-01-01").unwrap();
        assert_eq!((r.regime, r.required_months), ("post", 6));
        let r = qualifying_period("2024-06-15", "2026-06-15").unwrap();
        assert_eq!((r.actual_months, r.has_qualifying_service), (24, true));
        let r = qualifying_period("2024-06-15", "2026-06-14").unwrap();
        assert_eq!((r.actual_months, r.has_qualifying_service), (23, false));
        let r = qualifying_period("2027-01-01", "2027-07-01").unwrap();
        assert_eq!((r.actual_months, r.has_qualifying_service), (6, true));
        let r = qualifying_period("2027-01-01", "2027-06-30").unwrap();
        assert_eq!((r.actual_months, r.has_qualifying_service), (5, false));
        assert!(!qualifying_period("2026-04-30", "2026-12-31").unwrap().has_qualifying_service);
        assert!(qualifying_period("2026-12-31", "2027-08-31").unwrap().has_qualifying_service);
        let r = qualifying_period("2027-01-01", "2027-01-02").unwrap();
        assert!(r.auto_unfair_may_apply && !r.has_qualifying_service && r.note.contains("automatically-unfair"));
    }

    #[test]
    fn rejects_bad_input() {
        assert!(qualifying_period("not-a-date", "2027-01-01").is_err());
        assert!(qualifying_period("2026-02-30", "2027-01-01").is_err());
        assert!(qualifying_period("01/01/2020", "2027-01-01").is_err());
        assert!(qualifying_period("2027-01-01", "2020-01-01").is_err());
        assert!(qualifying_period("", "2027-01-01").is_err());
    }
}
