use crate::constants::{format_commencement_date, format_commencement_month, ERA_2025};
use crate::types::*;

pub fn schema() -> ClaimSchema {
    let qp_month = format_commencement_month(ERA_2025.qualifying_period_6_months);
    ClaimSchema {
        id: "unfair_dismissal",
        label: "Unfair Dismissal",
        statute: "ERA 1996 s98",
        description: "A claim that an employer dismissed an employee without a fair reason or without following a fair procedure.",
        legal_test: vec![
            "Was the claimant an employee?".into(),
            "Was the claimant dismissed (s95)?".into(),
            "Does the claimant have sufficient qualifying service?".into(),
            "Has the employer shown a potentially fair reason (s98(1)-(2))?".into(),
            "Did the employer act reasonably in treating that reason as sufficient (s98(4))?".into(),
        ],
        key_authorities: vec![
            "Polkey v AE Dayton Services [1988] ICR 142".into(),
            "Iceland Frozen Foods v Jones [1983] ICR 17".into(),
            "BHS v Burchell [1980] ICR 303".into(),
            "Western Excavating v Sharp [1978] ICR 221".into(),
        ],
        era2025_changes: Some(vec![
            format!("Qualifying period reduces from 2 years to 6 months (from {})", qp_month),
            format!(
                "Compensatory award cap removed entirely (from {})",
                format_commencement_month(ERA_2025.compensatory_award_uncapped)
            ),
            format!(
                "Fire and rehire dismissals automatically unfair (from {})",
                format_commencement_month(ERA_2025.fire_and_rehire_auto_unfair)
            ),
            format!(
                "Industrial action dismissals automatically unfair with no 12-week limit (from {}, in force)",
                format_commencement_month(ERA_2025.industrial_action_dismissal)
            ),
        ]),
        fields: vec![
            SchemaField::new("employee_status", "Employment Status", FieldType::Select, true).options(vec![
                opt("employee", "Employee"),
                opt("worker", "Worker"),
                opt("self_employed", "Self-employed"),
                opt("uncertain", "Uncertain / Disputed"),
            ]),
            SchemaField::new("start_date", "Employment Start Date", FieldType::Date, true)
                .help("The date you started continuous employment."),
            SchemaField::new("effective_date_of_termination", "Effective Date of Termination (EDT)", FieldType::Date, true)
                .help("The date your employment ended — last day of notice, or date of summary dismissal."),
            SchemaField::new("qualifying_service", "Qualifying Service Met", FieldType::Boolean, false)
                .help(format!("Auto-calculated: Pre-{qp_month} = 2 years; Post-{qp_month} = 6 months."))
                .era2025(Era2025Annotation {
                    is_new: false,
                    changed_from: Some("2 years continuous employment".into()),
                    commencement_date: ERA_2025.qualifying_period_6_months.into(),
                    status: AnnotationStatus::Upcoming,
                    note: format!(
                        "Reduces to 6 months from {}.",
                        format_commencement_date(ERA_2025.qualifying_period_6_months)
                    ),
                }),
            SchemaField::new("dismissal_reason", "Reason Given for Dismissal", FieldType::Select, true).options(vec![
                opt("capability", "Capability / Performance"),
                opt("conduct", "Conduct"),
                opt("redundancy", "Redundancy"),
                opt("statutory_bar", "Statutory Restriction"),
                opt("sosr", "Some Other Substantial Reason (SOSR)"),
                opt("none_given", "No reason given"),
                opt("constructive", "Constructive dismissal"),
                opt("fire_and_rehire", "Fire and rehire (ERA 2025 — auto unfair)"),
            ]),
            SchemaField::new("automatically_unfair", "Automatically Unfair Ground", FieldType::Select, false)
                .options(vec![
                    opt("none", "None / Not applicable"),
                    opt("whistleblowing", "Whistleblowing"),
                    opt("pregnancy", "Pregnancy / Maternity"),
                    opt("trade_union", "Trade union membership / activity"),
                    opt("health_safety", "Health and safety"),
                    opt("statutory_right", "Assertion of statutory right"),
                    opt("tupe", "TUPE"),
                    opt("industrial_action", "Industrial action (ERA 2025 — no 12-week limit)"),
                    SelectOption {
                        value: "fire_and_rehire",
                        label: leak(format!(
                            "Fire and rehire (ERA 2025 — from {})",
                            format_commencement_month(ERA_2025.fire_and_rehire_auto_unfair)
                        )),
                    },
                    SelectOption {
                        value: "fire_and_replace",
                        label: leak(format!(
                            "Fire and replace (ERA 2025 — from {})",
                            format_commencement_month(ERA_2025.fire_and_rehire_auto_unfair)
                        )),
                    },
                ])
                .era2025(Era2025Annotation {
                    is_new: false,
                    changed_from: Some("Industrial action had 12-week protected period".into()),
                    commencement_date: ERA_2025.industrial_action_dismissal.into(),
                    status: AnnotationStatus::InForce,
                    note: format!(
                        "Industrial action dismissal now automatically unfair. Fire and rehire/replace added from {}.",
                        format_commencement_month(ERA_2025.fire_and_rehire_auto_unfair)
                    ),
                }),
            SchemaField::new("procedure_followed", "Was a Fair Procedure Followed?", FieldType::Select, true).options(vec![
                opt("yes", "Yes — full ACAS Code procedure"),
                opt("partial", "Partial — some steps missed"),
                opt("no", "No — no procedure at all"),
                opt("unknown", "Unknown / Need to review"),
            ]),
            SchemaField::new("compensatory_award_cap", "Compensatory Award Cap Applies", FieldType::Boolean, false)
                .help("Auto-calculated based on EDT.")
                .era2025(Era2025Annotation {
                    is_new: false,
                    changed_from: Some("Capped at lower of 1 year's pay or statutory maximum (£115,115)".into()),
                    commencement_date: ERA_2025.compensatory_award_uncapped.into(),
                    status: AnnotationStatus::Upcoming,
                    note: format!(
                        "Cap removed entirely from {}.",
                        format_commencement_date(ERA_2025.compensatory_award_uncapped)
                    ),
                }),
            SchemaField::new("narrative", "Describe What Happened", FieldType::Textarea, false)
                .help("Provide a chronological account of the events."),
        ],
    }
}

/// Option labels are `&'static str`; the two ERA-dated labels are computed once
/// and leaked (the schema is built once into a `LazyLock`).
pub(crate) fn leak(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}
