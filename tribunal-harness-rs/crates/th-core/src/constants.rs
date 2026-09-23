//! Employment Rights Act 2025 — commencement dates, tracker, claim types and
//! FSM states. Port of `src/lib/constants.ts`. This module is the single source
//! of truth: never hardcode an ERA 2025 date anywhere else.
//!
//! Every value is ported verbatim from the TypeScript file, including the
//! entries marked TBC. Update these when Statutory Instruments confirm dates.

use crate::dates::CivilDate;
use serde::Serialize;

/// The ERA 2025 commencement dates. `None` marks a provision whose commencement
/// is not yet fixed by Statutory Instrument (the TypeScript constant is `null`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Era2025 {
    pub royal_assent: &'static str,
    pub trade_union_ballot_changes: &'static str,
    pub industrial_action_dismissal: &'static str,
    pub ssp_day_one: &'static str,
    pub paternity_leave_day_one: &'static str,
    pub parental_leave_day_one: &'static str,
    pub collective_redundancy_180_days: &'static str,
    pub sexual_harassment_whistleblowing: &'static str,
    pub fair_work_agency: &'static str,
    pub et_time_limit_6_months: &'static str,
    pub harassment_all_reasonable_steps: &'static str,
    pub third_party_harassment: &'static str,
    pub nda_void: &'static str,
    pub union_inform_right: &'static str,
    pub qualifying_period_6_months: &'static str,
    pub compensatory_award_uncapped: &'static str,
    pub fire_and_rehire_auto_unfair: &'static str,
    pub zero_hours_protections: Option<&'static str>,
    pub maternity_extended_protection: Option<&'static str>,
    pub flexible_working_strengthened: Option<&'static str>,
    pub aggregate_redundancy_threshold: Option<&'static str>,
}

pub const ERA_2025: Era2025 = Era2025 {
    // Royal Assent
    royal_assent: "2025-12-18",

    // Already in force (February 2026)
    trade_union_ballot_changes: "2026-02-18",
    industrial_action_dismissal: "2026-02-18",

    // April 2026 commencement
    ssp_day_one: "2026-04-06",
    paternity_leave_day_one: "2026-04-06",
    parental_leave_day_one: "2026-04-06",
    collective_redundancy_180_days: "2026-04-06",
    sexual_harassment_whistleblowing: "2026-04-06",
    fair_work_agency: "2026-04-07",

    // October 2026 commencement (exact date TBC by Statutory Instrument)
    et_time_limit_6_months: "2026-10-01",
    harassment_all_reasonable_steps: "2026-10-01",
    third_party_harassment: "2026-10-01",
    nda_void: "2026-10-01",
    union_inform_right: "2026-10-01",

    // January 2027 commencement
    qualifying_period_6_months: "2027-01-01",
    compensatory_award_uncapped: "2027-01-01",
    fire_and_rehire_auto_unfair: "2027-01-01",

    // 2027 (exact dates TBC by Statutory Instrument — do not rely on 1 Jan)
    zero_hours_protections: None,
    maternity_extended_protection: None,
    flexible_working_strengthened: None,
    aggregate_redundancy_threshold: None,
};

/// `Object.entries(ERA_2025)` in declaration order — used wherever the
/// TypeScript code iterates the constant (e.g. the degraded-mode flag status
/// derivation, where the first matching label wins).
pub const ERA_2025_ENTRIES: [(&str, Option<&str>); 21] = [
    ("ROYAL_ASSENT", Some(ERA_2025.royal_assent)),
    ("TRADE_UNION_BALLOT_CHANGES", Some(ERA_2025.trade_union_ballot_changes)),
    ("INDUSTRIAL_ACTION_DISMISSAL", Some(ERA_2025.industrial_action_dismissal)),
    ("SSP_DAY_ONE", Some(ERA_2025.ssp_day_one)),
    ("PATERNITY_LEAVE_DAY_ONE", Some(ERA_2025.paternity_leave_day_one)),
    ("PARENTAL_LEAVE_DAY_ONE", Some(ERA_2025.parental_leave_day_one)),
    ("COLLECTIVE_REDUNDANCY_180_DAYS", Some(ERA_2025.collective_redundancy_180_days)),
    ("SEXUAL_HARASSMENT_WHISTLEBLOWING", Some(ERA_2025.sexual_harassment_whistleblowing)),
    ("FAIR_WORK_AGENCY", Some(ERA_2025.fair_work_agency)),
    ("ET_TIME_LIMIT_6_MONTHS", Some(ERA_2025.et_time_limit_6_months)),
    ("HARASSMENT_ALL_REASONABLE_STEPS", Some(ERA_2025.harassment_all_reasonable_steps)),
    ("THIRD_PARTY_HARASSMENT", Some(ERA_2025.third_party_harassment)),
    ("NDA_VOID", Some(ERA_2025.nda_void)),
    ("UNION_INFORM_RIGHT", Some(ERA_2025.union_inform_right)),
    ("QUALIFYING_PERIOD_6_MONTHS", Some(ERA_2025.qualifying_period_6_months)),
    ("COMPENSATORY_AWARD_UNCAPPED", Some(ERA_2025.compensatory_award_uncapped)),
    ("FIRE_AND_REHIRE_AUTO_UNFAIR", Some(ERA_2025.fire_and_rehire_auto_unfair)),
    ("ZERO_HOURS_PROTECTIONS", ERA_2025.zero_hours_protections),
    ("MATERNITY_EXTENDED_PROTECTION", ERA_2025.maternity_extended_protection),
    ("FLEXIBLE_WORKING_STRENGTHENED", ERA_2025.flexible_working_strengthened),
    ("AGGREGATE_REDUNDANCY_THRESHOLD", ERA_2025.aggregate_redundancy_threshold),
];

/// Look up an ERA_2025 entry by its TypeScript key name.
pub fn era_2025_get(key: &str) -> Option<Option<&'static str>> {
    ERA_2025_ENTRIES.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackerStatus {
    InForce,
    Upcoming,
    AwaitingSi,
}

impl TrackerStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TrackerStatus::InForce => "in_force",
            TrackerStatus::Upcoming => "upcoming",
            TrackerStatus::AwaitingSi => "awaiting_si",
        }
    }
}

/// One row of the ERA 2025 Implementation Tracker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct TrackerEntry {
    pub provision: &'static str,
    pub old_position: &'static str,
    pub new_position: &'static str,
    pub commencement: &'static str,
    pub status: TrackerStatus,
    pub key: &'static str,
    /// True when the exact commencement day is NOT yet fixed by a Statutory
    /// Instrument (all Oct-2026 provisions + the 2027 "SI awaited" entries).
    pub tbc: bool,
}

macro_rules! row {
    ($provision:expr, $old:expr, $new:expr, $comm:expr, $status:expr, $key:expr, $tbc:expr) => {
        TrackerEntry {
            provision: $provision,
            old_position: $old,
            new_position: $new,
            commencement: $comm,
            status: $status,
            key: $key,
            tbc: $tbc,
        }
    };
}

/// SINGLE SOURCE OF TRUTH for the tracker — ported row-for-row.
pub const ERA_2025_TRACKER: [TrackerEntry; 21] = [
    row!(
        "Trade union ballot mandate & notice periods",
        "6-month ballot mandate; 14-day industrial action notice",
        "12-month ballot mandate; 10-day industrial action notice",
        "18 Feb 2026",
        TrackerStatus::InForce,
        "TRADE_UNION_BALLOT_CHANGES",
        false
    ),
    row!(
        "Industrial action dismissal — auto unfair",
        "12-week protected period",
        "No time limit — automatically unfair",
        "18 Feb 2026",
        TrackerStatus::InForce,
        "INDUSTRIAL_ACTION_DISMISSAL",
        false
    ),
    row!(
        "SSP from day 1",
        "3-day waiting period",
        "Payable from day 1 of sickness",
        "6 Apr 2026",
        TrackerStatus::InForce,
        "SSP_DAY_ONE",
        false
    ),
    row!(
        "Paternity leave — day 1 right",
        "26 weeks' service required",
        "Day 1 right",
        "6 Apr 2026",
        TrackerStatus::InForce,
        "PATERNITY_LEAVE_DAY_ONE",
        false
    ),
    row!(
        "Parental leave — day 1 right",
        "1 year's service required",
        "Day 1 right",
        "6 Apr 2026",
        TrackerStatus::InForce,
        "PARENTAL_LEAVE_DAY_ONE",
        false
    ),
    row!(
        "Sexual harassment as whistleblowing",
        "Not a qualifying disclosure",
        "Qualifying disclosure under ERA 1996 Part IVA",
        "6 Apr 2026",
        TrackerStatus::InForce,
        "SEXUAL_HARASSMENT_WHISTLEBLOWING",
        false
    ),
    row!(
        "Collective redundancy — 180-day period",
        "90 days maximum",
        "180 days maximum",
        "6 Apr 2026",
        TrackerStatus::InForce,
        "COLLECTIVE_REDUNDANCY_180_DAYS",
        false
    ),
    row!(
        "Fair Work Agency established",
        "No single enforcement body",
        "Fair Work Agency enforces employment rights",
        "7 Apr 2026",
        TrackerStatus::InForce,
        "FAIR_WORK_AGENCY",
        false
    ),
    row!(
        "ET time limit — 6 months",
        "3 months less 1 day",
        "6 months less 1 day",
        "Oct 2026 (SI awaited)",
        TrackerStatus::Upcoming,
        "ET_TIME_LIMIT_6_MONTHS",
        true
    ),
    row!(
        "Harassment — all reasonable steps",
        "Reasonable steps defence",
        "All reasonable steps required",
        "Oct 2026 (SI awaited)",
        TrackerStatus::Upcoming,
        "HARASSMENT_ALL_REASONABLE_STEPS",
        true
    ),
    row!(
        "Third-party harassment liability",
        "No employer liability for third-party acts",
        "Employer liable unless all reasonable steps taken",
        "Oct 2026 (SI awaited)",
        TrackerStatus::Upcoming,
        "THIRD_PARTY_HARASSMENT",
        true
    ),
    row!(
        "NDAs void for harassment/discrimination",
        "NDAs enforceable",
        "NDAs preventing disclosure are void",
        "Oct 2026 (SI awaited)",
        TrackerStatus::Upcoming,
        "NDA_VOID",
        true
    ),
    row!(
        "Union right to inform workers",
        "No right",
        "Right to inform workers of union membership",
        "Oct 2026 (SI awaited)",
        TrackerStatus::Upcoming,
        "UNION_INFORM_RIGHT",
        true
    ),
    row!(
        "Qualifying period — 6 months",
        "2 years' continuous employment",
        "6 months' continuous employment",
        "1 Jan 2027",
        TrackerStatus::Upcoming,
        "QUALIFYING_PERIOD_6_MONTHS",
        false
    ),
    row!(
        "Compensatory award — uncapped",
        "Capped at lower of 1 year's pay or ~£115,115",
        "No statutory cap",
        "1 Jan 2027",
        TrackerStatus::Upcoming,
        "COMPENSATORY_AWARD_UNCAPPED",
        false
    ),
    row!(
        "Fire and rehire — automatically unfair",
        "No specific statutory protection",
        "Automatically unfair (limited financial distress defence)",
        "1 Jan 2027",
        TrackerStatus::Upcoming,
        "FIRE_AND_REHIRE_AUTO_UNFAIR",
        false
    ),
    row!(
        "Fire and replace — automatically unfair",
        "No specific statutory protection",
        "Automatically unfair (dismiss and replace with new hire)",
        "1 Jan 2027",
        TrackerStatus::Upcoming,
        "FIRE_AND_REPLACE_AUTO_UNFAIR",
        false
    ),
    row!(
        "Zero-hours contract rights",
        "No guaranteed hours",
        "Right to guaranteed hours, shift notice, cancellation pay",
        "2027 (SI awaited)",
        TrackerStatus::AwaitingSi,
        "ZERO_HOURS_PROTECTIONS",
        true
    ),
    row!(
        "Maternity — extended redundancy protection",
        "Protection during maternity leave",
        "Extended protection period post-return",
        "2027 (SI awaited)",
        TrackerStatus::AwaitingSi,
        "MATERNITY_EXTENDED_PROTECTION",
        true
    ),
    row!(
        "Flexible working — strengthened right",
        "Right to request (employer can refuse on 8 grounds)",
        "Strengthened right — fewer refusal grounds",
        "2027 (SI awaited)",
        TrackerStatus::AwaitingSi,
        "FLEXIBLE_WORKING_STRENGTHENED",
        true
    ),
    row!(
        "Collective redundancy — aggregate threshold",
        "20+ redundancies counted per establishment",
        "Threshold aggregated across the whole organisation",
        "2027 (SI awaited)",
        TrackerStatus::AwaitingSi,
        "AGGREGATE_REDUNDANCY_THRESHOLD",
        true
    ),
];

/// `constants.ts:isValidIsoDate` — shape + `new Date(...)` round trip.
pub fn is_valid_iso_date(value: &str) -> bool {
    CivilDate::parse_iso_string(value).is_some()
}

/// Validate the `ERA_2025_TIME_LIMIT_COMMENCEMENT` override. Unset/empty →
/// the assumed default (Oct 2026). A non-empty malformed value is an error —
/// the app must refuse to start rather than silently pin a permanent 3-month
/// regime.
pub fn resolve_time_limit_commencement(override_value: Option<&str>) -> Result<String, String> {
    match override_value {
        None => Ok(ERA_2025.et_time_limit_6_months.to_string()),
        Some(v) if v.trim().is_empty() => Ok(ERA_2025.et_time_limit_6_months.to_string()),
        Some(v) => {
            if !is_valid_iso_date(v) {
                return Err(format!(
                    "Invalid ERA_2025_TIME_LIMIT_COMMENCEMENT=\"{v}\": expected a valid YYYY-MM-DD date. Refusing to start rather than silently falling back to a permanent 3-month regime."
                ));
            }
            Ok(v.to_string())
        }
    }
}

/// `TIME_LIMIT_CONFIG` — the commencement date is resolved once at start-up
/// from the environment (see [`resolve_time_limit_commencement`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimeLimitConfig {
    pub pre_era_2025_months: u32,
    pub post_era_2025_months: u32,
    pub commencement_date: String,
    /// F-3: the Oct 2026 SI is not yet confirmed. The deadline calculator hedges
    /// (computes both regimes) for acts on/after the assumed commencement while
    /// this is false.
    pub time_limit_si_confirmed: bool,
}

impl TimeLimitConfig {
    pub fn with_commencement(commencement_date: impl Into<String>) -> Self {
        Self {
            pre_era_2025_months: 3,
            post_era_2025_months: 6,
            commencement_date: commencement_date.into(),
            time_limit_si_confirmed: false,
        }
    }
}

impl Default for TimeLimitConfig {
    fn default() -> Self {
        Self::with_commencement(ERA_2025.et_time_limit_6_months)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QualifyingPeriodConfig {
    pub pre_era_2025_years: u32,
    pub post_era_2025_months: u32,
    pub commencement_date: &'static str,
}

pub const QUALIFYING_PERIOD_CONFIG: QualifyingPeriodConfig = QualifyingPeriodConfig {
    pre_era_2025_years: 2,
    post_era_2025_months: 6,
    commencement_date: ERA_2025.qualifying_period_6_months,
};

/// `effectiveFrom` on a claim type: absent, explicitly `null`, or a date.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectiveFrom {
    Absent,
    Null,
    Date(&'static str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClaimType {
    pub id: &'static str,
    pub label: &'static str,
    pub statute: &'static str,
    pub era2025: bool,
    pub effective_from: EffectiveFrom,
}

impl Serialize for ClaimType {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let len = if matches!(self.effective_from, EffectiveFrom::Absent) { 4 } else { 5 };
        let mut m = serializer.serialize_map(Some(len))?;
        m.serialize_entry("id", self.id)?;
        m.serialize_entry("label", self.label)?;
        m.serialize_entry("statute", self.statute)?;
        m.serialize_entry("era2025", &self.era2025)?;
        match self.effective_from {
            EffectiveFrom::Absent => {}
            EffectiveFrom::Null => m.serialize_entry("effectiveFrom", &Option::<&str>::None)?,
            EffectiveFrom::Date(d) => m.serialize_entry("effectiveFrom", d)?,
        }
        m.end()
    }
}

/// Claim types supported by the system (10).
pub const CLAIM_TYPES: [ClaimType; 10] = [
    ClaimType { id: "unfair_dismissal", label: "Unfair Dismissal", statute: "ERA 1996 s98", era2025: true, effective_from: EffectiveFrom::Absent },
    ClaimType { id: "direct_discrimination", label: "Direct Discrimination", statute: "EA 2010 s13", era2025: false, effective_from: EffectiveFrom::Absent },
    ClaimType { id: "indirect_discrimination", label: "Indirect Discrimination", statute: "EA 2010 s19", era2025: false, effective_from: EffectiveFrom::Absent },
    ClaimType { id: "harassment", label: "Harassment", statute: "EA 2010 s26", era2025: true, effective_from: EffectiveFrom::Absent },
    ClaimType { id: "victimisation", label: "Victimisation", statute: "EA 2010 s27", era2025: false, effective_from: EffectiveFrom::Absent },
    ClaimType { id: "reasonable_adjustments", label: "Failure to Make Reasonable Adjustments", statute: "EA 2010 ss20-21", era2025: false, effective_from: EffectiveFrom::Absent },
    ClaimType { id: "whistleblowing", label: "Whistleblowing", statute: "ERA Part IVA", era2025: true, effective_from: EffectiveFrom::Absent },
    ClaimType { id: "wrongful_dismissal", label: "Wrongful Dismissal", statute: "Common Law", era2025: false, effective_from: EffectiveFrom::Absent },
    // F-24(b): derive from the single source of truth rather than duplicating a literal date.
    ClaimType { id: "fire_and_rehire", label: "Fire and Rehire", statute: "ERA 2025", era2025: true, effective_from: EffectiveFrom::Date(ERA_2025.fire_and_rehire_auto_unfair) },
    // F-24(c): ZERO_HOURS_PROTECTIONS is deliberately null — align to null so nothing gates on a phantom commencement.
    ClaimType { id: "zero_hours_rights", label: "Zero-Hours Contract Rights", statute: "ERA 2025", era2025: true, effective_from: EffectiveFrom::Null },
];

pub fn claim_type_ids() -> Vec<&'static str> {
    CLAIM_TYPES.iter().map(|c| c.id).collect()
}

/// FSM States — UK Employment Tribunal procedure.
pub const FSM_STATES: [&str; 16] = [
    "PRE_ACTION",
    "ACAS_EC",
    "ET1_FILED",
    "ET3_RECEIVED",
    "CASE_MANAGED",
    "DISCLOSURE",
    "WITNESS_STATEMENTS",
    "BUNDLE_PREP",
    "HEARING",
    "JUDGMENT",
    "EAT_APPEAL",
    "EAT_SIFT",
    "EAT_RULE3_10",
    "EAT_FULL_HEARING",
    "COA_PERMISSION",
    "COA_HEARING",
];

// ---------------------------------------------------------------------------
// ERA 2025 date formatting helpers — render commencement dates in user-facing
// copy so the displayed date always derives from the constants above.
// ---------------------------------------------------------------------------

/// `formatCommencementDate("2027-01-01")` → `1 January 2027`.
pub fn format_commencement_date(iso: &str) -> String {
    match CivilDate::parse_iso_string(iso) {
        Some(d) => d.format_long(),
        None => "Invalid Date".to_string(),
    }
}

/// `formatCommencementMonth("2026-10-01")` → `October 2026`.
pub fn format_commencement_month(iso: &str) -> String {
    match CivilDate::parse_iso_string(iso) {
        Some(d) => d.format_month_year(),
        None => "Invalid Date".to_string(),
    }
}

/// Keys whose exact commencement day is not yet fixed by an SI, derived from
/// the tracker's `tbc` flag (one source of truth).
pub fn tbc_commencement_keys() -> Vec<&'static str> {
    ERA_2025_TRACKER.iter().filter(|e| e.tbc).map(|e| e.key).collect()
}

pub fn is_commencement_tbc(key: &str) -> bool {
    ERA_2025_TRACKER.iter().any(|e| e.tbc && e.key == key)
}

/// For a TBC entry, month + year with an explicit "(exact date TBC by SI)"
/// marker so an unconfirmed date is never asserted as fixed (Hard Rule 6).
pub fn format_commencement_label(iso: &str, tbc: bool) -> String {
    if tbc {
        format!("{} (exact date TBC by SI)", format_commencement_month(iso))
    } else {
        format_commencement_date(iso)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracker_keys_are_unique_and_statuses_consistent() {
        let mut keys: Vec<&str> = ERA_2025_TRACKER.iter().map(|e| e.key).collect();
        keys.sort();
        keys.dedup();
        assert_eq!(keys.len(), ERA_2025_TRACKER.len());
        for e in ERA_2025_TRACKER.iter() {
            if e.status == TrackerStatus::InForce {
                assert!(!e.tbc);
            }
            if e.status == TrackerStatus::AwaitingSi {
                assert!(e.tbc);
            }
        }
    }

    #[test]
    fn override_resolution() {
        assert_eq!(resolve_time_limit_commencement(None).unwrap(), "2026-10-01");
        assert_eq!(resolve_time_limit_commencement(Some("  ")).unwrap(), "2026-10-01");
        assert_eq!(resolve_time_limit_commencement(Some("2027-05-01")).unwrap(), "2027-05-01");
        assert!(resolve_time_limit_commencement(Some("garbage")).is_err());
        assert!(resolve_time_limit_commencement(Some("2026-02-30")).is_err());
    }

    #[test]
    fn labels() {
        assert_eq!(format_commencement_label("2026-10-01", true), "October 2026 (exact date TBC by SI)");
        assert_eq!(format_commencement_label("2027-01-01", false), "1 January 2027");
        assert!(is_commencement_tbc("ET_TIME_LIMIT_6_MONTHS"));
        assert!(!is_commencement_tbc("QUALIFYING_PERIOD_6_MONTHS"));
    }
}
