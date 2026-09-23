use crate::constants::{format_commencement_date, format_commencement_month, ERA_2025};
use crate::types::*;

pub fn schema() -> ClaimSchema {
    ClaimSchema {
        id: "fire_and_rehire",
        label: "Fire and Rehire",
        statute: "ERA 2025",
        description: "Automatically unfair dismissal where an employer dismisses an employee to impose changes to restricted contractual terms.",
        legal_test: vec![
            "Was the employee dismissed?".into(),
            "Was the purpose of the dismissal to impose a variation to a restricted term?".into(),
            "Is the restricted term one of: pay, hours, pensions, holidays, or shift patterns?".into(),
            "Does the employer claim severe financial distress?".into(),
            "Were there no reasonable alternatives to dismissal?".into(),
        ],
        key_authorities: vec!["This is a new statutory provision — case law will develop from 2027".into()],
        era2025_changes: Some(vec![
            format!(
                "Entirely new claim type created by ERA 2025 (from {})",
                format_commencement_month(ERA_2025.fire_and_rehire_auto_unfair)
            ),
            "Dismissals to impose restricted variations are automatically unfair".into(),
            "Limited defence: employer must prove severe financial distress AND no alternative".into(),
        ]),
        fields: vec![
            SchemaField::new("effective_date_of_termination", "Date of Dismissal", FieldType::Date, true).era2025(Era2025Annotation {
                is_new: true,
                changed_from: None,
                commencement_date: ERA_2025.fire_and_rehire_auto_unfair.into(),
                status: AnnotationStatus::Upcoming,
                note: format!(
                    "This claim type is only available for dismissals on or after {}.",
                    format_commencement_date(ERA_2025.fire_and_rehire_auto_unfair)
                ),
            }),
            SchemaField::new("restricted_variation", "Which Restricted Term Was Changed?", FieldType::Select, true).options(vec![
                opt("pay", "Pay"),
                opt("hours", "Hours"),
                opt("pensions", "Pensions"),
                opt("holidays", "Holidays"),
                opt("shift_patterns", "Shift patterns"),
                opt("multiple", "Multiple terms"),
            ]),
            SchemaField::new("offered_new_contract", "Were You Offered New Terms?", FieldType::Boolean, true),
            SchemaField::new("financial_distress_defence", "Employer Claims Financial Distress?", FieldType::Boolean, false)
                .help("The employer must demonstrate severe financial distress to rely on this defence."),
            SchemaField::new("no_alternative_defence", "Employer Claims No Alternative?", FieldType::Boolean, false),
            SchemaField::new("fire_and_replace", "Replaced with Contractor/Agency Worker?", FieldType::Boolean, false)
                .help("Were you replaced with a contractor or agency worker doing the same role?"),
            SchemaField::new("narrative", "Full Account", FieldType::Textarea, false),
        ],
    }
}
