//! `/` — the analysis workspace (`src/app/page.tsx` + `ClaimInputPanel`).

use crate::state::SharedState;
use crate::ui::components::{button_classes, card, claim_type_options, ButtonSize, ButtonVariant, CardVariant};
use crate::ui::layout::{document, PageMeta};
use crate::ui::scripts;
use axum::extract::State;
use maud::{html, Markup};

const META: PageMeta = PageMeta::root("/");
const LABEL: &str = "display:block;font-size:0.7rem;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.1em;color:var(--color-text-muted);margin-bottom:0.5rem";

const TRUST_SIGNALS: [(&str, &str); 4] = [
    ("UK GDPR Aligned", "Data processed lawfully under UK GDPR and Data Protection Act 2018. Privacy notice and data handling details available."),
    ("Epistemic Quarantine", "Every legal proposition verified against curated authorities. Ungrounded claims stripped, not flagged."),
    ("Open Reasoning", "All analysis steps visible. Trust indicators (VERIFIED / CHECK / QUARANTINED) show confidence level for each proposition."),
    ("ERA 2025 Current", "All ten claim type schemas updated for Employment Rights Act 2025 provisions. Commencement tracker maintained."),
];

fn claim_input_panel() -> Markup {
    html! {
        div style="margin-top:4rem" {
            div style="display:flex;align-items:center;gap:1rem;margin-bottom:2rem" {
                span style="width:6px;height:6px;border-radius:50%;background:var(--color-accent-purple)" {}
                span class="text-subhead" style="margin-bottom:0;color:var(--color-accent-purple);font-size:0.7rem;letter-spacing:0.2em" { "SYSTEM OPERATIONAL" }
            }
            h1 class="text-hero" { "Legal work," br; span style="font-style:italic;opacity:0.8" { "structured." } }
            p class="text-lead" style="margin-bottom:4rem;border-left:1px solid var(--color-border-subtle);padding-left:2rem;margin-left:4px" {
                "Schema-driven case analysis for UK employment tribunal litigants-in-person. Identify applicable legal tests, surface verified authorities, and calculate procedural deadlines — updated for ERA 2025."
            }
            p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary);margin-bottom:1rem;opacity:0.7;padding-left:2rem" {
                "This tool provides legal information, not legal advice. It does not create a solicitor-client relationship. By using this tool, you agree to our "
                a href="/privacy" style="color:var(--color-accent-purple);text-decoration:underline" { "Privacy Policy" }
                " and "
                a href="/terms" style="color:var(--color-accent-purple);text-decoration:underline" { "Terms of Use" }
                ". Your data is processed in accordance with UK GDPR. "
                a href="/security" style="color:var(--color-accent-purple);text-decoration:underline" { "Learn more" }
                "."
            }
            (card(CardVariant::Glass, "", Some("transform:translateX(2rem)"), html! {
                div style="display:flex;flex-direction:column;gap:1.5rem" {
                    div {
                        label for="claim-type" style=(LABEL) { "Claim Type" }
                        select id="claim-type" style="width:100%;padding:1rem;font-size:1.1rem;border-radius:var(--radius-card);background:rgba(255,255,255,0.02);border:1px solid var(--color-border-subtle);color:var(--color-text-primary);outline:none" {
                            (claim_type_options("unfair_dismissal"))
                        }
                    }
                    div {
                        label for="date-of-act" style=(LABEL) { "Date of Act" }
                        input id="date-of-act" type="date" value="" style="width:100%;padding:0.8rem;border-radius:var(--radius-card);background:rgba(255,255,255,0.02);border:1px solid var(--color-border-subtle);color:var(--color-text-primary);outline:none;color-scheme:dark";
                        p style="font-size:0.65rem;color:var(--color-text-secondary);margin-top:0.5rem" { "Determines whether ERA 2025 rules apply." }
                    }
                    div {
                        label for="facts-narrative" style=(LABEL) { "Facts" }
                        textarea id="facts-narrative" rows="3" placeholder="Describe what happened..." style="width:100%;padding:1rem;border-radius:var(--radius-card);background:rgba(0,0,0,0.2);border:1px solid var(--color-border-subtle);color:var(--color-text-primary);outline:none;resize:none" {}
                    }
                    div style="padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:var(--radius-card);border:1px solid rgba(255,255,255,0.06)" {
                        label style="display:flex;gap:0.75rem;align-items:flex-start;cursor:pointer" {
                            input id="consent" type="checkbox" style="margin-top:2px;accent-color:var(--color-accent-purple);width:14px;height:14px;flex-shrink:0";
                            span style="font-size:0.7rem;color:var(--color-text-secondary);line-height:1.5" {
                                "I understand this tool provides " strong { "legal information, not legal advice" } ". I consent to my case description being processed by Tribunal Harness and Anthropic in accordance with the "
                                a href="/privacy" style="color:var(--color-accent-purple);text-decoration:underline" { "Privacy Policy" }
                                " and "
                                a href="/terms" style="color:var(--color-accent-purple);text-decoration:underline" { "Terms of Use" }
                                "."
                            }
                        }
                    }
                    div style="display:flex;gap:1rem;align-items:center" {
                        button type="button" id="run-analysis" class=(button_classes(ButtonVariant::Primary, ButtonSize::Md)) style="flex-shrink:0" disabled { "Run Analysis" }
                        div id="drop-zone" class="drop-zone-inline" style="flex:1;padding:0.8rem 1.5rem;border-radius:var(--radius-card);border:1px dashed rgba(255,255,255,0.1);text-align:center;cursor:pointer;color:var(--color-text-secondary);font-size:0.8rem;transition:all 0.2s ease;background:transparent" {
                            "Upload Document (PDF/DOCX)"
                        }
                    }
                }
            }))
        }
    }
}

pub async fn page(State(state): State<SharedState>) -> Markup {
    let body = html! {
        div style="min-height:100vh;position:relative;overflow:hidden;padding-top:8rem" {
            div style="position:absolute;top:-20%;right:-10%;width:800px;height:800px;background:radial-gradient(circle, rgba(139, 92, 246, 0.05) 0%, transparent 70%);pointer-events:none" {}
            div style="max-width:1200px;margin:0 auto;padding:0 2rem;min-height:60vh" {
                div id="stage-input" class="stage-enter" { (claim_input_panel()) }
                div id="stage-analyzing" class="stage-enter" hidden style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:40vh" {
                    div style="position:relative;width:80px;height:80px;margin-bottom:2rem" {
                        div style="position:absolute;inset:0;border-top:2px solid var(--color-accent-purple);border-radius:50%;animation:spin 1s linear infinite" {}
                        div style="position:absolute;inset:8px;border-right:2px solid rgba(255,255,255,0.2);border-radius:50%;animation:spin 1.5s linear infinite reverse" {}
                        div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center" {
                            div style="width:12px;height:12px;background:var(--color-accent-purple);border-radius:50%;animation:pulse 2s ease-in-out infinite" {}
                        }
                    }
                    h2 style="font-family:var(--font-serif);font-size:1.5rem;margin-bottom:0.5rem" { "Analysing Case Elements" }
                    p style="font-family:var(--font-mono);font-size:0.85rem;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.1em" { "Running statutory & precedent checks" }
                }
                div id="stage-results" class="stage-enter" hidden {
                    div style="display:flex;justify-content:flex-end;margin-bottom:2rem" {
                        button type="button" id="new-analysis" class=(button_classes(ButtonVariant::Outline, ButtonSize::Sm)) { "New Analysis" }
                    }
                    div id="results-panel" {}
                }
            }

            section id="trust-signals" class="page-section" style="border-top:1px solid var(--color-border-subtle);margin-top:4rem" {
                div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:2rem;max-width:1400px;margin:0 auto;padding:0 2rem" {
                    @for (title, desc) in TRUST_SIGNALS {
                        div style="padding:2rem;border:1px solid var(--color-border-subtle);border-radius:var(--radius-card);background:rgba(255,255,255,0.02)" {
                            h4 style="font-family:var(--font-sans);font-size:0.85rem;font-weight:700;margin-bottom:0.5rem;color:white" { (title) }
                            p style="font-size:0.8rem;color:var(--color-text-secondary);line-height:1.6" { (desc) }
                        }
                    }
                }
            }

            p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary);text-align:center;opacity:0.6;padding:2rem 1rem;max-width:800px;margin:0 auto" {
                "This tool provides legal information, not legal advice. It does not create a solicitor-client relationship."
            }
        }
    };
    document(&state, &META, body, Some(scripts::HOME))
}
