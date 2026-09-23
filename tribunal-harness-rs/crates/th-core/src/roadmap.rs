//! Procedural roadmap — ports of `src/app/api/roadmap/[caseId]/route.ts`
//! (static 16-stage template) and `src/app/api/roadmap/route.ts` (timeline
//! from a date of last act).

use crate::constants::{format_commencement_month, TimeLimitConfig, ERA_2025};
use crate::dates::CivilDate;
use crate::deadlines::{calculate_deadline, DeadlineError};
use serde_json::{json, Value};

pub fn roadmap_stages() -> Vec<Value> {
    let tl = format_commencement_month(ERA_2025.et_time_limit_6_months);
    let qp = format_commencement_month(ERA_2025.qualifying_period_6_months);
    let s = |id: &str, label: &str, phase: &str, description: &str, actions: &[&str], note: Option<String>| {
        json!({ "id": id, "label": label, "phase": phase, "description": description, "actions": actions, "era2025_note": note })
    };
    vec![
        s("PRE_ACTION", "Pre-Action", "ET", "Assess claim viability, gather evidence, calculate time limits", &["Run gap analysis", "Identify claim types", "Calculate deadlines"], Some(format!("Time limits change from {tl} — check which regime applies"))),
        s("ACAS_EC", "ACAS Early Conciliation", "ET", "Mandatory pre-claim conciliation (up to 6 weeks)", &["Notify ACAS", "Engage in conciliation", "Obtain EC certificate"], None),
        s("ET1_FILED", "ET1 Filed", "ET", "Claim form submitted to Employment Tribunal", &["Complete ET1 form", "Attach supporting documents", "Pay fee (if applicable)"], None),
        s("ET3_RECEIVED", "ET3 Response", "ET", "Respondent files defence (28 days)", &["Review ET3", "Identify disputed facts", "Consider default judgment"], None),
        s("CASE_MANAGED", "Case Management", "ET", "Preliminary hearing for directions", &["Prepare case summary", "Draft proposed directions", "Attend PH"], None),
        s("DISCLOSURE", "Disclosure", "ET", "Exchange of relevant documents", &["Prepare disclosure list", "Review respondent's disclosure", "Apply for specific disclosure if needed"], None),
        s("WITNESS_STATEMENTS", "Witness Statements", "ET", "Preparation and simultaneous exchange", &["Draft witness statements", "Obtain supporting statements", "Exchange on deadline"], None),
        s("BUNDLE_PREP", "Bundle Preparation", "ET", "Agreed hearing bundle compiled", &["Agree bundle contents", "Paginate and index", "Submit to tribunal"], None),
        s("HEARING", "Final Hearing", "ET", "Full merits hearing before tribunal panel", &["Prepare skeleton argument", "Compile authorities bundle", "Attend hearing"], Some(format!("From {qp}: qualifying period for UD = 6 months, no compensatory cap"))),
        s("JUDGMENT", "Judgment", "ET", "Tribunal decision", &["Request written reasons (14 days)", "Assess grounds of appeal", "Consider remedy hearing"], None),
        s("EAT_APPEAL", "Notice of Appeal", "EAT", "Appeal on point of law (42 days from written reasons)", &["Draft Notice of Appeal", "Identify error of law", "File with EAT"], None),
        s("EAT_SIFT", "EAT Sift", "EAT", "Registrar/judge reviews on paper", &["Await sift decision", "Prepare for Rule 3(10) if needed"], None),
        s("EAT_RULE3_10", "Rule 3(10) Hearing", "EAT", "Oral hearing to argue appeal should proceed", &["Prepare oral submissions", "Attend hearing"], None),
        s("EAT_FULL_HEARING", "EAT Full Hearing", "EAT", "Full appeal hearing", &["Prepare skeleton", "Compile authorities", "Attend hearing"], None),
        s("COA_PERMISSION", "Court of Appeal Permission", "CoA", "Application for permission to appeal", &["Draft grounds", "Permission application"], None),
        s("COA_HEARING", "Court of Appeal Hearing", "CoA", "Full hearing before CoA", &["Instruct counsel (recommended)", "Prepare skeleton", "Attend hearing"], None),
    ]
}

/// `GET /api/roadmap/{caseId}` body.
pub fn roadmap_for_case(case_id: &str) -> Value {
    json!({
        "case_id": case_id,
        "stages": roadmap_stages(),
        "current_stage": "PRE_ACTION",
        "note": "Stage tracking requires Temporal.io integration (Phase 4). Currently showing full roadmap template.",
    })
}

/// `POST /api/roadmap` timeline (the JSON array of one `TimelineStage`).
/// `now_ms` is the current instant; a step is `overdue` when now > deadline.
pub fn timeline(config: &TimeLimitConfig, today: &CivilDate, now_ms: i64, date_of_last_act: &str, claim_type: Option<&str>) -> Result<Value, DeadlineError> {
    let ct = match claim_type {
        Some(c) if !c.is_empty() => c,
        _ => "unfair_dismissal",
    };
    let res = calculate_deadline(config, today, date_of_last_act, None, None, Some(ct))?;
    let statutory = CivilDate::parse_utc(&res.final_deadline).ok_or_else(|| DeadlineError::InvalidCalendar(res.final_deadline.clone()))?;
    let deadline_iso = statutory.to_iso_datetime();
    let status = if now_ms > statutory.epoch_ms() { "overdue" } else { "upcoming" };
    Ok(json!([{
        "level": "Employment Tribunal",
        "abbrev": "ET",
        "color": "#8B5CF6",
        "steps": [
            {
                "label": "ACAS Early Conciliation",
                "deadline": deadline_iso,
                "description": format!("You must notify ACAS and start Early Conciliation before the time limit expires. Starting EC pauses the clock and can extend the ET1 deadline. Regime: {}.", res.regime.as_str()),
                "status": status,
                "critical": true,
            },
            {
                "label": "ET1 Claim Form",
                "deadline": deadline_iso,
                "description": "Present your ET1 by the statutory time limit shown. If you complete ACAS Early Conciliation, the deadline may be extended under the s.207B rules — use the deadline calculator with your actual ACAS dates for the exact extended date.",
                "status": status,
                "critical": true,
            },
            {
                "label": "Case Management Preliminary Hearing",
                "deadline": null,
                "description": "Illustrative only — not a deadline. After your claim is accepted, the tribunal sets directions (disclosure, witness statements, hearing dates), usually a few months after filing.",
                "status": "future",
                "critical": false,
            }
        ]
    }]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sixteen_stages_in_fsm_order() {
        let ids: Vec<String> = roadmap_stages().iter().map(|s| s["id"].as_str().unwrap().to_string()).collect();
        assert_eq!(ids, crate::constants::FSM_STATES.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        let t = timeline(&TimeLimitConfig::default(), &CivilDate::new(2026, 9, 23), CivilDate::new(2026, 9, 23).epoch_ms(), "2025-06-16", Some("unfair_dismissal")).unwrap();
        assert_eq!(t[0]["steps"][0]["deadline"], t[0]["steps"][1]["deadline"]);
        assert_eq!(t[0]["steps"][0]["deadline"], "2025-09-15T00:00:00.000Z");
        assert!(t[0]["steps"][2]["deadline"].is_null());
    }
}
