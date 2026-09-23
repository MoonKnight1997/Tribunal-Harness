//! Legal-Writing Refinement Service — port of `refineForUser` in
//! `src/services/legal-writing-refinement.ts`. A second, editor-only pass over
//! an allowlisted set of prose leaves; preserves the JSON shape exactly; never
//! fails (all failure modes are reported in the `refinement` envelope).

use crate::claude_client::{CallClaudeParams, LlmClient};
use serde::Serialize;
use serde_json::{json, Value};
use th_core::prompts::{versions, LEGAL_WRITING_REFINEMENT_PROMPT_V1};
use th_core::refinement::*;

/// `RefineMeta` — key order matches the TypeScript object literals
/// (`{applied, reason, error}` on failure, `{applied, source, changes}` on success).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RefineMeta {
    pub applied: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changes: Option<usize>,
}

impl RefineMeta {
    fn failed(reason: &'static str, error: Option<String>) -> Self {
        Self { applied: false, reason: Some(reason), error, source: None, changes: None }
    }
    /// The degraded-route marker: `{ applied: false, reason: "llm-unavailable" }`.
    pub fn llm_unavailable() -> Self {
        Self::failed("llm-unavailable", None)
    }
    pub fn to_json(&self) -> Value {
        json!(self)
    }
}

pub struct RefinedResult {
    pub payload: Value,
    pub refinement: RefineMeta,
}

/// Refine the prose values inside `payload` for the given endpoint.
pub async fn refine_for_user(llm: &LlmClient, endpoint: RefineEndpoint, payload: Value) -> RefinedResult {
    // 1) Hard kill-switch
    if llm.config.refinement_disabled {
        return RefinedResult { payload, refinement: RefineMeta::failed("disabled", None) };
    }
    // 2) Extract eligible prose fields
    let prose = collect_prose_fields(endpoint, &payload);
    if prose.is_empty() {
        return RefinedResult { payload, refinement: RefineMeta::failed("empty_input", Some("no eligible prose fields found in payload".into())) };
    }
    // 3) Call Claude (or the offline stand-in)
    let user_message = json!({ "endpoint": endpoint.as_str(), "prose_fields": prose }).to_string();
    let result = match llm
        .call_claude(CallClaudeParams {
            endpoint: "refine",
            system: LEGAL_WRITING_REFINEMENT_PROMPT_V1,
            user_message: &user_message,
            prompt_version: versions::REFINEMENT,
            config_override: None,
        })
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("[refine] callClaude threw: {e}");
            return RefinedResult { payload, refinement: RefineMeta::failed("llm_error", Some(e.to_string())) };
        }
    };
    let Some(result) = result else {
        return RefinedResult {
            payload,
            refinement: RefineMeta::failed("llm_error", Some("no LLM client available (ANTHROPIC_API_KEY unset and LLM_PROVIDER not 'agent')".into())),
        };
    };
    // 4) Parse the response
    let Some(parsed) = parse_claude_json(&result.content) else {
        tracing::error!("[refine] could not parse JSON from refinement response");
        return RefinedResult { payload, refinement: RefineMeta::failed("llm_error", Some("refinement response was not valid JSON".into())) };
    };
    // 5) Validate shape — same keys in, same keys out
    if !same_keys(&prose, &parsed.refined_fields) {
        tracing::error!("[refine] key set returned from refinement does not match input");
        return RefinedResult { payload, refinement: RefineMeta::failed("shape_mismatch", Some("refined_fields key set does not match prose_fields".into())) };
    }
    // 6) Splice refined strings back into a clone of the payload
    let (refined_payload, changes) = splice_refined_fields(&payload, &parsed.refined_fields);
    let source = if llm.config.agent_provider { "agent-stand-in" } else { "claude-sonnet" };
    RefinedResult { payload: refined_payload, refinement: RefineMeta { applied: true, reason: None, error: None, source: Some(source), changes: Some(changes) } }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claude_client::LlmConfig;
    use crate::http::MockHttp;
    use std::sync::Arc;
    use th_core::dates::FixedClock;

    fn agent_llm(disabled: bool) -> LlmClient {
        LlmClient::new(LlmConfig { agent_provider: true, refinement_disabled: disabled, ..Default::default() }, MockHttp::transport_error(), Arc::new(FixedClock(0)))
    }

    #[tokio::test]
    async fn pass_through_disabled_and_empty() {
        let payload = json!({"claims": [{"reasoning": "The claimant has continuous service."}], "procedural_notes": ["Commence ACAS."]});
        let r = refine_for_user(&agent_llm(false), RefineEndpoint::Analyse, payload.clone()).await;
        assert_eq!(r.refinement.to_json(), json!({"applied": true, "source": "agent-stand-in", "changes": 0}));
        assert_eq!(r.payload, payload);
        let r = refine_for_user(&agent_llm(true), RefineEndpoint::Analyse, payload.clone()).await;
        assert_eq!(r.refinement.to_json(), json!({"applied": false, "reason": "disabled"}));
        let r = refine_for_user(&agent_llm(false), RefineEndpoint::Analyse, json!({})).await;
        assert_eq!(r.refinement.to_json(), json!({"applied": false, "reason": "empty_input", "error": "no eligible prose fields found in payload"}));
        let no_client = LlmClient::new(LlmConfig::default(), MockHttp::transport_error(), Arc::new(FixedClock(0)));
        let r = refine_for_user(&no_client, RefineEndpoint::Analyse, payload).await;
        assert_eq!(r.refinement.reason, Some("llm_error"));
    }
}
