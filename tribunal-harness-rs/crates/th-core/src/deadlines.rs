//! Deadline Calculator — UK Employment Tribunal. Port of
//! `src/services/deadline-calculator.ts`, semantics preserved exactly:
//!
//! - Before commencement: 3 months less 1 day from the act complained of;
//!   on/after: 6 months less 1 day (ERA 2025).
//! - F-3: while the SI is unconfirmed, acts on/after the assumed commencement
//!   return BOTH regimes — conservative 3-month PRIMARY, 6-month secondary.
//! - ACAS s.207B: Day A stops the clock, Day B restarts it; the gap is added
//!   and the later of that and one month from Day B applies; no revival if
//!   Day A falls after the base deadline; result never earlier than base.
//! - F-6: a deadline landing on a weekend/bank holiday is NOT moved; a warning
//!   names the previous working day.
//! - All arithmetic in UTC.

use crate::constants::{format_commencement_month, TimeLimitConfig};
use crate::dates::CivilDate;
use crate::types::{DeadlineResponse, DeadlineResult, Regime};
use thiserror::Error;

/// Raised for malformed dates — mirrors the `throw new Error(...)` messages.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum DeadlineError {
    #[error("Invalid date (expected YYYY-MM-DD): {0}")]
    InvalidShape(String),
    #[error("Invalid calendar date: {0}")]
    InvalidCalendar(String),
}

/// `parseUTC` — shape check, then a calendar-overflow check.
pub fn parse_utc(iso: &str) -> Result<CivilDate, DeadlineError> {
    if !crate::dates::is_iso_shape(iso) {
        return Err(DeadlineError::InvalidShape(iso.to_string()));
    }
    CivilDate::parse_utc(iso).ok_or_else(|| DeadlineError::InvalidCalendar(iso.to_string()))
}

// ---------------------------------------------------------------------------
// UK Bank Holidays (England & Wales) — update annually.
// Source: GOV.UK bank holidays API / statutory instruments.
// ---------------------------------------------------------------------------
pub const UK_BANK_HOLIDAYS_EW: [&str; 32] = [
    // 2025
    "2025-01-01",
    "2025-04-18",
    "2025-04-21",
    "2025-05-05",
    "2025-05-26",
    "2025-08-25",
    "2025-12-25",
    "2025-12-26",
    // 2026
    "2026-01-01",
    "2026-04-03",
    "2026-04-06",
    "2026-05-04",
    "2026-05-25",
    "2026-08-31",
    "2026-12-25",
    "2026-12-28",
    // 2027
    "2027-01-01",
    "2027-03-26",
    "2027-03-29",
    "2027-05-03",
    "2027-05-31",
    "2027-08-30",
    "2027-12-27",
    "2027-12-28",
    // 2028
    "2028-01-03",
    "2028-04-14",
    "2028-04-17",
    "2028-05-01",
    "2028-05-29",
    "2028-08-28",
    "2028-12-25",
    "2028-12-26",
];

/// The last year the bank-holiday table covers (staleness warning threshold).
pub const BANK_HOLIDAY_DATA_LAST_YEAR: i32 = 2028;

pub fn is_bank_holiday(d: &CivilDate) -> bool {
    let iso = d.to_iso();
    UK_BANK_HOLIDAYS_EW.contains(&iso.as_str())
}

pub fn is_non_working_day(d: &CivilDate) -> bool {
    let dow = d.weekday();
    if dow == 0 || dow == 6 {
        return true;
    }
    is_bank_holiday(d)
}

/// The working day immediately BEFORE `d` — used only in a warning.
pub fn previous_working_day(d: &CivilDate) -> CivilDate {
    let mut r = *d;
    loop {
        r = r.add_days(-1);
        if !is_non_working_day(&r) {
            return r;
        }
    }
}

/// Add N calendar months, then subtract 1 day — the ET limitation period
/// ("N months less 1 day") under the corresponding-date rule (Dodds v Walker).
/// Where the later month has no corresponding day the period ends on the LAST
/// day of that month and is NOT reduced by a further day.
pub fn add_months_less_one_day(date: &CivilDate, months: i64) -> CivilDate {
    let y = date.year as i64;
    let m = date.month as i64 - 1; // 0-indexed like getUTCMonth()
    let d = date.day;
    let target_month = m + months;
    let target_year = y + target_month.div_euclid(12);
    let target_month_norm = target_month.rem_euclid(12);
    let days_in_target = crate::dates::days_in_month(target_year as i32, (target_month_norm + 1) as u32);
    if d <= days_in_target {
        let corresponding = CivilDate::new(target_year as i32, (target_month_norm + 1) as u32, d);
        corresponding.add_days(-1)
    } else {
        CivilDate::new(target_year as i32, (target_month_norm + 1) as u32, days_in_target)
    }
}

/// Add N calendar months (day clamped) — the ACAS one-month backstop.
pub fn add_months(date: &CivilDate, months: i64) -> CivilDate {
    let y = date.year as i64;
    let m = date.month as i64 - 1;
    let target_month = m + months;
    let target_year = y + target_month.div_euclid(12);
    let target_month_norm = target_month.rem_euclid(12);
    let days_in_target = crate::dates::days_in_month(target_year as i32, (target_month_norm + 1) as u32);
    let clamped = date.day.min(days_in_target);
    CivilDate::new(target_year as i32, (target_month_norm + 1) as u32, clamped)
}

/// Compute a single `DeadlineResult` for a given number of months / regime.
#[allow(clippy::too_many_arguments)]
fn compute_one(
    act_date: &CivilDate,
    months: u32,
    regime: Regime,
    claim_type: &str,
    acas_day_a: Option<&str>,
    acas_day_b: Option<&str>,
    today: &CivilDate,
) -> Result<DeadlineResult, DeadlineError> {
    let base_deadline = add_months_less_one_day(act_date, months as i64);
    let mut final_deadline = base_deadline;
    let mut acas_extended: Option<CivilDate> = None;

    if let (Some(a), Some(b)) = (acas_day_a, acas_day_b) {
        if !a.is_empty() && !b.is_empty() {
            let day_a = parse_utc(a)?;
            let day_b = parse_utc(b)?;
            if day_a > base_deadline {
                // F-1 (no revival): conciliation begun after the limit had already
                // expired does not extend time.
                final_deadline = base_deadline;
                acas_extended = None;
            } else {
                // F-14 defence: never let an inverted (Day B < Day A) input shorten the gap.
                let day_b_eff = if day_b < day_a { day_a } else { day_b };
                // s.207B(3): discount the Day A→Day B gap.
                let gap_days = day_b_eff.days_from_epoch() - day_a.days_from_epoch();
                let extended = base_deadline.add_days(gap_days);
                // s.207B(4): one-month-from-Day-B backstop (take the later).
                let one_month_from_b = add_months(&day_b_eff, 1);
                let mut f = if extended > one_month_from_b { extended } else { one_month_from_b };
                // F-14 floor: never earlier than the base statutory deadline.
                if f < base_deadline {
                    f = base_deadline;
                }
                final_deadline = f;
                acas_extended = Some(f);
            }
        }
    }

    // F-31: remaining time measured from UTC midnight of "today".
    let days_remaining = final_deadline.days_from_epoch() - today.days_from_epoch();

    Ok(DeadlineResult {
        claim_type: claim_type.to_string(),
        base_deadline: base_deadline.to_iso(),
        acas_extended_deadline: acas_extended.map(|d| d.to_iso()),
        final_deadline: final_deadline.to_iso(),
        original_deadline: final_deadline.to_iso(),
        regime,
        days_remaining,
        is_expired: days_remaining < 0,
    })
}

/// Normalise the optional ACAS inputs the way JS truthiness does: `undefined`,
/// `null` and `""` all mean "not supplied".
fn present(v: Option<&str>) -> Option<&str> {
    v.filter(|s| !s.is_empty())
}

/// `calculateDeadline(dateOfAct, acasDayA?, acasDayB?, claimType?)`.
pub fn calculate_deadline(
    config: &TimeLimitConfig,
    today: &CivilDate,
    date_of_act: &str,
    acas_day_a: Option<&str>,
    acas_day_b: Option<&str>,
    claim_type: Option<&str>,
) -> Result<DeadlineResult, DeadlineError> {
    let act_date = parse_utc(date_of_act)?;
    let commencement = parse_utc(&config.commencement_date)?;
    let is_post = act_date >= commencement;
    let months = if is_post { config.post_era_2025_months } else { config.pre_era_2025_months };
    let regime = if is_post { Regime::PostEra2025 } else { Regime::PreEra2025 };
    let ct = match claim_type {
        Some(c) if !c.is_empty() => c,
        _ => "general",
    };
    compute_one(&act_date, months, regime, ct, present(acas_day_a), present(acas_day_b), today)
}

/// `calculateDeadlines(dateOfAct, claimTypes, acasDayA?, acasDayB?)`.
pub fn calculate_deadlines(
    config: &TimeLimitConfig,
    today: &CivilDate,
    date_of_act: &str,
    claim_types: &[String],
    acas_day_a: Option<&str>,
    acas_day_b: Option<&str>,
) -> Result<DeadlineResponse, DeadlineError> {
    let act_date = parse_utc(date_of_act)?;
    let commencement = parse_utc(&config.commencement_date)?;
    let is_post = act_date >= commencement;
    let si_confirmed = config.time_limit_si_confirmed;
    let acas_a = present(acas_day_a);
    let acas_b = present(acas_day_b);

    // F-3: hedge for any act on/after the assumed commencement while the SI is unconfirmed.
    let hedge = is_post && !si_confirmed;
    let commencement_month = format_commencement_month(&config.commencement_date);

    let mut deadlines: Vec<DeadlineResult> = Vec::new();
    for ct in claim_types {
        if hedge {
            deadlines.push(compute_one(&act_date, config.pre_era_2025_months, Regime::PreEra2025, ct, acas_a, acas_b, today)?);
            let secondary_label = format!("{ct} (6-month regime — applies only if the ERA 2025 Statutory Instrument confirms the assumed {commencement_month} commencement)");
            deadlines.push(compute_one(&act_date, config.post_era_2025_months, Regime::PostEra2025, &secondary_label, acas_a, acas_b, today)?);
        } else {
            let months = if is_post { config.post_era_2025_months } else { config.pre_era_2025_months };
            let regime = if is_post { Regime::PostEra2025 } else { Regime::PreEra2025 };
            deadlines.push(compute_one(&act_date, months, regime, ct, acas_a, acas_b, today)?);
        }
    }

    let mut warnings: Vec<String> = Vec::new();

    if hedge {
        warnings.push(format!(
            "The ERA 2025 six-month time-limit commencement (assumed {commencement_month}) is NOT yet confirmed by Statutory Instrument. Because the applicable regime is uncertain, each claim is shown TWICE: the conservative three-month deadline is listed first as the PRIMARY deadline, and the six-month deadline second as a clearly-labelled secondary entry that applies only if the SI confirms the assumed commencement. Treat the shorter (three-month) deadline as operative until the SI is confirmed. Exact commencement date to be confirmed by Statutory Instrument."
        ));
    } else if !si_confirmed && !is_post && act_date.epoch_ms() >= commencement.epoch_ms() - 30 * 86_400_000 {
        warnings.push(format!(
            "The date of the act is shortly before the assumed ERA 2025 six-month time-limit commencement ({commencement_month}), which is NOT yet confirmed by Statutory Instrument. The conservative three-month deadline is shown. If the confirmed commencement turns out to be earlier than assumed, a longer six-month limit could apply — this would not shorten the deadline shown. Exact commencement date to be confirmed by Statutory Instrument."
        ));
    }

    // F-1: explicit warning when ACAS EC began after the operative limit had expired.
    if let (Some(a), Some(_)) = (acas_a, acas_b) {
        if let Some(first) = deadlines.first() {
            let day_a = parse_utc(a)?;
            let primary_base = parse_utc(&first.base_deadline)?;
            if day_a > primary_base {
                warnings.push(
                    "ACAS conciliation begun after the limit expired does not extend time (ERA 1996 s.207B). The deadline shown is the unextended statutory limit and the claim may already be out of time — seek advice immediately."
                        .to_string(),
                );
            }
        }
    }

    // F-6: non-working-day warning, deduplicated by deadline date.
    let mut non_working_seen: Vec<String> = Vec::new();
    for dl in &deadlines {
        if non_working_seen.contains(&dl.final_deadline) {
            continue;
        }
        let fd = parse_utc(&dl.final_deadline)?;
        if is_non_working_day(&fd) {
            non_working_seen.push(dl.final_deadline.clone());
            let prev = previous_working_day(&fd).to_iso();
            warnings.push(format!(
                "Your deadline ({fd}) falls on a weekend or bank holiday. The statutory time limit is NOT extended to the next working day — you must present your claim on or before {fd}. Practical target: file by the previous working day, {prev}.",
                fd = dl.final_deadline,
            ));
        }
    }

    // Urgent warning (based on the soonest operative deadline).
    if let Some(soonest) = deadlines.iter().map(|d| d.days_remaining).min() {
        if (0..=14).contains(&soonest) {
            warnings.push(format!("URGENT: Your earliest deadline expires in {soonest} days. Seek immediate advice if you have not already filed your claim."));
        }
    }

    if deadlines.iter().any(|d| d.is_expired) {
        warnings.push(
            "One or more deadlines have expired. A tribunal may still accept a late claim under the 'just and equitable' (discrimination) or 'not reasonably practicable' (unfair dismissal) tests. Seek legal advice immediately."
                .to_string(),
        );
    }

    if claim_types.iter().any(|c| c == "wrongful_dismissal") {
        warnings.push(
            "Wrongful dismissal: this calculator shows the ET route time limit (3 or 6 months less 1 day). If your claim exceeds the ET damages cap of £25,000, you may wish to bring it in the county court instead, where the Limitation Act 1980 allows 6 years from breach of contract."
                .to_string(),
        );
    }

    // ISSUE-17: bank holiday staleness warning.
    let has_stale = deadlines.iter().map(|d| parse_utc(&d.final_deadline).map(|x| x.year)).collect::<Result<Vec<_>, _>>()?.into_iter().any(|y| y > BANK_HOLIDAY_DATA_LAST_YEAR);
    if has_stale {
        warnings.push(format!(
            "WARNING: One or more deadlines fall after {y}. The bank holiday calendar used by this calculator only covers up to {y}. Bank holiday extensions may not be applied correctly. Please verify your deadline against the GOV.UK bank holidays calendar.",
            y = BANK_HOLIDAY_DATA_LAST_YEAR
        ));
    }

    Ok(DeadlineResponse { deadlines, time_limit_regime: if is_post { Regime::PostEra2025 } else { Regime::PreEra2025 }, warnings })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> CivilDate {
        CivilDate::parse_utc(s).unwrap()
    }
    fn today() -> CivilDate {
        d("2026-09-23")
    }
    fn cfg() -> TimeLimitConfig {
        TimeLimitConfig::default()
    }

    #[test]
    fn add_months_less_one_day_cases() {
        let cases = [
            ("2025-01-15", 3, "2025-04-14"),
            ("2025-01-15", 6, "2025-07-14"),
            ("2025-01-31", 3, "2025-04-30"),
            ("2025-10-31", 3, "2026-01-30"),
            ("2025-11-30", 3, "2026-02-28"),
            ("2025-02-28", 3, "2025-05-27"),
            ("2025-11-15", 3, "2026-02-14"),
            ("2025-08-31", 6, "2026-02-28"),
            ("2025-06-01", 3, "2025-08-31"),
            ("2027-11-30", 3, "2028-02-29"),
            ("2027-12-01", 3, "2028-02-29"),
        ];
        for (from, m, expect) in cases {
            assert_eq!(add_months_less_one_day(&d(from), m).to_iso(), expect, "{from} + {m}");
        }
    }

    #[test]
    fn regime_selection() {
        let r = calculate_deadline(&cfg(), &today(), "2025-06-01", None, None, None).unwrap();
        assert_eq!(r.regime, Regime::PreEra2025);
        assert_eq!(r.final_deadline, "2025-08-31");
        assert_eq!(r.original_deadline, "2025-08-31");
        assert_eq!(r.claim_type, "general");
        let r = calculate_deadline(&cfg(), &today(), "2026-10-15", None, None, None).unwrap();
        assert_eq!(r.regime, Regime::PostEra2025);
        assert_eq!(r.final_deadline, "2027-04-14");
        assert_eq!(calculate_deadline(&cfg(), &today(), "2026-10-01", None, None, None).unwrap().regime, Regime::PostEra2025);
        assert_eq!(calculate_deadline(&cfg(), &today(), "2026-09-30", None, None, None).unwrap().regime, Regime::PreEra2025);
    }

    #[test]
    fn acas_clock_stopping() {
        let r = calculate_deadline(&cfg(), &today(), "2025-01-01", Some("2025-02-01"), Some("2025-02-15"), None).unwrap();
        assert_eq!(r.base_deadline, "2025-03-31");
        assert_eq!(r.acas_extended_deadline.as_deref(), Some("2025-04-14"));
        assert_eq!(r.final_deadline, "2025-04-14");
        let r = calculate_deadline(&cfg(), &today(), "2025-01-01", Some("2025-03-30"), Some("2025-04-01"), None).unwrap();
        assert_eq!(r.acas_extended_deadline.as_deref(), Some("2025-05-01"));
        let r = calculate_deadline(&cfg(), &today(), "2025-01-01", Some("2025-04-10"), Some("2025-04-15"), None).unwrap();
        assert_eq!(r.acas_extended_deadline, None);
        assert_eq!(r.final_deadline, "2025-03-31");
        assert!(r.is_expired);
        let r = calculate_deadline(&cfg(), &today(), "2025-01-01", Some("2025-02-15"), Some("2025-02-01"), None).unwrap();
        assert!(r.acas_extended_deadline.as_deref().unwrap() >= "2025-03-31");
        let r = calculate_deadline(&cfg(), &today(), "2025-01-01", Some("2025-02-10"), Some("2025-02-10"), None).unwrap();
        assert_eq!(r.acas_extended_deadline.as_deref(), Some("2025-03-31"));
        let r = calculate_deadline(&cfg(), &today(), "2026-09-15", Some("2026-09-20"), Some("2026-10-05"), Some("unfair_dismissal")).unwrap();
        assert_eq!(r.regime, Regime::PreEra2025);
        assert_eq!(r.base_deadline, "2026-12-14");
        assert_eq!(r.acas_extended_deadline.as_deref(), Some("2026-12-29"));
    }

    #[test]
    fn non_working_day_not_moved() {
        assert_eq!(calculate_deadline(&cfg(), &today(), "2025-04-06", None, None, None).unwrap().final_deadline, "2025-07-05");
        assert_eq!(calculate_deadline(&cfg(), &today(), "2025-04-07", None, None, None).unwrap().final_deadline, "2025-07-06");
        let r = calculate_deadlines(&cfg(), &today(), "2026-09-29", &["unfair_dismissal".into()], None, None).unwrap();
        assert_eq!(r.deadlines[0].final_deadline, "2026-12-28");
        let w = r.warnings.iter().find(|w| w.contains("weekend or bank holiday")).unwrap();
        assert!(w.contains("2026-12-28") && w.contains("2026-12-24"));
    }

    #[test]
    fn dual_regime_hedge() {
        let r = calculate_deadlines(&cfg(), &today(), "2027-03-01", &["unfair_dismissal".into()], None, None).unwrap();
        assert_eq!(r.time_limit_regime, Regime::PostEra2025);
        assert_eq!(r.deadlines.len(), 2);
        assert_eq!(r.deadlines[0].final_deadline, "2027-05-31");
        assert_eq!(r.deadlines[1].final_deadline, "2027-08-31");
        assert!(r.deadlines[1].claim_type.contains("6-month regime"));
        assert!(r.warnings.iter().any(|w| w.contains("PRIMARY")));
        let r = calculate_deadlines(&cfg(), &today(), "2025-06-01", &["unfair_dismissal".into()], None, None).unwrap();
        assert_eq!(r.deadlines.len(), 1);
    }

    #[test]
    fn warnings() {
        let r = calculate_deadlines(&cfg(), &today(), "2026-09-15", &["unfair_dismissal".into()], None, None).unwrap();
        assert!(r.warnings.iter().any(|w| w.contains("shortly before the assumed ERA 2025")));
        let r = calculate_deadlines(&cfg(), &today(), "2020-01-01", &["unfair_dismissal".into()], None, None).unwrap();
        assert!(r.warnings.iter().any(|w| w.contains("expired")));
        assert!(r.deadlines[0].is_expired);
        let r = calculate_deadlines(&cfg(), &today(), "2025-06-01", &["wrongful_dismissal".into()], None, None).unwrap();
        assert!(r.warnings.iter().any(|w| w.contains("county court")));
        let r = calculate_deadlines(&cfg(), &today(), "2025-01-01", &["unfair_dismissal".into()], Some("2025-04-10"), Some("2025-04-15")).unwrap();
        assert!(r.warnings.iter().any(|w| w.contains("does not extend time")));
        let r = calculate_deadlines(&cfg(), &today(), "2028-10-01", &["unfair_dismissal".into()], None, None).unwrap();
        assert!(r.warnings.iter().any(|w| w.contains("2028")));
        assert!(calculate_deadlines(&cfg(), &today(), "2025-06-01", &[], None, None).unwrap().deadlines.is_empty());
    }

    #[test]
    fn invalid_dates() {
        assert!(calculate_deadline(&cfg(), &today(), "not-a-date", None, None, None).is_err());
        assert!(calculate_deadline(&cfg(), &today(), "2026-02-31", None, None, None).is_err());
        assert!(calculate_deadline(&cfg(), &today(), "2025-01-01", Some("2025-13-40"), Some("2025-02-15"), None).is_err());
    }

    #[test]
    fn honours_commencement_override() {
        let c = TimeLimitConfig::with_commencement("2026-01-01");
        assert_eq!(calculate_deadline(&c, &today(), "2026-02-01", None, None, None).unwrap().regime, Regime::PostEra2025);
    }
}
