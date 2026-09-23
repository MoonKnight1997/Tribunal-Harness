//! Institutional / marketing pages — LIGHT theme (`.theme-light` wrapper):
//! about, blog (Insights), contact, documentation, how-it-works, pricing.

use super::{mono_note, page_intro};
use crate::state::SharedState;
use crate::ui::components::era_tracker_table;
use crate::ui::layout::{document, PageMeta};
use axum::extract::State;
use maud::{html, Markup};
use th_core::constants::{TrackerStatus, CLAIM_TYPES, ERA_2025_TRACKER};

const PURPLE_LINK: &str = "color:var(--color-accent-purple);text-decoration:underline";

pub async fn about(State(state): State<SharedState>) -> Markup {
    const META: PageMeta = PageMeta { title: "About | Tribunal Harness", description: "Closing the information asymmetry between litigants-in-person and represented parties.", path: "/about" };
    let body = html! {
        div class="theme-light page-section" style="padding-top:10rem;max-width:800px" {
            (page_intro("MISSION", "Closing the information gap."))
            div style="color:var(--color-text-secondary);line-height:1.9;font-size:1.05rem" {
                p style="margin-bottom:1.5rem" {
                    "UK employment tribunals are designed to be accessible to litigants-in-person. In practice, the information asymmetry between an unrepresented claimant and a respondent with solicitors is enormous. In the author's experience, a LiP can spend 40+ hours of manual research just to understand whether they have a viable claim."
                }
                p style="margin-bottom:1.5rem" {
                    "Tribunal Harness was built by a qualified lawyer (LLM with Distinction) and active litigant-in-person with direct experience of every gap this tool addresses. The thesis is simple: the bottleneck for LiPs is not AI intelligence — it's infrastructure."
                }
                p style="margin-bottom:1.5rem" {
                    "LiPs don't need a chatbot. They need structured analysis that tells them which legal tests apply, what facts they need to prove, what authorities support them, and what procedural steps come next. They need to know what they don't know — and that's what the schema-driven approach delivers."
                }
                p {
                    "The Employment Rights Act 2025 represents the most significant overhaul of UK employment law in decades. Tribunal Harness was built to be ERA 2025-ready from day one — not retrofitted after the changes take effect."
                }
            }
            div style="margin-top:4rem;padding:2rem;border:1px solid var(--color-border-subtle);border-radius:var(--radius-card)" {
                h3 style="font-family:var(--font-serif);font-size:1.5rem;margin-bottom:1rem" { "Principles" }
                ul style="list-style:none;color:var(--color-text-secondary);line-height:2.2;font-size:0.9rem" {
                    li { "→ Legal information, not legal advice" }
                    li { "→ Epistemic honesty over confident-sounding guesses" }
                    li { "→ Schema-driven analysis over free-form chat" }
                    li { "→ Verified citations or nothing" }
                    li { "→ The infrastructure thesis: the bottleneck is tooling, not intelligence" }
                }
            }
            (mono_note("3rem", html! { "This tool provides legal information, not legal advice. The author is not practising as a solicitor or barrister via this platform." }))
        }
    };
    document(&state, &META, body, None)
}

pub async fn blog(State(state): State<SharedState>) -> Markup {
    const META: PageMeta = PageMeta { title: "Insights | Tribunal Harness", description: "Articles on employment law, legal technology, and building in public.", path: "/blog" };
    let body = html! {
        div class="theme-light page-section" style="padding-top:10rem;max-width:800px" {
            (page_intro("INSIGHTS", "Insights"))
            p class="text-lead" style="margin-bottom:3rem" { "Analysis, commentary, and technical deep-dives on UK employment law and legal technology." }
            div class="interface-card" style="text-align:center;padding:4rem 2rem" {
                p style="color:var(--color-text-secondary);margin-bottom:1.5rem;line-height:1.7" {
                    "Our first articles — covering ERA 2025 implementation timelines, epistemic quarantine in legal AI, and schema-driven analysis methodology — are currently in preparation."
                }
                p style="color:var(--color-text-secondary);font-size:0.85rem" {
                    "To be notified when we publish, "
                    a href="/request-access" style="color:var(--color-accent-purple)" { "register your interest" }
                    " or contact "
                    a href="mailto:hello@tribunalharness.co.uk" style="font-family:var(--font-mono);color:var(--color-accent-purple);text-decoration:underline" { "hello@tribunalharness.co.uk" }
                    "."
                }
            }
            p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary);margin-top:2rem;opacity:0.6" {
                "Content published here will constitute legal information, not legal advice. Always verify information against primary sources and current legislation."
            }
        }
    };
    document(&state, &META, body, None)
}

pub async fn contact(State(state): State<SharedState>) -> Markup {
    const META: PageMeta = PageMeta { title: "Contact | Tribunal Harness", description: "Get in touch with the Tribunal Harness team.", path: "/contact" };
    let mail = |addr: &str| html! { a href=(format!("mailto:{addr}")) style="font-family:var(--font-mono);font-size:0.85rem;color:var(--color-accent-purple);text-decoration:underline" { (addr) } };
    let h4 = |t: &str| html! { h4 style="font-family:var(--font-sans);font-weight:600;margin-bottom:0.5rem" { (t) } };
    let body = html! {
        div class="theme-light page-section" style="padding-top:10rem;max-width:700px" {
            (page_intro("REACH OUT", "Contact"))
            p class="text-lead" style="margin-bottom:3rem" { "Questions, feedback, partnership enquiries, or legal aid verification requests." }
            div class="interface-card" style="margin-bottom:2rem" {
                div style="display:grid;gap:1.5rem" {
                    div { (h4("General Enquiries")) (mail("hello@tribunalharness.co.uk")) }
                    div { (h4("Legal Aid Verification")) (mail("legalaid@tribunalharness.co.uk")) }
                    div {
                        (h4("Data Protection")) (mail("dpo@tribunalharness.co.uk"))
                        a href="/privacy" style="font-size:0.75rem;color:var(--color-text-secondary);text-decoration:underline;display:block;margin-top:0.25rem" { "View Privacy Policy" }
                    }
                    div { (h4("Technical / API")) (mail("dev@tribunalharness.co.uk")) }
                }
            }
            p style="font-family:var(--font-mono);font-size:0.75rem;color:var(--color-text-secondary);text-align:center;margin-bottom:1.5rem" {
                "We aim to respond within 48 hours. For urgent deadline queries, please state your ET1 deadline in the subject line."
            }
            p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary);text-align:center;opacity:0.6" {
                "Tribunal Harness provides legal information, not legal advice. Contact us for product enquiries only — we cannot provide legal advice or case-specific guidance. See our "
                a href="/terms" style=(PURPLE_LINK) { "Terms of Use" }
                " and "
                a href="/privacy" style=(PURPLE_LINK) { "Privacy Policy" }
                "."
            }
        }
    };
    document(&state, &META, body, None)
}

pub async fn documentation(State(state): State<SharedState>) -> Markup {
    const META: PageMeta = PageMeta { title: "Documentation | Tribunal Harness", description: "Architecture overview, claim types, trust indicators, and ERA 2025 Implementation Tracker.", path: "/documentation" };
    let body = html! {
        div class="theme-light" style="padding-top:10rem" {
            div class="page-section" {
                (page_intro("REFERENCE", "Documentation"))
                p class="text-lead" style="margin-bottom:4rem" { "Architecture overview, supported claim types, and the ERA 2025 Implementation Tracker." }

                div style="margin-bottom:4rem" {
                    h2 style="font-family:var(--font-serif);font-size:2rem;margin-bottom:1rem" { "Getting Started" }
                    div style="color:var(--color-text-secondary);line-height:1.8" {
                        p { "1. Navigate to the main page and select your claim type from the dropdown — including ERA 2025 claim types marked with ★." }
                        p { "2. Enter the date of the last act complained of — the deadline calculator will apply the correct regime." }
                        p { "3. Confirm you have read the terms and consent to data processing." }
                        p { "4. Describe the facts of your case in the narrative field." }
                        p { "5. Click \"Run Analysis\" to generate a structured assessment, or upload a document for automatic triage." }
                        p { "6. Review the output — trust indicators show the verification status of each legal proposition." }
                    }
                }

                div style="margin-bottom:4rem" {
                    h2 style="font-family:var(--font-serif);font-size:2rem;margin-bottom:1.5rem" { "Claim Types Supported" }
                    div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem" {
                        @for ct in CLAIM_TYPES.iter() {
                            div style="padding:1rem;border:1px solid var(--color-border-subtle);border-radius:6px;display:flex;justify-content:space-between;align-items:center" {
                                div {
                                    span style="font-weight:500" { (ct.label) }
                                    span style="font-family:var(--font-mono);font-size:0.75rem;color:var(--color-text-secondary);margin-left:0.75rem" { (ct.statute) }
                                }
                                @if ct.era2025 { span style="font-family:var(--font-mono);font-size:0.65rem;color:var(--color-accent-purple);font-weight:600" { "ERA 2025" } }
                            }
                        }
                    }
                }
            }

            div class="page-section" style="border-top:1px solid var(--color-border-subtle)" {
                span class="text-subhead" { "LEGISLATIVE CHANGE" }
                h2 style="font-family:var(--font-serif);font-size:2.5rem;margin-bottom:1.5rem" { "ERA 2025 Implementation Tracker" }
                p style="color:var(--color-text-secondary);margin-bottom:2rem;font-size:0.85rem" { "Provisions marked \"SI awaited\" have no confirmed commencement date. Do not rely on estimated dates for these provisions." }
                (era_tracker_table())
            }

            div style="margin-top:4rem;padding:1rem;border-top:1px solid var(--color-border-subtle);text-align:center" {
                p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary);opacity:0.6" {
                    "This tool provides legal information, not legal advice. Timelines and dates should be verified against official sources and current Statutory Instruments."
                }
            }
        }
    };
    document(&state, &META, body, None)
}

const STEPS: [(&str, &str, &str); 4] = [
    ("01", "Describe Your Situation", "Upload documents (dismissal letter, contract, grievance correspondence) or write a narrative. The system accepts PDF, DOCX, and TXT."),
    ("02", "System Identifies Claims", "The triage agent maps your facts against 10 claim type schemas — including two new ERA 2025 claim types. It identifies which legal tests are met and which facts are missing."),
    ("03", "Verified Research", "Every legal proposition is checked against our curated vector database. Trust indicators show what is VERIFIED (green), needs CHECKING (amber), or is QUARANTINED (red)."),
    ("04", "Procedural Roadmap", "See your full procedural journey from pre-action through to the Court of Appeal. Key deadlines are calculated automatically — with ERA 2025 time limit changes applied."),
];

const FEATURED_KEYS: [&str; 6] = ["INDUSTRIAL_ACTION_DISMISSAL", "SEXUAL_HARASSMENT_WHISTLEBLOWING", "ET_TIME_LIMIT_6_MONTHS", "HARASSMENT_ALL_REASONABLE_STEPS", "QUALIFYING_PERIOD_6_MONTHS", "FIRE_AND_REHIRE_AUTO_UNFAIR"];

pub async fn how_it_works(State(state): State<SharedState>) -> Markup {
    const META: PageMeta = PageMeta { title: "How It Works | Tribunal Harness", description: "Step-by-step walkthrough of how Tribunal Harness analyses employment tribunal claims.", path: "/how-it-works" };
    let body = html! {
        div class="theme-light" style="padding-top:10rem" {
            div class="page-section" {
                (page_intro("PROCESS", "Four steps to structured analysis."))
                p class="text-lead" style="margin-bottom:4rem" { "From raw facts to structured legal information, efficiently." }
                div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem" {
                    @for (num, title, desc) in STEPS {
                        div class="interface-card" {
                            span style="font-family:var(--font-mono);font-size:0.75rem;opacity:0.4" { (num) }
                            h3 style="font-family:var(--font-serif);font-size:1.5rem;margin:1rem 0 0.75rem" { (title) }
                            p style="color:var(--color-text-secondary);font-size:0.9rem;line-height:1.7" { (desc) }
                        }
                    }
                }
            }

            div class="page-section" style="border-top:1px solid var(--color-border-subtle)" {
                span class="text-subhead" { "ERA 2025" }
                h2 style="font-family:var(--font-serif);font-size:2.5rem;margin-bottom:1.5rem" { "Built for the new employment law landscape." }
                p style="color:var(--color-text-secondary);margin-bottom:3rem;max-width:700px;line-height:1.8" {
                    "The Employment Rights Act 2025 is the most significant overhaul of UK employment law in decades. Tribunal Harness is already updated for every change — from the extended time limits to the new fire-and-rehire protections."
                }
                div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:1.5rem" {
                    @for item in ERA_2025_TRACKER.iter().filter(|e| FEATURED_KEYS.contains(&e.key)) {
                        @let in_force = item.status == TrackerStatus::InForce;
                        div style="padding:1.5rem;border:1px solid var(--color-border-subtle);border-radius:var(--radius-card)" {
                            span style=(format!("font-family:var(--font-mono);font-size:0.7rem;color:{};font-weight:600", if in_force { "#2dd4bf" } else { "var(--color-accent-purple)" })) {
                                (if in_force { "IN FORCE".to_string() } else { item.commencement.to_uppercase() })
                            }
                            h4 style="font-family:var(--font-sans);font-size:0.95rem;font-weight:600;margin:0.75rem 0 0.5rem" { (item.provision) }
                            p style="color:var(--color-text-secondary);font-size:0.8rem;line-height:1.6" { (item.new_position) }
                        }
                    }
                }
                div style="margin-top:2rem;text-align:center" {
                    a href="/documentation" style="color:var(--color-accent-purple);font-size:0.85rem;font-weight:500" { "View full ERA 2025 Implementation Tracker →" }
                }
                (mono_note("3rem", html! { "This tool provides legal information, not legal advice. All outputs should be independently verified before reliance." }))
            }
        }
    };
    document(&state, &META, body, None)
}

struct Tier {
    name: &'static str,
    price: &'static str,
    period: &'static str,
    features: &'static [&'static str],
    highlight: bool,
}

const TIERS: [Tier; 3] = [
    Tier { name: "LiP Access", price: "Free", period: "during beta", features: &["10 claim analyses per month", "All 10 claim type schemas", "Deadline calculator", "ERA 2025 tracker", "Basic document triage"], highlight: false },
    Tier { name: "Professional", price: "£49", period: "/month", features: &["Unlimited analyses", "Adversarial Risk Analysis", "Advanced document triage", "Case law database search", "Custom Strategy Schemas", "Priority support"], highlight: true },
    Tier { name: "Legal Aid", price: "£0", period: "always free", features: &["Unlimited analyses", "Full feature access", "For verified legal aid providers", "Supporting access to justice", "Contact us to verify"], highlight: false },
];

pub async fn pricing(State(state): State<SharedState>) -> Markup {
    const META: PageMeta = PageMeta { title: "Pricing | Tribunal Harness", description: "Transparent pricing for litigants-in-person and legal professionals.", path: "/pricing" };
    let body = html! {
        div class="theme-light" style="padding-top:10rem" {
            div class="page-section" style="text-align:center;max-width:900px;margin:0 auto" {
                (page_intro("PRICING", "Transparent. Fair. Accessible."))
                p class="text-lead" style="margin:0 auto 4rem" {
                    "Access to justice shouldn't be gated by price. Our pricing is designed to make structured legal analysis accessible to everyone, with special rates for litigants-in-person."
                }
                div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:1.5rem;text-align:left" {
                    @for tier in TIERS.iter() {
                        div style=(format!("padding:2rem;border:1px solid {};border-radius:var(--radius-card);background:{}", if tier.highlight { "var(--color-accent-purple)" } else { "var(--color-border-subtle)" }, if tier.highlight { "rgba(139,92,246,0.03)" } else { "transparent" })) {
                            h3 style="font-family:var(--font-sans);font-weight:600;margin-bottom:0.75rem" { (tier.name) }
                            div style="margin-bottom:1.5rem" {
                                span style="font-family:var(--font-serif);font-size:2.5rem" { (tier.price) }
                                span style="color:var(--color-text-secondary);font-size:0.85rem" { " " (tier.period) }
                            }
                            ul style="list-style:none;font-size:0.85rem;color:var(--color-text-secondary);line-height:2.2" {
                                @for f in tier.features { li { "✓ " (f) } }
                            }
                            a href="/request-access" class="btn-primary" style="display:block;text-align:center;margin-top:1.5rem" { (if tier.highlight { "Get Started" } else { "Request Access" }) }
                        }
                    }
                }
                p style="margin-top:3rem;font-family:var(--font-mono);font-size:0.75rem;color:var(--color-text-secondary)" {
                    "All plans include ERA 2025 updates at no additional cost. See our "
                    a href="/privacy" style="color:var(--color-accent-purple)" { "Privacy Policy" }
                    " for data handling details."
                }
            }
            (mono_note("4rem", html! { "Tribunal Harness provides legal information tools, not legal advice or representation. Subscriptions do not create a solicitor-client relationship." }))
        }
    };
    document(&state, &META, body, None)
}
