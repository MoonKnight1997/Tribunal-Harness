//! Adversarial debate engine — the Drafter → Critic → Judge chain from
//! `src/app/api/debate/route.ts`, in both `single_pass` and `adversarial`
//! modes, with independent citation trust attached to every citation-bearing
//! output and the Judge's scores clamped to the rubric.

use crate::citation_authority::validate_all_citations_authoritative;
use crate::claude_client::{CallClaudeParams, ClaudeCallResult, ClaudeError, LlmClient};
use crate::refinement::refine_for_user;
use crate::tna::TnaClient;
use serde_json::{json, Map, Value};
use th_core::prompts::{versions, CRITIC_PROMPT_V2, DRAFTER_PROMPT_V2, JUDGE_PROMPT_V2};
use th_core::refinement::RefineEndpoint;
use th_core::ui_view::debate_modes::DebateMode;

pub const MAX_FACTS_LENGTH: usize = 50_000;
pub const MAX_DEBATE_ROUNDS: u32 = 3;
const DRAFTER_FALLBACK_KEY: &str = "argument";
const CRITIC_FALLBACK_KEY: &str = "attacks";
const JUDGE_FALLBACK_KEY: &str = "synthesis";

#[derive(Debug, thiserror::Error)]
pub enum DebateError {
    /// `callClaude` returned null → 500 `{ error: "<Agent> agent failed" }`.
    #[error("{0} agent failed")]
    AgentFailed(&'static str),
    #[error(transparent)]
    Claude(#[from] ClaudeError),
}

/// Parse an agent's raw content as JSON, wrapping free text under a fallback key.
fn parse_agent_output(content: &str, fallback_key: &str) -> Map<String, Value> {
    match serde_json::from_str::<Value>(content) {
        Ok(Value::Object(m)) => m,
        Ok(other) => {
            // A JSON scalar/array is "an object" only nominally in TS (it would
            // be returned as-is and later property writes would fail or be
            // ignored). Wrap under the fallback key for stability.
            let mut m = Map::new();
            m.insert(fallback_key.to_string(), other);
            m
        }
        Err(_) => {
            let mut m = Map::new();
            m.insert(fallback_key.to_string(), Value::String(content.to_string()));
            m
        }
    }
}

/// Attach independent trust levels to a citation-bearing array. Non-arrays
/// are returned untouched.
async fn attach_citation_trust(tna: &TnaClient, items: Option<&Value>, name_key: Option<&str>) -> Option<Value> {
    let Some(Value::Array(items)) = items else { return items.cloned() };
    let authorities: Vec<(String, Option<String>)> = items
        .iter()
        .map(|item| {
            let rec = item.as_object();
            let citation = rec.and_then(|r| r.get("citation")).and_then(Value::as_str).unwrap_or("").to_string();
            let name = name_key.and_then(|k| rec.and_then(|r| r.get(k))).and_then(Value::as_str).map(str::to_string);
            (citation, name)
        })
        .collect();
    let (results, _) = validate_all_citations_authoritative(tna, &authorities).await;
    let out: Vec<Value> = items
        .iter()
        .zip(results.iter())
        .map(|(item, vr)| {
            let mut m = item.as_object().cloned().unwrap_or_default();
            m.insert("verified".into(), json!(vr.trust_level == th_core::types::TrustLevel::Verified));
            m.insert("trust_level".into(), json!(vr.trust_level));
            m.insert("validation_reason".into(), json!(vr.reason));
            if let Some(n) = &vr.matched_name {
                m.insert("matched_case".into(), json!(n));
            }
            if let Some(c) = &vr.matched_citation {
                m.insert("matched_citation".into(), json!(c));
            }
            if let Some(u) = &vr.url {
                m.insert("source_url".into(), json!(u));
            }
            m.insert("verification_source".into(), json!(vr.source.as_str()));
            Value::Object(m)
        })
        .collect();
    Some(Value::Array(out))
}

async fn process_drafter_output(tna: &TnaClient, mut output: Map<String, Value>) -> Map<String, Value> {
    let lf = attach_citation_trust(tna, output.get("legal_framework"), Some("authority")).await;
    match lf {
        Some(v) => {
            output.insert("legal_framework".into(), v);
        }
        None => {
            // TS assigns `undefined` → the key is dropped from JSON.
            output.remove("legal_framework");
        }
    }
    output
}

async fn process_critic_output(tna: &TnaClient, mut output: Map<String, Value>) -> Map<String, Value> {
    let at = attach_citation_trust(tna, output.get("attacks"), None).await;
    match at {
        Some(v) => {
            output.insert("attacks".into(), v);
        }
        None => {
            output.remove("attacks");
        }
    }
    output
}

/// F-29: clamp a score into `0..=max` (rounded); `None` if not a finite number.
fn clamp_score(value: Option<&Value>, max: f64) -> Option<f64> {
    let v = value?.as_f64()?;
    if !v.is_finite() {
        return None;
    }
    Some(th_core::jsnum::js_round(v).clamp(0.0, max))
}

fn clamp_judge_scores(judge: &mut Map<String, Value>) {
    if let Some(s) = clamp_score(judge.get("score"), 100.0) {
        judge.insert("score".into(), th_core::jsnum::js_number(s));
    }
    if let Some(Value::Object(breakdown)) = judge.get_mut("score_breakdown") {
        for (_, criterion) in breakdown.iter_mut() {
            if let Value::Object(c) = criterion {
                let max = c.get("max").and_then(Value::as_f64).unwrap_or(100.0);
                if let Some(s) = clamp_score(c.get("score"), max) {
                    c.insert("score".into(), th_core::jsnum::js_number(s));
                }
            }
        }
    }
}

fn score_of(judge: &Map<String, Value>) -> Option<f64> {
    judge.get("score").and_then(Value::as_f64)
}

fn viable_from_judge(judge: &Map<String, Value>) -> Option<bool> {
    score_of(judge).map(|s| s >= 70.0)
}

async fn call(llm: &LlmClient, endpoint: &str, system: &str, user_message: &str, prompt_version: &str, agent: &'static str) -> Result<ClaudeCallResult, DebateError> {
    llm.call_claude(CallClaudeParams { endpoint, system, user_message, prompt_version, config_override: None }).await?.ok_or(DebateError::AgentFailed(agent))
}

pub struct DebateOutcome {
    pub body: Value,
}

/// Run the debate. `facts` and `claim_type` are already stringified the way a
/// template literal would render them. `dev` attaches `_debug`.
#[allow(clippy::too_many_arguments)]
pub async fn run_debate(
    llm: &LlmClient,
    tna: &TnaClient,
    facts: &str,
    claim_type: &str,
    mode: DebateMode,
    dev: bool,
    start_ms: i64,
    now_ms: impl Fn() -> i64,
) -> Result<DebateOutcome, DebateError> {
    let mut total_in: u64 = 0;
    let mut total_out: u64 = 0;

    if mode == DebateMode::Adversarial {
        let initial = call(llm, "drafter", &DRAFTER_PROMPT_V2, &format!("Claim Type: {claim_type}\n\nFacts:\n{facts}"), versions::DRAFTER, "Drafter").await?;
        total_in += initial.usage.input_tokens;
        total_out += initial.usage.output_tokens;
        let mut current_draft = initial.content;
        let mut iterations: Vec<Value> = Vec::new();
        let mut stopped_early = false;

        for round in 1..=MAX_DEBATE_ROUNDS {
            let critic = call(
                llm,
                "critic",
                CRITIC_PROMPT_V2,
                &format!("Claim Type: {claim_type}\n\nOriginal Facts:\n{facts}\n\nDrafter Argument:\n{current_draft}"),
                versions::CRITIC,
                "Critic",
            )
            .await?;
            total_in += critic.usage.input_tokens;
            total_out += critic.usage.output_tokens;

            let revise = call(
                llm,
                "drafter",
                &DRAFTER_PROMPT_V2,
                &format!("Claim Type: {claim_type}\n\nOriginal Facts:\n{facts}\n\nYour previous argument:\n{current_draft}\n\nOpposing counsel's attack:\n{}\n\nRevise and strengthen your argument to address these criticisms. Remain grounded only in cited authority; do not fabricate.", critic.content),
                versions::DRAFTER,
                "Drafter",
            )
            .await?;
            total_in += revise.usage.input_tokens;
            total_out += revise.usage.output_tokens;
            current_draft = revise.content.clone();

            let judge = call(
                llm,
                "judge",
                JUDGE_PROMPT_V2,
                &format!("Claim Type: {claim_type}\n\nOriginal Facts:\n{facts}\n\nDrafter Argument:\n{}\n\nCritic Attack:\n{}", revise.content, critic.content),
                versions::JUDGE,
                "Judge",
            )
            .await?;
            total_in += judge.usage.input_tokens;
            total_out += judge.usage.output_tokens;

            let drafter_output = process_drafter_output(tna, parse_agent_output(&revise.content, DRAFTER_FALLBACK_KEY)).await;
            let critic_output = process_critic_output(tna, parse_agent_output(&critic.content, CRITIC_FALLBACK_KEY)).await;
            let mut judge_output = parse_agent_output(&judge.content, JUDGE_FALLBACK_KEY);
            clamp_judge_scores(&mut judge_output);
            let score = score_of(&judge_output);
            let viable = viable_from_judge(&judge_output);
            iterations.push(json!({
                "round": round,
                "drafter": drafter_output,
                "critic": critic_output,
                "judge": judge_output,
                "score": score.map(th_core::jsnum::js_number),
                "viable": viable,
            }));
            if let Some(s) = score {
                if s >= 70.0 {
                    stopped_early = round < MAX_DEBATE_ROUNDS;
                    break;
                }
            }
        }

        let last = iterations.last().cloned().unwrap_or(json!({}));
        let final_round = json!({
            "drafter": last["drafter"],
            "critic": last["critic"],
            "judge": last["judge"],
            "score": last["score"],
            "viable": last["viable"],
        });
        let duration = now_ms() - start_ms;
        let refined = refine_for_user(llm, RefineEndpoint::Debate, final_round).await;
        let final_out = refined.payload;
        let mut body = json!({
            "mode": mode.as_str(),
            "rounds_run": iterations.len(),
            "viable": final_out["viable"],
            "iterations": iterations,
            "final": final_out,
            "stopped_early": stopped_early,
            "usage": { "total_input_tokens": total_in, "total_output_tokens": total_out },
        });
        if dev {
            body["_debug"] = json!({ "duration_ms": duration, "total_input_tokens": total_in, "total_output_tokens": total_out });
        }
        body["refinement"] = refined.refinement.to_json();
        return Ok(DebateOutcome { body });
    }

    // ── single_pass (default): Drafter → Critic → Judge, one pass ────────
    let drafter = call(llm, "drafter", &DRAFTER_PROMPT_V2, &format!("Claim Type: {claim_type}\n\nFacts:\n{facts}"), versions::DRAFTER, "Drafter").await?;
    total_in += drafter.usage.input_tokens;
    total_out += drafter.usage.output_tokens;
    let critic = call(
        llm,
        "critic",
        CRITIC_PROMPT_V2,
        &format!("Claim Type: {claim_type}\n\nOriginal Facts:\n{facts}\n\nDrafter Argument:\n{}", drafter.content),
        versions::CRITIC,
        "Critic",
    )
    .await?;
    total_in += critic.usage.input_tokens;
    total_out += critic.usage.output_tokens;
    let judge = call(
        llm,
        "judge",
        JUDGE_PROMPT_V2,
        &format!("Claim Type: {claim_type}\n\nOriginal Facts:\n{facts}\n\nDrafter Argument:\n{}\n\nCritic Attack:\n{}", drafter.content, critic.content),
        versions::JUDGE,
        "Judge",
    )
    .await?;
    total_in += judge.usage.input_tokens;
    total_out += judge.usage.output_tokens;

    let mut judge_output = parse_agent_output(&judge.content, JUDGE_FALLBACK_KEY);
    let drafter_output = process_drafter_output(tna, parse_agent_output(&drafter.content, DRAFTER_FALLBACK_KEY)).await;
    let critic_output = process_critic_output(tna, parse_agent_output(&critic.content, CRITIC_FALLBACK_KEY)).await;
    clamp_judge_scores(&mut judge_output);
    let duration = now_ms() - start_ms;

    let mut body = json!({
        "mode": mode.as_str(),
        "rounds_run": 1,
        "drafter": drafter_output,
        "critic": critic_output,
        "judge": judge_output.clone(),
        "viable": viable_from_judge(&judge_output),
        "usage": { "total_input_tokens": total_in, "total_output_tokens": total_out },
    });
    if dev {
        body["_debug"] = json!({
            "duration_ms": duration,
            "total_input_tokens": total_in,
            "total_output_tokens": total_out,
            "agents": { "drafter": drafter.debug, "critic": critic.debug, "judge": judge.debug },
        });
    }
    let refined = refine_for_user(llm, RefineEndpoint::Debate, body).await;
    let mut out = refined.payload;
    out["refinement"] = refined.refinement.to_json();
    Ok(DebateOutcome { body: out })
}
