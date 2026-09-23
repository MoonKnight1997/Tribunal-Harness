//! Claude Model Configuration — port of `src/lib/claude-config.ts`. This is
//! the SINGLE SOURCE OF TRUTH for model settings; model identifiers, effort
//! levels, thinking budgets and token limits are ported as they are.

use serde::Serialize;

/// Model identifiers (F-5: current-generation ids, founder-approved).
pub mod models {
    /// Frontier model – complex legal reasoning, adversarial debate, multi-document synthesis
    pub const OPUS: &str = "claude-opus-4-8";
    /// Mid-tier model – standard drafting, analysis, structured output
    pub const SONNET: &str = "claude-sonnet-5";
    /// Fast/cheap model – triage, extraction, classification, bulk tagging
    pub const HAIKU: &str = "claude-haiku-4-5-20251001";
}

pub const CLAUDE_MODELS: [(&str, &str); 3] = [("OPUS", models::OPUS), ("SONNET", models::SONNET), ("HAIKU", models::HAIKU)];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EffortLevel {
    Low,
    Medium,
    High,
    Max,
}

impl EffortLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            EffortLevel::Low => "low",
            EffortLevel::Medium => "medium",
            EffortLevel::High => "high",
            EffortLevel::Max => "max",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ThinkingType {
    Enabled,
    Disabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ThinkingConfig {
    #[serde(rename = "type")]
    pub thinking_type: ThinkingType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget_tokens: Option<u32>,
}

impl ThinkingConfig {
    pub const fn enabled(budget_tokens: u32) -> Self {
        Self { thinking_type: ThinkingType::Enabled, budget_tokens: Some(budget_tokens) }
    }
    pub const fn disabled() -> Self {
        Self { thinking_type: ThinkingType::Disabled, budget_tokens: None }
    }
    pub fn is_enabled(&self) -> bool {
        self.thinking_type == ThinkingType::Enabled
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EndpointConfig {
    pub model: &'static str,
    pub effort: EffortLevel,
    pub max_tokens: u32,
    pub thinking: ThinkingConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    pub label: &'static str,
}

/// Per-endpoint Claude configuration, in the TypeScript declaration order.
pub const ENDPOINT_CONFIG: [(&str, EndpointConfig); 7] = [
    ("triage", EndpointConfig { model: models::HAIKU, effort: EffortLevel::Low, max_tokens: 2048, thinking: ThinkingConfig::disabled(), temperature: Some(0.3), label: "Triage (Haiku)" }),
    ("analyse", EndpointConfig { model: models::SONNET, effort: EffortLevel::Medium, max_tokens: 16_000, thinking: ThinkingConfig::enabled(10_000), temperature: Some(0.3), label: "Analysis (Sonnet)" }),
    ("analyse_complex", EndpointConfig { model: models::OPUS, effort: EffortLevel::High, max_tokens: 24_000, thinking: ThinkingConfig::enabled(20_000), temperature: Some(0.3), label: "Analysis Complex (Opus)" }),
    ("drafter", EndpointConfig { model: models::SONNET, effort: EffortLevel::Medium, max_tokens: 12_000, thinking: ThinkingConfig::enabled(8_000), temperature: Some(0.3), label: "Drafter (Sonnet)" }),
    ("critic", EndpointConfig { model: models::OPUS, effort: EffortLevel::High, max_tokens: 20_000, thinking: ThinkingConfig::enabled(15_000), temperature: Some(0.7), label: "Critic (Opus)" }),
    ("judge", EndpointConfig { model: models::OPUS, effort: EffortLevel::Medium, max_tokens: 14_000, thinking: ThinkingConfig::enabled(10_000), temperature: Some(0.1), label: "Judge (Opus)" }),
    ("refine", EndpointConfig { model: models::SONNET, effort: EffortLevel::Low, max_tokens: 4000, thinking: ThinkingConfig::disabled(), temperature: Some(0.2), label: "Legal-writing refinement (Sonnet)" }),
];

/// Get the endpoint config, warning and falling back to `analyse` if the key
/// is not found (F-33: never silently).
pub fn get_endpoint_config(endpoint: &str) -> EndpointConfig {
    if let Some((_, c)) = ENDPOINT_CONFIG.iter().find(|(k, _)| *k == endpoint) {
        return c.clone();
    }
    tracing::warn!("[claude-config] Unknown endpoint \"{endpoint}\"; falling back to 'analyse'.");
    ENDPOINT_CONFIG.iter().find(|(k, _)| *k == "analyse").map(|(_, c)| c.clone()).expect("analyse config exists")
}

// ─── Cost Estimation ─────────────────────────────────────────────────
// Pricing per million tokens (USD), verified 2026-07-09 in the TypeScript source.
struct Pricing {
    input_per_mtok: f64,
    output_per_mtok: f64,
}

fn pricing_for(model: &str) -> Option<Pricing> {
    match model {
        models::OPUS => Some(Pricing { input_per_mtok: 5.0, output_per_mtok: 25.0 }),
        models::SONNET => Some(Pricing { input_per_mtok: 3.0, output_per_mtok: 15.0 }),
        models::HAIKU => Some(Pricing { input_per_mtok: 1.0, output_per_mtok: 5.0 }),
        _ => None,
    }
}

/// Estimate only — hardcoded approximation, not a live FX rate.
const USD_TO_GBP: f64 = 0.79;

#[derive(Debug, Clone, PartialEq)]
pub struct CostEstimate {
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
    pub cost_gbp: f64,
}

impl Serialize for CostEstimate {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut m = s.serialize_map(Some(5))?;
        m.serialize_entry("model", &self.model)?;
        m.serialize_entry("input_tokens", &self.input_tokens)?;
        m.serialize_entry("output_tokens", &self.output_tokens)?;
        m.serialize_entry("cost_usd", &crate::jsnum::js_number(self.cost_usd))?;
        m.serialize_entry("cost_gbp", &crate::jsnum::js_number(self.cost_gbp))?;
        m.end()
    }
}

/// Estimate the cost of a Claude API call (4 dp, JS `Math.round` semantics).
/// An unknown model would be a TypeError in TypeScript; here it prices as 0.
pub fn estimate_cost(model: &str, input_tokens: u64, output_tokens: u64) -> CostEstimate {
    let p = pricing_for(model).unwrap_or(Pricing { input_per_mtok: 0.0, output_per_mtok: 0.0 });
    let input_cost = (input_tokens as f64 / 1_000_000.0) * p.input_per_mtok;
    let output_cost = (output_tokens as f64 / 1_000_000.0) * p.output_per_mtok;
    let total_usd = input_cost + output_cost;
    CostEstimate {
        model: model.to_string(),
        input_tokens,
        output_tokens,
        cost_usd: crate::jsnum::js_round(total_usd * 10000.0) / 10000.0,
        cost_gbp: crate::jsnum::js_round(total_usd * USD_TO_GBP * 10000.0) / 10000.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn costs() {
        let r = estimate_cost(models::OPUS, 10000, 5000);
        assert_eq!(r.cost_usd, 0.175);
        assert_eq!(r.cost_gbp, 0.1382);
        let r = estimate_cost(models::SONNET, 1_000_000, 2_000_000);
        assert_eq!((r.cost_usd, r.cost_gbp), (33.0, 26.07));
        let r = estimate_cost(models::HAIKU, 1_000_000, 1_000_000);
        assert_eq!((r.cost_usd, r.cost_gbp), (6.0, 4.74));
        assert_eq!(estimate_cost(models::SONNET, 0, 0).cost_usd, 0.0);
    }

    #[test]
    fn budgets_below_max_tokens() {
        for (k, c) in ENDPOINT_CONFIG.iter() {
            if c.thinking.is_enabled() {
                assert!(c.max_tokens > c.thinking.budget_tokens.unwrap(), "{k}");
            }
        }
        assert_eq!(get_endpoint_config("does-not-exist").label, "Analysis (Sonnet)");
        assert_eq!(get_endpoint_config("critic").label, "Critic (Opus)");
    }
}
