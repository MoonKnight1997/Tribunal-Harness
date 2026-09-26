use crate::types::*;

pub fn schema() -> ClaimSchema {
    ClaimSchema {
        id: "reasonable_adjustments",
        label: "Failure to Make Reasonable Adjustments",
        statute: "EA 2010 ss20-21",
        description: "An employer's failure to make reasonable adjustments for a disabled employee where a PCP, physical feature, or lack of auxiliary aid puts them at a substantial disadvantage.",
        legal_test: vec![
            "Is the claimant a disabled person within the meaning of EA 2010 s6?".into(),
            "Did a PCP / physical feature / lack of auxiliary aid put the claimant at a substantial disadvantage compared to non-disabled persons?".into(),
            "Did the employer know, or ought they reasonably to have known, about the disability and the disadvantage?".into(),
            "Were there steps that were reasonable for the employer to take to avoid the disadvantage?".into(),
            "Did the employer fail to take those steps?".into(),
        ],
        key_authorities: vec![
            "Environment Agency v Rowan [2008] ICR 218".into(),
            "Archibald v Fife Council [2004] ICR 954".into(),
            "Smith v Churchills Stairlifts Plc [2006] ICR 524".into(),
        ],
        era2025_changes: None,
        fields: vec![
            SchemaField::new("disability", "Disability / Condition", FieldType::Text, true),
            SchemaField::new("employer_knowledge", "Did the Employer Know About Your Disability?", FieldType::Select, true).options(vec![
                opt("actual", "Yes — informed employer directly"),
                opt("constructive", "Should have known — obvious signs / medical evidence"),
                opt("denied", "Employer denies knowledge"),
            ]),
            SchemaField::new("disadvantage_type", "Source of Disadvantage", FieldType::Select, true).options(vec![
                opt("pcp", "Provision, criterion or practice"),
                opt("physical", "Physical feature of premises"),
                opt("auxiliary", "Lack of auxiliary aid"),
            ]),
            SchemaField::new("disadvantage_details", "Describe the Substantial Disadvantage", FieldType::Textarea, true),
            SchemaField::new("adjustments_requested", "Adjustments Requested", FieldType::Textarea, true),
            SchemaField::new("adjustments_provided", "Adjustments Actually Provided", FieldType::Textarea, false),
            SchemaField::new("date_of_last_act", "Date of Last Failure to Adjust", FieldType::Date, true),
            SchemaField::new("narrative", "Full Account", FieldType::Textarea, false),
        ],
    }
}
