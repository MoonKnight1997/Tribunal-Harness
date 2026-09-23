//! Tribunal Harness — core domain logic (pure, no I/O).
//!
//! This crate is a behaviour-for-behaviour port of the TypeScript app's
//! `src/lib`, `src/schemas`, `src/services` (pure parts) and `src/agents`.
//! Every public function is diffed against fixtures recorded from the
//! TypeScript app in `tests/`.
//!
//! **Legal information, not legal advice.** Every user-facing output of the
//! product carries the Legal Services Act 2007 disclaimer.

pub mod agent_provider;
pub mod analyse_contract;
pub mod citation_validator;
pub mod claude_config;
pub mod constants;
pub mod dates;
pub mod deadlines;
pub mod find_case_law;
pub mod jsnum;
pub mod prompts;
pub mod qualifying_period;
pub mod rate_limit;
pub mod refinement;
pub mod roadmap;
pub mod schemas;
pub mod seed_cases;
pub mod tracker;
pub mod types;
pub mod ui_view;
pub mod verified_authorities;

/// The Legal Services Act 2007 disclaimer sentence used across the product.
pub const LSA_DISCLAIMER: &str =
    "This tool provides legal information, not legal advice. It does not create a solicitor-client relationship.";
