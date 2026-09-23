use crate::constants::ERA_2025;
use crate::types::*;

pub fn schema() -> ClaimSchema {
    ClaimSchema {
        id: "zero_hours_rights",
        label: "Zero-Hours Contract Rights",
        statute: "ERA 2025",
        description: "New rights for zero-hours and low-hours workers to guaranteed hours, shift notice, and cancellation payment.",
        legal_test: vec![
            "Is the worker on a zero-hours or low-hours contract?".into(),
            "Has the relevant reference period been met? (Its exact length is to be confirmed by Statutory Instrument.)".into(),
            "Was the worker denied guaranteed hours reflecting regular hours worked?".into(),
            "Was reasonable notice of shifts provided?".into(),
            "Was compensation paid for short-notice cancellation?".into(),
        ],
        key_authorities: vec!["This is a new statutory provision — case law will develop from 2027".into()],
        era2025_changes: Some(vec![
            "Entirely new set of rights created by ERA 2025 (from 2027)".into(),
            "Rights extend to agency workers".into(),
        ]),
        fields: vec![
            SchemaField::new("contract_type", "Contract Type", FieldType::Select, true)
                .options(vec![
                    opt("zero_hours", "Zero-hours contract"),
                    opt("low_hours", "Low-hours contract"),
                    opt("agency", "Agency worker"),
                ])
                .era2025(Era2025Annotation {
                    is_new: true,
                    changed_from: None,
                    commencement_date: ERA_2025.zero_hours_protections.unwrap_or("TBC (SI awaited)").into(),
                    status: AnnotationStatus::AwaitingSi,
                    note: "Exact commencement date to be confirmed by Statutory Instrument.".into(),
                }),
            SchemaField::new("regular_hours", "Regular Hours Worked (per week)", FieldType::Number, true)
                .help("Average hours worked over the relevant reference period (its length is to be confirmed by Statutory Instrument)."),
            SchemaField::new("guaranteed_hours_offered", "Were Guaranteed Hours Offered?", FieldType::Boolean, true),
            SchemaField::new("shift_notice", "Was Reasonable Shift Notice Given?", FieldType::Boolean, true),
            SchemaField::new("cancellation_payment", "Was Cancellation Payment Made?", FieldType::Boolean, false)
                .help("Payment for shifts cancelled at short notice."),
            SchemaField::new("narrative", "Full Account", FieldType::Textarea, false),
        ],
    }
}
