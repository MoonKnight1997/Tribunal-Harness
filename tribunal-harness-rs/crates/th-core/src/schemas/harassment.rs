use crate::constants::{format_commencement_month, ERA_2025};
use crate::types::*;

pub fn schema() -> ClaimSchema {
    ClaimSchema {
        id: "harassment",
        label: "Harassment",
        statute: "EA 2010 s26",
        description: "Unwanted conduct related to a protected characteristic that has the purpose or effect of violating dignity or creating an intimidating, hostile, degrading, humiliating or offensive environment.",
        legal_test: vec![
            "Was there unwanted conduct?".into(),
            "Was the conduct related to a protected characteristic?".into(),
            "Did the conduct have the purpose or effect of violating dignity or creating an intimidating/hostile/degrading/humiliating/offensive environment?".into(),
            "In assessing effect: was it reasonable for the conduct to have that effect? (perception, circumstances, reasonableness)".into(),
        ],
        key_authorities: vec![
            "Pemberton v Inwood [2018] ICR 1291".into(),
            "Richmond Pharmacology v Dhaliwal [2009] ICR 724".into(),
            "Land Registry v Grant [2011] ICR 1390".into(),
        ],
        era2025_changes: Some(vec![
            format!(
                "Employer duty changes from \"reasonable steps\" to \"all reasonable steps\" (from {})",
                format_commencement_month(ERA_2025.harassment_all_reasonable_steps)
            ),
            format!(
                "Third-party harassment liability introduced (from {})",
                format_commencement_month(ERA_2025.third_party_harassment)
            ),
            format!(
                "NDAs preventing disclosure of harassment/discrimination are void (from {})",
                format_commencement_month(ERA_2025.nda_void)
            ),
            format!(
                "Sexual harassment becomes qualifying disclosure for whistleblowing (from {})",
                format_commencement_month(ERA_2025.sexual_harassment_whistleblowing)
            ),
        ]),
        fields: vec![
            SchemaField::new("protected_characteristic", "Protected Characteristic", FieldType::Select, true).options(vec![
                opt("age", "Age"),
                opt("disability", "Disability"),
                opt("gender_reassignment", "Gender reassignment"),
                opt("race", "Race"),
                opt("religion", "Religion or belief"),
                opt("sex", "Sex"),
                opt("sexual_orientation", "Sexual orientation"),
                opt("pregnancy", "Pregnancy and maternity"),
                opt("marriage", "Marriage and civil partnership"),
            ]),
            SchemaField::new("unwanted_conduct", "Description of Unwanted Conduct", FieldType::Textarea, true),
            SchemaField::new("date_of_last_act", "Date of Last Act", FieldType::Date, true),
            SchemaField::new("purpose_or_effect", "Purpose or Effect?", FieldType::Select, true).options(vec![
                opt("purpose", "Purpose — intended to harass"),
                opt("effect", "Effect — had harassing effect regardless of intent"),
                opt("both", "Both purpose and effect"),
            ]),
            SchemaField::new("third_party_harassment", "Third-Party Harassment", FieldType::Boolean, false)
                .help("Was the harassment committed by a third party (customer, client, contractor)?")
                .era2025(Era2025Annotation {
                    is_new: true,
                    changed_from: None,
                    commencement_date: ERA_2025.third_party_harassment.into(),
                    status: AnnotationStatus::Upcoming,
                    note: format!(
                        "Employers liable for third-party harassment unless 'all reasonable steps' taken. From {}.",
                        format_commencement_month(ERA_2025.third_party_harassment)
                    ),
                }),
            SchemaField::new("employer_steps", "Employer Prevention Steps", FieldType::Select, false)
                .options(vec![
                    opt("none", "No steps taken"),
                    opt("some", "Some steps — policy exists but not enforced"),
                    opt("reasonable", "Reasonable steps taken"),
                    opt("all_reasonable", "All reasonable steps taken"),
                ])
                .era2025(Era2025Annotation {
                    is_new: false,
                    changed_from: Some("\"reasonable steps\" defence".into()),
                    commencement_date: ERA_2025.harassment_all_reasonable_steps.into(),
                    status: AnnotationStatus::Upcoming,
                    note: format!(
                        "Standard rises to \"all reasonable steps\" from {}.",
                        format_commencement_month(ERA_2025.harassment_all_reasonable_steps)
                    ),
                }),
            SchemaField::new("nda_clause", "NDA / Confidentiality Clause", FieldType::Boolean, false)
                .help("Does any agreement prevent you from speaking about the harassment?")
                .era2025(Era2025Annotation {
                    is_new: true,
                    changed_from: None,
                    commencement_date: ERA_2025.nda_void.into(),
                    status: AnnotationStatus::Upcoming,
                    note: format!(
                        "Any NDA preventing disclosure of harassment/discrimination is void from {}.",
                        format_commencement_month(ERA_2025.nda_void)
                    ),
                }),
            SchemaField::new("narrative", "Full Account", FieldType::Textarea, false),
        ],
    }
}
