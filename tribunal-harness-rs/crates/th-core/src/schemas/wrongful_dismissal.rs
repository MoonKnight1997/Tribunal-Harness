use crate::types::*;

pub fn schema() -> ClaimSchema {
    ClaimSchema {
        id: "wrongful_dismissal",
        label: "Wrongful Dismissal",
        statute: "Common Law",
        description: "A breach of contract claim where the employer dismissed without giving proper contractual or statutory notice.",
        legal_test: vec![
            "Was there a contract of employment?".into(),
            "Was the employee dismissed?".into(),
            "Was the dismissal in breach of the contract (e.g., insufficient notice)?".into(),
            "Did the employee's conduct justify summary dismissal (gross misconduct defence)?".into(),
        ],
        key_authorities: vec![
            "Geys v Société Générale [2013] 1 AC 523".into(),
            "Gunton v Richmond-upon-Thames LBC [1981] Ch 448".into(),
            "Laws v London Chronicle [1959] 1 WLR 698".into(),
        ],
        era2025_changes: None,
        fields: vec![
            SchemaField::new("contractual_notice", "Contractual Notice Period", FieldType::Text, true).help("e.g., '3 months', '1 week per year of service'"),
            SchemaField::new("notice_given", "Notice Actually Given", FieldType::Text, true),
            SchemaField::new("summary_dismissal", "Was It Summary Dismissal (No Notice)?", FieldType::Boolean, true),
            SchemaField::new("gross_misconduct_alleged", "Gross Misconduct Alleged?", FieldType::Boolean, false),
            SchemaField::new("effective_date_of_termination", "Date of Dismissal", FieldType::Date, true),
            SchemaField::new("pay_in_lieu", "Was Payment in Lieu of Notice (PILON) Made?", FieldType::Boolean, false),
            SchemaField::new("narrative", "Full Account", FieldType::Textarea, false),
        ],
    }
}
