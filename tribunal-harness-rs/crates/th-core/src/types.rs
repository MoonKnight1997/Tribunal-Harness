//! Shared types — port of `src/schemas/types.ts`. Field order in each struct
//! is the JSON key order the TypeScript app emits (serde preserves it).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelectOption {
    pub value: &'static str,
    pub label: &'static str,
}

/// Convenience for schema literals.
pub const fn opt(value: &'static str, label: &'static str) -> SelectOption {
    SelectOption { value, label }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldType {
    Text,
    Date,
    Select,
    Boolean,
    Number,
    Textarea,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnnotationStatus {
    InForce,
    Upcoming,
    AwaitingSi,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Era2025Annotation {
    pub is_new: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_from: Option<String>,
    pub commencement_date: String,
    pub status: AnnotationStatus,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SchemaField {
    pub id: &'static str,
    pub label: &'static str,
    #[serde(rename = "type")]
    pub field_type: FieldType,
    pub required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<SelectOption>>,
    #[serde(rename = "helpText", skip_serializing_if = "Option::is_none")]
    pub help_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub era2025: Option<Era2025Annotation>,
}

impl SchemaField {
    pub fn new(id: &'static str, label: &'static str, field_type: FieldType, required: bool) -> Self {
        Self { id, label, field_type, required, options: None, help_text: None, era2025: None }
    }
    pub fn options(mut self, options: Vec<SelectOption>) -> Self {
        self.options = Some(options);
        self
    }
    pub fn help(mut self, text: impl Into<String>) -> Self {
        self.help_text = Some(text.into());
        self
    }
    pub fn era2025(mut self, a: Era2025Annotation) -> Self {
        self.era2025 = Some(a);
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimSchema {
    pub id: &'static str,
    pub label: &'static str,
    pub statute: &'static str,
    pub description: &'static str,
    pub legal_test: Vec<String>,
    pub key_authorities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub era2025_changes: Option<Vec<String>>,
    pub fields: Vec<SchemaField>,
}

/// F-9: canonical status enum for an ERA 2025 provision surfaced in the
/// analyse response. Keeps a distinct `tbc` value so the "exact commencement
/// date to be confirmed by Statutory Instrument" signal is never collapsed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EraFlagStatus {
    InForce,
    Upcoming,
    Tbc,
}

impl EraFlagStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            EraFlagStatus::InForce => "in_force",
            EraFlagStatus::Upcoming => "upcoming",
            EraFlagStatus::Tbc => "tbc",
        }
    }
}

/// Independently verified trust level for a cited authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Hash)]
#[serde(rename_all = "UPPERCASE")]
pub enum TrustLevel {
    Quarantined,
    Check,
    Verified,
}

impl TrustLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            TrustLevel::Verified => "VERIFIED",
            TrustLevel::Check => "CHECK",
            TrustLevel::Quarantined => "QUARANTINED",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ClaimStrength {
    Strong,
    Moderate,
    Weak,
}

impl ClaimStrength {
    pub fn as_str(&self) -> &'static str {
        match self {
            ClaimStrength::Strong => "STRONG",
            ClaimStrength::Moderate => "MODERATE",
            ClaimStrength::Weak => "WEAK",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LegalTestElement {
    pub element: String,
    pub satisfied: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClaimAnalysis {
    #[serde(rename = "type")]
    pub claim_type: String,
    pub strength: ClaimStrength,
    pub reasoning: String,
    pub legal_test_elements: Vec<LegalTestElement>,
}

/// A cited authority. The base fields match the prompt schema; the remaining
/// fields are enrichment attached by the citation validator in `/api/analyse`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Authority {
    pub name: String,
    pub citation: String,
    pub principle: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trust_level: Option<TrustLevel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_case: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_citation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub citation_corrected: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_citation: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StatutoryProvision {
    pub statute: String,
    pub section: String,
    pub relevance: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Era2025Flag {
    pub provision: String,
    pub applies: bool,
    pub reason: String,
    pub commencement_date: String,
    pub status: EraFlagStatus,
}

/// THE canonical analyse response contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalyseResponse {
    pub claims: Vec<ClaimAnalysis>,
    pub authorities: Vec<Authority>,
    pub statutory_provisions: Vec<StatutoryProvision>,
    pub procedural_notes: Vec<String>,
    pub era_2025_flags: Vec<Era2025Flag>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Regime {
    #[serde(rename = "pre_era_2025")]
    PreEra2025,
    #[serde(rename = "post_era_2025")]
    PostEra2025,
}

impl Regime {
    pub fn as_str(&self) -> &'static str {
        match self {
            Regime::PreEra2025 => "pre_era_2025",
            Regime::PostEra2025 => "post_era_2025",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeadlineResult {
    pub claim_type: String,
    /// The statutory deadline BEFORE any ACAS Early Conciliation extension.
    pub base_deadline: String,
    /// The deadline AFTER the ACAS EC clock-stop, present only when ACAS
    /// Day A / Day B dates were supplied.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acas_extended_deadline: Option<String>,
    /// The operative deadline the claimant must actually meet.
    pub final_deadline: String,
    /// Retained alias of `final_deadline` for legacy consumers.
    pub original_deadline: String,
    pub regime: Regime,
    pub days_remaining: i64,
    pub is_expired: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeadlineResponse {
    pub deadlines: Vec<DeadlineResult>,
    pub time_limit_regime: Regime,
    pub warnings: Vec<String>,
}
