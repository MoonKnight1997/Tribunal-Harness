//! `/analysis-engine` — schema explorer.

use crate::state::SharedState;
use crate::ui::components::schema_empty_state;
use crate::ui::layout::{document, PageMeta};
use crate::ui::scripts;
use axum::extract::State;
use maud::{html, Markup};
use th_core::constants::CLAIM_TYPES;

const META: PageMeta = PageMeta::root("/analysis-engine");

pub async fn page(State(state): State<SharedState>) -> Markup {
    let body = html! {
        div style="padding-top:10rem" {
            div class="page-section" {
                span class="text-subhead" { "TOOLING" }
                h1 style="font-family:var(--font-serif);font-size:3rem;margin-bottom:1.5rem" { "Analysis Engine" }
                p class="text-lead" style="margin-bottom:3rem" { "Select a claim type to load its schema, legal test, key authorities, and ERA 2025 annotations." }

                div style="display:grid;grid-template-columns:250px 1fr;gap:2rem" {
                    div style="display:flex;flex-direction:column;gap:0.5rem" {
                        @for ct in CLAIM_TYPES.iter() {
                            button type="button" class=(format!("ct-button{}", if ct.id == "unfair_dismissal" { " active" } else { "" })) data-ct=(ct.id) style="text-align:left;padding:0.75rem 1rem;border-radius:6px;cursor:pointer;color:inherit;font-size:0.85rem" {
                                (ct.label) " "
                                @if ct.era2025 { span style="color:var(--color-accent-purple)" { "★" } }
                            }
                        }
                    }
                    div id="schema-display" class="interface-card" { (schema_empty_state()) }
                }

                p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary);margin-top:2rem;opacity:0.6;text-align:center" {
                    "This tool provides legal information, not legal advice. Schema outputs are informational and should be independently verified."
                }
            }
        }
    };
    document(&state, &META, body, Some(scripts::ANALYSIS_ENGINE))
}
