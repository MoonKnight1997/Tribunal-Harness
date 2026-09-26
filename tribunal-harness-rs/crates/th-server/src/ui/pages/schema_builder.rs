//! `/schema-builder` — custom (unverified) schema sketching.

use crate::state::SharedState;
use crate::ui::layout::{document, PageMeta};
use crate::ui::scripts;
use axum::extract::State;
use maud::{html, Markup};

const META: PageMeta = PageMeta::root("/schema-builder");

const FIELD_TYPES: [(&str, &str); 6] = [("text", "Text"), ("date", "Date"), ("textarea", "Text Area"), ("select", "Select"), ("boolean", "Yes/No"), ("number", "Number")];

pub async fn page(State(state): State<SharedState>) -> Markup {
    let body = html! {
        div style="padding-top:10rem" {
            div class="page-section" {
                span class="text-subhead" { "CUSTOM" }
                h1 style="font-family:var(--font-serif);font-size:3rem;margin-bottom:1.5rem" { "Schema Builder" }
                p class="text-lead" style="margin-bottom:3rem" { "Build custom claim schemas for claim types not yet in the system. Define fields, set types, and export as JSON for integration." }

                div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem" {
                    div class="interface-card" {
                        h3 style="font-family:var(--font-serif);font-size:1.5rem;margin-bottom:1.5rem" { "Add Field" }
                        div class="input-group" {
                            label class="input-label" for="sb-label" { "Field Label" }
                            input id="sb-label" class="input-field" placeholder="e.g., Date of Notice";
                        }
                        div class="input-group" {
                            label class="input-label" for="sb-type" { "Field Type" }
                            select id="sb-type" class="input-field" {
                                @for (value, label) in FIELD_TYPES { option value=(value) { (label) } }
                            }
                        }
                        button type="button" id="sb-add" class="btn-primary" { "Add Field" }
                    }
                    div class="interface-card" {
                        h3 id="sb-title" style="font-family:var(--font-serif);font-size:1.5rem;margin-bottom:1.5rem" { "Schema Preview (0 fields)" }
                        div id="sb-preview" { p style="color:var(--color-text-secondary);font-size:0.85rem" { "No fields added yet." } }
                    }
                }

                div style="margin-top:2rem;padding:1.5rem;border:1px solid #fbbf24;border-radius:var(--radius-card);background:rgba(251,191,36,0.03)" {
                    p style="font-family:var(--font-mono);font-size:0.75rem;color:#fbbf24;font-weight:600;margin-bottom:0.5rem" { "IMPORTANT" }
                    p style="font-size:0.85rem;color:var(--color-text-secondary);line-height:1.7" {
                        "Custom schemas are user-defined and are not verified against statute. They do not carry the same trust guarantees as the built-in claim type schemas, which are curated and maintained by a qualified legal professional. Use custom schemas for exploratory purposes only."
                    }
                }

                p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary);margin-top:3rem;text-align:center;opacity:0.6" {
                    "This tool provides legal information, not legal advice. It does not create a solicitor-client relationship."
                }
            }
        }
    };
    document(&state, &META, body, Some(scripts::SCHEMA_BUILDER))
}
