//! Dark-theme reference / trust pages: era-2025, ethics, methodology,
//! privacy, product, security, terms.

use super::{mono_note, page_intro};
use crate::state::SharedState;
use crate::ui::components::era_tracker_table;
use crate::ui::layout::{document, PageMeta};
use axum::extract::State;
use maud::{html, Markup, PreEscaped};

const SECTION_H2: &str = "font-family:var(--font-sans);font-weight:600;font-size:1.2rem;color:var(--color-text-primary);margin-bottom:1rem";
const PURPLE: &str = "color:var(--color-accent-purple)";

pub async fn era_2025(State(state): State<SharedState>) -> Markup {
    const META: PageMeta = PageMeta {
        title: "ERA 2025 Tracker | Tribunal Harness",
        description: "Employment Rights Act 2025 commencement tracker — all provisions, dates, and status.",
        path: "/era-2025",
    };
    let body = html! {
        div style="padding-top:10rem" {
            div class="page-section" {
                (page_intro("LEGISLATIVE CHANGE", "ERA 2025 Implementation Tracker"))
                p class="text-lead" style="margin-bottom:1.5rem" {
                    "The Employment Rights Act 2025 is the most significant overhaul of UK employment law in decades. This tracker shows every provision, its commencement date, and current status."
                }
                p style="color:var(--color-text-secondary);margin-bottom:3rem;font-size:0.85rem;font-family:var(--font-mono)" {
                    "Provisions marked \"SI awaited\" have no confirmed commencement date. Do not rely on estimated dates for these provisions."
                }
                (era_tracker_table())
                div style="margin-top:3rem;padding:1rem;border-top:1px solid var(--color-border-subtle);text-align:center" {
                    p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary);opacity:0.6" {
                        "This tool provides legal information, not legal advice. Timelines and dates should be verified against official sources and current Statutory Instruments."
                    }
                }
            }
        }
    };
    document(&state, &META, body, None)
}

const ETHICS_ITEMS: [(&str, &str); 6] = [
    ("Epistemic Honesty", "We never present uncertain information as certain. Trust indicators are built into every output. Quarantined content is stripped, not flagged — eliminating the risk of users overlooking warnings."),
    ("Access to Justice", "Our free tier for litigants-in-person and permanent free access for legal aid providers reflect our belief that structured legal analysis should not be gated by ability to pay."),
    ("Transparency", "Every reasoning step is auditable. The system shows its working — which authorities it relied on, which schema elements it tested, and where gaps remain. There is no black box."),
    ("Data Minimisation", "We collect only what's necessary for analysis. Documents are parsed in-memory and discarded. API keys are never stored. Claim data is encrypted and retained only for session continuity."),
    ("Human Oversight", "The system identifies claims and presents analysis. It does not file claims, make submissions, or take any action without explicit human decision. The user is always in control."),
    ("Bias Mitigation", "Schema-driven analysis reduces the risk of LLM bias by forcing structured evaluation. Every element of the legal test must be addressed — the system cannot selectively ignore uncomfortable facts."),
];

pub async fn ethics(State(state): State<SharedState>) -> Markup {
    const META: PageMeta = PageMeta { title: "Ethics | Tribunal Harness", description: "Our ethical responsibilities building AI for legal contexts.", path: "/ethics" };
    let body = html! {
        div class="page-section" style="padding-top:10rem;max-width:800px" {
            (page_intro("RESPONSIBLE AI", "Ethics"))
            p class="text-lead" style="margin-bottom:3rem" { "Building AI for legal contexts carries extraordinary responsibility. Our ethical commitments are non-negotiable." }
            div style="padding:2rem;border:1px solid var(--color-error-coral);border-radius:var(--radius-card);margin-bottom:3rem;background:rgba(232,93,93,0.03)" {
                h3 style="font-family:var(--font-sans);font-weight:600;color:var(--color-error-coral);margin-bottom:0.75rem" { "This tool provides legal information, not legal advice." }
                p style="color:var(--color-text-secondary);line-height:1.8" {
                    "Tribunal Harness does not provide legal advice, does not create a solicitor-client relationship, and should not be treated as a substitute for qualified legal counsel. If your case is complex, high-value, or involves potential loss of livelihood, we strongly encourage seeking professional advice."
                }
            }
            @for (title, desc) in ETHICS_ITEMS {
                div style="margin-bottom:2rem" {
                    h3 style="font-family:var(--font-sans);font-weight:600;margin-bottom:0.5rem" { (title) }
                    p style="color:var(--color-text-secondary);line-height:1.8" { (desc) }
                }
            }
        }
    };
    document(&state, &META, body, None)
}

const METHODOLOGY_SECTIONS: [(&str, &str); 6] = [
    ("1. The Infrastructure Thesis", "The bottleneck for litigants-in-person is not AI intelligence — it's infrastructure. LiPs don't need smarter models; they need structured tools that show them what to prove, what authorities support them, and what steps come next. That's what schema-driven analysis delivers."),
    ("2. Epistemic Quarantine", "LLM training data is treated as untrusted by default. Every factual claim must be grounded in our curated vector database before it reaches you. Ungrounded claims are not flagged — they are stripped. In legal contexts, a confident-sounding but wrong citation is worse than no citation at all."),
    ("3. Schema-Driven Analysis", "No free-form chat. The system analyses facts against structured legal test schemas — one for each claim type. This forces complete coverage (every element of the test is addressed) and prevents the hallucination patterns that plague conversational legal AI."),
    ("4. Verified Citations Only", "Every authority cited is checked against official case reports. Trust indicators (VERIFIED / CHECK / QUARANTINED) show exactly how confident the system is. We'd rather show you nothing than show you something wrong."),
    ("5. Adversarial Testing", "Three agents stress-test every argument: Drafter advocates, Critic attacks, Judge scores. Only arguments passing 70% on a rubric covering legal accuracy, evidential sufficiency, and procedural compliance reach you."),
    ("6. ERA 2025 Dual-Regime Handling", "The deadline calculator applies the correct time limit regime based on the date of the act — pre or post ERA 2025. For dates near commencement boundaries, both regimes are shown with transitional warnings. Commencement dates are configurable and updated when Statutory Instruments confirm them."),
];

const DEBATE_SVG: &str = r##"<path d="M100 200 L300 200 L200 70 Z" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="2" stroke-dasharray="5 5"/><rect x="70" y="170" width="60" height="60" rx="8" fill="rgba(139,92,246,0.05)" stroke="var(--color-accent-purple)" stroke-width="1.5"/><text x="100" y="210" fill="var(--color-accent-purple)" font-size="10" font-family="var(--font-mono)" text-anchor="middle" letter-spacing="0.1em">DRAFTER</text><circle cx="100" cy="185" r="4" fill="var(--color-accent-purple)"/><rect x="270" y="170" width="60" height="60" rx="8" fill="rgba(45,212,191,0.05)" stroke="#2dd4bf" stroke-width="1.5"/><text x="300" y="210" fill="#2dd4bf" font-size="10" font-family="var(--font-mono)" text-anchor="middle" letter-spacing="0.1em">CRITIC</text><circle cx="300" cy="185" r="4" fill="#2dd4bf"/><rect x="170" y="50" width="60" height="60" rx="8" fill="rgba(251,191,36,0.05)" stroke="#fbbf24" stroke-width="1.5"/><text x="200" y="90" fill="#fbbf24" font-size="10" font-family="var(--font-mono)" text-anchor="middle" letter-spacing="0.1em">JUDGE</text><path d="M190 70 L210 70 M200 65 L200 75" fill="none" stroke="#fbbf24" stroke-width="1.5"/><path d="M130 190 L270 190" fill="none" stroke="var(--color-accent-purple)" stroke-width="1.5"/><polygon points="265,185 273,190 265,195" fill="var(--color-accent-purple)"/><path d="M270 210 L130 210" fill="none" stroke="#2dd4bf" stroke-width="1.5"/><polygon points="135,205 127,210 135,215" fill="#2dd4bf"/><path d="M115 170 L185 110" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/><polygon points="180,115 188,107 178,107" fill="rgba(255,255,255,0.4)"/><path d="M285 170 L215 110" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/><polygon points="220,115 212,107 222,107" fill="rgba(255,255,255,0.4)"/>"##;

pub async fn methodology(State(state): State<SharedState>) -> Markup {
    const META: PageMeta = PageMeta {
        title: "Methodology | Tribunal Harness",
        description: "How we build trustworthy legal AI — from epistemic quarantine to adversarial debate.",
        path: "/methodology",
    };
    let body = html! {
        div class="page-section" style="padding-top:10rem;max-width:800px" {
            (page_intro("TECHNICAL METHODOLOGY", "How we build trustworthy legal AI."))
            @for (title, content) in METHODOLOGY_SECTIONS {
                div style="margin-bottom:2.5rem" {
                    h3 style="font-family:var(--font-sans);font-weight:600;margin-bottom:0.75rem" { (title) }
                    p style="color:var(--color-text-secondary);line-height:1.8" { (content) }
                    @if title.contains("Adversarial Testing") {
                        svg viewBox="0 0 400 300" style="width:100%;margin-top:1.5rem;border-radius:8px;border:1px solid var(--color-border-subtle);background:rgba(0,0,0,0.3)" { (PreEscaped(DEBATE_SVG)) }
                    }
                }
            }
            (mono_note("3rem", html! { "This tool provides legal information, not legal advice. It does not constitute legal advice and should not be relied upon as a substitute for qualified legal representation." }))
        }
    };
    document(&state, &META, body, None)
}

pub async fn privacy(State(state): State<SharedState>) -> Markup {
    const META: PageMeta = PageMeta {
        title: "Privacy Policy | Tribunal Harness",
        description: "How Tribunal Harness collects, uses, and protects your personal data under UK GDPR.",
        path: "/privacy",
    };
    let dpo = || html! { a href="mailto:dpo@tribunalharness.co.uk" style=(PURPLE) { "dpo@tribunalharness.co.uk" } };
    let body = html! {
        div class="page-section" style="padding-top:10rem;max-width:800px" {
            (page_intro("LEGAL", "Privacy Policy"))
            p style="color:var(--color-text-secondary);margin-bottom:3rem;font-size:0.85rem" { "Last updated: 16 February 2026" }
            div style="color:var(--color-text-secondary);line-height:1.9;font-size:0.95rem" {
                section style="margin-bottom:3rem" {
                    h2 style=(SECTION_H2) { "1. Data Controller" }
                    p { "Tribunal Harness is operated as a sole trader venture. For the purposes of the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018, the data controller is Tribunal Harness." }
                    p style="margin-top:0.75rem" { "Data protection contact: " (dpo()) }
                }
                section style="margin-bottom:3rem" {
                    h2 style=(SECTION_H2) { "2. Data We Collect" }
                    p style="margin-bottom:1rem" { "We collect the following categories of personal data:" }
                    ul style="list-style:none;line-height:2.2" {
                        li { "• " strong { "Interest registration data" } ": name, email address, user type, and any description you provide when requesting access" }
                        li { "• " strong { "Case analysis data" } ": claim type selections, dates, and narrative text you enter for analysis" }
                        li { "• " strong { "Uploaded documents" } ": files you upload for triage (parsed in-memory and not retained after the session)" }
                        li { "• " strong { "Technical data" } ": IP address, browser type, and access logs (collected automatically)" }
                    }
                }
                section style="margin-bottom:3rem" {
                    h2 style=(SECTION_H2) { "3. Special Category Data" }
                    div style="padding:1.5rem;border:1px solid var(--color-error-coral);border-radius:var(--radius-card);background:rgba(232,93,93,0.03);margin-bottom:1rem" {
                        p {
                            "Employment tribunal claims may involve " strong { "special category data" } " under Article 9 UK GDPR, including health information (disability discrimination, reasonable adjustments), trade union membership (industrial action claims), racial or ethnic origin, sexual orientation, or religious beliefs."
                        }
                        p style="margin-top:0.75rem" {
                            "We process special category data only where you have provided it voluntarily for the purpose of receiving legal information about your employment situation. Our lawful basis for this processing is your"
                            strong { " explicit consent" } " (Article 9(2)(a) UK GDPR), given when you submit case details for analysis. You may withdraw consent at any time by contacting " (dpo()) "."
                        }
                    }
                }
                section style="margin-bottom:3rem" {
                    h2 style=(SECTION_H2) { "4. How We Use Your Data" }
                    ul style="list-style:none;line-height:2.2" {
                        li { "• " strong { "To provide analysis" } ": case data is processed to generate structured legal information (lawful basis: consent, Art. 6(1)(a))" }
                        li { "• " strong { "To manage access requests" } ": registration data is used to notify you of product availability (lawful basis: consent, Art. 6(1)(a))" }
                        li { "• " strong { "To improve the service" } ": anonymised, aggregated usage patterns may be used for product improvement (lawful basis: legitimate interests, Art. 6(1)(f))" }
                    }
                }
                section style="margin-bottom:3rem" {
                    h2 style=(SECTION_H2) { "5. Managed Proxy Architecture & Third-Party Data Processing" }
                    div style="padding:1.5rem;border:1px solid var(--color-accent-purple);border-radius:var(--radius-card);background:rgba(123,107,245,0.03);margin-bottom:1rem" {
                        p { "When you submit case details for analysis, your narrative text and claim information are sent to" strong { " Anthropic" } " (Anthropic PBC, San Francisco, USA) via their API for AI-assisted processing." }
                        p style="margin-top:0.75rem" { "This constitutes an international data transfer outside the UK. We rely on Anthropic's commitment to data protection safeguards, including their adherence to the UK International Data Transfer Agreement (IDTA). Anthropic's commercial API terms state that user inputs are not used for model training." }
                        p style="margin-top:0.75rem" { "No other third-party processors receive your personal data." }
                    }
                }
                section style="margin-bottom:3rem" {
                    h2 style=(SECTION_H2) { "6. Data Retention" }
                    ul style="list-style:none;line-height:2.2" {
                        li { "• " strong { "Uploaded documents" } ": parsed in-memory during the session, then discarded. Not retained." }
                        li { "• " strong { "Analysis results" } ": retained for session continuity only. Deleted when the session ends." }
                        li { "• " strong { "Access request data" } ": retained until product launch or for a maximum of 12 months, whichever is sooner." }
                        li { "• " strong { "Technical logs" } ": retained for a maximum of 30 days for security monitoring purposes." }
                    }
                }
                section style="margin-bottom:3rem" {
                    h2 style=(SECTION_H2) { "7. Your Rights" }
                    p style="margin-bottom:1rem" { "Under UK GDPR, you have the right to:" }
                    ul style="list-style:none;line-height:2.2" {
                        li { "• Access your personal data (Art. 15)" }
                        li { "• Rectify inaccurate data (Art. 16)" }
                        li { "• Request erasure (“right to be forgotten”) (Art. 17)" }
                        li { "• Restrict processing (Art. 18)" }
                        li { "• Data portability (Art. 20)" }
                        li { "• Object to processing based on legitimate interests (Art. 21)" }
                        li { "• Withdraw consent at any time (Art. 7(3))" }
                    }
                    p style="margin-top:1rem" { "To exercise any of these rights, contact " (dpo()) ". We will respond within one calendar month." }
                }
                section style="margin-bottom:3rem" {
                    h2 style=(SECTION_H2) { "8. Automated Decision-Making" }
                    p { "The analysis engine uses AI to identify applicable legal tests and surface relevant authorities. This constitutes AI-assisted information provision, not automated decision-making with legal or similarly significant effects under Article 22 UK GDPR. The tool does not make decisions about your legal rights — it provides structured information to support your own decision-making. You are always free to disregard the tool's output and seek independent legal advice." }
                }
                section style="margin-bottom:3rem" {
                    h2 style=(SECTION_H2) { "9. Complaints" }
                    p { "If you are not satisfied with how we handle your data, you have the right to lodge a complaint with the Information Commissioner's Office (ICO):" }
                    p style="margin-top:0.75rem;font-family:var(--font-mono);font-size:0.8rem" {
                        "Information Commissioner's Office" br;
                        "Wycliffe House, Water Lane, Wilmslow, Cheshire SK9 5AF" br;
                        a href="https://ico.org.uk/make-a-complaint/" style=(PURPLE) { "ico.org.uk/make-a-complaint" }
                    }
                }
                (mono_note("3rem", html! { "This tool provides legal information, not legal advice. It does not create a solicitor-client relationship." }))
            }
        }
    };
    document(&state, &META, body, None)
}

const PILLARS: [(&str, &str, &str, &str, &str); 4] = [
    ("01", "INVERSE CHATBOT", "Dynamic Schema Generation", "No chat interface. The system analyses uploaded documents against the legal test for each claim type, identifies gaps, and generates targeted UI form components to fill them. You answer specific questions — then review the structured output.", "Document uploaded → Parser extracts text → Triage Agent identifies gaps → Dynamic form renders 1–2 specific fields → Schema updates → Next cycle."),
    ("02", "EPISTEMIC QUARANTINE", "Strict RAG with Validation Gates", "The LLM's training data is treated as untrusted. Every factual claim must be grounded in our curated, verified vector database. Ungrounded claims are quarantined — stripped before reaching you.", "Tier 1 (binding): Supreme Court + CoA. Tier 2 (persuasive): EAT. Tier 3 (statutory): ERA 1996, EA 2010, ERA 2025. Tier 4 (practice): Presidential Guidance."),
    ("03", "DURABLE STATE MACHINE", "Async Event-Driven Workflows", "Legal proceedings take months or years. The system maintains state across arbitrary time gaps — from initial fact-finding through to EAT appeal and beyond.", "16 procedural states: PRE_ACTION → ACAS → ET1 → ET3 → Case Management → Disclosure → Witness Statements → Bundle → Hearing → Judgment → EAT → CoA."),
    ("04", "ADVERSARIAL SHADOW-OPPONENT", "Multi-Agent Debate", "Three agents stress-test every argument before you see it. A Drafter advocates, a Critic attacks, and a Judge scores. Only arguments passing a 70% threshold reach you.", "Drafter (Blue, temp=0.3) → Critic (Red, temp=0.7) → Judge (Neutral, temp=0.1) → Score (≥70% to pass, max 3 iterations)."),
];

pub async fn product(State(state): State<SharedState>) -> Markup {
    const META: PageMeta =
        PageMeta { title: "Product | Tribunal Harness", description: "Four architectural pillars powering the Tribunal Harness legal intelligence platform.", path: "/product" };
    let body = html! {
        div class="page-section" style="padding-top:10rem" {
            (page_intro("ARCHITECTURE", "Four pillars. One engine."))
            p class="text-lead" style="margin-bottom:4rem" {
                "Tribunal Harness is not a chatbot. It is a schema-driven legal analysis engine built on four architectural pillars, each designed to address a specific failure mode of AI in legal contexts."
            }
            div style="display:flex;flex-direction:column;gap:4rem" {
                @for (number, label, title, desc, detail) in PILLARS {
                    div style="display:grid;grid-template-columns:auto 1fr;gap:3rem;padding:3rem;border:1px solid var(--color-border-subtle);border-radius:var(--radius-card)" {
                        div style="font-family:var(--font-mono);font-size:3rem;opacity:0.15;font-weight:700" { (number) }
                        div {
                            span class="text-subhead" { (label) }
                            h2 style="font-family:var(--font-serif);font-size:2rem;margin-bottom:1rem" { (title) }
                            p style="color:var(--color-text-secondary);margin-bottom:1.5rem;line-height:1.8" { (desc) }
                            div style="font-family:var(--font-mono);font-size:0.75rem;color:var(--color-text-secondary);padding:1rem;background:rgba(255,255,255,0.02);border-radius:6px;line-height:1.8" { (detail) }
                        }
                    }
                }
            }
            (mono_note("3rem", html! { "This tool provides legal information, not legal advice. It does not constitute legal advice and should not be relied upon as a substitute for qualified legal representation." }))
        }
    };
    document(&state, &META, body, None)
}

const COMPLIANCE_CARDS: [(&str, &str, Option<&str>); 4] = [
    ("UK GDPR Aligned", "Personal data processed lawfully under UK GDPR and the Data Protection Act 2018. Full privacy notice available. Special category data processing governed by explicit consent under Article 9(2)(a).", Some("/privacy")),
    ("Equality Act 2010 Coverage", "All protected characteristics under EA 2010 are covered by our claim type schemas. Updated for ERA 2025 amendments to harassment and whistleblowing provisions. This denotes coverage scope, not a certification.", None),
    ("Open Reasoning", "Every reasoning step is auditable. Trust indicators (VERIFIED / CHECK / QUARANTINED) show exactly how confident the system is in each legal proposition. Ungrounded claims are stripped, not flagged.", None),
    ("Data Minimisation", "Documents parsed in-memory and discarded. Case data encrypted and retained for session continuity only. No long-term storage of personal data. No data sold or shared with third parties.", None),
];

const INDICATORS: [(&str, &str, &str); 4] = [
    ("VERIFIED", "#2dd4bf", "Grounded in statute or cited case law"),
    ("CHECK", "#fbbf24", "Partially grounded — needs human verification"),
    ("QUARANTINED", "var(--color-error-coral)", "Ungrounded — stripped from output"),
    ("PASS", "var(--color-text-secondary)", "Non-factual content — no citation needed"),
];

const QUARANTINE_SVG: &str = r##"<path d="M50 80 L150 80 L150 220 L50 220" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1" stroke-dasharray="4 4"/><text x="100" y="70" fill="var(--color-text-secondary)" font-size="10" font-family="var(--font-mono)" text-anchor="middle" letter-spacing="0.1em">LLM PARAMETRIC MEMORY</text><path d="M190 60 L210 60 L210 240 L190 240 Z" fill="rgba(139,92,246,0.05)" stroke="var(--color-accent-purple)" stroke-width="1.5"/><text x="200" y="50" fill="var(--color-accent-purple)" font-size="10" font-family="var(--font-mono)" text-anchor="middle" letter-spacing="0.1em">EPISTEMIC FILTER</text><path d="M250 80 L350 80 L350 220 L250 220" fill="none" stroke="rgba(45,212,191,0.2)" stroke-width="1"/><text x="300" y="70" fill="#2dd4bf" font-size="10" font-family="var(--font-mono)" text-anchor="middle" letter-spacing="0.1em">GROUNDED OUTPUT</text><path d="M100 120 L190 120" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/><circle cx="100" cy="120" r="3" fill="#fff"/><path d="M210 120 L300 120" fill="none" stroke="#2dd4bf" stroke-width="2"/><polygon points="295,116 303,120 295,124" fill="#2dd4bf"/><circle cx="210" cy="120" r="4" fill="#2dd4bf"/><path d="M100 160 L190 160" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/><circle cx="100" cy="160" r="3" fill="#fff"/><path d="M210 160 L300 160" fill="none" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="6 3"/><polygon points="295,156 303,160 295,164" fill="#fbbf24"/><rect x="208" y="158" width="4" height="4" fill="#fbbf24"/><path d="M100 200 L190 200" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/><circle cx="100" cy="200" r="3" fill="#fff"/><path d="M190 195 L205 205 M190 205 L205 195" stroke="var(--color-error-coral)" stroke-width="2"/><circle cx="197.5" cy="200" r="10" fill="none" stroke="var(--color-error-coral)" stroke-width="1.5"/><path d="M210 200 L300 200" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1" stroke-dasharray="2 4"/>"##;

pub async fn security(State(state): State<SharedState>) -> Markup {
    const META: PageMeta = PageMeta {
        title: "Security & Compliance | Tribunal Harness",
        description: "Our commitment to GDPR compliance, epistemic honesty, and data protection.",
        path: "/security",
    };
    let body = html! {
        div style="padding-top:10rem" {
            div class="page-section" {
                (page_intro("TRUST & VERIFICATION", "Security & Compliance"))
                p class="text-lead" style="margin-bottom:4rem" { "Legal technology demands the highest standards of data protection, verification, and transparency." }
                div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:1.5rem;margin-bottom:4rem" {
                    @for (title, desc, link) in COMPLIANCE_CARDS {
                        div class="compliance-card" {
                            div {
                                h4 class="compliance-title" { (title) }
                                p class="compliance-desc" { (desc) }
                                @if let Some(href) = link {
                                    a href=(href) style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-accent-purple);margin-top:0.5rem;display:inline-block" { "Read full privacy notice →" }
                                }
                            }
                        }
                    }
                }
            }

            div class="page-section" style="border-top:1px solid var(--color-border-subtle)" {
                span class="text-subhead" { "EPISTEMIC HONESTY" }
                h2 style="font-family:var(--font-serif);font-size:2.5rem;margin-bottom:1.5rem" { "We quarantine what we can't verify." }
                div style="display:grid;grid-template-columns:1fr 1fr;gap:4rem;align-items:center" {
                    div style="color:var(--color-text-secondary);line-height:1.8" {
                        p style="margin-bottom:1.5rem" { "The LLM's parametric memory — its training data — is treated as untrusted by default. Every factual claim must be grounded in our curated vector database before it reaches you." }
                        p style="margin-bottom:2rem" { "Claims that cannot be verified are not shown with a warning — they are stripped entirely. This is a deliberate design choice: in legal contexts, a confident-sounding but wrong citation is worse than no citation at all." }
                        svg viewBox="0 0 400 300" style="width:100%;border-radius:8px;border:1px solid var(--color-border-subtle);background:rgba(0,0,0,0.3)" { (PreEscaped(QUARANTINE_SVG)) }
                    }
                    div style="display:flex;flex-direction:column;gap:1rem" {
                        @for (label, color, desc) in INDICATORS {
                            div style="padding:1rem;border:1px solid var(--color-border-subtle);border-radius:6px;display:flex;align-items:center;gap:1rem" {
                                span style=(format!("font-family:var(--font-mono);font-size:0.7rem;font-weight:700;color:{color};min-width:90px")) { (label) }
                                span style="font-size:0.85rem;color:var(--color-text-secondary)" { (desc) }
                            }
                        }
                    }
                }
            }

            div class="page-section" style="border-top:1px solid var(--color-border-subtle)" {
                span class="text-subhead" { "DATA HANDLING" }
                h2 style="font-family:var(--font-serif);font-size:2.5rem;margin-bottom:1.5rem" { "What we store. What we don't." }
                div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem" {
                    div class="interface-card" {
                        h4 style="color:#2dd4bf;font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:1rem" { "Stored (encrypted, session only)" }
                        ul style="list-style:none;color:var(--color-text-secondary);font-size:0.85rem;line-height:2" {
                            li { "• Claim schema state (for session continuity)" }
                            li { "• Calculated deadlines and procedural stage" }
                            li { "• Analysis results with trust indicators" }
                        }
                    }
                    div class="interface-card" {
                        h4 style="color:var(--color-error-coral);font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:1rem" { "Never Stored" }
                        ul style="list-style:none;color:var(--color-text-secondary);font-size:0.85rem;line-height:2" {
                            li { "• Uploaded documents (parsed and discarded)" }
                            li { "• Raw LLM responses (only verified output retained)" }
                            li { "• Identifying personal data beyond the current session" }
                        }
                    }
                }
                div style="margin-top:2rem;padding:1.5rem;border:1px solid var(--color-accent-purple);border-radius:var(--radius-card);background:rgba(123,107,245,0.03)" {
                    h4 style="font-family:var(--font-sans);font-weight:600;font-size:0.85rem;color:var(--color-accent-purple);margin-bottom:0.75rem" { "Managed Proxy Architecture & Third-Party AI Processing" }
                    p style="color:var(--color-text-secondary);font-size:0.85rem;line-height:1.7" {
                        "Case narratives submitted for analysis are processed by Anthropic (San Francisco, USA) via their commercial API. Anthropic's API terms prohibit the use of inputs for model training. This constitutes an international data transfer; for full details including the safeguards applied, see our "
                        a href="/privacy" style=(PURPLE) { "Privacy Policy" }
                        "."
                    }
                }
                div style="margin-top:2rem;padding:1rem;border:1px solid var(--color-border-subtle);border-radius:6px;text-align:center" {
                    p style="font-family:var(--font-mono);font-size:0.75rem;color:var(--color-text-secondary)" {
                        "This tool provides legal information, not legal advice. See our "
                        a href="/terms" style=(PURPLE) { "Terms of Use" }
                        " and "
                        a href="/privacy" style=(PURPLE) { "Privacy Policy" }
                        "."
                    }
                }
            }
        }
    };
    document(&state, &META, body, None)
}

pub async fn terms(State(state): State<SharedState>) -> Markup {
    const META: PageMeta = PageMeta {
        title: "Terms of Use | Tribunal Harness",
        description: "Terms governing use of Tribunal Harness, including legal information disclaimers and limitation of liability.",
        path: "/terms",
    };
    let body = html! {
        div class="page-section" style="padding-top:10rem;max-width:800px" {
            (page_intro("LEGAL", "Terms of Use"))
            p style="color:var(--color-text-secondary);margin-bottom:3rem;font-size:0.85rem" { "Last updated: 16 February 2026" }
            div style="color:var(--color-text-secondary);line-height:1.9;font-size:0.95rem" {
                div style="padding:1.5rem;border:1px solid var(--color-error-coral);border-radius:var(--radius-card);background:rgba(232,93,93,0.03);margin-bottom:3rem" {
                    h3 style="font-family:var(--font-sans);font-weight:600;color:var(--color-error-coral);margin-bottom:0.75rem" { "Important: Legal Information, Not Legal Advice" }
                    p {
                        "Tribunal Harness provides " strong { "legal information" } ", not " strong { "legal advice" } ". It does not constitute the provision of reserved legal activities within the meaning of the Legal Services Act 2007. Use of this tool does not create a solicitor-client relationship, a barrister-client relationship, or any other professional advisory relationship."
                    }
                    p style="margin-top:0.75rem" {
                        "If your claim is complex, involves potential loss of livelihood, or concerns high-value remedies, you should seek advice from a qualified solicitor, barrister, or accredited legal adviser. Free advice may be available from your local Citizens Advice, Law Centre, or ACAS."
                    }
                }
                section style="margin-bottom:3rem" {
                    h2 style=(SECTION_H2) { "1. Service Description" }
                    p { "Tribunal Harness is a legal information tool that provides structured analysis of employment tribunal claim types against statutory legal tests. It identifies applicable claim types, surfaces relevant authorities, calculates procedural deadlines, and presents this information in a structured format." }
                    p style="margin-top:0.75rem" { "The tool does not: file claims on your behalf; make submissions to a tribunal; provide bespoke legal advice about your specific situation; or guarantee any outcome. All output is informational and requires your independent judgement and, where appropriate, professional legal review before reliance." }
                }
                section style="margin-bottom:3rem" {
                    h2 style=(SECTION_H2) { "2. Accuracy and Limitations" }
                    p { "While we take reasonable steps to ensure the accuracy of the legal information provided — including citation verification, epistemic quarantine of ungrounded claims, and regular updates for legislative changes — we do not warrant that all information is complete, current, or error-free." }
                    p style="margin-top:0.75rem" { "UK employment law is complex and fact-sensitive. The tool analyses facts against general legal tests but cannot account for all case-specific circumstances, local tribunal practices, or judicial discretion." }
                    p style="margin-top:0.75rem" { "ERA 2025 provisions are being brought into force on a phased timetable. Some commencement dates are subject to confirmation by Statutory Instrument. Where this is the case, the tool clearly indicates the provisional nature of the date." }
                }
                section style="margin-bottom:3rem" {
                    h2 style=(SECTION_H2) { "3. AI-Generated Content" }
                    p { "Portions of the analysis output are generated by artificial intelligence (Anthropic Claude). While the system applies verification layers (epistemic quarantine, citation checking, adversarial testing), AI-generated content may contain errors, omissions, or inaccuracies." }
                    p style="margin-top:0.75rem" { "Trust indicators (VERIFIED, CHECK, QUARANTINED) are provided to help you assess the reliability of each proposition. You should independently verify any legal proposition before relying on it in tribunal proceedings." }
                }
                section style="margin-bottom:3rem" {
                    h2 style=(SECTION_H2) { "4. Limitation of Liability" }
                    p { "To the fullest extent permitted by law, Tribunal Harness shall not be liable for any loss, damage, or adverse consequence arising from reliance on the tool's output, including but not limited to: missed tribunal deadlines, unsuccessful claims, adverse costs orders, or any other detriment." }
                    p style="margin-top:0.75rem" { "Nothing in these terms excludes or limits liability for fraud, death or personal injury caused by negligence, or any other liability that cannot be excluded by law." }
                }
                section style="margin-bottom:3rem" {
                    h2 style=(SECTION_H2) { "5. Your Responsibilities" }
                    ul style="list-style:none;line-height:2.2" {
                        li { "• You are responsible for the accuracy of the facts you provide to the tool" }
                        li { "• You are responsible for verifying the tool's output before relying on it" }
                        li { "• You must not use the tool to generate vexatious, fraudulent, or abusive claims" }
                        li { "• You must comply with tribunal rules and directions regardless of the tool's output" }
                        li { "• You acknowledge that time limits are critical in tribunal proceedings and should not rely solely on this tool's deadline calculations" }
                    }
                }
                section style="margin-bottom:3rem" {
                    h2 style=(SECTION_H2) { "6. Data Protection" }
                    p {
                        "Your use of Tribunal Harness is subject to our "
                        a href="/privacy" style=(PURPLE) { "Privacy Policy" }
                        ", which explains how we collect, use, and protect your personal data, including special category data that may be contained in employment tribunal narratives."
                    }
                }
                section style="margin-bottom:3rem" {
                    h2 style=(SECTION_H2) { "7. Governing Law" }
                    p { "These terms are governed by and construed in accordance with the laws of England and Wales. Any disputes arising from the use of Tribunal Harness shall be subject to the exclusive jurisdiction of the courts of England and Wales." }
                }
                section {
                    h2 style=(SECTION_H2) { "8. Contact" }
                    p { "Questions about these terms: " a href="mailto:hello@tribunalharness.co.uk" style=(PURPLE) { "hello@tribunalharness.co.uk" } }
                }
            }
        }
    };
    document(&state, &META, body, None)
}
