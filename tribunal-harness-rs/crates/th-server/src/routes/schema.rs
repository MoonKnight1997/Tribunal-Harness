//! `GET /api/schema/[claimType]` — the full JSON schema for a claim type.

use super::json_response;
use axum::extract::Path;
use axum::response::Response;
use serde_json::json;
use th_core::schemas::get_schema;

const AVAILABLE_TYPES: [&str; 10] = [
    "unfair_dismissal",
    "direct_discrimination",
    "indirect_discrimination",
    "harassment",
    "victimisation",
    "reasonable_adjustments",
    "whistleblowing",
    "wrongful_dismissal",
    "fire_and_rehire",
    "zero_hours_rights",
];

pub fn schema_response(claim_type: &str) -> Response {
    match get_schema(claim_type) {
        Some(schema) => json_response(200, serde_json::to_value(schema).unwrap_or_default()),
        None => json_response(404, json!({ "error": format!("Unknown claim type: {claim_type}"), "available_types": AVAILABLE_TYPES })),
    }
}

pub async fn get_schema_route(Path(claim_type): Path<String>) -> Response {
    schema_response(&claim_type)
}

/// `/api/schema` and `/api/schema/` — an empty claim type.
pub async fn get_schema_empty() -> Response {
    schema_response("")
}
