use crate::types::*;

pub fn schema() -> ClaimSchema {
    ClaimSchema {
        id: "indirect_discrimination",
        label: "Indirect Discrimination",
        statute: "EA 2010 s19",
        description: "A provision, criterion or practice (PCP) that puts persons sharing a protected characteristic at a particular disadvantage.",
        legal_test: vec![
            "Did the employer apply a PCP?".into(),
            "Does the PCP put persons sharing the claimant's protected characteristic at a particular disadvantage compared to those who do not share it?".into(),
            "Does the PCP put the claimant at that disadvantage?".into(),
            "Can the employer show the PCP is a proportionate means of achieving a legitimate aim?".into(),
        ],
        key_authorities: vec![
            "Essop v Home Office [2017] UKSC 27".into(),
            "Homer v Chief Constable of West Yorkshire [2012] ICR 704".into(),
            "Bilka-Kaufhaus v Weber von Hartz [1987] ICR 110".into(),
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
                opt("marriage", "Marriage and civil partnership"),
            ]),
            SchemaField::new("pcp", "Provision, Criterion or Practice (PCP)", FieldType::Textarea, true),
            SchemaField::new("group_disadvantage", "How Does the PCP Disadvantage the Group?", FieldType::Textarea, true),
            SchemaField::new("individual_disadvantage", "How Are You Personally Disadvantaged?", FieldType::Textarea, true),
            SchemaField::new("date_of_last_act", "Date of Last Act", FieldType::Date, true),
            SchemaField::new("narrative", "Full Account", FieldType::Textarea, false),
        ],
    }
}
