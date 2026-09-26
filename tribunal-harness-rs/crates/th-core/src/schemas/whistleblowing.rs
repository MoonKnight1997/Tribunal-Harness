use crate::constants::{format_commencement_month, ERA_2025};
use crate::types::*;

pub fn schema() -> ClaimSchema {
    ClaimSchema {
        id: "whistleblowing",
        label: "Whistleblowing Detriment / Dismissal",
        statute: "ERA 1996 Part IVA",
        description: "Protection for workers who make qualifying disclosures in the public interest.",
        legal_test: vec![
            "Was there a disclosure of information (not just an allegation)?".into(),
            "Did the disclosure tend to show one of the six categories of wrongdoing?".into(),
            "Was the disclosure made in the public interest?".into(),
            "Was the disclosure made to an appropriate person?".into(),
            "Did the worker suffer a detriment or dismissal because of the disclosure?".into(),
        ],
        key_authorities: vec![
            "Cavendish Munro v Geduld [2010] ICR 325".into(),
            "Chesterton Global v Nurmohamed [2017] ICR 920".into(),
            "Kilraine v London Borough of Wandsworth [2018] ICR 1850".into(),
            "Babula v Waltham Forest College [2007] ICR 1026".into(),
        ],
        era2025_changes: Some(vec![format!(
            "Sexual harassment disclosures are now a qualifying disclosure category (from {})",
            format_commencement_month(ERA_2025.sexual_harassment_whistleblowing)
        )]),
        fields: vec![
            SchemaField::new("disclosure_type", "Category of Qualifying Disclosure", FieldType::Select, true).options(vec![
                opt("criminal_offence", "Criminal offence"),
                opt("legal_obligation", "Failure to comply with legal obligation"),
                opt("miscarriage_justice", "Miscarriage of justice"),
                opt("health_safety", "Danger to health and safety"),
                opt("environmental", "Damage to the environment"),
                opt("concealment", "Deliberate concealment of any of the above"),
                opt("sexual_harassment", "Sexual harassment (ERA 2025)"),
            ]),
            SchemaField::new("sexual_harassment_disclosure", "Sexual Harassment Disclosure", FieldType::Boolean, false)
                .help("Does the disclosure relate to sexual harassment?")
                .era2025(Era2025Annotation {
                    is_new: true,
                    changed_from: None,
                    commencement_date: ERA_2025.sexual_harassment_whistleblowing.into(),
                    status: AnnotationStatus::InForce,
                    note: format!(
                        "Sexual harassment is now a separate qualifying disclosure from {}. Creates dual-track claim possibility.",
                        format_commencement_month(ERA_2025.sexual_harassment_whistleblowing)
                    ),
                }),
            SchemaField::new("disclosure_date", "Date of Disclosure", FieldType::Date, true),
            SchemaField::new("disclosure_recipient", "Who Was the Disclosure Made To?", FieldType::Select, true).options(vec![
                opt("employer", "Employer"),
                opt("legal_adviser", "Legal adviser"),
                opt("prescribed_person", "Prescribed person / regulator"),
                opt("other", "Other (wider disclosure)"),
            ]),
            SchemaField::new("public_interest", "Public Interest Element", FieldType::Textarea, true).help("Explain why this disclosure was in the public interest."),
            SchemaField::new("detriment_or_dismissal", "Detriment or Dismissal", FieldType::Select, true).options(vec![
                opt("detriment", "Subjected to detriment"),
                opt("dismissal", "Dismissed"),
                opt("both", "Both detriment and dismissal"),
            ]),
            SchemaField::new("narrative", "Full Account", FieldType::Textarea, false),
        ],
    }
}
