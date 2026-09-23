use crate::types::*;

pub fn schema() -> ClaimSchema {
    ClaimSchema {
        id: "direct_discrimination",
        label: "Direct Discrimination",
        statute: "EA 2010 s13",
        description: "Less favourable treatment because of a protected characteristic.",
        legal_test: vec![
            "Does the claimant have/is perceived to have/is associated with a protected characteristic?".into(),
            "Was the claimant treated less favourably than an actual or hypothetical comparator?".into(),
            "Was the less favourable treatment because of the protected characteristic?".into(),
        ],
        key_authorities: vec![
            "Igen Ltd v Wong [2005] ICR 931".into(),
            "Madarassy v Nomura [2007] ICR 867".into(),
            "Nagarajan v London Regional Transport [2000] 1 AC 501".into(),
            "Shamoon v Chief Constable of the RUC [2003] ICR 337".into(),
        ],
        era2025_changes: None,
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
            SchemaField::new("comparator_type", "Comparator", FieldType::Select, true).options(vec![
                opt("actual", "Actual comparator (named individual)"),
                opt("hypothetical", "Hypothetical comparator"),
            ]),
            SchemaField::new("comparator_details", "Comparator Details", FieldType::Textarea, false),
            SchemaField::new("less_favourable_treatment", "Less Favourable Treatment", FieldType::Textarea, true),
            SchemaField::new("date_of_last_act", "Date of Last Act", FieldType::Date, true),
            SchemaField::new("continuing_act", "Continuing Act / Course of Conduct", FieldType::Boolean, false)
                .help("Was this part of a continuing course of conduct (EA 2010 s123(3)(a))?"),
            SchemaField::new("narrative", "Full Account", FieldType::Textarea, false),
        ],
    }
}
