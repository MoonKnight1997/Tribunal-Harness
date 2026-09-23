//! `GET /api/era-2025/tracker` — port of `src/app/api/era-2025/tracker/route.ts`.
//! Provision / position / commencement / status come from `ERA_2025_TRACKER`;
//! only the API-specific `tool_status` and `notes` metadata live here.

use crate::constants::ERA_2025_TRACKER;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ApiTrackerEntry {
    pub provision: &'static str,
    pub old_position: &'static str,
    pub new_position: &'static str,
    pub commencement: &'static str,
    pub status: &'static str,
    pub tool_status: &'static str,
    pub notes: &'static str,
}

// F-11 (Hard Rule 7 — no fabricated compliance claims): each `implemented`
// entry was re-audited against real code; ported verbatim.
const API_METADATA: [(&str, &str, &str); 19] = [
    ("INDUSTRIAL_ACTION_DISMISSAL", "implemented", "Added to unfair dismissal schema auto-unfair grounds"),
    ("SSP_DAY_ONE", "planned", "No remedy/pay engine exists yet — planned."),
    ("PATERNITY_LEAVE_DAY_ONE", "planned", "No day-one-right service check implemented yet — planned."),
    ("PARENTAL_LEAVE_DAY_ONE", "planned", "No day-one-right service check implemented yet — planned."),
    ("SEXUAL_HARASSMENT_WHISTLEBLOWING", "implemented", "Added to whistleblowing schema disclosure categories. Creates dual-track claim possibility."),
    ("COLLECTIVE_REDUNDANCY_180_DAYS", "planned", "No remedy calculator exists yet — planned."),
    ("FAIR_WORK_AGENCY", "not_applicable", "Enforcement body — no direct schema impact"),
    ("ET_TIME_LIMIT_6_MONTHS", "implemented", "Deadline calculator applies correct regime based on act date. Commencement date configurable."),
    ("HARASSMENT_ALL_REASONABLE_STEPS", "implemented", "Harassment schema updated with new field for employer steps standard"),
    ("THIRD_PARTY_HARASSMENT", "implemented", "Added third_party_harassment field to harassment schema"),
    ("NDA_VOID", "implemented", "Added nda_clause field to harassment schema"),
    ("UNION_INFORM_RIGHT", "not_applicable", "Procedural change — no direct schema impact"),
    ("QUALIFYING_PERIOD_6_MONTHS", "planned", "qualifyingPeriod() service built but not yet wired into schema/analyse UI — planned."),
    ("COMPENSATORY_AWARD_UNCAPPED", "planned", "Schema flags the cap change as metadata; no remedy calculator exists yet — planned."),
    ("FIRE_AND_REHIRE_AUTO_UNFAIR", "implemented", "New claim type schema created with financial distress defence fields"),
    ("ZERO_HOURS_PROTECTIONS", "implemented", "New claim type schema created. Exact commencement date to be confirmed by SI."),
    ("MATERNITY_EXTENDED_PROTECTION", "planned", "Will be integrated when secondary legislation confirms scope"),
    ("FLEXIBLE_WORKING_STRENGTHENED", "planned", "Will be integrated when secondary legislation confirms scope"),
    // ERA 2025 tracker rows without API metadata fall back to planned / "".
    ("__unused__", "planned", ""),
];

pub fn tracker_data() -> Vec<ApiTrackerEntry> {
    ERA_2025_TRACKER
        .iter()
        .map(|e| {
            let meta = API_METADATA.iter().find(|(k, _, _)| *k == e.key);
            ApiTrackerEntry {
                provision: e.provision,
                old_position: e.old_position,
                new_position: e.new_position,
                commencement: e.commencement,
                status: e.status.as_str(),
                tool_status: meta.map(|m| m.1).unwrap_or("planned"),
                notes: meta.map(|m| m.2).unwrap_or(""),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn implemented_set_is_the_audited_one() {
        let implemented: Vec<&str> = tracker_data().iter().filter(|c| c.tool_status == "implemented").map(|c| c.provision).collect();
        assert_eq!(
            implemented,
            vec![
                "Industrial action dismissal — auto unfair",
                "Sexual harassment as whistleblowing",
                "ET time limit — 6 months",
                "Harassment — all reasonable steps",
                "Third-party harassment liability",
                "NDAs void for harassment/discrimination",
                "Fire and rehire — automatically unfair",
                "Zero-hours contract rights",
            ]
        );
        assert_eq!(tracker_data().len(), ERA_2025_TRACKER.len());
    }
}
