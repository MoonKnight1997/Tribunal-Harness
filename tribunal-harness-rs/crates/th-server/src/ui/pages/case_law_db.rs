//! `/case-law-db` — curated seed-data search UI.

use crate::state::SharedState;
use crate::ui::components::case_law_error_box;
use crate::ui::layout::{document, PageMeta};
use crate::ui::scripts;
use axum::extract::State;
use maud::{html, Markup, PreEscaped};

const META: PageMeta = PageMeta::root("/case-law-db");

const HERO_SVG: &str = r##"<path d="M150 150 A50 15 0 1 0 250 150 A50 15 0 1 0 150 150 Z" fill="rgba(45,212,191,0.05)" stroke="#2dd4bf" stroke-width="1.5"/><path d="M150 165 A50 15 0 1 0 250 165" fill="none" stroke="rgba(45,212,191,0.5)" stroke-width="1"/><path d="M150 180 A50 15 0 1 0 250 180" fill="none" stroke="rgba(45,212,191,0.5)" stroke-width="1"/><path d="M150 195 A50 15 0 1 0 250 195" fill="none" stroke="rgba(45,212,191,0.5)" stroke-width="1"/><path d="M150 150 L150 195" fill="none" stroke="#2dd4bf" stroke-width="1.5"/><path d="M250 150 L250 195" fill="none" stroke="#2dd4bf" stroke-width="1.5"/><path d="M200 60 L140 100 L260 100 Z" fill="rgba(139,92,246,0.1)" stroke="var(--color-accent-purple)" stroke-width="1.5"/><line x1="160" y1="100" x2="160" y2="105" stroke="var(--color-accent-purple)" stroke-width="1"/><line x1="200" y1="100" x2="200" y2="105" stroke="var(--color-accent-purple)" stroke-width="1"/><line x1="240" y1="100" x2="240" y2="105" stroke="var(--color-accent-purple)" stroke-width="1"/><path d="M200 105 L200 135" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" stroke-dasharray="4 4" fill="none"/><rect x="70" y="160" width="40" height="40" rx="4" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><path d="M110 180 L150 180" stroke="rgba(255,255,255,0.1)" stroke-width="1"/><rect x="290" y="160" width="40" height="40" rx="4" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><path d="M250 180 L290 180" stroke="rgba(255,255,255,0.1)" stroke-width="1"/><circle cx="200" cy="150" r="3" fill="#fbbf24" style="filter:drop-shadow(0 0 4px #fbbf24)"/><circle cx="160" cy="90" r="2" fill="var(--color-accent-purple)"/><circle cx="240" cy="90" r="2" fill="var(--color-accent-purple)"/>"##;

const TIERS: [(&str, &str, &str, &str, &str); 4] = [
    ("Tier 1", "Supreme Court / CoA", "Binding authorities", "BINDING", "#2dd4bf"),
    ("Tier 2", "EAT", "Persuasive authorities", "PERSUASIVE", "var(--color-accent-purple)"),
    ("Tier 3", "Statutes", "ERA 1996, EA 2010, ERA 2025", "STATUTORY", "#fbbf24"),
    ("Tier 4", "Practice", "Presidential Guidance, Practice Directions", "GUIDANCE", "var(--color-text-secondary)"),
];

const CLAIM_TYPE_OPTIONS: [(&str, &str); 9] = [
    ("", "All types"),
    ("unfair_dismissal", "Unfair Dismissal"),
    ("constructive_dismissal", "Constructive Dismissal"),
    ("direct_discrimination", "Discrimination"),
    ("harassment", "Harassment"),
    ("whistleblowing", "Whistleblowing"),
    ("redundancy", "Redundancy"),
    ("fire_and_rehire", "Fire & Rehire"),
    ("zero_hours_rights", "Zero-Hours Rights"),
];

pub async fn page(State(state): State<SharedState>) -> Markup {
    let body = html! {
        div style="padding-top:10rem" {
            div class="page-section" {
                div style="display:grid;grid-template-columns:1fr 1fr;gap:4rem;align-items:center;margin-bottom:4rem" {
                    div {
                        span class="text-subhead" { "KNOWLEDGE BASE" }
                        h1 style="font-family:var(--font-serif);font-size:3rem;margin-bottom:1.5rem" { "Case Law Database" }
                        p class="text-lead" { "A curated, tiered database of employment law authorities. Every case is verified against official reports before it enters the system." }
                    }
                    div class="fade-in" {
                        svg viewBox="0 0 400 300" style="width:100%;height:auto;border-radius:var(--radius-card);border:1px solid var(--color-border-subtle);background:rgba(0,0,0,0.2)" { (PreEscaped(HERO_SVG)) }
                    }
                }

                div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:1.5rem;margin-bottom:3rem" {
                    @for (tier, label, desc, badge, color) in TIERS {
                        div class="interface-card" style="text-align:center" {
                            span style=(format!("font-family:var(--font-mono);font-size:0.7rem;color:{color};font-weight:600")) { (tier) }
                            h3 style="font-family:var(--font-serif);font-size:1.5rem;margin:0.75rem 0 0.5rem" { (label) }
                            p style="font-size:0.8rem;color:var(--color-text-secondary);margin-bottom:1rem" { (desc) }
                            span style=(format!("font-family:var(--font-mono);font-size:0.75rem;font-weight:700;color:{color};padding:2px 8px;border:1px solid {color};border-radius:4px;opacity:0.8")) { (badge) }
                        }
                    }
                }

                div class="interface-card" style="margin-bottom:2rem" {
                    h2 style="font-family:var(--font-serif);font-size:1.75rem;margin-bottom:1.5rem" { "Search Cases" }
                    form id="case-law-form" style="display:grid;grid-template-columns:1fr auto auto;gap:1rem;align-items:end" {
                        div class="input-group" style="margin:0" {
                            label class="input-label" for="case-law-query" { "Search query" }
                            input id="case-law-query" class="input-field" placeholder="e.g. constructive dismissal, Polkey, band of reasonable responses...";
                        }
                        div class="input-group" style="margin:0" {
                            label class="input-label" for="case-law-claim-type" { "Claim type" }
                            select id="case-law-claim-type" class="input-field" {
                                @for (value, label) in CLAIM_TYPE_OPTIONS { option value=(value) { (label) } }
                            }
                        }
                        button type="submit" id="case-law-submit" class="btn-primary" style="padding:0.75rem 1.5rem;white-space:nowrap" { "Search" }
                    }
                }

                template id="case-law-error-template" { (case_law_error_box("")) }

                div id="case-law-results" {
                    div class="interface-card" style="text-align:center;padding:3rem 2rem" {
                        p style="font-family:var(--font-mono);font-size:0.85rem;color:var(--color-text-secondary)" { "Search by case name, citation, or keyword — or filter by claim type." }
                    }
                }

                div style="margin-top:3rem;padding:1rem;border-top:1px solid var(--color-border-subtle);text-align:center" {
                    p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary);opacity:0.6" {
                        "This tool provides legal information, not legal advice. It does not create a solicitor-client relationship. The case law database is for research purposes only — case status and binding authority can change. Seek professional advice for litigation."
                    }
                }
            }
        }
    };
    document(&state, &META, body, Some(scripts::CASE_LAW_DB))
}
