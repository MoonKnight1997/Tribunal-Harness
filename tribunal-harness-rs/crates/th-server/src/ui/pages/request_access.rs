//! `/request-access` — interest-capture form.

use crate::state::SharedState;
use crate::ui::layout::{document, PageMeta};
use crate::ui::scripts;
use axum::extract::State;
use maud::{html, Markup};

const META: PageMeta = PageMeta::root("/request-access");

const USER_TYPES: [(&str, &str); 5] = [("lip", "Litigant-in-Person"), ("solicitor", "Solicitor"), ("legal_aid", "Legal Aid Provider"), ("researcher", "Researcher"), ("other", "Other")];

pub async fn page(State(state): State<SharedState>) -> Markup {
    let body = html! {
        div id="request-access-thanks" class="page-section" style="padding-top:10rem;max-width:600px;text-align:center" hidden {
            div style="font-size:3rem;margin-bottom:1rem" { "✓" }
            h1 style="font-family:var(--font-serif);font-size:2.5rem;margin-bottom:1rem" { "Thank you." }
            p class="text-lead" style="margin:0 auto" { "We'll be in touch when Tribunal Harness launches. You'll be among the first to know." }
        }
        div id="request-access-main" class="page-section" style="padding-top:10rem;max-width:600px" {
            span class="text-subhead" { "EARLY ACCESS" }
            h1 style="font-family:var(--font-serif);font-size:3rem;margin-bottom:1.5rem" { "Request Access" }
            p class="text-lead" style="margin-bottom:3rem" { "Tribunal Harness is currently in development. Register your interest to be notified when it launches." }

            form id="request-access-form" class="interface-card" {
                div class="input-group" {
                    label for="form-name" class="input-label" { "Name" }
                    input id="form-name" class="input-field" required;
                }
                div class="input-group" {
                    label for="form-email" class="input-label" { "Email" }
                    input id="form-email" class="input-field" type="email" required;
                }
                div class="input-group" {
                    label for="form-user-type" class="input-label" { "I am a..." }
                    select id="form-user-type" class="input-field" {
                        @for (value, label) in USER_TYPES { option value=(value) { (label) } }
                    }
                }
                div class="input-group" {
                    label for="form-description" class="input-label" { "Tell us about your situation (optional)" }
                    textarea id="form-description" class="input-field" rows="4" style="resize:vertical" {}
                }
                div class="input-group" style="display:flex;gap:0.75rem;align-items:start;margin-top:1.5rem" {
                    input type="checkbox" required id="privacy_consent" style="margin-top:0.25rem";
                    label for="privacy_consent" style="font-size:0.8rem;color:var(--color-text-secondary);line-height:1.5" {
                        "I agree to the "
                        a href="/privacy" style="color:var(--color-accent-purple);text-decoration:underline" { "Privacy Policy" }
                        " and "
                        a href="/terms" style="color:var(--color-accent-purple);text-decoration:underline" { "Terms of Use" }
                        ", and consent to my data being processed to manage this access request."
                    }
                }
                p id="request-access-error" style="color:var(--color-error-coral);font-size:0.85rem;margin-bottom:1rem" hidden {}
                button type="submit" class="btn-primary" { "Submit Request" }
            }

            p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary);margin-top:2rem;text-align:center;opacity:0.6" {
                "This tool provides legal information, not legal advice. It does not create a solicitor-client relationship."
            }
        }
    };
    document(&state, &META, body, Some(scripts::REQUEST_ACCESS))
}
