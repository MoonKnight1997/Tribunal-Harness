//! Schema registry — provides access to all 10 claim type schemas.
//! Port of `src/schemas/index.ts` and the ten per-claim files.

use crate::types::ClaimSchema;
use std::sync::LazyLock;

pub mod direct_discrimination;
pub mod fire_and_rehire;
pub mod harassment;
pub mod indirect_discrimination;
pub mod reasonable_adjustments;
pub mod unfair_dismissal;
pub mod victimisation;
pub mod whistleblowing;
pub mod wrongful_dismissal;
pub mod zero_hours_rights;

/// Registry order = `CLAIM_TYPES` order (the TypeScript `SCHEMAS` object).
pub static SCHEMAS: LazyLock<Vec<ClaimSchema>> = LazyLock::new(|| {
    vec![
        unfair_dismissal::schema(),
        direct_discrimination::schema(),
        indirect_discrimination::schema(),
        harassment::schema(),
        victimisation::schema(),
        reasonable_adjustments::schema(),
        whistleblowing::schema(),
        wrongful_dismissal::schema(),
        fire_and_rehire::schema(),
        zero_hours_rights::schema(),
    ]
});

/// `getSchema(claimTypeId)` — `None` for an unknown id (case-sensitive).
pub fn get_schema(claim_type_id: &str) -> Option<&'static ClaimSchema> {
    SCHEMAS.iter().find(|s| s.id == claim_type_id)
}

/// `getAllSchemas()`.
pub fn get_all_schemas() -> &'static [ClaimSchema] {
    &SCHEMAS
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::CLAIM_TYPES;

    #[test]
    fn exposes_exactly_ten_schemas_matching_claim_types() {
        assert_eq!(get_all_schemas().len(), 10);
        assert!(get_schema("made_up").is_none());
        for ct in CLAIM_TYPES.iter() {
            let s = get_schema(ct.id).expect(ct.id);
            assert_eq!(s.id, ct.id);
            assert!(!s.statute.is_empty());
            assert!(!s.legal_test.is_empty());
            assert!(!s.key_authorities.is_empty());
            let mut ids: Vec<&str> = s.fields.iter().map(|f| f.id).collect();
            let n = ids.len();
            ids.sort();
            ids.dedup();
            assert_eq!(ids.len(), n, "unique field ids for {}", ct.id);
        }
    }
}
