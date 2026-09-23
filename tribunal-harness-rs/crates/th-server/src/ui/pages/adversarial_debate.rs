//! `/adversarial-debate` — the three-agent debate workspace.

use crate::state::SharedState;
use crate::ui::components::{badge, button_classes, card, claim_type_options, BadgeVariant, ButtonSize, ButtonVariant, CardVariant};
use crate::ui::layout::{document, PageMeta};
use crate::ui::scripts;
use axum::extract::State;
use maud::{html, Markup};
use th_core::ui_view::debate_modes::{DebateMode, DEBATE_MODES};

const META: PageMeta = PageMeta::root("/adversarial-debate");
const LABEL: &str = "display:block;font-size:0.7rem;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.1em;color:var(--color-text-muted);margin-bottom:0.5rem";

fn input_card() -> Markup {
    card(
        CardVariant::Glass,
        "",
        None,
        html! {
            div style="display:flex;flex-direction:column;gap:1.5rem" {
                div {
                    label for="debate-claim-type" style=(LABEL) { "Claim Type" }
                    select id="debate-claim-type" style="width:100%;padding:1rem;font-size:1.1rem;border-radius:var(--radius-card);background:rgba(255,255,255,0.02);border:1px solid var(--color-border-subtle);color:var(--color-text-primary);outline:none" {
                        (claim_type_options("unfair_dismissal"))
                    }
                }
                div {
                    label for="debate-facts" style=(LABEL) { "Facts" }
                    textarea id="debate-facts" rows="5" placeholder="Describe what happened — the more specific the facts, the sharper the critique..." style="width:100%;padding:1rem;border-radius:var(--radius-card);background:rgba(0,0,0,0.2);border:1px solid var(--color-border-subtle);color:var(--color-text-primary);outline:none;resize:vertical" {}
                }
                div {
                    span style=(LABEL) { "Debate Mode" }
                    div role="radiogroup" aria-label="Debate mode" style="display:flex;flex-direction:column;gap:0.75rem" {
                        @for opt in DEBATE_MODES.iter() {
                            @let selected = opt.id == DebateMode::SinglePass;
                            label class=(format!("mode-option{}", if selected { " selected" } else { "" })) style="display:flex;gap:0.85rem;align-items:flex-start;cursor:pointer;padding:1rem;border-radius:var(--radius-card);transition:all 0.2s ease" {
                                input type="radio" name="debate-mode" value=(opt.id.as_str()) checked[selected] style="margin-top:3px;accent-color:var(--color-accent-purple);width:16px;height:16px;flex-shrink:0";
                                div style="flex:1" {
                                    div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.6rem;margin-bottom:0.35rem" {
                                        span style="font-size:0.95rem;font-weight:600;color:var(--color-text-primary)" { (opt.label) }
                                        (badge(if opt.higher_cost { BadgeVariant::Warning } else { BadgeVariant::Neutral }, "", html! { (opt.cost_tag) }))
                                    }
                                    p style="font-size:0.8rem;color:var(--color-text-secondary);margin:0 0 0.5rem 0;line-height:1.5" { (opt.description) }
                                    p style=(format!("font-size:0.72rem;font-family:var(--font-mono);margin:0;line-height:1.5;color:{}", if opt.higher_cost { "#f59e0b" } else { "var(--color-text-muted)" })) {
                                        (if opt.higher_cost { "⚠ " } else { "" }) (opt.cost_note)
                                    }
                                }
                            }
                        }
                    }
                }
                div style="padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:var(--radius-card);border:1px solid rgba(255,255,255,0.06)" {
                    label style="display:flex;gap:0.75rem;align-items:flex-start;cursor:pointer" {
                        input id="debate-consent" type="checkbox" style="margin-top:2px;accent-color:var(--color-accent-purple);width:14px;height:14px;flex-shrink:0";
                        span style="font-size:0.7rem;color:var(--color-text-secondary);line-height:1.5" {
                            "I understand this tool provides " strong { "legal information, not legal advice" } ". I consent to my case description being processed by Tribunal Harness and Anthropic in accordance with the "
                            a href="/privacy" style="color:var(--color-accent-purple);text-decoration:underline" { "Privacy Policy" }
                            " and "
                            a href="/terms" style="color:var(--color-accent-purple);text-decoration:underline" { "Terms of Use" }
                            "."
                        }
                    }
                }
                button type="button" id="run-debate" class=(button_classes(ButtonVariant::Primary, ButtonSize::Md)) style="align-self:flex-start" disabled { "Run Single-Pass Debate" }
            }
        },
    )
}

pub async fn page(State(state): State<SharedState>) -> Markup {
    let body = html! {
        div style="min-height:100vh;position:relative;overflow:hidden;padding-top:8rem" {
            div style="position:absolute;top:-20%;right:-10%;width:800px;height:800px;background:radial-gradient(circle, rgba(139, 92, 246, 0.05) 0%, transparent 70%);pointer-events:none" {}
            div style="max-width:1000px;margin:0 auto;padding:0 2rem" {
                div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem" {
                    span style="width:6px;height:6px;border-radius:50%;background:var(--color-accent-purple)" {}
                    span class="text-subhead" style="margin-bottom:0;color:var(--color-accent-purple);font-size:0.7rem;letter-spacing:0.2em" { "ADVERSARIAL SHADOW-OPPONENT" }
                }
                h1 class="text-hero" style="margin-bottom:1.5rem" { "Stress-test your" br; span style="font-style:italic;opacity:0.8" { "argument." } }
                p class="text-lead" style="margin-bottom:1.5rem;border-left:1px solid var(--color-border-subtle);padding-left:2rem;margin-left:4px" {
                    "Three agents debate your case before you do: a Drafter builds the strongest version, a Critic attacks it as opposing counsel would, and a Judge scores its viability. Choose how hard you want it pushed."
                }
                p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary);margin-bottom:2.5rem;opacity:0.7;padding-left:2rem" {
                    "This tool provides legal information, not legal advice. It does not create a solicitor-client relationship. By using it, you agree to our "
                    a href="/privacy" style="color:var(--color-accent-purple);text-decoration:underline" { "Privacy Policy" }
                    " and "
                    a href="/terms" style="color:var(--color-accent-purple);text-decoration:underline" { "Terms of Use" }
                    ". Your case description is processed in accordance with UK GDPR."
                }

                div id="debate-idle" class="stage-enter" { (input_card()) }

                div id="debate-running" class="stage-enter" hidden style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:40vh" {
                    div style="position:relative;width:80px;height:80px;margin-bottom:2rem" {
                        div style="position:absolute;inset:0;border-top:2px solid var(--color-accent-purple);border-radius:50%;animation:spin 1s linear infinite" {}
                        div style="position:absolute;inset:8px;border-right:2px solid rgba(255,255,255,0.2);border-radius:50%;animation:spin 1.5s linear infinite reverse" {}
                    }
                    h2 id="running-title" style="font-family:var(--font-serif);font-size:1.5rem;margin-bottom:0.5rem" { "Running the Debate" }
                    p id="running-subtitle" style="font-family:var(--font-mono);font-size:0.8rem;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.1em;text-align:center" { "Drafter → Critic → Judge" }
                }

                div id="debate-done" class="stage-enter" hidden {
                    div style="display:flex;justify-content:flex-end;margin-bottom:1.5rem" {
                        button type="button" id="new-debate" class=(button_classes(ButtonVariant::Outline, ButtonSize::Sm)) { "New Debate" }
                    }
                    div id="debate-error" hidden {
                        (card(CardVariant::Wireframe, "", Some("border-color:rgba(239, 68, 68, 0.3)"), html! {
                            h3 style="color:var(--color-error-coral);margin-bottom:0.5rem" { "Debate couldn't finish" }
                            p id="debate-error-text" style="color:var(--color-text-secondary);font-size:0.9rem;line-height:1.6" {}
                        }))
                    }
                    div id="debate-results" hidden {}
                }
            }

            p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary);text-align:center;opacity:0.6;padding:3rem 1rem 2rem;max-width:800px;margin:0 auto" {
                "This tool provides legal information, not legal advice. It does not create a solicitor-client relationship."
            }
        }
    };
    document(&state, &META, body, Some(scripts::ADVERSARIAL_DEBATE))
}
