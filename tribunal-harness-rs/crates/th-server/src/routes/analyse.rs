//! `POST /api/analyse` — the main analysis endpoint: consent gate, schema
//! lookup, Claude call (Sonnet, or Opus for `complexity: "high"`), epistemic
//! quarantine over the cited authorities, canonical contract normalisation,
//! refinement pass.

use super::{client_key, error_json, internal_error, json_response, llm_unavailable_marker, parse_json_body};
use crate::jsval::{js_trim, object_keys_len, template, template_or_undefined, truthy, utf16_len};
use crate::state::SharedState;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use th_core::analyse_contract::normalise_analyse_response;
use th_core::citation_validator::extract_neutral_citation;
use th_core::constants::{format_commencement_month, is_commencement_tbc, ERA_2025, ERA_2025_ENTRIES};
use th_core::dates::{iso_datetime_from_epoch_ms, CivilDate};
use th_core::find_case_law::normalise_citation;
use th_core::prompts::{versions, ANALYSE_PROMPT_V2};
use th_core::refinement::RefineEndpoint;
use th_core::schemas::get_schema;
use th_core::types::{ClaimSchema, TrustLevel};
use th_services::citation_authority::validate_all_citations_authoritative;
use th_services::claude_client::{CallClaudeParams, ClaudeCallResult};
use th_services::refinement::refine_for_user;

// F-28: hard cap on narrative length.
const MAX_NARRATIVE_CHARS: usize = 50000;

/// F-26: derive a real ERA-flag status for a degraded-mode change string by
/// reverse-mapping its `formatCommencementMonth` label to the ERA_2025 key.
pub fn derive_degraded_flag_status(change: &str, now_ms: i64) -> (&'static str, String) {
    for (key, iso) in ERA_2025_ENTRIES.iter() {
        let Some(iso) = iso else { continue };
        let label = format_commencement_month(iso);
        if !change.contains(&label) {
            continue;
        }
        let commenced = CivilDate::parse_utc(iso).map(|d| d.epoch_ms() <= now_ms).unwrap_or(false);
        let status = if commenced {
            "in_force"
        } else if is_commencement_tbc(key) {
            "tbc"
        } else {
            "upcoming"
        };
        return (status, label);
    }
    // Unknown / SI-awaited date → preserve the uncertainty as tbc (Hard Rule 6).
    ("tbc", "See implementation tracker".to_string())
}

fn build_user_message(body: &Value, schema: &ClaimSchema, today: &CivilDate) -> String {
    let mut parts = vec![
        format!("Claim type: {}", template_or_undefined(body.get("claim_type"))),
        format!("Mode: {}", template_or_undefined(body.get("mode"))),
        format!("Schema: {} ({})", schema.label, schema.statute),
    ];
    let narrative = body.get("narrative_text");
    if truthy(narrative) {
        parts.push(format!("\nNarrative:\n{}", template(narrative.unwrap())));
    }
    for (key, label) in [("key_dates", "Key dates"), ("schema_fields", "Schema fields")] {
        if let Some(v) = body.get(key) {
            if truthy(Some(v)) && object_keys_len(v) > 0 {
                parts.push(format!("\n{label}: {}", serde_json::to_string(v).unwrap_or_default()));
            }
        }
    }
    if !schema.legal_test.is_empty() {
        let numbered: Vec<String> = schema.legal_test.iter().enumerate().map(|(i, t)| format!("{}. {t}", i + 1)).collect();
        parts.push(format!("\nLegal test elements:\n{}", numbered.join("\n")));
    }
    if let Some(changes) = &schema.era2025_changes {
        if !changes.is_empty() {
            parts.push(format!("\nERA 2025 changes for this claim type:\n{}", changes.join("\n")));
        }
    }
    parts.push(format!("\nToday's date: {}", today.to_iso()));
    parts.push(format!(
        "\nERA 2025 key dates: Royal Assent {}, Time limit change {}, Qualifying period change {}",
        ERA_2025.royal_assent, ERA_2025.et_time_limit_6_months, ERA_2025.qualifying_period_6_months
    ));
    parts.join("\n")
}

fn degraded_body(schema: &ClaimSchema, now_ms: i64) -> Value {
    let mut notes = vec![json!("AI analysis requires an Anthropic API key. The schema and legal test are shown below.")];
    notes.extend(schema.legal_test.iter().enumerate().map(|(i, t)| json!(format!("{}. {t}", i + 1))));
    let flags: Vec<Value> = schema
        .era2025_changes
        .clone()
        .unwrap_or_default()
        .iter()
        .map(|change| {
            let (status, commencement_date) = derive_degraded_flag_status(change, now_ms);
            json!({
                "provision": change,
                "applies": true,
                "reason": "ERA 2025 provision relevant to this claim type",
                "commencement_date": commencement_date,
                "status": status,
            })
        })
        .collect();
    json!({
        "error": "ANTHROPIC_API_KEY not configured",
        "message": "Set the ANTHROPIC_API_KEY environment variable in .env.local to enable AI analysis.",
        "claims": [],
        "authorities": [],
        "statutory_provisions": [{ "statute": schema.statute, "section": schema.label, "relevance": schema.description }],
        "procedural_notes": notes,
        "era_2025_flags": flags,
        "refinement": llm_unavailable_marker(),
    })
}

/// Everything inside the TypeScript `try { const parsed = JSON.parse(...) … }`
/// block. `Err(())` means "fall back to the raw-text response".
async fn build_canonical_body(state: &SharedState, result: &ClaudeCallResult) -> Result<Value, ()> {
    let mut parsed: Value = serde_json::from_str(&result.content).map_err(|_| ())?;
    let mut summary: Option<Value> = None;

    if let Some(Value::Array(auths)) = parsed.get("authorities").cloned() {
        // A null / non-object entry throws in the TypeScript map → fallback.
        let mut inputs: Vec<(String, Option<String>)> = Vec::with_capacity(auths.len());
        for a in &auths {
            let rec = a.as_object().ok_or(())?;
            let citation = rec.get("citation").and_then(Value::as_str).unwrap_or("").to_string();
            let name = rec.get("name").and_then(Value::as_str).map(str::to_string);
            inputs.push((citation, name));
        }
        let (results, batch_summary) = validate_all_citations_authoritative(&state.tna, &inputs).await;

        let enriched: Vec<Value> = auths
            .iter()
            .zip(results.iter())
            .map(|(auth, vr)| {
                let mut m: Map<String, Value> = auth.as_object().cloned().unwrap_or_default();
                let original = m.get("citation").cloned();
                let citation_str = original.as_ref().and_then(Value::as_str).unwrap_or("").to_string();
                let name_str = m.get("name").map(template).unwrap_or_default();

                // T-A11 / F-43(b): compare like with like — the model's own
                // neutral citation against the verified neutral citation.
                let model_neutral = extract_neutral_citation(&citation_str);
                let verified_citation = vr.matched_citation.as_deref().unwrap_or("").trim().to_string();
                let corrected =
                    !verified_citation.is_empty() && model_neutral.as_deref().map(|mn| normalise_citation(mn) != normalise_citation(&verified_citation)).unwrap_or(false);
                let corrected_citation: Value = match (&corrected, &model_neutral) {
                    (true, Some(mn)) => {
                        if citation_str.contains(mn.as_str()) {
                            json!(citation_str.replacen(mn.as_str(), &verified_citation, 1))
                        } else {
                            json!(format!("{name_str} {verified_citation}").trim())
                        }
                    }
                    _ => original.clone().unwrap_or(Value::Null),
                };

                if original.is_some() || corrected {
                    m.insert("citation".into(), corrected_citation);
                }
                m.insert("citation_corrected".into(), json!(corrected));
                if corrected {
                    if let Some(o) = &original {
                        m.insert("original_citation".into(), o.clone());
                    }
                }
                m.insert("verified".into(), json!(vr.trust_level == TrustLevel::Verified));
                m.insert("trust_level".into(), json!(vr.trust_level));
                m.insert("validation_reason".into(), json!(vr.reason));
                set_or_remove(&mut m, "matched_case", vr.matched_name.as_ref());
                set_or_remove(&mut m, "matched_citation", vr.matched_citation.as_ref());
                set_or_remove(&mut m, "source_url", vr.url.as_ref());
                m.insert("verification_source".into(), json!(vr.source.as_str()));
                Value::Object(m)
            })
            .collect();
        parsed["authorities"] = Value::Array(enriched);
        summary = Some(serde_json::to_value(batch_summary).unwrap_or_default());
    }

    // F-9: ONE canonical contract shape. F-7: strip QUARANTINED authorities.
    let mut canonical = normalise_analyse_response(&parsed);
    let quarantined_count = canonical.authorities.iter().filter(|a| a.trust_level == Some(TrustLevel::Quarantined)).count();
    canonical.authorities.retain(|a| a.trust_level != Some(TrustLevel::Quarantined));

    let mut body = serde_json::to_value(&canonical).map_err(|_| ())?;
    let obj = body.as_object_mut().ok_or(())?;
    obj.insert("quarantined_count".into(), json!(quarantined_count));
    if let Some(s) = summary {
        obj.insert("quarantine_summary".into(), s);
    }
    if state.is_dev() {
        obj.insert("_debug".into(), serde_json::to_value(&result.debug).unwrap_or_default());
    }
    Ok(body)
}

/// `{ ...auth, key: maybeUndefined }` — an undefined value removes the key
/// from the JSON output even when the model had supplied it.
fn set_or_remove(m: &mut Map<String, Value>, key: &str, v: Option<&String>) {
    match v {
        Some(s) => {
            m.insert(key.to_string(), json!(s));
        }
        None => {
            m.remove(key);
        }
    }
}

pub async fn post_analyse(State(state): State<SharedState>, headers: HeaderMap, body: Bytes) -> Response {
    let start = state.now_ms();
    // Rate limiting — keyed on the trusted proxy hop only (F-20).
    let key = client_key(&headers);
    if !state.analyse_limiter.check(&key, start) {
        tracing::warn!("[API] Rate limit exceeded for key: {key}");
        return error_json(429, "Rate limit exceeded. Please try again later.");
    }

    let body = match parse_json_body(&body) {
        Ok(v) => v,
        Err(e) => return internal_error("/api/analyse", e),
    };
    if body.is_null() {
        return internal_error("/api/analyse", "TypeError: Cannot read properties of null (reading 'claim_type')");
    }

    let claim_type = body.get("claim_type");
    if !truthy(claim_type) {
        return error_json(400, "claim_type is required");
    }
    let claim_type = template(claim_type.unwrap());
    let Some(schema) = get_schema(&claim_type) else {
        return error_json(400, format!("Unknown claim type: {claim_type}"));
    };

    // F-12: explicit UK GDPR Article 9(2)(a) consent is mandatory.
    if body.get("consent") != Some(&Value::Bool(true)) {
        return error_json(400, "Explicit consent is required to process your information under UK GDPR Article 9(2)(a). Set consent: true to proceed.");
    }
    let narrative_for_hash = body.get("narrative_text").map(template).unwrap_or_default();
    let consent_hash = hex::encode(Sha256::digest(narrative_for_hash.as_bytes()));
    tracing::info!("[API /api/analyse] consent recorded at={} narrative_hash={}", iso_datetime_from_epoch_ms(start), &consent_hash[..16]);

    // F-28: cap narrative length before any downstream processing.
    let narrative = body.get("narrative_text");
    if let Some(Value::String(n)) = narrative {
        let len = utf16_len(n);
        if len > MAX_NARRATIVE_CHARS {
            return error_json(400, format!("Narrative is too long ({len} characters). Please keep it under {MAX_NARRATIVE_CHARS} characters."));
        }
    }
    // Validate narrative length if in narrative mode.
    if body.get("mode").and_then(Value::as_str) == Some("narrative") {
        match narrative {
            v if !truthy(v) => {
                return error_json(400, "Please provide a more detailed narrative (minimum 50 characters) so the engine can accurately assess your claim.");
            }
            Some(Value::String(n)) => {
                if utf16_len(js_trim(n)) < 50 {
                    return error_json(400, "Please provide a more detailed narrative (minimum 50 characters) so the engine can accurately assess your claim.");
                }
            }
            // A truthy non-string has no `.trim()` → TypeError → 500.
            _ => return internal_error("/api/analyse", "TypeError: body.narrative_text.trim is not a function"),
        }
    }

    // Graceful degradation when no client is configured.
    if !state.llm.is_client_available() {
        return json_response(200, degraded_body(schema, start));
    }

    let user_message = build_user_message(&body, schema, &state.today());
    let endpoint = if body.get("complexity").and_then(Value::as_str) == Some("high") { "analyse_complex" } else { "analyse" };

    let result = match state
        .llm
        .call_claude(CallClaudeParams { endpoint, system: &ANALYSE_PROMPT_V2, user_message: &user_message, prompt_version: versions::ANALYSE, config_override: None })
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => return error_json(500, "Claude client unavailable"),
        Err(e) => return internal_error("/api/analyse", e),
    };

    let payload = match build_canonical_body(&state, &result).await {
        Ok(body) => body,
        Err(()) => {
            let duration = state.now_ms() - start;
            tracing::warn!("[API /api/analyse] Failed to parse JSON, returning raw text. Duration: {duration}ms");
            let mut fallback = json!({
                "claims": [],
                "authorities": [],
                "statutory_provisions": [],
                "procedural_notes": [result.content],
                "era_2025_flags": [],
                "quarantined_count": 0,
                "raw_analysis": result.content,
            });
            if state.is_dev() {
                let mut dbg = serde_json::to_value(&result.debug).unwrap_or_default();
                dbg["error"] = json!("JSON mapping failed");
                fallback["_debug"] = dbg;
            }
            fallback
        }
    };
    let refined = refine_for_user(&state.llm, RefineEndpoint::Analyse, payload).await;
    let mut out = refined.payload;
    if let Value::Object(m) = &mut out {
        m.insert("refinement".into(), refined.refinement.to_json());
    }
    json_response(200, out)
}
