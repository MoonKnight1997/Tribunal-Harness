use crate::types::*;

pub fn schema() -> ClaimSchema {
    ClaimSchema {
        id: "victimisation",
        label: "Victimisation",
        statute: "EA 2010 s27",
        description: "Subjecting a person to a detriment because they have done, or may do, a protected act.",
        legal_test: vec![
            "Did the claimant do a protected act (or did the employer believe they had/might)?".into(),
            "Was the claimant subjected to a detriment?".into(),
            "Was the detriment because of the protected act?".into(),
        ],
        key_authorities: vec![
            "Derbyshire v St Helens Metropolitan Borough Council [2007] ICR 841".into(),
            "Woodhouse v West North West Homes Leeds Ltd [2013] IRLR 773".into(),
        ],
        era2025_changes: None,
        fields: vec![
            SchemaField::new("protected_act", "Protected Act", FieldType::Select, true).options(vec![
                opt("proceedings", "Bringing proceedings under the EA 2010"),
                opt("evidence", "Giving evidence or information in connection with proceedings"),
                opt("allegation", "Making an allegation of discrimination"),
                opt("anything_else", "Doing anything else for purposes of the EA 2010"),
            ]),
            SchemaField::new("protected_act_details", "Details of Protected Act", FieldType::Textarea, true),
            SchemaField::new("detriment", "Detriment Suffered", FieldType::Textarea, true),
            SchemaField::new("date_of_detriment", "Date of Detriment", FieldType::Date, true),
            SchemaField::new("narrative", "Full Account", FieldType::Textarea, false),
        ],
    }
}
