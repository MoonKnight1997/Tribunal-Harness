//! `POST /api/triage` — parse an uploaded document (PDF/DOCX/TXT), send it to
//! the triage agent (Haiku), return updated fields and a query array.

use super::{error_json, json_response, llm_unavailable_marker};
use crate::jsval::{substring_to, utf16_len};
use crate::state::SharedState;
use axum::extract::multipart::{Multipart, MultipartRejection};
use axum::extract::State;
use axum::response::Response;
use serde_json::{json, Value};
use th_core::prompts::{versions, TRIAGE_PROMPT_V2};
use th_core::refinement::RefineEndpoint;
use th_services::claude_client::CallClaudeParams;
use th_services::refinement::refine_for_user;

// F-28: hard cap on upload size (10 MB comfortably covers legal documents).
const MAX_UPLOAD_BYTES: usize = 10 * 1024 * 1024;

fn caught(details: impl Into<String>) -> Response {
    json_response(500, json!({ "error": "Internal server error", "details": details.into() }))
}

struct Upload {
    file_name: Option<String>,
    bytes: Vec<u8>,
}

/// `Blob.text()` — UTF-8 with replacement characters, BOM stripped.
fn decode_text(bytes: &[u8]) -> String {
    let s = String::from_utf8_lossy(bytes);
    s.strip_prefix('\u{feff}').map(str::to_string).unwrap_or_else(|| s.into_owned())
}

pub async fn post_triage(State(state): State<SharedState>, multipart: Result<Multipart, MultipartRejection>) -> Response {
    let mut multipart = match multipart {
        Ok(m) => m,
        Err(e) => return caught(format!("TypeError: {}", e.body_text())),
    };
    let mut document: Option<Upload> = None;
    let mut schema_state: Option<String> = None;
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => return caught(format!("TypeError: {}", e.body_text())),
        };
        match field.name().map(str::to_string).as_deref() {
            Some("document") if document.is_none() => {
                let file_name = field.file_name().map(str::to_string);
                match field.bytes().await {
                    Ok(b) => document = Some(Upload { file_name, bytes: b.to_vec() }),
                    Err(e) => return caught(format!("TypeError: {}", e.body_text())),
                }
            }
            Some("schema_state") if schema_state.is_none() => match field.text().await {
                Ok(t) => schema_state = Some(t),
                Err(e) => return caught(format!("TypeError: {}", e.body_text())),
            },
            _ => {
                let _ = field.bytes().await;
            }
        }
    }

    let Some(upload) = document else {
        return error_json(400, "No document uploaded. Send a file as 'document' in multipart form data.");
    };
    // F-41: a non-file `document` must not flow into the parsers.
    let Some(file_name) = upload.file_name else {
        return error_json(400, "The 'document' field must be an uploaded file, not a text value.");
    };
    // F-28: reject oversized uploads.
    if upload.bytes.len() > MAX_UPLOAD_BYTES {
        return error_json(413, format!("File too large. Maximum upload size is {} MB.", MAX_UPLOAD_BYTES / (1024 * 1024)));
    }

    let lower = file_name.to_lowercase();
    let extracted_text: String = if lower.ends_with(".txt") {
        decode_text(&upload.bytes)
    } else if lower.ends_with(".pdf") {
        match th_services::pdf_to_markdown::pdf_raw_text(&upload.bytes) {
            Ok(text) => text,
            Err(_) => return error_json(422, "Failed to parse PDF. Ensure the file is a valid PDF document."),
        }
    } else if lower.ends_with(".docx") {
        match th_services::docx::extract_raw_text(&upload.bytes) {
            Ok(text) => text,
            Err(_) => return error_json(422, "Failed to parse DOCX. Ensure the file is a valid Word document."),
        }
    } else {
        return error_json(400, "Unsupported file type. Accepted: .pdf, .docx, .txt");
    };

    // Graceful degradation without an API key.
    if !state.llm.is_client_available() {
        return json_response(
            200,
            json!({
                "updated_fields": {},
                "query_array": [{
                    "field_id": "narrative",
                    "question": "We extracted text from your document. Please review and supplement.",
                    "ui_component": "textarea",
                    "legal_relevance": "The extracted text provides the factual basis for claim identification.",
                }],
                "document_summary": format!("Extracted {} characters from {}. AI triage requires an Anthropic API key.", utf16_len(&extracted_text), file_name),
                "extracted_text": substring_to(&extracted_text, 5000),
                "refinement": llm_unavailable_marker(),
            }),
        );
    }

    let current_schema = schema_state.filter(|s| !s.is_empty()).unwrap_or_else(|| "none".to_string());
    let user_message = format!("Current schema state: {current_schema}\n\nDocument text:\n{}", substring_to(&extracted_text, 10000));

    let result = match state
        .llm
        .call_claude(CallClaudeParams { endpoint: "triage", system: TRIAGE_PROMPT_V2, user_message: &user_message, prompt_version: versions::TRIAGE, config_override: None })
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => return error_json(500, "Claude client unavailable"),
        Err(e) => return caught(format!("Error: {e}")),
    };

    let payload = match serde_json::from_str::<Value>(&result.content) {
        Ok(mut parsed) => {
            if state.is_dev() {
                if let Value::Object(m) = &mut parsed {
                    m.insert("_debug".into(), serde_json::to_value(&result.debug).unwrap_or_default());
                }
            }
            parsed
        }
        Err(_) => {
            let mut fallback = json!({
                "updated_fields": {},
                "query_array": [],
                "document_summary": result.content,
                "extracted_text": substring_to(&extracted_text, 5000),
            });
            if state.is_dev() {
                let mut dbg = serde_json::to_value(&result.debug).unwrap_or_default();
                dbg["error"] = json!("JSON mapping failed");
                fallback["_debug"] = dbg;
            }
            fallback
        }
    };
    let refined = refine_for_user(&state.llm, RefineEndpoint::Triage, payload).await;
    let mut out = refined.payload;
    if let Value::Object(m) = &mut out {
        m.insert("refinement".into(), refined.refinement.to_json());
    }
    json_response(200, out)
}
